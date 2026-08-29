'use strict';
// mobius/cache_man.js 의 install_master/install_worker 를 실제 cluster IPC
// 로 검증한다. test/cache-man.test.js 의 8(+) 개 단위 테스트는 모두
// _set_sender 로 주입한 가짜 sender 를 통해 cache_man 을 몰아붙이므로,
// install_master/install_worker 가 실제로 배선하는 process.send /
// cluster.on('message') / worker.send() 경로 자체는 그 테스트들로는 전혀
// 검증되지 않는다. 이 파일은 그 경로를 real child process 둘로 재현한다.

const { test, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cluster = require('cluster');
const cache_man = require('../mobius/cache_man');

const WORKER_SCRIPT = path.join(__dirname, 'fixtures', 'cache-man-ipc-worker.js');

if (typeof cluster.setupPrimary === 'function') {
    cluster.setupPrimary({ exec: WORKER_SCRIPT });
}
else {
    cluster.setupMaster({ exec: WORKER_SCRIPT });
}

// 이 테스트 프로세스 자신이 "마스터" 다. app.js 가 cluster.isMaster 분기에서
// 하는 것과 정확히 같은 호출.
cache_man.install_master(cluster);

function forkWorker() {
    return cluster.fork();
}

function waitForReady(worker) {
    return new Promise(function (resolve) {
        function onMsg(msg) {
            if (msg && msg.__test_reply === 'ready') {
                worker.removeListener('message', onMsg);
                resolve();
            }
        }
        worker.on('message', onMsg);
    });
}

function waitForReply(worker, type, matchRi) {
    return new Promise(function (resolve) {
        function onMsg(msg) {
            if (msg && msg.__test_reply === type && (matchRi === undefined || msg.ri === matchRi)) {
                worker.removeListener('message', onMsg);
                resolve(msg);
            }
        }
        worker.on('message', onMsg);
    });
}

function killAll(workers) {
    workers.forEach(function (w) {
        try { w.kill(); } catch (e) { /* 이미 죽었으면 무시 */ }
    });
}

// 테스트가 도중에 실패/타임아웃해도 다음 테스트나 프로세스 종료를 막는
// 좀비 워커가 남지 않도록 파일 끝에서 한 번 더 정리한다.
after(function () {
    for (var id in cluster.workers) {
        if (cluster.workers.hasOwnProperty(id)) {
            try { cluster.workers[id].kill(); } catch (e) { /* ignore */ }
        }
    }
});

test('실 cluster IPC: 워커 A 의 invalidate 가 워커 B 에 전파된다', { timeout: 15000 }, async function () {
    const RI = '/Mobius/ipctest-' + process.pid + '-' + Date.now();
    const a = forkWorker();
    const b = forkWorker();

    try {
        await Promise.all([waitForReady(a), waitForReady(b)]);

        // 두 워커 모두 같은 키를 채운다 -- 무효화 전에는 둘 다 200 을
        // 낼 수 있는 상태라는 뜻이다.
        const aSet = waitForReply(a, 'set-ack', RI);
        const bSet = waitForReply(b, 'set-ack', RI);
        a.send({ __test_cmd: 'set', ri: RI });
        b.send({ __test_cmd: 'set', ri: RI });
        await Promise.all([aSet, bSet]);

        assert.strictEqual(a.isConnected(), true);
        assert.strictEqual(b.isConnected(), true);

        // 마스터가 A 의 원본 무효화 메시지를 실제로 관측했다는(=
        // cache_man.install_master 의 릴레이 리스너가 이미 동기적으로
        // B 에게도 보냈다는) 신호를 A 에게 invalidate 를 시키기 *전에*
        // 미리 걸어둔다. 이렇게 해야 이벤트를 놓치지 않는다.
        const relaySeen = new Promise(function (resolve) {
            function onRelay(worker, msg) {
                if (msg && msg.__mobius_cache_inv === true && msg.ri === RI) {
                    cluster.removeListener('message', onRelay);
                    resolve();
                }
            }
            cluster.on('message', onRelay);
        });

        const aInvalidated = waitForReply(a, 'invalidate-ack', RI);
        a.send({ __test_cmd: 'invalidate', ri: RI });
        await Promise.all([aInvalidated, relaySeen]);

        // 마스터 -> B 로 가는 IPC 채널은 순서를 보존한다. 릴레이(위에서
        // 이미 관측)가 이 check 명령보다 먼저 큐에 들어갔으므로, B 는
        // check 를 처리할 때 이미 무효화를 반영한 상태다.
        const bCheck = waitForReply(b, 'check-result', RI);
        b.send({ __test_cmd: 'check', ri: RI });
        const result = await bCheck;

        assert.strictEqual(result.hasKey, false,
            'B 는 A 의 invalidate 브로드캐스트를 마스터를 거쳐 받아 로컬 캐시에서 제거해야 한다');
    }
    finally {
        killAll([a, b]);
    }
});

test('실 cluster IPC: 마스터의 invalidate_all 이 두 워커 모두에 전파된다', { timeout: 15000 }, async function () {
    // del_expired_resource/del_orphan_resource 가 마스터 프로세스에서
    // 직접 cache_man.invalidate_all() 을 부르는 경로 (MUST FIX 5).
    const RI = '/Mobius/ipctest-flush-' + process.pid + '-' + Date.now();
    const a = forkWorker();
    const b = forkWorker();

    try {
        await Promise.all([waitForReady(a), waitForReady(b)]);

        const aSet = waitForReply(a, 'set-ack', RI);
        const bSet = waitForReply(b, 'set-ack', RI);
        a.send({ __test_cmd: 'set', ri: RI });
        b.send({ __test_cmd: 'set', ri: RI });
        await Promise.all([aSet, bSet]);

        // 릴레이를 거치지 않는다 -- 마스터 자신이 브로드캐스트를 시작한다.
        cache_man.invalidate_all();

        // 마스터 -> A, 마스터 -> B 각 채널 안에서 순서가 보존되므로,
        // invalidate_all 의 send() 호출들 다음에 보낸 check 는 그 뒤에
        // 도착한다.
        const aCheck = waitForReply(a, 'check-result', RI);
        const bCheck = waitForReply(b, 'check-result', RI);
        a.send({ __test_cmd: 'check', ri: RI });
        b.send({ __test_cmd: 'check', ri: RI });
        const results = await Promise.all([aCheck, bCheck]);

        assert.strictEqual(results[0].hasKey, false, 'A 는 마스터의 invalidate_all 브로드캐스트를 받아야 한다');
        assert.strictEqual(results[1].hasKey, false, 'B 도 마스터의 invalidate_all 브로드캐스트를 받아야 한다');
    }
    finally {
        killAll([a, b]);
    }
});
