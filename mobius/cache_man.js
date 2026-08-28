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

function limit() {
    var n = parseInt(global.cache_limit, 10);
    return (n > 0) ? n : DEFAULT_LIMIT;
}

exports.get = function (ri) {
    if (!store.has(ri)) { return undefined; }
    var row = store.get(ri);
    store.delete(ri);      // LRU: 접근한 항목을 맨 뒤로
    store.set(ri, row);
    return row;
};

exports.has = function (ri) {
    return store.has(ri);
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

// 무효화 대상 키를 모은다. 순수 함수이므로 테스트가 쉽다.
//   1) ri 자신
//   2) 부모의 '<pi>/la' — 최신 자식이 바뀌었을 수 있다
//   3) '<ri>/' 로 시작하는 모든 키 (자손)
//
// 접두어 비교에 슬래시를 붙이는 것이 중요하다. '/Mobius/ae1' 로 시작하는
// 문자열에는 형제인 '/Mobius/ae12' 도 걸린다.
exports.keys_for = function (ri) {
    // 자기 자신과 부모의 /la 는 store 에 있든 없든 항상 후보에 넣는다
    // (없으면 나중에 store.delete 가 그냥 no-op). 자손은 실제 store 를
    // 훑어야만 알 수 있으므로 forEach 로 찾는다.
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
    for (var i = 0; i < keys.length; i++) {
        store.delete(keys[i]);
    }
    return keys.length;
};

exports.invalidate = function (ri) {
    var n = exports.invalidate_local(ri);
    if (send) {
        send({ __mobius_cache_inv: true, ri: ri });
    }
    return n;
};

// --- IPC 배선 ---

exports._set_sender = function (fn) { send = fn; };

exports._on_message = function (msg) {
    if (!msg || msg.__mobius_cache_inv !== true) { return false; }
    exports.invalidate_local(msg.ri);
    return true;
};

// 마스터에서 호출. 워커가 보낸 무효화를 전 워커에 중계한다.
exports.install_master = function (cluster) {
    cluster.on('message', function (worker, msg) {
        if (!msg || msg.__mobius_cache_inv !== true) { return; }
        for (var id in cluster.workers) {
            if (cluster.workers.hasOwnProperty(id)) {
                try {
                    cluster.workers[id].send(msg);
                } catch (e) {
                    // 죽는 중인 워커에 보내면 던진다. 무시해도 안전하다.
                }
            }
        }
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
