'use strict';
/**
 * 팬아웃(fanOutPoint) 멤버 요청 — 상한 있는 병렬. 남은 일 §5.2 (2026-09-05).
 *
 * ── 왜 따로 파일인가
 *   fopt.js 는 resource.js 를 통해 sgn_man 까지 끌어와 require 만으로 MQTT 클라이언트가
 *   열린다. 여기는 DB 와 전역을 모른다 — body · outbound_headers · outbound · once 만
 *   쓴다. 그래서 시험이 실물 HTTP 멤버 서버로 돈다(test/fopt-parallel.test.js).
 *
 * ── 옛 모양과 무엇이 다른가
 *   fopt_member 가 멤버 하나의 응답을 받은 뒤 다음 멤버로 가는 직렬 재귀였다. 멤버마다
 *   arm(기본 10초)이 새로 시작해 최악 대기가 N x 10초였다. 지금은 동시에 MAX_INFLIGHT 개를
 *   띄우고 하나가 끝나면 다음을 띄운다 — 최악 ceil(N / MAX_INFLIGHT) x 10초.
 *
 *   멤버마다 하던 get_ri_sri 조회는 없다. fopt.check 가 목록을 앞에서 한 번(whereIn)에 푼다.
 *
 * ── 응답 모양은 그대로
 *   결과를 멤버 순서 배열에 받아 두었다가 전부 끝난 뒤 agr 에 mid 순서로 넣는다. 완료
 *   순서가 뒤바뀌어도 응답 본문의 키 순서는 직렬일 때와 같다 — 골든이 그것을 본다.
 *
 * ── 실패 방침은 그대로
 *   멤버 하나의 타임아웃 · 비JSON · 연결 실패는 그 멤버만 빠진다. 경로를 모르는 원격 CSE
 *   멤버는 요청 없이 건너뛴다. 멤버 하나의 실패가 그룹 전체를 막지 않는다.
 */
var url = require('url');
var http = require('http');

var body = require('./body');
var outbound_headers = require('./outbound_headers');
var outbound = require('./outbound');
var once = require('./once');

// 동시에 나가는 멤버 요청 상한. 멤버는 대개 이 CSE 자신(localhost)이라 동시 N 개가 곧
// 이 클러스터의 워커 N 개 · DB 커넥션 N 개다 — 요청 하나가 그 이상 잡지 못하게 한다.
// 배포 실측(2026-09-05): 그룹 5개, 최대 멤버 4 — 전부 이 값 아래라 완전 병렬이다.
// mnm 밖에 멤버 수 상한이 없으므로 1,000개짜리 그룹이 생겨도 8 개씩 간다.
// conf 키로 빼지 않았다 — 조정할 근거(큰 그룹의 실측)가 생기면 그때 뺀다.
var MAX_INFLIGHT = 8;

/**
 * ri 목록을 보낼 곳으로 푼다.
 *
 *   이 CSE 의 리소스   → { ri, hostname: 'localhost', port: self.port }
 *   아는 원격 CSE     → csr 의 poa(cse_poa) 에서 hostname · port
 *   모르는 원격 CSE   → { ri, hostname: null, port: null }  — run 이 요청 없이 건너뛴다
 *
 * @param {string[]} ri_list   내부형으로 접고 sri 를 푼 뒤의 목록
 * @param {object}   cse_poa   update_route 가 채운 { cse명: poa URL }
 * @param {object}   self      { cb: usecsebase, port: usecsebaseport }
 */
exports.route = function (ri_list, cse_poa, self) {
    return ri_list.map(function (ri) {
        var target_cb = ri.split('/')[1];
        if (target_cb == self.cb) {
            return { ri: ri, hostname: 'localhost', port: self.port };
        }
        if (cse_poa[target_cb]) {
            var u = url.parse(cse_poa[target_cb]);
            return { ri: ri, hostname: u.hostname, port: u.port };
        }
        return { ri: ri, hostname: null, port: null };
    });
};

function check_body(res, res_body, callback) {
    var retrieve_Obj = {};

    // 멤버가 준 응답 본문이다. JSON 이 아닐 수 있다 — 앞단 프록시의 HTML
    // 오류 페이지, 빈 본문, 잘린 응답 등. 여기는 res.on('end') 안이라
    // 던지면 잡을 곳이 없어 uncaught exception 이 되고 워커가 죽는다.
    var result;
    try {
        result = JSON.parse(res_body);
    }
    catch (e) {
        console.error('[fopt check_body] 멤버 응답이 JSON 이 아니다 (' + res.req.path + '): ' + e.message);
        callback('0');
        return '0';
    }

    if(res.req.path.charAt(0) == '/') {
        retrieve_Obj.fr = res.req.path.replace('/', '');
    }
    else {
        retrieve_Obj.fr = res.req.path;
    }

    if(res.headers.hasOwnProperty('x-m2m-rsc')) {
        retrieve_Obj.rsc = res.headers['x-m2m-rsc'];
    }

    if(res.headers.hasOwnProperty('x-m2m-ri')) {
        retrieve_Obj.rqi = res.headers['x-m2m-ri'];
    }

    if(res.headers.hasOwnProperty('x-m2m-rvi')) {
        retrieve_Obj.rvi = res.headers['x-m2m-rvi'];
    }

    retrieve_Obj.pc = result;
    callback('1', retrieve_Obj);
    return '1';
}

