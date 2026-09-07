'use strict';
/**
 * Prompts of the first-run wizard. Uses readline and stream only; lives in the core and knows nothing about tools/. Called by node mobius.js (conf_load) and npm run setup (tools/setup.js).
 *
 * run(deps, cb)
 *   deps.backends   adapter names, require('./db').backends()
 *   deps.preset     { db } answers fixed in advance (node mobius.js <name>); optional
 *   deps.onBackend  (name) -> the caller sets global.usedb and returns { schema, needsDbpass }; the key table depends on the backend, so db is asked first
 *   deps.io         { stdin, stdout }
 *   cb(err, answers)   err.code === 'CANCELLED' on cancel or EOF; answers holds up to seven keys
 *
 * Every input goes through schema.checkValue(); on failure validHint is shown and the item is asked again. dbpass is asked only when the backend uses it. superUser is always asked, hidden, and defaults to the table's value when left empty.
 *
 * Password masking: readline has no public API to turn echo off, so a stream.Writable proxy is used as output with terminal:true, and muting is turned on right after rl.question() so the prompt itself is still printed. The newline is written by hand after the answer.
 *
 * rl.close() is reached on every path: terminal:true puts a TTY stdin into raw mode, and the server started afterwards in the same process must not inherit that state.
 */
var readline = require('readline');
var stream = require('stream');

function pad(s, n) { s = String(s); while (s.length < n) { s += ' '; } return s; }

function cancelled() {
    var e = new Error('취소했다 — conf.json 을 만들지 않았다');
    e.code = 'CANCELLED';
    return e;
}

// Output proxy; swallows output while muted.
function make_output(stdout) {
    var out = new stream.Writable({
        write: function (chunk, enc, next) {
            if (!out.muted) { stdout.write(chunk, enc); }
            next();
        }
    });
    out.muted = false;
    return out;
}

function Prompter(io) {
    var self = this;
    this.stdout = io.stdout;
    this.out = make_output(io.stdout);
    this.rl = readline.createInterface({ input: io.stdin, output: this.out, terminal: true });
    this.closed = false;
    this.pending = null;
    // EOF (Ctrl-D) or end of input. If an answer was pending, that is a cancel.
    this.rl.on('close', function () {
        self.closed = true;
        var cb = self.pending;
        self.pending = null;
        if (cb) { self.out.muted = false; self.stdout.write('\n'); cb(cancelled()); }
    });
    // Ctrl-C. Without a listener readline only pauses and hangs.
    this.rl.on('SIGINT', function () { self.rl.close(); });
}

Prompter.prototype.ask = function (label, dflt, secret, cb) {
    if (this.closed) { return cb(cancelled()); }
    var self = this;
    // A secret with a default (superUser) shows the default; the value is in the source, so it is not secret.
    var hint = secret ? ('(화면에 안 보입니다' + (dflt ? ' · 비우면 ' + dflt : '') + ')')
                      : (dflt === undefined ? '' : String(dflt));
    this.pending = cb;
    this.rl.question('  ' + pad(label, 14) + ' ' + pad(hint, 30) + ' > ', function (ans) {
        var done = self.pending;
        self.pending = null;
        if (secret) { self.out.muted = false; self.stdout.write('\n'); }
        if (done) { done(null, ans); }
    });
    if (secret) { this.out.muted = true; }   // after question() has written the prompt
};

Prompter.prototype.close = function () {
    if (this.closed) { return; }
    this.closed = true;
    this.rl.close();
};

/** The wizard itself. Seven questions: the four gate keys first, then the superuser origin after SP-ID. */
exports.run = function (deps, cb) {
    var io = deps.io;
    var p = new Prompter(io);
    var answers = {};
    var finished = false;

    function finish(err) {
        if (finished) { return; }
        finished = true;
        p.close();
        cb(err, err ? undefined : answers);
    }

    io.stdout.write('\nMobius 첫 설정입니다.\n\n');

    step_db(function (err) {
        if (err) { return finish(err); }
        var ctx = deps.onBackend(answers.db);   // the caller sets the usedb global
        var steps = [];
        if (ctx.needsDbpass) { steps.push(['dbpass', 'DB 비밀번호', true]); }
        steps.push(['cseBase', 'CSE 이름', false]);
        steps.push(['cseId', 'CSE ID', false]);
        steps.push(['spId', 'SP-ID', false]);
        // Master key: this value in X-M2M-Origin bypasses every ACP check; asked hidden.
        steps.push(['superUser', '수퍼유저 Origin', true]);
        steps.push(['csebaseport', 'HTTP 포트', false]);
        (function next(i) {
            if (i >= steps.length) { return finish(null); }
            ask_valid(ctx.schema, steps[i][0], steps[i][1], steps[i][2], function (err2) {
                if (err2) { return finish(err2); }
                next(i + 1);
            });
        })(0);
    });

    function step_db(done) {
        var list = deps.backends;
        if (deps.preset && deps.preset.db && list.indexOf(deps.preset.db) >= 0) {
            answers.db = deps.preset.db;
            io.stdout.write('  ' + pad('DB', 14) + ' ' + answers.db + ' (인자로 받음)\n');
            return done(null);
        }
        var menu = list.map(function (n, i) { return '[' + (i + 1) + '] ' + n; }).join('  ');
        (function again() {
            p.ask('DB', menu, false, function (err, ans) {
                if (err) { return done(err); }
                var t = ans.trim();
                var idx = (t === '') ? 0 : (/^\d+$/.test(t) ? Number(t) - 1 : list.indexOf(t));
                if (idx < 0 || idx >= list.length) {
                    io.stdout.write('    번호나 이름으로 고른다: ' + menu + '\n');
                    return again();
                }
                answers.db = list[idx];
                done(null);
            });
        })();
    }

    function ask_valid(schema, key, label, secret, done) {
        var s = schema.get(key);
        var dflt = s.dflt;
        (function again() {
            p.ask(label, dflt, secret, function (err, ans) {
                if (err) { return done(err); }
                // Empty input means the default. A secret with an empty default (dbpass) stays empty.
                var v = (ans.trim() === '' && dflt !== undefined && dflt !== '') ? String(dflt) : ans;
                var r = schema.checkValue(key, v);
                if (!r.ok) {
                    io.stdout.write('    ' + (s.validHint || r.reason) + '\n');
                    return again();
                }
                answers[key] = v;
                done(null);
            });
        })();
    }
};

/** Used by `npm run setup -- --dbpass`: reads one masked value. */
exports.askSecret = function (io, label, cb) {
    var p = new Prompter(io);
    p.ask(label, undefined, true, function (err, ans) {
        p.close();
        cb(err, ans);
    });
};
