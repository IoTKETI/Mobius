'use strict';
/**
 * Mobius admin console: a query server running as a separate process.
 *
 * It lives in the same repository as Mobius (app.js) but is not the same process, and it does not use the cluster: there is one administrator, and several workers could not share the batch job state.
 *
 * Reads go to the DB directly through the mobius/db facade; oneM2M discovery cannot express queries such as 'expired resources in et order'.
 *
 * Writes never touch the DB; they go through Mobius's oneM2M HTTP API (admin/cse.js). As a separate process the console cannot take part in the workers' cache invalidation IPC, and subscription notifications and parent counters live in the application layer.
 *
 * Run:  node admin/server.js [sqlite|mysql]
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var express = require('express');
var moment = require('moment');

var ROOT = path.join(__dirname, '..');

// ── Configuration ──
// conf.json is gitignored; the same file Mobius reads.
var conf = {};
try {
    conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'conf.json'), 'utf8'));
} catch (e) {
    console.error('[admin] conf.json 을 읽을 수 없다: ' + (e.message || e));
    process.exit(1);
}

// The default is loopback. Even read-only, the console shows the production resource tree, so 0.0.0.0 must not be the default; binding externally is an explicit change.
var HOST = (typeof conf.adminHost === 'string' && conf.adminHost !== '')
    ? conf.adminHost : '127.0.0.1';
var PORT = (typeof conf.adminPort === 'number' && conf.adminPort > 0)
    ? conf.adminPort : 7580;

// Without a password the console does not start.
var PASSWORD = (typeof conf.adminPassword === 'string') ? conf.adminPassword : '';
if (PASSWORD === '') {
    console.error('[admin] conf.json 에 adminPassword 가 없다. 콘솔을 띄우지 않는다.');
    console.error('[admin]   {"adminPassword": "..."} 를 넣고 다시 실행한다.');
    process.exit(1);
}

// The DB backend follows the same rule as Mobius (argv wins over conf). The backend is chosen by name, as select_backend in mobius/conf_load.js does; an unknown name falls back to the facade's default.
global.usedb = process.argv[2] || conf.db || 'mysql';


// CSE identity. In Mobius itself mobius/conf_load.js sets it.
//
// The console does not load app.js, so it sets the globals itself. Without them fold_acpi_entry in sql_action reads an undeclared global and throws ReferenceError, which stops the acpi reverse-reference scan (scan_acpi_refs); with wrong values absolute notations such as '//spid/cseid/Mobius/ae' cannot be folded to internal ri and the resource is reported as unreferenced, which skews the ACP deletion impact analysis.
var SUPER_USER = (typeof conf.superUser === 'string' && conf.superUser !== '')
    ? conf.superUser : 'Sponde';

// The CSE identity is read from conf, with the table's default as fallback; copying the core's (conf_load) defaults here would drift silently when the core changes.
var conf_schema = require(path.join(ROOT, 'mobius', 'conf_schema'));
function conf_or_dflt(key) {
    var v = conf[key];
    return (typeof v === 'string' && v !== '') ? v : conf_schema.get(key).dflt;
}
global.usecsebase = conf_or_dflt('cseBase');
global.usecseid = conf_or_dflt('cseId');
global.usespid = conf_or_dflt('spId');
global.usesuperuser = SUPER_USER;

var db = require(path.join(ROOT, 'mobius', 'db'));
var db_sql = require(path.join(ROOT, 'mobius', 'sql_action'));
var responder = require(path.join(ROOT, 'mobius', 'responder'));

var acp_simulate = require(path.join(ROOT, 'mobius', 'acp_simulate'));
var acp_lint = require(path.join(ROOT, 'mobius', 'acp_lint'));
var acp_rules = require(path.join(ROOT, 'mobius', 'acp'));

var jobs = require('./jobs');
var cse_client = require('./cse');

// ── Mobius (CSE) connection: the write path ──
// Without configuration the console starts read-only; the address is never guessed.
var CSE_HOST = (typeof conf.adminCseHost === 'string' && conf.adminCseHost !== '')
    ? conf.adminCseHost : '127.0.0.1';
var CSE_PORT = parseInt(conf.adminCsePort || conf.csebaseport, 10);

// The X-M2M-Origin the console uses.
//
// The default is superUser: the console must be able to delete any resource, which requires passing ACP, and security.js passes this value unconditionally. The console password therefore has the same power as the superUser key. To restrict it by ACP, put a separate AE-ID in adminOrigin; the console can then delete only resources that AE is authorised for.
// SUPER_USER is set above (before the globals).
var CSE_ORIGIN = (typeof conf.adminOrigin === 'string' && conf.adminOrigin !== '')
    ? conf.adminOrigin : SUPER_USER;

var cse = null;
if (CSE_PORT > 0) {
    cse = new cse_client.Client({ host: CSE_HOST, port: CSE_PORT, origin: CSE_ORIGIN });
}

/** Number of targets one job may handle; larger sets are split. */
var MAX_TARGETS = 5000;

