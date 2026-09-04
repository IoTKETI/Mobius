'use strict';
// 부팅 기록(log/mobius-boot.jsonl)의 계약. **실제 파일을 쓴다** — 임시 디렉터리에.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const boot_record = require('../mobius/boot_record');
const conf_load = require('../mobius/conf_load');
const schema = require('../mobius/conf_schema');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'bootrec-')); }
function lines(file) { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); }
const MASTER = { file: null, role: 'master', pid: 100, workers: 2, supervised: false, confPath: '/x/conf.json' };

test('C7 마스터가 비우고 워커가 append 한다 — 마스터 줄이 남는다', function () {
    const file = path.join(tmpDir(), 'log', 'mobius-boot.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"role":"worker","pid":1}\n{"role":"capped"}\n');   // 지난 판의 찌꺼기

    assert.strictEqual(boot_record.write({ csebaseport: '7579', superUser: 'Sponde' }, Object.assign({}, MASTER, { file })), true);
    let rec = boot_record.read(file);
    assert.strictEqual(rec.lines, 1, '마스터가 파일을 비우지 않았다');
    assert.strictEqual(rec.master.pid, 100);
    assert.strictEqual(rec.master.workers, 2);
    assert.strictEqual(rec.master.supervised, false);
    assert.strictEqual(rec.master.confPath, '/x/conf.json');
    assert.strictEqual(typeof rec.master.cap, 'number');
    assert.strictEqual(rec.master.conf.csebaseport, '7579');
    assert.ok(!('superUser' in rec.master.conf), '비밀 키가 기록에 들어갔다');
    assert.strictEqual(rec.capped, null);

    assert.strictEqual(boot_record.write({ csebaseport: '7579' }, { file, role: 'worker', pid: 101 }), true);
    assert.strictEqual(boot_record.write({ csebaseport: '7579' }, { file, role: 'worker', pid: 102 }), true);
    rec = boot_record.read(file);
    assert.strictEqual(rec.workers.length, 2);
    assert.strictEqual(rec.master.pid, 100, '워커가 마스터 줄을 지웠다');
    assert.deepStrictEqual(rec.workers.map((w) => w.pid), [101, 102]);
});

test('C7 값은 실제 전역 값이다 — conf_load 의 applied 를 그대로 싣는다', function (t, done) {
    const dir = tmpDir();
    const conf = path.join(dir, 'conf.json');
    fs.writeFileSync(conf, JSON.stringify({ csebaseport: '7581', dbConnectionLimit: 30, dbpass: 'secret!' }), 'utf8');
    conf_load({ file: conf }, function (err, applied) {
        assert.ifError(err);
        const file = path.join(dir, 'log', 'b.jsonl');
        boot_record.write(applied, Object.assign({}, MASTER, { file }));
        const rec = boot_record.read(file);
        assert.strictEqual(rec.master.conf.csebaseport, global.usecsebaseport);
        assert.strictEqual(rec.master.conf.dbConnectionLimit, 30);
        assert.ok(!/secret!/.test(fs.readFileSync(file, 'utf8')), 'dbpass 가 기록에 새어 나갔다');
        done();
    });
});

test('C7 새 비밀 키가 생겨도 자동으로 빠진다 — 표를 훑지 목록을 들지 않는다', function () {
    const file = path.join(tmpDir(), 'b.jsonl');
    // 실물 표에 키 하나를 비밀로 덧댄 것. 나머지는 실물에 위임한다.
    const extended = { get: (k) => (k === 'brandNewSecret' ? { secret: true } : schema.get(k)) };
    boot_record.write({ csebaseport: '7579', brandNewSecret: 'hide-me' }, Object.assign({}, MASTER, { file, schema: extended }));
    const rec = boot_record.read(file);
    assert.ok(!('brandNewSecret' in rec.master.conf));
    assert.ok(!/hide-me/.test(fs.readFileSync(file, 'utf8')));
    assert.strictEqual(rec.master.conf.csebaseport, '7579');
});

test('C7 supervised 는 pm_id 유무다', function () {
    const file = path.join(tmpDir(), 'b.jsonl');
    boot_record.write({}, Object.assign({}, MASTER, { file, supervised: true }));
    assert.strictEqual(boot_record.read(file).master.supervised, true);
});

