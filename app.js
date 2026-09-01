/**
 * Copyright (c) 2018, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file Main code of Mobius. Role of flow router
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

process.env.NODE_ENV = 'production';
//process.env.NODE_ENV = 'development';

var fs = require('fs');
var http = require('http');
var express = require('express');
var morgan = require('morgan');
var util = require('util');
var url = require('url');
var ip = require('ip');
var crypto = require('crypto');
var fileStreamRotator = require('file-stream-rotator');
var https = require('https');
var moment = require('moment');

const cors = require('cors');

global.NOPRINT = 'true';
global.ONCE = 'true';

var cb = require('./mobius/cb');
var responder = require('./mobius/responder');
var resource = require('./mobius/resource');
var security = require('./mobius/security');
var fopt = require('./mobius/fopt');
var sgn = require('./mobius/sgn');

// 결과 코드와 사유는 카탈로그가 들고 있다.
//   mobius/rsc.js     결과 코드 + 바인딩 매핑(http/coap)
//   mobius/reason.js  사유별 문구
// 에러 응답은 전부 response_error_result(request, response, code, cb) 를 거친다.
// 예전의 { key: [status, rsc, msg] } 표는 읽는 곳이 없어져 걷어냈다.
//
// cluster 마스터의 자체 점검이 이 둘을 쓰므로 위쪽에서 미리 읽어 둔다.
var reason = require('./mobius/reason');
var RSC = require('./mobius/rsc').RSC;

// ty 결정의 단일 진실원 (§9.1)
var type_resolver = require('./mobius/type_resolver');

// 잡히지 않은 예외의 마지막 방어선. 마스터는 살리고 워커는 종료한다.
var backstop = require('./mobius/backstop');

// 아웃바운드 요청 타임아웃 (D16)
var outbound = require('./mobius/outbound');

// 응답·커넥션 반납을 하는 콜백을 한 번만 통과시킨다
var once = require('./mobius/once');

// 응답 전송과 커넥션 반납을 한 번만 하도록 모은다
var settle_mod = require('./mobius/settle');

// DB 의 poa 컬럼을 안전하게 배열로 읽는다
var poa_util = require('./mobius/poa');

// DB 파사드. 예전에는 db_action.js 라는 껍데기를 한 겹 거쳤는데, 그것이
// 파사드 위에 아무것도 더하지 않게 되어 지웠다(임대 장부는 파사드로 옮겼다).
var db = require('./mobius/db');
var db_sql = require('./mobius/sql_action');

// 기동 시 즉시 끝나는 마이그레이션만 적용한다 (마스터에서만).
// 새로 설치한 DB 가 지금 배포와 같은 상태로 뜨게 하는 것이 목적이다.
var db_bootstrap = require('./mobius/db_bootstrap');

// db_facade 라는 두 번째 이름이 있었다. 전환 중에는 "구 경로(db)" 와
// "새 파사드(db_facade)" 를 구분할 필요가 있었지만 이제 같은 것이라 합쳤다.
var db_facade = db;

// ������ �����մϴ�.
var app = express();

// cache_resource_url 은 걷어냈다. 다시 넣지 말 것 — 아래를 먼저 읽을 것.
//
// URL 로 찾은 리소스를 워커별 객체에 무한히 쌓아 두던 캐시다. TTL 도 크기
// 제한도 없었고, 무효화는 자기 워커 것만 지웠다(워커 16개, 전파 없음).
//
// ── 왜 없앴나 (1) 낡은 읽기가 구독을 지웠다 ──────────────────────────
// 캐시가 낡은 부모 행을 주면 그 사본의 subl 도 낡는다. 거기에 새 구독을
// 얹어 절대값으로 되쓰면 그 사이 남이 만든 구독이 통째로 사라진다.
// 배포 실측: 유령 9,475건, 중복 1,481묶음, 낡은 nu 194건, 침묵 21건.
//
// (예전 주석은 이것을 "캐시된 객체를 참조로 돌려줘서 request.targetObject 가
//  공유된다" 고 적었는데 틀렸다. get_target_url 이 JSON.parse(JSON.stringify())
//  로 깊은 복사를 한다 — 2.4.30 부터 그렇다. 기구는 별칭이 아니라 낡은
//  읽기였다. 인과는 같지만 근거를 틀리게 적으면 다음 사람이 헛다리를 짚는다.)
//
// ── 왜 없앴나 (2) 캐시 키와 무효화 키가 다르다 ───────────────────────
// 이쪽이 더 무겁다. **지워진 리소스가 200 으로 계속 나간다.**
//
//     캐시 키    request.ri     클라이언트가 보낸 URL 그대로
//     무효화 키  request.url    DB 행의 정규 ri (targetObject[rootnm].ri)
//
// 그리고 responder 의 typeCheckAction 은 모든 응답의 ri 자리에 sri(비구조
// ID)를 넣는다. 즉 **서버가 알려준 주소**로 다시 조회하면 캐시 키가 별칭이
// 되고, 그 별칭은 어떤 무효화로도 지워지지 않는다. TTL 도 없고 상한(5만)이
// 비-CIN 리소스 수(배포 34,243)보다 커서 축출도 안 온다.
//
// origin/lite 를 그대로 띄워 재현했다. 컨테이너를 만들고, 응답이 알려준 ri
// 로 40번 GET 한 뒤, 구조화 경로로 DELETE 하고, 다시 그 주소로 40번:
//
//     캐시 있음   삭제 후 200 이 40/40
//     캐시 없음   삭제 후 404 가 40/40
//
// 같은 논리로 acpi 를 회수해도 낡은 값으로 인가를 판정한다. 성능
// 최적화가 접근 제어의 입력을 낡게 만드는 형태다.
//
// ── 없애는 값 ───────────────────────────────────────────────────────
// 배포 실측: 요청 최대 25.9/초, 캐시 미스 1.5/초. 전부 DB 로 보내면 질의가
// 253.8 -> 302.8/초(+19%), 요청당 0.6~1.2ms. 실행계획은 index_merge 로
// rows=2, 버퍼풀 적중률 99.969% — 포화와 거리가 먼 자원이다.
//
// 그 적중률 94% 도 액면대로 볼 것이 아니다. 미스율 1.5/25.9 = 5.79% 가
// 워커 16개에서 무효화가 자기 것만 지울 때의 기대값 1/16 = 6.25% 와 거의
// 같다. 적중이 높은 이유가 무효화가 고장나 있어서다. 제대로 고치면 그
// 적중은 대부분 사라진다.
//
// ── 다시 넣으려면 ───────────────────────────────────────────────────
// 최소한 이 셋을 먼저 풀 것. 셋 다 안 풀면 위 재현이 그대로 돌아온다.
//   1) 캐시 키와 무효화 키를 같은 것으로 맞출 것 (별칭 포함)
//   2) 워커 간 무효화 전파
//   3) 적중률을 무효화가 고쳐진 상태에서 다시 잴 것
// test/no-resource-cache.test.js 가 이 자리를 지킨다.
//
// cache_security_check 도 같은 이유로 걷어냈다 — 쓰기만 하고 읽는 곳이 없어
// origin·ri 로 키가 무한히 쌓이는 메모리 누수였다.

app.use(cors());

global.usespid = '//keti.re.kr';
// usesuperuser 는 mobius.js 가 conf.json 에서 읽어 설정한다.
// 이 값을 X-M2M-Origin 에 넣으면 모든 ACP 검사를 건너뛰므로 코드에 두면 안 된다.
global.useobserver = 'Sandwich';

var logDirectory = __dirname + '/log';

// ensure log directory exists
fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory);

// create a rotating write stream
var accessLogStream = fileStreamRotator.getStream({
    date_format: 'YYYYMMDD',
    filename: logDirectory + '/access-%DATE%.log',
    frequency: 'daily',
    verbose: false
});

// setup the logger
app.use(morgan('combined', {stream: accessLogStream}));

//ts_app.use(morgan('short', {stream: accessLogStream}));

// del_req_resource 는 걷어냈다.
//
// req(ty=17) 행을 24시간마다 지우던 주기 작업인데, 논블로킹을 지원하지 않게
// 되면서 새 행이 생기지 않는다. 기존 배포에 남은 행과 테이블은
// migrations/003-drop-req-table.js 가 한 번에 정리한다 — 영구 주기 작업으로
// 둘 일이 아니다.

// 만료 리소스는 **자동으로 지우지 않는다.**
//
// 예전에는 del_expired_resource 를 24시간마다 돌렸는데, 그 구현이 만료된 ri 를
// pi 자리에 넣어 "만료 리소스의 자식"을 지우고 정작 대상은 남기는 no-op 이었다.
// 고쳐서 제대로 지우게 만드는 순간, 지금까지 한 번도 안 지워진 만료 리소스가
// 한꺼번에 사라진다. 그건 관리자가 확인하고 결정할 일이다.
//
// 그래서 기능만 남기고 주기 실행은 걸지 않는다. 관리자 UI 가 쓸 함수:
//   db_sql.select_expired_resources(conn, et, limit, cb)  목록 조회 (읽기 전용)
//   db_sql.delete_lookup_et(conn, et, limit, cb)          선택 후 삭제
// et 를 늘리는 것은 일반 oneM2M UPDATE 로 하면 된다.

// 저장된 cnt.cni/cbs 를 실제 cin 집계와 맞춘다 (기동 시 + 일 1회).
//
// get_cni_count 가 매번 재집계하던 것을 저장값 읽기로 바꾸면서(O(n) -> O(1))
// 그 안전망이 사라졌다. 아직 감산하지 않는 경로(subtree 배경 삭제, 만료 스윕)가
// 남아 있으므로 주기적으로 맞춰 준다.
//
// 커서를 프로세스 안에 들고 이어서 돈다. 컨테이너가 3만 개대이고 그중 몇 개는
// CIN 이 수백만 건이라 한 번에 다 돌 수 없다 — 시간 예산만큼만 일하고
// 다음 호출이 멈춘 자리에서 계속한다. 한 바퀴를 다 돌면 처음으로 되감는다.
var reconcile_cursor = '';
var reconcile_running = false;
// 한 바퀴 동안 집계를 못 한 컨테이너를 모았다가 바퀴 끝에 한 번만 보고한다.
// 매 조각마다 찍으면 같은 대형 컨테이너가 계속 로그를 채운다.
var reconcile_deferred = [];
var reconcile_failed = [];

// 한 바퀴가 끝나기 전까지는 24시간을 기다리지 않고 곧바로 이어서 돈다.
//
// 커서는 "다음 호출이 멈춘 자리에서 계속한다" 를 전제로 만들었는데, 그
// 다음 호출이 24시간 뒤였다. 배포 환경 기준 컨테이너 30,220개를 조각당
// 2000개씩 나누면 한 바퀴에 16일이 걸린다 — 드리프트 교정이 사실상
// 동작하지 않았다. 조각 사이를 1분으로 두면 한 바퀴가 20분 안에 끝난다.
var RECONCILE_GAP_MS = 60 * 1000;

// 보존 정책 스윕. mni/mbs 를 넘긴 컨테이너에서 오래된 자식을 지운다.
//
// **마스터에서만 돈다.** 그것이 이 설계의 전부다.
//
// 예전에는 CIN 이 들어올 때마다 그 요청을 처리하던 워커가 한도를 판정하고
// 삭제까지 했다. 워커가 25개라 같은 컨테이너를 여러 워커가 동시에 정리했고,
// 그래서 delete_oldest 는 트랜잭션 + SELECT ... FOR UPDATE NOWAIT 로 서로를
// 막아야 했다. 그 잠금이 다시 락 컨보이를 만들었고(ER_LOCK_WAIT_TIMEOUT
// 390건, 2026-08-25 실측), **잠금이 없는 백엔드는 그 알고리즘을 쓸 수 없어
// SQLite 는 아예 다른 갈래를 갖고 있었다.**
//
// 정리 주체를 하나로 만들자 그 사슬이 뿌리에서 끊겼다 — 경쟁이 없으니 잠금이
// 필요 없고, 잠금이 없으니 백엔드를 가를 이유가 없다.
//
// 비용은 실측했다: 찾는 질의가 배포 서버에서 13ms(cnt 30,284행 전수), 한 번에
// 걸리는 컨테이너가 14개였다.
var purge_running = false;

function purge_sweep_tick() {
    if (purge_running) { return; }   // 한 바퀴가 도는 중이면 넘어간다
    purge_running = true;

    db.getConnection((code, connection) => {
        if (code !== '200') {
            purge_running = false;
            console.error('[purge_sweep] 커넥션을 못 빌렸다 — 다음 주기에 다시 한다');
            return;
        }
        db_sql.purge_sweep(connection, { limit: 100 }, (err, report) => {
            db.release(connection);
            purge_running = false;
            if (err) {
                console.error('[purge_sweep] 실패: ' + ((report && report.message) || report));
                return;
            }
            // 할 일이 없으면 조용하다. 10초마다 한 줄씩 찍으면 로그가 밀린다.
            if (report.scanned > 0) {
                console.log('[purge_sweep] 초과 ' + report.scanned + '개 중 ' +
                            report.purged + '개 정리, ' + report.deleted + '건 삭제' +
                            (report.failed ? ', 실패 ' + report.failed : ''));
            }
        });
    });
}

// is_continuation 은 이어 돌기가 스스로 부를 때만 true 다.
// 24시간 타이머는 한 바퀴가 도는 중이면 그냥 넘어간다 — 안 그러면 두 흐름이
// 같은 reconcile_cursor 를 각자 전진시켜 컨테이너를 건너뛴다.
function reconcile_counters(is_continuation) {
    if (reconcile_running && !is_continuation) { return; }
    reconcile_running = true;

    db.getConnection((code, connection) => {
        if (code !== '200') {
            console.log('[reconcile_counters] No Connection');
            reconcile_running = false;
            return;
        }

        db_sql.reconcile_cnt_counters(connection,
            // limit 은 한 번에 읽어 둘 컨테이너 수이고, 실질 상한은 budgetMs 다.
            // cnt 는 3만 행대라 2000행을 읽는 것 자체는 싸다.
            { limit: 2000, cursor: reconcile_cursor, budgetMs: 30000 },
            (err, report) => {
                db.release(connection);

                if (err) {
                    console.log('[reconcile_counters] error', report);
                    reconcile_running = false;
                    return;
                }

                if (report.fixed > 0) {
                    console.log('[reconcile_counters] ' + report.checked + '건 확인, ' +
                                report.fixed + '건 교정');
                }
                reconcile_deferred = reconcile_deferred.concat(report.deferredRis || []);
                reconcile_failed = reconcile_failed.concat(report.failedRis || []);

                if (report.done) {
                    // 한 바퀴 완료. 손대지 못한 것들을 한 번만 알리고 되감는다.
                    var stuck = reconcile_deferred.concat(reconcile_failed);
                    if (stuck.length > 0) {
                        console.log('[reconcile_counters] 한 바퀴 완료 — 유예(대형) ' +
                                    reconcile_deferred.length + '건, 실패 ' +
                                    reconcile_failed.length + '건. 관리자 UI 에서 개별 처리 필요: ' +
                                    stuck.slice(0, 10).join(', ') +
                                    (stuck.length > 10 ? ' 외 ' + (stuck.length - 10) + '건' : ''));
                    }
                    reconcile_cursor = '';
                    reconcile_deferred = [];
                    reconcile_failed = [];
                    reconcile_running = false;   // 한 바퀴 끝. 다음 24시간 틱을 받는다.
                }
                else {
                    // 아직 도는 중이다. reconcile_running 을 켠 채로 두어
                    // 24시간 틱이 끼어들지 못하게 한다.
                    reconcile_cursor = report.nextCursor;
                    setTimeout(function () { reconcile_counters(true); }, RECONCILE_GAP_MS);
                }
            });
    });
}

// 고아 행 정리는 **자동으로 돌리지 않는다.**
//
// 비동기 subtree 삭제(delete_descendants_background)가 도중에 끊기면 부모를
// 잃은 lookup 행이 남는다. 그걸 치우는 기능은 필요하지만, 주기 실행으로 둘
// 일은 아니다.
//
// 이유는 비용이다. delete_orphan_lookup 은 lookup 전체를 5,000행 배치로 훑고,
// 배치마다 질의가 두 번(스캔 + 부모 존재 확인) 나간다. 게다가 아무것도 안
// 지울 때까지 여러 패스를 돈다. 배포의 lookup 은 5,740만 행이라 한 패스에만
// 배치가 11,000회를 넘는다. 그동안 풀 커넥션 하나를 계속 붙잡는다.
//
// 고아가 얼마나 쌓이는지는 배포마다 다르다 — 비동기 삭제가 끊긴 횟수에
// 달렸으므로, 매일 전수를 훑는 것이 맞는지는 실제 수를 보고 정할 일이다.
// 그래서 기동 시 실행과 24시간 주기를 모두 뺐다. 만료 스윕과 같은 방침이다.
//
// 관리자 UI 가 쓸 함수:
//   db_sql.count_orphan_lookup(conn, cb)          몇 개인지 센다 (읽기 전용)
//   db_sql.delete_orphan_lookup(conn, cb)         확인 후 삭제
//
// 자세한 배경은 docs/superpowers/specs/2026-08-29-admin-ui-handoff.md 참고.

var cluster = require('cluster');
var os = require('os');
//var cpuCount = (os.cpus().length / 2);
var cpuCount = os.cpus().length;

var worker = [];
var use_clustering = 1;
var worker_init_count = 0;
if (use_clustering) {
    if (cluster.isMaster) {
        // 마지막 방어선. 프록시 3종이 이 블록에서 require 되므로, 그 메시지
        // 핸들러가 던지면 마스터가 죽고 아래 워커 재기동 로직까지 함께
        // 사라진다 — 리스닝 포트가 전부 없어진다. 마스터는 요청 상태를
        // 들고 있지 않으므로 살아남는 쪽이 낫다. 자세한 근거는 backstop.js.
        backstop.install('master');

        // 결과 코드·사유 카탈로그 자체 점검. 마스터에서 한 번만 돈다.
        // 문제가 있어도 기동을 막지 않는다 — 운영 배포에서 서버가 안 뜨는 쪽이
        // 카탈로그 흠결보다 위험하다. 배포 시점 로그에서 눈에 띄게 하는 것이 목적이다.
        reason.reportSelfCheck();

        // 워커가 죽으면 다시 띄운다.
        //
        // 예전에는 'death' 를 듣고 있었다. Node 0.x 시절 이름이라 지금은
        // 아무 때도 발화하지 않는다 (cluster 가 내는 것은 fork / online /
        // listening / disconnect / exit / setup 뿐이다). 그래서 워커가 죽으면
        // 그대로 사라졌고, 용량이 재시작 전까지 영구히 줄었다.
        //
        // 실측 (2026-08-28, 로컬): D22 이전 코드에 GET /Mobius/fopt 를 3번
        // 보내니 워커가 17 -> 14 로 줄고 10초가 지나도 돌아오지 않았다.
        // 요청 25번이면 배포 서버의 워커 25개가 전부 죽는 셈이었다.
        //
        // 죽는 원인 자체는 그때그때 고쳐야 하지만, 여기서 다시 띄우는 것은
        // 원인과 무관하게 용량을 지키는 마지막 방어선이다.
        var RESPAWN_DELAY_MS = 1000;
        cluster.on('exit', (dead, code, signal) => {
            // 종료를 의도한 경우(부모가 kill/disconnect)는 다시 띄우지 않는다.
            if (dead.exitedAfterDisconnect) {
                console.log('worker ' + dead.process.pid + ' 정상 종료');
                return;
            }
            console.error('worker ' + dead.process.pid + ' 죽음 (code=' + code +
                          ', signal=' + signal + ') --> 다시 띄운다');
            // 기동 직후 연속으로 죽는 상황에서 포크 폭주를 막으려고 조금 쉰다.
            setTimeout(() => { cluster.fork(); }, RESPAWN_DELAY_MS);
        });

        db.connect(usedbhost, 3306, 'root', usedbpass, (rsc) => {
            if (rsc == '1') {
                // 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
                // 전환 안 된 함수들은 구 경로로 계속 동작하고, 전환된 함수는
                // db.run() 이 콜백으로 에러를 돌려준다(워커는 죽지 않는다).
                try {
                    db_facade.connect(usedbhost, 3306, 'root', usedbpass, (rsc2) => {
                        if (rsc2 !== '1') {
                            console.error('[db_facade] connect failed (' + rsc2 +
                                ') — 전환된 DB 함수는 전부 실패한다');
                        }
                    });
                } catch (e) {
                    console.error('[db_facade] connect threw (' + (e.message || e) +
                        ') — 전환된 DB 함수는 전부 실패한다');
                }
                db.getConnection((code, connection) => {
                    if (code === '200') {
                        // set_tuning 이 여기 있었다. 기동할 때마다 MySQL 인스턴스의
                        // **전역** 설정 네 개를 바꿨다:
                        //
                        //   max_connections = 2000
                        //   innodb_flush_log_at_trx_commit = 0   커밋 유실 1초 허용
                        //   sync_binlog = 0                      binlog fsync 안 함
                        //   transaction_isolation = READ-UNCOMMITTED
                        //
                        // 애플리케이션이 할 일이 아니다. 배포 서버의 my.cnf 는
                        // innodb_flush_log_at_trx_commit = 1 / max_connections = 300
                        // 이라고 적어 두었는데 이 코드가 부팅마다 뒤집고 있었다 —
                        // DBA 가 보는 설정과 도는 설정이 달랐다.
                        //
                        // 값은 그대로 두고 자리만 옮겼다. 2026-09-01 배포 서버에서
                        // SET PERSIST 로 MySQL 자신의 설정에 기록했다
                        // (/var/lib/mysql/mysqld-auto.cnf, 재시작 후에도 유지).
                        // 확인: select * from performance_schema.persisted_variables
                        //
                        // **새 서버는 이제 알아서 같은 값이 된다.**
                        // 값마다 주인이 다르다:
                        //
                        //   flush_log / transaction_isolation
                        //       migrations/010 이 SET PERSIST 로 **한 번** 넣는다.
                        //       set_tuning 과 갈리는 지점이 "한 번" 이다 —
                        //       schema_migrations 에 기록돼 다시 돌지 않으므로,
                        //       그 뒤 운영자가 값을 바꾸면 덮어쓰지 않는다.
                        //       유실돼도 MySQL 기본값이 곧 원하는 값이라 안전하다.
                        //
                        //   max_connections
                        //       db_bootstrap 이 **기동마다** 바닥을 확인해
                        //       모자랄 때만 올린다. 이것만 기본값(151)이 위험해서
                        //       유실되면 앱이 즉시 고갈되는데, 마이그레이션은
                        //       한 번 돌고 기록돼 그 유실을 못 고친다.
                        //       바닥은 dbConnectionLimit x 프로세스 수에서
                        //       계산한다(mobius/pool_sizing.js). 올리기만 한다.
                        //
                        // 즉시 끝나는 것만 자동으로 돈다(autoApply). 001 은 배포에서
                        // 20.6분 걸렸다 — 그런 것이 기동 경로에 있으면 안 된다.
                        db_bootstrap.run(() => {
                            console.log('CPU Count:', cpuCount);
                            for (var i = 0; i < cpuCount; i++) {
                                worker[i] = cluster.fork();
                            }

                            cb.create(connection, (rsp) => {
                                console.log(JSON.stringify(rsp));

                                // 만료 스윕(del_expired_resource)과 고아 정리
                                // (delete_orphan_lookup)의 주기 실행은 뺐다.
                                // 이유는 위 주석 참고 — 관리자 UI 가 확인 후 호출한다.

                                reconcile_counters();
                                setInterval(reconcile_counters, (24) * (60) * (60) * (1000));

                                // 보존 정책 스윕. 주기가 곧 "한도를 얼마나 넘겨도
                                // 되는가" 의 손잡이다. 예전 debounce 도 최대 10초를
                                // 허용했으므로 같은 수준에서 시작한다.
                                setInterval(purge_sweep_tick, global.purge_sweep_ms);

                                require('./pxy_mqtt');
                                require('./pxy_coap');
                                require('./pxy_ws');

                                db.release(connection);
                            });
                        });
                    }
                    else {
                        console.log('[db.connect] No Connection');
                    }
                });
            }
        });
    }
    else {
        // 워커는 마스터와 반대로 종료를 택한다. 살려 두면 던진 요청이 응답
        // 없이 매달리고 그 요청이 빌린 커넥션이 풀(워커당 100)에서 영구히
        // 빠진다. 죽으면 소켓이 닫혀 커넥션이 회수되고 위의 cluster.on('exit')
        // 가 다시 띄운다 — 오늘과 같은 회복에 진단만 더한다.
        backstop.install('worker');

        db.connect(usedbhost, 3306, 'root', usedbpass, (rsc) => {
            if (rsc === '1') {
                // 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
                // 전환 안 된 함수들은 구 경로로 계속 동작하고, 전환된 함수는
                // db.run() 이 콜백으로 에러를 돌려준다(워커는 죽지 않는다).
                try {
                    db_facade.connect(usedbhost, 3306, 'root', usedbpass, (rsc2) => {
                        if (rsc2 !== '1') {
                            console.error('[db_facade] connect failed (' + rsc2 +
                                ') — 전환된 DB 함수는 전부 실패한다');
                        }
                    });
                } catch (e) {
                    console.error('[db_facade] connect threw (' + (e.message || e) +
                        ') — 전환된 DB 함수는 전부 실패한다');
                }
                db.getConnection((code, connection) => {
                    if (code === '200') {
                        if (use_secure === 'disable') {
                            http.globalAgent.maxSockets = 1000000;
                            http.createServer(app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                cb.create(connection, (rsp) => {
                                    console.log(JSON.stringify(rsp));
                                    //noti_mqtt_begin();

                                    db.release(connection);
                                });
                            });
                        }
                        else {
                            var options = {
                                key: fs.readFileSync('server-key.pem'),
                                cert: fs.readFileSync('server-crt.pem'),
                                ca: fs.readFileSync('ca-crt.pem')
                            };
                            https.globalAgent.maxSockets = 1000000;
                            https.createServer(options, app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                cb.create(connection, (rsp) => {
                                    console.log(JSON.stringify(rsp));
                                    //noti_mqtt_begin();

                                    db.release(connection);
                                });
                            });
                        }
                    }
                    else {
                        console.log('[db.connect] No Connection');
                    }
                });
            }
        });
    }
}
else {
    db.connect(usedbhost, 3306, 'root', usedbpass, (rsc) => {
        if (rsc == '1') {
            // 파사드 연결 실패가 서버 기동 자체를 막으면 안 된다.
            // 전환 안 된 함수들은 구 경로로 계속 동작하고, 전환된 함수는
            // db.run() 이 콜백으로 에러를 돌려준다(워커는 죽지 않는다).
            try {
                db_facade.connect(usedbhost, 3306, 'root', usedbpass, (rsc2) => {
                    if (rsc2 !== '1') {
                        console.error('[db_facade] connect failed (' + rsc2 +
                            ') — 전환된 DB 함수는 전부 실패한다');
                    }
                });
            } catch (e) {
                console.error('[db_facade] connect threw (' + (e.message || e) +
                    ') — 전환된 DB 함수는 전부 실패한다');
            }
            db.getConnection((code, connection) => {
                if (code === '200') {
                    cb.create(connection, (rsp) => {
                        console.log(JSON.stringify(rsp));

                        if (use_secure === 'disable') {
                            http.globalAgent.maxSockets = 1000000;
                            http.createServer(app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                require('./pxy_mqtt');
                                //noti_mqtt_begin();
                            });
                        }
                        else {
                            var options = {
                                key: fs.readFileSync('server-key.pem'),
                                cert: fs.readFileSync('server-crt.pem'),
                                ca: fs.readFileSync('ca-crt.pem')
                            };
                            https.globalAgent.maxSockets = 1000000;
                            https.createServer(options, app).listen({port: usecsebaseport, agent: false}, () => {
                                console.log('mobius server (' + ip.address() + ') running at ' + usecsebaseport + ' port');
                                require('./pxy_mqtt');
                                //noti_mqtt_begin();
                            });
                        }

                        db.release(connection);
                    });
                }
                else {
                    console.log('[db.connect] No Connection');
                }
            });
        }
    });
}

global.get_ri_list_sri = function (request, response, sri_list, ri_list, count, callback) {
    if (sri_list.length <= count) {
        callback('200');
    }
    else {
        db_sql.get_ri_sri(request.db_connection, sri_list[count], (err, results) => {
            if (!err) {
                ri_list[count] = ((results.length == 0) ? sri_list[count] : results[0].ri);
                results = null;

                get_ri_list_sri(request, response, sri_list, ri_list, ++count, (code) => {
                    callback(code);
                });
            }
            else {
                callback('500-1');
            }
        });
    }
};

global.update_route = function (connection, cse_poa, callback) {
    db_sql.select_csr_like(connection, usecsebase, (err, results_csr) => {
        if (!err) {
            for (var i = 0; i < results_csr.length; i++) {
                // csr.poa 는 varchar(200) 이다. 긴 poa 배열이 비-strict sql_mode 에서
                // 잘려 저장되면 깨진 JSON 이 된다. 여기는 DB 콜백 안이라 던지면
                // 잡을 곳이 없어 워커가 죽는다 — 그리고 이 함수는 fanOutPoint 와
                // group 생성이 매번 부르는 경로다.
                //
                // 깨진 행 하나 때문에 나머지 CSE 의 경로까지 잃을 이유는 없다. 건너뛴다.
                var poa_arr = poa_util.parse(results_csr[i].poa, '[update_route] ' + results_csr[i].ri);
                if (poa_arr === null) {
                    continue;
                }
                for (var j = 0; j < poa_arr.length; j++) {
                    if (url.parse(poa_arr[j]).protocol == 'http:' || url.parse(poa_arr[j]).protocol == 'https:') {
                        cse_poa[results_csr[i].ri.split('/')[2]] = poa_arr[j];
                    }
                }
            }
            results_csr = null;
            callback('200');
        }
        else {
            callback('500-1');
        }
    });
};

function make_short_nametype(body_Obj) {
    if (body_Obj[Object.keys(body_Obj)[0]]['$'] != null) {
        if (body_Obj[Object.keys(body_Obj)[0]]['$'].rn != null) {
            body_Obj[Object.keys(body_Obj)[0]].rn = body_Obj[Object.keys(body_Obj)[0]]['$'].rn;
        }
        delete body_Obj[Object.keys(body_Obj)[0]]['$'];
    }

    var arr_rootnm = Object.keys(body_Obj)[0].split(':');

    if(arr_rootnm[0] === 'hd') {
        var rootnm = Object.keys(body_Obj)[0].replace('hd:', 'hd_');
    }
    else {
        rootnm = Object.keys(body_Obj)[0].replace('m2m:', '');
    }

    body_Obj[rootnm] = body_Obj[Object.keys(body_Obj)[0]];
    delete body_Obj[Object.keys(body_Obj)[0]];

    for (var attr in body_Obj[rootnm]) {
        if (body_Obj[rootnm].hasOwnProperty(attr)) {
            if (typeof body_Obj[rootnm][attr] === 'boolean') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else if (typeof body_Obj[rootnm][attr] === 'string') {
            }
            else if (typeof body_Obj[rootnm][attr] === 'number') {
                body_Obj[rootnm][attr] = body_Obj[rootnm][attr].toString();
            }
            else {
            }
        }
    }
}

// 프로토콜 프록시(mqtt/ws/coap)가 받은 메시지를 객체로 바꾼다.
//
// 호출부는 rsc 가 '1' 이면 result 를 곧바로 역참조한다. 그래서 '1' 은
// "파싱이 성공했다" 가 아니라 "역참조해도 되는 객체를 준다" 는 뜻이어야 한다.
//
// 그 둘이 어긋나 있었다. cbor.decodeFirst('f6') 는 err 없이 null 을 준다 —
// CBOR 의 null 값이라 파서 입장에서는 정상이다. 그런데 '1' 로 넘기면
// pxy_ws.js:225 의 jsonObj['m2m:rqp'] 가 null 을 역참조한다.
// 프록시는 cluster.isMaster 블록에서 require 되므로 워커가 아니라
// **마스터가 죽고, 워커 재시작 로직까지 함께 사라진다.**
//
// 실측: WS 7577(인증 없음)에 subprotocol onem2m.r2.0.cbor 로 붙어
// 1바이트 0xF6 을 보내면 리스닝 포트가 전부 사라졌다.
//
// 최상위가 객체가 아니면(null, 숫자, 문자열, 배열) 어차피 oneM2M 요청이
// 아니므로 여기서 실패로 돌린다.
function usable_object(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

// bodytype 인자를 걷어냈다 (2026-09-01). json 전용이 되면서 xml/cbor
// 분기가 사라졌고, 이 함수는 그 뒤로 인자를 한 번도 안 봤다.
global.make_json_obj = function (str, callback) {
    try {
        var result = JSON.parse(str);
        if (!usable_object(result)) { callback('0'); return; }
        callback('1', result);
    }
    catch (e) {
        console.error(e.message);
        callback('0');
    }
};

// make_json_arraytype 을 걷어냈다 (2026-08-31).
// XML 파서가 만든 결과에서 "원소가 하나면 배열이 아니라 값" 이 되는 것을
// 배열로 되돌리는 함수였다. 호출처가 xml 분기 둘뿐이라 함께 죽었다.
// JSON.parse 는 배열을 배열로 주므로 json 경로에는 필요가 없다.

// 요청 본문을 딱 한 번 읽는다.
//
// 예전에는 같은 본문을 두 번 파싱했다 — check_resource_supported 가
// make_json_obj 로 한 번, parse_body_format 이 parse_to_json 으로 또 한 번.
// 두 파싱이 서로 다른 정규화를 적용해서(앞은 원문 키, 뒤는 접두를 뗀 키),
// 그 어긋남이 몇몇 400 판정을 우연히 만들어 내고 있었다.
//
// 이제 한 번만 읽고, 정규화 전 원문 키를 request.rawRootKey 에 남긴다.
// ty 결정은 원문 키로 한다 — 옛 check_resource_supported 와 같은 입력이라
// 판정이 그대로 보존된다.
function parse_to_json(request, response, callback) {
    if (request.bodyParsed) {
        callback('200');
        return;
    }

    // 파서가 성공했다고 최상위가 객체인 것은 아니다. cbor.decodeFirst 는
    // 'f6'(CBOR null)에 err 없이 null 을 주고, JSON.parse('3') 은 숫자를 준다.
    // 그대로 Object.keys 에 넣으면 던지는데, cbor 콜백은 비동기라 바깥 try 를
    // 벗어난다. db.getConnection 콜백 안이라 빌린 커넥션도 새어 나갔다.
    //
    // 실측: POST /Mobius, Content-Type: application/cbor, 본문 'f6' 한 건으로
    // 워커가 죽었다.
    function settle(result) {
        if (!usable_object(result)) {
            return false;
        }
        request.rawRootKey = Object.keys(result)[0];
        request.bodyObj = result;
        make_short_nametype(request.bodyObj);
        return true;
    }

    try {
        if (!settle(JSON.parse(request.body.toString()))) {
            callback('400-7');
            return;
        }

        if (Object.keys(request.bodyObj)[0] == 'undefined') {
            callback('400-7');
        }
        else {
            request.headers.rootnm = Object.keys(request.bodyObj)[0];
            request.bodyParsed = true;
            callback('200');
        }
    }
    catch (e) {
        callback('400-7');
    }
}

function parse_body_format(request, response, callback) {
    parse_to_json(request, response, (code) => {
        if (code === '200') {
            var body_Obj = request.bodyObj;
            for (var prop in body_Obj) {
                if (body_Obj.hasOwnProperty(prop)) {
                    for (var attr in body_Obj[prop]) {
                        if (body_Obj[prop].hasOwnProperty(attr)) {
                            if (attr == 'aa' || attr == 'at' || attr == 'poa' || attr == 'acpi' || attr == 'srt' ||
                                attr == 'nu' || attr == 'mid' || attr == 'macp' || attr == 'rels' || attr == 'srv') {
                                if (!Array.isArray(body_Obj[prop][attr])) {
                                    callback('400-8');
                                    return;
                                }
                            }
                            else if (attr == 'lbl') {
                                if (body_Obj[prop][attr] == null) {
                                    body_Obj[prop][attr] = [];
                                }
                                else if (!Array.isArray(body_Obj[prop][attr])) {
                                    callback('400-9');
                                    return;
                                }
                            }
                            else if (attr == 'enc') {
                                if (body_Obj[prop][attr].net) {
                                    if (!Array.isArray(body_Obj[prop][attr].net)) {
                                        callback('400-10');
                                        return;
                                    }
                                }
                                else {
                                    callback('400-11');
                                    return;
                                }
                            }
                            else if (attr == 'pv' || attr == 'pvs') {
                                if (body_Obj[prop][attr].hasOwnProperty('acr')) {
                                    if (!Array.isArray(body_Obj[prop][attr].acr)) {
                                        callback('400-12');
                                        return;
                                    }
                                    var acr = body_Obj[prop][attr].acr;
                                    for (var acr_idx in acr) {
                                        if (acr.hasOwnProperty(acr_idx)) {
                                            if (acr[acr_idx].acor) {
                                                if (!Array.isArray(acr[acr_idx].acor)) {
                                                    callback('400-13');
                                                    return;
                                                }
                                            }
                                            if (acr[acr_idx].acco) {
                                                if (!Array.isArray(acr[acr_idx].acco)) {
                                                    callback('400-14');
                                                    return;
                                                }
                                                for (var acco_idx in acr[acr_idx].acco) {
                                                    if (acr[acr_idx].acco.hasOwnProperty(acco_idx)) {
                                                        var acco = acr[acr_idx].acco[acco_idx];
                                                        if (acco.acip) {
                                                            if (acco.acip['ipv4']) {
                                                                if (!Array.isArray(acco.acip['ipv4'])) {
                                                                    callback('400-15');
                                                                    return;
                                                                }
                                                            }
                                                            else if (acco.acip['ipv6']) {
                                                                if (!Array.isArray(acco.acip['ipv6'])) {
                                                                    callback('400-16');
                                                                    return;
                                                                }
                                                            }
                                                        }
                                                        if (acco.actw) {
                                                            if (!Array.isArray(acco.actw)) {
                                                                callback('400-17');
                                                                return;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            else if (attr == 'uds') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    callback('400-18');
                                    return;
                                }
                            }
                            else if (attr == 'cas') {
                                if (body_Obj[prop][attr].can && body_Obj[prop][attr].sus) {
                                }
                                else {
                                    callback('400-18');
                                    return;
                                }
                            }
                            else {
                            }
                        }
                    }
                }
            }
            callback(code);
        }
        else {
            callback(code);
        }
    });
}

function check_request_query_rt(request, response, callback) {
    //var ri = url.parse(request.url).pathname;

    //var url_arr = ri.split('/');
    //var last_url = url_arr[url_arr.length-1];
    //var op = 'direct';

    if (request.query.rt == 3) { // default, blocking
        callback('200');
    }
    else if (request.query.rt == 1 || request.query.rt == 2) { // nonblocking
        // rt=2 는 결과를 받을 주소를 X-M2M-RTU 로 함께 줘야 한다. 없으면
        // 잘못된 요청이다.
        //
        // 원래 조건이 `rtu == null && rtu == ''` 였다. 두 조건이 동시에 참일 수
        // 없으므로 언제나 거짓이었고, 그래서 400-21 이 한 번도 나가지 않았다.
        var rtu = request.headers['x-m2m-rtu'];
        if (request.query.rt == 2 && (rtu == null || rtu === '')) {
            callback('400-21');
            return;
        }

        // 논블로킹은 지원하지 않는다.
        //
        // 예전에는 여기서 req 리소스를 만들고 202 + 그 URI 를 돌려줬는데,
        // 정작 요청한 연산은 수행하지 않았다. 클라이언트는 영영 채워지지 않을
        // 결과를 기다리게 된다. 게다가 202 를 받아 응답하는 분기가 app.post 에만
        // 있어서 GET/PUT/DELETE 는 사유 표에 없는 코드로 흘러가 500 이 났다.
        //
        // 절반만 구현된 것을 남겨 두는 것보다 지원하지 않는다고 답하는 편이 낫다.
        // 이제 req 리소스를 만드는 곳이 없다 — ty=17 직접 생성은 405-2 가 막는다.
        console.log('[check_request_query_rt] 논블로킹(rt=' + request.query.rt + ')은 지원하지 않는다');
        callback('405-4');
    }
    else {
        callback('405-4');
    }
}

// fanOutPoint 요청의 대상이 그룹인지, 멤버가 있는지 판정만 한다.
//
// 응답은 보내지 않는다. 호출부 4곳이 이미 결과 코드로 응답한다.
//   '1' -> 그룹이고 멤버가 있다. 두 번째 인자로 그룹 리소스를 넘긴다
//   '2' -> 그룹이지만 mid 가 비었다   -> 호출부가 403-6 으로 응답
//   '0' -> 그룹이 아니다              -> 호출부가 404-4 로 응답
//
// 예전에는 여기서도 responder.response_result 를 직접 불렀다. 그런데 인자가
// 밀려 있었다 — 시그니처는 (request, response, status, rsc, cap, callback) 인데
// rsc 자리에 객체를, callback 자리에 request.url 을 넘겼다. 게다가
// response_result 는 request.resourceObj 를 읽는데 여기서는 그걸 세팅하지 않아
// Object.keys(undefined) 로 워커가 죽었다.
//
//   재현: GET /Mobius/fopt  (CSEBase 는 ty=5 라 그룹이 아니다)
//
// 호출부가 이미 응답하므로 이 호출 자체가 중복이었다. 문구도 카탈로그의
// 403-6 / 404-4 와 같은 내용이라 잃는 것이 없다.
/**
 * fanOutPoint(/fopt) 요청을 처리한다.
 *
 * 네 메서드가 같은 흐름을 네 벌 들고 있었다. 다른 것은 둘뿐이다.
 *
 *   access_value  POST '1' / GET '2'(discovery 는 '32') / PUT '4' / DELETE '8'
 *   parse_body    본문을 읽어야 하는가. POST 와 PUT 만 참이다.
 *
 * 흐름은 이렇다.
 *   1. 대상이 그룹이고 멤버가 있는지 본다 (check_grp)
 *   2. 그룹의 macp 로 권한을 본다 — 일반 리소스의 acpi 가 아니다
 *   3. (필요하면) 본문을 읽는다
 *   4. 멤버마다 요청을 흘려보낸다 (fopt.check)
 *
 * 거부 코드가 일반 경로와 다르다 — 권한 없음이 403-3 이 아니라 403-5 다.
 */
