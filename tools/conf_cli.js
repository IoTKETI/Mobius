'use strict';
/**
 * Logic of the conf CLI. Files, processes and the terminal come in through deps, so tests can substitute them. The entry point is tools/mobius-conf.js (it keeps the load order and fills deps).
 *
 * deps
 *   schema      mobius/conf_schema (required after global.usedb is set)
 *   store       ConfStore from tools/conf_store
 *   conf        the parsed conf.json object ({} when the file is absent)
 *   readRecord  () -> boot_record.read() result (null when absent)
 *   alive       (pid) -> boolean
 *   probePort   (port, cb(open))
 *   pm2List     (cb(list|null))  any failure is null: 'no pm2'
 *   io          { stdin, stdout, isTTY }
 *
 * Three sources are combined: the table (declaration), conf.json (file value) and the boot record (running value).
 *
 * 'Is it running' is decided by the master pid of the boot record alone. A port can look open while someone else holds it, and pm2's online does not mean healthy; both are warnings only. When the master pid is dead, values are not compared at all ('unknown').
 *
 * Per-key wording (gate warnings) is not here; it comes from the table's gateWarn, so the screen does not copy the core's policy.
 */
var readline = require('readline');
var net = require('net');
var cp = require('child_process');
var fs = require('fs');

var PROBE_TIMEOUT_MS = 1500;
var PM2_TIMEOUT_MS = 5000;

// The two secrets that can only be re-entered through a prompt (tools/setup.js). The wording is not in the table because it is a command, not a key.
var REENTRY_FLAG = { dbpass: '--dbpass', superUser: '--superuser' };

var STATE_LABEL = {
    applied: '적용됨',
    pending: '● 재기동 대기',
    unknown: '모름',
    na: '대조 대상 아님',
    derived: '유도됨',
    invalid: '파일 값이 유효하지 않다'
};

// Used by runEdit at its two early returns (before and after gate handling) so the wording stays the same.
var NOTHING_CHANGED = '바꾼 것이 없다 — 파일을 건드리지 않았다.';

var USAGE = [
    '사용법',
    '  npm run conf                     전체 목록 — 카테고리별 · 파일 값 · 3상태',
    '  npm run conf -- <키>             단건 상세',
    '  npm run conf -- set <키> <값>    변경 (배열은 쉼표로)',
    '  npm run conf -- unset <키>       기본값으로 되돌린다',
    '  npm run conf -- edit             일괄 편집 — 첫 실행처럼 사용자 키를 차례로 묻는다 (Enter 는 그대로)',
    '  npm run status                   마스터 pid · 포트 · 부팅 기록 · 재기동 대기 건수',
    '  옵션  --db=<이름>                백엔드를 강제한다 (키 표가 백엔드를 따라간다)',
    '  옵션  --all                     고급 키까지 보이고 고친다 (기본은 사용자 키 7개 — 첫 실행이 묻는 것)',
    '',
    '  비밀 키(dbpass·superUser·adminPassword·adminOrigin)는 조회만 한다.',
    '  dbpass 를 다시 넣으려면 `npm run setup -- --dbpass`, superUser 는 `npm run setup -- --superuser`.'
];

function pad(s, n) { s = String(s); while (s.length < n) { s += ' '; } return s; }
function fmt_at(iso) { return String(iso || '').replace('T', ' ').slice(0, 16); }
function norm(v) { return (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o || {}, k); }

// argv[2] is the subcommand and is not read as a backend; copying mobius.js literally would turn `npm run conf -- set mqttPort 1884` into global.usedb='set'.
exports.resolveBackend = function (argv, conf) {
    var opt = argv.filter(function (a) { return a.indexOf('--db=') === 0; })[0];
    if (opt) { return opt.slice('--db='.length); }
    return conf.db || 'mysql';
};

// Command-line values are all strings.
exports.coerce = function (type, str) {
    if (type === 'number') {
        // Number('') is 0, and 0 for dbQueueLimit means 'unbounded queue without timeout', so an empty string is rejected.
        if (!/^-?\d+(\.\d+)?$/.test(str)) { return { ok: false, reason: '수가 아니다: "' + str + '"' }; }
        return { ok: true, value: Number(str) };
    }
    if (type === 'array') {
        if (str.trim() === '') { return { ok: true, value: [] }; }
        return { ok: true, value: str.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; }) };
    }
    return { ok: true, value: str };
};

