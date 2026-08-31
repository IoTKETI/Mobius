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

// **파사드 위의 껍데기다.** 자기 DB 드라이버를 갖지 않는다.
//
// 예전에는 여기서 MySQL 풀을 직접 만들었다. 그래서 코어 여덟 파일이 이 모듈을
// 통해 커넥션을 얻었고, 결과적으로 **어느 백엔드를 골랐든 요청 경로는 늘
// MySQL 풀에서 커넥션을 받았다.** SQLite 모드조차 MySQL 이 없으면 기동하지
// 못했다(실측: MySQL 을 닿지 않는 주소로 두면 listen 에 도달하지 않는다).
//
// 그 상태로는 세 번째 DB 를 붙일 수 없다. postgres.js 를 써 봐야 커넥션은
// 여전히 MySQL 에서 나온다. 그래서 원천을 파사드로 옮긴다.
//
// 이 모듈이 아직 남아 있는 이유는 둘이다.
//   1. 호출부가 많다 (app.js, resource.js, sgn.js, sql_action.js, cnt_man.js ...)
//   2. **임대 장부(lease)가 여기 붙어 있다.** 반납되지 않는 커넥션을 드러내는
//      유일한 수단이라, 취득처를 옮기면서 이것까지 잃으면 안 된다.
// 호출부가 파사드를 직접 쓰게 되면 이 파일은 사라진다.
var facade = require('./db');
var lease = require('./lease');

//var _this = this;


exports.connect = function (host, port, user, password, callback) {
    // 파사드가 conf 의 이름(global.usedb)으로 어댑터를 고르고 그것만 연다.
    // 예전에는 여기서 MySQL 풀을 만들고 **추가로** 레거시 sqlite 핸들도 열어,
    // SQLite 모드에서 같은 파일에 핸들이 둘 열려 있었다.
    facade.connect(host, port, user, password, callback);
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

exports.getConnection = function (callback) {
    // 취득은 파사드가 한다 — 어느 백엔드인지는 파사드가 안다.
    // 장부만 여기서 씌운다.
    //
    // **try 범위에 주의.** facade.getConnection 은 백엔드에 따라 콜백을
    // **동기로** 부른다(SQLite 어댑터가 그렇다). 그러면 요청 처리 사슬 전체가
    // 이 try 안에서 돌게 되는데, 거기서 난 예외까지 삼키면 응답도 정산도 없이
    // 요청이 영구히 매달린다 — 크래시보다 나쁘다. 지금은 워커가 죽으면
    // backstop 이 소켓을 닫아 커넥션이 회수되고 cluster 가 다시 띄운다.
    //
    // 그래서 **콜백에 들어간 뒤의 예외는 그대로 올려보낸다.** 여기서 정규화할
    // 것은 취득 자체가 동기로 던지는 경우(연결 전 호출)뿐이다.
    var entered = false;
    try {
        facade.getConnection(function (code, connection) {
            entered = true;
            if (code !== '200' || !connection) {
                callback('500-5');
                return;
            }
            // 임대 장부에 올린다. 반납되지 않는 커넥션을 드러내기 위한 것으로,
            // 동작은 바꾸지 않는다 — release 를 감싸 장부만 지우고 원래
            // release 를 그대로 부른다. mobius/lease.js 주석 참고.
            //
            // 핸들에 release 가 없으면(SQLite 싱글턴) lease 가 알아서 비켜간다.
            // 그쪽은 풀이 없어 고갈될 것도 없으므로 장부가 필요 없다.
            callback('200', lease.track(connection));
        });
    } catch (e) {
        if (entered) { throw e; }   // 요청 사슬의 예외다 — 삼키면 안 된다
        console.error('[db_action.getConnection] ' + ((e && e.message) || e));
        callback('500-5');
    }
};

// 커넥션 반납. 코어가 handle.release() 를 직접 부르던 것을 여기로 모았다.
//
// **원천과 같은 곳으로 보낸다.** 취득이 파사드인데 반납이 드라이버 직접이면
// 둘이 다른 어댑터를 볼 수 있다. 특히 되돌릴 때 절반만 되돌아가면 진짜 MySQL
// 커넥션이 no-op release 로 사라져 워커당 100 짜리 풀이 조용히 마른다.
// 그래서 취득·반납은 늘 한 커밋에서 같이 움직인다.
//
// 장부는 그대로 산다: mysql 어댑터의 release 가 handle.release() 를 부르는데,
// 그 프로퍼티가 lease 가 씌운 래퍼다. 이중 반납 신호(드라이버의 'Connection
// already released')도 그대로 올라온다.
exports.release = function (conn) {
    facade.release(conn);
};

// 이미 완성된 SQL 문자열을 실행한다. sql_action 의 아직 안 옮긴 함수들이 쓴다.
//
// 예전에는 여기서 **무조건 MySQL 로** 보냈다. 어느 백엔드를 골랐든 그랬다.
// 그래서 SQLite 모드로 돌려도 이 경로의 질의는 전부 MySQL 에 나갔다 —
// 그 상태를 기록해 둔 주석이 sql_action 에 여럿 있다.
// 이제 고른 백엔드로 간다.
exports.getResult = function (query, connection, callback) {
    facade.execRaw(query, connection, callback);
};


