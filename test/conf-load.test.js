'use strict';
// conf.json 을 읽어 전역을 세우는 코어 모듈의 계약.
//
// 이 시험이 성립하려면 conf 로딩이 mobius.js 밖에 있어야 한다 — 그 파일은
// 마지막 줄이 require('./app') 이라 로드만으로 DB 에 붙고 fork 하고 포트를 연다.
//
// **cwd 를 바꾸지 않는다.** 저장소 루트에는 실제 conf.json 이 있다. 시험은
// 임시 디렉터리의 파일을 opts.file 로 넘긴다. 저장소 루트의 conf.json 을 읽으면
// 이 시험은 거짓말을 한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const conf_load = require('../mobius/conf_load');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'confload-')); }
function tmpConf(text) {
    const file = path.join(tmpDir(), 'conf.json');
    if (text !== null) { fs.writeFileSync(file, text, 'utf8'); }
    return file;
}
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('C1 빈 conf.json 으로도 지금 동작이 그대로다', function (t, done) {
    const file = tmpConf('{}');
    conf_load({ file: file }, function (err, applied) {
        assert.ifError(err);
        // 이 값들이 mobius.js 상단에 박혀 있던 것이다. 2단계에서 conf 키가 되어도
        // 기본값은 이 값이어야 한다 — 배포 conf.json 에 아무것도 안 넣어도 동작이
        // 그대로여야 하므로.
        assert.strictEqual(global.usecsebase, 'Mobius');
        assert.strictEqual(global.usecseid, '/Mobius2');
        assert.strictEqual(global.use_mqtt_broker, 'localhost');
        assert.strictEqual(global.use_secure, 'disable');
        assert.strictEqual(global.use_mqtt_port, '1883');
        assert.strictEqual(global.uservi, '2a');
        assert.deepStrictEqual(global.allowed_ae_ids, []);
        assert.deepStrictEqual(global.allowed_app_ids, []);
        assert.strictEqual(global.usesuperuser, 'Sponde');
        assert.strictEqual(global.usecsebaseport, '7579');
        assert.strictEqual(global.use_db_connection_limit, 25);
        assert.strictEqual(global.use_db_queue_limit, 50);
        assert.strictEqual(global.acp_observe_mode, 'off');
        assert.strictEqual(global.useaccesscontrolpolicy, 'disable');
        // applied 는 코어가 전역을 세운 키만 담는다
        assert.strictEqual(applied.csebaseport, '7579');
        assert.strictEqual(applied.dbConnectionLimit, 25);
        assert.strictEqual(applied.acpDenyLog, 'sample');
        assert.strictEqual(applied.acpDenyLogRate, 5);
        assert.ok(!('dbpass' in applied), '어댑터 키가 applied 에 들어갔다');
        done();
    });
});

test('C1 파일 값이 전역과 applied 에 같이 실린다', function (t, done) {
    const file = tmpConf(JSON.stringify({ csebaseport: '7580', dbConnectionLimit: 40, acpObserveMode: 'observe' }));
    conf_load({ file: file }, function (err, applied) {
        assert.ifError(err);
        assert.strictEqual(global.usecsebaseport, '7580');
        assert.strictEqual(applied.csebaseport, '7580');
        assert.strictEqual(global.use_db_connection_limit, 40);
        assert.strictEqual(applied.dbConnectionLimit, 40);
        assert.strictEqual(applied.acpObserveMode, 'observe');
        done();
    });
});

test('C11 깨진 conf.json 을 덮어쓰지도 종료하지도 않는다', function (t, done) {
    const broken = '{"csebaseport": "7580", "dbpass": "abc"';   // 반쪽 파일
    const file = tmpConf(broken);
    conf_load({ file: file }, function (err) {
        assert.ifError(err);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), broken, '파일이 바뀌었다 — 읽기 실패를 쓰기로 갚으면 안 된다');
        assert.strictEqual(global.usecsebaseport, '7579', '기본값으로 진행하지 않았다');
        done();
    });
});

test('opts.file 이 가리키는 파일이 없으면 만들지 않고 오류다', function (t, done) {
    const file = path.join(tmpDir(), 'conf.json');
    conf_load({ file: file }, function (err) {
        assert.ok(err, '오류가 없다');
        assert.strictEqual(fs.existsSync(file), false, '시험 경로에 파일을 만들었다');
        done();
    });
});

test('conf_load 는 어떤 경로에서도 process.exit 을 하지 않는다', function () {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'mobius', 'conf_load.js'), 'utf8'));
    assert.ok(!/process\.exit/.test(src), 'conf_load 가 exit 한다 — 시험 러너가 통째로 죽는다');
});

test('경로는 저장소 루트 기준이다 — cwd 가 아니다', function () {
    assert.strictEqual(conf_load.DEFAULT_FILE, path.join(ROOT, 'conf.json'));
});

test('mobius.js 는 conf 를 직접 읽지 않는다 — 순서만 잡는다', function () {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'mobius.js'), 'utf8'));
    assert.ok(/require\(['"]\.\/mobius\/conf_load['"]\)/.test(src), 'mobius.js 가 conf_load 를 부르지 않는다');
    assert.ok(!/conf\.json/.test(src), 'mobius.js 가 conf.json 을 직접 읽는다');
    assert.ok(!/global\.usedb\s*=/.test(src), 'mobius.js 가 global.usedb 를 세운다 — conf_load 의 일이다');
});
