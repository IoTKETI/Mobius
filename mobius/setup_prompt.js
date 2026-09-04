'use strict';
/**
 * 첫 구동 마법사의 프롬프트. readline 과 stream 만 쓴다 — 코어에 있고 tools/ 를 모른다.
 * node mobius.js(conf_load)와 npm run setup(tools/setup.js) 둘 다 이것을 부른다.
 *
 * run(deps, cb)
 *   deps.backends   어댑터 이름 목록. require('./db').backends() — **pick() 을 부르지 않는다.**
 *                   conf_schema.choices('db') 로 대체하면 표가 mysql 로 굳는다(§4.5).
 *   deps.preset     { db } 미리 정해진 답 (node mobius.js <이름> 으로 띄운 경우). 없어도 된다
 *   deps.onBackend  (name) → 호출자가 global.usedb 를 세우고 { schema, needsDbpass } 를 돌려준다.
 *                   표가 백엔드를 따라가므로 db 를 먼저 받아야 나머지를 검사할 수 있다
 *   deps.io         { stdin, stdout }
 *   cb(err, answers)   취소·EOF 면 err.code === 'CANCELLED'. answers 는 여섯 키 이하
 *
 * **각 입력은 schema.checkValue() 를 그대로 지난다** — 손으로 만든 별도 검사를 두지 않는다.
 * 통과하지 못하면 validHint 를 보이고 같은 항목을 다시 묻는다. dbpass 는 그 백엔드가
 * 그 키를 쓸 때만 묻는다.
 *
 * **비밀번호 마스킹.** readline 에는 에코를 끄는 공개 API 가 없다. stream.Writable 로
 * 출력 프록시를 만들어 output 으로 주고 terminal:true 로 연 뒤, rl.question() 을 부른
 * **직후에** 음소거를 켠다 — 프롬프트가 먼저 나가야 한다. 거꾸로 하면 프롬프트까지
 * 삼켜 사용자가 빈 화면 앞에 앉는다. 답을 받으면 음소거를 끄고 개행을 직접 쓴다 —
 * 에코가 꺼져 있으면 Enter 도 안 찍힌다. 비공개 API(rl._writeToOutput)는 덮지 않는다.
 *
 * **어느 경로에서도 rl.close() 를 지난다.** terminal:true 는 TTY stdin 을 raw 모드에
 * 넣는다. 마법사는 종료하지 않고 같은 프로세스에서 require('./app') 으로 이어지므로,
 * close 를 못 지나면 뒤이어 뜬 서버가 raw 상태의 stdin 을 물려받아 Ctrl-C 가 안 먹는다.
 */
var readline = require('readline');
var stream = require('stream');

function pad(s, n) { s = String(s); while (s.length < n) { s += ' '; } return s; }

function cancelled() {
    var e = new Error('취소했다 — conf.json 을 만들지 않았다');
    e.code = 'CANCELLED';
    return e;
}

// 출력 프록시. muted 면 삼킨다.
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
    // EOF(Ctrl-D)·입력 끝. 답을 기다리는 중이었으면 취소다.
    this.rl.on('close', function () {
        self.closed = true;
        var cb = self.pending;
        self.pending = null;
        if (cb) { self.out.muted = false; self.stdout.write('\n'); cb(cancelled()); }
    });
    // Ctrl-C. 리스너가 없으면 readline 은 pause 만 하고 매달린다.
    this.rl.on('SIGINT', function () { self.rl.close(); });
}

Prompter.prototype.ask = function (label, dflt, secret, cb) {
    if (this.closed) { return cb(cancelled()); }
    var self = this;
    var hint = secret ? '(화면에 안 보입니다)' : (dflt === undefined ? '' : String(dflt));
    this.pending = cb;
    this.rl.question('  ' + pad(label, 14) + ' ' + pad(hint, 30) + ' > ', function (ans) {
        var done = self.pending;
        self.pending = null;
        if (secret) { self.out.muted = false; self.stdout.write('\n'); }
        if (done) { done(null, ans); }
    });
    if (secret) { this.out.muted = true; }   // question() 이 프롬프트를 쓴 **뒤에**
};

Prompter.prototype.close = function () {
    if (this.closed) { return; }
    this.closed = true;
    this.rl.close();
};

/**
 * 마법사 본체. 묻는 것은 여섯뿐이다 — 바꾸기 어려운 것(관문 넷)을 처음에 묻는다.
 */
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
        var ctx = deps.onBackend(answers.db);   // usedb 전역은 호출자가 세운다
        var steps = [];
        if (ctx.needsDbpass) { steps.push(['dbpass', 'DB 비밀번호', true]); }
        steps.push(['cseBase', 'CSE 이름', false]);
        steps.push(['cseId', 'CSE ID', false]);
        steps.push(['spId', 'SP-ID', false]);
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
        var dflt = secret ? undefined : s.dflt;
        (function again() {
            p.ask(label, dflt, secret, function (err, ans) {
                if (err) { return done(err); }
                var v = (!secret && ans.trim() === '') ? String(dflt) : ans;
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

/** `npm run setup -- --dbpass` 가 쓴다. 값 하나를 마스킹해서 받는다. */
exports.askSecret = function (io, label, cb) {
    var p = new Prompter(io);
    p.ask(label, undefined, true, function (err, ans) {
        p.close();
        cb(err, ans);
    });
};
