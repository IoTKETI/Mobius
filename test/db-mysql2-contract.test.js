'use strict';
/*
 * mysql2 로 옮기면서 드라이버가 바뀌어도 지켜야 하는 계약.
 *
 * ── 왜 이 파일이 따로 필요한가 ───────────────────────────────────────────
 * `npm test` 는 SQLite 로 돈다. MySQL 경로의 드라이버 차이는 **시험에 안
 * 걸린다.** 그래서 mysql -> mysql2 교체는 코드 정독과 격리 실험으로만
 * 검증할 수 있었고, 그 과정에서 워커를 죽일 수 있는 결함 하나가 나왔다.
 *
 * 여기 있는 것은 그 결함들이 되살아나는 것을 막는 그물이다. 실제 DB 없이
 * 가짜 handle 로 어댑터의 계약만 본다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADAPTER_SRC = fs.readFileSync(path.join(ROOT, 'mobius', 'db', 'mysql.js'), 'utf8');

// 어댑터는 require 시점에 드라이버를 부른다. 소스만 보는 시험과
// 실제로 execute 를 부르는 시험을 나눠 둔다.
function loadAdapter() {
    delete require.cache[require.resolve('../mobius/db/mysql')];
    return require('../mobius/db/mysql');
}

/* ── 실행 줄만 본다 (주석에 적힌 옵션 이름에 속지 않기 위해) ────────────── */
function liveLines(src) {
    return src.split(/\r?\n/).filter(function (l) {
        return !/^\s*(\/\/|\*|\/\*)/.test(l);
    });
}

test('질의 콜백은 드라이버가 두 번 불러도 한 번만 통과한다', function (t, done) {
    // ── 이것이 이 교체에서 가장 위험한 자리다 ────────────────────────────
    //
    // mysql 2.18.1 은 드라이버 타임아웃 에러에 fatal=true 를 달아 커넥션을
    // 파기한다(lib/protocol/Protocol.js:162-163). 그래서 콜백이 한 번만
    // 불린다. mysql2 3.24.3 은 fatal 을 안 달고 명령을 큐에서 빼지도 않아
    // (lib/commands/query.js:349-364), 타임아웃으로 한 번 + 나중에 실제
    // 응답이 오면 또 한 번 부른다.
    //
    // 격리 환경에서 가짜 MySQL 서버로 실측한 결과:
    //   mysql  / 타임아웃 뒤 소켓 끊김  -> cb 1회
    //   mysql2 / 타임아웃 뒤 소켓 끊김  -> cb 2회
    //   mysql2 / 타임아웃 뒤 ERR 패킷   -> cb 2회
    //
    // 두 번째 호출이 어디까지 가는지도 실제 저장소 파일로 추적했다:
    //   db/mysql.js -> db/index.js -> sql_action.js delete_lookup_action
    //   -> resource.js -> **db.release(connection) 이 두 번**
    //
    // CLAUDE.md 의 콜백 계약("once() 로 감싸거나 settle 을 쓴다")이 이미
    // 요구하는 모양인데 db 경로에만 빠져 있었다.
    const adapter = loadAdapter();

    let calls = 0;
    const handle = {
        query: function (q, cb) {
            // mysql2 가 하는 짓을 그대로 흉내낸다 — 두 번 부른다.
            const timeoutErr = new Error('Query inactivity timeout');
            timeoutErr.code = 'PROTOCOL_SEQUENCE_TIMEOUT';
            cb(timeoutErr, null);
            cb(null, [{ ri: 'late' }]);
        },
        destroy: function () {}
    };

    adapter.execute(handle, 'select 1', [], function () {
        calls++;
    });

    setTimeout(function () {
        assert.strictEqual(calls, 1,
            '콜백이 ' + calls + '번 불렸다 — 두 번 불리면 커넥션이 두 번 반납되고 워커가 죽는다');
        done();
    }, 30);
});

test('드라이버 타임아웃이면 커넥션을 파기한다', function (t, done) {
    // once 는 그물이지 원인 수정이 아니다. mysql2 는 타임아웃 뒤에도 명령을
    // 큐에 남겨 두므로, 그 커넥션이 풀로 돌아가면 **다음에 빌린 요청의 질의가
    // 앞선 문장이 끝날 때까지 큐에서 대기한다.** mysql 2.18.1 은 fatal=true 로
    // 그 커넥션을 풀에서 빼 버려 이런 일이 없었다.
    //
    // 어댑터가 직접 destroy 해서 그 의미를 되살린다. destroy 는 PoolConnection
    // 을 풀에서도 빼므로 이후의 release 는 무해하게 반환된다.
    const adapter = loadAdapter();

    let destroyed = false;
    const handle = {
        query: function (q, cb) {
            const e = new Error('Query inactivity timeout');
            e.code = 'PROTOCOL_SEQUENCE_TIMEOUT';
            cb(e, null);
        },
        destroy: function () { destroyed = true; }
    };

    adapter.execute(handle, 'select 1', [], function (err) {
        assert.ok(err, '타임아웃은 에러로 올라와야 한다');
        setTimeout(function () {
            assert.ok(destroyed,
                '타임아웃인데 커넥션을 파기하지 않았다 — 명령이 남은 커넥션이 풀로 돌아간다');
            done();
        }, 10);
    });
});