// 멤버 하나에 요청을 보낸다. 콜백은 결과 객체({fr, rsc, rqi, rvi, pc}) 또는 제외면 null.
function request_to_member(request, target, callback) {
    // 이 콜백은 응답 경로(body.read)와 에러 경로(req.on('error')) 양쪽에서
    // 불릴 수 있다. 두 번 불리면 inflight 계수가 어긋나 다음 멤버가 두 개 나가거나
    // 최종 콜백이 두 번 나간다.
    callback = once(callback, 'fanout request_to_member ' + target.ri);

    var ri_prefix = request.url.split('/fopt')[1];

    var options = {
        hostname: target.hostname,
        port: target.port,
        path: target.ri + ri_prefix,
        method: request.method,
        // 클라이언트의 Accept 를 원격 멤버에게 그대로 묻지 않는다.
        // 규격을 지키는 상대가 그것을 존중해 XML 을 주면 check_body 의
        // JSON.parse 가 실패하고, 그 멤버는 로그 한 줄만 남기고 집계에서
        // **조용히 빠진다.** 받는 쪽은 멤버가 빠진 것을 알 수 없다.
        headers: outbound_headers(request.headers)
    };

    var req = http.request(options, function (res) {
        // 예전에는 여기서 `responseBody += chunk` 로 모았고, 바로 위의
        // `//res.setEncoding('utf8');` 는 **주석 처리되어 있었다.**
        // 그래서 조각마다 따로 디코드되어 멤버 응답의 한글이 깨졌다.
        //
        // 실측 재현 — 멤버가 보낸 con 이 "온도 25도, 습도 60%" 일 때:
        //     JSON.parse : 성공
        //     con        : "���도 25도, 습도 60%"
        //
        // **파싱이 성공한다**는 것이 고약하다. U+FFFD 는 JSON 문자열로 멀쩡하니
        // 에러가 나지 않고, 틀린 값이 그대로 집계(agr)에 들어간다.
        // 팬아웃 결과를 받는 쪽은 무엇이 틀렸는지 알 방법이 없다.
        body.read(res, function (err, responseBody) {
            if (err) {
                // 상한 초과·중간 끊김·스트림 오류. 멤버 하나의 실패가 그룹
                // 전체를 막지 않는다는 방침을 그대로 따른다.
                console.error('[fopt_member] 멤버 응답을 받지 못해 결과에서 제외한다: ' +
                              target.ri + ' — ' + err.message);
                callback(null);
                return;
            }
            check_body(res, responseBody, function (rsc, retrieve_Obj) {
                if (rsc == '1') {
                    callback(retrieve_Obj);
                    return;
                }
                // 예전에는 else 가 없었다. 멤버 응답을 파싱하지 못하면
                // 콜백이 사라져 팬아웃 사슬 전체가 멈추고, 요청은 매달린 채
                // DB 커넥션도 반납되지 않았다.
                // 이 멤버의 결과만 빼고 나머지 멤버로 계속 간다 — 에러 핸들러와
                // 같은 방침이다(멤버 하나의 실패가 그룹 전체를 막지 않는다).
                console.error('[fopt_member] 멤버 응답을 읽지 못해 결과에서 제외한다: ' + target.ri);
                callback(null);
            });
        });
    });

    // 응답이 오지 않으면 요청을 끊는다. 파기하면 아래 error 핸들러가 뒷정리를 한다.
    outbound.arm(req, 'fopt member');
    req.on('error', function (e) {
        if (e.message != 'read ECONNRESET') {
            console.log('[fopt_member] problem with request: ' + e.message);
        }

        callback(null);
    });

    req.write(request.body);
    req.end();
}

/**
 * 멤버 전부에 요청을 보내고 집계를 돌려준다.
 *
 * @param {object}   request   원 요청 — url(/fopt 뒤 접미) · method · headers · body 를 쓴다
 * @param {object[]} targets   route() 의 결과. 순서가 응답의 키 순서다
 * @param {function} callback  callback(agr) — { [fr]: {fr, rsc, rqi, rvi, pc} }, 실패 멤버는 없다
 */
exports.run = function (request, targets, callback) {
    callback = once(callback, 'fanout.run');

    var results = new Array(targets.length);   // 멤버 순서대로. 제외된 멤버는 null
    var next = 0;                               // 다음에 띄울 멤버
    var inflight = 0;                           // 지금 나가 있는 요청 수

    function finish() {
        var agr = {};
        for (var i = 0; i < results.length; i++) {
            if (results[i]) {
                agr[results[i].fr] = results[i];
            }
        }
        callback(agr);
    }

    function settle(i) {
        return function (retrieve_Obj) {
            results[i] = retrieve_Obj || null;
            inflight--;
            launch();
        };
    }

    function launch() {
        while (next < targets.length && inflight < MAX_INFLIGHT) {
            var i = next++;
            var target = targets[i];
            if (!target.hostname) {
                console.log('[fanout] 경로를 모르는 원격 CSE 멤버라 건너뛴다: ' + target.ri);
                results[i] = null;
                continue;
            }
            inflight++;
            request_to_member(request, target, settle(i));
        }
        if (inflight === 0 && next >= targets.length) {
            finish();
        }
    }

    launch();
};

exports.MAX_INFLIGHT = MAX_INFLIGHT;
