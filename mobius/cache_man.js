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

// 무효화가 있을 때마다 증가하는 세대 카운터. 단조 증가하기만 하는 논리
// 시계다. check_resource_from_url 이 DB 조회 시작 시점의 값을 들고 있다가,
// 콜백이 돌아왔을 때 그 사이 "이 키(또는 그 조상)" 가 무효화됐으면 방금 읽은
// 행을 캐시에 넣지 않는다 -- 무효화 브로드캐스트가 도착한 *이후* 도착한
// stale DB 응답이 캐시를 다시 오염시키는 TOCTOU 를 막는다.
//
// 예전에는 이 카운터 하나를 전역으로 비교했다(generation() === gen). 그러면
// 클러스터 전체에서 초당 200건만 무효화가 일어나도 5ms 마다 값이 바뀌어 --
// select_resource_from_url 왕복보다 짧다 -- 검사가 사실상 항상 실패하고
// 캐시가 영원히 채워지지 않는다. 그래서 세대는 "키별"로 기록한다.
var generation = 0;

// key -> 그 키가 마지막으로 무효화된 세대.
var inv_gen = new Map();

// inv_gen 에서 축출된 항목들의 세대 상한. 축출된 키는 개별 판정을 할 수
// 없으므로, 이 값보다 오래된 in-flight 채움은 전부 막는다(fail-closed).
// 축출은 가장 오래 전에 기록된 것부터라 floor_gen 은 낮게 유지된다.
var floor_gen = 0;

function limit() {
    var n = parseInt(global.cache_limit, 10);
    return (n > 0) ? n : DEFAULT_LIMIT;
}

// inv_gen 의 상한은 store 와 **따로** 둔다.
//
// 둘을 겸하게 하면 메모리를 줄이려고 cache_limit 을 낮추는 순간 inv_gen 도
// 같이 줄어 축출이 잦아지고, 축출될 때마다 floor_gen 이 올라가 set_if_unchanged
// 가 fail-closed 로 거절한다 — 캐시를 아끼려던 조정이 캐시를 꺼 버린다.
//
// 이 값이 실제로 정하는 것은 "in-flight DB 질의 하나가 살아 있는 동안 견딜 수
// 있는 무관한 무효화 건수" 다. 배포 기준(비-CIN 리소스 34,243개)에서 5만이면
// 사실상 상한에 닿지 않는다.
var DEFAULT_INV_GEN_LIMIT = 50000;

function inv_gen_limit() {
    var n = parseInt(global.cache_inv_gen_limit, 10);
    return (n > 0) ? n : DEFAULT_INV_GEN_LIMIT;
}

// 이번 세대에 key 가 무효화됐다고 기록한다. 넘치면 가장 오래된 기록부터
// 버리되 그 세대를 floor_gen 으로 올린다.
function mark(key) {
    if (inv_gen.has(key)) { inv_gen.delete(key); }   // 삽입 순서를 최신으로
    inv_gen.set(key, generation);

    var max = inv_gen_limit();
    while (inv_gen.size > max) {
        var oldest = inv_gen.keys().next().value;
        var g = inv_gen.get(oldest);
        inv_gen.delete(oldest);
        if (g > floor_gen) { floor_gen = g; }
    }
}

