/**
 * test_sqlite_sub.js
 * Purpose: Verify SQLite migration for SUB (Subscription) resource.
 */

var sqlite3 = require('sqlite3').verbose();
var db_sqlite = require('./db_sqlite');
var sql_action = require('./sql_action');
var util = require('util');

// Set global flag
global.usesqlite = 'true';

// Mock objects
// 1. CB (Root)
var cb_obj = {
    pi: '',
    ri: '/Mobius', ty: '5', ct: '20250101T000000', st: '0', rn: 'Mobius', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [], cst: '1', csi: '/Mobius', srt: ['1'], poa: ['http://127.0.0.1:7579'], nl: '', ncp: '', srv: []
};

// 2. AE
var ae_obj = {
    pi: '/Mobius',
    ri: '/Mobius/ae_sub_test',
    ty: '2',
    ct: '20250101T000000', st: '0', rn: 'ae_sub_test', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [],
    apn: 'mySubTestApp', api: 'NmySubTestApp', aei: 'Sae_sub_test', poa: [], or: '', rr: 'true', nl: '', csz: 'application/json', srv: []
};

// 3. CNT
var cnt_obj = {
    pi: '/Mobius/ae_sub_test',
    ri: '/Mobius/ae_sub_test/cnt_sub',
    ty: '3',
    ct: '20250101T000000', st: '0', rn: 'cnt_sub', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [],
    cr: 'ae_sub_test', mni: '3153600000', mbs: '3153600000', mia: '31536000', cni: '0', cbs: '0', li: '31536000', or: '', disr: 'false'
};

// 4. SUB
var sub_obj = {
    pi: '/Mobius/ae_sub_test/cnt_sub',
    ri: '/Mobius/ae_sub_test/cnt_sub/sub1',
    ty: '23',
    ct: '20250101T000000', st: '0', rn: 'sub1', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [],
    enc: { net: [3] }, // Notification Event Type 3: Create of Direct Child
    exc: 10,
    nu: ['http://localhost:1234/noti'],
    gpi: '', nfu: '', bn: {}, rl: '', psn: '', pn: '', nsp: '', ln: '', nct: '1', nec: '', cr: 'ae_sub_test', su: ''
};

function runTest() {
    console.log('--- Starting SQLite SUB Verification ---');

    db_sqlite.connect(function (err) {
        if (err) {
            console.error('Failed to connect to SQLite');
            return;
        }

        cleanUp(function () {
            console.log('[1] Cleanup complete.');

            // Insert CB
            sql_action.insert_cb(null, cb_obj, function (err, result) {
                if (err) console.error('[WARN] insert_cb failed (may exist):', err);

                // Insert AE
                sql_action.insert_ae(null, ae_obj, function (err, result) {
                    if (err) { console.error('[FAIL] insert_ae:', err); return; }
                    console.log('[PASS] insert_ae');

                    // Insert CNT
                    sql_action.insert_cnt(null, cnt_obj, function (err, result) {
                        if (err) { console.error('[FAIL] insert_cnt:', err); return; }
                        console.log('[PASS] insert_cnt');

                        // Insert SUB
                        sql_action.insert_sub(null, sub_obj, function (err, result) {
                            if (err) { console.error('[FAIL] insert_sub:', err); return; }
                            console.log('[PASS] insert_sub');

                            // Verify SUB in DB
                            var sqlite = require('./db_sqlite');
                            sqlite.getResult("select * from sub where ri = '" + sub_obj.ri + "'", null, function (err, rows) {
                                if (!err && rows.length > 0) {
                                    console.log('[PASS] Select SUB Verified');
                                    console.log(' - NU:', rows[0].nu);
                                    console.log(' - ENC:', rows[0].enc);
                                } else {
                                    console.error('[FAIL] Select SUB Failed');
                                }

                                // Final Cleanup
                                cleanUp(function () {
                                    console.log('[PASS] Final Cleanup');
                                    process.exit(0);
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

function cleanUp(cb) {
    var sqlite = require('./db_sqlite');
    var queries = [
        "DELETE FROM lookup WHERE ri = '" + sub_obj.ri + "'",
        "DELETE FROM lookup WHERE ri = '" + cnt_obj.ri + "'",
        "DELETE FROM lookup WHERE ri = '" + ae_obj.ri + "'"
    ];

    function run(idx) {
        if (idx >= queries.length) return cb();
        sqlite.getResult(queries[idx], null, function (err) {
            run(idx + 1);
        });
    }
    run(0);
}

runTest();