exports.liveness = function (rec, alive) {
    if (!rec || !rec.master) {
        return { running: false, reason: '부팅 기록이 없다 (새 코어로 기동한 적이 없다)' };
    }
    if (!alive(rec.master.pid)) {
        return { running: false, reason: 'Mobius 가 떠 있지 않다 (마지막 기동 ' + fmt_at(rec.master.at) + ', pid ' + rec.master.pid + ' 없음)' };
    }
    return { running: true, master: rec.master };
};

/** State of one key. Nothing is compared when running is false. record is the master line's conf. */
exports.judge = function (schema, key, conf, running, record) {
    var s = schema.get(key);
    var inFile = has(conf, key);
    var fileValue = inFile ? conf[key] : s.dflt;
    if (inFile && !schema.checkValue(key, conf[key]).ok) {
        // A key whose invalid value the core replaces with the default does not change on restart.
        return { state: 'invalid', fileValue: fileValue, note: STATE_LABEL.invalid + ' (기본값으로 떨어짐) — set 으로 고칠 것' };
    }
    if (!running) { return { state: 'unknown', fileValue: fileValue }; }
    if (!record || !has(record, key)) {
        return { state: 'na', fileValue: fileValue, note: STATE_LABEL.na + ' (코어가 안 읽는다)' };
    }
    var applied = record[key];
    if (typeof s.derivedFrom === 'function') {
        var why = s.derivedFrom(record);
        if (why) { return { state: 'derived', fileValue: fileValue, applied: applied, note: STATE_LABEL.derived + ' (' + why + ' · 파일 ' + norm(fileValue) + ')' }; }
    }
    if (norm(fileValue) === norm(applied)) { return { state: 'applied', fileValue: fileValue, applied: applied }; }
    return { state: 'pending', fileValue: fileValue, applied: applied, note: STATE_LABEL.pending + ' (파일 ' + norm(fileValue) + ' / 도는 값 ' + norm(applied) + ')' };
};

exports.pendingKeys = function (deps, record) {
    return deps.schema.all().filter(function (k) {
        return deps.schema.get(k).secret !== true &&
               exports.judge(deps.schema, k, deps.conf, true, record).state === 'pending';
    });
};

exports.warnings = function (rec) {
    var out = [];
    if (!rec) { return out; }
    if (rec.capped) { out.push('좀비 의심 — 부팅 기록에 capped 줄이 있다. 재포크 루프다(포트 충돌?). `npm run status` 로 포트를 본다.'); }
    var shapes = rec.workers.map(function (w) { return JSON.stringify(w.conf || {}); });
    if (shapes.length > 1 && shapes.some(function (s) { return s !== shapes[0]; })) {
        out.push('워커 불일치 — 기록의 워커 줄들이 서로 다른 값을 갖고 있다. 되살아난 워커만 새 conf 를 읽었다. 재기동할 것.');
    }
    return out;
};

// The table grouped: groups in declaration order, keys by name within a group.
function grouped(schema) {
    var by = {};
    schema.all().forEach(function (k) {
        var g = schema.get(k).group;
        (by[g] = by[g] || []).push(k);
    });
    return schema.groups().filter(function (g) { return by[g]; })
        .map(function (g) { return { group: g, keys: by[g] }; });
}

function mark_of(s) {
    if (s.grade === 'gate') { return '⚠ 관문'; }
    if (s.readOnly) { return '읽기 전용'; }
    return '';
}