function clear_all() {
    store.clear();
    generation++;
    // 개별 기록은 의미가 없어졌다. 대신 이 시점 이전에 시작된 모든 채움을
    // 막도록 floor 를 지금 세대로 올린다.
    inv_gen.clear();
    floor_gen = generation;
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

// check_resource_from_url 전용. DB 조회를 시작하기 전에 받아둔 gen 이후로
// ri (또는 그 조상 경로) 가 무효화됐으면 캐시에 넣지 않는다.
//
// 조상까지 보는 이유: invalidate('/Mobius/ae1') 은 '/Mobius/ae1/cnt1' 을
// store 에서 지우고 그 키도 기록하지만, 그 시점에 store 에 아직 없던
// (= 지금 in-flight 로 읽히는 중인) 자손은 keys_for 가 찾을 수 없다.
// 조상 접두어를 따라 올라가며 확인해야 그 자손의 재캐싱도 막힌다.
// 순회 횟수는 경로 깊이(oneM2M 에서 보통 4~5)로 제한된다.
exports.set_if_unchanged = function (ri, row, gen) {
    if (typeof ri !== 'string' || ri === '') { return false; }
    if (gen < floor_gen) { return false; }

    var key = ri;
    while (key !== '') {
        var g = inv_gen.get(key);
        if (g !== undefined && g > gen) { return false; }
        var slash = key.lastIndexOf('/');
        if (slash <= 0) { break; }
        key = key.substring(0, slash);
    }

    exports.set(ri, row);
    return true;
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
    if (typeof ri === 'string' && ri !== '') {
        generation++;
        for (var j = 0; j < keys.length; j++) { mark(keys[j]); }
    }
    return removed;
};

exports.invalidate = function (ri) {
    var n = exports.invalidate_local(ri);
    if (send && typeof ri === 'string' && ri !== '') {
        send({ __mobius_cache_inv: true, ri: ri });
    }
    return n;
};

// ri 하나만 O(1) 로 무효화한다. 자손 스윕(keys_for 의 store 전체 forEach)을
// 하지 않는다.
//
// contentInstance 삽입 전용이다: 그때 실제로 바뀌는 것은 부모 컨테이너 행의
// st/cni/cbs 뿐이고 자손은 아무것도 바뀌지 않는다. 그런데 자손 스윕은 원 워커
// 에서 한 번, 브로드캐스트를 받는 *모든* 워커에서 또 한 번씩 store 전체를
// 훑는다 -- 워커를 늘려도 CIN 처리량이 늘지 않는 상한이 여기서 생겼다.
// 삭제(DELETE) 경로는 실제로 서브트리가 사라지므로 invalidate 를 계속 쓴다.
exports.invalidate_self_local = function (ri) {
    if (typeof ri !== 'string' || ri === '') { return 0; }
    var removed = store.delete(ri) ? 1 : 0;
    generation++;
    mark(ri);
    return removed;
};

exports.invalidate_self = function (ri) {
    var n = exports.invalidate_self_local(ri);
    if (send && typeof ri === 'string' && ri !== '') {
        send({ __mobius_cache_inv: true, ri: ri, self: true });
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

// 테스트 전용: 세대 기록 맵의 크기와 축출 하한.
exports._inv_gen_state = function () {
    return { size: inv_gen.size, floor: floor_gen };
};

exports._on_message = function (msg) {
    if (!msg || msg.__mobius_cache_inv !== true) { return false; }
    if (msg.all === true) {
        clear_all();
        return true;
    }
    if (typeof msg.ri !== 'string' || msg.ri === '') { return false; }
    // self:true 는 CIN 삽입이 보낸 것이다. 받는 쪽에서도 자손 스윕을 하지
    // 않아야 브로드캐스트 비용이 워커 수에 비례해 늘지 않는다.
    if (msg.self === true) {
        exports.invalidate_self_local(msg.ri);
    }
    else {
        exports.invalidate_local(msg.ri);
    }
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
    // skip_id 가 있으면 그 워커는 건너뛴다. 발신 워커는 보내기 전에 이미
    // 자기 store 를 지웠으므로 되쏘면 하는 일 없이 IPC 왕복만 늘어난다.
    // 배포는 워커 25개라 CIN 삽입 하나가 26회(올림 1 + 내림 25)가 되고, 그
    // 마스터는 pxy_mqtt/coap/ws 가 함께 도는 단일 프로세스다.
    function broadcast(msg, skip_id) {
        for (var id in cluster.workers) {
            if (!cluster.workers.hasOwnProperty(id)) { continue; }
            if (skip_id !== undefined && String(id) === String(skip_id)) { continue; }
            safe_send(cluster.workers[id], msg);
        }
    }

    // 마스터 자신이 부르는 invalidate/invalidate_all 은 건너뛸 대상이 없다.
    exports._set_sender(function (msg) { broadcast(msg); });

    cluster.on('message', function (worker, msg) {
        if (!msg || msg.__mobius_cache_inv !== true) { return; }
        broadcast(msg, worker && worker.id);
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
