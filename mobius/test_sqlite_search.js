/**
 * test_sqlite_search.js
 * Purpose: Verify SQLite Recursive Search (CTE) implementation.
 */

var sqlite3 = require('sqlite3').verbose();
var db_sqlite = require('./db_sqlite');
var sql_action = require('./sql_action');
var util = require('util');

// Set global flag
global.usesqlite = 'true';

// Mock Data
var cb_obj = { ri: '/Mobius', ty: '5', rn: 'Mobius', pi: '', ct: '20250101T000000', lt: '20250101T000000', et: '20350101T000000', st: 0, srt: ['1'], subl: [] };
var ae_obj = { ri: '/Mobius/ae_search', ty: '2', rn: 'ae_search', pi: '/Mobius', ct: '20250101T000000', lt: '20250101T000000', et: '20350101T000000', st: 0, lbl: ['search_target'], subl: [] };
var cnt_obj = { ri: '/Mobius/ae_search/cnt_search', ty: '3', rn: 'cnt_search', pi: '/Mobius/ae_search', ct: '20250101T000000', lt: '20250101T000000', et: '20350101T000000', st: 0, lbl: ['search_target', 'container'], subl: [] };

function runTest() {
    console.log('--- Starting SQLite Search Verification ---');

    db_sqlite.connect(function (err) {
        if (err) { console.error('DB Connect Fail', err); return; }

        cleanUp(function () {
            // Setup Hierarchy
            // We use insert_lookup directly for simplicity as search relies on lookup table primarily
            sql_action.insert_lookup(null, cb_obj, function (err) {
                if (err) console.log('Insert CB warning:', err);
                sql_action.insert_lookup(null, ae_obj, function (err) {
                    if (err) { console.error('Insert AE Fail', err); return; }
                    sql_action.insert_lookup(null, cnt_obj, function (err) {
                        if (err) { console.error('Insert CNT Fail:', err); return; }

                        console.log('[Setup] Hierarchy Created: CB -> AE -> CNT');
                        runSearchTests();
                    });
                });
            });
        });
    });
}

function runSearchTests() {
    var found_Obj = {};
    var root_ri = '/Mobius';
    var query = { ty: ['2', '3'] }; // Find AE and CNT

    // Test 1: Ty Filter
    console.log('[Test 1] Search under /Mobius for ty=2,3');
    sql_action.search_lookup(null, root_ri, query, 10, [root_ri], 0, found_Obj, 0, 0, null, 0, function (code) {
        if (code === '200') {
            var keys = Object.keys(found_Obj);
            console.log('  Found keys:', keys);
            if (keys.includes(ae_obj.ri) && keys.includes(cnt_obj.ri)) {
                console.log('  [PASS] Found AE and CNT');
            } else {
                console.error('  [FAIL] Missing AE or CNT');
            }
        } else {
            console.error('  [FAIL] Search returned code:', code);
        }

        // Test 2: Label Filter
        found_Obj = {};
        query = { lbl: ['container'] };
        console.log('[Test 2] Search for lbl=container');
        sql_action.search_lookup(null, root_ri, query, 10, [root_ri], 0, found_Obj, 0, 0, null, 0, function (code) {
            var keys = Object.keys(found_Obj);
            console.log('  Found keys:', keys);
            if (keys.includes(cnt_obj.ri) && !keys.includes(ae_obj.ri)) {
                console.log('  [PASS] Found CNT only');
            } else {
                console.error('  [FAIL] Incorrect results for label filter');
            }

            // Cleanup
            cleanUp(function () {
                console.log('[Done] Cleanup complete');
                process.exit(0);
            });
        });
    });
}

function cleanUp(cb) {
    var sqlite = require('./db_sqlite');
    var ids = ["'" + cnt_obj.ri + "'", "'" + ae_obj.ri + "'", "'" + cb_obj.ri + "'"];
    sqlite.getResult("DELETE FROM lookup WHERE ri IN (" + ids.join(',') + ")", null, function () {
        cb();
    });
}

runTest();