exports.renderList = function (deps) {
    var schema = deps.schema, conf = deps.conf;
    var rec = deps.readRecord();
    var live = exports.liveness(rec, deps.alive);
    var record = live.running ? live.master.conf : null;
    var lines = [];

    grouped(schema).forEach(function (grp) {
        var shown = grp.keys.filter(function (k) { return visible(deps, k) && schema.get(k).secret !== true; });
        if (!shown.length) { return; }
        lines.push('');
        lines.push(grp.group);
        shown.forEach(function (k) {
            var s = schema.get(k);
            var j = exports.judge(schema, k, conf, live.running, record);
            var state = j.note || STATE_LABEL[j.state];
            lines.push('  ' + pad(k, 20) + ' ' + pad(norm(j.fileValue), 20) + ' ' + pad(state, 14) + ' ' + mark_of(s));
        });
    });

    if (!deps.all) {
        var hidden = schema.all().filter(function (k) { return !visible(deps, k); });
        if (hidden.length) {
            lines.push('');
            lines.push('고급 키 ' + hidden.length + '개는 숨겼다 — `npm run conf -- --all` 로 본다. 굳이 바꿀 일이 없는 것들이다.');
        }
    }

    var secrets = schema.all().filter(function (k) { return schema.get(k).secret === true; })
        .filter(function (k) { return visible(deps, k); });
    lines.push('');
    lines.push('비밀 — 값을 띄우지 않는다');
    secrets.forEach(function (k) {
        var present = has(conf, k) && conf[k] !== '' && conf[k] !== null;
        lines.push('  ' + pad(k, 20) + ' ' + (present ? '설정됨' : '없음 (기본값 사용)'));
    });

    lines.push('');
    if (!live.running) {
        lines.push('모름 — ' + live.reason + '. 값 대조를 하지 않았다.');
    } else {
        // Pending restarts count every key regardless of --all, as status does. What is hidden is the key, not the fact that a restart is needed; an operator who changed an advanced key directly in conf.json must not be told 'no pending restart'.
        var allPending = exports.pendingKeys(deps, record);
        if (allPending.length) {
            var hiddenPending = allPending.filter(function (k) { return !visible(deps, k); });
            lines.push('● 재기동 대기 ' + allPending.length + '건 (' + allPending.join(', ') + ')' +
                (hiddenPending.length ? ' (고급 키 ' + hiddenPending.length + '개 포함 — --all 로 본다)' : '') +
                '.  반영하려면 Mobius 를 다시 띄운다.');
        } else {
            lines.push('재기동 대기 없음.');
        }
    }
    // Keys not in the table: dead keys (usesqlite, cntManPort ...) or typos.
    var unknown = Object.keys(conf).filter(function (k) { return !schema.get(k); });
    if (unknown.length) { lines.push('경고: 표에 없는 키 — 죽은 키거나 오타다: ' + unknown.join(', ')); }
    // A mismatched seal keeps the server from starting; it is shown directly in the list.
    var sv = deps.sealStatus ? deps.sealStatus() : null;
    if (sv && !sv.ok) {
        lines.push('경고: 봉인 — ' + sv.reason + '. 이 상태로는 서버가 뜨지 않는다 — ' +
            '`npm run setup -- --superuser` 를 치고 Enter(값 유지) 하면 봉인이 만들어진다.');
    }
    exports.warnings(rec).forEach(function (w) { lines.push('경고: ' + w); });
    return lines;
};

exports.renderShow = function (key, deps) {
    var schema = deps.schema;
    if (!visible(deps, key)) { return advanced_fail(key).lines; }
    var s = schema.get(key);
    var d = schema.describe()[key];   // secret and hidden keys are not in describe
    var rec = deps.readRecord();
    var live = exports.liveness(rec, deps.alive);
    var lines = [];
    lines.push(key + '  —  ' + (s.label || ''));
    lines.push('  ' + pad('분류', 12) + s.group);
    lines.push('  ' + pad('타입', 12) + s.type + (s.integer ? ' (정수)' : '') + (typeof s.min === 'number' ? ' · ' + s.min + ' 이상' : ''));
    var choices = schema.choices(key);
    if (choices) { lines.push('  ' + pad('유효값', 12) + choices.join(' / ')); }
    if (s.validHint) { lines.push('  ' + pad('형식', 12) + s.validHint); }
    lines.push('  ' + pad('기본값', 12) + norm(s.dflt));
    // From the CLI's point of view runtime and reload both mean restart: the core reads the file once at boot.
    lines.push('  ' + pad('반영', 12) + s.apply + (s.reloadWith ? ' (' + s.reloadWith + ')' : '') + ' — 파일을 고치면 재기동해야 반영된다');
    if (s.secret === true) {
        lines.push('  ' + pad('파일 값', 12) + (has(deps.conf, key) && deps.conf[key] !== '' ? '설정됨' : '없음') + ' (비밀 — 값을 띄우지 않는다)');
        lines.push('  ' + pad('변경', 12) + 'CLI 로 바꿀 수 없다' + (REENTRY_FLAG[key] ? ' — `npm run setup -- ' + REENTRY_FLAG[key] + '`' : ''));
        return lines;
    }
    if (d && d.grade === 'gate') { lines.push('  ' + pad('등급', 12) + '관문 — 저장 전에 아래 경고를 보이고 키 이름을 타이핑해야 통과'); lines.push(d.gateWarn.split('\n').map(function (l) { return '    ' + l; }).join('\n')); }
    if (s.readOnly) { lines.push('  ' + pad('등급', 12) + '읽기 전용 — CLI 로 바꿀 수 없다'); }
    var j = exports.judge(schema, key, deps.conf, live.running, live.running ? live.master.conf : null);
    lines.push('  ' + pad('파일 값', 12) + (has(deps.conf, key) ? norm(deps.conf[key]) : '(없음 — 기본값 사용)'));
    if (has(j, 'applied')) { lines.push('  ' + pad('도는 값', 12) + norm(j.applied)); }
    lines.push('  ' + pad('상태', 12) + (j.note || STATE_LABEL[j.state]) + (!live.running ? ' — ' + live.reason : ''));
    if (s.help) { lines.push(''); lines.push('  ' + s.help); }
    return lines;
};

