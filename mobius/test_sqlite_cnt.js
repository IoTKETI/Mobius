/**
 * test_sqlite_cnt.js
 * Purpose: Verify SQLite migration for CNT (Container) resource.
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

// 2. AE (Parent of CNT)
var ae_obj = {
    pi: '/Mobius',
    ri: '/Mobius/ae_cnt_test',
    ty: '2',
    ct: '20250101T000000', st: '0', rn: 'ae_cnt_test', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [],
    apn: 'myCntTestApp', api: 'NmyCntTestApp', aei: 'Sae_cnt_test', poa: [], or: '', rr: 'true', nl: '', csz: 'application/json', srv: []
};

// 3. CNT (Target)
var cnt_obj = {
    pi: '/Mobius/ae_cnt_test',
    ri: '/Mobius/ae_cnt_test/cnt1',
    ty: '3',
    ct: '20250101T000000', st: '0', rn: 'cnt1', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [],
    cr: 'ae_cnt_test', mni: '3153600000', mbs: '3153600000', mia: '31536000', cni: '0', cbs: '0', li: '31536000', or: '', disr: 'false'
};

function runTest() {
    console.log('--- Starting SQLite CNT Verification ---');

    db_sqlite.connect(function (err) {
        if (err) {
            console.error('Failed to connect to SQLite');
            return;
        }

        cleanUp(function () {
            console.log('[1] Cleanup complete.');

            // Insert CB
            sql_action.insert_cb(null, cb_obj, function (err, result) {
                if (err) console.error('[WARN] insert_cb failed (may exist):', err); // Proceed anyway as it might exist

                // Insert AE
                sql_action.insert_ae(null, ae_obj, function (err, result) {
                    if (err) { console.error('[FAIL] insert_ae:', err); return; }
                    console.log('[PASS] insert_ae');

                    // Insert CNT
                    sql_action.insert_cnt(null, cnt_obj, function (err, result) {
                        if (err) { console.error('[FAIL] insert_cnt:', err); return; }
                        console.log('[PASS] insert_cnt');

                        // Select CNT (Generic)
                        sql_action.select_resource_from_url(null, cnt_obj.ri, '', function (err, result) {
                            if (err || result.length === 0) {
                                console.error('[FAIL] select_resource_from_url (CNT):', err);
                                return;
                            }
                            console.log('[PASS] select_resource_from_url (CNT) found:', result[0].ri);

                            // Optional: Verify specific fields if needed
                            if (result[0].mni === cnt_obj.mni) {
                                console.log('[PASS] CNT data integrity check (mni)');
                            } else {
                                console.error('[FAIL] CNT data integrity check (mni mismatch)');
                            }

                            // Clean up
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
}

function cleanUp(cb) {
    var sqlite = require('./db_sqlite');
    // Simple direct delete for test isolation
    var queries = [
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
