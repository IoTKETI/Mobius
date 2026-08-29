'use strict';
/**
 * Mobius 관리 콘솔 — 별도 프로세스로 도는 조회 서버.
 *
 * Mobius(app.js)와 같은 저장소에 있지만 같은 프로세스가 아니다. 클러스터도
 * 쓰지 않는다 — 접속자가 관리자 한 명이고, 워커가 여럿이면 나중에 붙일 일괄
 * 작업 큐 상태를 공유할 수 없다.
 *
 * 읽기는 mobius/db 파사드로 DB 를 직접 본다. oneM2M discovery 로는 "만료된
 * 리소스를 et 순으로" 같은 질의를 표현할 수 없다.
 *
 * **쓰기는 DB 를 건드리지 않고 Mobius 의 oneM2M HTTP API 를 지난다**(admin/cse.js).
 * 콘솔은 별도 프로세스라 워커들의 캐시 무효화 IPC 에 낄 수 없다 — DB 를 직접
 * 지우면 워커들이 지워진 리소스를 계속 200 으로 돌려준다. 구독 알림과 부모
 * 카운터도 앱 레이어에 있다.
 *
 * 실행:  node admin/server.js [sqlite|mysql]
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var express = require('express');
var moment = require('moment');

var ROOT = path.join(__dirname, '..');

// ── 설정 ──────────────────────────────────────────────────────────────────
// conf.json 은 gitignore 되어 있다. Mobius 본체와 같은 파일을 읽는다.
var conf = {};
try {
    conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'conf.json'), 'utf8'));
} catch (e) {
    console.error('[admin] conf.json 을 읽을 수 없다: ' + (e.message || e));
    process.exit(1);
}

// 기본은 루프백이다. 조회 전용이라도 운영 리소스 트리를 그대로 보여 주므로
// 기본값이 0.0.0.0 이면 안 된다. 외부에 열려면 명시적으로 바꾼다.
var HOST = (typeof conf.adminHost === 'string' && conf.adminHost !== '')
    ? conf.adminHost : '127.0.0.1';
var PORT = (typeof conf.adminPort === 'number' && conf.adminPort > 0)
    ? conf.adminPort : 7580;

// 비밀번호가 없으면 뜨지 않는다. "일단 열어 두고 나중에 잠근다" 가 되면
// 나중은 오지 않는다.
var PASSWORD = (typeof conf.adminPassword === 'string') ? conf.adminPassword : '';
if (PASSWORD === '') {
    console.error('[admin] conf.json 에 adminPassword 가 없다. 콘솔을 띄우지 않는다.');
    console.error('[admin]   {"adminPassword": "..."} 를 넣고 다시 실행한다.');
    process.exit(1);
}

// DB 백엔드는 Mobius 와 같은 규칙을 따른다 (argv 가 conf 를 이긴다).
if (process.argv[2] === 'sqlite') { global.usesqlite = 'true'; }
else if (process.argv[2] === 'mysql') { global.usesqlite = 'false'; }
else { global.usesqlite = conf.usesqlite; }

global.usedbhost = 'localhost';
global.usedbpass = conf.dbpass;

// CSE 신원. Mobius 본체는 mobius.js 와 app.js 에서 이 값들을 세운다.
//
// 콘솔은 app.js 를 읽지 않으므로 직접 세워야 한다. 안 세우면 sql_action 의
// fold_acpi_entry 가 **선언되지 않은 전역을 읽어 ReferenceError 로 죽는다** —
// acpi 역참조 스캔(scan_acpi_refs)이 통째로 못 돈다. 값이 있어도 틀리면
// '//spid/cseid/Mobius/ae' 같은 절대 표기를 내부 ri 로 접지 못해, 그 리소스를
// 참조가 없는 것으로 잘못 보고한다 — ACP 삭제 영향 분석이 조용히 빗나간다.
var SUPER_USER = (typeof conf.superUser === 'string' && conf.superUser !== '')
    ? conf.superUser : 'Sponde';

global.usecsebase = 'Mobius';
global.usecseid = '/Mobius2';
global.usespid = '//keti.re.kr';
global.usesuperuser = SUPER_USER;

var db = require(path.join(ROOT, 'mobius', 'db'));
var db_sql = require(path.join(ROOT, 'mobius', 'sql_action'));
var responder = require(path.join(ROOT, 'mobius', 'responder'));

var acp_simulate = require(path.join(ROOT, 'mobius', 'acp_simulate'));
var acp_lint = require(path.join(ROOT, 'mobius', 'acp_lint'));
var acp_rules = require(path.join(ROOT, 'mobius', 'acp'));

var jobs = require('./jobs');
var cse_client = require('./cse');

// ── Mobius(CSE) 연결 — 쓰기 경로 ──────────────────────────────────────────
// 설정이 없으면 조회 전용으로 뜬다. 주소를 추측해서 다른 곳에 DELETE 를 쏘는
// 일은 없어야 한다.
var CSE_HOST = (typeof conf.adminCseHost === 'string' && conf.adminCseHost !== '')
    ? conf.adminCseHost : '127.0.0.1';
var CSE_PORT = parseInt(conf.adminCsePort || conf.csebaseport, 10);

// 콘솔이 쓰는 X-M2M-Origin.
//
// 기본은 superUser 다. 관리 콘솔은 어떤 리소스든 지울 수 있어야 하는데 그러려면
// ACP 를 통과해야 하고, security.js:356 이 이 값에 대해 무조건 통과시킨다.
// **즉 콘솔의 비밀번호는 사실상 superUser 키와 같은 힘을 가진다.** ACP 로
// 제한하고 싶으면 adminOrigin 에 별도 AE-ID 를 넣는다 — 그러면 콘솔은 그
// AE 가 권한을 가진 리소스만 지울 수 있다.
// SUPER_USER 는 위에서(전역 설정 전에) 정한다.
var CSE_ORIGIN = (typeof conf.adminOrigin === 'string' && conf.adminOrigin !== '')
    ? conf.adminOrigin : SUPER_USER;

var cse = null;
if (CSE_PORT > 0) {
    cse = new cse_client.Client({ host: CSE_HOST, port: CSE_PORT, origin: CSE_ORIGIN });
}

/** 한 작업이 다룰 수 있는 대상 수. 넘으면 나눠서 돌린다. */
var MAX_TARGETS = 5000;