/**
 * Gate confirmation. The wording (warn) is the table's gateWarn as is.
 *   - Without a TTY nothing is read and the change is refused; that is not a pass.
 *   - EOF (Ctrl-D) and a wrong answer refuse.
 *   - There is no command-line option to pass without confirmation in non-interactive use.
 *
 * The second callback argument is the reason. EOF is 'eof': runSet / runUnset only cancel this one key and can ignore it, but runEdit holds several keys at once and must tell 'skip this key' from 'Ctrl-C, cancel everything'.
 */
exports.confirmGate = function (key, warn, io, cb) {
    io.stdout.write('\n' + warn + '\n\n');
    if (!io.isTTY) {
        io.stdout.write('대화형 터미널이 아니라 확인을 받을 수 없다 — 거부한다. 파일을 건드리지 않았다.\n');
        return cb(false);
    }
    var rl = readline.createInterface({ input: io.stdin, output: io.stdout });
    var answered = false;
    rl.question('계속하려면 키 이름(' + key + ')을 그대로 입력: ', function (ans) {
        if (answered) { return; }
        answered = true;
        rl.close();
        cb(ans.trim() === key);
    });
    rl.on('close', function () {
        if (answered) { return; }
        answered = true;
        io.stdout.write('\n');
        cb(false, 'eof');
    });
};

function gate(key, deps, cb) {
    var d = deps.schema.describe()[key];
    if (!d || d.grade !== 'gate') { return cb(true); }
    exports.confirmGate(key, d.gateWarn, deps.io, cb);
}

function fail(lines) { return { ok: false, lines: lines }; }

// By default only user keys are known; with deps.all every key.
function visible(deps, key) {
    var s = deps.schema.get(key);
    return !!s && (deps.all === true || s.tier === 'user');
}
function advanced_fail(key) {
    return fail(['고급 키다: ' + key + ' — conf.json 을 직접 고치거나 `npm run conf -- --all` 을 줄 것']);
}

/** Passes one string answer through coerce -> store.validate (the contract that `set` and `edit` store the same value). On failure only the stage is returned; the reaction (fail at once vs ask the same item again) and the wording differ per caller. */
function applyAnswer(key, raw, deps) {
    var s = deps.schema.get(key);
    var c = exports.coerce(s.type, raw);
    if (!c.ok) { return { ok: false, stage: 'coerce', reason: c.reason }; }
    var why = deps.store.validate(key, c.value);          // exposed / readOnly / valid-value gate
    if (why) { return { ok: false, stage: 'validate', reason: why }; }
    return { ok: true, value: c.value };
}