function run_fanout(request, response, settle, access_value, parse_body) {
    check_grp(request, response, (rsc, result_grp) => {
        if (rsc !== '1') {
            // '2' 는 그룹이지만 mid 가 비었다는 뜻, 그 밖은 그룹이 아니다.
            settle.error(rsc === '2' ? '403-6' : '404-4');
            return;
        }

        var body_Obj = {};
        var target_ty = request.targetObject[Object.keys(request.targetObject)[0]].ty;

        security.check(request, response, target_ty, result_grp.macp, access_value, result_grp.cr, (code) => {
            if (code === '0') { settle.error('403-5'); return; }
            if (code !== '1') { settle.error(code); return; }

            function fan_out() {
                fopt.check(request, response, result_grp, body_Obj, (code) => {
                    if (code === '200') { settle.search('200', '2000', ''); }
                    else { settle.error(code); }
                });
            }

            if (!parse_body) { fan_out(); return; }

            parse_body_format(request, response, (code) => {
                if (code !== '200') { settle.error(code); return; }
                fan_out();
            });
        });
    });
}

function check_grp(request, response, callback) {
    var result_Obj = request.targetObject;
    var rootnm = Object.keys(result_Obj)[0];

    if (result_Obj[rootnm].ty == 9) {
        if (result_Obj[rootnm].mid.length == 0) {
            callback('2');
            return '0';
        }
        else {
            callback('1', result_Obj[rootnm]);
            return '1';
        }
    }
    else {
        callback('0');
        return '0';
    }
}

