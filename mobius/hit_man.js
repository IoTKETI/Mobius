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

var DEFAULT_FLUSH_SEC = 10;
var WDT_ID = 'hit_ri_flush';

var buffer = {};   // key = ri + '|' + ct
var flushing = false;

// 기본 writer 는 실제 DB 로 간다. 테스트가 _set_writer 로 갈아끼운다.
var writer = function (rows, callback) {
    var db = require('./db_action');
    db.getConnection(function (code, connection) {
        if (code !== '200') {
            callback(new Error('[hit_man] no connection: ' + code));
            return;
        }
        db_sql.upsert_hit_ri_batch(connection, rows, function (err) {
            connection.release();
            callback(err || null);
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
    var virtual = ['/la', '/ol', '/latest', '/oldest'];
    for (var i = 0; i < virtual.length; i++) {
        if (ri.length > virtual[i].length &&
            ri.lastIndexOf(virtual[i]) === ri.length - virtual[i].length) {
            return ri.substring(0, ri.length - virtual[i].length);
        }
    }

    // CIN 은 부모 컨테이너에 귀속한다.
    if (String(ty) === '4') {
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

exports.pending = function () {
    return buffer;
};

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
            console.error('[hit_man] flush failed, will retry: ' + (err.message || err));
            callback(err);
            return;
        }
        callback(null);
    });
};

exports.start = function () {
    var sec = parseInt(global.hit_ri_flush_sec, 10) || DEFAULT_FLUSH_SEC;
    global.wdt.set_wdt(WDT_ID, sec, function () {
        exports.flush(function () {});
    });
};

exports._set_writer = function (fn) { writer = fn; };