exports.runSet = function (key, raw, deps, cb) {
    if (!fs.existsSync(deps.store.file)) {
        // Creating the file here would keep the first-run wizard from running at the next boot, and an empty dbpass would then fail at the DB connection, two steps away from the cause. Reads answer with defaults; writes are refused.
        return cb(null, fail(['conf.json 이 없다 — 먼저 터미널에서 `node mobius.js`(또는 `npm run setup`)로 만들 것 (' + deps.store.file + ')']));
    }
    if (deps.schema.get(key) && !visible(deps, key)) { return cb(null, advanced_fail(key)); }
    var s = deps.schema.get(key);
    if (!s) { return cb(null, fail(['모르는 키다: ' + key])); }
    if (raw === undefined) { return cb(null, fail(['값이 없다: set ' + key + ' <값>'])); }
    var a = applyAnswer(key, raw, deps);
    if (!a.ok) { return cb(null, fail([a.stage === 'coerce' ? (key + ': ' + a.reason) : a.reason])); }
    gate(key, deps, function (pass) {
        if (!pass) { return cb(null, fail(['취소했다 — 파일을 건드리지 않았다'])); }
        var patch = {};
        patch[key] = a.value;
        var r = deps.store.update(patch);
        if (!r.ok) { return cb(null, fail(r.errors)); }
        if (!r.changed.length) { return cb(null, { ok: true, lines: [key + ' 는 이미 그 값이다. 바꾼 것이 없다.'] }); }
        cb(null, { ok: true, lines: [
            key + ': ' + norm(r.changed[0].from) + ' → ' + norm(r.changed[0].to) + '  (' + deps.store.file + ')',
            '재기동해야 반영된다 — 파일 값은 기동 때 한 번 읽힌다.'
        ] });
    });
};

exports.runUnset = function (key, deps, cb) {
    if (!fs.existsSync(deps.store.file)) {
        // Creating the file here would keep the first-run wizard from running at the next boot, and an empty dbpass would then fail at the DB connection, two steps away from the cause. Reads answer with defaults; writes are refused.
        return cb(null, fail(['conf.json 이 없다 — 먼저 터미널에서 `node mobius.js`(또는 `npm run setup`)로 만들 것 (' + deps.store.file + ')']));
    }
    if (deps.schema.get(key) && !visible(deps, key)) { return cb(null, advanced_fail(key)); }
    var s = deps.schema.get(key);
    if (!s) { return cb(null, fail(['모르는 키다: ' + key])); }
    gate(key, deps, function (pass) {
        if (!pass) { return cb(null, fail(['취소했다 — 파일을 건드리지 않았다'])); }
        var r = deps.store.removeKey(key);
        if (!r.ok) { return cb(null, fail(r.errors)); }
        if (!r.changed.length) { return cb(null, { ok: true, lines: [key + ' 는 파일에 없다 — 이미 기본값(' + norm(s.dflt) + ')이다.'] }); }
        cb(null, { ok: true, lines: [
            key + ': ' + norm(r.changed[0].from) + ' → (기본값 ' + norm(s.dflt) + ')',
            '재기동해야 반영된다 — 파일 값은 기동 때 한 번 읽힌다.'
        ] });
    });
};

