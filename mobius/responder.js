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
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

// require 가 이것 하나뿐이다. 아래 열 개를 걷어냈다:
//   url util merge xml2js xmlbuilder js2xmlparser cbor coap outbound
// 전부 XML 직렬화 구간이 쓰던 것이거나 처음부터 안 쓰던 것이다.
// (url 은 6회 나오지만 전부 `request.url` 속성이지 모듈 사용이 아니었다)
//
// ── 이 줄은 이름이 안 쓰여도 지우면 안 된다 ─────────────────────────────
// db_sql 이라는 **이름**은 이 파일 어디에도 안 나온다. 그래도 남긴다 —
// require 자체에 부수효과가 있다. sql_action.js 가 로드되면서
// `global.getType` 을 설치하고, 이 파일의 typeCheckAction 이 그것을 부른다.
//
// 이 줄을 지우면 test/db-value-robustness.test.js 가 깨진다. 그 테스트는
// responder 만 require 하고 sql_action 을 직접 부르지 않는다.
// 운영에서는 app.js 가 sql_action 을 따로 require 해서 살아남지만,
// 그것은 우연한 로드 순서에 기대는 것이다.
var db_sql = require('./sql_action');


var _this = this;





var shape = require('./shape');

// 리소스 타입 표는 shape.js 로 갔다. 여기서 그대로 다시 export 한다 —
// app.js·admin/server.js·resource.js·sql_action.js 가 `responder.typeRsrc`
// 로 부르고 있어서, 그 호출부를 한 줄도 안 고치기 위해서다.
var typeRsrc = shape.typeRsrc;
var mgoType = shape.mgoType;

exports.typeRsrc = typeRsrc;
exports.mgoType = mgoType;

/**
 * 응답 헤더를 세우고 이 응답의 직렬화 형식을 정한다.
 *
 * 이 일을 하는 코드가 다섯 벌 있었다 — response_result 의 진입부와 그 안의
 * rt=3 분기, response_rcn3_result, search_result, sendError. 복붙으로 늘어난
 * 것인데 이미 세 갈래로 갈려 있었다.
 *
 *   Accept 에코        response_result / sendError 만 했다. discovery 와
 *                      rcn=3 은 안 했다. 같은 서버가 요청 경로에 따라 다르게
 *                      답하고 있었다.
 *   Accept 없을 때     response_result / sendError 는 Content-Type 을 아예
 *                      안 세웠고, 나머지 셋은 json 으로 명시했다.
 *   헤더 이름          'X-M2M-RI' 리터럴, chk 소문자, chk.toUpperCase() 세 가지.
 *                      전선에서는 같지만 소스가 셋으로 갈려 있었다.
 *
 * ── Accept 에코를 없앤 이유 ─────────────────────────────────────────
 * Accept 는 HTTP 의 **요청** 헤더다. 응답에 되돌려주라는 조항이 oneM2M HTTP
 * 바인딩에도 없다. 다섯 중 둘만 하고 있었으니 어느 쪽이든 통일해야 했고,
 * 규격에 없는 쪽을 뺐다.
 *
 * ── 응답은 언제나 json 이다. Accept 를 보지 않는다 ─────────────────
 * 이 CSE 는 json 만 만든다. 그러니 무엇을 요구받든 json 으로 답한다.
 *
 * 예전에는 `accept.includes('xml')` 로 형식을 정했는데, 부분 문자열 검사라
 * 두 가지가 어긋나 있었다. 실측한 그대로다:
 *
 *   Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*&#47;*;q=0.8
 *     -> XML. **브라우저로 Mobius 를 열면 XML 이 나왔다.**
 *             application/xhtml+xml 의 'xml' 에 걸린 것이다.
 *   Accept: application/json, application/xml
 *     -> XML. json 을 먼저 적었는데도 그렇다. 순서도 q값도 보지 않았다.
 *   Accept: application/cbor
 *     -> 헤더는 application/cbor 인데 본문은 JSON 이었다.
 *
 * 이것을 "Accept 를 제대로 파싱한다" 로 고칠 수도 있었지만, json 만 만드는
 * 서버에는 협상할 것이 없다. 분기를 지우는 쪽이 같은 결과를 더 적은 코드로
 * 낸다. 클라이언트가 xml 을 요구해도 json 을 준다 — 물어봤을 뿐이고 우리는
 * 그것을 만들지 않는다.
 *
 * 요청 **본문**이 xml/cbor 인 것은 다른 이야기다. 그쪽은 보낸 사람이 명확히
 * 정한 것이므로 진입 관문에서 400 으로 거절한다.
 *
 * Content-Type 은 언제나 명시한다. 예전에 sendError 는 안 세워서 JSON 본문을
 * Content-Type 없이 내보내고 있었다.
 */
