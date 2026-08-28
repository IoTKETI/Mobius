'use strict';
// test/cache-man-ipc.test.js 가 real cluster.fork() 로 띄우는 워커 픽스처.
// app.js 의 워커 분기가 부팅 때 하는 일과 완전히 같다: cache_man 을
// 워커로 설치한다. 그 위에 테스트 제어용 명령(set/invalidate/check)만
// 얹어서 부모(테스트 프로세스 = 이 cluster 의 마스터)가 상태를 조작하고
// 물어볼 수 있게 한다.

var cache_man = require('../../mobius/cache_man');

cache_man.install_worker();

process.on('message', function (msg) {
    if (!msg || msg.__test_cmd === undefined) { return; }

    if (msg.__test_cmd === 'set') {
        cache_man.set(msg.ri, { marker: true, pid: process.pid });
        process.send({ __test_reply: 'set-ack', ri: msg.ri });
    }
    else if (msg.__test_cmd === 'invalidate') {
        cache_man.invalidate(msg.ri);
        process.send({ __test_reply: 'invalidate-ack', ri: msg.ri });
    }
    else if (msg.__test_cmd === 'invalidate-all') {
        cache_man.invalidate_all();
        process.send({ __test_reply: 'invalidate-all-ack' });
    }
    else if (msg.__test_cmd === 'check') {
        process.send({
            __test_reply: 'check-result',
            ri: msg.ri,
            hasKey: cache_man.get(msg.ri) !== undefined
        });
    }
});

process.send({ __test_reply: 'ready' });
