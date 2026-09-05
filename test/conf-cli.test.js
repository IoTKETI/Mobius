'use strict';
// conf CLI 의 계약 (L1~L7 + C4 의 CLI 쪽). 논리는 tools/conf_cli.js, 진입점은 tools/mobius-conf.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const ROOT = path.join(__dirname, '..');
const schema = require('../mobius/conf_schema');
const { ConfStore } = require('../tools/conf_store');
const cli = require('../tools/conf_cli');

function tmpConf(obj) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'confcli-'));
    const file = path.join(dir, 'conf.json');
    if (obj !== null) { fs.writeFileSync(file, JSON.stringify(obj, null, 4), 'utf8'); }
    return file;
}
function readConf(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// 실물처럼 구는 deps. 기록·생존·포트·pm2 는 시험이 정한다.
function deps(opts) {
    opts = opts || {};
    const file = opts.file || tmpConf(opts.conf || {});
    const conf = fs.existsSync(file) ? readConf(file) : {};
    const out = new PassThrough();
    let captured = '';
    out.on('data', (c) => { captured += String(c); });
    return {
        schema, store: new ConfStore(file), conf, file,
        readRecord: () => (opts.record === undefined ? null : opts.record),
        alive: (pid) => !!opts.alive,
        probePort: (port, cb) => cb(!!opts.portOpen),
        pm2List: (cb) => cb(opts.pm2 === undefined ? null : opts.pm2),
        io: { stdin: opts.stdin || new PassThrough(), stdout: out, isTTY: !!opts.isTTY },
        all: !!opts.all,
        output: () => captured
    };
}
const ALIVE_REC = (conf) => ({ master: { role: 'master', pid: process.pid, at: '2026-09-04T04:15:00.000Z', supervised: false, cap: 16, workers: 2, conf }, workers: [], capped: null, lines: 1, broken: 0 });

test('C4 argv[2] 는 하위 명령이다 — 백엔드로 읽지 않는다. 강제는 --db=', function () {
    assert.strictEqual(cli.resolveBackend(['status'], { db: 'sqlite' }), 'sqlite');
    assert.strictEqual(cli.resolveBackend(['set', 'mqttPort', '1884'], { db: 'sqlite' }), 'sqlite');
    assert.strictEqual(cli.resolveBackend([], {}), 'mysql');
    assert.strictEqual(cli.resolveBackend(['--db=sqlite', 'status'], { db: 'mysql' }), 'sqlite');
});

test('C4 진입점이 그 순서를 지킨다 — 소스 검사', function () {
    const src = fs.readFileSync(path.join(ROOT, 'tools', 'mobius-conf.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const usedb = src.indexOf('global.usedb =');
    const schemaReq = src.search(/require\([^)]*conf_schema/);
    const storeReq = src.search(/require\([^)]*conf_store/);
    assert.ok(usedb > 0 && schemaReq > usedb && storeReq > usedb, 'global.usedb 를 세우기 전에 표나 store 를 require 한다');
    assert.ok(!/process\.argv\[2\]/.test(src), '진입점이 argv[2] 를 읽는다');
});

test('L3 타입 변환 — number 는 수 모양만, array 는 쉼표, 빈 배열', function () {
    assert.deepStrictEqual(cli.coerce('number', '25'), { ok: true, value: 25 });
    assert.deepStrictEqual(cli.coerce('number', '-1.5'), { ok: true, value: -1.5 });
    assert.strictEqual(cli.coerce('number', '').ok, false, "Number('')===0 — dbQueueLimit 의 0 은 무제한 대기열이다");
    assert.strictEqual(cli.coerce('number', '20MB').ok, false);
    assert.deepStrictEqual(cli.coerce('array', 'a, b ,c'), { ok: true, value: ['a', 'b', 'c'] });
    assert.deepStrictEqual(cli.coerce('array', ''), { ok: true, value: [] });
    assert.deepStrictEqual(cli.coerce('enum', 'observe'), { ok: true, value: 'observe' });
    assert.deepStrictEqual(cli.coerce('string', ' x '), { ok: true, value: ' x ' });
});

test('L1 판정 — 마스터 pid 가 죽은 기록은 포트가 열려 있어도 적용됨이 아니다', function () {
    const rec = ALIVE_REC({ csebaseport: '7579' });
    const live = cli.liveness(rec, () => false);
    assert.strictEqual(live.running, false);
    assert.match(live.reason, /pid/);
    const j = cli.judge(schema, 'csebaseport', { csebaseport: '7579' }, live.running, null);
    assert.strictEqual(j.state, 'unknown', '값 대조를 아예 하지 말아야 한다');
});

test('L1 판정 — 마스터 pid 가 살아 있으면 포트가 닫혀 있어도 모름이 아니다', function () {
    const rec = ALIVE_REC({ csebaseport: '7579', dbConnectionLimit: 100 });
    const live = cli.liveness(rec, () => true);
    assert.strictEqual(live.running, true);
    assert.strictEqual(cli.judge(schema, 'csebaseport', { csebaseport: '7579' }, true, rec.master.conf).state, 'applied');
    const p = cli.judge(schema, 'dbConnectionLimit', { dbConnectionLimit: 25 }, true, rec.master.conf);
    assert.strictEqual(p.state, 'pending');
    assert.match(p.note, /25.*100/);
    // 파일에 없으면 기본값이 파일 값이다
    assert.strictEqual(cli.judge(schema, 'dbQueueLimit', {}, true, Object.assign({ dbQueueLimit: 50 }, rec.master.conf)).state, 'applied');
});

test('L1 판정 — 콘솔 키는 대조 대상 아님. 기록이 없으면 모름', function () {
    const rec = ALIVE_REC({ csebaseport: '7579' });
    assert.strictEqual(cli.judge(schema, 'adminPort', { adminPort: 7580 }, true, rec.master.conf).state, 'na');
    assert.strictEqual(cli.liveness(null, () => true).running, false);
});

test('L2 비교는 정규화한다 — 객체가 든 배열, 숫자/문자열', function () {
    const record = { retentionPolicies: [{ match: 'contains', value: '/x', mni: '10' }], csebaseport: '7579', allowedAeIds: ['a'] };
    assert.strictEqual(cli.judge(schema, 'retentionPolicies', { retentionPolicies: [{ match: 'contains', value: '/x', mni: '10' }] }, true, record).state, 'applied');
    assert.strictEqual(cli.judge(schema, 'allowedAeIds', { allowedAeIds: ['a'] }, true, record).state, 'applied');
    assert.strictEqual(cli.judge(schema, 'allowedAeIds', { allowedAeIds: ['b'] }, true, record).state, 'pending');
    assert.strictEqual(cli.judge(schema, 'dbConnectionLimit', { dbConnectionLimit: 25 }, true, { dbConnectionLimit: 25 }).state, 'applied');
    // 문자열 타입 키에 숫자를 적은 파일은 checkValue 가 먼저 잡는다 — 재기동 대기가 아니라 "유효하지 않다"
    assert.strictEqual(cli.judge(schema, 'csebaseport', { csebaseport: 7579 }, true, record).state, 'invalid');
});

test('L2 mqttPort 는 useSecure=enable 이면 유도됨 — 문구가 표(derivedFrom)에서 온다', function () {
    const record = { useSecure: 'enable', mqttPort: '8883' };
    const j = cli.judge(schema, 'mqttPort', { mqttPort: '1883' }, true, record);
    assert.strictEqual(j.state, 'derived');
    assert.match(j.note, /useSecure=enable/);
    assert.match(j.note, /1883/);
    assert.strictEqual(cli.judge(schema, 'mqttPort', { mqttPort: '1883' }, true, { useSecure: 'disable', mqttPort: '1884' }).state, 'pending');
});

test('L2 파일 값이 유효하지 않으면 재기동 대기가 아니라 "유효하지 않다" 다', function () {
    const record = { acpiAttachPolicy: 'open' };
    const j = cli.judge(schema, 'acpiAttachPolicy', { acpiAttachPolicy: 'anyone' }, true, record);
    assert.strictEqual(j.state, 'invalid');
    assert.match(j.note, /set/);
});

// 고급 키를 쓰므로 --all (가시성은 T2·T3 가 본다) — 안 그러면 고급 키 관문이 먼저 잡아 검사 이유가 바뀐다
test('L4 set 은 validate() 를 지난다 — 모르는 키·읽기 전용·유효값 밖·exposed:false', function (t, done) {
    const d = deps({ conf: { dbpass: 'x', retentionPolicies: [] }, all: true });
    const cases = [['noSuchKey', 'x'], ['retentionPolicies', 'a'], ['acpObserveMode', 'sometimes'], ['dbpass', 'y'], ['dbConnectionLimit', '0'], ['dbConnectionLimit', '20MB']];
    (function next(i) {
        if (i >= cases.length) {
            assert.deepStrictEqual(readConf(d.file), { dbpass: 'x', retentionPolicies: [] }, '거절됐는데 파일이 바뀌었다');
            return done();
        }
        cli.runSet(cases[i][0], cases[i][1], d, function (err, r) {
            assert.ifError(err);
            assert.strictEqual(r.ok, false, cases[i].join(' ') + ' 가 통과했다');
            next(i + 1);
        });
    })(0);
});

// 고급 키를 쓰므로 --all (가시성은 T2·T3 가 본다)
test('L4 set 이 통과하면 원자적으로 쓰고 재기동 안내를 한다 — number·array 변환 포함', function (t, done) {
    const d = deps({ conf: {}, all: true });
    cli.runSet('dbConnectionLimit', '30', d, function (err, r) {
        assert.ifError(err);
        assert.strictEqual(r.ok, true, r.lines.join(' '));
        assert.strictEqual(readConf(d.file).dbConnectionLimit, 30);
        assert.ok(r.lines.some((l) => /재기동/.test(l)), '재기동 안내가 없다');
        cli.runSet('acpObserveMode', 'observe', d, function (err2, r2) {
            assert.strictEqual(r2.ok, true);
            assert.strictEqual(readConf(d.file).acpObserveMode, 'observe');
            assert.ok(!fs.readdirSync(path.dirname(d.file)).some((f) => /\.tmp$/.test(f)), '임시 파일이 남았다');
            done();
        });
    });
});

// 고급 키를 쓰므로 --all (가시성은 T2·T3 가 본다)
test('L5 unset 이 관문을 지난다 — unset dbpass 는 거부', function (t, done) {
    const d = deps({ conf: { dbpass: 'x', acpObserveMode: 'observe' }, all: true });
    cli.runUnset('dbpass', d, function (err, r) {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(readConf(d.file).dbpass, 'x');
        cli.runUnset('acpObserveMode', d, function (err2, r2) {
            assert.strictEqual(r2.ok, true);
            assert.ok(!('acpObserveMode' in readConf(d.file)));
            done();
        });
    });
});

test('set/unset 은 conf.json 이 없으면 거부한다 — 부분 파일을 만들면 첫 구동 마법사가 안 돈다', function (t, done) {
    const d = deps({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'confcli-')), 'conf.json') });
    cli.runSet('dbConnectionLimit', '30', d, function (err, r) {
        assert.strictEqual(r.ok, false);
        assert.match(r.lines.join(' '), /npm run setup/);
        assert.strictEqual(fs.existsSync(d.file), false, '파일이 생겼다');
        cli.runUnset('acpObserveMode', d, function (err2, r2) {
            assert.strictEqual(r2.ok, false);
            assert.strictEqual(fs.existsSync(d.file), false);
            done();
        });
    });
});

