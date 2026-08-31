/**
 * Copyright (c) 2018, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var mysql = require('mysql');
var sqlite = require('./db_sqlite');
var lease = require('./lease');

var mysql_pool = null;

//var _this = this;


exports.connect = function (host, port, user, password, callback) {
    mysql_pool = mysql.createPool({
        host: host,
        port: port,
        user: user,
        password: password,
        database: 'mobiusdb',
        connectionLimit: 100,
        waitForConnections: true,
        debug: false,
        acquireTimeout: 50000,
        queueLimit: 0
    });

    if (global.usesqlite === 'true') {
        sqlite.connect(function (code) {
            console.log('sqlite connected: ' + code);
        });
    }

    callback('1');
};


// function executeQuery(pool, query, callback) {
//     pool.getConnection(function (err, connection) {
//         if (err) {
//             return callback(err, null);
//         }
//         else if (connection) {
//             connection.query({sql:query, timeout:60000}, function (err, rows, fields) {
//                 connection.release();
//                 if (err) {
//                     return callback(err, null);
//                 }
//                 return callback(null, rows);
//             });
//         }
//         else {
//             return callback(true, "No Connection");
//         }
//     });
// }

function executeQuery(pool, query, connection, callback) {
    connection.query({ sql: query, timeout: 60000 }, function (err, rows, fields) {
        if (err) {
            return callback(err, null);
        }
        return callback(null, rows);
    });
}

exports.getConnection = function (callback) {
    if (mysql_pool == null) {
        console.error("mysql is not connected");
        callback(true, "mysql is not connected");
        return '0';
    }

    mysql_pool.getConnection((err, connection) => {
        if (err) {
            callback('500-5');
        }
        else {
            if (connection) {
                // 임대 장부에 올린다. 반납되지 않는 커넥션을 드러내기 위한 것으로,
                // 동작은 바꾸지 않는다 — release 를 감싸 장부만 지우고 원래
                // release 를 그대로 부른다. mobius/lease.js 주석 참고.
                callback('200', lease.track(connection));
            }
            else {
                callback('500-5');
            }
        }
    });
};

// 커넥션 반납. 코어가 handle.release() 를 직접 부르던 것을 여기로 모은다.
//
// 왜 모으는가: handle 에 release 가 있다는 것은 **MySQL 풀 커넥션이라는 가정**이다.
// SQLite 어댑터가 돌려주는 것은 sqlite3.Database 이고 거기엔 release 가 없다
// (그래서 db/sqlite.js 가 어댑터 쪽에 release 를 따로 둔다). 커넥션 원천을
// 파사드로 옮기려면 그 가정이 한 곳에만 있어야 한다.
//
// **아직 파사드에 위임하지 않는다.** 지금 커넥션 원천은 아래 getConnection 의
// mysql_pool 이라, 파사드 어댑터가 sqlite 로 잡혀 있으면 facade.release 가
// no-op 이 되어(db/sqlite.js) 진짜 MySQL 커넥션이 풀로 안 돌아간다.
// 원천과 배출은 반드시 같은 커밋에서 함께 옮긴다.
//
// 덕타이핑 가드는 지금 항상 참이다(lease.js 가 씌운 래퍼에도 release 가 있다).
// 원천을 옮기는 커밋에서 이 함수 본문만 facade.release 로 바꾼다.
exports.release = function (conn) {
    if (conn && typeof conn.release === 'function') { conn.release(); }
};

exports.getResult = function (query, connection, callback) {
    if (mysql_pool == null) {
        console.error("mysql is not connected");
        return '0';
    }

    executeQuery(mysql_pool, query, connection, (err, rows) => {
        if (!err) {
            callback(null, rows);
        }
        else {
            callback(true, err);
        }
    });
};