// (결과 코드·사유 카탈로그는 파일 상단에서 require 한다)
//
// 에러 응답의 단일 통로. 코드 키('400-8')만 넘기면 나머지는 카탈로그가 채운다.
//
// 예전에는 호출부마다 resultStatusCode[code][0], [1], [2] 를 직접 펼쳐 넘겼다.
// 표의 3원소 배열 구조가 47곳에 새어 나가 있어서, 표에 필드를 하나 더하려면
// 그 47곳을 전부 봐야 했다.
// 정산기는 mobius/settle.js 에 있다. 여기서는 response_error_result 를 엮어
// 넘기기만 한다 — 그 함수가 reason 카탈로그와 responder.respond 를 잇고 있다.
function make_settler(request, response, connection) {
    // 반납하는 법을 주입한다 — settle.js 가 db_action 을 알면 파사드를
    // 우회하는 파일이 하나 늘고, 커넥션 원천을 옮길 때 같이 고칠 곳이 늘어난다.
    return settle_mod.make(request, response, connection, response_error_result, db.release);
}

function response_error_result(request, response, code, callback) {
    var r = reason.get(code);
    if (!r) {
        // 표에 없는 코드. 예전에는 resultStatusCode[code][0] 에서 TypeError 가 나
        // 워커가 죽었다. 500 으로 응답하고 로그에 남긴다.
        console.error('[response_error_result] 정의되지 않은 코드: ' + code);
        responder.respond(request, response, {
            code: RSC.INTERNAL_SERVER_ERROR,
            dbg: 'internal error',
            detail: 'unknown result code: ' + code
        }, callback);
        return;
    }
    // dbg 는 클라이언트 응답 본문(m2m:dbg)으로, detail 은 로그로만 나간다.
    responder.respond(request, response, { code: r.code, dbg: r.msg, detail: r.detail }, callback);
}