test('L6 관문 — TTY 가 아니면 읽지도 않고 거부, 파일을 안 건드린다', function (t, done) {
    const d = deps({ conf: { cseBase: 'Mobius' }, isTTY: false });
    cli.runSet('cseBase', 'Vita', d, function (err, r) {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(readConf(d.file).cseBase, 'Mobius');
        assert.ok(d.output().indexOf(schema.get('cseBase').gateWarn) >= 0, '경고 문구가 표의 gateWarn 그대로가 아니다');
        done();
    });
});

test('L6 관문 — EOF 는 거부. 키 이름을 정확히 치면 통과', function (t, done) {
    const eof = new PassThrough();
    const d1 = deps({ conf: {}, isTTY: true, stdin: eof });
    setImmediate(() => eof.end());   // 아무것도 안 치고 Ctrl-D
    cli.runSet('cseBase', 'Vita', d1, function (err, r) {
        assert.strictEqual(r.ok, false, 'EOF 가 통과했다');
        assert.ok(!('cseBase' in readConf(d1.file)));

        const wrong = new PassThrough();
        const d2 = deps({ conf: {}, isTTY: true, stdin: wrong });
        setImmediate(() => wrong.end('csebase\n'));   // 대소문자가 다르다
        cli.runSet('cseBase', 'Vita', d2, function (err2, r2) {
            assert.strictEqual(r2.ok, false, '틀린 입력이 통과했다');

            const right = new PassThrough();
            const d3 = deps({ conf: {}, isTTY: true, stdin: right });
            setImmediate(() => right.end('cseBase\n'));
            cli.runSet('cseBase', 'Vita', d3, function (err3, r3) {
                assert.strictEqual(r3.ok, true, r3.lines.join(' '));
                assert.strictEqual(readConf(d3.file).cseBase, 'Vita');
                done();
            });
        });
    });
});

