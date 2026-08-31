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

// **파사드 위의 껍데기다.** 자기 sqlite 핸들을 갖지 않는다.
//
// 예전에는 여기서 sqlite3.Database 를 직접 열었다. 그런데 파사드의 sqlite
// 어댑터(mobius/db/sqlite.js)도 같은 파일을 연다 — **한 프로세스에 같은 DB
// 파일 핸들이 둘 열려 있었다.** (기동 로그에 'Connected to the mobius
// database.' 와 '[db/sqlite] connected' 가 나란히 찍혔다.)
//
// 스키마 초기화도 두 번 돌았고, 전환된 함수와 안 된 함수가 서로 다른 핸들로
// 같은 파일에 썼다. 커넥션 원천을 파사드로 옮기면서 이 모듈의 핸들은
// 아무도 열어 주지 않게 되었고, 그래서 남은 두 호출부(cnt_man 의 카운터
// 갱신, sql_action 의 delete_oldest)가 'sqlite is not connected' 로 깨졌다.
//
// 핸들을 되살리는 대신 파사드로 태운다 — 핸들이 하나가 되고, 남은 두
// 호출부가 어댑터 메서드로 옮겨가면 이 파일은 사라진다.
var facade = require('./db');

exports.connect = function (callback) {
    // 파사드가 이미 열었다. 옛 호출부 호환을 위해 성공만 알린다.
    callback('1');
};

exports.getConnection = function (callback) {
    facade.getConnection(callback);
};

exports.getResult = function (query, connection, callback) {
    facade.execRaw(query, connection, callback);
};
