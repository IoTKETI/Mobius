'use strict';
// A1 conf 편집·프로세스 제어가 웹에서 사라졌다. C2 콘솔의 CSE 신원 세 줄이 conf 에서 온다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('A1 라우트 넷과 conf 라우트가 없다', function () {
    const src = code('admin/server.js');
    for (const r of ['/api/server/status', '/api/server/start', '/api/server/stop', '/api/server/restart', '/api/conf']) {
        assert.ok(src.indexOf("'" + r + "'") < 0, r + ' 가 남아 있다');
    }
});

test('A1 admin/ 어디에도 프로세스를 띄우거나 conf.json 에 쓰는 코드가 없다', function () {
    const files = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => /\.js$/.test(f));
    assert.ok(files.indexOf('process_ctl.js') < 0, 'process_ctl.js 가 남아 있다');
    assert.ok(files.indexOf('conf_store.js') < 0, 'admin/conf_store.js 가 남아 있다 — tools/ 로 옮겼다');
    for (const f of files) {
        const src = code('admin/' + f);
        assert.ok(!/require\(['"]child_process['"]\)/.test(src), f + ' 가 child_process 를 쓴다');
        assert.ok(!/conf_store/.test(src), f + ' 가 conf_store 를 쓴다');
        assert.ok(!/writeFileSync\([^)]*conf\.json/.test(src), f + ' 가 conf.json 을 쓴다');
    }
});

test('A1 프런트에 설정·서버 제어 참조가 없다', function () {
    const base = path.join(ROOT, 'admin', 'web', 'src');
    assert.ok(!fs.existsSync(path.join(base, 'views', 'ConfView.vue')));
    assert.ok(!fs.existsSync(path.join(base, 'components', 'ServerControl.vue')));
    for (const f of ['App.vue', 'api.ts', 'types.ts']) {
        const src = fs.readFileSync(path.join(base, f), 'utf8');
        assert.ok(!/ConfView|ServerControl|serverStatus|serverStart|serverStop|serverRestart|ServerStatus|confView|confSave|ConfItem|ConfApply/.test(src),
            f + ' 에 설정·서버 제어 참조가 남아 있다');
        assert.ok(!/'conf'/.test(src), f + ' 의 Tab 에 conf 가 남아 있다');
    }
});

test('C2 콘솔의 CSE 신원 세 줄이 conf 에서 온다 — 기본값은 표의 dflt', function () {
    const src = code('admin/server.js');
    assert.ok(!/['"]Mobius['"]|['"]\/Mobius2['"]|['"]\/\/keti\.re\.kr['"]/.test(src), 'CSE 신원이 아직 박혀 있다');
    for (const k of ['cseBase', 'cseId', 'spId']) {
        assert.ok(src.indexOf("'" + k + "'") >= 0 || src.indexOf('conf.' + k) >= 0, k + ' 를 읽지 않는다');
    }
    const usedb = src.indexOf('global.usedb =');
    const schemaReq = src.search(/require\([^)]*conf_schema/);
    assert.ok(usedb > 0 && schemaReq > usedb, '표를 global.usedb 보다 먼저 require 한다');
});

test('adminPm2Name 은 표에 없다 — 우리 도구는 pm2 를 다루지 않는다. 콘솔 키는 6개', function () {
    const schema = require('../mobius/conf_schema');
    assert.strictEqual(schema.get('adminPm2Name'), null);
    assert.strictEqual(schema.all().filter((k) => schema.get(k).group === '콘솔').length, 6, '콘솔 키는 6개다');
});

test('삭제된 시험 파일이 없다', function () {
    assert.ok(!fs.existsSync(path.join(ROOT, 'test', 'admin-process-ctl.test.js')));
});