/**
 * 판정 대상의 cr(생성자)을 정한다.
 *
 * AE 는 aei, remoteCSE 는 csi 가 곧 생성자다. ACP 가 하나도 안 걸린 리소스는
 * security 가 "요청자 == cr" 로만 판정하므로 이 값이 결과를 좌우한다.
 *
 * create 는 이 함수를 쓰지 않는다 — 부모가 remoteCSE 일 때 csi 를 넣지 않는
 * 것이 원래 동작이고, 바꾸면 ACP 없는 remoteCSE 아래 생성의 판정이 달라진다.
 */
function resolve_cr(target) {
    if (target.ty == 2) {
        target.cr = target.aei;
    }
    else if (target.ty == 16) {
        target.cr = target.csi;
    }
}

/**
 * lookup_* 넷의 공통 꼬리 — 권한을 확인하고 연산을 수행한다.
 *
 * create / retrieve / update / delete 는 앞부분(무엇을 검사하느냐)이 다를 뿐
 * 이 꼬리는 같았다. 네 곳에 똑같이 적혀 있던 것을 모은다.
 *
 *   1. security.check 로 권한을 본다.
 *   2. '1' 이면 연산, '0' 이면 403-3, 그 밖은 받은 코드를 그대로 올린다.
 *
 * cr 은 호출부가 미리 정해 둔다 — create 와 나머지가 다르기 때문이다.
 *
 * @param target        판정 대상 리소스. create 는 부모, 나머지는 자기 자신이다.
 * @param access_value  oneM2M acop 비트. create '1'(sub 는 '3') / retrieve '2'
 *                      (discovery 는 '32') / update '4' / delete '8'
 * @param run           권한이 있을 때 수행할 연산 (resource.create 등)
 */
function authorize_and_run(request, response, target, access_value, run, callback) {
    security.check(request, response, target.ty, target.acpi, access_value, target.cr, (code) => {
        if (code === '1') {
            run(request, response, (code) => {
                callback(code);
            });
        }
        else if (code === '0') {
            callback('403-3');
        }
        else {
            callback(code);
        }
    });
}

function lookup_create(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code === '200') {
            var parentObj = request.targetObject[Object.keys(request.targetObject)[0]];

                if ((request.ty == 1) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // accessControlPolicy
                }
                else if ((request.ty == 9) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2)) { // group
                }
                else if ((request.ty == 16) && (parentObj.ty == 5)) { // remoteCSE
                    // 여기 있던 검사는 ASN-CSE 전용이었다. 이 CSE 는 IN 이고
                    // ASN/MN 모드는 제거했다(2026-08-31). 400-28 도 함께 빠졌다.
                }
                else if ((request.ty == 10) && (parentObj.ty == 5)) { // locationPolicy
                }
                else if ((request.ty == 2) && (parentObj.ty == 5)) { // ae
                }
                else if ((request.ty == 3) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3)) { // container
                }
                else if ((request.ty == 23) && (parentObj.ty == 5 || parentObj.ty == 16 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 24 || parentObj.ty == 9 || parentObj.ty == 1 || parentObj.ty == 27 || parentObj.ty == 28)) { // sub
                }
                else if ((request.ty == 4) && (parentObj.ty == 3)) { // contentInstance
                }
                else if ((request.ty == 24) && (parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 4)) { // semanticDescriptor
                }
                else if ((request.ty == 27) && (parentObj.ty == 2 || parentObj.ty == 16)) { // multimediaSession
                }
                else if ((request.ty == 14) && (parentObj.ty == 5)) { // node
                }
                else if ((request.ty == 13) && (parentObj.ty == 14)) { // mgmtObj
                }
                else if ((request.ty == 28) && (parentObj.ty == 5 || parentObj.ty == 2 || parentObj.ty == 3 || parentObj.ty == 28)) { // flexcontainer
                }
                else if ((request.ty == 98 || request.ty == 97 || request.ty == 96 || request.ty == 95 || request.ty == 94 || request.ty == 93 || request.ty == 92 || request.ty == 91) && (parentObj.ty == 28)) { // flexcontainer
                }
                else {
                    callback('403-2');
                    return;
                }

                if ((request.ty == 4) && (parentObj.ty == 3)) { // contentInstance
                    if (parseInt(parentObj.mni) == 0) {
                        callback('406-1');
                        return;
                    }
                    else if (parseInt(parentObj.mbs) == 0) {
                        callback('406-2');
                        return;
                    }
                    else if (parentObj.disr == true) {
                        callback('405-6');
                        return;
                    }

                    request.headers.mni = parentObj.mni;
                    request.headers.mbs = parentObj.mbs;
                    request.headers.cni = parentObj.cni;
                    request.headers.cbs = parentObj.cbs;
                    request.headers.st = parentObj.st;
                }

                if (parentObj.length == 0) {
                    parentObj = {};
                    parentObj.cr = '';
                    console.log('no creator');
                }
                else {
                    if (parentObj.ty == 2) {
                        parentObj.cr = parentObj.aei;
                    }
                }

                // sub 생성은 CREATE(1)가 아니라 NOTIFY 를 포함한 3 을 본다.
                var access_value = (request.ty == 23) ? '3' : '1';

                // 예전에는 여기서 두 가지를 더 했다.
                //   - 요청마다 shortid 를 만들어 security.check 를 console.time 으로 쟀다.
                //     CREATE 마다 로그 두 줄이 나가는 계측이라 걷어냈다.
                //   - cache_security_check 에 판정 결과를 적었다. **읽는 곳이 없다** —
                //     origin 과 ri 로 키를 만들어 무한히 쌓이기만 하는 메모리 누수였다.
                authorize_and_run(request, response, parentObj, access_value, resource.create, callback);
        }
        else {
            callback(code);
        }
    });
}

function lookup_retrieve(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code !== '200') { callback(code); return; }

        var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        if(!resultObj.hasOwnProperty('acpi')) {
            resultObj.acpi = [];
        }

        // discovery(fu=1)는 DISCOVER(32), 일반 조회는 RETRIEVE(2).
        // 예전에는 이 둘 때문에 같은 블록이 두 벌 있었다.
        var access_value = (request.query.fu == 1) ? '32' : '2';
        resolve_cr(resultObj);
        authorize_and_run(request, response, resultObj, access_value, resource.retrieve, callback);
    });
}

/**
 * 본문이 acpi 말고 다른 속성도 건드리는가.
 *
 * acpi 만 바꾸는 UPDATE 는 권한 검사를 건너뛴다 — 그 리소스에 어떤 ACP 를
 * 걸지는 selfPrivileges(pvs)가 정하는 일이라는 취지다.
 * (그 판단이 옳은지는 별개 문제다. 여기서는 동작을 그대로 옮긴다.)
 */
function updates_beyond_acpi(bodyObj) {
    for (var rootnm in bodyObj) {
        if (!bodyObj.hasOwnProperty(rootnm)) { continue; }
        for (var attr in bodyObj[rootnm]) {
            if (bodyObj[rootnm].hasOwnProperty(attr) && attr !== 'acpi') {
                return true;
            }
        }
    }
    return false;
}

function lookup_update(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code !== '200') { callback(code); return; }

        var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        if (!updates_beyond_acpi(request.bodyObj)) {
            // acpi 만 바꾸는 경우 — 권한 검사 없이 진행한다.
            resource.update(request, response, (code) => {
                callback(code);
            });
            return;
        }

        resolve_cr(resultObj);
        authorize_and_run(request, response, resultObj, '4', resource.update, callback);
    });
}

function lookup_delete(request, response, callback) {
    check_request_query_rt(request, response, (code) => {
        if (code !== '200') { callback(code); return; }

        var resultObj = request.targetObject[Object.keys(request.targetObject)[0]];

        resolve_cr(resultObj);
        authorize_and_run(request, response, resultObj, '8', resource.delete, callback);
    });
}