/** Batch edit. Asks the user keys in category order like the first run (advanced keys too with deps.all). Enter keeps the value, an answer goes through the same conversion and checks as set, gate keys are confirmed at the end only when changed, and one atomic write happens at the end. Secrets are not asked; read-only keys are shown and skipped. Non-TTY and EOF write nothing. */
exports.runEdit = function (deps, cb) {
    var io = deps.io, schema = deps.schema, conf = deps.conf;
    if (!io.isTTY) { return cb(null, fail(['대화형 터미널이 아니다 — edit 은 터미널에서만 된다. 개별 변경은 `set <키> <값>`.'])); }
    if (!fs.existsSync(deps.store.file)) {
        return cb(null, fail(['conf.json 이 없다 — 먼저 터미널에서 `node mobius.js`(또는 `npm run setup`)로 만들 것 (' + deps.store.file + ')']));
    }
    var rl = readline.createInterface({ input: io.stdin, output: io.stdout });
    var patch = {}, order = [], closing = false, eof = false, finished = false;
    rl.on('close', function () { if (!closing) { eof = true; finish(); } });

    var groups = grouped(schema).map(function (g) {
        return { group: g.group, keys: g.keys.filter(function (k) { return visible(deps, k) && schema.get(k).secret !== true; }) };
    }).filter(function (g) { return g.keys.length; });

    io.stdout.write('\n설정 편집 — Enter 는 그대로 두고, Ctrl-C 는 취소한다.' +
                    (deps.all ? ' (고급 키 포함)' : ' 사용자 키만 묻는다 — 고급 키는 --all.') + '\n');

    (function nextGroup(gi) {
        if (eof) { return; }
        if (gi >= groups.length) { closing = true; rl.close(); return finish(); }
        var grp = groups[gi];
        io.stdout.write('\n' + grp.group + '\n');
        (function nextKey(ki) {
            if (eof) { return; }
            if (ki >= grp.keys.length) { return nextGroup(gi + 1); }
            var k = grp.keys[ki], s = schema.get(k);
            var inFile = has(conf, k), cur = inFile ? conf[k] : s.dflt;
            if (s.readOnly) {
                io.stdout.write('  ' + pad(k, 20) + ' ' + pad(norm(cur), 30) + ' 읽기 전용 — 파일을 직접 고친다\n');
                return nextKey(ki + 1);
            }
            var choices = schema.choices(k);
            var hint = choices ? '(' + choices.join(' / ') + ')' : (s.type === 'array' ? '(쉼표로 구분)' : '');
            (function ask() {
                rl.question('  ' + pad(k, 20) + ' ' + pad(norm(cur) + (inFile ? '' : ' (기본값)'), 30) + ' ' + hint + ' > ', function (ans) {
                    var t = ans.trim();
                    if (t === '') { return nextKey(ki + 1); }
                    var a = applyAnswer(k, t, deps);
                    if (!a.ok) {
                        io.stdout.write('    ' + (a.stage === 'validate' && s.validHint ? s.validHint : a.reason) + '\n');
                        return ask();
                    }
                    // A key absent from the file that is answered by typing (even with a value equal to the default) goes into the file. Only Enter (the t === '' branch above) means 'keep'; a typed answer is an explicit setting.
                    if (inFile && norm(a.value) === norm(cur)) { return nextKey(ki + 1); }
                    patch[k] = a.value;
                    if (order.indexOf(k) < 0) { order.push(k); }
                    nextKey(ki + 1);
                });
            })();
        })(0);
    })(0);

    function finish() {
        if (finished) { return; }
        finished = true;
        if (eof) { io.stdout.write('\n'); return cb(null, fail(['취소했다 — 파일을 건드리지 않았다'])); }
        if (!order.length) { return cb(null, { ok: true, lines: [NOTHING_CHANGED] }); }
        var desc = schema.describe();
        var gates = order.filter(function (k) { return desc[k] && desc[k].grade === 'gate'; });
        (function nextGate(i) {
            if (i >= gates.length) { return write(); }
            var k = gates[i];
            exports.confirmGate(k, desc[k].gateWarn, io, function (pass, why) {
                // Ctrl-C/EOF (reason 'eof') means 'cancel everything', not 'skip this key': the edit holds several keys at once, and the remaining keys must not be written against the user's intent. finished is already true, so cb is called here directly instead of through finish().
                if (why === 'eof') { return cb(null, fail(['취소했다 — 파일을 건드리지 않았다'])); }
                if (!pass) {
                    delete patch[k];
                    order = order.filter(function (x) { return x !== k; });
                    io.stdout.write('  ' + k + ' 은 빼고 진행한다.\n');
                }
                nextGate(i + 1);
            });
        })(0);
        function write() {
            if (!order.length) { return cb(null, { ok: true, lines: [NOTHING_CHANGED] }); }
            var r = deps.store.update(patch);
            if (!r.ok) { return cb(null, fail(r.errors)); }
            var lines = r.changed.map(function (ch) { return ch.key + ': ' + norm(ch.from) + ' → ' + norm(ch.to); });
            lines.push('재기동해야 반영된다 — 파일 값은 기동 때 한 번 읽힌다.  (' + deps.store.file + ')');
            cb(null, { ok: true, lines: lines });
        }
    }
};

function pm2_line(master, list) {
    var notPm2 = master.supervised ? 'pm2 로 떴으나 지금 목록에서 찾지 못함' : 'pm2 로 뜬 것이 아니다';
    if (!Array.isArray(list)) { return notPm2; }
    // Selected by pid, not by name: the deployment daemon runs many apps. Mobius runs in fork_mode, so the pid pm2 sees is the master pid.
    var app = list.filter(function (a) { return a && a.pid === master.pid; })[0];
    if (!app) { return notPm2 + ' (목록에 이 pid 가 없다)'; }
    var env = app.pm2_env || {};
    return 'pm2 ' + (env.status || '?') + ' · 재시작 ' + (env.restart_time || 0) + '회 · 이름 ' + app.name;
}

