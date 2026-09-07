'use strict';
// Runs the retention sweep (purge_sweep) against a real SQLite file.
//
// A mocked adapter only records SQL and never executes it, so a query reading a column that does not exist in the schema passes silently. Checked here:
//   1) the queries run against the real schema (columns exist, joins hold)
//   2) the limit comparison is numeric (in a TEXT schema '9' > '10' is true)
//   3) counters are corrected from a real count after deletion
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), 'mobius-purge-sweep-test.db');

// The adapter reads the path at module load, so it is set before require.
process.env.MOBIUS_SQLITE_PATH = DB_FILE;

let sql_action;
let conn;

test('스윕: 준비 — 빈 SQLite 에 실제 스키마를 올린다', function (t, done) {
    try { fs.unlinkSync(DB_FILE); } catch (e) { /* ignore if missing */ }

    for (const m of ['../mobius/db', '../mobius/db/sqlite', '../mobius/db/mysql',
                     '../mobius/sql_action']) {
        delete require.cache[require.resolve(m)];
    }
    global.usedb = 'sqlite';
    global.usedb = 'sqlite';

    const db = require('../mobius/db');
    db.connect(function (code) {
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

// The facade contract on failure is cb(true, err); the second argument is the reason.
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
    return "insert into lookup (pi, ri, ty, ct, st, rn, lt, et, acpi, lbl, at, aa, sri, spi) " +
           "values ('" + pi + "', '" + ri + "', " + ty + ", '" + ct + "', 0, '" +
           ri.split('/').pop() + "', '" + ct + "', '99991231T235959', '', '', '', '', '', '')";
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
                // delete_oldest derives the child type as ty+1. Without ty it becomes NaN.
                assert.strictEqual(String(found[0].ty), '3',
                    'ty 를 못 가져왔다 — cnt 에는 없고 lookup 에만 있다');
                done();
            } catch (x) { done(x); }
        });
    });
});

