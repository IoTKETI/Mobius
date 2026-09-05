'use strict';
/**
 * conf CLI 의 논리. 파일·프로세스·터미널은 deps 로 받는다 — 시험이 실물 대신
 * 끼운다. 진입점은 tools/mobius-conf.js 다(로드 순서를 지키고 deps 를 채운다).
 *
 * deps
 *   schema      mobius/conf_schema (global.usedb 를 세운 뒤 require 한 것)
 *   store       tools/conf_store 의 ConfStore
 *   conf        읽은 conf.json 객체 ({} 면 파일 없음)
 *   readRecord  () → boot_record.read() 결과 (없으면 null)
 *   alive       (pid) → boolean
 *   probePort   (port, cb(open))
 *   pm2List     (cb(list|null))  실패는 전부 null — "pm2 없음"
 *   io          { stdin, stdout, isTTY }
 *
 * 세 가지 값을 합친다 — 표(선언) · conf.json(파일 값) · 부팅 기록(도는 값).
 *
 * **"돌고 있는가" 의 판정은 부팅 기록의 마스터 pid 하나로 한다.** 포트는 남이
 * 쥐어도 열려 보이고 pm2 의 online 은 정상을 뜻하지 않는다 — 둘은 경고로만 쓴다.
 * 마스터 pid 가 죽어 있으면 값 대조를 아예 하지 않는다("모름").
 *
 * **키별 문구(관문 경고)는 여기 없다** — 표의 gateWarn 에서 온다. 여기 적으면
 * 코어의 정책을 화면이 베끼는 것이 된다.
 */
var readline = require('readline');
var net = require('net');
var cp = require('child_process');
var fs = require('fs');

var PROBE_TIMEOUT_MS = 1500;
var PM2_TIMEOUT_MS = 5000;

// 프롬프트로만 다시 받을 수 있는 비밀 둘(tools/setup.js). 표에 문구를 두지 않는 것은 키가 아니라 명령이라서다.
var REENTRY_FLAG = { dbpass: '--dbpass', superUser: '--superuser' };

var STATE_LABEL = {
    applied: '적용됨',
    pending: '● 재기동 대기',
    unknown: '모름',
    na: '대조 대상 아님',
    derived: '유도됨',
    invalid: '파일 값이 유효하지 않다'
};

// runEdit 이 관문 처리 전/후 두 자리에서 조기 반환할 때 쓴다 — 문구가 갈리지 않게.
var NOTHING_CHANGED = '바꾼 것이 없다 — 파일을 건드리지 않았다.';

var USAGE = [
    '사용법',
    '  npm run conf                     전체 목록 — 카테고리별 · 파일 값 · 3상태',
    '  npm run conf -- <키>             단건 상세',
    '  npm run conf -- set <키> <값>    변경 (배열은 쉼표로)',
    '  npm run conf -- unset <키>       기본값으로 되돌린다',
    '  npm run conf -- edit             일괄 편집 — 첫 실행처럼 사용자 키를 차례로 묻는다 (Enter 는 그대로)',
    '  npm run status                   마스터 pid · 포트 · 부팅 기록 · 재기동 대기 건수',
    '  옵션  --db=<이름>                백엔드를 강제한다 (키 표가 백엔드를 따라간다)',
    '  옵션  --all                     고급 키까지 보이고 고친다 (기본은 사용자 키 7개 — 첫 실행이 묻는 것)',
    '',
    '  비밀 키(dbpass·superUser·adminPassword·adminOrigin)는 조회만 한다.',
    '  dbpass 를 다시 넣으려면 `npm run setup -- --dbpass`, superUser 는 `npm run setup -- --superuser`.'
];

function pad(s, n) { s = String(s); while (s.length < n) { s += ' '; } return s; }
function fmt_at(iso) { return String(iso || '').replace('T', ' ').slice(0, 16); }
function norm(v) { return (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o || {}, k); }