// ── 세션 ──────────────────────────────────────────────────────────────────
// 메모리에만 둔다. 콘솔을 재시작하면 다시 로그인한다 — 관리자 한 명이라
// 세션 저장소를 따로 둘 이유가 없다.
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

// 길이가 다르면 timingSafeEqual 이 던지므로 먼저 해시로 길이를 맞춘다.
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

// ── 앱 ────────────────────────────────────────────────────────────────────
var app = express();
app.use(express.json({ limit: '256kb' }));

app.post('/api/login', function (req, res) {
    var pw = (req.body && req.body.password) || '';
    if (!password_matches(pw)) {
        // 어느 쪽이 틀렸는지 알려 주지 않는다.
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

// 로그인 뒤의 모든 API 는 이 게이트를 지난다.
app.use('/api', function (req, res, next) {
    if (req.path === '/login' || req.path === '/logout') { return next(); }
    var c = parse_cookie(req.headers.cookie);
    if (!valid_session(c.mobius_admin)) {
        return res.status(401).json({ error: 'not authenticated' });
    }
    next();
});

// DB 커넥션을 하나 빌려 핸들러에 넘기고, 끝나면 반드시 반납한다.
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
        backend: global.usesqlite === 'true' ? 'sqlite' : 'mysql',
        // 쓰기가 가능한지, 그리고 그 권한이 어디서 오는지 화면이 알아야 한다.
        // origin 값 자체는 내려보내지 않는다 — superUser 는 공유 비밀이다.
        write: {
            enabled: cse !== null,
            target: cse ? (CSE_HOST + ':' + CSE_PORT) : null,
            superuser: CSE_ORIGIN === SUPER_USER
        },
        // ACP 관련 설정. **콘솔이 읽는 것은 conf.json 이지 워커의 실제 상태가
        // 아니다.** 워커는 자기 프로세스 메모리에 이 값을 들고 있고 콘솔은 거기
        // 닿을 수 없다 — conf 를 고친 뒤 재기동하지 않았다면 어긋난다.
        // 화면은 이것을 "설정값 기준" 이라고 밝힌다.
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
 * 만료 리소스 요약. 타입별 개수를 상한 안에서 센다.
 *
 * 전역 COUNT(*) 를 하지 않는 이유: 배포의 MySQL lookup 에는 et 인덱스가 없고
 * 행이 5,740만이다. 화면은 "많다"만 알면 되므로 상한에서 끊고 capped 를 준다.
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
 * 만료 리소스 목록. (et, ri) 키셋 페이징.
 *
 * types 를 주지 않으면 AE·CNT 를 포함한 전부를 보여 준다 — 자동 정리에서
 * 빠지기 때문에 계속 쌓이는 쪽이 이들이라, 관리자가 보려는 것이 바로 이것이다.
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
 * 고아 리소스 요약. 부모(pi)가 lookup 에 없는 행의 수를 상한 안에서 센다.
 *
 * 고아는 이 서버의 **정상 실패 모드**다. DELETE 는 루트 행만 지우고 200 을
 * 돌려준 뒤 자손을 배경에서 지우는데(delete_descendants_background), 그 도중
 * 프로세스가 죽거나 커넥션을 못 빌리거나 대형 서브트리가 타임아웃에 걸리면
 * 남은 자손이 통째로 고아가 된다. lite 는 이 정리의 자동 실행을 일부러 빼고
 * 관리자 판단으로 넘겼다 — 5,740만 행에서 한 패스가 배치 11,000회이고 그동안
 * 커넥션 하나를 계속 붙잡기 때문이다.
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
 * 고아 리소스 목록. ri 키셋 페이징.
 *
 * scanCapped 가 오면 "훑기 상한에 걸렸다" 는 뜻이다 — 고아가 드물면 한 쪽을
 * 채우려고 테이블 끝까지 갈 수 있어 상한을 둔다. 화면은 그 사실을 숨기지 않는다.
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

// ── ACP (권한) ────────────────────────────────────────────────────────────
//
// 배포 실측(2026-08-29)에서 ACP 리소스는 1개, acpi 가 채워진 리소스는 2개였고
// 그중 하나가 없는 ACP 를 가리켜 수퍼유저 말고는 아무도 못 쓰는 상태였다.
// 화면의 목적은 "권한을 예쁘게 보여 주는 것" 이 아니라 **잘못 걸린 것을
// 찾아내고, 걸기 전에 결과를 미리 보는 것** 이다.

/**
 * 커서로 이어보는 스캔을 **끝까지** 돌린다.
 *
 * 한 쪽만 보고 끝내지 않는 이유: 이 결과들은 "이 ACP 를 지워도 되는가" 의
 * 근거다. 잘린 목록을 그대로 보여 주면 참조가 있는데 없다고 말하는 셈이 된다.
 * 배포의 비-CIN 은 34,313행이라 기본 상한(20만)에서 한 번에 끝나지만, 끝나지
 * 않는 경우에도 화면이 "여기까지가 전부" 로 보이면 안 된다.
 *
 * 커서는 불투명한 문자열 하나다(result.next → opts.after). 예전에는 타입과 ri
 * 두 조각이었는데, 하나만 넘기면 첫 타입에서 맴돌며 **끝나지 않았다**(실측:
 * refs=0 에 201패스). 쪼갤 수 있는 커서는 언젠가 쪼개지므로 코어가 하나로
 * 묶었고, 옛 인자를 넘기면 BAD_CURSOR 로 거부한다.
 *
 * @param call   call(after, cb) — after 가 null 이면 처음부터
 * @param merge  merge(acc, page) — 페이지를 누적기에 합친다
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
                // 종료 조건은 !page.next 라 원래 닫힌다. 이 상한은 코어가 커서를
                // 전진시키지 못하는 상황에 대한 보험이고, 걸리면 숨기지 않는다.
                acc.capped = true;
                return callback(null, acc);
            }
            step(page.next);
        });
    }
    step(null);
}

/** 이 ACP 를 참조하는 리소스 전부. */
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

/** acpi 참조 검사 전부. 첫 화면이라 특히 "여기까지가 전부" 로 보이면 안 된다. */
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

/** ACP 목록. ty 등치라 idx_lookup_ty 를 탄다. */
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
 * ACP 하나의 전부: 본문 + 이것을 쓰는 리소스 + 그룹 macp 참조.
 *
 * scan_macp_refs 를 함께 부르는 이유가 있다. fanOutPoint 는 acpi 가 아니라
 * grp.macp 로 판정하므로, 삭제 영향 분석에서 이걸 빠뜨리면 그룹 팬아웃이
 * 조용히 잠긴다.
 */
app.get('/api/acp/detail', function (req, res) {
    var ri = req.query.ri;
    if (!ri) { return res.status(400).json({ error: 'ri 가 필요하다' }); }
    with_connection(res, function (conn, done) {
        db_sql.select_acp_detail(conn, ri, function (err, detail) {
            if (err) { done(); return res.status(500).json({ error: String((detail && detail.message) || err) }); }
            if (!detail) { done(); return res.status(404).json({ error: 'ACP 를 찾을 수 없다' }); }

            // 두 스캔은 각각 실패할 수 있다. 하나가 실패했다고 페이지 전체를
            // 500 으로 만들지 않되, **실패를 0건으로 보여 주지도 않는다.**
            // "그룹 참조 0건" 은 ACP 를 지워도 된다는 신호로 읽히므로, 확인하지
            // 못한 것을 확인해서 없는 것처럼 말하면 안 된다.
            // (SQLite 백엔드에는 grp 테이블 자체가 없어 실제로 자주 실패한다.)
            scan_refs_all(conn, ri, function (err2, refs) {
                var refsErr = err2 ? String((refs && refs.message) || err2) : null;
                db_sql.scan_macp_refs(conn, { acpRi: ri }, function (err3, macp) {
                    done();
                    var macpErr = err3 ? String((macp && macp.message) || err3) : null;
                    // 이 ACP 의 문제도 함께 준다. 상세를 보면서 "이건 왜
                    // 안 먹지" 를 다른 화면으로 옮겨 가서 찾게 하지 않는다.
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

/** ACP 본문 검사. 콘솔의 첫 화면이 이 목록이다. */
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
 * acpi 참조 검사 — 없는 ACP 를 가리키는 리소스(dangling)를 찾는다.
 *
 * 이어보기를 화면에 노출하지 않고 **서버가 끝까지 돌린다.** 이 목록은 콘솔의
 * 첫 화면이고 "무엇이 잘못 걸려 있나" 의 전부여야 한다 — 상한에 걸린 줄 모르고
 * "여기까지가 전부" 로 보이는 것이 가장 나쁘다.
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
 * 권한 시뮬레이터.
 *
 * **콘솔은 자기 자신을 검증받지 않는다.** adminOrigin 이 superUser 라
 * security.js 가 무조건 통과시키므로, HTTP 로 왕복해도 정책을 검증할 수 없다.
 * 시뮬레이터는 security.js 의 평가 함수를 그대로 쓴다.
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
        // 저장하지 않은 상태로 물어보기. 이것이 "잠그기 전에 미리 본다" 다.
        if (Array.isArray(b.acpiOverride)) { opts.acpiOverride = b.acpiOverride; }
        if (Array.isArray(b.acpRowsOverride)) { opts.acpRowsOverride = b.acpRowsOverride; }
        // source / acpi / inherited_from / resolved 는 **리소스의 성질이지 원본의
        // 성질이 아니다.** 코어가 acpi 를 실제로 푼 첫 결과에서만 읽으므로 원본
        // 순서와 무관하다. 전부 수퍼유저·생성자로 단축 판정되면 'none' 이 아니라
        // null 이 오고 source_unknown 경고가 붙는다 — 'none' 은 "ACP 가 없다" 로
        // 읽히고 그것이 거짓이기 때문이다.
        //
        // 한때 콘솔이 사전 원본으로 한 번 더 물어 이 값을 직접 구했다. 코어가
        // 같은 보장을 하게 되어 걷어냈다 — 같은 사실을 두 곳에서 계산하면
        // 언젠가 갈린다.
        acp_simulate.simulate_many(conn, opts, function (err, r) {
            done();
            if (err) {
                // 상한 초과는 사용자 입력 문제이지 서버 오류가 아니다. 조용히
                // 자르지 않고 거절한 것을 그대로 전한다.
                if (r && r.code === 'TOO_MANY') { return res.status(400).json(r); }
                return res.status(500).json({ error: String((r && r.message) || err) });
            }
            res.json(r);
        });
    });
});

/** 저장 전 검사. DB 를 보지 않는 동기 순수 함수라 커넥션이 필요 없다. */
app.post('/api/acp/validate', function (req, res) {
    var b = req.body || {};
    var field = (b.field === 'pvs') ? 'pvs' : 'pv';
    if (!b.value || typeof b.value !== 'object') {
        return res.status(400).json({ error: 'value 가 필요하다' });
    }
    // 서버도 같은 함수로 막지만, 응답의 msg 는 정적이라 어느 값이 문제인지
    // 담지 못한다. path 는 이 함수만 준다.
    res.json(acp_rules.validate_privileges(b.value, field));
});

/**
 * ACP 본문 저장. pv / pvs 중 보낸 것만 바꾼다.
 *
 * 서버(Mobius)도 같은 가드레일을 지나지만 여기서 먼저 검사한다 — 응답의 msg 는
 * 정적이라 **어느 값이 문제인지** 담지 못하고, path 는 validate_privileges 만
 * 준다. 두 번 검사하는 것이 아니라, 화면이 고칠 자리를 짚어 주기 위해서다.
 *
 * 쓰기는 oneM2M PUT 을 지난다. 그래야 워커 캐시가 무효화되고 acp_audit 에
 * 이력이 남는다.
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
        // 서버가 거절한 이유를 그대로 전한다. 콘솔이 통과시킨 값을 서버가 막았다면
        // 그 차이 자체가 알아야 할 정보다.
        res.status(r.status >= 400 && r.status < 500 ? 400 : 502).json({
            error: describe(r),
            status: r.status,
            rsc: r.rsc,
            body: r.body
        });
    });
});

/** 변경 이력. 최신순이라 커서는 "이 id 보다 작은 것" 이다. */
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
                // 007 마이그레이션 전이면 테이블이 없다. 500 으로 두면 화면이
                // "서버가 고장났다" 로 읽는다 — 무엇을 해야 하는지 알려 준다.
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

// ── 일괄 작업 ─────────────────────────────────────────────────────────────

/** 커넥션을 하나 빌려 fn 에 넘기고 반드시 반납한다. 작업 항목마다 짧게 빌린다. */
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

/** 대상 목록을 검증한다. 문제가 있으면 문자열을 돌려준다. */
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
 * 삭제 워커. 지우기 **전에** DB 에서 현재 상태를 다시 본다.
 *
 * 목록은 몇 분 전 것일 수 있다. 그 사이 누가 et 를 늘렸는데 낡은 목록을 믿고
 * 지우면 되돌릴 수 없다. 한 건당 조회 한 번이 늘지만, 삭제는 되돌릴 수 없으므로
 * 그 값을 치른다.
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

/** et 연장이 가능한 타입. CIN 은 oneM2M 상 수정 자체가 안 된다(app.js:1839 → 405-7). */
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

/**
 * 만료 리소스 삭제. 실행 직전 et 를 다시 확인해 아직 만료 상태일 때만 지운다.
 */
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
            // et 가 비었으면 만료 개념이 없는 리소스다. 만료 화면에서 왔더라도
            // 지금은 아니므로 건드리지 않는다.
            if (!row.et) { return next('et 가 없음'); }
            if (row.et >= asOf) { return next('만료가 해제됨 (et=' + row.et + ')'); }
            next(null);
        })
    });
});

/**
 * 고아 리소스 삭제. 실행 직전 부모가 정말 없는지 다시 확인한다.
 *
 * 부모가 다시 생겼다면 그 행은 더 이상 고아가 아니라 살아 있는 데이터다.
 * 낡은 목록으로 그걸 지우면 안 된다.
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

/**
 * et 연장. 절대 시각을 받는다 — "며칠 뒤" 를 서버에서 계산하면 화면이 보여 준
 * 값과 실제로 들어가는 값이 어긋날 수 있다.
 */
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
                        // 타입 이름의 받침에 따라 조사가 달라지므로 조사를 붙이지 않는다.
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

// ── 정적 파일 ─────────────────────────────────────────────────────────────
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

// ── 기동 ──────────────────────────────────────────────────────────────────
// acpi 접기가 성립하는지 기동 시 한 번 확인한다. 전역을 세우기는 했지만
// **틀리게** 세우면 조용히 어긋난다 — 절대 표기를 내부 ri 로 접지 못해 그
// 리소스를 "참조 없음" 으로 보고하고, 그러면 ACP 삭제 영향 분석이 빗나간다.
// 못 세운 것보다 잘못 세운 쪽이 나쁘므로 눈에 띄게 찍는다.
if (typeof db_sql.acp_ri_context === 'function') {
    var acp_ctx = db_sql.acp_ri_context();
    if (!acp_ctx.ok) {
        console.error('[admin] 경고: CSE 신원 전역이 비었다 (' + acp_ctx.missing.join(', ') + ').');
        console.error('[admin]   acpi 역참조가 어긋나 "참조 없음" 을 잘못 보고할 수 있다.');
    }
}

db.connect(global.usedbhost, 3306, 'root', global.usedbpass, function (rsc) {
    if (rsc !== '1') {
        console.error('[admin] DB 연결 실패 (' + rsc + ')');
        process.exit(1);
    }
    app.listen(PORT, HOST, function () {
        console.log('[admin] 관리 콘솔 ' + HOST + ':' + PORT +
                    ' (backend=' + (global.usesqlite === 'true' ? 'sqlite' : 'mysql') + ')');
        if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
            console.warn('[admin] 경고: 루프백이 아닌 주소에 바인드했다 — 접근 통제를 확인할 것.');
        }
    });
});