function check_resource_from_url(connection, ri, sri, callback) {
    db_sql.select_resource_from_url(connection, ri, sri, (err, results) => {
        if (err) {
            callback(null, 500);
        }
        else if (results.length === 0) {
            callback(null, 404);
        }
        else if (!responder.typeRsrc.hasOwnProperty(String(results[0].ty))) {
            // lookup 에 있는데 그 타입을 이 CSE 가 다루지 않는 경우다.
            // 지원을 걷어낸 타입의 옛 행이 남아 있으면 여기로 온다
            // (예: req/ty=17 — 논블로킹을 접으면서 제거했다).
            //
            // 예전에는 그대로 흘려보내 typeRsrc[ty] 가 undefined 인 채
            // 테이블 이름 자리에 들어갔고, 깨진 질의가 500
            // "database error" 로 나갔다. 원인을 짐작할 수 없는 응답이다.
            // 지원하지 않는 타입이라고 답한다.
            console.log('[check_resource_from_url] 지원하지 않는 타입의 행: ty=' +
                        results[0].ty + ' ' + ri);
            callback(null, 501);
        }
        else {
            // 캐시하지 않는다. 여기서 돌려주는 객체는 이 요청만의 것이고,
            // 호출부가 makeObject 로 제자리에서 고쳐도 남의 요청에 안 남는다.
            callback(results[0], 200);
        }
    });
}

function get_resource_from_url(connection, ri, sri, option, callback) {
    var targetObject = {};

    check_resource_from_url(connection, ri, sri, (result, code) => {
        if(code === 200) {
            var ty = result.ty;
            targetObject[responder.typeRsrc[ty]] = result;
            var rootnm = Object.keys(targetObject)[0];
            makeObject(targetObject[rootnm]);

            if (option == '/latest') {
                var la_id = 'select_latest_resource ' + targetObject[rootnm].ri + ' - ' + require('shortid').generate();
                console.time(la_id);
                var latestObj = [];
                db_sql.select_latest_resource(connection, targetObject[rootnm], 0, latestObj, (code) => {
                    console.timeEnd(la_id);
                    if (code === '200') {
                        if (latestObj.length == 1) {

                            // JSON 왕복으로 프로토타입을 벗긴다.
                            //
                            // 여기 `.replace('RowDataPacket ', '')` 가 붙어
                            // 있었는데 **아무 일도 하지 않는 코드였다.**
                            // JSON.stringify 는 생성자 이름을 출력에 넣지
                            // 않으므로 그 부분 문자열은 결과에 존재할 수 없다.
                            //
                            // 실제로 필요했던 것은 왕복 자체다. 파사드가 행
                            // 객체를 정규화하지 않고 그대로 통과시켜서, MySQL
                            // 백엔드에서 여기 오는 것은 node-mysql 의
                            // RowDataPacket 인스턴스다. 아래에서 이 객체를
                            // 다시 담아 응답으로 내보내므로 평범한 객체여야 한다.
                            //
                            // 치환을 지우는 이유는 동작이 아니라 오해다 —
                            // "코어가 어느 드라이버 위에 있는지 안다" 는 잘못된
                            // 믿음이 코드로 남아 있으면, 다음 사람이 그것을
                            // 근거로 진짜 드라이버 의존 코드를 더한다.
                            latestObj[0] = JSON.parse(JSON.stringify(latestObj[0]));

                            targetObject = {};
                            targetObject[responder.typeRsrc[latestObj[0].ty]] = latestObj[0];
                            makeObject(targetObject[Object.keys(targetObject)[0]]);

                            callback(targetObject);
                        }
                        else {
                            callback(null, 404);
                            return '0';
                        }
                    }
                    else {
                        callback(null, 500);
                        return '0';
                    }
                });
            }
            else if (option == '/oldest') {
                var oldestObj = [];
                db_sql.select_oldest_resource(connection, parseInt(ty, 10) + 1, ri, oldestObj, (code) => {
                    if (code === '200') {
                        if (oldestObj.length == 1) {
                            targetObject = {};
                            targetObject[responder.typeRsrc[oldestObj[0].ty]] = oldestObj[0];
                            makeObject(targetObject[Object.keys(targetObject)[0]]);
                            callback(targetObject);
                        }
                        else {
                            callback(null, 404);
                            return '0';
                        }
                    }
                    else {
                        callback(null, 500);
                        return '0';
                    }
                });
            }
            else if (option == '/fopt') {
                callback(targetObject, 200);
            }
            else {
                callback(targetObject, 200);
            }
        }
        else {
            callback(result, code);
        }
    });
}

function extra_api_action(connection, url, callback) {
    if (url == '/hit') {
        // for backup hit count
        if (0) {
            var _hit_old = JSON.parse(fs.readFileSync('hit.json', 'utf-8'));
            var _http = 0;
            var _mqtt = 0;
            var _coap = 0;
            var _ws = 0;

            for (var dd in _hit_old) {
                if (_hit_old.hasOwnProperty(dd)) {
                    for (var ff in _hit_old[dd]) {
                        if (_hit_old[dd].hasOwnProperty(ff)) {
                            if (Object.keys(_hit_old[dd][ff]).length > 0) {
                                for (var gg in _hit_old[dd][ff]) {
                                    if (_hit_old[dd][ff].hasOwnProperty(gg)) {
                                        if (_hit_old[dd][ff][gg] == null) {
                                            _hit_old[dd][ff][gg] = 0;
                                        }
                                        if (gg == 'H') {
                                            _http = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'M') {
                                            _mqtt = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'C') {
                                            _coap = _hit_old[dd][ff][gg];
                                        }
                                        else if (gg == 'W') {
                                            _ws = _hit_old[dd][ff][gg];
                                        }
                                    }
                                }

                                db_sql.set_hit_n(connection, dd, _http, _mqtt, _coap, _ws, (err, results) => {
                                    results = null;
                                });
                            }
                        }
                    }
                }
            }
        }

        if (0) {
            var count = 0;
            setTimeout((count) => {
                if (count > 250) {
                    return;
                }
                var dd = moment().utc().subtract(count, 'days').format('YYYYMMDD');
                var _http = 5000 + Math.random() * 50000;
                var _mqtt = 1000 + Math.random() * 9000;
                var _coap = 0;
                var _ws = 0;

                db_sql.set_hit_n(connection, dd, _http, _mqtt, _coap, _ws, (err, results) => {
                    results = null;
                    console.log(count);
                    setTimeout(random_hit, 100, ++count);
                });
            }, 100, count);
        }

        db_sql.get_hit_all(connection, (err, result) => {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else if (url == '/total_ae') {
        db_sql.select_sum_ae(connection, function (err, result) {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else if (url == '/total_cbs') {
        db_sql.select_sum_cbs(connection, function (err, result) {
            if (err) {
                callback('500-1');
            }
            else {
                callback('201', result);
            }
        });
    }
    else {
        callback('200');
    }
}

function check_xm2m_headers(request, callback) {
    // Check X-M2M-RI Header
    if (request.headers.hasOwnProperty('x-m2m-ri')) {
        if (request.headers['x-m2m-ri'] === '') {
            callback('400-1');
            return;
        }
    }
    else {
        callback('400-1');
        return;
    }

    // Check X-M2M-RVI Header
    if (!request.headers.hasOwnProperty('x-m2m-rvi')) {
        request.headers['x-m2m-rvi'] = uservi;
    }

    // request.ty — 이 요청이 만들거나 고칠 리소스의 타입. 안 줬으면 null.
    //
    // 값은 아래 순서로 정해지고, **뒤집히지 않는다.**
    //   1. Content-Type 의 ty=N  (바로 아래)
    //   2. 본문 루트 이름         (type_resolver.resolve)
    // 둘이 어긋나면 resolve 가 400-42 로 끊는다. 일치하면 본문 쪽으로
    // 정밀해질 뿐이다(ty=28 + hd:dooLk -> 98). 그래서 "헤더가 말한 것" 과
    // "확정된 것" 을 따로 들 이유가 없다 — 한 필드면 된다.
    //
    // null 은 "안 줬다" 다. 예전에는 '99' 로 표시했는데 그것이 typeRsrc 의
    // 실제 키('rsp')여서 "안 줬다" 와 "rsp 타입이다" 가 같은 값이 됐다.
    // 그 겹침 때문에 DELETE 의 headers.rootnm 이 'rsp' 로 새어 나갔다.
    // null 은 어떤 타입 값과도 겹치지 않는다.
    //
    // GET·DELETE 는 본문이 없어 null 로 남는다. 그 둘은 request.ty 를 읽지
    // 않는다 — 대상 행에 이미 ty 가 있다(mobius/resource.js retrieve/delete).
    request.ty = null;

    if (request.headers.hasOwnProperty('content-type')) {
        var content_type = request.headers['content-type'].split(';');
        for (var i in content_type) {
            if (content_type.hasOwnProperty(i)) {
                var ty_arr = content_type[i].replace(/ /g, '').split('=');
                if (ty_arr[0].replace(/ /g, '') == 'ty') {
                    // 'ty' 에 값이 없으면(Content-Type: application/json;ty)
                    // ty_arr[1] 이 undefined 다. 예전에는 곧바로 .replace 를 불러
                    // TypeError 로 워커가 죽었다 — 이 코드는 db.getConnection 콜백
                    // 안이라 빌린 커넥션도 반납되지 않았다.
                    // 헤더 한 줄로 워커를 죽일 수 있었다.
                    if (ty_arr[1] == null || ty_arr[1] === '') {
                        console.log('[check_xm2m_headers] Content-Type 의 ty 에 값이 없다: ' +
                                    request.headers['content-type']);
                        content_type = null;
                        callback('400-55');
                        return;
                    }
                    request.ty = ty_arr[1].replace(' ', '');
                    content_type = null;
                    break;
                }
            }
        }

        // ty=5(CSEBase)는 **목록에 있지만** 남이 만들 수 없다.
        // "지원하지 않는다" 와 "지원하지만 만들 수 없다" 는 다른 사유라 따로 본다.
        if (request.ty == '5') {
            callback('405-1');
            return;
        }

        // ty 를 명시했으면 이 CSE 가 다루는 타입인지 여기서 본다.
        //
        // 예전에는 지원을 걷어낸 타입마다 분기를 하나씩 더했다(ty=17 -> 405-2).
        // 그러면 타입을 뺄 때마다 여기도 같이 고쳐야 하고, 빠뜨리면 이 관문을
        // 그냥 지나 build_resource(resource.js) 까지 내려가서야 걸린다 —
        // 그 사이에 커넥션을 빌리고 대상을 조회한 뒤다.
        //
        // 판단 근거는 ty_list 하나여야 한다. 목록에서 빼면 여기서 막힌다.
        //
        // null 이면 "헤더에 ty 가 없었다" 는 뜻이라 거를 것이 없다 — WS/MQTT 의
        // PUT 은 ty 를 안 붙인다. 그건 본문을 읽고 resolve 가 정한다.
        if (request.ty != null && !ty_list.includes(String(request.ty))) {
            console.log('[check_xm2m_headers] 지원하지 않는 ty: ' + request.ty);
            callback('400-3');
            return;
        }

        // 언제나 json 이다. 앞의 json_only 미들웨어가 xml/cbor 본문을 이미
        // 400 으로 끊었으므로 여기 오는 요청은 전부 json 이다.
        //
        // 예전에는 content-type 문자열에 'xml' 이 들어 있는지 **부분 문자열**로
        // 봤다. 그래서 `application/json;ty=3;note=xmlish` 같은 정상 요청이
        // usebodytype='xml' 이 되어 parse_to_json 이 400-5("valid XML 이
        // 아니다")를 냈다. 실측으로 재현했다. 관문은 세미콜론 앞의 MIME 만
        // 보므로 그런 오탐이 없다.
        request.usebodytype = 'json';
    }
    else {
        request.usebodytype = 'json';
    }

    // Check X-M2M-Origin Header
    if (request.headers.hasOwnProperty('x-m2m-origin')) {
        if (request.headers['x-m2m-origin'] === '') {
            // 아직 본문을 안 읽었다 — 헤더가 선언한 것으로만 판단한다.
            if (request.ty == '2' || request.ty == '16') {
                request.headers['x-m2m-origin'] = 'S';
            }
            else {
                callback('400-2');
                return;
            }
        }
    }
    else {
        callback('400-2');
        return;
    }

    if (!request.query.hasOwnProperty('fu')) {
        request.query.fu = 2;
    }

    if (!request.query.hasOwnProperty('rcn')) {
        request.query.rcn = 1;
    }

    if (!request.query.hasOwnProperty('rt')) {
        request.query.rt = 3;
    }

    var allow = 1;
    if (allowed_ae_ids.length > 0) {
        allow = 0;
        for (var idx in allowed_ae_ids) {
            if (allowed_ae_ids.hasOwnProperty(idx)) {
                if (usecseid == request.headers['x-m2m-origin']) {
                    allow = 1;
                    break;
                }
                else if (allowed_ae_ids[idx] == request.headers['x-m2m-origin']) {
                    allow = 1;
                    break;
                }
            }
        }

        if (allow == 0) {
            callback('403-1');
            return;
        }
    }

    // 여기 있던 `typeRsrc.hasOwnProperty(request.ty)` 관문(405-3)은 걷어냈다.
    // 통과하지 못할 값이 도달할 수 없어 사문이었다 — 헤더로 온 ty 는 바로 위
    // ty_list 관문이 400-3 으로 끊고, 본문으로 온 ty 는 type_resolver 가
    // typeRsrc 키에서만 만들어 준다(mobius/type_resolver.js).
    // 대상 행의 타입이 이 CSE 소관인지는 get_target_url 이 본다(app.js 405-3).
    callback('200');
}

// 본문에서 리소스 타입을 정한다. 여기가 CREATE·UPDATE 의 ty 결정 지점이다.
//
// 예전에는 이 함수가 본문을 따로 한 번 더 파싱하고, typeRsrc 를 직접
// 역탐색하고, Content-Type 의 ty 를 조용히 덮어썼다. 덮어쓰기 때문에
// application/json;ty=3 에 {"m2m:ae":...} 를 보내면 AE 가 201 로 만들어졌다.
// 이제 파싱은 parse_to_json 한 곳, 타입 판정은 type_resolver 한 곳이다.
function check_resource_supported(request, response, callback) {
    parse_to_json(request, response, (code) => {
        if (code !== '200') {
            callback(code);
            return;
        }

        // 정규화 전 원문 키로 판정한다 — 옛 코드와 같은 입력이다.
        // 지금 request.ty 에 든 것은 헤더가 말한 값(없으면 null)이다. resolve 가
        // 본문과 대조해 확정값을 돌려주고, 어긋나면 400-42 로 끊는다.
        var resolved = type_resolver.resolve(request.rawRootKey, request.ty);
        if (resolved.rsc !== '200') {
            callback(resolved.rsc);
            return;
        }

        request.ty = resolved.ty;
        callback('200');
    });
}

function get_target_url(request, response, callback) {
    request.url = request.url.replace('%23', '#'); // convert '%23' to '#' of url
    request.hash = url.parse(request.url).hash;

    var absolute_url = request.url.replace('\/_\/', '\/\/').split('#')[0];
    absolute_url = absolute_url.replace(usespid, '/~');
    absolute_url = absolute_url.replace(/\/~\/[^\/]+\/?/, '/');
    var absolute_url_arr = absolute_url.split('/');

    console.log('\n' + request.method + ' : ' + request.url);
    // GET/DELETE 는 본문이 없어 여기가 bodyObj 의 유일한 생산 지점이다.
    // POST/PUT 은 이 앞의 check_resource_supported 에서 이미 파싱했으므로
    // 덮어쓰면 안 된다 — 그러면 파싱이 다시 두 번이 된다.
    if (!request.bodyParsed) {
        request.bodyObj = {};
    }

    request.option = '';
    request.sri = absolute_url_arr[1].split('?')[0];
    if (absolute_url_arr[absolute_url_arr.length - 1] == 'la') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-3);
            request.option = '/latest';
        }
        else {
            // return 이 없으면 아래 get_resource_from_url 까지 실행이 흘러 콜백이 두 번
            // 불린다. 첫 호출이 409 를 보내고 핸들러가 request = null 로 지운 뒤라
            // 두 번째 호출은 error_result 에서 request.query 를 읽다 워커를 죽였다.
            callback('409-1');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'latest') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-7);
            request.option = '/latest';
        }
        else {
            // return 이 없으면 아래 get_resource_from_url 까지 실행이 흘러 콜백이 두 번
            // 불린다. 첫 호출이 409 를 보내고 핸들러가 request = null 로 지운 뒤라
            // 두 번째 호출은 error_result 에서 request.query 를 읽다 워커를 죽였다.
            callback('409-1');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'ol') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-3);
            request.option = '/oldest';
        }
        else {
            // 위와 같은 이유로 return 이 필요하다 (콜백 중복 호출 -> 워커 크래시)
            callback('409-2');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'oldest') {
        if (request.method.toLowerCase() == 'get' || request.method.toLowerCase() == 'delete') {
            request.ri = absolute_url.split('?')[0];
            request.ri = request.ri.substr(0, request.ri.length-7);
            request.option = '/oldest';
        }
        else {
            // 위와 같은 이유로 return 이 필요하다 (콜백 중복 호출 -> 워커 크래시)
            callback('409-2');
            return;
        }
    }
    else if (absolute_url_arr[absolute_url_arr.length - 1] == 'fopt') {
        request.ri = absolute_url.split('?')[0].replace('/fopt', '');
        request.option = '/fopt';
    }
    else {
        request.ri = absolute_url.split('?')[0];
        request.option = '';
    }

    request.absolute_url = absolute_url;
    absolute_url = null;
    var tid = require('shortid').generate();
    console.time('get_resource_from_url' + ' (' + tid + ') - ' + request.absolute_url);
    get_resource_from_url(request.db_connection, request.ri, request.sri, request.option, (targetObject, status) => {
        console.timeEnd('get_resource_from_url' + ' (' + tid + ') - ' + request.absolute_url);
        if (status == 404) {
            if (url.parse(request.absolute_url).pathname.split('/')[1] == usecsebase) {
                callback('404-1');
            }
            else {
                callback('301-1');
            }
        }
        else if (status == 500) {
            callback('500-1');
        }
        else if (status == 501) {
            // 이 CSE 가 다루지 않는 타입의 행이다. check_resource_from_url 주석 참고.
            callback('405-3');
        }
        else {
            if (targetObject) {
                request.targetObject = JSON.parse(JSON.stringify(targetObject));
                targetObject = null;

                callback('200');
            }
            else {
                callback('404-1');
            }
        }
    });
}