test('C7 log/ 를 만들 수도 쓸 수도 없을 때 던지지 않는다 — 기동을 막지 않는다', function () {
    // 디렉터리 자리에 **파일**을 둔다. mkdir 도 open 도 실패한다.
    const blocker = path.join(tmpDir(), 'log');
    fs.writeFileSync(blocker, 'not a dir', 'utf8');
    const file = path.join(blocker, 'mobius-boot.jsonl');
    let r;
    assert.doesNotThrow(function () { r = boot_record.write({ csebaseport: '7579' }, Object.assign({}, MASTER, { file })); });
    assert.strictEqual(r, false);
    assert.doesNotThrow(function () { r = boot_record.write({ csebaseport: '7579' }, { file, role: 'worker', pid: 5 }); });
    assert.strictEqual(r, false);
});

test('C7 log/ 가 없으면 만든다 — 새로 설치한 서버의 첫 기동', function () {
    const file = path.join(tmpDir(), 'log', 'deep', 'mobius-boot.jsonl');
    assert.strictEqual(boot_record.write({}, Object.assign({}, MASTER, { file })), true);
    assert.ok(fs.existsSync(file));
});

test('C8 상한 — 끝에 capped 한 줄만 덧붙고 마스터 줄이 남는다. 이미 있으면 더 안 쓴다', function () {
    const file = path.join(tmpDir(), 'b.jsonl');
    boot_record.write({}, Object.assign({}, MASTER, { file, workers: 1 }));
    const cap = boot_record.read(file).master.cap;
    assert.ok(cap >= 4, 'cap 이 너무 작다: ' + cap);
    // 상한 직전까지 채운다 (마스터 1줄 포함)
    for (let i = 1; i < cap; i++) {
        assert.strictEqual(boot_record.write({}, { file, role: 'worker', pid: 1000 + i }), true, i + '번째 워커가 못 썼다');
    }
    assert.strictEqual(lines(file).length, cap);
    // 상한에 닿은 워커: 자기 줄 대신 capped 를 덧붙인다
    assert.strictEqual(boot_record.write({}, { file, role: 'worker', pid: 9001 }), false);
    let rec = boot_record.read(file);
    assert.ok(rec.capped, 'capped 줄이 없다');
    assert.strictEqual(rec.capped.pid, 9001);
    assert.strictEqual(lines(file).length, cap + 1);
    assert.strictEqual(rec.master.pid, 100, '마스터 줄이 사라졌다 — 값 대조가 전 키에서 불가능해진다');
    // 이미 capped 가 있으면 아무도 더 쓰지 않는다
    assert.strictEqual(boot_record.write({}, { file, role: 'worker', pid: 9002 }), false);
    assert.strictEqual(lines(file).length, cap + 1);
    assert.strictEqual(JSON.parse(lines(file)[cap]).role, 'capped', 'capped 가 끝 줄이 아니다');
});

test('read 는 깨진 줄을 버리고 나머지로 답한다', function () {
    const file = path.join(tmpDir(), 'b.jsonl');
    fs.writeFileSync(file, '{"role":"master","pid":7,"at":"x","conf":{}}\n{broken\n{"role":"worker","pid":8}\n', 'utf8');
    const rec = boot_record.read(file);
    assert.strictEqual(rec.master.pid, 7);
    assert.strictEqual(rec.workers.length, 1);
    assert.strictEqual(rec.broken, 1);
    assert.strictEqual(boot_record.read(path.join(tmpDir(), 'none.jsonl')), null);
});

test('기본 경로는 저장소 루트의 log/ 다', function () {
    assert.strictEqual(boot_record.DEFAULT_FILE, path.join(ROOT, 'log', 'mobius-boot.jsonl'));
});

test('mobius.js 가 conf_load 뒤, require(app) 앞에 기록을 쓴다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'mobius.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const w = src.indexOf('boot_record.write(');
    const a = src.indexOf("require('./app')");
    assert.ok(w > 0 && a > 0 && w < a, '기록 쓰기가 require(app) 앞에 없다');
});