// ── Sessions ──
// In memory only; a console restart requires a new login. One administrator, so no separate session store.
var sessions = Object.create(null);
var SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function new_session() {
    var token = crypto.randomBytes(32).toString('hex');
    sessions[token] = { created: Date.now() };
    return token;
}

function valid_session(token) {
    if (!token) { return false; }
    var s = sessions[token];
    if (!s) { return false; }
    if (Date.now() - s.created > SESSION_TTL_MS) {
        delete sessions[token];
        return false;
    }
    return true;
}

// timingSafeEqual throws on different lengths, so both sides are hashed to the same length first.
function password_matches(given) {
    var a = crypto.createHash('sha256').update(String(given)).digest();
    var b = crypto.createHash('sha256').update(PASSWORD).digest();
    return crypto.timingSafeEqual(a, b);
}

function parse_cookie(header) {
    var out = {};
    if (!header) { return out; }
    header.split(';').forEach(function (part) {
        var i = part.indexOf('=');
        if (i < 0) { return; }
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
}

// ── App ──
var app = express();
app.use(express.json({ limit: '256kb' }));

app.post('/api/login', function (req, res) {
    var pw = (req.body && req.body.password) || '';
    if (!password_matches(pw)) {
        // Does not say which side was wrong.
        return res.status(401).json({ error: 'invalid credentials' });
    }
    var token = new_session();
    res.setHeader('Set-Cookie',
        'mobius_admin=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' +
        Math.floor(SESSION_TTL_MS / 1000));
    res.json({ ok: true });
});

app.post('/api/logout', function (req, res) {
    var c = parse_cookie(req.headers.cookie);
    if (c.mobius_admin) { delete sessions[c.mobius_admin]; }
    res.setHeader('Set-Cookie', 'mobius_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
});

// Every API after login passes this gate.
app.use('/api', function (req, res, next) {
    if (req.path === '/login' || req.path === '/logout') { return next(); }
    var c = parse_cookie(req.headers.cookie);
    if (!valid_session(c.mobius_admin)) {
        return res.status(401).json({ error: 'not authenticated' });
    }
    next();
});

// Borrows one DB connection for the handler and always returns it.
function with_connection(res, fn) {
    db.getConnection(function (code, connection) {
        if (code !== '200') {
            return res.status(503).json({ error: 'database unavailable', code: code });
        }
        var released = false;
        function done() {
            if (released) { return; }
            released = true;
            db.release(connection);
        }
        try {
            fn(connection, done);
        } catch (e) {
            done();
            res.status(500).json({ error: String(e.message || e) });
        }
    });
}

function now_et() {
    return moment().utc().format('YYYYMMDDTHHmmss');
}

app.get('/api/session', function (req, res) {
    res.json({
        ok: true,
        // The name the facade chose is returned as is, so a new backend cannot make this line send a wrong name.
        backend: db.backendName(),
        // The screen needs to know whether writes are possible and where that authority comes from. The origin value itself is not sent; superUser is a shared secret.
        write: {
            enabled: cse !== null,
            target: cse ? (CSE_HOST + ':' + CSE_PORT) : null,
            superuser: CSE_ORIGIN === SUPER_USER
        },
        // ACP-related settings. The console reads conf.json, not the workers' actual state: a worker holds these values in its own process memory, so after a conf change without restart the two differ. The screen labels this as 'configured value'.
        acp: {
            observeMode: conf.acpObserveMode || 'off',
            attachPolicy: conf.acpiAttachPolicy || 'open',
            defaultPolicy: conf.defaultAccessPolicy || 'disable',
            audit: conf.acpAudit || 'on',
            denyLog: conf.acpDenyLog || 'sample'
        }
    });
});

/**
 * Expired resource summary: counts per type, up to a cap.
 *
 * No global COUNT(*): the MySQL lookup has no et index. The screen only needs 'many', so counting stops at the cap and reports capped.
 */
app.get('/api/expired/summary', function (req, res) {
    var cap = Math.min(parseInt(req.query.cap, 10) || 5000, 20000);
    with_connection(res, function (conn, done) {
        db_sql.count_expired_by_type(conn, now_et(), cap, function (err, result) {
            done();
            if (err) { return res.status(500).json({ error: String((result && result.message) || err) }); }
            res.json({
                asOf: now_et(),
                cap: cap,
                capped: result.capped,
                counted: result.count,
                byType: result.byType,
                typeNames: responder.typeRsrc
            });
        });
    });
});

/**
 * Expired resource list, (et, ri) keyset paging.
 *
 * Without types everything is shown, AE and CNT included; they are excluded from automatic cleanup and therefore keep accumulating, which is what the administrator wants to see.
 */
app.get('/api/expired', function (req, res) {
    var limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    var types = null;
    if (req.query.types) {
        types = String(req.query.types).split(',')
            .map(function (s) { return parseInt(s, 10); })
            .filter(function (n) { return !isNaN(n); });
    }
    with_connection(res, function (conn, done) {
        db_sql.select_expired_page(conn, now_et(), {
            limit: limit,
            types: types,
            afterEt: req.query.afterEt || null,
            afterRi: req.query.afterRi || null
        }, function (err, page) {
            done();
            if (err) { return res.status(500).json({ error: String((page && page.message) || err) }); }
            res.json({
                asOf: now_et(),
                rows: page.rows,
                more: page.more,
                nextEt: page.nextEt,
                nextRi: page.nextRi,
                typeNames: responder.typeRsrc
            });
        });
    });
});

/**
 * Orphan summary: counts rows whose parent (pi) is not in lookup, up to a cap.
 *
 * Orphans are this server's normal failure mode: DELETE removes the root row, returns 200 and deletes the descendants in the background (delete_descendants_background); if the process dies, no connection can be borrowed or a large subtree hits the timeout, the remaining descendants become orphans. The cleanup is not run automatically; a pass holds one connection for a long time on a large table, so the administrator decides when.
 */
app.get('/api/orphans/summary', function (req, res) {
    var cap = Math.min(parseInt(req.query.cap, 10) || 5000, 50000);
    with_connection(res, function (conn, done) {
        db_sql.count_orphan_lookup(conn, cap, function (err, result) {
            done();
            if (err) { return res.status(500).json({ error: String((result && result.message) || err) }); }
            res.json({ cap: cap, count: result.count, capped: result.capped });
        });
    });
});

/**
 * Orphan list, ri keyset paging.
 *
 * scanCapped means the scan limit was hit: with few orphans, filling one page could scan to the end of the table, so a cap applies. The screen shows that fact.
 */
app.get('/api/orphans', function (req, res) {
    var limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    var scanCap = Math.min(parseInt(req.query.scanCap, 10) || 200000, 2000000);
    with_connection(res, function (conn, done) {
        db_sql.select_orphan_page(conn, {
            limit: limit,
            afterRi: req.query.afterRi || null,
            scanCap: scanCap
        }, function (err, page) {
            done();
            if (err) { return res.status(500).json({ error: String((page && page.message) || err) }); }
            res.json({
                rows: page.rows,
                more: page.more,
                nextRi: page.nextRi,
                scanned: page.scanned,
                scanCapped: page.scanCapped,
                typeNames: responder.typeRsrc
            });
        });
    });
});

// ── No configuration or process control here ──
// Configuration holds the master keys (dbpass, superUser) and belongs to the person on SSH (npm run conf); start and stop belong to the environment (pm2, terminal). The web handles resources only. This boundary is the permission boundary.

// ── ACP (access control) ──
// The purpose of the screens is to find wrongly attached policies and to preview the effect before attaching one.

/**
 * Runs a cursor-based scan to the end.
 *
 * The results are the evidence for 'may this ACP be deleted'; a truncated list would claim there are no references when there are. Even when the scan does not finish, the screen must not look like 'this is everything'.
 *
 * The cursor is one opaque string (result.next -> opts.after). The core rejects the old two-part arguments with BAD_CURSOR.
 *
 * @param call   call(after, cb); after null means from the start
 * @param merge  merge(acc, page) folds a page into the accumulator
 */
var SCAN_MAX_PASSES = 50;
function drain(call, acc, merge, callback) {
    var passes = 0;
    function step(after) {
        call(after, function (err, page) {
            if (err) { return callback(err, page); }
            merge(acc, page);
            if (!page.next) { return callback(null, acc); }
            if (++passes >= SCAN_MAX_PASSES) {
                // The loop ends on !page.next; this cap is insurance against a cursor that does not advance, and hitting it is reported.
                acc.capped = true;
                return callback(null, acc);
            }
            step(page.next);
        });
    }
    step(null);
}

/** Every resource that references this ACP. */
function scan_refs_all(conn, acpRi, callback) {
    var acc = { refs: [], refsTruncated: false, byAcp: {}, scanned: 0,
                capped: false, broken: 0, unresolved: {} };
    drain(
        function (after, cb) {
            var o = { acpRi: acpRi };
            if (after) { o.after = after; }
            db_sql.scan_acpi_refs(conn, o, cb);
        },
        acc,
        function (a, p) {
            a.refs = a.refs.concat(p.refs);
            a.refsTruncated = a.refsTruncated || p.refsTruncated;
            a.scanned += p.scanned;
            a.broken += p.broken;
            (p.unresolved || []).forEach(function (u) { a.unresolved[u] = 1; });
            Object.keys(p.byAcp || {}).forEach(function (k) {
                a.byAcp[k] = (a.byAcp[k] || 0) + p.byAcp[k];
            });
        },
        function (err, a) {
            if (err) { return callback(err, a); }
            a.unresolved = Object.keys(a.unresolved);
            callback(null, a);
        });
}

/** The whole acpi reference check. This is the first screen, so it must not look like 'this is everything' when it is not. */
function lint_refs_all(conn, opts, callback) {
    var acc = { rows: [], counts: { error: 0, warn: 0, clean: 0 }, scanned: 0,
                capped: false, broken: 0, refsTruncated: false, unresolved: {} };
    drain(
        function (after, cb) {
            var o = { batch: opts.batch, scanCap: opts.scanCap, maxRefs: opts.maxRefs };
            if (after) { o.after = after; }
            acp_lint.lint_acpi_refs(conn, o, cb);
        },
        acc,
        function (a, p) {
            a.rows = a.rows.concat(p.rows);
            a.counts.error += p.counts.error;
            a.counts.warn += p.counts.warn;
            a.counts.clean += p.counts.clean;
            a.scanned += p.scanned;
            a.broken += p.broken;
            a.refsTruncated = a.refsTruncated || p.refsTruncated;
            (p.unresolved || []).forEach(function (u) { a.unresolved[u] = 1; });
        },
        function (err, a) {
            if (err) { return callback(err, a); }
            a.unresolved = Object.keys(a.unresolved);
            callback(null, a);
        });
}

/** ACP list. ty equality uses idx_lookup_ty. */
app.get('/api/acp', function (req, res) {
    var limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    with_connection(res, function (conn, done) {
        db_sql.select_acp_list(conn, { limit: limit, afterRi: req.query.afterRi || '' },
            function (err, r) {
                done();
                if (err) { return res.status(500).json({ error: String((r && r.message) || err) }); }
                res.json(r);
            });
    });
});

/**
 * Everything about one ACP: body, the resources that use it, and group macp references.
 *
 * scan_macp_refs is included because fanOutPoint is authorised by grp.macp, not acpi; leaving it out of the deletion impact analysis would silently lock group fan-out.
 */
app.get('/api/acp/detail', function (req, res) {
    var ri = req.query.ri;
    if (!ri) { return res.status(400).json({ error: 'ri 가 필요하다' }); }
    with_connection(res, function (conn, done) {
        db_sql.select_acp_detail(conn, ri, function (err, detail) {
            if (err) { done(); return res.status(500).json({ error: String((detail && detail.message) || err) }); }
            if (!detail) { done(); return res.status(404).json({ error: 'ACP 를 찾을 수 없다' }); }

            // The two scans can fail independently. One failure does not turn the page into a 500, but a failure is not shown as 0 either: '0 group references' reads as 'safe to delete', so something that could not be checked must not be reported as absent. (The SQLite backend has no grp table, so this fails there regularly.)
            scan_refs_all(conn, ri, function (err2, refs) {
                var refsErr = err2 ? String((refs && refs.message) || err2) : null;
                db_sql.scan_macp_refs(conn, { acpRi: ri }, function (err3, macp) {
                    done();
                    var macpErr = err3 ? String((macp && macp.message) || err3) : null;
                    // The ACP's own problems are included, so 'why does this not apply' can be answered on the detail screen instead of another one.
                    var problems = acp_lint._problems_of(detail.pv, 'pv', ri)
                        .concat(acp_lint._problems_of(detail.pvs, 'pvs', ri));
                    res.json({
                        detail: detail,
                        refs: refsErr ? null : refs,
                        refsError: refsErr,
                        macpRefs: macpErr ? null : macp,
                        macpError: macpErr,
                        problems: problems
                    });
                });
            });
        });
    });
});

/** ACP body check; the console's first screen is this list. */
app.get('/api/acp/lint', function (req, res) {
    var limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    with_connection(res, function (conn, done) {
        acp_lint.lint_acp(conn, { limit: limit, afterRi: req.query.afterRi || '' },
            function (err, r) {
                done();
                if (err) { return res.status(500).json({ error: String((r && r.message) || err) }); }
                res.json(r);
            });
    });
});

/**
 * acpi reference check: finds resources pointing at an ACP that does not exist (dangling).
 *
 * No continuation is exposed; the server runs to the end. This list is the console's first screen and must be all of 'what is wrongly attached'.
 */
app.get('/api/acp/lint-refs', function (req, res) {
    with_connection(res, function (conn, done) {
        lint_refs_all(conn, {
            batch: Math.min(parseInt(req.query.batch, 10) || 5000, 20000),
            scanCap: Math.min(parseInt(req.query.scanCap, 10) || 200000, 2000000),
            maxRefs: Math.min(parseInt(req.query.maxRefs, 10) || 500, 2000)
        }, function (err, r) {
            done();
            if (err) { return res.status(500).json({ error: String((r && r.message) || err) }); }
            res.json(r);
        });
    });
});

/**
 * Permission simulator.
 *
 * The console never has itself checked: adminOrigin is superUser and security.js passes it unconditionally, so an HTTP round trip cannot verify a policy. The simulator uses security.js's evaluation function directly.
 */
app.post('/api/acp/simulate', function (req, res) {
    var b = req.body || {};
    if (!b.ri) { return res.status(400).json({ error: 'ri 가 필요하다' }); }
    if (!Array.isArray(b.origins) || b.origins.length === 0) {
        return res.status(400).json({ error: 'origins 가 필요하다' });
    }
    if (!Array.isArray(b.ops) || b.ops.length === 0) {
        return res.status(400).json({ error: 'ops 가 필요하다' });
    }
    with_connection(res, function (conn, done) {
        var opts = { ri: b.ri, origins: b.origins, ops: b.ops };
        if (b.ip) { opts.ip = b.ip; }
        // Asking with unsaved state: the preview before locking.
        if (Array.isArray(b.acpiOverride)) { opts.acpiOverride = b.acpiOverride; }
        if (Array.isArray(b.acpRowsOverride)) { opts.acpRowsOverride = b.acpRowsOverride; }
        // source / acpi / inherited_from / resolved are properties of the resource, not of an originator. The core reads them from the first result that actually resolved acpi, so they do not depend on originator order. When every originator is short-circuited as superuser or creator the value is null (not 'none') with a source_unknown warning, because 'none' would read as 'no ACP', which is false.
        acp_simulate.simulate_many(conn, opts, function (err, r) {
            done();
            if (err) {
                // Exceeding the limit is an input problem, not a server error; the refusal is passed on instead of truncating silently.
                if (r && r.code === 'TOO_MANY') { return res.status(400).json(r); }
                return res.status(500).json({ error: String((r && r.message) || err) });
            }
            res.json(r);
        });
    });
});

/** Pre-save check. A synchronous pure function without DB access, so no connection is needed. */
app.post('/api/acp/validate', function (req, res) {
    var b = req.body || {};
    var field = (b.field === 'pvs') ? 'pvs' : 'pv';
    if (!b.value || typeof b.value !== 'object') {
        return res.status(400).json({ error: 'value 가 필요하다' });
    }
    // The server rejects with the same function, but its response msg is static and cannot say which value is wrong; only this function returns path.
    res.json(acp_rules.validate_privileges(b.value, field));
});

/**
 * Saves an ACP body; only the sent one of pv / pvs changes.
 *
 * The server (Mobius) passes the same guardrails, but the check runs here first: the server's msg is static and cannot say which value is wrong, and path comes only from validate_privileges. The purpose is to point the screen at the place to fix.
 *
 * The write goes through oneM2M PUT, so worker caches are invalidated and acp_audit records the history.
 */
app.post('/api/acp/save', function (req, res) {
    if (!require_write(res)) { return; }
    var b = req.body || {};
    if (typeof b.ri !== 'string' || b.ri.charAt(0) !== '/') {
        return res.status(400).json({ error: 'ri 가 필요하다' });
    }
    var attrs = {};
    var problems = [];
    ['pv', 'pvs'].forEach(function (f) {
        if (b[f] === undefined) { return; }
        if (!b[f] || typeof b[f] !== 'object') {
            problems.push({ field: f, code: '400-57', path: f, message: f + ' 가 객체가 아니다' });
            return;
        }
        var v = acp_rules.validate_privileges(b[f], f);
        if (v.code) { problems.push({ field: f, code: v.code, path: v.path, message: v.message || '' }); }
        attrs[f] = b[f];
    });
    if (problems.length) { return res.status(400).json({ error: '값이 올바르지 않다', problems: problems }); }
    if (Object.keys(attrs).length === 0) {
        return res.status(400).json({ error: 'pv 또는 pvs 중 하나는 보내야 한다' });
    }

    cse.update(b.ri, 'm2m:acp', attrs, function (r) {
        if (r.ok) { return res.json({ ok: true, status: r.status, rsc: r.rsc }); }
        // The server's reason is passed on as is; when the server rejects a value the console let through, that difference is itself information.
        res.status(r.status >= 400 && r.status < 500 ? 400 : 502).json({
            error: describe(r),
            status: r.status,
            rsc: r.rsc,
            body: r.body
        });
    });
});

/** Change history. Newest first, so the cursor is 'id smaller than this'. */
app.get('/api/acp/audit', function (req, res) {
    var limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    with_connection(res, function (conn, done) {
        db_sql.select_acp_audit(conn, {
            ri: req.query.ri || undefined,
            op: req.query.op || undefined,
            limit: limit,
            afterId: req.query.afterId ? parseInt(req.query.afterId, 10) : undefined
        }, function (err, r) {
            done();
            if (err) {
                // Before migration 007 the table does not exist. A 500 would read as 'the server is broken'; the response says what to do.
                return res.status(503).json({
                    error: 'acp_audit 테이블을 읽을 수 없다. ' +
                           '마이그레이션이 적용되지 않았을 수 있다: ' +
                           'node tools/migrate.js --apply mysql --only 007-acp-audit-table',
                    detail: String((r && r.message) || err)
                });
            }
            res.json(r);
        });
    });
});

// ── Batch jobs ──

/** Borrows one connection for fn and always returns it; each job item borrows briefly. */
function borrow(fn) {
    db.getConnection(function (code, connection) {
        if (code !== '200') { return fn('database unavailable (' + code + ')', null, function () {}); }
        var released = false;
        fn(null, connection, function () {
            if (released) { return; }
            released = true;
            db.release(connection);
        });
    });
}

/** Validates the target list; returns a string when something is wrong. */
function bad_targets(ris) {
    if (!Array.isArray(ris) || ris.length === 0) { return '대상이 비어 있다'; }
    if (ris.length > MAX_TARGETS) { return '한 번에 ' + MAX_TARGETS + '건까지 처리한다'; }
    for (var i = 0; i < ris.length; i++) {
        if (typeof ris[i] !== 'string' || ris[i][0] !== '/') {
            return '리소스 경로가 아니다: ' + String(ris[i]).slice(0, 80);
        }
    }
    return null;
}

/**
 * Delete worker. Re-reads the current state from the DB before deleting.
 *
 * The list may be minutes old; if someone extended et meanwhile, deleting on the stale list cannot be undone. One extra read per item is the price of an irreversible delete.
 */
function make_delete_worker(guard) {
    return function (ri, cb) {
        borrow(function (err, conn, done) {
            if (err) { done(); return cb('failed', err); }
            db_sql.select_lookup(conn, ri, function (e, rows) {
                if (e) { done(); return cb('failed', 'DB 조회 실패: ' + String((rows && rows.message) || e)); }
                if (!rows || rows.length === 0) { done(); return cb('skipped', '이미 없음'); }
                var row = rows[0];
                guard(conn, row, function (reason) {
                    done();
                    if (reason) { return cb('skipped', reason); }
                    cse.remove(ri, function (r) {
                        if (r.ok) { return cb('ok'); }
                        if (r.status === 404) { return cb('skipped', '이미 없음'); }
                        cb('failed', describe(r));
                    });
                });
            });
        });
    };
}

function describe(r) {
    if (r.error) { return r.error; }
    var msg = 'HTTP ' + r.status + (r.rsc ? ' rsc=' + r.rsc : '');
    if (r.status === 403) { msg += ' (권한 없음 — adminOrigin 이 ACP 를 통과하지 못한다)'; }
    return msg;
}

/** Types whose et can be extended. CIN cannot be updated at all under oneM2M (405-7). */
var EXTENDABLE = { '1': 1, '2': 1, '3': 1, '9': 1, '23': 1 };

function require_write(res) {
    if (!cse) {
        res.status(503).json({
            error: 'Mobius 주소가 설정되지 않아 쓰기를 할 수 없다. ' +
                   'conf.json 에 csebaseport(또는 adminCsePort)를 넣는다.'
        });
        return false;
    }
    return true;
}

function start_or_conflict(res, spec) {
    var job = jobs.start(spec);
    if (!job) {
        return res.status(409).json({
            error: '이미 도는 작업이 있다. 끝나거나 취소된 뒤에 시작한다.',
            active: jobs.active().view()
        });
    }
    res.status(202).json(job.view());
}

/** Deletes expired resources. Re-checks et right before deleting and deletes only while still expired. */
app.post('/api/jobs/expired-delete', function (req, res) {
    if (!require_write(res)) { return; }
    var ris = req.body && req.body.ris;
    var bad = bad_targets(ris);
    if (bad) { return res.status(400).json({ error: bad }); }

    var asOf = now_et();
    start_or_conflict(res, {
        kind: 'expired-delete',
        title: '만료 리소스 삭제 ' + ris.length + '건',
        note: '삭제 직전 et 를 다시 확인한다. 그사이 만료가 풀린 것은 건너뛴다.',
        targets: ris,
        concurrency: 4,
        worker: make_delete_worker(function (conn, row, next) {
            // An empty et means the resource has no expiry; even if it came from the expiry screen it is not expired now and is left alone.
            if (!row.et) { return next('et 가 없음'); }
            if (row.et >= asOf) { return next('만료가 해제됨 (et=' + row.et + ')'); }
            next(null);
        })
    });
});

/**
 * Deletes orphan resources. Re-checks right before deleting that the parent is really gone.
 *
 * If the parent has reappeared the row is live data, not an orphan, and must not be deleted on a stale list.
 */
app.post('/api/jobs/orphan-delete', function (req, res) {
    if (!require_write(res)) { return; }
    var ris = req.body && req.body.ris;
    var bad = bad_targets(ris);
    if (bad) { return res.status(400).json({ error: bad }); }

    start_or_conflict(res, {
        kind: 'orphan-delete',
        title: '고아 리소스 삭제 ' + ris.length + '건',
        note: '삭제 직전 부모가 여전히 없는지 다시 확인한다. ' +
              '끝난 직후의 목록에는 방금 지운 것의 자식들이 새 고아로 올라온다 — ' +
              '그중 일부는 배경 정리가 곧 지울 것들이니, 잠시 뒤 “다시 세기”로 확인한다.',
        targets: ris,
        concurrency: 4,
        worker: make_delete_worker(function (conn, row, next) {
            if (!row.pi) { return next('부모 경로가 비어 있음 (CSEBase)'); }
            db_sql.select_lookup(conn, row.pi, function (e, prows) {
                if (e) { return next('부모 확인 실패 — 안전을 위해 건너뜀'); }
                if (prows && prows.length > 0) { return next('부모가 다시 생김 — 고아가 아님'); }
                next(null);
            });
        })
    });
});

/** Extends et. Takes an absolute time: computing 'N days later' on the server could differ from what the screen showed. */
app.post('/api/jobs/expired-extend', function (req, res) {
    if (!require_write(res)) { return; }
    var ris = req.body && req.body.ris;
    var et = req.body && req.body.et;
    var bad = bad_targets(ris);
    if (bad) { return res.status(400).json({ error: bad }); }
    if (typeof et !== 'string' || !/^\d{8}T\d{6}$/.test(et)) {
        return res.status(400).json({ error: 'et 형식이 YYYYMMDDThhmmss 가 아니다' });
    }
    if (et <= now_et()) {
        return res.status(400).json({ error: '새 et 가 현재보다 과거다 — 연장이 되지 않는다' });
    }

    start_or_conflict(res, {
        kind: 'expired-extend',
        title: 'et 연장 ' + ris.length + '건 → ' + et,
        note: 'CIN 은 oneM2M 상 수정할 수 없어 건너뛴다.',
        targets: ris,
        concurrency: 4,
        worker: function (ri, cb) {
            borrow(function (err, conn, done) {
                if (err) { done(); return cb('failed', err); }
                db_sql.select_lookup(conn, ri, function (e, rows) {
                    done();
                    if (e) { return cb('failed', 'DB 조회 실패: ' + String((rows && rows.message) || e)); }
                    if (!rows || rows.length === 0) { return cb('skipped', '이미 없음'); }
                    var ty = String(rows[0].ty);
                    if (!EXTENDABLE[ty]) {
                        // No Korean particle is appended, because it depends on the type name's final consonant.
                        var nm = responder.typeRsrc[ty] || ('ty' + ty);
                        return cb('skipped', nm.toUpperCase() + ' — et 를 수정할 수 없는 타입');
                    }
                    cse.setExpiry(ri, 'm2m:' + responder.typeRsrc[ty], et, function (r) {
                        if (r.ok) { return cb('ok'); }
                        if (r.status === 404) { return cb('skipped', '이미 없음'); }
                        cb('failed', describe(r));
                    });
                });
            });
        }
    });
});

app.get('/api/jobs', function (req, res) {
    res.json({ jobs: jobs.list() });
});

app.get('/api/jobs/:id', function (req, res) {
    var job = jobs.get(req.params.id);
    if (!job) { return res.status(404).json({ error: 'no such job' }); }
    res.json(job.view());
});

app.post('/api/jobs/:id/cancel', function (req, res) {
    if (!jobs.cancel(req.params.id)) {
        return res.status(409).json({ error: '취소할 수 없다 — 이미 끝났거나 없는 작업이다' });
    }
    res.json(jobs.get(req.params.id).view());
});

// ── Static files ──
var WEB_DIST = path.join(__dirname, 'web', 'dist');
if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get('*', function (req, res) {
        res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
} else {
    app.get('/', function (req, res) {
        res.status(503).type('text/plain').send(
            '프런트엔드가 아직 빌드되지 않았다.\n' +
            '  cd admin/web && npm install && npm run build\n' +
            '개발 중에는 Vite dev server(npm run dev)를 쓰고 /api 는 이 서버로 프록시된다.\n');
    });
}

// ── Startup ──
// Checks once at startup that acpi folding is possible. Globals that are set wrongly drift silently: absolute notations are not folded to internal ri, the resource is reported as 'unreferenced' and the ACP deletion impact analysis is wrong. Wrongly set is worse than unset, so it is printed visibly.
if (typeof db_sql.acp_ri_context === 'function') {
    var acp_ctx = db_sql.acp_ri_context();
    if (!acp_ctx.ok) {
        console.error('[admin] 경고: CSE 신원 전역이 비었다 (' + acp_ctx.missing.join(', ') + ').');
        console.error('[admin]   acpi 역참조가 어긋나 "참조 없음" 을 잘못 보고할 수 있다.');
    }
}

// applyConf before connect: the adapter reads its own values (password etc.) from conf, so without this line the adapter's conf stays {} and it connects with an empty password. test/db-connect-wiring.test.js keeps this order.
db.applyConf(conf);

db.connect(function (rsc) {
    if (rsc !== '1') {
        console.error('[admin] DB 연결 실패 (' + rsc + ')');
        process.exit(1);
    }
    app.listen(PORT, HOST, function () {
        // The backend name comes from the facade, so a new backend cannot make this line print a wrong name.
        console.log('[admin] 관리 콘솔 ' + HOST + ':' + PORT +
                    ' (backend=' + db.backendName() + ')');
        if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
            console.warn('[admin] 경고: 루프백이 아닌 주소에 바인드했다 — 접근 통제를 확인할 것.');
        }
    });
});