function check_allowed_app_ids(request, callback) {
    if (responder.typeRsrc[request.ty] != Object.keys(request.bodyObj)[0]) {
        if (responder.typeRsrc[request.ty] == 'mgo') {
            var support_mgo = 0;
            for (var prop in responder.mgoType) {
                if (responder.mgoType.hasOwnProperty(prop)) {
                    if (responder.mgoType[prop] == Object.keys(request.bodyObj)[0]) {
                        support_mgo = 1;
                        break;
                    }
                }
            }

            if (support_mgo == 0) {
                callback('400-42');
                return;
            }
        }
        else {
            callback('400-42');
            return;
        }
    }

    if (request.ty == '2') {
        var allow = 1;
        if (allowed_app_ids.length > 0) {
            allow = 0;
            for (var idx in allowed_app_ids) {
                if (allowed_app_ids.hasOwnProperty(idx)) {
                    if (allowed_app_ids[idx] == request.bodyObj.ae.api) {
                        allow = 1;
                        break;
                    }
                }
            }
            if (allow == 0) {
                callback('403-4');
                return;
            }
        }
    }

    callback('200');
}

function check_type_update_resource(request, callback) {
    // 여기에 ty 결정 알고리즘이 한 벌 더 있었다 — check_resource_supported 와
    // 다른 방식으로 같은 일을 했다. 두 벌이라 한쪽만 mgoType 을 알았다.
    // 이제 둘 다 type_resolver 를 쓴다.
    var body_root = Object.keys(request.bodyObj)[0];
    var resolved = type_resolver.resolve(body_root, null);

    if (resolved.rsc === '200') {
        if (resolved.ty === '4') {
            callback('405-7');      // contentInstance 는 수정할 수 없다
            return;
        }
        if (resolved.ty === '17') {
            // typeRsrc 에서 17(req) 이 빠진 뒤로 도달하지 않는다.
            // req 리소스가 되살아나면 다시 필요하므로 남겨 둔다.
            callback('405-8');
            return;
        }
        request.ty = resolved.ty;
    }

    // 본문 루트와 ty 가 어긋나는지. POST 는 check_allowed_app_ids 가 같은
    // 검사를 하는데 PUT 에는 없었다. 그래서 접두 없는 본문({"cnt":...})은
    // rootnm 이 undefined 인 채로, 속성표가 없는 타입({"m2m:cb":...})은
    // 그대로 resource.update 까지 흘러가 워커를 죽였다. 실측으로 확인한
    // 크래시 두 종이 여기서 막힌다.
    if (responder.typeRsrc[request.ty] != body_root) {
        callback('400-42');
        return;
    }

    if (url.parse(request.targetObject[Object.keys(request.targetObject)[0]].ri).pathname == ('/' + usecsebase)) {
        callback('405-9');
        return;
    }

    callback('200');
}

function check_type_delete_resource(request, callback) {
    if (url.parse(request.targetObject[Object.keys(request.targetObject)[0]].ri).pathname == ('/' + usecsebase)) {
        callback('405-9');
    }
    else {
        callback('200');
    }
}

// 요청 본문 수집기. 왜 별도 모듈인지는 mobius/body.js 머리말 참조 —
// 요약하면 app.js 는 require 만 해도 포트를 열어서 단위 테스트가 못 부른다.
var body = require('./mobius/body');
var log_safe = require('./mobius/log_safe');
var onem2mParser = body.collect;

//////// contribution code
// Kevin Lee, Executive Director, Unibest INC, Owner of Howchip.com
// Process for CORS problem
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
    res.header('Access-Control-Expose-Headers', 'Origin, X-Requested-With, Content-Type, X-M2M-RI, X-M2M-RVI, X-M2M-RSC, Accept, X-M2M-Origin, Locale');
    (req.method == 'OPTIONS') ? res.sendStatus(200) : next();
});

/**
 * 이 CSE 는 json 만 다룬다. 요청 **본문**이 xml/cbor 이면 여기서 끊는다.
 *
 * ── 왜 여기인가 ─────────────────────────────────────────────────────
 * 네 라우트(POST/GET/PUT/DELETE)는 전부 request.on('end') 안에서
 * db.getConnection 을 먼저 부르고 그 콜백에서 check_xm2m_headers 를 부른다.
 * POST 는 커넥션을 두 번 빌린다(set_hit 용 + 본 처리용). 미들웨어에서 끊으면
 * **커넥션을 한 번도 빌리지 않고** 끝난다.
 *
 * ── Accept 는 보지 않는다 ───────────────────────────────────────────
 * 응답 형식은 거절할 일이 아니다. 무엇을 요구받든 json 으로 답한다
 * (responder 의 apply_headers). 브라우저 기본 Accept 에는
 * application/xml 이 들어 있으므로, 그것까지 거절하면 브라우저로 열기만 해도
 * 400 이 된다. 막으려는 것은 **일부러 xml 로 보낸 본문**이다.
 *
 * ── 판정은 MIME 타입만 본다 ─────────────────────────────────────────
 * 세미콜론 앞만 잘라 비교한다. 부분 문자열로 보면
 * `application/json;ty=2;note=xmlish` 같은 정상 요청이 걸린다 — 실제로 지금
 * parse_to_json 이 그 값을 xml 로 보고 400-5("valid XML 이 아니다")를 낸다.
 *
 * ── 이 거절이 곧 계측이다 ───────────────────────────────────────────
 * 요청 경로의 xml/cbor 사용량은 지금까지 기록이 없었다(hit 테이블은 프로토콜
 * 별로만 센다). 400-64 의 detail 이 console.error 로 찍히므로, 이 로그가
 * 비어 있으면 xml/cbor 코드를 지워도 되는 근거가 된다.
 */
var JSON_ONLY_DENY = /^(application|text)\/(.*\+)?(xml|cbor)$/;

app.use((req, res, next) => {
    var ct = req.headers['content-type'];
    if (typeof ct !== 'string' || ct === '') { return next(); }

    var mime = ct.split(';')[0].trim().toLowerCase();
    if (!JSON_ONLY_DENY.test(mime)) { return next(); }

    console.error('[json_only] ' + req.method + ' ' + req.url +
                  '  Content-Type: ' + mime +
                  '  origin=' + log_safe.origin(req.headers['x-m2m-origin']));

    // 응답은 다른 모든 에러와 같은 문으로 나간다.
    //
    // 처음엔 헤더를 여기서 손으로 세웠는데, `reason` 항목의 code 는 숫자가
    // 아니라 rsc.js 의 카탈로그 **객체**다. String(r.code) 가
    // `X-M2M-RSC: [object Object]` 를 내보냈고 배포에서 잡혔다. 값을 꺼내
    // 쓰는 대신 진입점을 쓴다 — respond() 가 RI·RVI·Locale 에코, Content-Type,
    // RSC, 본문까지 한 번에 맞춘다.
    //
    // detail 은 위에서 이미 더 자세히 찍었으므로 넘기지 않는다. 넘기면
    // `[BAD_REQUEST] json_only` 가 한 줄 더 붙어 계측만 흐려진다.
    var r = reason.get('400-64');
    responder.respond(req, res, { code: r.code, dbg: r.msg }, function () {});
});

// var heapdump = require('heapdump');
// app.use('/heapdump',function(req,res,next){
//     var filename = Date.now() + '.heapsnapshot';
//     heapdump.writeSnapshot(filename);
//     res.send('Heapdump has been generated in '+filename);
// });

// var graphqlHTTP = require('express-graphql');
// var { buildSchema } = require('graphql');
//
// var schema = buildSchema(`
//     type Query {
//         hello: String
//     }
// `);
//
// var root = { hello: () => 'Hello world!' };
//
// app.use('/' + usecsebase + '/discovery', graphqlHTTP({
//     schema: schema,
//     rootValue: root,
//     graphiql: true,
// }));