// argv[2] 는 하위 명령이다. 백엔드로 읽지 않는다 — mobius.js 의 글자를 베끼면
// `npm run conf -- set mqttPort 1884` 가 global.usedb='set' 을 만든다.
exports.resolveBackend = function (argv, conf) {
    var opt = argv.filter(function (a) { return a.indexOf('--db=') === 0; })[0];
    if (opt) { return opt.slice('--db='.length); }
    return conf.db || 'mysql';
};

// 명령줄은 전부 문자열이다.
exports.coerce = function (type, str) {
    if (type === 'number') {
        // Number('')===0 이고 dbQueueLimit 의 0 은 "타임아웃 없는 무제한 대기열" 이다.
        if (!/^-?\d+(\.\d+)?$/.test(str)) { return { ok: false, reason: '수가 아니다: "' + str + '"' }; }
        return { ok: true, value: Number(str) };
    }
    if (type === 'array') {
        if (str.trim() === '') { return { ok: true, value: [] }; }
        return { ok: true, value: str.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; }) };
    }
    return { ok: true, value: str };
};

exports.liveness = function (rec, alive) {
    if (!rec || !rec.master) {
        return { running: false, reason: '부팅 기록이 없다 (새 코어로 기동한 적이 없다)' };
    }
    if (!alive(rec.master.pid)) {
        return { running: false, reason: 'Mobius 가 떠 있지 않다 (마지막 기동 ' + fmt_at(rec.master.at) + ', pid ' + rec.master.pid + ' 없음)' };
    }
    return { running: true, master: rec.master };
};

/**
 * 키 하나의 상태. running 이 거짓이면 대조하지 않는다. record 는 마스터 줄의 conf.
 */
exports.judge = function (schema, key, conf, running, record) {
    var s = schema.get(key);
    var inFile = has(conf, key);
    var fileValue = inFile ? conf[key] : s.dflt;
    if (inFile && !schema.checkValue(key, conf[key]).ok) {
        // 코어가 유효하지 않은 값을 기본값으로 떨어뜨리는 키는 재기동해도 안 바뀐다.
        return { state: 'invalid', fileValue: fileValue, note: STATE_LABEL.invalid + ' (기본값으로 떨어짐) — set 으로 고칠 것' };
    }
    if (!running) { return { state: 'unknown', fileValue: fileValue }; }
    if (!record || !has(record, key)) {
        return { state: 'na', fileValue: fileValue, note: STATE_LABEL.na + ' (코어가 안 읽는다)' };
    }
    var applied = record[key];
    if (typeof s.derivedFrom === 'function') {
        var why = s.derivedFrom(record);
        if (why) { return { state: 'derived', fileValue: fileValue, applied: applied, note: STATE_LABEL.derived + ' (' + why + ' · 파일 ' + norm(fileValue) + ')' }; }
    }
    if (norm(fileValue) === norm(applied)) { return { state: 'applied', fileValue: fileValue, applied: applied }; }
    return { state: 'pending', fileValue: fileValue, applied: applied, note: STATE_LABEL.pending + ' (파일 ' + norm(fileValue) + ' / 도는 값 ' + norm(applied) + ')' };
};

exports.pendingKeys = function (deps, record) {
    return deps.schema.all().filter(function (k) {
        return deps.schema.get(k).secret !== true &&
               exports.judge(deps.schema, k, deps.conf, true, record).state === 'pending';
    });
};

exports.warnings = function (rec) {
    var out = [];
    if (!rec) { return out; }
    if (rec.capped) { out.push('좀비 의심 — 부팅 기록에 capped 줄이 있다. 재포크 루프다(포트 충돌?). `npm run status` 로 포트를 본다.'); }
    var shapes = rec.workers.map(function (w) { return JSON.stringify(w.conf || {}); });
    if (shapes.length > 1 && shapes.some(function (s) { return s !== shapes[0]; })) {
        out.push('워커 불일치 — 기록의 워커 줄들이 서로 다른 값을 갖고 있다. 되살아난 워커만 새 conf 를 읽었다. 재기동할 것.');
    }
    return out;
};

// 표를 그룹별로. 그룹 순서는 표의 선언 순서, 그룹 안은 키 이름 순.
function grouped(schema) {
    var by = {};
    schema.all().forEach(function (k) {
        var g = schema.get(k).group;
        (by[g] = by[g] || []).push(k);
    });
    return schema.groups().filter(function (g) { return by[g]; })
        .map(function (g) { return { group: g, keys: by[g] }; });
}