function apply_headers(request, response, rsc) {
    var h = request.headers || {};

    if (h.hasOwnProperty('x-m2m-ri'))  { response.header('X-M2M-RI',  h['x-m2m-ri']); }
    if (h.hasOwnProperty('x-m2m-rvi')) { response.header('X-M2M-RVI', h['x-m2m-rvi']); }
    if (h.hasOwnProperty('locale'))    { response.header('Locale',    h['locale']); }

    // 여기 `request.usebodytype = 'json'` 이 있었다. **지웠다** (2026-09-03).
    // 응답을 만드는 함수가 **요청** 객체를 고칠 이유가 없었고, 그 값을 읽는
    // 코드도 없었다. 형식은 아래 Content-Type 한 줄로 정해진다.
    response.header('Content-Type', 'application/json');
    response.header('X-M2M-RSC', rsc);
}

/**
 * 배열이어야 하는 컬럼 값을 배열로 읽는다. 절대 던지지 않는다.
 *
 * 응답을 만드는 도중이라 여기서 예외가 나면 응답 전송도 커넥션 반납도 못 한다.
 * 깨진 행 하나가 그 리소스를 읽는 모든 요청을 죽이는 크래시 루프가 된다.
 *
 * 읽을 수 없으면 빈 배열로 둔다 — resource.js 의 makeObject 가 null/'' 을
 * '[]' 로 채우는 것과 같은 방침이다.
 */
function parse_db_array(raw, attr) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (raw == null || raw === '') {
        return [];
    }
    var parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        console.error('[typeCheckAction] ' + attr + ' 를 배열로 읽을 수 없다: ' + e.message);
        return [];
    }
    if (!Array.isArray(parsed)) {
        console.error('[typeCheckAction] ' + attr + ' 가 배열이 아니다');
        return parsed == null ? [] : [].concat(parsed);
    }
    return parsed;
}

