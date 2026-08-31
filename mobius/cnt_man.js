/**
 * Copyright (c) 2019, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2019, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 * @date 2019.06.14
 */

var db_sql = require('./sql_action');
var db_facade = require('./db');

var pendingUpdates = new Map();
var DEBOUNCE_MS = 1000;
// 지속 유입 시 debounce 가 타이머를 계속 리셋해 flush 가 무한 연기되는 것을
// 막는 상한. 유입 간격이 DEBOUNCE_MS 미만으로 이어지면 (드론 텔레메트리가
// 정확히 그렇다) 이 상한이 없을 때 cnt 반영과 한도 검사가 세션 끝까지 밀린다.
var MAX_WAIT_MS = 10000;

exports.schedule = function (parentObj, cs) {
    var pi = parentObj.ri;

    // cs 는 resource.js 가 parseInt(resource_Obj[rootnm].cs) 로 넘긴다 —
    // cs 가 없거나 수가 아니면 NaN 이다. 그대로 누적하면 entry.cbs 가 **영구히**
    // NaN 이 되고, 그 pi 의 flush 는 매번 통째로 실패한다(NaN 은 바인딩에서
    // NULL 이 되어 NOT NULL 을 위반하고, 예전 %d 형식에서는 문장이 깨졌다).
    // 그러면 cbs 뿐 아니라 cni/st 증가까지 같이 잃는다. cbs 델타 하나만 버린다.
    if (typeof cs !== 'number' || !isFinite(cs)) { cs = 0; }

    if (pendingUpdates.has(pi)) {
        var existing = pendingUpdates.get(pi);
        existing.cni += 1;
        existing.cbs += cs;
        existing.st += 1;
        // 상한 안에서만 debounce 리셋. 넘었으면 걸려 있는 타이머가 그대로 발화한다.
        if (Date.now() - existing.firstAt < MAX_WAIT_MS) {
            clearTimeout(existing.timer);
            existing.timer = setTimeout(flush, DEBOUNCE_MS, pi);
        }
    } else {
        var entry = {
            cni: 1,   // 이 워커에서 발생한 delta (절대값 아님)
            cbs: cs,  // 이 워커에서 발생한 delta
            st: 1,    // 이 워커에서 발생한 delta
            parentObj: parentObj,
            firstAt: Date.now(),
            timer: null
        };
        entry.timer = setTimeout(flush, DEBOUNCE_MS, pi);
        pendingUpdates.set(pi, entry);
    }
};

function flush(pi) {
    var entry = pendingUpdates.get(pi);
    if (!entry) return;
    pendingUpdates.delete(pi);

    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        sqlite.getConnection(function (code, connection) {
            if (code !== '200') {
                console.error('[cnt_man] flush: sqlite connection error');
                return;
            }
            updateCntAndCheck(connection, pi, entry, function () {
                // sqlite는 싱글톤이므로 release 불필요
            });
        });
    } else {
        var db = require('./db_action');
        db.getConnection(function (code, connection) {
            if (code !== '200') {
                console.error('[cnt_man] flush: mysql connection error');
                return;
            }
            updateCntAndCheck(connection, pi, entry, function () {
                connection.release();
            });
        });
    }
}

function updateCntAndCheck(connection, pi, entry, done) {
    var flush_id = 'cnt_man.flush ' + pi + ' - ' + require('shortid').generate();
    console.time(flush_id);
    // 매 flush 1줄이지만 활성 컨테이너당 초단위로 쌓인다 - 필요 시만 활성
    // console.log('[cnt_man] flush: pi=' + pi + ' delta(cni=' + entry.cni + ' cbs=' + entry.cbs + ') parentObj.mni=' + entry.parentObj.mni + ' parentObj.ty=' + entry.parentObj.ty);

    // 값은 전부 바인딩으로 나간다. 예전에는 util.format 의 %s 로 pi 를 그대로
    // 문자열에 박았는데, pi 는 대상 컨테이너의 ri 이고 그 ri 는 클라이언트가 준
    // rn 에서 만들어진다(resource.js 의 build_resource). 즉 요청 본문이 따옴표를
    // 넣으면 여기서 SQL 구조가 깨지는 2차 주입이었다.
    //
    // 문장 모양은 백엔드별로 **그대로 둔다.** MySQL 쪽은 다중 테이블 UPDATE 라
    // 두 행이 다 있을 때만 갱신되는데(크로스 조인이라 한쪽이 없으면 0행),
    // 두 문장으로 쪼개면 cnt 행 없는 lookup 고아에서 st 만 오른다. 그러면
    // 그 컨테이너의 조회 응답과 알림에 실리는 st 가 달라진다.
    // SQLite 에는 다중 테이블 UPDATE 가 없어 두 문장이어야 한다.
    if (global.usesqlite === 'true') {
        // 상대값(delta) 증분: 동시 다중 워커가 flush해도 경쟁 조건 없음
        db_facade.run(db_facade.raw(
            'update cnt set cni = cni + ?, cbs = cbs + ? where ri = ?',
            [entry.cni, entry.cbs, pi]), connection, function (err, result) {
            if (err) {
                console.error('[cnt_man] flush update cnt error:', pi, result);
                console.timeEnd(flush_id);
                done();
                return;
            }
            db_facade.run(db_facade.raw(
                'update lookup set st = st + ? where ri = ?',
                [entry.st, pi]), connection, function (err, result) {
                if (err) {
                    console.error('[cnt_man] flush update lookup error:', pi, result);
                }
                console.timeEnd(flush_id);
                db_sql.get_cni_count(connection, entry.parentObj, function (cni, cbs, st) {
                    done();
                });
            });
        });
    } else {
        // 상대값(delta) 증분: 동시 다중 워커가 flush해도 경쟁 조건 없음
        db_facade.run(db_facade.raw(
            'update cnt, lookup set cnt.cni = cnt.cni + ?, cnt.cbs = cnt.cbs + ?, ' +
            'lookup.st = lookup.st + ? where cnt.ri = ? and lookup.ri = ?',
            [entry.cni, entry.cbs, entry.st, pi, pi]), connection, function (err, result) {
            if (err) {
                console.error('[cnt_man] flush update error:', pi, result);
            }
            console.timeEnd(flush_id);
            db_sql.get_cni_count(connection, entry.parentObj, function (cni, cbs, st) {
                done();
            });
        });
    }
}
