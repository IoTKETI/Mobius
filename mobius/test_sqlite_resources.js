/**
 * test_sqlite_resources.js
 * Purpose: Verify SQLite migration for CB, ACP, and AE resources.
 */

var sqlite3 = require('sqlite3').verbose();
var db_sqlite = require('./db_sqlite');
var sql_action = require('./sql_action');
var util = require('util');

// Set global flag to enable SQLite routing in sql_action.js
global.usesqlite = 'true';

// Mock objects
var cb_obj = {
    pi: '',
    ri: '/Mobius', // CSEBase RI
    ty: '5',
    ct: '20250101T000000',
    st: '0',
    rn: 'Mobius',
    lt: '20250101T000000',
    et: '20350101T000000',
    acpi: [],
    lbl: [],
    at: [],
    aa: [],
    sri: '',
    spi: '',
    subl: [],
    cst: '1',
    csi: '/Mobius',
    srt: ['1'],
    poa: ['http://127.0.0.1:7579'],
    nl: '',
    ncp: '',
    srv: []
};

var acp_obj = {
    pi: '/Mobius',
    ri: '/Mobius/acp1',
    ty: '1',
    ct: '20250101T000000',
    st: '0',
    rn: 'acp1',
    lt: '20250101T000000',
    et: '20350101T000000',
    acpi: [],
    lbl: [],
    at: [],
    aa: [],
    sri: '',
    spi: '',
    subl: [],
    pv: { acr: [] },
    pvs: { acr: [] }
};

var ae_obj = {
    pi: '/Mobius',
    ri: '/Mobius/ae1',
    ty: '2',
    ct: '20250101T000000',
    st: '0',
    rn: 'ae1',
    lt: '20250101T000000',
    et: '20350101T000000',
    acpi: [],
    lbl: [],
    at: [],
    aa: [],
    sri: '',
    spi: '',
    subl: [],
    apn: 'myApp',
    api: 'NmyApp',
    aei: 'Sae1',
    poa: [],
    or: '',
    rr: 'true',
    nl: '',
    csz: 'application/json',
    srv: []
};

function runTest() {
    console.log('--- Starting SQLite Resource Verification ---');

    // Start
    db_sqlite.connect(function (err) {
        if (err) {
            runTest();
        } else {
            console.error('Failed to connect to SQLite');
        }
    });
    cleanUp(function () {
        console.log('1. Cleanup complete.');

        // 2. Insert CB
        sql_action.insert_cb(null, cb_obj, function (err, result) {
            if (err) {
                console.error('[FAIL] insert_cb:', err);
                return;
            }
            console.log('[PASS] insert_cb');

            // 3. Insert ACP
            sql_action.insert_acp(null, acp_obj, function (err, result) {
                if (err) {
                    console.error('[FAIL] insert_acp:', err);
                    return;
                }
                console.log('[PASS] insert_acp');

                // 4. Insert AE
                sql_action.insert_ae(null, ae_obj, function (err, result) {
                    if (err) {
                        console.error('[FAIL] insert_ae:', err);
                        return;
                    }
                    console.log('[PASS] insert_ae');

                    // 5. Select AE
                    sql_action.select_ae(null, ae_obj.ri, function (err, result) {
                        if (err || result.length === 0) {
                            console.error('[FAIL] select_ae:', err);
                            return;
                        }
                        if (result[0].ri === ae_obj.ri) {
                            console.log('[PASS] select_ae (Found RI: ' + result[0].ri + ')');
                        } else {
                            console.error('[FAIL] select_ae mismatch');
                        }

                        // 6. Select Resource (Generic)
                        sql_action.select_resource_from_url(null, ae_obj.ri, '', function (err, result) {
                            if (err || result.length === 0) {
                                console.error('[FAIL] select_resource_from_url:', err);
                                return;
                            }
                            console.log('[PASS] select_resource_from_url');

                            // 7. Delete CB (Should cascade delete AE and ACP if they were children, but AE is child of CB here)
                            // Wait, AE pi is /Mobius (CB). ACP pi is /Mobius.
                            // Deleting CB should cascade delete AE and ACP because they reference CB? 
                            // No, the Schema Foreign Keys reference LOOKUP(ri), not parent-child hierarchy directly enforced by DB constraints on 'pi'.
                            // BUT, if I delete CB from Lookup, and if AE keys off Lookup?
                            // Actually, my SQL `FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE` only ensures that if I delete from LOOKUP, the ENTRY in AE table is deleted.
                            // It does NOT handle tree deletion (children).
                            // But `delete_ri_lookup` handles specific RI deletion.
                            // Let's test deleting the AE directly first.

                            sql_action.delete_ri_lookup(null, ae_obj.ri, function (err, result) {
                                if (err) {
                                    console.error('[FAIL] delete_ri_lookup (AE):', err);
                                    return;
                                }
                                console.log('[PASS] delete_ri_lookup (AE)');

                                // Verify AE is gone
                                sql_action.select_ae(null, ae_obj.ri, function (err, r) {
                                    if (err || r.length > 0) {
                                        console.error('[FAIL] AE still exists after delete');
                                    } else {
                                        console.log('[PASS] AE verification (deleted)');
                                    }
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
    // Delete test RIs if they exist
    var sqlite = require('./db_sqlite');
    // Using raw deletion for cleanup to be sure. Order matters if FKs are on, but if off, it doesn't. 
    // If FKs are on, deleting lookup cascades. If off, we need to delete children manually.
    // Safe method: Delete children first, then lookup.

    var tables = ['ae', 'acp', 'cb'];
    var ris = [ae_obj.ri, acp_obj.ri, cb_obj.ri];

    function deleteNext(idx) {
        if (idx >= ris.length) return cb();
        var ri = ris[idx];

        // Try delete from children explicitly (for orphans)
        var childDeletes = tables.map(t => "DELETE FROM " + t + " WHERE ri = '" + ri + "'");

        // Execute child deletes sequentially
        var runChildDeletes = function (tIdx) {
            if (tIdx >= tables.length) {
                // Then delete from lookup
                sqlite.getResult("DELETE FROM lookup WHERE ri = '" + ri + "'", null, function () {
                    deleteNext(idx + 1);
                });
                return;
            }
            sqlite.getResult(childDeletes[tIdx], null, function () {
                runChildDeletes(tIdx + 1);
            });
        };
        runChildDeletes(0);
    }
    deleteNext(0);
}

// Start
runTest();