function mark_of(s) {
    if (s.grade === 'gate') { return '⚠ 관문'; }
    if (s.readOnly) { return '읽기 전용'; }
    return '';
}

exports.renderList = function (deps) {
    var schema = deps.schema, conf = deps.conf;
    var rec = deps.readRecord();
    var live = exports.liveness(rec, deps.alive);
    var record = live.running ? live.master.conf : null;
    var lines = [];

    grouped(schema).forEach(function (grp) {
        var shown = grp.keys.filter(function (k) { return visible(deps, k) && schema.get(k).secret !== true; });
        if (!shown.length) { return; }
        lines.push('');
        lines.push(grp.group);
        shown.forEach(function (k) {
            var s = schema.get(k);
            var j = exports.judge(schema, k, conf, live.running, record);
            var state = j.note || STATE_LABEL[j.state];
            lines.push('  ' + pad(k, 20) + ' ' + pad(norm(j.fileValue), 20) + ' ' + pad(state, 14) + ' ' + mark_of(s));
        });
    });

    if (!deps.all) {
        var hidden = schema.all().filter(function (k) { return !visible(deps, k); });
        if (hidden.length) {
            lines.push('');
            lines.push('고급 키 ' + hidden.length + '개는 숨겼다 — `npm run conf -- --all` 로 본다. 굳이 바꿀 일이 없는 것들이다.');
        }
    }

    var secrets = schema.all().filter(function (k) { return schema.get(k).secret === true; })
        .filter(function (k) { return visible(deps, k); });
    lines.push('');
    lines.push('비밀 — 값을 띄우지 않는다');
    secrets.forEach(function (k) {
        var present = has(conf, k) && conf[k] !== '' && conf[k] !== null;
        lines.push('  ' + pad(k, 20) + ' ' + (present ? '설정됨' : '없음 (기본값 사용)'));
    });

    lines.push('');
    if (!live.running) {
        lines.push('모름 — ' + live.reason + '. 값 대조를 하지 않았다.');
    } else {
        // 재기동 대기는 --all 과 무관하게 전 키를 센다 — status 와 같은 원칙이다.
        // 숨기는 것은 **키** 이지 "재기동이 필요하다는 사실" 이 아니다 — 고급 키를
        // conf.json 을 직접 고쳐 바꾼 운영자에게 "재기동 대기 없음" 이라고 하면 거짓말이
        // 된다(2차 검토 Important 2).
        var allPending = exports.pendingKeys(deps, record);
        if (allPending.length) {
            var hiddenPending = allPending.filter(function (k) { return !visible(deps, k); });
            lines.push('● 재기동 대기 ' + allPending.length + '건 (' + allPending.join(', ') + ')' +
                (hiddenPending.length ? ' (고급 키 ' + hiddenPending.length + '개 포함 — --all 로 본다)' : '') +
                '.  반영하려면 Mobius 를 다시 띄운다.');
        } else {
            lines.push('재기동 대기 없음.');
        }
    }
    // 표에 없는 키 — 죽은 키(usesqlite·cntManPort…)거나 오타다. 웹의 unknownKeys 경고를 여기서 잇는다.
    var unknown = Object.keys(conf).filter(function (k) { return !schema.get(k); });
    if (unknown.length) { lines.push('경고: 표에 없는 키 — 죽은 키거나 오타다: ' + unknown.join(', ')); }
    // 봉인이 어긋나면 서버가 안 뜬다 — 목록에서 바로 보이게 한다(스펙 §13.2).
    var sv = deps.sealStatus ? deps.sealStatus() : null;
    if (sv && !sv.ok) {
        lines.push('경고: 봉인 — ' + sv.reason + '. 이 상태로는 서버가 뜨지 않는다 — ' +
            '`npm run setup -- --superuser` 를 치고 Enter(값 유지) 하면 봉인이 만들어진다.');
    }
    exports.warnings(rec).forEach(function (w) { lines.push('경고: ' + w); });
    return lines;
};

