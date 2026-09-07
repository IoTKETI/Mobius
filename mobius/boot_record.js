'use strict';
/**
 * Boot record: log/mobius-boot.jsonl
 *
 * At start-up every process appends one line with the configuration values it actually applied. The CLI (tools/mobius-conf.js) compares the file values with this record to report applied / restart pending.
 *
 *   {"role":"master","pid":…,"at":…,"supervised":…,"cap":…,"workers":…,"confPath":…,"conf":{…}}
 *   {"role":"worker","pid":…,"at":…,"supervised":…,"conf":{…}}
 *   {"role":"capped","at":…,"pid":…}
 *
 * The primary truncates the file and everyone appends, so the file always holds the current run only. The primary records a line cap; a worker that finds the file at the cap appends a single capped line instead of its own (a re-fork loop signal for the CLI). Recording failures are logged and never stop the boot. Secret keys (conf_schema secret:true) are stripped. supervised is true only under pm2 (process.env.pm_id).
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DEFAULT_FILE = path.join(ROOT, 'log', 'mobius-boot.jsonl');

// One line per worker in a normal boot. Three lines per worker allows two respawns; more is a re-fork loop. The minimum keeps tiny machines from hitting the cap after a respawn or two.
var LINES_PER_WORKER = 3;
var MIN_CAP = 16;

function cap_for(workers) {
    return Math.max(MIN_CAP, 1 + workers * LINES_PER_WORKER);
}

function strip_secrets(applied, schema) {
    var out = {};
    Object.keys(applied || {}).forEach(function (k) {
        var s = schema.get(k);
        if (s && s.secret === true) { return; }
        out[k] = applied[k];
    });
    return out;
}

function parse_lines(text) {
    var out = { master: null, workers: [], capped: null, lines: 0, broken: 0 };
    text.split('\n').forEach(function (l) {
        if (l.trim() === '') { return; }
        out.lines++;
        var o;
        try { o = JSON.parse(l); } catch (e) { out.broken++; return; }
        if (!o || typeof o !== 'object') { out.broken++; return; }
        if (o.role === 'master') { out.master = o; }
        else if (o.role === 'worker') { out.workers.push(o); }
        else if (o.role === 'capped') { out.capped = out.capped || o; }
        else { out.broken++; }
    });
    return out;
}

/** Reads the record. Returns null when the file does not exist; broken lines are counted in broken and skipped. */
exports.read = function (file) {
    file = file || DEFAULT_FILE;
    var text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { return null; }
    return parse_lines(text);
};

/**
 * Writes the record. Never throws. Returns true when a line was written.
 *
 *   applied   { conf key: applied value } from conf_load
 *   opts      file · role · pid · workers · supervised · confPath · schema · now (all optional)
 */
exports.write = function (applied, opts) {
    opts = opts || {};
    var file = opts.file || DEFAULT_FILE;
    var role = opts.role || (require('cluster').isPrimary ? 'master' : 'worker');
    var schema = opts.schema || require('./conf_schema');
    var workers = (typeof opts.workers === 'number') ? opts.workers : os.cpus().length;
    var pid = opts.pid || process.pid;
    var supervised = (opts.supervised !== undefined) ? !!opts.supervised : !!process.env.pm_id;
    var now = (opts.now || new Date()).toISOString();

    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });

        if (role === 'master') {
            var head = {
                role: 'master', pid: pid, at: now, supervised: supervised,
                cap: cap_for(workers), workers: workers,
                confPath: opts.confPath || null,
                conf: strip_secrets(applied, schema)
            };
            // The primary truncates; lines from the previous run disappear.
            fs.writeFileSync(file, JSON.stringify(head) + '\n', 'utf8');
            return true;
        }

        var cur = parse_lines(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
        if (cur.capped) { return false; }                       // already capped; nobody writes any more
        var cap = (cur.master && typeof cur.master.cap === 'number') ? cur.master.cap : cap_for(workers);
        if (cur.lines >= cap) {
            // First process to hit the cap appends a capped line at the end instead of its own.
            fs.appendFileSync(file, JSON.stringify({ role: 'capped', at: now, pid: pid }) + '\n', 'utf8');
            return false;
        }
        var line = { role: 'worker', pid: pid, at: now, supervised: supervised, conf: strip_secrets(applied, schema) };
        fs.appendFileSync(file, JSON.stringify(line) + '\n', 'utf8');
        return true;
    }
    catch (e) {
        console.error('[boot_record] 기록 실패: ' + ((e && e.message) || e) + ' — 기동은 계속한다');
        return false;
    }
};

exports.DEFAULT_FILE = DEFAULT_FILE;
exports.capFor = cap_for;
