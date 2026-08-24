/**
 * Test Script for Phase 1: SQLite Hit Table
 * Run with: node mobius/test_sqlite_hit.js
 */

// Mock Global Config
global.usesqlite = 'true';

var fs = require('fs');
var path = require('path');
var db_sqlite = require('./db_sqlite');
var sql_action = require('./sql_action');

console.log('--- Phase 1 Verification Test ---');

// Step 1: Connect
console.log('[1] Connecting to SQLite...');
db_sqlite.connect(function (code) {
    if (code !== '1') {
        console.error('FAILED to connect: ' + code);
        process.exit(1);
    }
    console.log('    Connection initiated. Waiting for schema init (2s)...');

    // Schema init is async inside connect, wait a bit
    setTimeout(function () {
        // Step 2: Verify DB File
        if (fs.existsSync('mobius.db')) {
            console.log('[2] mobius.db file exists. OK.');
        } else {
            console.error('[2] mobius.db file MISSING. FAIL.');
            process.exit(1);
        }

        // Step 3: Insert Data
        console.log('[3] Testing set_hit (INSERT)...');
        // connection arg is ignored in sqlite mode, passing null
        sql_action.set_hit(null, 'H', function (err, result) {
            if (err) {
                console.error('    set_hit FAILED:', err);
                process.exit(1);
            }
            console.log('    set_hit success. Result:', result);

            // Step 4: Retrieve Data
            console.log('[4] Testing get_hit_all (SELECT)...');
            sql_action.get_hit_all(null, function (err, rows) {
                if (err) {
                    console.error('    get_hit_all FAILED:', err);
                    process.exit(1);
                }
                console.log('    get_hit_all returned ' + rows.length + ' rows.');
                if (rows.length > 0) {
                    console.log('    First row:', rows[0]);
                    console.log('--- TEST PASSED ---');
                    process.exit(0);
                } else {
                    console.error('    No rows found! INSERT might have failed silently or SELECT is broken.');
                    process.exit(1);
                }
            });
        });

    }, 2000); // Wait for schema creation
});