exports.renderShow = function (key, deps) {
    var schema = deps.schema;
    if (!visible(deps, key)) { return advanced_fail(key).lines; }
    var s = schema.get(key);
    var d = schema.describe()[key];   // 비밀·숨김 키는 describe 에 없다
    var rec = deps.readRecord();
    var live = exports.liveness(rec, deps.alive);
    var lines = [];
    lines.push(key + '  —  ' + (s.label || ''));
    lines.push('  ' + pad('분류', 12) + s.group);
    lines.push('  ' + pad('타입', 12) + s.type + (s.integer ? ' (정수)' : '') + (typeof s.min === 'number' ? ' · ' + s.min + ' 이상' : ''));
    var choices = schema.choices(key);
    if (choices) { lines.push('  ' + pad('유효값', 12) + choices.join(' / ')); }
    if (s.validHint) { lines.push('  ' + pad('형식', 12) + s.validHint); }
    lines.push('  ' + pad('기본값', 12) + norm(s.dflt));
    // CLI 관점에서는 runtime 이든 reload 든 전부 재기동이다 — 코어는 파일을 기동 때 한 번 읽는다.
    lines.push('  ' + pad('반영', 12) + s.apply + (s.reloadWith ? ' (' + s.reloadWith + ')' : '') + ' — 파일을 고치면 재기동해야 반영된다');
    if (s.secret === true) {
        lines.push('  ' + pad('파일 값', 12) + (has(deps.conf, key) && deps.conf[key] !== '' ? '설정됨' : '없음') + ' (비밀 — 값을 띄우지 않는다)');
        lines.push('  ' + pad('변경', 12) + 'CLI 로 바꿀 수 없다' + (REENTRY_FLAG[key] ? ' — `npm run setup -- ' + REENTRY_FLAG[key] + '`' : ''));
        return lines;
    }
    if (d && d.grade === 'gate') { lines.push('  ' + pad('등급', 12) + '관문 — 저장 전에 아래 경고를 보이고 키 이름을 타이핑해야 통과'); lines.push(d.gateWarn.split('\n').map(function (l) { return '    ' + l; }).join('\n')); }
    if (s.readOnly) { lines.push('  ' + pad('등급', 12) + '읽기 전용 — CLI 로 바꿀 수 없다'); }
    var j = exports.judge(schema, key, deps.conf, live.running, live.running ? live.master.conf : null);
    lines.push('  ' + pad('파일 값', 12) + (has(deps.conf, key) ? norm(deps.conf[key]) : '(없음 — 기본값 사용)'));
    if (has(j, 'applied')) { lines.push('  ' + pad('도는 값', 12) + norm(j.applied)); }
    lines.push('  ' + pad('상태', 12) + (j.note || STATE_LABEL[j.state]) + (!live.running ? ' — ' + live.reason : ''));
    if (s.help) { lines.push(''); lines.push('  ' + s.help); }
    return lines;
};

/**
 * 관문 확인. 문구(warn)는 표의 gateWarn 그대로다.
 *   - TTY 가 아니면 읽지 않고 거부한다. 통과가 아니다.
 *   - EOF(Ctrl-D)·틀린 입력은 거부.
 *   - 비대화형에서 확인 없이 통과시키는 명령줄 옵션을 두지 않는다.
 *
 * **cb 의 둘째 인자는 사유다.** EOF 는 `'eof'` — `runSet`/`runUnset` 처럼 "이 키
 * 하나만 취소" 로 충분한 호출부는 무시하면 그만이지만, `runEdit` 은 여러 키를
 * 한 번에 쥐고 있어 "이 키만 빼고 진행" 과 "Ctrl-C 니 전부 취소" 를 갈라야 한다.
 */