test('타임아웃이 아닌 에러는 커넥션을 파기하지 않는다', function (t, done) {
    // 중복 키 같은 평범한 에러까지 커넥션을 버리면 풀이 계속 새로 맺는다.
    const adapter = loadAdapter();

    let destroyed = false;
    const handle = {
        query: function (q, cb) {
            const e = new Error('Duplicate entry');
            e.code = 'ER_DUP_ENTRY';
            cb(e, null);
        },
        destroy: function () { destroyed = true; }
    };

    adapter.execute(handle, 'insert', [], function (err) {
        assert.ok(err);
        setTimeout(function () {
            assert.strictEqual(destroyed, false,
                '평범한 질의 에러에 커넥션을 버렸다 — 풀이 매번 새로 맺게 된다');
            done();
        }, 10);
    });
});

test('정상 응답은 그대로 통과한다', function (t, done) {
    const adapter = loadAdapter();
    const rows = [{ ri: 'x' }];
    const handle = {
        query: function (q, cb) { cb(null, rows); },
        destroy: function () { assert.fail('정상인데 커넥션을 파기했다'); }
    };
    adapter.execute(handle, 'select 1', [], function (err, out) {
        assert.strictEqual(err, null);
        assert.deepStrictEqual(out, rows);
        done();
    });
});

test('풀 설정이 드라이버 기본값에 기대지 않는다', function () {
    const live = liveLines(ADAPTER_SRC).join('\n');

    // ── decimalNumbers ───────────────────────────────────────────────────
    // MySQL 은 정수 컬럼의 SUM() 을 NEWDECIMAL 로 돌려준다. mysql 2.18.1 은
    // 그것을 Number 로 캐스팅하는데(RowDataPacket.js:96-104), mysql2 는
    // decimalNumbers 기본값 false 라 **문자열**로 낸다
    // (lib/parsers/text_parser.js:51-56).
    //
    // 스키마에 DECIMAL 컬럼은 하나도 없지만 SUM() 이 그 통로다. 실측:
    //   mysql  : [{"sum(cbs)":21048}]
    //   mysql2 : [{"sum(cbs)":"21048"}]
    // GET /total_cbs 가 이 행을 responder 를 안 거치고 JSON.stringify 로
    // 직송하므로(app.js), 응답의 숫자가 문자열로 바뀐다.
    assert.ok(/decimalNumbers\s*:\s*true/.test(live),
        'decimalNumbers: true 가 없다 — SUM() 결과가 숫자에서 문자열로 바뀐다');

    // ── charset ──────────────────────────────────────────────────────────
    // 두 드라이버의 기본 커넥션 문자셋이 다르다. 실측:
    //   mysql  charsetNumber 33  -> utf8mb3 / utf8mb3_general_ci
    //   mysql2 charsetNumber 224 -> utf8mb4 / utf8mb4_unicode_ci
    // 스키마는 utf8mb3(mobiusdb.sql 의 CHARSET=utf8)이다. 커넥션이 utf8mb4 가
    // 되면 4바이트 문자가 든 바인딩이 utf8mb3 컬럼과 비교될 때 0행이 아니라
    // ER_CANT_AGGREGATE_2COLLATIONS(1267) 로 터진다.
    //
    // 도달 경로는 discovery 질의문자열이다 — Express 의 query parser 가
    // 퍼센트 인코딩을 디코딩하므로 ?lbl=%F0%9F%98%80 이 4바이트로 들어온다.
    // (리소스 경로는 도달하지 못한다: Node 가 원시 바이트를 400 으로 끊고,
    //  퍼센트 인코딩은 안 풀린다)
    assert.ok(/charset\s*:/.test(live),
        'charset 을 명시하지 않았다 — 드라이버 기본값이 바뀌면 커넥션 콜레이션이 따라 바뀐다');

    // ── acquireTimeout ───────────────────────────────────────────────────
    // mysql2 에 없는 옵션이다. 만나면 커넥션 설정마다 경고를 stderr 에 찍고
    // 값을 버린다 — 워커 25개가 기동 때마다 줄을 뿌린다.
    assert.strictEqual(/acquireTimeout\s*:/.test(live), false,
        'acquireTimeout 이 남아 있다 — mysql2 는 이 키를 버리면서 경고를 찍는다');
});

test('어댑터가 mysql2 를 쓴다', function () {
    const live = liveLines(ADAPTER_SRC).join('\n');
    assert.ok(/require\(['"]mysql2['"]\)/.test(live),
        "어댑터가 mysql2 를 require 하지 않는다");
    assert.strictEqual(/require\(['"]mysql['"]\)/.test(live), false,
        "옛 mysql 드라이버 require 가 남아 있다");
});