exports.renderStatus = function (deps, cb) {
    var rec = deps.readRecord();
    var live = exports.liveness(rec, deps.alive);
    var lines = [];
    var warns = exports.warnings(rec);
    if (!live.running) {
        lines.push(pad('Mobius', 10) + ' 떠 있지 않다 — ' + live.reason);
        warns.forEach(function (w) { lines.push(pad('경고', 10) + ' ' + w); });
        return cb(null, lines);
    }
    var m = live.master;
    var port = (m.conf && m.conf.csebaseport) || '?';
    deps.probePort(port, function (open) {
        lines.push(pad('Mobius', 10) + ' 돌고 있다 · 마스터 pid ' + m.pid + ' 살아 있음 · 포트 ' + port +
                   (open ? ' 열림' : ' 닫힘 ⚠ 기동 중이거나 listen 에 실패했다'));
        lines.push(pad('기동', 10) + ' ' + fmt_at(m.at) + ' · 워커 ' + m.workers);
        deps.pm2List(function (list) {
            lines.push(pad('감독', 10) + ' ' + pm2_line(m, list));
            var pending = exports.pendingKeys(deps, m.conf);
            lines.push(pad('설정', 10) + ' ' + (pending.length ? '재기동 대기 ' + pending.length + '건  (' + pending.join(', ') + ')' : '재기동 대기 없음'));
            warns.forEach(function (w) { lines.push(pad('경고', 10) + ' ' + w); });
            cb(null, lines);
        });
    });
};

// Only checks whether the port is open; supplementary information, not the evidence for 'running'.
exports.probePort = function (port, cb) {
    if (!(Number(port) > 0)) { return cb(false); }
    var done = false;
    var sock = net.connect({ host: '127.0.0.1', port: Number(port) });
    function finish(v) {
        if (done) { return; }
        done = true;
        try { sock.destroy(); } catch (e) { /* already closed */ }
        cb(v);
    }
    sock.on('connect', function () { finish(true); });
    sock.on('error', function () { finish(false); });
    sock.setTimeout(PROBE_TIMEOUT_MS, function () { finish(false); });
};

// pm2 jlist. Any failure is null: 'no pm2'. The shell is used because of pm2.cmd on Windows.
exports.pm2List = function (cb) {
    var done = false;
    function finish(v) { if (done) { return; } done = true; cb(v); }
    try {
        cp.execFile('pm2', ['jlist'], { timeout: PM2_TIMEOUT_MS, shell: process.platform === 'win32', windowsHide: true },
            function (err, stdout) {
                if (err) { return finish(null); }
                try { finish(JSON.parse(String(stdout))); } catch (e) { finish(null); }
            });
    } catch (e) {
        finish(null);
    }
};

exports.main = function (args, deps, cb) {
    function out(lines) { deps.io.stdout.write(lines.join('\n') + '\n'); }
    var cmd = args[0];
    if (!cmd) { out(exports.renderList(deps)); return cb(null, 0); }
    if (cmd === 'status') {
        return exports.renderStatus(deps, function (err, lines) { out(lines); cb(null, 0); });
    }
    if (cmd === 'edit') {
        return exports.runEdit(deps, function (err, r) { out(r.lines); cb(null, r.ok ? 0 : 1); });
    }
    if (cmd === 'set') {
        return exports.runSet(args[1], args[2], deps, function (err, r) { out(r.lines); cb(null, r.ok ? 0 : 1); });
    }
    if (cmd === 'unset') {
        return exports.runUnset(args[1], deps, function (err, r) { out(r.lines); cb(null, r.ok ? 0 : 1); });
    }
    if (cmd === 'help' || cmd === '--help' || cmd === '-h') { out(USAGE); return cb(null, 0); }
    if (deps.schema.get(cmd)) {
        if (!visible(deps, cmd)) { out(advanced_fail(cmd).lines); return cb(null, 1); }
        out(exports.renderShow(cmd, deps)); return cb(null, 0);
    }
    out(['모르는 명령 또는 키다: ' + cmd, ''].concat(USAGE));
    cb(null, 2);
};

exports.USAGE = USAGE;