exports.confirmGate = function (key, warn, io, cb) {
    io.stdout.write('\n' + warn + '\n\n');
    if (!io.isTTY) {
        io.stdout.write('대화형 터미널이 아니라 확인을 받을 수 없다 — 거부한다. 파일을 건드리지 않았다.\n');
        return cb(false);
    }
    var rl = readline.createInterface({ input: io.stdin, output: io.stdout });
    var answered = false;
    rl.question('계속하려면 키 이름(' + key + ')을 그대로 입력: ', function (ans) {
        if (answered) { return; }
        answered = true;
        rl.close();
        cb(ans.trim() === key);
    });
    rl.on('close', function () {
        if (answered) { return; }
        answered = true;
        io.stdout.write('\n');
        cb(false, 'eof');
    });
};

function gate(key, deps, cb) {
    var d = deps.schema.describe()[key];
    if (!d || d.grade !== 'gate') { return cb(true); }
    exports.confirmGate(key, d.gateWarn, deps.io, cb);
}

function fail(lines) { return { ok: false, lines: lines }; }

// 기본으로 사용자 키만 안다. deps.all 이면 전부(7판과 같다). 스펙 §13.1.
function visible(deps, key) {
    var s = deps.schema.get(key);
    return !!s && (deps.all === true || s.tier === 'user');
}
function advanced_fail(key) {
    return fail(['고급 키다: ' + key + ' — conf.json 을 직접 고치거나 `npm run conf -- --all` 을 줄 것']);
}

/**
 * 문자열 답 하나를 coerce → store.validate 순서로 지난다(`set`과 `edit`이 같은 값을
 * 저장한다는 계약의 근거). 실패해도 어느 단계인지(`stage`)만 돌려준다 — 실패했을 때
 * 반응(즉시 실패 반환 vs 같은 항목 재질문)과 문구 조립은 호출부마다 달라 여기서 정하지
 * 않는다.
 */
function applyAnswer(key, raw, deps) {
    var s = deps.schema.get(key);
    var c = exports.coerce(s.type, raw);
    if (!c.ok) { return { ok: false, stage: 'coerce', reason: c.reason }; }
    var why = deps.store.validate(key, c.value);          // exposed / readOnly / 유효값 관문
    if (why) { return { ok: false, stage: 'validate', reason: why }; }
    return { ok: true, value: c.value };
}

exports.runSet = function (key, raw, deps, cb) {
    if (!fs.existsSync(deps.store.file)) {
        // 여기서 파일을 만들면 다음 기동에 첫 구동 마법사가 안 돌고, dbpass 가 비어 DB 연결에서
        // 실패한다 — 원인이 두 단계 멀어진다(스펙 §4.5.1 가). 읽기는 기본값으로 답하되 쓰기는 거부한다.
        return cb(null, fail(['conf.json 이 없다 — 먼저 터미널에서 `node mobius.js`(또는 `npm run setup`)로 만들 것 (' + deps.store.file + ')']));
    }
    if (deps.schema.get(key) && !visible(deps, key)) { return cb(null, advanced_fail(key)); }
    var s = deps.schema.get(key);
    if (!s) { return cb(null, fail(['모르는 키다: ' + key])); }
    if (raw === undefined) { return cb(null, fail(['값이 없다: set ' + key + ' <값>'])); }
    var a = applyAnswer(key, raw, deps);
    if (!a.ok) { return cb(null, fail([a.stage === 'coerce' ? (key + ': ' + a.reason) : a.reason])); }
    gate(key, deps, function (pass) {
        if (!pass) { return cb(null, fail(['취소했다 — 파일을 건드리지 않았다'])); }
        var patch = {};
        patch[key] = a.value;
        var r = deps.store.update(patch);
        if (!r.ok) { return cb(null, fail(r.errors)); }
        if (!r.changed.length) { return cb(null, { ok: true, lines: [key + ' 는 이미 그 값이다. 바꾼 것이 없다.'] }); }
        cb(null, { ok: true, lines: [
            key + ': ' + norm(r.changed[0].from) + ' → ' + norm(r.changed[0].to) + '  (' + deps.store.file + ')',
            '재기동해야 반영된다 — 파일 값은 기동 때 한 번 읽힌다.'
        ] });
    });
};

