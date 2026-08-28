'use strict';
// 리소스 경로 캐시. 예전에는 app.js 의 global.cache_resource_url 이었다.
//
// 두 가지를 고친다.
//   1) 무제한 증가 -> 상한(LRU)
//   2) 워커 로컬 무효화 -> cluster IPC 로 전 워커 브로드캐스트
//
// 브로드캐스트가 없으면 워커 A 가 지운 리소스를 워커 B 가 계속 200 으로
// 돌려준다. app.js 의 check_resource_from_url 이 캐시 히트 시 그 행으로
// 바로 응답을 만들기 때문이다.

var DEFAULT_LIMIT = 50000;

// Map 은 삽입 순서를 보존한다. 맨 앞이 가장 오래된 항목이다.
var store = new Map();
var send = null;   // 브로드캐스트 요청 함수. 마스터/단일 프로세스에서는 null

// 무효화가 있을 때마다 증가하는 세대 카운터. check_resource_from_url 이
// DB 조회 시작 시점의 값을 들고 있다가, 콜백이 돌아왔을 때 값이 바뀌었으면
// (그 사이 어디선가 invalidate 가 있었으면) 방금 읽은 행을 캐시에 넣지
// 않는다 -- 무효화 브로드캐스트가 도착한 *이후* 도착한 stale DB 응답이
// 캐시를 다시 오염시키는 TOCTOU 를 막는다.
var generation = 0;

function limit() {
    var n = parseInt(global.cache_limit, 10);
    return (n > 0) ? n : DEFAULT_LIMIT;
}

function clear_all() {
    store.clear();
    generation++;
}

exports.get = function (ri) {
    if (!store.has(ri)) { return undefined; }
    var row = store.get(ri);
    store.delete(ri);      // LRU: 접근한 항목을 맨 뒤로
    store.set(ri, row);
    return row;
};

exports.set = function (ri, row) {
    if (store.has(ri)) { store.delete(ri); }
    store.set(ri, row);

    var max = limit();
    while (store.size > max) {
        var oldest = store.keys().next().value;
        store.delete(oldest);
    }
};

exports.size = function () {
    return store.size;
};

exports.generation = function () {
    return generation;
};

// 무효화 대상 키를 모은다.
//   1) ri 자신
//   2) 부모의 '<pi>/la' — 최신 자식이 바뀌었을 수 있다
//   3) '<ri>/' 로 시작하는 모든 키 (자손)
//
// 1)/2) 는 ri 문자열만으로 정해지는 결정적 후보라 store 에 있든 없든 항상
// 넣는다 (없으면 나중에 store.delete 가 그냥 no-op). 3) 은 지금 store 에
// 실제로 뭐가 들어있는지 훑어야만 알 수 있으므로, 호출 시점의 store 내용에
// 따라 결과가 달라진다 -- 그런 의미로는 순수 함수가 아니다.
//
// 접두어 비교에 슬래시를 붙이는 것이 중요하다. '/Mobius/ae1' 로 시작하는
// 문자열에는 형제인 '/Mobius/ae12' 도 걸린다.
exports.keys_for = function (ri) {
    if (typeof ri !== 'string' || ri === '') { return []; }

    var out = [ri];

    var slash = ri.lastIndexOf('/');
    if (slash > 0) {
        out.push(ri.substring(0, slash) + '/la');
    }

    var prefix = ri + '/';
    store.forEach(function (value, key) {
        if (key.indexOf(prefix) === 0) { out.push(key); }
    });

    return out;
};

exports.invalidate_local = function (ri) {
    var keys = exports.keys_for(ri);
    var removed = 0;
    for (var i = 0; i < keys.length; i++) {
        if (store.delete(keys[i])) { removed++; }
    }
    // 세대는 ri 가 유효한 한 항상 올린다. store 에 아무것도 없었어도(캐시
    // 미스 상태에서 삭제된 경우) 그 사이 시작된 DB 조회가 이 시점 이후에
    // 값을 다시 캐싱하지 못하게 막아야 하기 때문이다.
    if (typeof ri === 'string' && ri !== '') { generation++; }
    return removed;
};

exports.invalidate = function (ri) {
    var n = exports.invalidate_local(ri);
    if (send && typeof ri === 'string' && ri !== '') {
        send({ __mobius_cache_inv: true, ri: ri });
    }
    return n;
};

// 대량 삭제(만료/고아 정리 등, 개별 ri 를 낱낱이 알 수 없거나 너무 많은
// 경우)용 전체 비우기. 마스터에서 직접 부를 수 있도록 send 가 설정돼
// 있으면(install_master 가 설정한다) 전 워커에 all:true 를 브로드캐스트한다.
exports.invalidate_all = function () {
    clear_all();
    if (send) {
        send({ __mobius_cache_inv: true, all: true });
    }
};

// --- IPC 배선 ---

exports._set_sender = function (fn) { send = fn; };

exports._on_message = function (msg) {
    if (!msg || msg.__mobius_cache_inv !== true) { return false; }
    if (msg.all === true) {
        clear_all();
        return true;
    }
    if (typeof msg.ri !== 'string' || msg.ri === '') { return false; }
    exports.invalidate_local(msg.ri);
    return true;
};

// 연결이 끊긴(또는 끊기는 중인) 워커에 안전하게 보낸다.
//   - worker.send() 는 채널이 닫혀 있어도 "동기적으로" 던지지 않는다.
//     ERR_IPC_CHANNEL_CLOSED 는 비동기 'error' 이벤트로 온다. 콜백을 넘기면
//     그 에러가 'error' 이벤트 대신 콜백으로 전달되므로, 여기서 삼킨다
//     (넘기지 않으면 워커/마스터에 리스너가 없는 한 uncaughtException 으로
//     프로세스가 죽는다).
//   - isConnected() 체크와 콜백 둘 다 필요하다. 체크와 send() 사이에도
//     연결이 끊길 수 있어 체크만으로는 완전히 막지 못한다.
function safe_send(worker, msg) {
    if (!worker || typeof worker.isConnected !== 'function' || !worker.isConnected()) {
        return;
    }
    try {
        worker.send(msg, function () { /* 실패해도 조용히 무시 */ });
    } catch (e) {
        // 방어적: send 자체가 동기적으로 던지는 구현체가 있어도 안전하게.
    }
}

// 마스터에서 호출. 워커가 보낸 무효화를 전 워커에 중계하고, 마스터 자신이
// (del_expired_resource/del_orphan_resource 같은 마스터 전용 삭제 경로에서)
// invalidate/invalidate_all 을 직접 호출했을 때도 내보낼 수 있도록 sender 를
// 설치한다.
exports.install_master = function (cluster) {
    function broadcast(msg) {
        for (var id in cluster.workers) {
            if (cluster.workers.hasOwnProperty(id)) {
                safe_send(cluster.workers[id], msg);
            }
        }
    }

    exports._set_sender(broadcast);

    cluster.on('message', function (worker, msg) {
        if (!msg || msg.__mobius_cache_inv !== true) { return; }
        broadcast(msg);
    });
};

// 워커에서 호출. 마스터가 중계한 무효화를 받고, 자신의 무효화를 올려보낸다.
exports.install_worker = function () {
    exports._set_sender(function (msg) {
        if (process.send) { process.send(msg); }
    });
    process.on('message', function (msg) {
        exports._on_message(msg);
    });
};