function typeCheckAction(index1, body_Obj) {
    for (var index2 in body_Obj) {
        if(body_Obj.hasOwnProperty(index2)) {
            if (body_Obj[index2] == null || body_Obj[index2] == '' || body_Obj[index2] == 'undefined' || body_Obj[index2] == '[]' || body_Obj[index2] == '\"\"') {
                //delete body_Obj[index2];
                if(index2 == 'pi') {
                }
                else if(index2 == 'pv') {
                }
                else {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'subl') {
                delete body_Obj[index2];
            }
            else if (index2 == 'et') {
                if (index1 == 'm2m:cb') {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'cr') {
                if (index1 == 'm2m:ae' || index1 == 'm2m:csr') {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'acp' || index2 == 'cst' || index2 == 'los' || index2 == 'mt' || index2 == 'csy' || index2 == 'nct' ||
                index2 == 'cs' || index2 == 'st' || index2 == 'ty' || index2 == 'cbs' || index2 == 'cni' || index2 == 'mni' ||
                index2 == 'cnm' || index2 == 'mia' || index2 == 'mbs' || index2 == 'mgd' || index2 == 'btl' || index2 == 'bts' ||
                index2 == 'mnm' || index2 == 'exc' || index2 == 'rs' || index2 == 'ors') {

                if ((index1 == 'm2m:cb' || index1 == 'm2m:cin' || index1 == 'm2m:nod' || index1 == 'm2m:ae' || index1 == 'm2m:sub' || index1 == 'm2m:acp' ||
                        index1 == 'm2m:csr' || index1 == 'm2m:grp' || index1 == 'm2m:fwr' || index1 == 'm2m:bat' || index1 == 'm2m:dvi' || index1 == 'm2m:dvc' ||
                        index1 == 'm2m:rbo' || index1 == 'm2m:smd') &&
                    index2 == 'mni') {
                    delete body_Obj[index2];
                }
                else if ((index1 == 'm2m:cb' || index1 == 'm2m:csr' || index1 == 'm2m:ae' || index1 == 'm2m:acp' || index1 == 'm2m:grp' || index1 == 'm2m:sub' ||
                        index1 == 'm2m:nod' || index1 == 'm2m:fwr' || index1 == 'm2m:bat' || index1 == 'm2m:dvi' || index1 == 'm2m:dvc' || index1 == 'm2m:rbo' ||
                        index1 == 'm2m:smd') &&
                    index2 == 'st') {
                    delete body_Obj[index2];
                }
                else if ((index1 == 'm2m:acp') && index2 == 'acpi') {
                    delete body_Obj[index2];
                }
                else {
                    body_Obj[index2] = parseInt(body_Obj[index2]);
                }
            }
            else if (index2 == 'lvl' || index2 == 'colSn' || index2 == 'red' || index2 == 'green' || index2 == 'blue' || index2 == 'brigs' ||
                index2 == 'lock' || index2 == 'powerSe' || index2 == 'sus' || index2 == 'curT0') {
                if(index1 == 'm2m:fcnt') {
                    delete body_Obj[index2];
                }
                else if(index1 == 'hd:dooLk') {
                    if(index2 == 'lock') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:bat') {
                    if(index2 == 'lvl') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:tempe') {
                    if(index2 == 'curT0') {
                        body_Obj[index2] = parseFloat(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:binSh') {
                    if(index2 == 'powerSe') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:fauDn') {
                    if(index2 == 'sus') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:colSn') {
                    if(index2 == 'colSn') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:color') {
                    if(index2 == 'red' || index2 == 'green' || index2 == 'blue') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:brigs') {
                    if(index2 == 'brigs') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
            }
            else if (index2 == 'srv' || index2 == 'aa' || index2 == 'at' || index2 == 'poa' || index2 == 'lbl' || index2 == 'acpi' || index2 == 'srt' || index2 == 'nu' || index2 == 'mid' || index2 == 'macp') {
                if (!Array.isArray(body_Obj[index2])) {
                    // 여기 오는 값은 이미 한 번 파싱에 실패한 것이다.
                    // resource.js 의 makeObject 가 같은 컬럼을 try/catch 로 파싱하는데,
                    // 실패하면 로그만 찍고 깨진 원본 문자열을 그대로 남긴다.
                    // 그래서 이 두 번째 파싱은 "성공할 값은 안 오고 던질 값만 오는" 자리다.
                    //
                    // 응답 직렬화 도중이라 여기서 던지면 응답도 커넥션 반납도 못 하고
                    // 워커가 죽는다. 깨진 행 하나가 그 리소스를 읽는 모든 요청을
                    // 죽이는 크래시 루프가 된다.
                    body_Obj[index2] = parse_db_array(body_Obj[index2], index2);
                }

                if (index2 == 'srt') {
                    for (index3 in body_Obj[index2]) {
                        if (body_Obj[index2].hasOwnProperty(index3)) {
                            body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                        }
                    }
                }
                else if (index2 == 'mid') {
                    if(body_Obj[index2].length > 0) {
                        for(var idx in body_Obj[index2]) {
                            if(body_Obj[index2].hasOwnProperty(idx)) {
                                body_Obj[index2][idx] = body_Obj[index2][idx].replace(usespid + usecseid + '/', '/'); // absolute
                                body_Obj[index2][idx] = body_Obj[index2][idx].replace(usecseid + '/', '/'); // SP

                                // if(body_Obj[index2][idx].charAt(0) != '/') {
                                //     body_Obj[index2][idx] = '/' + body_Obj[index2][idx];
                                // }

                                if(body_Obj[index2][idx].charAt(0) == '/') {
                                    body_Obj[index2][idx] = body_Obj[index2][idx].replace('/', '');
                                }
                            }
                        }
                    }
                }
            }
            else if (index2 == 'enc') {
                if (Object.keys(body_Obj[index2])[0] != 'net') {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
                }

                for (var index3 in body_Obj[index2]) {
                    if (body_Obj[index2].hasOwnProperty(index3)) {
                        if(index3 == 'net') {
                            for (var index4 in body_Obj[index2][index3]) {
                                if (body_Obj[index2][index3].hasOwnProperty(index4)) {
                                    body_Obj[index2][index3][index4] = parseInt(body_Obj[index2][index3][index4]);
                                }
                            }
                        }
                    }
                }
            }
            else if (index2 == 'bn') {
                if(Object.keys(body_Obj[index2]).length == 0) {
                    delete body_Obj[index2];
                }
                else {
                    for (var index3 in body_Obj[index2]) {
                        if (body_Obj[index2].hasOwnProperty(index3)) {
                            if(index3 == 'num') {
                                body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                            }
                        }
                    }
                }
            }
            else if (index2 == 'cas' || index2 == 'uds') {
                for (var index3 in body_Obj[index2]) {
                    if (body_Obj[index2].hasOwnProperty(index3)) {
                        if(index3 == 'sus') {
                            body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                        }
                    }
                }
            }
            else if (index2 == 'rr' || index2 == 'mtv' || index2 == 'ud' || index2 == 'att' || index2 == 'cus' || index2 == 'ena' || index2 == 'dis' || index2 == 'rbo' ||
                index2 == 'far' || index2 == 'disr') {
                body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
            }
            else if (index2 == 'sri') {
                body_Obj.ri = body_Obj[index2];
                delete body_Obj[index2];
            }
            else if (index2 == 'spi') {
                body_Obj.pi = body_Obj[index2];
                delete body_Obj[index2];
            }
            else if (index2 == 'pv' || index2 == 'pvs') {
                // 가드가 뒤집혀 있었다. getType 은 문자열이 객체로 파싱되면
                // 'string_object' 를, *파싱에 실패하면* 'string' 을 돌려준다.
                // 그래서 === 'string' 조건은 정상적으로 저장된 pv 를 걸러내고
                // (원래 의도한 파싱은 영영 일어나지 않았다) 파싱 불가능한 값만
                // JSON.parse 로 넘겼다 — 반드시 던지는 자리였다.
                //
                // makeObject 가 이미 pv/pvs 를 파싱하므로 정상 값은 여기 오면
                // 객체다. 문자열로 남아 있다는 것은 그때 실패했다는 뜻이다.
                // 빈 객체로 바꿔치면 없는 권한을 지어내는 셈이라, 원본을 그대로
                // 두고 로그만 남긴다 — 운영자가 깨진 행을 알아볼 수 있어야 한다.
                if (getType(body_Obj[index2]) === 'string_object') {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
                }
                else if (typeof body_Obj[index2] === 'string') {
                    console.error('[typeCheckAction] ' + index2 + ' 를 읽을 수 없어 원본 그대로 내보낸다');
                }
            }
        }
    }
}

// ── 여기 있던 XML 직렬화 514줄을 걷어냈다 (2026-08-31) ─────────────────
//
//     xmlInsert / xmlInsertAfter / xmlInsertList / xmlAction
//     convertXml / convertXml2 / convertXmlMqtt / convertXmlSgn
//
// 이 CSE 는 json 만 만든다. 관문 셋(HTTP Content-Type · WS 서브프로토콜 ·
// MQTT 토픽)이 xml/cbor 요청을 막고, apply_headers 가 모든 응답을 json 으로
// 고정하며, sgn.js 가 알림 형식에 json 리터럴을 넘긴다.
//
// 유일한 외부 호출처였던 pxy_mqtt 의 xml 분기는 앞 커밋에서 함께 지웠다.
//
// **바로 위 typeCheckAction(161-392) 과 바로 아래 typeCheckforJson 은
// json 경로 본체다.** 이름의 Xml/forJson 만 보고 경계를 잘못 잡으면
// sri->ri 치환·pv/pvs 처리·배열 컬럼 복구가 함께 날아간다.

exports.typeCheckforJson = function(body_Obj) {
    for (var index1 in body_Obj) {
        if(body_Obj.hasOwnProperty(index1)) {
            typeCheckAction(index1, body_Obj[index1]);
        }
    }
};

function typeCheckforJson2(body_Obj) {
    for (var index1 in body_Obj) {
        if(body_Obj.hasOwnProperty(index1)) {
            for (var index2 in body_Obj[index1]) {
                if (body_Obj[index1].hasOwnProperty(index2)) {
                    typeCheckAction(index1, body_Obj[index1][index2]);
                }
            }
        }
    }
}

var operation = {
    'post': 1,
    'get': 2,
    'put': 3,
    'delete': 4
};

exports.response_result = function(request, response, status, rsc, cap, callback) {
    apply_headers(request, response, rsc);

    // 본문을 만드는 일은 shape 로 갔다. 여기 있던 접두 4갈래(55줄)와
    // 만들었다 곧바로 버리던 rspObj 는 함께 사라졌다.
    //
    // **정규화 함수를 인자로 넘기는 것이 요점이다** — 이 갈래는 본문 한 겹에
    // 걸고, rce 갈래는 한 겹 안쪽에, 그룹 갈래는 두 겹(typeCheckforJson2)에
    // 걸며, uril 갈래는 아예 안 건다. 호출부에서 그 차이가 보여야 한다.
    var body_Obj = shape.single(request.resourceObj, request.query.rcn,
                                _this.typeCheckforJson);

    if (body_Obj === null) {
        // rcn=0 은 본문이 없다는 뜻이다. rt 갈래는 아직 여기 남는다 —
        // 배출구(1단계 2번)가 들어오면 end('') 한 줄로 접힌다.
        if (request.query.rt == 3) {
            // parseInt: status 는 resultStatusCode 테이블에서 '400' 같은 문자열로
            // 온다. Express 는 문자열 상태코드를 deprecated 로 경고하는데, 그게 모든
            // 응답마다 찍혀 에러 로그를 덮어써서 진짜 에러가 묻혔다.
            response.status(parseInt(status, 10)).end('');
        }
        else {
            // 예전에는 rt==1 일 때 req 리소스에 결과를 적는 분기가 있었다.
            // 논블로킹을 지원하지 않게 되면서 도달할 수 없다.
        }

        callback();
        return;
    }

    // 논블로킹(rt=1/2)은 지원하지 않는다 — app.js 의 check_request_query_rt 가
    // 405-4 로 막으므로 여기까지 오는 요청은 모두 블로킹이다.
    response.status(parseInt(status, 10)).end(JSON.stringify(body_Obj));

    callback();
};

exports.response_rcn3_result = function(request, response, status, rsc, cap, callback) {
    if (request.query.rt == 3) {
        apply_headers(request, response, rsc);
    }

    // 본문 조립 열두 줄이 shape.js 로 나갔다. 여기 남은 것은 "어떻게 보낼지"
    // 뿐이다. 정규화 함수는 rce **한 겹 안쪽**에 건다 — 그것을 인자로 넘긴다.
    //
    // 함께 없어진 것 둘:
    //
    //   var rce_nm = 'rce';        아무도 안 읽었다
    //   body_Obj[rootnm] = {};     바로 다음 줄이 덮어썼다. **다만** 그 다음
    //                              줄이 던지는 입력(rce 없는 본문)에서는 이
    //                              대입만 남았다. 응답도 커넥션 반납도 없이
    //                              워커가 죽는 경로라, 죽기 직전 잔해의 모양이
    //                              달라지는 것을 차이로 받아들였다.
    var body_Obj = shape.rce(request.resourceObj, request.headers.rootnm,
                             _this.typeCheckforJson);

    var bodyString = JSON.stringify(body_Obj);

    // rt 가 1/2/3 이 아니거나 rt==2 인데 x-m2m-rtu 가 없으면, 예전에는 두 조건이
    // 모두 거짓이 되어 콜백이 사라졌다 — 응답도 connection.release() 도 없이
    // 요청이 매달렸다. 크래시가 아니라 워커 재시작도 안 걸리는 조용한 고갈이다.
    // 이제 논블로킹만 명시적으로 잡고 나머지는 기본(블로킹)으로 보낸다.
    // 논블로킹(rt=1/2)은 지원하지 않는다 — app.js 의 check_request_query_rt 가
    // 405-4 로 막으므로 여기까지 오는 요청은 모두 블로킹이다.
    // 예전에는 여기서 rt 로 갈라져 한쪽이 req 리소스에 결과를 적었다.

    response.status(parseInt(status, 10)).end(bodyString);

    // 여기 있던 rspObj 열두 줄을 걷어냈다. 만들자마자 cap 으로 덮어쓰고 다시
    // null 로 버렸다 — 읽는 곳이 없다. cap(여섯째 인자)이 응답에 안 나타난다는
    // 것은 하네스의 cap/string|object|number|null 네 건이 같은 바이트를 내는
    // 것으로 확인했다.
    callback();
};

exports.search_result = function(request, response, status, rsc, cap, callback) {
    var body_Obj = request.resourceObj;

    if (request.query.rt == 3) {
        apply_headers(request, response, rsc);
    }

    // 여기 있던 세 줄을 걷어냈다:
    //
    //     if (Object.keys(body_Obj)[0] == 'rsp') { rootnm = 'rsp'; }
    //
    // **아무 일도 안 했다.** 아래 두 갈래가 각자 첫 문장에서 rootnm 을 무조건
    // 다시 대입하므로 이 값은 어느 쪽으로도 살아남지 못한다. 차분 하네스의
    // search/first-key-rsp 가 그 바이트다 — rootnm='agr' 인데 본문 첫 키가
    // 'rsp' 인 입력이 {"m2m:agr":…} 로 나간다. 살아 있었다면 m2m:rsp 였다.
    //
    // `var rootnm` 이 아래 갈래 **안에** 선언돼 있어서 호이스팅으로 함수 전체에
    // 걸쳐 있었다. 함수 머리로 올린다 — 그러지 않으면 else 갈래의 맨 대입이
    // **암묵적 전역**이 되어 워커 안에서 요청끼리 값이 섞인다.
    var rootnm = request.headers.rootnm;

    if (rootnm == 'uril') {

        // rt 가 1/2/3 이 아니거나 rt==2 인데 x-m2m-rtu 가 없으면, 예전에는 두 조건이
        // 모두 거짓이 되어 콜백이 사라졌다 — 응답도 connection.release() 도 없이
        // 요청이 매달렸다. 크래시가 아니라 워커 재시작도 안 걸리는 조용한 고갈이다.
        // 이제 논블로킹만 명시적으로 잡고 나머지는 기본(블로킹)으로 보낸다.
        // 논블로킹(rt=1/2)은 지원하지 않는다 — app.js 의 check_request_query_rt 가
        // 405-4 로 막으므로 여기까지 오는 요청은 모두 블로킹이다.
        // 예전에는 여기서 rt 로 갈라져 한쪽이 req 리소스에 결과를 적었다.
        // discovery(fu=1)의 결과는 URI 문자열 배열이다. **네 갈래 중 여기만
        // typeCheck 를 안 거친다** — 정규화 인자가 아예 없는 것이 그 표시고,
        // 함수 이름(uril_no_type_check)에도 적혀 있다.
        body_Obj = shape.uril(body_Obj, rootnm);

        var bodyString = JSON.stringify(body_Obj);

        response.status(parseInt(status, 10)).end(bodyString);

        // 죽은 rspObj 여섯 줄을 걷어냈다 (위 rcn3 와 같은 것).
        callback();
    }
    else {
        // rootnm 은 함수 머리에서 이미 request.headers.rootnm 이다.

        // ty 별 뭉치기와 값 정규화는 shape.grouped 가 한다. 정규화는 **두 겹**
        // (typeCheckforJson2) — 그것을 인자로 넘긴다.
        // `body_Obj`(= request.resourceObj)를 제자리에서 고치고 되돌려준다.
        body_Obj = shape.grouped(body_Obj, rootnm, typeCheckforJson2);

        bodyString = JSON.stringify(body_Obj);

        // rt 가 1/2/3 이 아니거나 rt==2 인데 x-m2m-rtu 가 없으면, 예전에는 두 조건이
        // 모두 거짓이 되어 콜백이 사라졌다 — 응답도 connection.release() 도 없이
        // 요청이 매달렸다. 크래시가 아니라 워커 재시작도 안 걸리는 조용한 고갈이다.
        // 이제 논블로킹만 명시적으로 잡고 나머지는 기본(블로킹)으로 보낸다.
        // 논블로킹(rt=1/2)은 지원하지 않는다 — app.js 의 check_request_query_rt 가
        // 405-4 로 막으므로 여기까지 오는 요청은 모두 블로킹이다.
        // 예전에는 여기서 rt 로 갈라져 한쪽이 req 리소스에 결과를 적었다.

        response.status(parseInt(status, 10)).end(bodyString);

        // 죽은 rspObj 여섯 줄을 걷어냈다. 이 자리는 uril 갈래의 `var rspObj` 를
        // 호이스팅으로 빌려 쓰고 있었다 — 그쪽을 걷어낸 뒤 여기만 남기면
        // 선언 없는 대입이 되어 암묵적 전역이 된다.
        callback();
    }
};

// 에러 응답 본체. 아래 respond() 와 error_result() 가 공유한다.
//
// httpStatus 는 number 로 와도 되고 문자열로 와도 된다. 카탈로그(mobius/rsc.js)는
// number 를 주지만, 옛 시그니처를 쓰는 호출부는 '400' 처럼 문자열을 준다.
// Express 는 문자열 상태코드에 deprecated 경고를 찍는데 그게 모든 응답마다 나와
// 에러 로그를 덮어써서 진짜 에러가 묻혔다. 여기서 한 번에 숫자로 만든다.
function sendError(request, response, httpStatus, rsc, dbg_string, callback) {
    request.query.rt = 3;
    var body_Obj = {};
    body_Obj['m2m:dbg'] = dbg_string;

    apply_headers(request, response, rsc);

        var bodyString = JSON.stringify(body_Obj);

    body_Obj = null;

    response.status(Number(httpStatus)).end(bodyString);

    var rspObj = {};
    rspObj.rsc = rsc;
    rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
    rspObj.msg = dbg_string;
    // console.log(JSON.stringify(rspObj)); // 응답 바디 전체 덤프 - 로그 폭주 원인이라 비활성
    rspObj = null;

    callback();
}

// 단일 응답 진입점.
//
//   result = {
//     code:   mobius/rsc.js 의 카탈로그 항목 (http·rsc·coap 을 들고 있다)
//     dbg:    클라이언트 응답 본문(m2m:dbg)에 실릴 문구
//     detail: 로그에만 남길 상세 (드라이버 에러 원문, 내부 함수명 등)
//   }
//
// dbg 와 detail 을 나눈 이유: 지금은 내부 함수명과 DB 드라이버 에러 원문이
// m2m:dbg 로 클라이언트에 그대로 나간다. 문구 정리 단계에서 detail 로 옮기면
// 응답에는 안 나가고 로그에만 남는다.
//
// 성공 응답은 아직 response_result / search_result / response_rcn3_result 를
// 거친다. 그쪽 통합은 뒤 단계다.
exports.respond = function (request, response, result, callback) {
    var code = result.code;
    if (result.detail) {
        console.error('[' + (code && code.name ? code.name : '?') + '] ' + result.detail);
    }
    sendError(request, response, code.http, code.rsc, result.dbg, callback);
};

// 옛 시그니처 어댑터. status 가 '400' 같은 문자열로 들어온다.
// 새 코드는 respond() 를 쓴다.
exports.error_result = function (request, response, status, rsc, dbg_string, callback) {
    sendError(request, response, status, rsc, dbg_string, callback);
};
