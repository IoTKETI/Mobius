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
    // rcn=0 이면 shape.single 이 null 을 준다 — 배출구가 그것을 빈 본문으로
    // 보낸다. 여기 있던 rt 갈래(rt==3 이면 '' 를 보내고, 아니면 **아무것도
    // 안 보내고 콜백만** 불러 요청이 매달렸다)는 없어졌다. 뒤엣것은 모양이
    // 아니라 결함이고, app.js 가 rt 를 3 으로 고정하고 1/2 를 405-4 로 막으므로
    // 실트래픽은 그 갈래를 밟지 못했다. 차분 하네스의 result/rcn0/rt-* 두
    // 건이 그 자리를 '의도된 차이' 로 못박는다.
    var body = shape.single(request.resourceObj, request.query.rcn,
                            _this.typeCheckforJson);
    exports.respond(request, response, { status: status, rsc: rsc, body: body }, callback);
};

exports.response_rcn3_result = function(request, response, status, rsc, cap, callback) {
    // 여기 있던 `if (rt == 3) apply_headers` 게이트는 없어졌다 — 배출구가
    // 헤더를 무조건 세운다. rt 는 실트래픽에서 언제나 3 이다(위 참조).
    var body = shape.rce(request.resourceObj, request.headers.rootnm,
                         _this.typeCheckforJson);
    exports.respond(request, response, { status: status, rsc: rsc, body: body }, callback);
};

exports.search_result = function(request, response, status, rsc, cap, callback) {
    var rootnm = request.headers.rootnm;

    // uril 은 네 모양 중 유일하게 정규화를 안 한다 — 인자가 없는 것이 표시다.
    var body = (rootnm == 'uril')
        ? shape.uril(request.resourceObj, rootnm)
        : shape.grouped(request.resourceObj, rootnm, typeCheckforJson2);

    exports.respond(request, response, { status: status, rsc: rsc, body: body }, callback);
};

// ── 배출구 ─────────────────────────────────────────────────────────────
//
// **응답 바이트가 전선에 실리는 자리는 이 파일에서 send() 하나다.**
//
// 예전에는 세 응답 함수와 sendError 가 각자 apply_headers 를 자기 조건으로
// 부르고(무조건 2 · rt==3 게이트 2) 각자 response.status().end() 를 했다 —
// 여섯 자리. 위치 인자 여섯 개짜리 시그니처라 한 칸만 밀려도 rsc 자리에
// 객체가 가서 `X-M2M-RSC: [object Object]` 가 나갔고, callback 자리에
// 문자열이 가서 워커가 죽었다. 이 저장소에서 두 번 일어났다.
//
// 이제 respond() 가 **이름 있는 필드**로 받는다. 위치가 없으니 밀림이 성립
// 하지 않는다. 그리고 send() 가 rsc 와 status 를 검사해서, 잘못된 것이 오면
// **던지지 않고** 500 으로 내보낸다 — 응답 도중에 던지면 커넥션 반납도
// 못 하기 때문이다. 차분 하네스의 hdr/rsc-object(옛: [object Object] 가
// 전선에) 와 hdr/status-garbage(옛: ERR_HTTP_INVALID_STATUS_CODE 로 워커
// 사망)가 그 두 경우를 '의도된 차이' 로 못박는다.

/**
 * 전송. 이 파일에서 response.status().end() 를 부르는 유일한 자리.
 *
 * @param status   HTTP 상태. '200' 같은 문자열도 받는다 (parseInt)
 * @param rsc      X-M2M-RSC 에 실릴 네 자리 문자열
 * @param body     JSON 으로 직렬화할 객체. null 이면 빈 본문
 * @param headers  apply_headers 뒤에 얹을 추가 헤더 (없으면 null)
 * @param done     전송 뒤 부른다. settle 이 여기서 커넥션을 반납한다
 */
function send(request, response, status, rsc, body, headers, done) {
    var st = parseInt(status, 10);

    if (!/^\d{4}$/.test(String(rsc)) || !(st >= 100 && st <= 599)) {
        console.error('[respond] 잘못된 응답 명세: status=' + status + ' rsc=' + rsc +
                      ' (' + request.method + ' ' + request.url + ')');
        st = 500;
        rsc = '5000';
        body = { 'm2m:dbg': 'internal error' };
        headers = null;
    }

    apply_headers(request, response, rsc);
    if (headers) {
        Object.keys(headers).forEach(function (k) { response.header(k, headers[k]); });
    }
    response.status(st).end(body == null ? '' : JSON.stringify(body));
    done();
}

/**
 * 공개 배출구.
 *
 *   respond(request, response, { code, dbg, detail }, done)          에러
 *   respond(request, response, { status, rsc, body, headers }, done) 성공
 *
 * code 는 rsc.js 카탈로그 객체다(reason.js 의 code 필드). 그것이 오면
 * status·rsc·본문을 카탈로그가 정한다 — 이 형태는 예전부터 있었고 호출부
 * 5곳(app.js 3 · body.js 1 · 시험 1)이 한 글자도 안 바뀌었다. 에러 경로의
 * 부수효과(request.query.rt = 3, detail 로그)도 그대로다.
 */
exports.respond = function (request, response, spec, done) {
    if (spec.code) {
        var code = spec.code;
        if (spec.detail) {
            console.error('[' + (code && code.name ? code.name : '?') + '] ' + spec.detail);
        }
        // 옛 sendError 가 하던 것. 논블로킹 흔적이지만 응답에 안 나타나므로
        // 바꾸지 않는다 — 하네스가 queryAfter 로 이 부수효과까지 본다.
        request.query.rt = 3;
        send(request, response, code.http, code.rsc, { 'm2m:dbg': spec.dbg }, null, done);
        return;
    }
    send(request, response, spec.status, spec.rsc, spec.body, spec.headers, done);
};

// error_result 가 아직 부른다. 호출자가 없으므로 1단계 3번에서 둘 다 지운다.
function sendError(request, response, httpStatus, rsc, dbg_string, callback) {
    request.query.rt = 3;
    send(request, response, httpStatus, rsc, { 'm2m:dbg': dbg_string }, null, callback);
}

exports.error_result = function (request, response, status, rsc, dbg_string, callback) {
    sendError(request, response, status, rsc, dbg_string, callback);
};
