'use strict';
// 리소스별 사용 이력(hit_ri) 수집.
//
// 요청 경로에서는 메모리만 건드린다. wdt 가 주기적으로 flush 를 불러
// 모인 증분을 한 문장으로 기록한다.
//
// 설계 근거는 docs/superpowers/specs/2026-08-28-admin-console-design.md §3 P0-2.
//   - CIN 은 자체 키를 만들지 않는다. 부모 CNT 에 귀속시킨다.
//     안 그러면 hit_ri 가 lookup 보다 커진다.
//   - 콘솔 자신의 조회는 집계하지 않는다. 콘솔이 리소스를 들여다볼 때마다
//     "마지막 접근"이 갱신되면 삭제 판정 신호가 오염된다.

var moment = require('moment');
var db_sql = require('./sql_action');
var facade = require('./db');

var DEFAULT_FLUSH_SEC = 10;
var WDT_ID = 'hit_ri_flush';

// 실패한 flush 를 되돌릴 때의 버퍼 상한(키 개수). 키는 ri|ct 이므로 쓰기가
// 계속 실패하면 하루가 지날 때마다 리소스 수만큼 키가 더 쌓인다 — 상한이
// 없으면 워커마다 메모리가 무한정 자란다. 상한을 넘으면 가장 오래된 ct 부터
// 버린다(최근 접근 신호가 삭제 판정에 더 중요하다).
var MAX_BUFFER_KEYS = 50000;

// 같은 실패를 10초마다 영원히 찍지 않기 위한 주기(연속 실패 횟수 기준).
// 10초 주기 x 360 = 약 1시간에 한 줄.
var FAIL_LOG_EVERY = 360;

var buffer = {};   // key = ri + '|' + ct
var flushing = false;
var consecutive_failures = 0;

// 기본 writer 는 실제 DB 로 간다. 테스트가 _set_writer 로 갈아끼운다.
//
// db_action(레거시 MySQL 풀)이 아니라 db 파사드로 커넥션을 얻는다. usesqlite
// 일 때 db_action.getConnection 은 여전히 MySQL 풀을 호출하므로, hit_ri 저장이
// 실제로 쓰는 백엔드와 무관하게 MySQL 가용성에 묶여 버린다. upsert_hit_ri_batch
// 는 이미 파사드를 거쳐 실행되니(mobius/sql_action.js) 커넥션 출처도 같은
// 파사드로 맞춘다. release 도 handle.release() 가 아니라 facade.release(handle)
// 이다 — SQLite 어댑터는 이걸 no-op 으로 둔다(mobius/db/sqlite.js).
// 파사드의 (true, err) 규약과 일반 (err) 규약을 모두 받아 진단 가능한 에러
// 하나로 만든다. 주입된 테스트 writer 는 그냥 Error 를 넘길 수도 있다.
function to_error(err, second) {
    if (second && (second.message || second.code)) { return second; }
    if (err && err !== true) { return err; }
    return new Error('unknown write failure');
}

var writer = function (rows, callback) {
    facade.getConnection(function (code, connection) {
        if (code !== '200') {
            callback(new Error('[hit_man] no connection: ' + code));
            return;
        }
        db_sql.upsert_hit_ri_batch(connection, rows, function (err, result) {
            // 성공/실패 어느 쪽이든 반드시 반납한다 — 안 그러면 flush 주기마다 샌다.
            facade.release(connection);
            if (!err) { callback(null); return; }
            // 파사드 규약은 실패 시 cb(true, err) 다 (mobius/db/index.js exports.run).
            // err 를 그대로 흘리면 로그가 "flush failed: true" 가 되어 아무 진단
            // 가치가 없다 — 진짜 에러는 두 번째 인자에 들어 있다.
            callback(to_error(err, result));
        });
    });
};

function today() {
    return moment().utc().format('YYYYMMDD');
}

// 어떤 ri 로 기록할지 정한다. 순수 함수.
exports.attribute = function (ri, ty) {
    if (!ri) { return null; }

    // 가상 자식(/la, /ol, /latest, /oldest)은 컨테이너의 접근이다.
    //
    // 알려진 한계(의도적, 고치지 않음): 컨테이너 자신의 실제 이름이 정확히
    // "la"/"ol"/"latest"/"oldest" 인 경우(예: 실제 컨테이너 ri 가
    // /Mobius/ae1/la) 이 접미사 규칙에 걸려 부모(ae1)로 잘못 귀속된다.
    // oneM2M 에서 <container>/la 는 애초에 그 컨테이너의 가상 latest
    // 리소스를 가리키는 경로이고, Mobius 자신도 이 경로를 그렇게 해석한다
    // (mobius/cnt.js 의 la/ol 처리 참고) — 즉 attribute() 가 서버의 경로
    // 해석과 다르게 굴면 그게 더 큰 문제다. 이 모호성을 없애려면 서버 쪽
    // 라우팅 규칙 자체를 바꿔야 하는데 그건 이 태스크의 범위가 아니다.
    var virtual = ['/la', '/ol', '/latest', '/oldest'];
    for (var i = 0; i < virtual.length; i++) {
        if (ri.length > virtual[i].length &&
            ri.lastIndexOf(virtual[i]) === ri.length - virtual[i].length) {
            return ri.substring(0, ri.length - virtual[i].length);
        }
    }

    // CIN 은 부모 컨테이너에 귀속한다.
    // ty 를 아는 호출은 ty 로, 모르는 호출(라우터 진입 시점)은 경로 규칙으로 판별한다.
    // Mobius 의 CIN rn 은 '4-<타임스탬프>' 형식이다 (resource.js 가 생성).
    var last = ri.substring(ri.lastIndexOf('/') + 1);
    if (String(ty) === '4' || /^4-\d/.test(last)) {
        var slash = ri.lastIndexOf('/');
        return (slash > 0) ? ri.substring(0, slash) : ri;
    }

    return ri;
};

