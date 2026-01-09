var fs = require('fs');
var util = require('util');
var responder = require('./responder');
var db_sqlite = require('./db_sqlite');
var sql_action = require('./sql_action');

var connection = null;

var cnt_ri = '/Mobius/MyCNT_MNI_' + Date.now();
var cin_base_ri = '/Mobius/MyCNT_MNI_' + Date.now() + '/CIN_';

var cnt_obj = {
    ri: cnt_ri,
    pi: '/Mobius',
    ty: '3', // CNT
    ct: '20250101T000000',
    rn: 'MyCNT_MNI',
    lt: '20250101T000000',
    et: '20260101T000000',
    acpi: [],
    lbl: [],
    at: [],
    aa: [],
    st: '0',
    mni: '3', // Limit to 3
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

    console.log('--- 1. Inserting CNT (mni=3) ---');
    sql_action.insert_cnt(connection, cnt_obj, function (err, result) {
        if (err) { console.error('Insert CNT failed', err); return; }

        console.log('CNT Inserted.');

        insertCinRecursively(1, 5, function () {
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
        ct: '20250101T00000' + idx, // Ensure strict ordering
        rn: 'CIN_' + idx,
        lt: '20250101T00000' + idx,
        et: '20260101T000000',
        acpi: [],
        lbl: [],
        at: [],
        aa: [],
        st: '0',
        cs: '10',
        con: 'value_' + idx
    };

    console.log('--- Inserting CIN ' + idx + ' ---');
    // Note: insert_cin calls get_cni_count internally via update_cnt_cni usually?
    // Wait, sql_action.insert_cin does NOT call reference update logic automatically.
    // In Mobius structure, `resource.js` or `cnt_man.js` calls `insert_cin` THEN calls `update_cnt_cni` THEN `get_cni_count`.
    // sql_action.js is just a DAO. It doesn't contain business logic triggers.
    // I MUST manually invoke the logic chain:
    // 1. insert_cin
    // 2. update_cnt_cni (updates cni/cbs in CNT table)
    // 3. get_cni_count (checks limits and deletes)

    // Actually, looking at `insert_cin` in sql_action... it just inserts.
    // I need to mimic the flow.

    sql_action.insert_cin(connection, cin_obj, function (err, res) {
        if (err) { console.error('Insert CIN failed', err); return; }

        // Mock update_cnt_cni behavior (increment cni)
        // Since I don't have update_cnt_cni exposed or handy, I might need to update CNT manually?
        // Wait, I should check if `update_cnt_cni` is in sql_action.js.

        // Actually, let's look at `sql_action.js` exports.
        // There is `update_cnt_cni`?
        // If not, I'll simulate it or find it.
        // Assuming sql_action has `update_cnt_cni`?
        // If not, I'll rely on `get_cni_count`... but `get_cni_count` logic is: "Read cni from DB".
        // So DB MUST be updated.

        // Let's assume we call `update_cni_manually` just for test.
        var sql = "UPDATE cnt SET cni = cni + 1, cbs = cbs + " + cin_obj.cs + " WHERE ri = '" + cnt_ri + "'";
        require('./db_sqlite').getResult(sql, connection, function (err, res) {
            // Now call get_cni_count
            sql_action.get_cni_count(connection, cnt_obj, function (cni, cbs, st) {
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

        if (parseInt(cni) !== 3) {
            console.error('FAILURE: CNI should be 3, but is ' + cni);
        } else {
            console.log('SUCCESS: CNI is 3.');
        }

        var sql2 = "SELECT ri, rn FROM cin WHERE pi = '" + cnt_ri + "' ORDER BY ct ASC";
        require('./db_sqlite').getResult(sql2, connection, function (err, cin_rows) {
            if (err) {
                console.error('Verify CIN rows failed', err);
                return;
            }
            if (!cin_rows) {
                console.error('cin_rows undefined');
                return;
            }
            console.log('Remaining CINs:', cin_rows.length);
            cin_rows.forEach(function (r) { console.log(' - ' + r.rn); });

            if (cin_rows.length === 3 && cin_rows[0].rn === 'CIN_3' && cin_rows[2].rn === 'CIN_5') {
                console.log('SUCCESS: Oldest CINs (1, 2) were deleted. 3, 4, 5 remain.');
            } else if (cin_rows.length === 3) {
                console.log('WARNING: Last 3 CINS are: ' + cin_rows.map(r => r.rn).join(','));
            } else {
                console.error('FAILURE: Expected 3 CINs, got ' + cin_rows.length);
            }
        });
    });
}
