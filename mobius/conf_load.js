'use strict';
/**
 * Reads conf.json and sets the global.* values. Kept apart from mobius.js so it
 * can be tested without loading app.js, which connects, forks and listens on
 * require.
 *
 * Contract
 *   conf_load(opts, callback)     opts may be omitted
 *     opts.file    path of the conf.json to read. The default is conf.json in the
 *                  repository root, not cwd; admin/server.js and the CLI use the
 *                  same root, so the three agree.
 *   callback(err, applied)
 *     applied      conf key -> the value just set on the global. The boot record
 *                  writes it. Only keys the core sets are included; adapter keys
 *                  and console keys are not.
 *
 * Never calls process.exit on any path. Failures are returned as callback(err)
 * and mobius.js decides whether to exit; a module that exits would take the
 * test runner down with it.
 *
 * Do not extend this header. test/usesqlite-single-reader.test.js lists the line
 * numbers of DEFAULT_CONF and select_backend below in its allow list, so the
 * lines above them must keep their count.
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DEFAULT_FILE = path.join(ROOT, 'conf.json');

// Used when the file cannot be parsed; the file itself is left untouched (see read_conf).
// A missing file is not created here; the wizard asks (first_run).
var DEFAULT_CONF = {
    csebaseport: "7579",
    dbpass: "dksdlfduq2",
    db: "mysql"
};

// Port value as a string; the default when empty.
function port_of(v, dflt) {
    return (v === undefined || v === null || String(v) === '') ? dflt : String(v);
}

// The only place that sets the backend selector. The adapter is mobius/db/<name>.js.
//   node mobius.js postgres        by argument
//   "db": "postgres" in conf.json  by configuration
// An unknown name is logged by the facade, which falls back to mysql (mobius/db/index.js).
// conf.db is used when no argument is given; mysql when neither is set.
//
// Must run before any code that requires conf_schema: that table merges the keys of
// the backend selected at require time, and the facade caches the selection.
function select_backend(conf) {
    var usedb = process.argv[2] || conf.db || 'mysql';
    global.usedb = usedb;
    return usedb;
}

// Sets the globals and records each value in applied at the same place, so there is no separate mapping table. Default values must use one of the three shapes below; test/conf-schema.test.js compares them with the table's dflt.
//     ? conf.K : literal;     conf.K || literal;     fn(conf.K, literal)
function apply_conf(conf) {
    var applied = {};
    applied.db = select_backend(conf);

    // CSE identity. What changing these does is described in the gateWarn of mobius/conf_schema.js.
    global.usecsebase = conf.cseBase || 'Mobius';
    applied.cseBase = global.usecsebase;
    global.usecseid = conf.cseId || '/Mobius2';
    applied.cseId = global.usecseid;
    global.usespid = conf.spId || '//keti.re.kr';
    applied.spId = global.usespid;
    // Valid values (1/2/2a) are enforced by the table on save; a hand-edited value goes into the header as is.
    global.uservi = conf.releaseVersion || '2a';
    applied.releaseVersion = global.uservi;
    // Falls back to 7579, the table's default, when the key is missing.
    global.usecsebaseport = port_of(conf.csebaseport, '7579');
    applied.csebaseport = global.usecsebaseport;

    // This value in X-M2M-Origin makes security.check pass at the top, skipping every ACP check. Effectively a master key.
    global.usesuperuser = (typeof conf.superUser === 'string' && conf.superUser !== '')
        ? conf.superUser : 'Sponde';
    applied.superUser = global.usesuperuser;

    // Default retention policy per container path (optional); format in mobius/cnt.js.
    global.retention_policies = Array.isArray(conf.retentionPolicies) ? conf.retentionPolicies : [];
    applied.retentionPolicies = global.retention_policies;

    // Response wait limit (ms) for outbound requests (fan-out, CSR forwarding, notifications). 0 selects the default in mobius/outbound.js (10 s).
    global.outbound_timeout_ms = (typeof conf.outboundTimeoutMs === 'number' && conf.outboundTimeoutMs > 0)
        ? conf.outboundTimeoutMs : 0;
    applied.outboundTimeoutMs = global.outbound_timeout_ms;

    // Maximum request body size in bytes; larger bodies are cut with 413 before they are fully received. Default 10 MB.
    global.max_body_bytes = (typeof conf.maxBodyBytes === 'number' && conf.maxBodyBytes > 0)
        ? conf.maxBodyBytes : 10 * 1024 * 1024;
    applied.maxBodyBytes = global.max_body_bytes;


    // Retention sweep interval (ms); a timer that runs in the primary only.
    global.purge_sweep_ms = (typeof conf.purgeSweepMs === 'number' && conf.purgeSweepMs >= 1000)
        ? conf.purgeSweepMs : 10000;
    applied.purgeSweepMs = global.purge_sweep_ms;

    // Time (ms) after which a periodic-job latch without progress is reported. 0 disables the check.
    global.latchStaleMs = (typeof conf.latchStaleMs === 'number' && conf.latchStaleMs >= 0)
        ? conf.latchStaleMs : 900000;
    applied.latchStaleMs = global.latchStaleMs;

    // DB connection pool. One pool per process, so the total is dbConnectionLimit x process count.
    global.use_db_connection_limit =
        (typeof conf.dbConnectionLimit === 'number' && conf.dbConnectionLimit >= 1)
            ? conf.dbConnectionLimit : 25;
    applied.dbConnectionLimit = global.use_db_connection_limit;

    // 0 means an unbounded queue with no timeout, so requests would hang forever when the pool is dry; a finite value makes the driver refuse immediately.
    global.use_db_queue_limit =
        (typeof conf.dbQueueLimit === 'number' && conf.dbQueueLimit >= 0)
            ? conf.dbQueueLimit : 50;
    applied.dbQueueLimit = global.use_db_queue_limit;

    // Backend-specific settings are read by the adapter: the whole conf is passed and the adapter decides which keys it looks at.
    require('./db').applyConf(conf);

    // Network
    global.use_mqtt_broker = conf.mqttBroker || 'localhost';
    applied.mqttBroker = global.use_mqtt_broker;
    // Any value other than 'enable' is disable, so a typo cannot select the HTTPS branch.
    global.use_secure = (conf.useSecure === 'enable') ? 'enable' : 'disable';
    applied.useSecure = global.use_secure;
    global.use_mqtt_port = port_of(conf.mqttPort, '1883');
    if (global.use_secure === 'enable') {
        // Explicit global assignment.
        global.use_mqtt_port = '8883';
    }
    applied.mqttPort = global.use_mqtt_port;   // with enable the derived 8883 is recorded; the CLI shows it as derived

    // Despite its name this is the default policy for resources without acpi, not whether ACP is used.
    global.useaccesscontrolpolicy = conf.defaultAccessPolicy || 'disable';
    applied.defaultAccessPolicy = global.useaccesscontrolpolicy;

    // ACP observation. acpObserveMode 'observe' turns denials into allows.
    global.acp_observe_mode = conf.acpObserveMode || 'off';
    applied.acpObserveMode = global.acp_observe_mode;
    // Kept in variables so the table's dflt comparison can see them.
    var deny_log = conf.acpDenyLog || 'sample';
    var deny_rate = (typeof conf.acpDenyLogRate === 'number') ? conf.acpDenyLogRate : 5;
    applied.acpDenyLog = deny_log;
    applied.acpDenyLogRate = deny_rate;
    require('./acp_observe').configure({
        mode: global.acp_observe_mode,
        denyLog: deny_log,
        rate: deny_rate
    });
    if (global.acp_observe_mode === 'observe') {
        console.log('[acp] 관찰 모드다 — ACP 거부가 허용으로 나간다. 확인이 끝나면 반드시 끈다.');
    }

    // Who may attach the first acpi to a resource that has none.
    global.acpi_attach_policy = (conf.acpiAttachPolicy === 'creator') ? 'creator' : 'open';
    applied.acpiAttachPolicy = global.acpi_attach_policy;

    // ACP and acpi change history (acp_audit table).
    global.acp_audit = (conf.acpAudit === 'off') ? 'off' : 'on';
    applied.acpAudit = global.acp_audit;

    // Whether discovery results are filtered by per-resource ACP; without it the paths of locked containers appear in ancestor discoveries.
    global.acp_discovery_filter = (conf.acpDiscoveryFilter === 'off') ? 'off' : 'on';
    applied.acpDiscoveryFilter = global.acp_discovery_filter;

    // Access restriction. Empty allows everyone; otherwise anything outside the list gets 403-1 (checked in app.js).
    global.allowed_ae_ids = Array.isArray(conf.allowedAeIds) ? conf.allowedAeIds : [];
    applied.allowedAeIds = global.allowed_ae_ids;
    global.allowed_app_ids = Array.isArray(conf.allowedAppIds) ? conf.allowedAppIds : [];
    applied.allowedAppIds = global.allowed_app_ids;

    return applied;
}

// Reads conf.json.
//
// A read failure is never repaired by writing.
//   missing   first install. The file is not created here; when this is the primary on an interactive terminal the wizard asks (first_run), otherwise the result is NO_CONF. With opts.file given, nothing is created unless wizard is on.
//   broken    left untouched. The error is logged and the defaults are used, so a worker re-forked while someone is writing the file still starts.
function read_conf(file, opts, callback) {
    var conf;
    if (!fs.existsSync(file)) {
        if (!opts.wizard) {
            return callback(no_conf_error(file, '이 경로에는 만들지 않는다'));
        }
        return first_run(file, opts, callback);
    }
    try {
        conf = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (e) {
        // Never overwrite. The seal is not checked either: the file is broken, not hand-edited.
        conf = JSON.parse(JSON.stringify(DEFAULT_CONF));
        console.error('[conf] conf.json 을 읽지 못했다: ' + ((e && e.message) || e));
        console.error('[conf] **파일은 그대로 둔다.** 기본값으로 진행하지만 ' +
                      'dbpass 가 달라 DB 연결이 실패할 가능성이 높다. ' +
                      '파일을 고치고 다시 띄울 것.');
        return callback(null, conf);
    }
    if (opts.seal) {
        // dbpass and superUser may only be changed through the tools; a hand edit refuses to start.
        var v = require('./conf_seal').verify(file, conf);
        if (!v.ok) { return callback(bad_seal_error(v.reason)); }
    }
    callback(null, conf);
}

function no_conf_error(file, why) {
    var e = new Error('[설정 없음] conf.json 이 없고 ' + why + '.\n' +
                      '            터미널에서 `node mobius.js` 를 한 번 실행하면 설정을 묻고 만든다 (또는 `npm run setup`).\n' +
                      '            (' + file + ')');
    e.code = 'NO_CONF';
    return e;
}

function bad_seal_error(reason) {
    var e = new Error('[설정] ' + reason + '.\n' +
                      '            conf.json 의 dbpass·superUser 는 도구로만 바꾼다 — 터미널에서 `npm run setup -- --superuser` 를 치고 ' +
                      'Enter(값 유지) 하면 봉인이 만들어진다.');
    e.code = 'BAD_SEAL';
    return e;
}

// First-run wizard.
//   - stdin and stdout must both be TTYs.
//   - Workers never ask; they inherit the primary's stdio.
//   - Asynchronous, hence the callback.
//   - rl.close() is reached on every path (setup_prompt).
// File creation failure and cancel are callback(err); mobius.js then does not reach require('./app').
function first_run(file, opts, callback) {
    var io = opts.io || { stdin: process.stdin, stdout: process.stdout };
    var isPrimary = (opts.isPrimary !== undefined) ? !!opts.isPrimary : require('cluster').isPrimary;
    if (!isPrimary) {
        return callback(no_conf_error(file, '워커는 묻지 않는다 (운영 중에 파일이 사라졌다)'));
    }
    if (!(io.stdin.isTTY && io.stdout.isTTY)) {
        return callback(no_conf_error(file, '대화형 터미널이 아니다'));
    }
    var db = require('./db');
    var backends = db.backends();                          // pick() is not called
    var forced = process.argv[2];
    if (forced && backends.indexOf(forced) < 0) {
        // An unknown backend argument is rejected before asking: select_backend prefers argv, so the file would say one backend and the boot would use another.
        var bad = new Error('[설정] 모르는 백엔드 인자다: ' + forced + ' — 쓸 수 있는 것: ' + backends.join(', '));
        bad.code = 'BAD_BACKEND';
        return callback(bad);
    }
    require('./setup_prompt').run({
        backends: backends,
        preset: (backends.indexOf(forced) >= 0) ? { db: forced } : null,
        onBackend: function (name) {
            select_backend({ db: name });                  // the usedb global is set here for the first time
            return { schema: require('./conf_schema'), needsDbpass: !!db.confSchema().dbpass };
        },
        io: io
    }, function (err, answers) {
        if (err) { return callback(err); }
        try {
            require('./conf_write').createExclusive(file, answers);
        }
        catch (e) {
            return callback(new Error('[설정] conf.json 을 만들지 못했다: ' + ((e && e.message) || e)));
        }
        // Sealing is a separate try: at this point conf.json already exists, so a seal failure must not be reported as 'could not create'.
        try {
            require('./conf_seal').seal(file, answers);
        }
        catch (e) {
            return callback(new Error('[설정] conf.json 은 만들었지만 봉인에 실패했다: ' + ((e && e.message) || e) +
                                      ' — npm run setup -- --superuser 로 봉인을 다시 만들 것'));
        }
        io.stdout.write('\nconf.json 을 만들었습니다: ' + file + '\n나머지 설정은 `npm run conf` 로 봅니다.\n\n');
        callback(null, answers);
    });
}

module.exports = function conf_load(opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    opts = opts || {};
    var file = opts.file || DEFAULT_FILE;
    var o = module.exports.resolve_opts(opts);

    read_conf(file, o, function (err, conf) {
        if (err) { return callback(err); }
        var applied;
        try {
            applied = apply_conf(conf);
        }
        catch (e) {
            return callback(e);
        }
        callback(null, applied);
    });
};

module.exports.DEFAULT_FILE = DEFAULT_FILE;

/** Resolves opts in one place. wizard runs only on the default path; tests passing a temporary path must enable it explicitly. seal follows the same rule: not checked when opts.file is given, checked otherwise. */
module.exports.resolve_opts = function (opts) {
    opts = opts || {};
    return {
        wizard: (opts.wizard !== undefined) ? !!opts.wizard : !opts.file,
        io: opts.io,
        isPrimary: opts.isPrimary,
        seal: (opts.seal !== undefined) ? !!opts.seal : !opts.file
    };
};