test('L6 CLI 에 키별 관문 문구가 없다 — 전부 표에서 온다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'tools', 'conf_cli.js'), 'utf8');
    schema.all().filter((k) => schema.get(k).grade === 'gate').forEach((k) => {
        const firstLine = schema.get(k).gateWarn.split('\n')[0];
        assert.ok(src.indexOf(firstLine) < 0, k + ' 의 관문 문구가 CLI 에 박혀 있다: ' + firstLine);
    });
    assert.ok(!/gateWarn\s*[:=]\s*['"]/.test(src), 'CLI 가 gateWarn 을 직접 만든다');
    assert.ok(!/--yes/.test(src), '비대화형 통과 수단이 있다');
});

test('L7 status 는 pm2 없이도 동작한다 — 감독 줄의 문구만 바뀐다', function (t, done) {
    const rec = ALIVE_REC({ csebaseport: '7579' });
    cli.renderStatus(deps({ record: rec, alive: true, portOpen: true, pm2: null }), function (err, lines) {
        assert.ifError(err);
        const txt = lines.join('\n');
        assert.match(txt, /돌고 있다/);
        assert.match(txt, /pid \d+ 살아 있음/);
        assert.match(txt, /포트 7579 열림/);
        assert.match(txt, /워커 2/);
        assert.match(txt, /pm2 로 뜬 것이 아니다/);
        rec.master.supervised = true;
        cli.renderStatus(deps({ record: rec, alive: true, portOpen: false, pm2: null }), function (err2, lines2) {
            const t2 = lines2.join('\n');
            assert.match(t2, /pm2 로 떴으나 지금 목록에서 찾지 못함/);
            assert.match(t2, /포트 7579 닫힘/);
            done();
        });
    });
});

test('L7 pm2 앱은 이름이 아니라 pid 로 고른다', function (t, done) {
    const rec = ALIVE_REC({ csebaseport: '7579' });
    const list = [
        { pid: 1, name: 'Mobius', pm2_env: { status: 'online', restart_time: 99 } },     // 이름은 같지만 다른 프로세스
        { pid: process.pid, name: 'svc-7', pm2_env: { status: 'online', restart_time: 13 } }
    ];
    cli.renderStatus(deps({ record: rec, alive: true, portOpen: true, pm2: list }), function (err, lines) {
        const txt = lines.join('\n');
        assert.match(txt, /재시작 13회/);
        assert.match(txt, /svc-7/);
        assert.doesNotMatch(txt, /99회/);
        done();
    });
});

test('L7 떠 있지 않으면 마지막 기동과 pid 를 말한다. capped 는 좀비 의심', function (t, done) {
    const rec = ALIVE_REC({ csebaseport: '7579' });
    rec.master.pid = 999999;
    rec.capped = { role: 'capped', at: 'x', pid: 5 };
    cli.renderStatus(deps({ record: rec, alive: false }), function (err, lines) {
        const txt = lines.join('\n');
        assert.match(txt, /떠 있지 않다/);
        assert.match(txt, /2026-09-04 04:15/);
        assert.match(txt, /999999/);
        assert.match(txt, /좀비 의심/);
        done();
    });
});

// 고급 키를 쓰므로 --all (가시성은 T2·T3 가 본다)
test('목록 — 그룹별 · 3상태 · 비밀은 존재 여부만 · 재기동 대기 건수', function () {
    const rec = ALIVE_REC({ csebaseport: '7579', dbConnectionLimit: 100 });
    const d = deps({ conf: { csebaseport: '7579', dbConnectionLimit: 25, dbpass: 'p4ss', adminPort: 7580 }, record: rec, alive: true, all: true });
    const txt = cli.renderList(d).join('\n');
    assert.match(txt, /CSE 신원/); assert.match(txt, /네트워크/); assert.match(txt, /콘솔/);
    assert.match(txt, /csebaseport\s+7579\s+적용됨/);
    assert.match(txt, /dbConnectionLimit\s+25\s+● 재기동 대기/);
    assert.match(txt, /adminPort\s+7580\s+대조 대상 아님/);
    assert.match(txt, /dbpass\s+설정됨/);
    assert.match(txt, /superUser\s+없음/);
    assert.ok(txt.indexOf('p4ss') < 0, '비밀 값이 나갔다');
    assert.match(txt, /재기동 대기 1건/);
    assert.match(txt, /cseBase[^\n]*⚠ 관문/);
});

// 고급 키를 쓰므로 --all (가시성은 T2·T3 가 본다)
test('목록 — 떠 있지 않으면 모름이고 값 대조를 안 한다', function () {
    const d = deps({ conf: { dbConnectionLimit: 25 }, record: null, all: true });
    const txt = cli.renderList(d).join('\n');
    assert.match(txt, /dbConnectionLimit\s+25\s+모름/);
    assert.match(txt, /모름 — /);
    assert.doesNotMatch(txt, /재기동 대기 \d+건/);
});

test('목록 — 표에 없는 키를 경고한다 (죽은 키·오타)', function () {
    const d = deps({ conf: { usesqlite: 'false', cntManPort: '7599', acpObserveMode: 'off' }, record: null });
    const txt = cli.renderList(d).join('\n');
    assert.match(txt, /표에 없는 키[^\n]*usesqlite/);
    assert.match(txt, /표에 없는 키[^\n]*cntManPort/);
    assert.doesNotMatch(txt, /표에 없는 키[^\n]*acpObserveMode/);
});

// 고급 키를 쓰므로 --all (가시성은 T2·T3 가 본다)
test('단건 — 표가 가진 것을 다 보여 준다', function () {
    const d = deps({ conf: { acpObserveMode: 'observe' }, record: null, all: true });
    const txt = cli.renderShow('acpObserveMode', d).join('\n');
    assert.match(txt, /acpObserveMode/); assert.match(txt, /off \/ observe/); assert.match(txt, /reload/);
    assert.match(txt, /acp_observe\.configure/);
    assert.match(txt, /파일 값\s+observe/);
});

test('main 은 명령을 가른다 — 모르는 명령은 2, 실패한 set 은 1', function (t, done) {
    const d = deps({ conf: {} });
    cli.main(['bogus'], d, function (err, code) {
        assert.strictEqual(code, 2);
        cli.main(['set', 'noSuchKey', 'x'], d, function (err2, code2) {
            assert.strictEqual(code2, 1);
            cli.main([], d, function (err3, code3) {
                assert.strictEqual(code3, 0);
                assert.match(d.output(), /비밀 — 값을 띄우지 않는다/);
                done();
            });
        });
    });
});

test('probePort 는 실제 소켓으로 본다', function (t, done) {
    const net = require('node:net');
    const srv = net.createServer();
    srv.listen({ port: 0, host: '127.0.0.1' }, function () {
        const port = srv.address().port;
        cli.probePort(port, function (open) {
            assert.strictEqual(open, true);
            srv.close(function () {
                cli.probePort(port, function (open2) { assert.strictEqual(open2, false); done(); });
            });
        });
    });
});

test('npm 스크립트 — conf·status 가 있고 start 는 그대로', function () {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.scripts.start, 'node mobius.js');
    assert.strictEqual(pkg.scripts.conf, 'node tools/mobius-conf.js');
    assert.strictEqual(pkg.scripts.status, 'node tools/mobius-conf.js status');
    assert.ok(!pkg.dependencies || !pkg.dependencies.pm2, 'pm2 가 의존성에 있다');
});

