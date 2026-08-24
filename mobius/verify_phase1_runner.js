/**
 * Verification Runner for Phase 1
 * Spawns Mobius server and checks SQLite DB for startup data.
 */

var spawn = require('child_process').spawn;
var sqlite3 = require('sqlite3').verbose();
var path = require('path');

var serverProcess = null;
var db = null;
var checkInterval = null;
var timeoutTimer = null;

console.log('--- Starting Integration Verification ---');

// 1. Start Server
console.log('[1] Spawning Mobius server...');
// Run server from the project root (../)
var projectRoot = path.join(__dirname, '..');

serverProcess = spawn('node', ['mobius.js'], {
    cwd: projectRoot,
    stdio: 'pipe',
    shell: true
});

serverProcess.stdout.on('data', function (data) {
    // console.log('[Server stdout]: ' + data.toString().trim()); 
    // Uncomment above to see full logs
    if (data.toString().includes('SQLite Schema Initialized')) {
        console.log('[Server] SQLite Schema Initialized detected.');
    }
});

serverProcess.stderr.on('data', function (data) {
    console.error('[Server stderr]: ' + data.toString());
});

// 2. Poll DB
function checkDB() {
    var dbPath = path.join(projectRoot, 'mobius.db');

    // Connect if not connected
    if (!db) {
        db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (!err) {
                // console.log('[DB] Connected to ' + dbPath);
            }
        });
    }

    if (db) {
        db.get("SELECT count(*) as count FROM hit", [], (err, row) => {
            if (!err && row) {
                console.log('[DB Check] hit count: ' + row.count);
                if (row.count > 0) {
                    console.log('SUCCESS: Server started and wrote to SQLite hit table.');
                    cleanupAndExit(0);
                }
            } else {
                // console.log('[DB Check] Waiting for table/data...');
            }
        });
    }
}

// Start polling
checkInterval = setInterval(checkDB, 2000);

// 3. Timeout
timeoutTimer = setTimeout(function () {
    console.error('TIMEOUT: Did not detect data in hit table after 30 seconds.');
    cleanupAndExit(1);
}, 30000);

function cleanupAndExit(code) {
    clearInterval(checkInterval);
    clearTimeout(timeoutTimer);
    if (db) db.close();

    console.log('[Cleanup] Killing server process...');
    // Kill the whole process tree if possible, or just the spawned one
    if (serverProcess) {
        if (process.platform === "win32") {
            try {
                require('child_process').exec('taskkill /pid ' + serverProcess.pid + ' /T /F');
            } catch (e) { }
        } else {
            serverProcess.kill();
        }
    }

    setTimeout(() => {
        console.log('--- TEST FINISHED with code ' + code + ' ---');
        process.exit(code);
    }, 1000);
}