// remoteCSE, ae, cnt
app.post('*', onem2mParser, (request, response) => {
    var binding = request.headers['binding'] || 'H';   // request 참조를 동기 시점으로 이동
    db.getConnection((code, connection) => {
        if (code === '200') {
            db_sql.set_hit(connection, binding, (err, results) => {
                results = null;
                db.release(connection);
            });
        }
    });
    // db.getConnection((code, connection) => {
    //     if (code === '200') {
    //         if (!request.headers.hasOwnProperty('binding')) {
    //             request.headers['binding'] = 'H';
    //         }

    //         db_sql.set_hit(connection, request.headers['binding'], (err, results) => {
    //             results = null;

    //             connection.release();
    //         });
    //     }
    // });

    db.getConnection((code, connection) => {
        if (code === '200') {
            request.db_connection = connection;
            var settle = make_settler(request, response, connection);

            check_xm2m_headers(request, (code) => {
                if (code === '200') {
                    if (request.body !== "") {
                        check_resource_supported(request, response, (code) => {
                            if (code === '200') {
                                get_target_url(request, response, (code) => {
                                    if (code === '200') {
                                        if (request.option !== '/fopt') {
                                            parse_body_format(request, response, (code) => {
                                                if (code === '200') {
                                                    check_allowed_app_ids(request, (code) => {
                                                        if (code === '200') {
                                                            var rootnm = Object.keys(request.targetObject)[0];
                                                            var absolute_url = request.targetObject[rootnm].ri;
                                                            check_notification(request, response, (code) => {
                                                                if (code === 'post') {
                                                                    request.url = absolute_url;
                                                                    if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1 || request.query.rcn == 2 || request.query.rcn == 3)) {
                                                                        lookup_create(request, response, (code) => {
                                                                            if (code === '201') {
                                                                                settle.result('201', '2001', '');
                                                                            }
                                                                            else if (code === '201-3') {
                                                                                settle.rcn3('201', '2001', '');
                                                                            }
                                                                            else {
                                                                                settle.error(code);
                                                                            }
                                                                        });
                                                                    }
                                                                    else {
                                                                        code = '400-43';
                                                                        settle.error(code);
                                                                    }
                                                                }
                                                                else if (code === 'notify') {
                                                                    check_ae_notify(request, response, (code, res) => {
                                                                        if (code !== '200') {
                                                                            settle.error(code);
                                                                            return;
                                                                        }
                                                                        // 상류가 json 이 아닌 것을 주면 흘려보내지 않는다.
                                                                        // 이 경로는 settle.raw 라 apply_headers 를 우회하므로
                                                                        // "응답은 언제나 json" 이 여기서는 안 걸린다.
                                                                        if (!relay_headers(response, res, 'ae notify')) {
                                                                            settle.error('500-7');
                                                                            return;
                                                                        }
                                                                        settle.raw('ae notify', function () {
                                                                            response.statusCode = res.statusCode;
                                                                            response.send(res.body);
                                                                        });
                                                                    });
                                                                }
                                                                else {
                                                                    settle.error(code);
                                                                }
                                                            });
                                                        }
                                                        else {
                                                            settle.error(code);
                                                        }
                                                    });
                                                }
                                                else {
                                                    settle.error(code);
                                                }
                                            });
                                        }
                                        else { // if (request.option === '/fopt') {
                                            run_fanout(request, response, settle, '1', true);
                                        }
                                    }
                                    else if (code === '301-1') {
                                        check_csr(request, response, (code) => {
                                            if (code === '301-2') {
                                                settle.raw('csr forward', function () {
                                                    response.status(response.statusCode).end(response.body);
                                                });
                                            }
                                            else {
                                                settle.error(code);
                                            }
                                        });
                                    }
                                    else {
                                        settle.error(code);
                                    }
                                });
                            }
                            else {
                                settle.error(code);
                            }
                        });
                    }
                    else {
                        settle.error('400-40');
                    }
                }
                else {
                    settle.error(code);
                }
            });
        }
        else {
            // 커넥션을 못 빌린 경로다 — 반납할 것이 없어 null 을 넘긴다.
            make_settler(request, response, null).error(code);
        }
    });
});

app.get('*', onem2mParser, (request, response) => {
    db.getConnection((code, connection) => {
        if (code === '200') {
            request.db_connection = connection;
            var settle = make_settler(request, response, connection);

            extra_api_action(connection, request.url, (code, result) => {
                if (code === '200') {
                    if (!request.headers.hasOwnProperty('binding')) {
                        request.headers['binding'] = 'H';
                    }

                    db_sql.set_hit(request.db_connection, request.headers['binding'], (err, results) => {
                        results = null;
                    });

                    check_xm2m_headers(request, (code) => {
                        if (code === '200') {
                            get_target_url(request, response, (code) => {
                                if (code === '200') {
                                    if (request.option !== '/fopt') {
                                        var rootnm = Object.keys(request.targetObject)[0];
                                        request.url = request.targetObject[rootnm].ri;
                                        if ((request.query.fu == 1 || request.query.fu == 2) && (request.query.rcn == 1 || request.query.rcn == 4 || request.query.rcn == 5 || request.query.rcn == 6 || request.query.rcn == 7)) {
                                            lookup_retrieve(request, response, (code) => {
                                                if (code === '200') {
                                                    settle.result('200', '2000', '');
                                                }
                                                else if (code === '200-1') {
                                                    settle.search('200', '2000', '');
                                                }
                                                else {
                                                    settle.error(code);
                                                }
                                            });
                                        }
                                        else {
                                            settle.error('400-44');
                                        }
                                    }
                                    else { //if (request.option === '/fopt') {
                                        run_fanout(request, response, settle, (request.query.fu == 1) ? '32' : '2', false);
                                    }
                                }
                                else if (code === '301-1') {
                                    check_csr(request, response, (code) => {
                                        if (code === '301-2') {
                                            settle.raw('csr forward', function () {
                                                response.status(response.statusCode).end(response.body);
                                            });
                                        }
                                        else {
                                            settle.error(code);
                                        }
                                    });
                                }
                                else {
                                    settle.error(code);
                                }
                            });
                        }
                        else {
                            settle.error(code);
                        }
                    });
                }
                else if (code === '201') {
                    db.release(connection);
                    response.header('Content-Type', 'application/json');
                    response.status(200).end(JSON.stringify(result, null, 4));
                    result = null;
                }
                else {
                    settle.error(code);
                }
            });
        }
        else {
            // 커넥션을 못 빌린 경로다 — 반납할 것이 없어 null 을 넘긴다.
            make_settler(request, response, null).error(code);
        }
    });
});


app.put('*', onem2mParser, (request, response) => {
    db.getConnection((code, connection) => {
        if (code === '200') {
            request.db_connection = connection;
            var settle = make_settler(request, response, connection);

            if (!request.headers.hasOwnProperty('binding')) {
                request.headers['binding'] = 'H';
            }

            db_sql.set_hit(request.db_connection, request.headers['binding'], (err, results) => {
                results = null;
            });

            check_xm2m_headers(request, (code) => {
                if (code === '200') {
                    if (request.body !== "") {
                        check_resource_supported(request, response, (code) => {
                            if (code === '200') {
                                get_target_url(request, response, (code) => {
                                    if (code === '200') {
                                        if (request.option !== '/fopt') {
                                            parse_body_format(request, response, (code) => {
                                                if (code === '200') {
                                                    check_type_update_resource(request, (code) => {
                                                        if (code === '200') {
                                                            var rootnm = Object.keys(request.targetObject)[0];
                                                            request.url = request.targetObject[rootnm].ri;
                                                            if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1)) {
                                                                lookup_update(request, response, (code) => {
                                                                    if (code === '200') {
                                                                        settle.result('200', '2004', '');
                                                                    }
                                                                    else {
                                                                        settle.error(code);
                                                                    }
                                                                });
                                                            }
                                                            else {
                                                                settle.error('400-45');
                                                            }
                                                        }
                                                        else {
                                                            settle.error(code);
                                                        }
                                                    });
                                                }
                                                else {
                                                    settle.error(code);
                                                }
                                            });
                                        }
                                        else { // if (request.option === '/fopt') {
                                            run_fanout(request, response, settle, '4', true);
                                        }
                                    }
                                    else if (code === '301-1') {
                                        check_csr(request, response, (code) => {
                                            if (code === '301-2') {
                                                settle.raw('csr forward', function () {
                                                    response.status(response.statusCode).end(response.body);
                                                });
                                            }
                                            else {
                                                settle.error(code);
                                            }
                                        });
                                    }
                                    else {
                                        settle.error(code);
                                    }
                                });
                            }
                            else {
                                settle.error(code);
                            }
                        });
                    }
                    else {
                        settle.error('400-40');
                    }
                }
                else {
                    settle.error(code);
                }
            });
        }
        else {
            // 커넥션을 못 빌린 경로다 — 반납할 것이 없어 null 을 넘긴다.
            make_settler(request, response, null).error(code);
        }
    });
});

app.delete('*', onem2mParser, (request, response) => {
    db.getConnection((code, connection) => {
        if (code === '200') {
            request.db_connection = connection;
            var settle = make_settler(request, response, connection);

            if (!request.headers.hasOwnProperty('binding')) {
                request.headers['binding'] = 'H';
            }

            db_sql.set_hit(request.db_connection, request.headers['binding'], (err, results) => {
                results = null;
            });

            check_xm2m_headers(request, (code) => {
                if (code === '200') {
                    get_target_url(request, response, (code) => {
                        if (code === '200') {
                            if (request.option !== '/fopt') {
                                check_type_delete_resource(request, (code) => {
                                    if (code === '200') {
                                        var rootnm = Object.keys(request.targetObject)[0];
                                        request.url = request.targetObject[rootnm].ri;
                                        request.pi = request.targetObject[rootnm].pi;
                                        if ((request.query.fu == 2) && (request.query.rcn == 0 || request.query.rcn == 1)) {
                                            lookup_delete(request, response, (code) => {
                                                if (code === '200') {
                                                    settle.result('200', '2002', '');
                                                }
                                                else {
                                                    settle.error(code);
                                                }
                                            });
                                        }
                                        else {
                                            settle.error('400-46');
                                        }
                                    }
                                    else {
                                        settle.error(code);
                                    }
                                });
                            }
                            else { // if (request.option === '/fopt') {
                                run_fanout(request, response, settle, '8', false);
                            }
                        }
                        else if (code === '301-1') {
                            check_csr(request, response, (code) => {
                                if (code === '301-2') {
                                    settle.raw('csr forward', function () {
                                        response.status(response.statusCode).end(response.body);
                                    });
                                }
                                else {
                                    settle.error(code);
                                }
                            });
                        }
                        else {
                            settle.error(code);
                        }
                    });
                }
                else {
                    settle.error(code);
                }
            });
        }
        else {
            // 커넥션을 못 빌린 경로다 — 반납할 것이 없어 null 을 넘긴다.
            make_settler(request, response, null).error(code);
        }
    });
});

function check_notification(request, response, callback) {
    if (request.headers.hasOwnProperty('content-type')) {
        if (request.headers['content-type'].includes('ty')) { // post
            callback('post');
        }
        else {
            if (request.headers.rootnm == 'sgn') {
                callback('notify');
            }
            else {
                callback('400-19');
            }
        }
    }
    else {
        callback('400-20');
    }
}

/**
 * 상류(원격 CSE · AE)로 나가는 요청의 헤더를 다듬는다.
 *
 * 두 경로(check_ae_notify -> notify_http, check_csr -> forward_http)가
 * **클라이언트의 헤더를 그대로** 상류에 넘긴다. 거기에는 클라이언트의
 * Accept 도 들어 있다.
 *
 * 그런데 이 CSE 는 json 만 읽고 json 만 만든다 — xml/cbor 처리를 전부
 * 걷어냈다. 클라이언트가 `Accept: application/xml` 을 보냈다고 상류에
 * 그것을 그대로 물어보면, 돌아온 xml 을 우리가 다룰 방법이 없다.
 *
 * **우리가 감당할 수 있는 것을 묻는다.**
 */
// app.js 의 지역 함수였던 것을 mobius/outbound_headers.js 로 뺐다 —
// fopt.js 도 같은 규칙이 필요해서다. 머리말은 그 파일에 있다.
var outbound_headers = require('./mobius/outbound_headers');


/**
 * 상류 응답의 헤더를 우리 응답으로 옮긴다.
 *
 * ── Content-Type 만 다르게 다룬다 ───────────────────────────────────────
 * 예전에는 상류가 준 Content-Type 을 그대로 복사했다. 이 두 경로는
 * settle.raw 를 지나 responder.apply_headers 를 **우회**하므로, "응답은
 * 언제나 json" 이라는 선언이 여기서는 안 걸렸다. 상류가 xml 을 주면
 * 그것이 그대로 우리 응답으로 나갔다.
 *
 * 선택지가 셋이었다:
 *   그대로 복사   정직하지만 **우리가 xml 을 내보낸 것**이 된다
 *   json 이라 붙임 더 나쁘다 — 내용과 이름이 어긋난다
 *   흘려보내지 않음  <- 이것을 고른다
 *
 * 상류가 json 이 아닌 것을 주면 그 응답을 만들어 줄 방법이 없다. 끊는다.
 * 나가는 요청에 Accept: application/json 을 붙이므로 규격을 지키는 상류라면
 * 여기 걸리지 않는다. 걸리면 상류가 그것을 무시한 것이고, 그 사실이
 * 로그에 남아야 한다.
 *
 * @returns true 면 옮겼다. false 면 옮기지 않았고 호출자가 오류로 끝내야 한다.
 */
var RELAY_JSON_OK = /^(application|text)\/(.*\+)?json\b/;

function relay_headers(response, res, label) {
    var ct = res.headers['content-type'];

    if (ct) {
        var mime = String(ct).split(';')[0].trim().toLowerCase();
        if (!RELAY_JSON_OK.test(mime)) {
            console.error('[' + label + '] 상류가 json 이 아닌 것을 보냈다: ' + mime +
                          ' — 흘려보내지 않는다');
            return false;
        }
        response.header('Content-Type', ct);
    }
    // Content-Type 이 아예 없으면 본문도 없다고 보고 그대로 진행한다.
    // 있는데 형식이 안 맞는 경우만 끊는다.

    // 받는 이름은 소문자(node 가 그렇게 준다), 내보내는 이름은 표기 그대로.
    // 재조립하지 않고 표로 둔다 — HTTP 헤더는 대소문자를 안 가리지만,
    // 로그와 골든 하네스에 찍히는 이름이 예전과 달라지면 대조가 어긋난다.
    var RELAY = {
        'x-m2m-ri':         'X-M2M-RI',
        'x-m2m-rvi':        'X-M2M-RVI',
        'x-m2m-rsc':        'X-M2M-RSC',
        'content-location': 'Content-Location'
    };
    Object.keys(RELAY).forEach(function (k) {
        if (res.headers[k]) { response.header(RELAY[k], res.headers[k]); }
    });
    return true;
}