// --- 2026-09-05 사용자 키 / 고급 키 — --all (스펙 §13.1) ----------------------

test('T3 목록은 기본으로 사용자 키만 보이고 고급 키 개수를 말한다; --all 이면 전부', function () {
    const d = deps({ conf: { dbConnectionLimit: 25, cseBase: 'Vita' }, record: null });
    const txt = cli.renderList(d).join('\n');
    assert.match(txt, /cseBase\s+Vita/);
    assert.doesNotMatch(txt, /dbConnectionLimit/);
    assert.doesNotMatch(txt, /adminPassword/);
    assert.match(txt, /고급 키 \d+개는 숨겼다[^\n]*--all/);
    const all = cli.renderList(deps({ conf: { dbConnectionLimit: 25 }, record: null, all: true })).join('\n');
    assert.match(all, /dbConnectionLimit\s+25/);
    assert.match(all, /adminPassword/);
    assert.doesNotMatch(all, /숨겼다/);
});
test('T2 고급 키는 --all 없이 set/unset/단건이 거부되고 파일이 안 바뀐다; --all 이면 된다', function (t, done) {
    const d = deps({ conf: { dbConnectionLimit: 25 } });
    cli.runSet('dbConnectionLimit', '30', d, function (err, r) {
        assert.strictEqual(r.ok, false);
        assert.match(r.lines.join(' '), /고급 키[^\n]*--all/);
        assert.strictEqual(readConf(d.file).dbConnectionLimit, 25);
        cli.runUnset('dbConnectionLimit', d, function (err2, r2) {
            assert.strictEqual(r2.ok, false);
            assert.strictEqual(readConf(d.file).dbConnectionLimit, 25);
            assert.match(cli.renderShow('dbConnectionLimit', d).join('\n'), /고급 키/);
            const a = deps({ file: d.file, all: true });
            cli.runSet('dbConnectionLimit', '30', a, function (err3, r3) {
                assert.strictEqual(r3.ok, true, r3.lines.join(' '));
                assert.strictEqual(readConf(d.file).dbConnectionLimit, 30);
                // 사용자 키는 --all 없이도 된다 — 관문 키라 비-TTY 에서 거부되지만 사유가 "고급 키" 여서는 안 된다
                cli.runSet('cseId', '/Vita1', deps({ file: d.file }), function (err4, r4) {
                    assert.strictEqual(r4.ok, false);
                    assert.doesNotMatch(r4.lines.join(' '), /고급 키/);
                    done();
                });
            });
        });
    });
});
test('T2 진입점이 --all 을 deps 로 넘기고 args 에서 뺀다 — 소스 검사', function () {
    const src = fs.readFileSync(path.join(ROOT, 'tools', 'mobius-conf.js'), 'utf8');
    assert.match(src, /all:\s*argv\.indexOf\('--all'\)\s*>=\s*0/);
    assert.match(src, /a !== '--all'/);
});
test('T2 main — 고급 키 단건 조회는 --all 없이 1 로 끝나고, --all 이면 0', function (t, done) {
    const d = deps({ conf: {}, record: null });
    cli.main(['dbConnectionLimit'], d, function (err, code) {
        assert.strictEqual(code, 1);
        assert.match(d.output(), /고급 키다/);
        const a = deps({ conf: {}, record: null, all: true });
        cli.main(['dbConnectionLimit'], a, function (err2, code2) {
            assert.strictEqual(code2, 0);
            assert.match(a.output(), /dbConnectionLimit  —/);
            done();
        });
    });
});
