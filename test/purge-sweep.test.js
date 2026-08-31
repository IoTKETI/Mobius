'use strict';
// 보존 정책 스윕(purge_sweep)을 **진짜 SQLite 파일**에 대고 돌린다.
//
// 어댑터를 모킹한 테스트로는 이 파일이 잡는 것을 못 잡는다. 실제로
// select_over_limit 은 cnt 에 없는 ty 를 읽고 있었고, 모킹 tap 은 SQL 을
// 기록만 할 뿐 실행하지 않으므로 조용히 통과했다. 배포에 올리고 나서야
// `[purge_sweep] 실패: SQLITE_ERROR: no such column: ty` 로 드러났을 것이다.
//
// 여기서 보는 것 세 가지:
//   1) 질의가 실제 스키마에 대고 돈다 (컬럼이 있고 조인이 성립한다)
//   2) 한도 판정이 수치 비교다 (TEXT 스키마에서 '9' > '10' 이 참이 되는 함정)
//   3) 지운 뒤 카운터가 실측으로 맞춰진다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), 'mobius-purge-sweep-test.db');

// 어댑터가 모듈 로드 시점에 경로를 읽으므로 require 보다 먼저 정한다.
process.env.MOBIUS_SQLITE_PATH = DB_FILE;

let sql_action;
let conn;

test('스윕: 준비 — 빈 SQLite 에 실제 스키마를 올린다', function (t, done) {
    try { fs.unlinkSync(DB_FILE); } catch (e) { /* 없으면 그만 */ }

    for (const m of ['../mobius/db', '../mobius/db/sqlite', '../mobius/db/mysql',
                     '../mobius/sql_action']) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'sqlite';
    global.usesqlite = 'true';

    const db = require('../mobius/db');
    db.connect('h', 0, 'u', 'p', function (code) {
        try {
            assert.strictEqual(code, '1', 'SQLite 연결/스키마 초기화 실패');
            db.getConnection(function (c, handle) {
                assert.strictEqual(c, '200');
                conn = handle;
                sql_action = require('../mobius/sql_action');
                done();
            });
        } catch (e) { done(e); }
    });
});

// 파사드 계약은 실패 시 cb(true, err) 라 두 번째 인자가 사유다.
function seed(rows, cb) {
    const db = require('../mobius/db');
    let i = 0;
    (function next() {
        if (i >= rows.length) { return cb(null); }
        const r = rows[i];
        i++;
        db.execRaw(r, conn, function (e, res) {
            if (e) { return cb(new Error(((res && res.message) || res) + ' — ' + r)); }
            next();
        });
    })();
}

function lookupRow(ri, pi, ty, ct) {
    return "insert into lookup (pi, ri, ty, ct, st, rn, lt, et, acpi, lbl, at, aa, sri, spi, subl) " +
           "values ('" + pi + "', '" + ri + "', " + ty + ", '" + ct + "', 0, '" +
           ri.split('/').pop() + "', '" + ct + "', '99991231T235959', '', '', '', '', '', '', '')";
}

function cinRow(ri, pi, cs) {
    return "insert into cin (ri, pi, cr, cnf, cs, \"or\", con) " +
           "values ('" + ri + "', '" + pi + "', '', 'text/plain:0', '" + cs + "', '', 'x')";
}

function cntRow(ri, cni, cbs, mni, mbs) {
    return "insert into cnt (ri, cr, mni, mbs, mia, cni, cbs, li, \"or\", disr) " +
           "values ('" + ri + "', '', '" + mni + "', '" + mbs + "', '0', '" +
           cni + "', '" + cbs + "', '', '', '0')";
}

test('스윕: 한도를 넘긴 컨테이너를 실제 스키마에서 찾아낸다', function (t, done) {
    // over: cni 12 > mni 10.  ok: cni 2 <= mni 10.
    const rows = [
        lookupRow('/M', '', '5', '20260101T000000'),
        lookupRow('/M/over', '/M', '3', '20260101T000001'),
        cntRow('/M/over', 12, 120, 10, 1000000),
        lookupRow('/M/ok', '/M', '3', '20260101T000002'),
        cntRow('/M/ok', 2, 20, 10, 1000000)
    ];
    for (let i = 0; i < 12; i++) {
        const ri = '/M/over/c' + i;
        rows.push(lookupRow(ri, '/M/over', '4', '20260101T0000' + (10 + i)));
        rows.push(cinRow(ri, '/M/over', 10));
    }

    seed(rows, function (err) {
        if (err) { return done(err); }
        sql_action.select_over_limit(conn, 100, function (e, found) {
            try {
                assert.strictEqual(e, null, '질의가 실패했다: ' + JSON.stringify(found));
                assert.strictEqual(found.length, 1, '한도 초과 1건이어야 한다: ' +
                    JSON.stringify(found));
                assert.strictEqual(found[0].ri, '/M/over');
                // delete_oldest 가 자식 타입을 ty+1 로 구한다. ty 가 없으면 NaN 이 된다.
                assert.strictEqual(String(found[0].ty), '3',
                    'ty 를 못 가져왔다 — cnt 에는 없고 lookup 에만 있다');
                done();
            } catch (x) { done(x); }
        });
    });
});