exports.runUnset = function (key, deps, cb) {
    if (!fs.existsSync(deps.store.file)) {
        // 여기서 파일을 만들면 다음 기동에 첫 구동 마법사가 안 돌고, dbpass 가 비어 DB 연결에서
        // 실패한다 — 원인이 두 단계 멀어진다(스펙 §4.5.1 가). 읽기는 기본값으로 답하되 쓰기는 거부한다.
        return cb(null, fail(['conf.json 이 없다 — 먼저 터미널에서 `node mobius.js`(또는 `npm run setup`)로 만들 것 (' + deps.store.file + ')']));
    }
    if (deps.schema.get(key) && !visible(deps, key)) { return cb(null, advanced_fail(key)); }
    var s = deps.schema.get(key);
    if (!s) { return cb(null, fail(['모르는 키다: ' + key])); }
    gate(key, deps, function (pass) {
        if (!pass) { return cb(null, fail(['취소했다 — 파일을 건드리지 않았다'])); }
        var r = deps.store.removeKey(key);
        if (!r.ok) { return cb(null, fail(r.errors)); }
        if (!r.changed.length) { return cb(null, { ok: true, lines: [key + ' 는 파일에 없다 — 이미 기본값(' + norm(s.dflt) + ')이다.'] }); }
        cb(null, { ok: true, lines: [
            key + ': ' + norm(r.changed[0].from) + ' → (기본값 ' + norm(s.dflt) + ')',
            '재기동해야 반영된다 — 파일 값은 기동 때 한 번 읽힌다.'
        ] });
    });
};

/**
 * 일괄 편집(스펙 §13.3). 첫 실행처럼 사용자 키를 카테고리 순서대로 묻는다(deps.all 이면 고급 키도).
 * Enter 는 그대로, 답은 set 과 같은 변환·검사, 관문 키는 바꿨을 때만 끝에 확인, 마지막에 한 번의
 * 원자적 쓰기. 비밀은 묻지 않고 읽기 전용은 보이고 건너뛴다. 비-TTY·EOF 는 아무것도 쓰지 않는다.
 */
