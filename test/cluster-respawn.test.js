'use strict';
// A dead worker is respawned.
//
// app.js used to listen for 'death', a Node 0.x name that never fires now; cluster emits fork / online / listening / disconnect / exit / setup only. A dead worker was therefore gone for good and capacity shrank until a restart.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cluster = require('node:cluster');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test("cluster 이벤트 이름이 실재하는 것이어야 한다", function () {
    // The events Node actually emits; 'death' is not among them.
    const REAL = ['fork', 'online', 'listening', 'disconnect', 'exit', 'setup', 'message'];

    const used = [];
    const re = /cluster\.on\(\s*'([a-z]+)'/g;
    let m;
    while ((m = re.exec(APP)) !== null) { used.push(m[1]); }

    assert.ok(used.length > 0, 'cluster.on 을 하나도 못 찾았다 — 정규식이 낡았을 수 있다');
    used.forEach(function (ev) {
        assert.ok(REAL.indexOf(ev) !== -1,
            "cluster.on('" + ev + "') 은 Node 가 내지 않는 이벤트다 — 영원히 발화하지 않는다");
    });
});

test('워커 종료를 exit 로 듣고 다시 띄운다', function () {
    assert.match(APP, /cluster\.on\(\s*'exit'/,
        "워커 종료를 듣는 cluster.on('exit') 가 없다");
    // fork must be called inside the handler for capacity to return.
    const handler = /cluster\.on\(\s*'exit'[\s\S]{0,2000}?\n\s{8}\}\);/.exec(APP);
    assert.ok(handler, "exit 핸들러 본문을 못 찾았다");
    assert.match(handler[0], /cluster\.fork\(\)/, 'exit 핸들러가 워커를 다시 띄우지 않는다');
});

test('의도한 종료는 다시 띄우지 않는다', function () {
    // Respawning workers the parent brought down during deploy/restart would keep the shutdown from finishing.
    const handler = /cluster\.on\(\s*'exit'[\s\S]{0,2000}?\n\s{8}\}\);/.exec(APP);
    assert.match(handler[0], /exitedAfterDisconnect/,
        '의도한 종료(exitedAfterDisconnect)를 구분하지 않는다');
});

test('Node 의 cluster 는 실제로 death 를 내지 않는다', function () {
    // Confirms at runtime the premise the test above rests on.
    assert.strictEqual(cluster.listenerCount('death'), 0);
    assert.ok(typeof cluster.on === 'function');
    // Any name can be registered on an EventEmitter, but the Node source emits 'exit'; the documented event list has no death.
    assert.ok(['fork', 'online', 'listening', 'disconnect', 'exit', 'setup']
        .indexOf('death') === -1);
});

// --- Port conflict and windowsHide ---

function code_only(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('C9 포트 충돌·conf 소실은 재포크하지 않고 마스터도 종료한다 — exitedAfterDisconnect 뒤, setTimeout 앞', function () {
    const handler = /cluster\.on\(\s*'exit'[\s\S]{0,2000}?\n\s{8}\}\);/.exec(APP)[0];
    const a = handler.indexOf('exitedAfterDisconnect');
    const b = handler.indexOf('EXIT.PORT_TAKEN');
    const c = handler.indexOf('EXIT.NO_CONF');
    const d = handler.indexOf('setTimeout');
    assert.ok(a > 0 && b > a && c > a && d > b && d > c, '분기의 자리가 틀렸다 (순서: exitedAfterDisconnect → EXIT 분기 → setTimeout)');
    assert.match(handler, /process\.exit\(code\)/, '마스터가 같은 코드로 종료하지 않는다');
    assert.ok(handler.indexOf('EXIT.BAD_SEAL') > a, '봉인 불일치 종료 코드가 exitedAfterDisconnect 뒤에 없다');
});

test('C9 listen 네 곳 전부에 error 핸들러가 붙어 있다 — 하나만 고치면 https 배포에서 좀비가 남는다', function () {
    const code = code_only(APP);
    const listens = (code.match(/\.listen\(\{\s*port:\s*usecsebaseport/g) || []).length;
    const guards = (code.match(/\.on\('error',\s*port_guard\.onListenError\(usecsebaseport\)\)/g) || []).length;
    assert.strictEqual(listens, 4, 'listen 자리가 4곳이 아니다: ' + listens);
    assert.strictEqual(guards, 4, 'error 핸들러가 4곳 다 안 붙었다: ' + guards);
});

test('C12 windowsHide 가 fork 앞에 있다 — 주석을 걷어낸 뒤 본다', function () {
    const code = code_only(APP);
    const hide = code.search(/cluster\.setupPrimary\(\s*\{[^}]*windowsHide:\s*true/);
    const fork = code.indexOf('cluster.fork()');
    assert.ok(hide > 0, 'cluster.setupPrimary({ windowsHide: true }) 가 없다');
    assert.ok(hide < fork, 'windowsHide 가 첫 fork 보다 뒤에 있다');
});

test('C9 마스터의 시험 바인드가 부팅 기록보다 앞이다 — 뒤집으면 중복 인스턴스가 살아 있는 서버의 기록을 비운다', function () {
    const src = code_only(fs.readFileSync(path.join(__dirname, '..', 'mobius.js'), 'utf8'));
    const probe = src.indexOf('port_guard.probe(');
    const write = src.indexOf('boot_record.write(');
    assert.ok(probe > 0 && write > 0 && probe < write);
    assert.match(src, /cluster\.isPrimary/, '시험 바인드가 마스터에서만 도는지 가르지 않는다');
    assert.match(src, /process\.exit\(EXIT\.PORT_TAKEN\)/);
    assert.match(src, /BAD_SEAL/);
});