// SQLite 스키마는 cni/mni 가 TEXT 다. 캐스팅 없이 비교하면 사전순이라
// '9' > '10' 이 참이 되어 한도 안인 컨테이너가 정리 대상으로 잡힌다.
test('스윕: 한도 판정이 사전순이 아니라 수치다', function (t, done) {
    seed([
        lookupRow('/M/lex', '/M', '3', '20260101T000003'),
        cntRow('/M/lex', 9, 90, 10, 1000000)          // 9 < 10 이니 대상이 아니다
    ], function (err) {
        if (err) { return done(err); }
        sql_action.select_over_limit(conn, 100, function (e, found) {
            try {
                const hit = found.filter(function (r) { return r.ri === '/M/lex'; });
                assert.deepStrictEqual(hit, [],
                    "cni='9', mni='10' 인데 초과로 잡혔다 — 사전순 비교다");
                done();
            } catch (x) { done(x); }
        });
    });
});

test('스윕: 오래된 것부터 지우고 카운터를 실측으로 맞춘다', function (t, done) {
    sql_action.purge_sweep(conn, { limit: 100 }, function (err, report) {
        if (err) { return done(new Error('스윕 실패: ' + JSON.stringify(report))); }
        try {
            assert.strictEqual(report.failed, 0, '실패 건이 있다');
            assert.strictEqual(report.purged, 1, '정리한 컨테이너가 1개여야 한다');
            assert.strictEqual(report.deleted, 2, '초과분 2건을 지워야 한다');
        } catch (x) { return done(x); }

        const db = require('../mobius/db');
        db.execRaw("select cni, cbs from cnt where ri = '/M/over'", conn,
            function (e, rows) {
                try {
                    assert.strictEqual(e, null);
                    assert.strictEqual(parseInt(rows[0].cni, 10), 10,
                        '삭제 후 cni 가 실측으로 맞춰지지 않았다');
                    assert.strictEqual(parseInt(rows[0].cbs, 10), 100,
                        '삭제 후 cbs 가 실측으로 맞춰지지 않았다');
                    done();
                } catch (x) { done(x); }
            });
    });
});

test('스윕: 가장 오래된 것이 지워졌다 (ct 오름차순)', function (t, done) {
    const db = require('../mobius/db');
    db.execRaw("select ri from lookup where pi = '/M/over' and ty = '4' order by ct asc",
        conn, function (e, rows) {
            try {
                assert.strictEqual(e, null);
                const left = rows.map(function (r) { return r.ri; });
                assert.strictEqual(left.length, 10);
                assert.ok(left.indexOf('/M/over/c0') < 0, 'c0(가장 오래됨)이 남아 있다');
                assert.ok(left.indexOf('/M/over/c1') < 0, 'c1(두 번째)이 남아 있다');
                assert.ok(left.indexOf('/M/over/c2') >= 0, 'c2 까지 지웠다 — 2건만 지워야 한다');
                done();
            } catch (x) { done(x); }
        });
});

test('스윕: FK CASCADE 로 cin 본문도 같이 지워졌다', function (t, done) {
    const db = require('../mobius/db');
    db.execRaw("select count(*) as n from cin where pi = '/M/over'", conn,
        function (e, rows) {
            try {
                assert.strictEqual(e, null);
                assert.strictEqual(parseInt(rows[0].n, 10), 10,
                    'lookup 만 지워지고 cin 본문이 남았다 — FK CASCADE 확인');
                done();
            } catch (x) { done(x); }
        });
});

test('스윕: 한도 안이면 아무것도 안 한다', function (t, done) {
    sql_action.purge_sweep(conn, { limit: 100 }, function (err, report) {
        try {
            assert.strictEqual(err, null);
            assert.strictEqual(report.scanned, 0, '방금 정리했는데 또 대상이 잡혔다');
            assert.strictEqual(report.deleted, 0);
            done();
        } catch (x) { done(x); }
    });
});