exports.runEdit = function (deps, cb) {
    var io = deps.io, schema = deps.schema, conf = deps.conf;
    if (!io.isTTY) { return cb(null, fail(['대화형 터미널이 아니다 — edit 은 터미널에서만 된다. 개별 변경은 `set <키> <값>`.'])); }
    if (!fs.existsSync(deps.store.file)) {
        return cb(null, fail(['conf.json 이 없다 — 먼저 터미널에서 `node mobius.js`(또는 `npm run setup`)로 만들 것 (' + deps.store.file + ')']));
    }
    var rl = readline.createInterface({ input: io.stdin, output: io.stdout });
    var patch = {}, order = [], closing = false, eof = false, finished = false;
    rl.on('close', function () { if (!closing) { eof = true; finish(); } });

    var groups = grouped(schema).map(function (g) {
        return { group: g.group, keys: g.keys.filter(function (k) { return visible(deps, k) && schema.get(k).secret !== true; }) };
    }).filter(function (g) { return g.keys.length; });

    io.stdout.write('\n설정 편집 — Enter 는 그대로 두고, Ctrl-C 는 취소한다.' +
                    (deps.all ? ' (고급 키 포함)' : ' 사용자 키만 묻는다 — 고급 키는 --all.') + '\n');

    (function nextGroup(gi) {
        if (eof) { return; }
        if (gi >= groups.length) { closing = true; rl.close(); return finish(); }
        var grp = groups[gi];
        io.stdout.write('\n' + grp.group + '\n');
        (function nextKey(ki) {
            if (eof) { return; }
            if (ki >= grp.keys.length) { return nextGroup(gi + 1); }
            var k = grp.keys[ki], s = schema.get(k);
            var inFile = has(conf, k), cur = inFile ? conf[k] : s.dflt;
            if (s.readOnly) {
                io.stdout.write('  ' + pad(k, 20) + ' ' + pad(norm(cur), 30) + ' 읽기 전용 — 파일을 직접 고친다\n');
                return nextKey(ki + 1);
            }
            var choices = schema.choices(k);
            var hint = choices ? '(' + choices.join(' / ') + ')' : (s.type === 'array' ? '(쉼표로 구분)' : '');
            (function ask() {
                rl.question('  ' + pad(k, 20) + ' ' + pad(norm(cur) + (inFile ? '' : ' (기본값)'), 30) + ' ' + hint + ' > ', function (ans) {
                    var t = ans.trim();
                    if (t === '') { return nextKey(ki + 1); }
                    var a = applyAnswer(k, t, deps);
                    if (!a.ok) {
                        io.stdout.write('    ' + (a.stage === 'validate' && s.validHint ? s.validHint : a.reason) + '\n');
                        return ask();
                    }
                    // 파일에 없던 키라도 **타이핑해서** 답하면(기본값과 같은 값이어도) 파일에
                    // 들어간다 — Enter(위의 t==='' 분기)만 "그대로 둔다" 이고, 이건 "명시적으로
                    // 적은 것" 으로 본다(2차 검토 Minor 9). 위반은 아니고 의도다.
                    if (inFile && norm(a.value) === norm(cur)) { return nextKey(ki + 1); }
                    patch[k] = a.value;
                    if (order.indexOf(k) < 0) { order.push(k); }
                    nextKey(ki + 1);
                });
            })();
        })(0);
    })(0);

    function finish() {
        if (finished) { return; }
        finished = true;
        if (eof) { io.stdout.write('\n'); return cb(null, fail(['취소했다 — 파일을 건드리지 않았다'])); }
        if (!order.length) { return cb(null, { ok: true, lines: [NOTHING_CHANGED] }); }
        var desc = schema.describe();
        var gates = order.filter(function (k) { return desc[k] && desc[k].grade === 'gate'; });
        (function nextGate(i) {
            if (i >= gates.length) { return write(); }
            var k = gates[i];
            exports.confirmGate(k, desc[k].gateWarn, io, function (pass, why) {
                // Ctrl-C/EOF(사유 'eof')는 "이 키만 빼자" 가 아니라 "전부 취소" 다 — 편집은
                // 여러 키를 한 번에 쥐고 있어, 관문 경고를 보고 Ctrl-C 를 친 사용자의 뜻과
                // 반대로 나머지 키가 써지면 안 된다(2차 검토 Important 1). finished 가 이미
                // 참이므로 finish() 를 다시 타지 않고 여기서 바로 cb 한다.
                if (why === 'eof') { return cb(null, fail(['취소했다 — 파일을 건드리지 않았다'])); }
                if (!pass) {
                    delete patch[k];
                    order = order.filter(function (x) { return x !== k; });
                    io.stdout.write('  ' + k + ' 은 빼고 진행한다.\n');
                }
                nextGate(i + 1);
            });
        })(0);
        function write() {
            if (!order.length) { return cb(null, { ok: true, lines: [NOTHING_CHANGED] }); }
            var r = deps.store.update(patch);
            if (!r.ok) { return cb(null, fail(r.errors)); }
            var lines = r.changed.map(function (ch) { return ch.key + ': ' + norm(ch.from) + ' → ' + norm(ch.to); });
            lines.push('재기동해야 반영된다 — 파일 값은 기동 때 한 번 읽힌다.  (' + deps.store.file + ')');
            cb(null, { ok: true, lines: lines });
        }
    }
};

function pm2_line(master, list) {
    var notPm2 = master.supervised ? 'pm2 로 떴으나 지금 목록에서 찾지 못함' : 'pm2 로 뜬 것이 아니다';
    if (!Array.isArray(list)) { return notPm2; }
    // 이름이 아니라 pid 로 고른다 — 배포 데몬에 앱이 17개다. Mobius 는 fork_mode 라
    // pm2 가 보는 pid 가 곧 마스터 pid 다.
    var app = list.filter(function (a) { return a && a.pid === master.pid; })[0];
    if (!app) { return notPm2 + ' (목록에 이 pid 가 없다)'; }
    var env = app.pm2_env || {};
    return 'pm2 ' + (env.status || '?') + ' · 재시작 ' + (env.restart_time || 0) + '회 · 이름 ' + app.name;
}

