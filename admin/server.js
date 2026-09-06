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
var express = require('express');

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
//
// **global.usesqlite 를 쓰고 있었다. 그 전역은 이제 없다.**
// 백엔드는 이름으로 고른다 — mobius/conf_load.js 의 select_backend 와 같은 규칙이다.
// 'sqlite' / 'mysql' 이 아닌 이름을 줘도 파사드가 기본값으로 떨어뜨린다.
global.usedb = process.argv[2] || conf.db || 'mysql';

// global.usedbhost / global.usedbpass 가 여기 있었다. **둘 다 지웠다.**
//
// 연결 좌표(호스트·포트·계정·비밀번호)는 이제 어댑터가 갖는다. 코어가
// connect 에 넘기던 네 인자가 사라졌고, 그 값들은 어댑터가 자기 상수와
// applyConf 로 받은 conf 에서 읽는다.
//
// **그래서 applyConf 가 connect 보다 먼저 와야 한다.** 아래 db.connect
// 직전에 그 줄이 있다.

// CSE 신원. Mobius 본체는 mobius/conf_load.js 가 세운다.
//
// 콘솔은 app.js 를 읽지 않으므로 직접 세워야 한다. 안 세우면 sql_action 의
// fold_acpi_entry 가 **선언되지 않은 전역을 읽어 ReferenceError 로 죽는다** —
// acpi 역참조 스캔(scan_acpi_refs)이 통째로 못 돈다. 값이 있어도 틀리면
// '//spid/cseid/Mobius/ae' 같은 절대 표기를 내부 ri 로 접지 못해, 그 리소스를
// 참조가 없는 것으로 잘못 보고한다 — ACP 삭제 영향 분석이 조용히 빗나간다.
var SUPER_USER = (typeof conf.superUser === 'string' && conf.superUser !== '')
    ? conf.superUser : 'Sponde';

// CSE 신원은 conf 에서 읽고, 없으면 **표의 기본값**을 쓴다 — 코어(conf_load)의
// 기본값을 여기 베끼면 코어가 바뀔 때 조용히 어긋난다. 2026-09-05 까지는 세 값이
// 여기 박혀 있었다.
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

// ── 앱 ────────────────────────────────────────────────────────────────────
var app = express();

// 라우트는 admin/api.js 에 있다. 여기서는 그것이 필요로 하는 것을 모아 넘긴다 —
// 시험이 같은 install 을 임시 포트·어댑터 대역·가짜 CSE 로 부른다.
var expiry_policy = require(path.join(ROOT, 'mobius', 'expiry_policy'));
var DATA_DIR = path.join(__dirname, 'data');
require('./api').install(app, {
    conf: conf,
    password: PASSWORD,
    db: db, db_sql: db_sql, responder: responder,
    acp_simulate: acp_simulate, acp_lint: acp_lint, acp_rules: acp_rules,
    expiry_policy: expiry_policy,
    jobs: jobs,
    cse: cse,
    cseHost: CSE_HOST, csePort: CSE_PORT, cseOrigin: CSE_ORIGIN, superUser: SUPER_USER,
    dataDir: DATA_DIR
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

// **applyConf 가 connect 보다 먼저다.** 어댑터가 conf 에서 자기 것(비밀번호
// 등)을 직접 읽으므로, 이 줄이 없으면 어댑터의 conf 가 {} 로 남아 빈
// 비밀번호로 붙는다. test/db-connect-wiring.test.js 가 이 순서를 지킨다.
db.applyConf(conf);

db.connect(function (rsc) {
    if (rsc !== '1') {
        console.error('[admin] DB 연결 실패 (' + rsc + ')');
        process.exit(1);
    }
    app.listen(PORT, HOST, function () {
        // 백엔드 이름은 파사드에게 묻는다. 예전에는 usesqlite 전역을
        // 삼항으로 풀어 여기서 이름을 만들었다 — 백엔드가 하나 늘면
        // 그 삼항이 조용히 틀린 이름을 찍는다.
        console.log('[admin] 관리 콘솔 ' + HOST + ':' + PORT +
                    ' (backend=' + db.backendName() + ')');
        if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
            console.warn('[admin] 경고: 루프백이 아닌 주소에 바인드했다 — 접근 통제를 확인할 것.');
        }
    });
});
