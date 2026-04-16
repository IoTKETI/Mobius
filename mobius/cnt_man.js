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
var util = require('util');

var pendingUpdates = new Map();
var DEBOUNCE_MS = 1000;

exports.schedule = function (parentObj, cs) {
    var pi = parentObj.ri;

    if (pendingUpdates.has(pi)) {
        var existing = pendingUpdates.get(pi);
        clearTimeout(existing.timer);
        existing.cni += 1;
        existing.cbs += cs;
        existing.st += 1;
        existing.timer = setTimeout(flush, DEBOUNCE_MS, pi);
    } else {
        var entry = {
            cni: 1,   // 이 워커에서 발생한 delta (절대값 아님)
            cbs: cs,  // 이 워커에서 발생한 delta
            st: 1,    // 이 워커에서 발생한 delta
            parentObj: parentObj,
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
    console.log('[cnt_man] flush: pi=' + pi + ' delta(cni=' + entry.cni + ' cbs=' + entry.cbs + ') parentObj.mni=' + entry.parentObj.mni + ' parentObj.ty=' + entry.parentObj.ty);

    if (global.usesqlite === 'true') {
        var sqlite = require('./db_sqlite');
        // 상대값(delta) 증분: 동시 다중 워커가 flush해도 경쟁 조건 없음
        var sql_update_cnt = util.format("UPDATE cnt SET cni = cni + %d, cbs = cbs + %d WHERE ri = '%s'", entry.cni, entry.cbs, pi);
        sqlite.getResult(sql_update_cnt, connection, function (err) {
            if (err) {
                console.error('[cnt_man] flush update cnt error:', pi, err);
                console.timeEnd(flush_id);
                done();
                return;
            }
            var sql_update_lookup = util.format("UPDATE lookup SET st = st + %d WHERE ri = '%s'", entry.st, pi);
            sqlite.getResult(sql_update_lookup, connection, function (err) {
                if (err) {
                    console.error('[cnt_man] flush update lookup error:', pi, err);
                }
                console.timeEnd(flush_id);
                db_sql.get_cni_count(connection, entry.parentObj, function (cni, cbs, st) {
                    done();
                });
            });
        });
    } else {
        var db = require('./db_action');
        // 상대값(delta) 증분: 동시 다중 워커가 flush해도 경쟁 조건 없음
        var sql = util.format("UPDATE cnt, lookup SET cnt.cni = cnt.cni + %d, cnt.cbs = cnt.cbs + %d, lookup.st = lookup.st + %d WHERE cnt.ri = '%s' AND lookup.ri = '%s'", entry.cni, entry.cbs, entry.st, pi, pi);
        db.getResult(sql, connection, function (err) {
            if (err) {
                console.error('[cnt_man] flush update error:', pi, err);
            }
            console.timeEnd(flush_id);
            db_sql.get_cni_count(connection, entry.parentObj, function (cni, cbs, st) {
                done();
            });
        });
    }
}