exports.renderStatus = function (deps, cb) {
    var rec = deps.readRecord();
    var live = exports.liveness(rec, deps.alive);
    var lines = [];
    var warns = exports.warnings(rec);
    if (!live.running) {
        lines.push(pad('Mobius', 10) + ' 떠 있지 않다 — ' + live.reason);
        warns.forEach(function (w) { lines.push(pad('경고', 10) + ' ' + w); });
        return cb(null, lines);
    }
    var m = live.master;
    var port = (m.conf && m.conf.csebaseport) || '?';
    deps.probePort(port, function (open) {
        lines.push(pad('Mobius', 10) + ' 돌고 있다 · 마스터 pid ' + m.pid + ' 살아 있음 · 포트 ' + port +
                   (open ? ' 열림' : ' 닫힘 ⚠ 기동 중이거나 listen 에 실패했다'));
        lines.push(pad('기동', 10) + ' ' + fmt_at(m.at) + ' · 워커 ' + m.workers);
        deps.pm2List(function (list) {
            lines.push(pad('감독', 10) + ' ' + pm2_line(m, list));
            var pending = exports.pendingKeys(deps, m.conf);
            lines.push(pad('설정', 10) + ' ' + (pending.length ? '재기동 대기 ' + pending.length + '건  (' + pending.join(', ') + ')' : '재기동 대기 없음'));
            warns.forEach(function (w) { lines.push(pad('경고', 10) + ' ' + w); });
            cb(null, lines);
        });
    });
};

// admin/process_ctl.js 의 _portOpen 에서 가져왔다. 열려 있는가만 본다 — "돌고 있는가" 의
// 근거가 아니라 부가 정보다.
exports.probePort = function (port, cb) {
    if (!(Number(port) > 0)) { return cb(false); }
    var done = false;
    var sock = net.connect({ host: '127.0.0.1', port: Number(port) });
    function finish(v) {
        if (done) { return; }
        done = true;
        try { sock.destroy(); } catch (e) { /* 이미 닫혔다 */ }
        cb(v);
    }
    sock.on('connect', function () { finish(true); });
    sock.on('error', function () { finish(false); });
    sock.setTimeout(PROBE_TIMEOUT_MS, function () { finish(false); });
};

// pm2 jlist. 실패는 전부 null — "pm2 없음". 셸을 거치는 것은 Windows 의 pm2.cmd 때문이다.
exports.pm2List = function (cb) {
    var done = false;
    function finish(v) { if (done) { return; } done = true; cb(v); }
    try {
        cp.execFile('pm2', ['jlist'], { timeout: PM2_TIMEOUT_MS, shell: process.platform === 'win32', windowsHide: true },
            function (err, stdout) {
                if (err) { return finish(null); }
                try { finish(JSON.parse(String(stdout))); } catch (e) { finish(null); }
            });
    } catch (e) {
        finish(null);
    }
};

exports.main = function (args, deps, cb) {
    function out(lines) { deps.io.stdout.write(lines.join('\n') + '\n'); }
    var cmd = args[0];
    if (!cmd) { out(exports.renderList(deps)); return cb(null, 0); }
    if (cmd === 'status') {
        return exports.renderStatus(deps, function (err, lines) { out(lines); cb(null, 0); });
    }
    if (cmd === 'edit') {
        return exports.runEdit(deps, function (err, r) { out(r.lines); cb(null, r.ok ? 0 : 1); });
    }
    if (cmd === 'set') {
        return exports.runSet(args[1], args[2], deps, function (err, r) { out(r.lines); cb(null, r.ok ? 0 : 1); });
    }
    if (cmd === 'unset') {
        return exports.runUnset(args[1], deps, function (err, r) { out(r.lines); cb(null, r.ok ? 0 : 1); });
    }
    if (cmd === 'help' || cmd === '--help' || cmd === '-h') { out(USAGE); return cb(null, 0); }
    if (deps.schema.get(cmd)) {
        if (!visible(deps, cmd)) { out(advanced_fail(cmd).lines); return cb(null, 1); }
        out(exports.renderShow(cmd, deps)); return cb(null, 0);
    }
    out(['모르는 명령 또는 키다: ' + cmd, ''].concat(USAGE));
    cb(null, 2);
};

exports.USAGE = USAGE;
