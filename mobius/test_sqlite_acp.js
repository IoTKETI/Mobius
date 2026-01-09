var fs = require('fs');
var util = require('util');
var responder = require('./responder');
var db_sqlite = require('./db_sqlite');
var sql_action = require('./sql_action');

// Mock connection (db_sqlite handles it internally or we pass null/dummy)
var connection = null;

// Setup mock objects
var acp_ri = '/Mobius/MyACP_' + Date.now();
var ae_ri = '/Mobius/MyAE_' + Date.now();

var acp_obj = {
    ri: acp_ri,
    pi: '/Mobius', // Parent
    ty: '1', // ACP
    ct: '20250101T000000',
    rn: 'MyACP',
    lt: '20250101T000000',
    et: '20260101T000000',
    acpi: [],
    lbl: [],
    at: [],
    aa: [],
    sri: 'my_acp',
    spi: 'mobius',
    subl: [],
    pv: { acr: [{ acor: ['admin'], acop: 63 }] },
    pvs: { acr: [{ acor: ['admin'], acop: 63 }] }
};

var ae_obj = {
    ri: ae_ri,
    pi: '/Mobius',
    ty: '2', // AE
    ct: '20250101T000000',
    st: '0',
    rn: 'MyAE',
    lt: '20250101T000000',
    et: '20260101T000000',
    acpi: [acp_ri], // Reference the ACP
    lbl: [],
    at: [],
    aa: [],
    sri: 'my_ae',
    spi: 'mobius',
    subl: [],
    apn: 'MyApp',
    api: 'my_api',
    aei: 'my_aei',
    poa: ['http://localhost'],
    or: 'http://localhost',
    nl: '',
    rr: 'true',
    csz: 'application/json',
    srv: ['2a']
};

global.usesqlite = 'true';

console.log('--- Connecting to SQLite ---');
db_sqlite.connect(function (code) {
    if (code !== '1') {
        console.error('Connection failed');
        return;
    }

    console.log('--- 1. Inserting ACP ---');
    sql_action.insert_acp(connection, acp_obj, function (err, result) {
        if (err) {
            console.error('Insert ACP failed:', err);
            return;
        }
        console.log('ACP Inserted.');

        console.log('--- 2. Inserting AE with acpi ---');
        sql_action.insert_ae(connection, ae_obj, function (err, result) {
            if (err) {
                console.error('Insert AE failed:', err);
                return;
            }
            console.log('AE Inserted.');

            console.log('--- 3. Verifying ACPL Population ---');
            var sql = "SELECT ri, acpi, acpl FROM lookup WHERE ri = '" + ae_ri + "'";
            var sqlite = require('./db_sqlite');
            sqlite.getResult(sql, connection, function (err, rows) {
                if (err) {
                    console.error('Verify failed:', err);
                } else {
                    console.log('AE Lookup Row:', rows[0]);

                    if (rows[0].acpl) {
                        console.log('SUCCESS: acpl is populated:', rows[0].acpl);
                        try {
                            var acpl = JSON.parse(rows[0].acpl);
                            console.log('Parsed ACPL:', JSON.stringify(acpl, null, 2));
                        } catch (e) {
                            console.error('ACPL JSON Parse Error:', e);
                        }
                    } else {
                        console.error('FAILURE: acpl is null or empty');
                    }
                }

                console.log('--- 4. Verify select_acp ---');
                sql_action.select_acp(connection, acp_ri, function (err, rows) {
                    if (!err && rows.length > 0) {
                        console.log('select_acp Success:', rows[0].ri);
                    } else {
                        console.error('select_acp Failed');
                    }
                });
            });
        });
    });
});