function check_ae_notify(request, response, callback) {
    // 이 콜백은 응답 전송과 커넥션 반납을 함께 한다. 두 번 불리면 워커가 죽는다.
    callback = once(callback, 'check_ae_notify');

    var ri = request.targetObject[Object.keys(request.targetObject)[0]].ri;
    console.log('[check_ae_notify] : ' + ri);
    // select_ae 의 시그니처는 (connection, ri, callback) 이다. connection 을 빠뜨려
    // 인자가 한 칸씩 밀리면서 callback 이 undefined 가 되어, 이 경로는 호출 즉시
    // TypeError 로 죽었다.
    db_sql.select_ae(request.db_connection, ri, (err, result_ae) => {
        if (!err) {
            if (result_ae.length == 1) {
                var poa_arr = poa_util.parse(result_ae[0].poa, '[check_ae_notify] ' + ri);
                if (poa_arr === null) {
                    callback('500-1');
                    return;
                }

                // poa 는 접속점 후보 목록이다. 예전에는 전부 순회하며 매번 콜백을
                // 불러, 2개 이상이면 두 번째 호출이 null 이 된 response 를 만졌다.
                // 이제 알림을 보낼 수 있는 첫 http poa 하나만 고른다.
                var chosen = null;
                var fallback = null;      // http 가 없을 때 돌려줄 사유
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = url.parse(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        chosen = poa;
                        break;
                    }
                    if (fallback === null) {
                        if (poa.protocol == 'coap:')      { fallback = '405-12'; }
                        else if (poa.protocol == 'mqtt:') { fallback = '405-10'; }
                        else if (poa.protocol == 'ws:')   { fallback = '405-11'; }
                        else                              { fallback = '400-47'; }
                    }
                }

                if (chosen === null) {
                    // poa 가 비어 있으면 예전에는 루프가 0회 돌아 콜백이 아예
                    // 불리지 않았다 — 요청이 매달리고 커넥션도 반납되지 않았다.
                    if (poa_arr.length === 0) {
                        console.log('[check_ae_notify] poa 가 비어 있어 알림을 보낼 곳이 없다: ' + ri);
                        callback('404-8');
                    }
                    else {
                        callback(fallback);
                    }
                    return;
                }

                console.log('send notification to ' + chosen.href);
                // 클라이언트의 헤더를 그대로 넘기되 Accept 만 바꾼다 —
                // 우리가 다룰 수 있는 것을 물어야 한다. outbound_headers 참조.
                notify_http(chosen.hostname, chosen.port, chosen.path, request.method, outbound_headers(request.headers), request.body, (code, res) => {
                    callback(code, res);
                });
            }
            else {
                callback('404-6');
            }
        }
        else {
            // db 계층은 에러일 때 callback(true, err) 로 부른다 — 에러 객체는 두 번째다
            console.log('[check_ae_notify] query error: ' + result_ae.message);
            callback('500-1');
        }
    });
}

function check_csr(request, response, callback) {
    // 이 콜백은 응답 전송과 커넥션 반납을 함께 하고, 그 뒤 request/response 를
    // null 로 비운다. 두 번 불리면 워커가 죽는다. 원인은 아래에서 없앴지만,
    // 다시 생겨도 워커까지 가지 않게 한 번만 통과시킨다.
    callback = once(callback, 'check_csr');

    var ri = util.format('/%s/%s', usecsebase, url.parse(request.absolute_url).pathname.split('/')[1]);
    console.log('[check_csr] : ' + ri);
    db_sql.select_csr(request.db_connection, ri, (err, result_csr) => {
        if (!err) {
            if (result_csr.length == 1) {
                var point = {};
                point.forwardcbname = result_csr[0].cb.replace('/', '');

                // poa 는 DB 에 저장된 값이다. 깨져 있으면 여기서 던져 워커가 죽었다.
                var poa_arr = poa_util.parse(result_csr[0].poa, '[check_csr] ' + ri);
                if (poa_arr === null) {
                    result_csr = null;
                    callback('500-1');
                    return;
                }

                // poa 는 접속점 후보 목록이다. 예전에는 전부 순회하며 매번 콜백을
                // 불러, 2개 이상이면 두 번째 호출이 null 이 된 response 를 만졌다.
                // 이제 쓸 수 있는 첫 http poa 하나만 고른다.
                var chosen = null;
                var saw_mqtt = false;
                for (var i = 0; i < poa_arr.length; i++) {
                    var poa = url.parse(poa_arr[i]);
                    if (poa.protocol == 'http:') {
                        chosen = poa;
                        break;
                    }
                    else if (poa.protocol == 'mqtt:') {
                        saw_mqtt = true;
                    }
                }

                if (chosen === null) {
                    // poa 가 비어 있으면 예전에는 루프가 0회 돌아 콜백이 아예
                    // 불리지 않았다 — 요청이 매달리고 커넥션도 반납되지 않았다.
                    // poa 는 미지정 시 [] 가 기본값이라 드문 상황이 아니었다.
                    var why;
                    if (poa_arr.length === 0) {
                        console.log('[check_csr] poa 가 비어 있어 포워딩할 곳이 없다: ' + ri);
                        why = '301-5';
                    }
                    else if (saw_mqtt) {
                        console.log('forwarding with mqtt is not supported');
                        why = '301-3';
                    }
                    else {
                        console.log('protocol in poa of csr is not supported');
                        why = '301-4';
                    }
                    result_csr = null;
                    callback(why);
                    return;
                }

                point.forwardcbhost = chosen.hostname;
                point.forwardcbport = chosen.port;
                result_csr = null;

                console.log('csebase forwarding to ' + point.forwardcbname);

                // Accept 를 json 으로 바꿔 보낸다. outbound_headers 참조.
                forward_http(point.forwardcbhost, point.forwardcbport, request.url, request.method, outbound_headers(request.headers), request.body, (code, _res) => {
                    if (code === '200') {
                        // 예전에는 JSON.parse(JSON.stringify(_res)) 였다. _res 는
                        // http.IncomingMessage 이고 socket -> _httpMessage -> agent 로
                        // 자기 자신에게 돌아오는 순환 참조를 갖는다. 그래서 stringify 가
                        // *언제나* TypeError 를 던졌고, 원격이 정상 응답할 때마다
                        // 워커가 죽었다 — 포워딩 성공 경로는 한 번도 동작한 적이 없다.
                        //
                        //   TypeError: Converting circular structure to JSON
                        //       --> starting at object with constructor 'Socket'
                        //
                        // 쓰는 것은 헤더 몇 개와 body, statusCode 뿐이라 그것만 옮긴다.
                        var res = {
                            headers: _res.headers || {},
                            body: _res.body,
                            statusCode: _res.statusCode
                        };
                        _res = null;

                        // 상류가 json 이 아닌 것을 주면 흘려보내지 않는다.
                        // 이 경로는 settle.raw 로 응답을 직접 내보내므로
                        // responder.apply_headers 를 거치지 않는다 — "응답은
                        // 언제나 json" 이 여기서는 안 걸린다.
                        if (!relay_headers(response, res, 'csr forward')) {
                            callback('500-7');
                            return;
                        }

                        response.body = res.body;
                        response.statusCode = res.statusCode;

                        callback('301-2');
                    }
                    else {
                        callback(code);
                    }
                });
            }
            else {
                result_csr = null;
                callback('404-3');
            }
        }
        else {
            // db_action.getResult 는 에러일 때 callback(true, err) 로 부른다.
            // 즉 에러 객체는 두 번째 인자에 온다. 시그니처를 그대로 둔다.
            console.log('[check_csr] query error: ' + result_csr.message);
            callback('404-3');
        }
    });
}


function notify_http(hostname, port, path, method, headers, bodyString, callback) {
    var options = {
        hostname: hostname,
        port: port,
        path: path,
        method: method,
        headers: headers
    };

    var req = http.request(options, (res) => {
        // ── 결함 둘을 함께 고친다 ──────────────────────────────────────
        //
        // (1) 모은 본문을 **아무 데도 넣지 않았다.**
        //     여기서 callback('200', res) 로 넘긴 res 의 .body 를
        //     app.js 의 check_ae_notify 콜백이 `response.send(res.body)` 로
        //     원 요청자에게 내보낸다(2116 부근). 그런데 res.body 는 여기서
        //     세워진 적이 없다 — 언제나 undefined 였다.
        //     Express 의 send(undefined) 는 content-length: 0 을 보낸다.
        //     즉 **AE 알림 응답의 본문이 통째로 사라지고 있었다.**
        //     쌍둥이인 forward_http 는 res.body = fullBody 를 한다.
        //
        // (2) 조각마다 따로 디코드해서 멀티바이트가 깨졌다.
        //     mobius/body.js 의 read() 가 다 모은 뒤 한 번만 디코드한다.
        //
        // 본문을 통째로 로그에 찍던 것도 걷어냈다. CLAUDE.md 가 금지한다 —
        // 요청마다 응답 본문을 덤프하면 운영 로그가 밀려 장애 분석이 안 된다.
        // 상태코드와 길이만 남긴다. 진단에 필요한 것은 그것으로 충분하다.
        body.read(res, (err, fullBody) => {
            if (err) {
                console.error('[notify_http] 알림 응답을 받지 못했다: ' + err.message);
                callback('404-7');
                return;
            }
            res.body = fullBody;
            console.log('[notify_http] ' + res.statusCode + '  ' + fullBody.length + '자');
            callback('200', res);
        });
    });

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'ae notify');
    req.on('error', (e) => {
        console.log('[forward_http] problem with request: ' + e.message);

        callback('404-7');
    });

    // 본문을 통째로 찍던 것을 걷어냈다. 앞서 이 함수의 **응답** 쪽은 고쳤는데
    // 나가는 쪽을 놓쳤다. 같은 이유다 — 요청마다 본문을 덤프하면 운영 로그가
    // 밀려 장애 분석이 불가능해진다(CLAUDE.md).
    console.log('[notify_http] -----> ' + method + ' ' + path +
                '  ' + (bodyString ? bodyString.length : 0) + '자');

    // write data to request body
    if ((method.toLowerCase() == 'get') || (method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(bodyString);
    }
    req.end();
}

function forward_http(forwardcbhost, forwardcbport, f_url, f_method, f_headers, f_body, callback) {
    var options = {
        hostname: forwardcbhost,
        port: forwardcbport,
        path: f_url,
        method: f_method,
        headers: f_headers
    };

    var req = http.request(options, (res) => {
        body.read(res, (err, fullBody) => {
            if (err) {
                console.error('[forward_http] 원격 응답을 받지 못했다: ' + err.message);
                callback('404-7');
                return;
            }
            res.body = fullBody;

            // 예전에는 여기서 res.headers 객체와 res.body 를 통째로 찍었다.
            // 두 가지가 문제였다:
            //
            //   본문 덤프  CLAUDE.md 가 금지한다 — 요청마다 응답 본문을 찍으면
            //              운영 로그가 밀려 장애 분석이 불가능해진다
            //   헤더 덤프  X-M2M-Origin 이 그대로 남는다. 그 값이
            //              수퍼유저(모든 ACP 를 건너뛰는 마스터 키)일 수 있다
            //
            // 진단에 필요한 것만 남긴다.
            console.log('[forward_http] ' + res.statusCode + '  ' + fullBody.length + '자  ' + f_url);

            callback('200', res);
        });
    });

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'csr forward');
    req.on('error', (e) => {
        console.log('[forward_http] problem with request: ' + e.message);

        callback('404-3');
    });

    // 셋 다 걷어냈다. 본문 덤프는 위와 같은 이유이고, `console.log(f_headers)`
    // 는 더 나쁘다 — 그 안에 **X-M2M-Origin 이 평문으로 남는다.** 그 값이
    // 수퍼유저(모든 ACP 검사를 건너뛰는 마스터 키)일 수 있다.
    //
    // 이 함수의 **응답** 쪽 헤더 덤프는 앞서 같은 이유로 걷어냈는데
    // 나가는 쪽을 놓쳤다.
    console.log('[forward_http] -----> ' + f_method + ' ' + f_url +
                '  ' + (f_body ? f_body.length : 0) + '자');

    // write data to request body
    if ((f_method.toLowerCase() == 'get') || (f_method.toLowerCase() == 'delete')) {
        req.write('');
    }
    else {
        req.write(f_body);
    }
    req.end();
}

if (process.env.NODE_ENV == 'production') {
    console.log("Production Mode");
}
else if (process.env.NODE_ENV == 'development') {
    console.log("Development Mode");
}

function scheduleGc() {
    if (!global.gc) {
        console.log('Garbage collection is not exposed');
        return;
    }

    // schedule next gc within a random interval (e.g. 15-45 minutes)
    // tweak this based on your app's memory usage
    var nextMinutes = Math.random() * 30 + 15;

    setTimeout(() => {
        global.gc();
        console.log('Manual gc', process.memoryUsage());
        scheduleGc();
    }, nextMinutes * 60 * 1000);
}

// call this in the startup script of your app (once per process)
scheduleGc();
