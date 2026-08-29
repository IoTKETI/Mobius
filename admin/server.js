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

var db = require(path.join(ROOT, 'mobius', 'db'));
var db_sql = require(path.join(ROOT, 'mobius', 'sql_action'));
var responder = require(path.join(ROOT, 'mobius', 'responder'));

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
var SUPER_USER = (typeof conf.superUser === 'string' && conf.superUser !== '')
    ? conf.superUser : 'Sponde';
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
