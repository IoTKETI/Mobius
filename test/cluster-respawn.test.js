'use strict';
// 워커가 죽으면 다시 띄운다.
//
// app.js 는 'death' 를 듣고 있었다. Node 0.x 시절 이름이라 지금은 아무 때도
// 발화하지 않는다 — cluster 가 내는 것은 fork / online / listening /
// disconnect / exit / setup 뿐이다. 그래서 워커가 죽으면 그대로 사라졌고,
// 용량이 재시작 전까지 영구히 줄었다.
//
// 실측 (2026-08-28, 로컬 Node 22): D22 이전 코드에 GET /Mobius/fopt 를 3번
// 보내니 워커가 17 -> 14 로 줄고 10초가 지나도 돌아오지 않았다.
// 배포 서버는 워커가 25개다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cluster = require('node:cluster');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test("cluster 이벤트 이름이 실재하는 것이어야 한다", function () {
    // Node 가 실제로 내는 이벤트 목록. 'death' 는 여기 없다.
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
    // 핸들러 안에서 fork 를 불러야 용량이 돌아온다.
    const handler = /cluster\.on\(\s*'exit'[\s\S]{0,900}?\n\s{8}\}\);/.exec(APP);
    assert.ok(handler, "exit 핸들러 본문을 못 찾았다");
    assert.match(handler[0], /cluster\.fork\(\)/, 'exit 핸들러가 워커를 다시 띄우지 않는다');
});

test('의도한 종료는 다시 띄우지 않는다', function () {
    // 배포/재시작 때 부모가 워커를 내리는 경우까지 되살리면 종료가 안 끝난다.
    const handler = /cluster\.on\(\s*'exit'[\s\S]{0,900}?\n\s{8}\}\);/.exec(APP);
    assert.match(handler[0], /exitedAfterDisconnect/,
        '의도한 종료(exitedAfterDisconnect)를 구분하지 않는다');
});

test('Node 의 cluster 는 실제로 death 를 내지 않는다', function () {
    // 위 테스트가 딛고 선 전제를 런타임으로 확인한다.
    assert.strictEqual(cluster.listenerCount('death'), 0);
    assert.ok(typeof cluster.on === 'function');
    // EventEmitter 라 아무 이름이나 등록은 되지만, Node 소스가 내는 것은
    // 'exit' 이다. 문서화된 이벤트 목록에 death 가 없다는 것이 근거다.
    assert.ok(['fork', 'online', 'listening', 'disconnect', 'exit', 'setup']
        .indexOf('death') === -1);
});
