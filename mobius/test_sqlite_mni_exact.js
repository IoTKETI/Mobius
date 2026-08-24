var fs = require('fs');
var util = require('util');
var responder = require('./responder');
var db_sqlite = require('./db_sqlite');
var sql_action = require('./sql_action');

var connection = null;

// Unique Identifier to avoid collision
var TS = Date.now();
var cnt_ri = '/Mobius/CNT_MNI_5_' + TS;
var cin_base_ri = cnt_ri + '/CIN_';

var cnt_obj = {
    ri: cnt_ri,
    pi: '/Mobius',
    ty: '3', // CNT
    ct: '20250101T000000',
    rn: 'CNT_MNI_5_' + TS,
    lt: '20250101T000000',
    et: '20990101T000000',
    acpi: [],
    lbl: [],
    at: [],
    aa: [],
    st: '0',
    mni: '5', // Limit to 5
    mbs: '1000',
    mia: '3600',
    cni: '0',
    cbs: '0',
    cr: 'admin'
};

global.usesqlite = 'true';

console.log('--- Connecting to SQLite ---');
db_sqlite.connect(function (code) {
    if (code !== '1') {
        console.error('Connection failed');
        return;
    }

    console.log('--- 1. Inserting CNT (mni=5) ---');
    sql_action.insert_cnt(connection, cnt_obj, function (err, result) {
        if (err) { console.error('Insert CNT failed', err); return; }

        console.log('CNT Inserted.');

        // Insert 6 items. Boundary is 5.
        // 1,2,3,4,5 -> OK
        // 6 -> Delete 1 -> Result: 2,3,4,5,6
        insertCinRecursively(1, 6, function () {
            verifyResults();
        });
    });
});

function insertCinRecursively(idx, max, callback) {
    if (idx > max) {
        callback();
        return;
    }

    var cin_obj = {
        ri: cin_base_ri + idx,
        pi: cnt_ri,
        ty: '4', // CIN
        ct: '20250101T000' + (100 + idx), // Ensure ordering
        rn: 'CIN_' + idx,
        lt: '20250101T000' + (100 + idx),
        et: '20990101T000000',
        acpi: [],
        lbl: [],
        at: [],
        aa: [],
        st: '0',
        cs: '10',
        con: 'value_' + idx
    };

    console.log('--- Inserting CIN ' + idx + ' ---');

    // Simulate flow: Insert -> Manual Mock Update CNT -> Get CNI Count
    sql_action.insert_cin(connection, cin_obj, function (err, res) {
        if (err) { console.error('Insert CIN failed', err); return; }

        // Mock update: increment cni
        var sql = "UPDATE cnt SET cni = cni + 1, cbs = cbs + " + cin_obj.cs + " WHERE ri = '" + cnt_ri + "'";
        require('./db_sqlite').getResult(sql, connection, function (err, res) {
            // Now call get_cni_count (which checks limits)
            sql_action.get_cni_count(connection, cnt_obj, function (cni, cbs, st) {
                console.log('  -> Current CNI after check: ' + cni);
                // Proceed
                insertCinRecursively(idx + 1, max, callback);
            });
        });
    });
}

function verifyResults() {
    console.log('--- Verifying Results ---');
    var sql = "SELECT ri, cni FROM cnt WHERE ri = '" + cnt_ri + "'";
    require('./db_sqlite').getResult(sql, connection, function (err, rows) {
        if (err) { console.error('Verify CNT failed', err); return; }

        var cni = rows[0].cni;
        console.log('Final CNI in CNT table:', cni);

        if (parseInt(cni) === 5) {
            console.log('SUCCESS: CNI is 5.');
        } else {
            console.error('FAILURE: CNI should be 5, but is ' + cni);
        }

        var sql2 = "SELECT ri, rn FROM cin WHERE pi = '" + cnt_ri + "' ORDER BY ct ASC";
        require('./db_sqlite').getResult(sql2, connection, function (err, cin_rows) {
            if (err || !cin_rows) {
                console.error('Verify CIN rows failed', err);
                return;
            }
            console.log('Remaining CINs:', cin_rows.length);
            cin_rows.forEach(function (r) { console.log(' - ' + r.rn); });

            // Expected: CIN_2, CIN_3, CIN_4, CIN_5, CIN_6 (total 5)
            // CIN_1 should be deleted.
            if (cin_rows.length === 5 && cin_rows[0].rn === 'CIN_2' && cin_rows[4].rn === 'CIN_6') {
                console.log('SUCCESS: Oldest CIN (1) deleted. 2,3,4,5,6 remain.');
            } else {
                console.error('FAILURE: Expected 2,3,4,5,6.');
            }
        });
    });
}
