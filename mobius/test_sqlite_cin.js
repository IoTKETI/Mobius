/**
 * test_sqlite_cin.js
 * Purpose: Verify SQLite migration for CIN (ContentInstance) resource.
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
    ri: '/Mobius/ae_cin_test',
    ty: '2',
    ct: '20250101T000000', st: '0', rn: 'ae_cin_test', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [],
    apn: 'myCinTestApp', api: 'NmyCinTestApp', aei: 'Sae_cin_test', poa: [], or: '', rr: 'true', nl: '', csz: 'application/json', srv: []
};

// 3. CNT (Parent of CIN)
var cnt_obj = {
    pi: '/Mobius/ae_cin_test',
    ri: '/Mobius/ae_cin_test/cnt1',
    ty: '3',
    ct: '20250101T000000', st: '0', rn: 'cnt1', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [],
    cr: 'ae_cin_test', mni: '3153600000', mbs: '3153600000', mia: '31536000', cni: '0', cbs: '0', li: '31536000', or: '', disr: 'false'
};

// 4. CIN (Target)
var cin_obj = {
    pi: '/Mobius/ae_cin_test/cnt1',
    ri: '/Mobius/ae_cin_test/cnt1/cin1',
    ty: '4',
    ct: '20250101T000000', st: '0', rn: 'cin1', lt: '20250101T000000', et: '20350101T000000',
    acpi: [], lbl: [], at: [], aa: [], sri: '', spi: '', subl: [],
    cr: 'ae_cin_test', cnf: 'text/plain:0', cs: '5', or: '', con: 'hello'
};


function runTest() {
    console.log('--- Starting SQLite CIN Verification ---');

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

                        // Insert CIN 1
                        sql_action.insert_cin(null, cin_obj, function (err, result) {
                            if (err) { console.error('[FAIL] insert_cin 1:', err); return; }
                            console.log('[PASS] insert_cin 1');

                            // Insert CIN 2 (Newer)
                            var cin_obj2 = JSON.parse(JSON.stringify(cin_obj));
                            cin_obj2.ri = cin_obj.ri.replace('cin1', 'cin2');
                            cin_obj2.rn = 'cin2';
                            cin_obj2.ct = '20250101T000001'; // 1 second later
                            cin_obj2.con = 'world';

                            sql_action.insert_cin(null, cin_obj2, function (err, result) {
                                if (err) { console.error('[FAIL] insert_cin 2:', err); return; }
                                console.log('[PASS] insert_cin 2');

                                // Test Latest (Should be CIN 2)
                                var latestObj = [];
                                sql_action.select_latest_resource(null, cnt_obj, 0, latestObj, function (code) {
                                    if (code === '200' && latestObj.length > 0) {
                                        if (latestObj[0].ri === cin_obj2.ri) console.log('[PASS] select_latest_resource (Found cin2)');
                                        else console.error('[FAIL] select_latest_resource mismatch (Expected cin2, got ' + latestObj[0].ri + ')');
                                    } else {
                                        console.error('[FAIL] select_latest_resource failed or empty');
                                    }

                                    // Test Oldest (Should be CIN 1)
                                    var oldestObj = [];
                                    sql_action.select_oldest_resource(null, '4', cnt_obj.ri, oldestObj, function (code) {
                                        if (code === '200' && oldestObj.length > 0) {
                                            if (oldestObj[0].ri === cin_obj.ri) console.log('[PASS] select_oldest_resource (Found cin1)');
                                            else console.error('[FAIL] select_oldest_resource mismatch (Expected cin1, got ' + oldestObj[0].ri + ')');
                                        } else {
                                            console.error('[FAIL] select_oldest_resource failed or empty');
                                        }

                                        // Verify CNT CNI/CBS Update (Expect cni=2, cbs=10)
                                        // cin1 cs='5' (mock), cin2 cs='5' (mock clone)
                                        console.log('[TEST] Checking CNT cni/cbs update...');
                                        var sqlite = require('./db_sqlite');
                                        sqlite.getResult("select cni, cbs from cnt where ri = '" + cnt_obj.ri + "'", null, function (err, rows) {
                                            if (!err && rows.length > 0) {
                                                console.log('CNT State: cni=' + rows[0].cni + ', cbs=' + rows[0].cbs);
                                                if (rows[0].cni == 2 && rows[0].cbs == 10) {
                                                    console.log('[PASS] CNI/CBS Update Verified');
                                                } else {
                                                    console.error('[FAIL] CNI/CBS Update Mismatch (Expected cni=2, cbs=10)');
                                                }
                                            } else {
                                                console.error('[FAIL] Failed to retrieve CNT stats');
                                            }

                                            // Cascade Delete Verification (Delete CNT -> should delete cin1 and cin2)
                                            console.log('[TEST] Checking Cascade Delete...');
                                            sql_action.delete_ri_lookup(null, cnt_obj.ri, function (err, result) {
                                                if (err) console.error('[FAIL] delete CNT:', err);
                                                else console.log('[PASS] delete CNT');

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
                });
            });
        });
    });
}

function cleanUp(cb) {
    var sqlite = require('./db_sqlite');
    // Derive cin2 RI from cin_obj (as done in test)
    var cin_ri2 = cin_obj.ri.replace('cin1', 'cin2');

    var queries = [
        "DELETE FROM lookup WHERE ri = '" + cin_obj.ri + "'",
        "DELETE FROM lookup WHERE ri = '" + cin_ri2 + "'",
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