exports.record = function (ri, ty, binding, originator) {
    if (!ri) { return; }

    // 콘솔 자신의 트래픽은 제외한다.
    if (global.useadminorigin && originator &&
        (originator === global.useadminorigin ||
         originator === ('/' + global.useadminorigin))) {
        return;
    }

    var target = exports.attribute(ri, ty);
    if (!target) { return; }

    var ct = today();
    var key = target + '|' + ct;

    if (!buffer[key]) {
        buffer[key] = { ri: target, ct: ct, http: 0, mqtt: 0, coap: 0, ws: 0 };
    }

    if (binding === 'M') { buffer[key].mqtt++; }
    else if (binding === 'C') { buffer[key].coap++; }
    else if (binding === 'W') { buffer[key].ws++; }
    else { buffer[key].http++; }
};

// 테스트 전용 조회. 스냅샷 복사가 아니라 살아있는 buffer 참조를 그대로
// 돌려준다 — 유일한 호출자는 테스트이고 아무도 이 값을 변형하지 않으므로
// 지금은 문제가 없지만, 새 호출자를 추가할 때는 이 사실을 기억할 것.
exports.pending = function () {
    return buffer;
};

// 버퍼가 상한을 넘으면 가장 오래된 ct 부터 버린다. ct 는 'YYYYMMDD' 라
// 문자열 정렬이 그대로 시간 순이다. 버린 개수를 돌려준다.
function trim_buffer() {
    var keys = Object.keys(buffer);
    if (keys.length <= MAX_BUFFER_KEYS) { return 0; }

    keys.sort(function (a, b) {
        var ca = buffer[a].ct;
        var cb = buffer[b].ct;
        if (ca < cb) { return -1; }
        if (ca > cb) { return 1; }
        return 0;
    });

    var drop = keys.length - MAX_BUFFER_KEYS;
    for (var i = 0; i < drop; i++) { delete buffer[keys[i]]; }
    return drop;
}

// 테스트 전용: 상한을 낮춰 버림 동작을 현실적인 시간 안에 검증한다.
exports._set_max_buffer_keys = function (n) { MAX_BUFFER_KEYS = n; };

exports.flush = function (callback) {
    callback = callback || function () {};

    var keys = Object.keys(buffer);
    if (keys.length === 0) { callback(null); return; }

    // 겹쳐 도는 flush 를 막는다. 이번 주기는 건너뛰고 다음에 같이 나간다.
    if (flushing) { callback(null); return; }
    flushing = true;

    var rows = [];
    for (var i = 0; i < keys.length; i++) { rows.push(buffer[keys[i]]); }
    buffer = {};

    writer(rows, function (err) {
        flushing = false;
        if (err) {
            // 유실보다 중복 누적이 낫다. 되돌려 다음 주기에 재시도한다.
            for (var j = 0; j < rows.length; j++) {
                var k = rows[j].ri + '|' + rows[j].ct;
                if (!buffer[k]) { buffer[k] = rows[j]; }
                else {
                    buffer[k].http += rows[j].http;
                    buffer[k].mqtt += rows[j].mqtt;
                    buffer[k].coap += rows[j].coap;
                    buffer[k].ws   += rows[j].ws;
                }
            }

            consecutive_failures++;
            var dropped = trim_buffer();

            // 로그 폭주 방지: 첫 실패에 한 번, 그 뒤로는 FAIL_LOG_EVERY 주기마다
            // 한 번만 남긴다. 8워커 x 10초 주기로 영원히 찍으면 하루 7만 줄이다.
            if (consecutive_failures === 1 || (consecutive_failures % FAIL_LOG_EVERY) === 0) {
                console.error('[hit_man] flush failed (연속 ' + consecutive_failures +
                              '회), will retry: ' + (err.message || err));
            }
            // 버림은 데이터 유실이므로 발생한 주기에만 한 줄 남긴다.
            if (dropped > 0) {
                console.error('[hit_man] buffer over ' + MAX_BUFFER_KEYS +
                              ' keys — dropped ' + dropped + ' oldest-ct entrie(s)');
            }

            callback(err);
            return;
        }

        if (consecutive_failures > 0) {
            console.log('[hit_man] flush recovered after ' + consecutive_failures + ' failure(s)');
            consecutive_failures = 0;
        }
        callback(null);
    });
};

exports.start = function () {
    var sec = parseInt(global.hit_ri_flush_sec, 10) || DEFAULT_FLUSH_SEC;
    global.wdt.set_wdt(WDT_ID, sec, function () {
        // wdt.js 의 tick 루프(resource_manager)에는 try/catch 가 없고, 이
        // 프로세스에는 process.on('uncaughtException') 도 없다 — 이 콜백 안에서
        // 뭔가 동기적으로 던지면(예: db 파사드가 아직 connect() 되지 않은
        // 상태에서 assertReady() 가 던지는 경우) 워커 전체가 죽는다.
        // flush 는 10초마다 도는 기록용 부가 작업일 뿐이므로, 한 번의 실패가
        // 요청을 처리 중인 워커를 crash-loop 로 몰아넣게 둘 수 없다. 정상
        // 경로(writer 콜백의 err)는 이미 flush() 안에서 처리되므로 여기 잡히는
        // 건 예상 밖의 동기 예외뿐이다.
        try {
            exports.flush(function () {});
        } catch (e) {
            console.error('[hit_man] flush threw: ' + (e.message || e));
        }
    });
};

exports._set_writer = function (fn) { writer = fn; };
