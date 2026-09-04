'use strict';
/**
 * 부팅 기록 — log/mobius-boot.jsonl
 *
 * 기동할 때 실제로 전역에 심은 conf 값을 한 줄 남긴다. CLI(tools/mobius-conf.js)가
 * 파일 값과 이 기록을 대조해 "적용됨 / 재기동 대기" 를 낸다. apply:'runtime' 인
 * 키도 재기동해야 반영되므로(코어는 파일을 기동 때 한 번만 읽는다) 이 대조가
 * 없으면 관리자는 저장한 값이 도는지 알 수 없다.
 *
 *   {"role":"master","pid":…,"at":…,"supervised":…,"cap":…,"workers":…,"confPath":…,"conf":{…}}
 *   {"role":"worker","pid":…,"at":…,"supervised":…,"conf":{…}}
 *   {"role":"capped","at":…,"pid":…}
 *
 * **마스터가 비우고 전원이 append 한다.** 파일은 항상 "지금 이 판" 만 담는다.
 * 그래서 mobius.js 의 포트 시험 바인드가 이보다 **앞**이어야 한다 — 순서를
 * 뒤집으면 중복 실행된 인스턴스가 살아 있는 서버의 기록을 비우고 종료한다.
 *
 * **상한과 capped.** 재포크 루프(포트 충돌 등)에서 초당 24줄씩 자라면 하루
 * 수백 MB 다. 마스터가 cap 을 정해 기록하고, 워커는 append 전에 줄 수를 센다.
 * 상한에 처음 닿은 프로세스만 끝에 capped 한 줄을 덧붙인다 — 파일을 대체하지
 * 않는다(마스터 줄이 사라지면 값 대조가 전 키에서 불가능해진다). capped 줄이 곧
 * CLI 의 "좀비 의심" 신호다.
 *
 * **기록 실패는 기동을 막지 않는다.** 디렉터리 생성·줄 수 세기·append 를 전부
 * try/catch 로 감싸고 사유만 남긴 뒤 정상 반환한다. log/ 가 있으되 쓸 수 없는
 * 배포는 지금도 뜬다 — 이 파일이 새 회귀를 들이면 안 된다.
 *
 * **비밀 키는 뺀다.** 받은 객체를 conf_schema 로 훑어 secret:true 를 거른다 —
 * 목록을 들지 않으므로 새 비밀 키가 생겨도 자동으로 빠진다.
 *
 * supervised 는 process.env.pm_id 유무다 — pm2 일 때만 참이다. systemd·docker 로
 * 띄우면 감독자가 있어도 거짓이므로 CLI 는 "pm2 로 뜬 것이 아니다" 까지만 말한다.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DEFAULT_FILE = path.join(ROOT, 'log', 'mobius-boot.jsonl');

// 워커 하나가 정상 기동에 쓰는 줄은 하나다. 워커당 3줄이면 되살아남 두 번까지는
// 자연스럽고 그 이상은 재포크 루프다. 최소 16 은 코어가 아주 적은 장비에서
// 한두 번의 되살아남이 곧 capped 로 찍히지 않게 한다.
var LINES_PER_WORKER = 3;
var MIN_CAP = 16;

function cap_for(workers) {
    return Math.max(MIN_CAP, 1 + workers * LINES_PER_WORKER);
}

function strip_secrets(applied, schema) {
    var out = {};
    Object.keys(applied || {}).forEach(function (k) {
        var s = schema.get(k);
        if (s && s.secret === true) { return; }
        out[k] = applied[k];
    });
    return out;
}

function parse_lines(text) {
    var out = { master: null, workers: [], capped: null, lines: 0, broken: 0 };
    text.split('\n').forEach(function (l) {
        if (l.trim() === '') { return; }
        out.lines++;
        var o;
        try { o = JSON.parse(l); } catch (e) { out.broken++; return; }
        if (!o || typeof o !== 'object') { out.broken++; return; }
        if (o.role === 'master') { out.master = o; }
        else if (o.role === 'worker') { out.workers.push(o); }
        else if (o.role === 'capped') { out.capped = out.capped || o; }
        else { out.broken++; }
    });
    return out;
}

/**
 * 읽는다. 파일이 없으면 null. 깨진 줄은 broken 에 세고 버린다.
 */
exports.read = function (file) {
    file = file || DEFAULT_FILE;
    var text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { return null; }
    return parse_lines(text);
};

/**
 * 쓴다. 던지지 않는다. 썼으면 true.
 *
 *   applied   conf_load 가 돌려준 { conf 키: 심은 값 }
 *   opts      file · role · pid · workers · supervised · confPath · schema · now (전부 선택)
 */
exports.write = function (applied, opts) {
    opts = opts || {};
    var file = opts.file || DEFAULT_FILE;
    var role = opts.role || (require('cluster').isPrimary ? 'master' : 'worker');
    var schema = opts.schema || require('./conf_schema');
    var workers = (typeof opts.workers === 'number') ? opts.workers : os.cpus().length;
    var pid = opts.pid || process.pid;
    var supervised = (opts.supervised !== undefined) ? !!opts.supervised : !!process.env.pm_id;
    var now = (opts.now || new Date()).toISOString();

    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });

        if (role === 'master') {
            var head = {
                role: 'master', pid: pid, at: now, supervised: supervised,
                cap: cap_for(workers), workers: workers,
                confPath: opts.confPath || null,
                conf: strip_secrets(applied, schema)
            };
            // 마스터가 비운다. 지난 판의 줄은 전부 사라진다.
            fs.writeFileSync(file, JSON.stringify(head) + '\n', 'utf8');
            return true;
        }

        var cur = parse_lines(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
        if (cur.capped) { return false; }                       // 이미 상한이다 — 아무도 더 쓰지 않는다
        var cap = (cur.master && typeof cur.master.cap === 'number') ? cur.master.cap : cap_for(workers);
        if (cur.lines >= cap) {
            // 상한에 처음 닿은 프로세스. 자기 줄 대신 capped 를 **끝에** 덧붙인다.
            fs.appendFileSync(file, JSON.stringify({ role: 'capped', at: now, pid: pid }) + '\n', 'utf8');
            return false;
        }
        var line = { role: 'worker', pid: pid, at: now, supervised: supervised, conf: strip_secrets(applied, schema) };
        fs.appendFileSync(file, JSON.stringify(line) + '\n', 'utf8');
        return true;
    }
    catch (e) {
        console.error('[boot_record] 기록 실패: ' + ((e && e.message) || e) + ' — 기동은 계속한다');
        return false;
    }
};

exports.DEFAULT_FILE = DEFAULT_FILE;
exports.capFor = cap_for;