// cni/mni are TEXT in the SQLite schema. Comparing without a cast is lexicographic, so '9' > '10' is true and a container within its limit is selected for cleanup.
test('스윕: 한도 판정이 사전순이 아니라 수치다', function (t, done) {
    seed([
        lookupRow('/M/lex', '/M', '3', '20260101T000003'),
        cntRow('/M/lex', 9, 90, 10, 1000000)          // 9 < 10, so not a target
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

// Count gate before deletion.
//
// If the number of rows to delete were derived from the stored value (cnt.cni), an inflated value would delete live CINs in a container within its limit. Deleting from lookup cascades to the cin body (cin_ri ON DELETE CASCADE) and cannot be undone.
//
// The stored value can be inflated: delete_lookup_et and delete_descendants_background delete lookup rows without decrementing cnt. The real count must therefore be taken before deleting.

test('관문: 저장 cni 가 부풀어 있어도 한도 안이면 한 건도 안 지운다', function (t, done) {
    // 5 real children, mni=10 (within the limit), but cnt.cni is inflated to 50. Trusting the stored value would try to delete 40 and, with only 5 candidates, delete all of them.
    const rows = [
        lookupRow('/M/drift', '/M', '3', '20260101T000100'),
        cntRow('/M/drift', 50, 500, 10, 1000000)          // stored value larger than the real count (5)
    ];
    for (let i = 0; i < 5; i++) {
        const ri = '/M/drift/c' + i;
        rows.push(lookupRow(ri, '/M/drift', '4', '20260101T0001' + (10 + i)));
        rows.push(cinRow(ri, '/M/drift', 10));
    }

    seed(rows, function (err) {
        if (err) { return done(err); }
        sql_action.purge_sweep(conn, { limit: 100 }, function (e, report) {
            if (e) { return done(new Error('스윕 실패: ' + JSON.stringify(report))); }
            try {
                assert.strictEqual(report.scanned, 1, '부풀린 저장값으로 잡히긴 해야 한다');
                assert.strictEqual(report.deleted, 0,
                    '한도 안(5 <= 10)인데 ' + report.deleted + '건을 지웠다 — 실측 관문이 없다');
            } catch (x) { return done(x); }

            const db = require('../mobius/db');
            db.execRaw("select count(*) as n from lookup where pi = '/M/drift' and ty = 4",
                conn, function (e2, left) {
                    try {
                        assert.strictEqual(parseInt(left[0].n, 10), 5, '자식이 사라졌다');
                        done();
                    } catch (x) { done(x); }
                });
        });
    });
});

test('관문: 그 김에 어긋난 저장값을 실측으로 고쳐 둔다', function (t, done) {
    const db = require('../mobius/db');
    db.execRaw("select cni, cbs from cnt where ri = '/M/drift'", conn, function (e, rows) {
        try {
            assert.strictEqual(e, null);
            assert.strictEqual(parseInt(rows[0].cni, 10), 5,
                '드리프트가 그대로다 — 다음 스윕이 또 헛돈다');
            assert.strictEqual(parseInt(rows[0].cbs, 10), 50);
            done();
        } catch (x) { done(x); }
    });
});

test('관문: 실측이 진짜 초과면 초과분만 지운다', function (t, done) {
    // 8 real children, mni=3: only the 5 in excess may be deleted. The stored value is deliberately inflated to 100; deleting by that value would remove all 8.
    const rows = [
        lookupRow('/M/over2', '/M', '3', '20260101T000200'),
        cntRow('/M/over2', 100, 1000, 3, 1000000)
    ];
    for (let i = 0; i < 8; i++) {
        const ri = '/M/over2/c' + i;
        rows.push(lookupRow(ri, '/M/over2', '4', '20260101T0002' + (10 + i)));
        rows.push(cinRow(ri, '/M/over2', 10));
    }

    seed(rows, function (err) {
        if (err) { return done(err); }
        sql_action.purge_sweep(conn, { limit: 100 }, function (e, report) {
            if (e) { return done(new Error('스윕 실패: ' + JSON.stringify(report))); }
            try {
                assert.strictEqual(report.deleted, 5,
                    '초과분은 5건인데 ' + report.deleted + '건을 지웠다');
            } catch (x) { return done(x); }

            const db = require('../mobius/db');
            db.execRaw("select cni, cbs from cnt where ri = '/M/over2'", conn,
                function (e2, c) {
                    try {
                        assert.strictEqual(parseInt(c[0].cni, 10), 3, '남은 수가 한도와 다르다');
                        assert.strictEqual(parseInt(c[0].cbs, 10), 30);
                        done();
                    } catch (x) { done(x); }
                });
        });
    });
});

test('관문: 한도를 모르면 한 건도 안 지운다', function (t, done) {
    // If select_over_limit omits mni/mbs or returns NULL, parseInt yields NaN. If the gate then switched off silently it would delete count rows without basis. delete_oldest is reachable only through purge_sweep, so select_over_limit is temporarily replaced to pass a row without mni.
    const orig = sql_action.select_over_limit;
    sql_action.select_over_limit = function (c, lim, cb) {
        cb(null, [{ ri: '/M/nolimit', ty: 3, cni: 9, cbs: 90, mni: null, mbs: null }]);
    };

    // cin.pi references cnt.ri; without a cnt row the child insert is blocked by the FK. The stored values are irrelevant because the stub above replaces select_over_limit, so delete_oldest receives mni/mbs as null.
    const rows = [
        lookupRow('/M/nolimit', '/M', '3', '20260101T000400'),
        cntRow('/M/nolimit', 9, 90, 1000000, 1000000)
    ];
    for (let i = 0; i < 4; i++) {
        const ri = '/M/nolimit/c' + i;
        rows.push(lookupRow(ri, '/M/nolimit', '4', '20260101T0004' + (10 + i)));
        rows.push(cinRow(ri, '/M/nolimit', 10));
    }

    seed(rows, function (err) {
        if (err) { sql_action.select_over_limit = orig; return done(err); }
        sql_action.purge_sweep(conn, { limit: 100 }, function (e, report) {
            sql_action.select_over_limit = orig;
            try {
                assert.strictEqual(e, null);
                assert.strictEqual(report.deleted, 0,
                    '한도를 모르는데 ' + report.deleted + '건을 지웠다');
                done();
            } catch (x) { done(x); }
        });
    });
});

test('관문: 용량 초과는 실제 cs 를 누적해 필요한 만큼만 자른다', function (t, done) {
    // cs values are deliberately uneven: the two oldest are large, the rest small.
    //   [200, 200, 50, 50, 50, 50] = 600,  mbs = 350  ->  250 bytes must be freed.
    //
    // purge_plan cannot see the real cs and estimates from the average:
    //   avg_cs = ceil(600/6) = 100,  by_size = ceil(250/100) = 3  ->  est_count 3
    // Deleting only the two oldest frees 400 bytes, which is enough. Deleting est_count rows without accumulating the candidates' cs would delete one row too many.
    const cs_list = [200, 200, 50, 50, 50, 50];
    const rows = [
        lookupRow('/M/bytes', '/M', '3', '20260101T000300'),
        cntRow('/M/bytes', 6, 600, 1000000, 350)
    ];
    cs_list.forEach(function (cs, i) {
        const ri = '/M/bytes/c' + i;
        rows.push(lookupRow(ri, '/M/bytes', '4', '20260101T0003' + (10 + i)));
        rows.push(cinRow(ri, '/M/bytes', cs));
    });

    seed(rows, function (err) {
        if (err) { return done(err); }
        sql_action.purge_sweep(conn, { limit: 100 }, function (e, report) {
            if (e) { return done(new Error('스윕 실패: ' + JSON.stringify(report))); }
            try {
                assert.strictEqual(report.deleted, 2,
                    'cs 를 누적해 잘랐다면 2건이다 (지운 건수 ' + report.deleted +
                    ') — 3건이면 추정치를 그대로 쓴 것이다');
            } catch (x) { return done(x); }

            const db = require('../mobius/db');
            db.execRaw("select cni, cbs from cnt where ri = '/M/bytes'", conn,
                function (e2, c) {
                    try {
                        assert.strictEqual(parseInt(c[0].cni, 10), 4);
                        assert.strictEqual(parseInt(c[0].cbs, 10), 200,
                            'cbs 가 한도(350) 안으로 안 내려왔다');
                        done();
                    } catch (x) { done(x); }
                });
        });
    });
});
