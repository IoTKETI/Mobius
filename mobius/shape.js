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
 * @file 응답 **본문을 만든다**. 응답 구조 1단계 — "무엇을 보낼지".
 *
 * 여기 있는 것은 전부 **값 → 값**이다. `request` 도 `response` 도 안 읽고,
 * 헤더도 상태코드도 안 만지고, 콜백도 안 부른다. 그래야 시험이 HTTP 없이
 * 돌고, sgn.js 처럼 응답이 아닌 곳에서도 같은 규칙을 쓸 수 있다.
 *
 * ── 있는 것과 없는 것의 경계
 *
 *   있다   루트 키에 접두를 붙이는 일, 리소스 타입 표, 본문 모양 네 가지
 *          (single · rce · uril · grouped), 정규화를 **어느 깊이에** 거는가
 *   없다   apply_headers, status/end, rt 분기, callback. 그건 배출구의 일이다
 *
 * ── 정규화 함수를 왜 인자로 받나
 *
 * typeCheck 를 **어느 깊이에** 거는지가 갈래마다 다르다. 원본에서 실측한
 * 그대로다:
 *
 *   single    normalize(본문)              본문 = {'m2m:cnt': 속성}   한 겹
 *   rce       normalize(본문['m2m:rce'])   **한 겹 안쪽**
 *   grouped   normalize(그룹)              두 겹 (typeCheckforJson2)
 *   uril      **안 건다**
 *
 * 깊이를 한 칸 잘못 잡으면 속성 변환이 통째로 안 돈다 — ty 가 숫자가 아니라
 * 문자열로 나가고, lbl 이 배열이 아니라 `"[\"a\"]"` 라는 문자열로 나간다.
 * 응답은 200 이고 JSON 도 멀쩡해서 조용히 틀린 채 배포된다.
 *
 * 그래서 정규화 함수를 **인자로** 받는다. 이 모듈이 responder 를 require 하지
 * 않으니 순환이 없고, 무엇보다 **호출부에 어느 깊이를 쓰는지가 보인다.**
 * uril 만 그 인자가 아예 없다 — 인자의 부재가 곧 그 예외의 표시다.
 *
 * ── 리소스 타입 표를 왜 여기 두나
 *
 * `typeRsrc`·`mgoType` 은 "무엇을 보낼지" 를 정하는 데이터지 전송과는 상관이
 * 없다. responder.js 는 이것을 그대로 다시 export 해서 기존 호출부
 * (app.js · admin/server.js · resource.js · sql_action.js 의
 * `responder.typeRsrc`)를 한 줄도 안 건드린다.
 *
 * ── 옛 동작을 글자 그대로 보존한다
 *
 * 이 파일은 responder.js 의 세 함수에서 본문 조립을 **옮긴** 것이다. 이상해
 * 보이는 동작(`m2m:undefined` 키, `hd_` 를 includes 로 잡는 것, rce 없는
 * 본문에서 던지는 것)을 **막지 않는다** — 막으면 지금 나가는 응답이 바뀐다.
 * 각 자리에 그 사실을 적어 두었다. 고칠지는 따로 판단한다.
 *
 * 등가는 차분 하네스(진짜 express + 진짜 소켓, 240 케이스, 바이트 비교)로
 * 확인했다.
 */

'use strict';

var typeRsrc = {
    "1": "acp",
    "2": "ae",
    "3": "cnt",
    "4": "cin",
    "5": "cb",
    "9": "grp",
    "10": "lcp",
    "13": "mgo",
    "14": "nod",
    "16": "csr",
    "23": "sub",
    "24": "smd",
    "27": "mms",
    "28": "fcnt",
    "91": "hd_brigs",
    "92": "hd_color",
    "93": "hd_colSn",
    "94": "hd_fauDn",
    "95": "hd_binSh",
    "96": "hd_tempe",
    "97": "hd_bat",
    "98": "hd_dooLk",
    "99": "rsp"
};

var mgoType = {
    "1001": "fwr",
    "1006": "bat",
    "1007": "dvi",
    "1008": "dvc",
    "1009": "rbo"
};

exports.typeRsrc = typeRsrc;
exports.mgoType = mgoType;

/**
 * fcnt 의 moduleclass -> 응답 키의 뒷부분.
 *
 * **같은 표가 네 파일에 40번 손으로 적혀 있었다** — responder.js(응답 이름) ·
 * sgn.js(알림 이름) · fcnt.js(요청 빌드) · resource.js(insert/update 디스패치).
 * 네 곳의 매핑은 일치했다(오늘의 결함은 없다). 여기 한 벌만 남기고 나머지는
 * 이것을 참조하게 한다 — 그것이 1단계 4·5번이다.
 *
 * 옛 코드는 `cnd == '...'` 여덟 개를 else-if 로 늘어놓았다. 전부 **완전일치**라
 * 순서가 결과를 가르지 않는다 — colourSaturation 이 colour 보다 먼저 오는 것은
 * 접두 관계처럼 보이지만 `==` 에는 접두가 없다. 그래서 표로 접어도 같다.
 *
 * `hasOwnProperty` 로 막는 이유: 이 객체는 Object.prototype 을 물려받으므로
 * `cnd` 가 'toString' 이나 'constructor' 면 표에 없는데도 값이 잡힌다.
 * 옛 else-if 사슬에는 그 구멍이 없었다.
 */
var MODULE_CLASS = {
    'org.onem2m.home.moduleclass.doorlock':         'dooLk',
    'org.onem2m.home.moduleclass.battery':          'bat',
    'org.onem2m.home.moduleclass.temperature':      'tempe',
    'org.onem2m.home.moduleclass.binarySwitch':     'binSh',
    'org.onem2m.home.moduleclass.faultDetection':   'fauDn',
    'org.onem2m.home.moduleclass.colourSaturation': 'colSn',
    'org.onem2m.home.moduleclass.colour':           'color',
    'org.onem2m.home.moduleclass.brightness':       'brigs'
};

exports.MODULE_CLASS = MODULE_CLASS;

/**
 * 루트 이름에 접두를 붙인다. **접두 규칙의 단일 진실원.**
 *
 *   mgo          'm2m:' + mgoType[obj.mgd]
 *   fcnt         cnd 가 'org.onem2m.home.device.' 를 포함하면 'm2m:fcnt',
 *                아는 moduleclass 면 'hd:<약칭>', 그 밖은 'm2m:fcnt'
 *   'hd_' 포함    'hd:' + rootnm 에서 'hd_' 를 **처음 하나만** 뺀 것
 *   그 밖         'm2m:' + rootnm
 *
 * 옛 코드의 성질을 그대로 옮긴 것들 — 고치지 않았다:
 *
 *   · `mgoType[obj.mgd]` 에 가드가 없다. 모르는 mgd 는 **'m2m:undefined'** 가
 *     된다. 표에 없는 mgd 를 넣은 리소스가 있다면 그 키로 나가고 있다
 *   · `hd_` 판정이 `startsWith` 가 아니라 `includes` 다. 'x_hd_bat' 도 걸려서
 *     'hd:x_bat' 이 된다
 *   · `cnd` 가 문자열이 아닐 때 던지는 것은 `.includes` 하나뿐이다. 그래서
 *     `typeof === 'string'` 가드가 그 앞에만 있다. `#attr` 필터로 cnd 가 통째로
 *     사라진 fcnt 하나에 워커가 죽었던 자리다
 *   · rootnm 이 undefined 면(빈 resourceObj) `.includes` 에서 TypeError 를
 *     던진다. 옛 코드와 같은 자리, 같은 예외다
 *
 * @param {string} rootnm  본문의 루트 키 ('cnt' 'fcnt' 'mgo' 'hd_bat' …)
 * @param {object} obj     그 키가 가리키는 리소스. mgd / cnd 만 읽는다
 * @returns {string}       접두가 붙은 키 ('m2m:cnt' 'hd:bat' …)
 */
exports.root_key = function (rootnm, obj) {
    if (rootnm == 'mgo') {
        return 'm2m:' + mgoType[obj.mgd];
    }

    if (rootnm == 'fcnt') {
        // device.* 는 moduleclass 가 아니라 device 라 표준 이름 그대로 나간다.
        // 이것만 부분문자열 검사이고, 그래서 이것만 던질 수 있다.
        if (typeof obj.cnd === 'string' && obj.cnd.includes('org.onem2m.home.device.')) {
            return 'm2m:' + rootnm;
        }
        if (Object.prototype.hasOwnProperty.call(MODULE_CLASS, obj.cnd)) {
            return 'hd:' + rootnm.replace('fcnt', MODULE_CLASS[obj.cnd]);
        }
        // 아는 cnd 가 아니거나 cnd 가 없다. 접두 없는 'fcnt' 로 내보내면
        // 표준 본문이 아니므로 'm2m:fcnt' 로 떨어뜨린다.
        return 'm2m:' + rootnm;
    }

    if (rootnm.includes('hd_')) {
        return 'hd:' + rootnm.replace('hd_', '');
    }

    return 'm2m:' + rootnm;
};

/**
 * 일반 CRUD 응답의 본문을 만든다.
 *
 * @param {object}   resourceObj  루트 키 하나짜리 본문 ({cnt: {...}} 같은 것).
 *                                **제자리에서 고친다** — 아래 소유권 항목 참조
 * @param {*}        rcn          request.query.rcn **날것 그대로**. 문자열이어도
 *                                되고 없어도 된다. `==` 로 비교하므로 '0' 과 ''
 *                                도 0 으로 본다 (옛 코드와 같다)
 * @param {function} normalize    접두를 붙인 본문 **한 겹**에 걸 정규화 함수.
 *                                지금은 responder.js 의 `typeCheckforJson` 이다
 * @returns {object|null}         본문 객체. rcn 이 "본문 없음" 이면 null
 *
 * ── 소유권: 이 함수는 인자를 제자리에서 고친다
 *
 * 옛 코드가 그랬고(그 안에 `delete body_Obj[rootnm]` 이 13회 있다), 그것을
 * 그대로 두었다. 순수하게 만드는 것이 **안전하다는 것은 확인했지만**(아래),
 * 응답마다 리소스 전체를 깊은 복제하는 값을 치른다.
 *
 *   · 저장소에서 responder 뒤에 `request.resourceObj` 를 읽는 코드는 없다.
 *     정산 콜백은 `settle.js` 의 finish() 하나이고 커넥션만 반납한다
 *   · 같은 리소스를 비동기로 붙잡는 곳은 `sgn.check` 뿐인데, 그것은 진입
 *     즉시 JSON 왕복으로 스냅샷을 뜬다. 별칭이 아니다
 *
 * 그러니 순수로 바꾸고 싶으면 이 함수 첫 줄에 깊은 복제 한 줄만 넣으면 된다.
 * 그 변형을 차분 하네스로 돌려 봤다 — 응답 바이트는 그대로이고
 * `request.resourceObj` 의 사후 모양만 달라진다. 전선에는 안 나타난다.
 */
exports.single = function (resourceObj, rcn, normalize) {
    if (typeof normalize !== 'function') {
        throw new TypeError('shape.single: normalize 함수가 필요하다');
    }

    // ── rcn == 0 은 "본문 없음"
    //
    // 판정을 옛 코드에서 **문자 그대로** 옮겼다. `==` 도 그대로다.
    //
    // 'dbg' 예외는 2017년 시그니처의 화석이다. 그때 서명은
    //   response_result(request, response, status, body_Obj, rsc, ri, cap)
    // 로 **본문이 인자**였고, 에러 응답은 `{dbg: "..."}` 를 그 자리에 넘겼다.
    // rcn=0 은 "내용 필요 없음" 인데 에러 사유까지 삼키면 안 되니 빠져나갈
    // 구멍을 둔 것이다. 지금은 본문이 `request.resourceObj` 에서 오고 에러는
    // respond 가 따로 만든다 — `request.resourceObj` 를 세우는 15개 파일 21곳
    // 중 루트 키가 'dbg' 인 것을 만드는 곳은 없다. **도달 불가다.**
    // 그래도 판정은 안 바꾼다. 없애는 것은 이 재작성의 일이 아니다.
    if (rcn == 0 && Object.keys(resourceObj)[0] != 'dbg') {
        return null;
    }

    var rootnm = Object.keys(resourceObj)[0];
    var key = exports.root_key(rootnm, resourceObj[rootnm]);

    // 새 키를 **먼저 넣고** 옛 키를 지운다. 순서를 뒤집으면 루트 키가 둘 이상인
    // 본문에서 키 차례가 달라지고 JSON.stringify 결과가 바이트로 달라진다.
    resourceObj[key] = resourceObj[rootnm];
    delete resourceObj[rootnm];

    // **접두를 붙인 뒤에** 돈다. typeCheckAction 이 첫 인자로 받는 키를 보고
    // 갈린다 — 'm2m:cb' 의 et, 'm2m:ae'/'m2m:csr' 의 cr, 'hd:bat' 의 lvl 처럼.
    // 순서를 바꾸면 그 분기가 전부 죽는다.
    //
    // **한 겹만** 돈다. 여기 오는 본문은 {키: 리소스} 라서 정규화 함수가
    // 리소스 하나를 통째로 typeCheckAction 에 넘긴다. 두 겹짜리
    // (typeCheckforJson2) 는 discovery 처럼 배열이 한 겹 더 있을 때 쓴다.
    normalize(resourceObj);

    return resourceObj;
};

/**
 * rcn=3(CREATE 성공) 응답 본문.  `{"m2m:rce": {uri, "m2m:<rootnm>": {…}}}`
 *
 * **접두 규칙을 안 탄다.** single 은 mgo/fcnt/hd_ 넷으로 갈려 `hd:bat` 같은
 * 키를 만들지만 이쪽은 언제나 `'m2m:' + rootnm` 이다. 그래서 같은 리소스가
 * CREATE 응답이냐 RETRIEVE 응답이냐에 따라 다른 키로 나간다:
 *
 *     RETRIEVE  {"hd:bat":{…}}
 *     CREATE    {"m2m:rce":{"uri":…,"m2m:hd_bat":{…}}}
 *
 * `m2m:hd_bat` 은 표준 short name 이 아니다. **옮기면서 생긴 것이 아니라 지금
 * 배포된 동작이다** — 차분 하네스의 rcn3/hd_bat · rcn3/fcnt-battery ·
 * rcn3/mgo-1006 이 그 바이트를 못박고 있다. 고칠지는 따로 판단한다.
 *
 * @param {object}   resourceObj  `{rce: {uri, <rootnm>: {…속성}}}`.
 *                                **제자리에서 고친다** — rce 를 `m2m:rce` 로 옮기고
 *                                원래 키를 지운다
 * @param {string}   rootnm       리소스 이름. 문자열이 아니면 문자열로 강제된다 —
 *                                `undefined` 면 `m2m:undefined` 키가 생기고 원래
 *                                키는 안 지워진다(옛 동작 그대로다. 막지 않는다)
 * @param {function} normalize    `m2m:rce` **안쪽 한 겹**에 걸 정규화 함수.
 *                                지금은 responder.js 의 `typeCheckforJson` 이다
 * @returns {object}              고쳐진 `resourceObj` (인자와 같은 객체다)
 * @throws {TypeError}            `resourceObj.rce` 가 없을 때. 옛 코드도 같은
 *                                자리에서 같은 메시지로 던졌다 — 응답도 커넥션
 *                                반납도 없이 워커가 죽는다. **여기서 삼키지
 *                                않는다.** 조용히 빈 본문을 만들면 그 결함이
 *                                200 뒤에 숨는다. 진짜 방어는 배출구 한 곳이다
 */
exports.rce = function rce_type_checked_one_level_in(resourceObj, rootnm, normalize) {
    if (typeof normalize !== 'function') {
        throw new TypeError('shape.rce: normalize 함수가 필요하다');
    }

    // 객체 키는 언제나 문자열로 강제된다. rootnm 이 undefined 로 와도 옛 코드는
    // 'undefined' 라는 **문자열 키**를 찾았고, 그래서 원래 키가 안 지워진 채
    // 남았다(하네스의 rcn3/edge-rootnm-undefined 가 그 바이트다).
    // 그 강제를 한 줄로 드러내 둔다 — 숨겨 두면 다음 사람이 못 본다.
    var src_key = String(rootnm);
    var rce = resourceObj['rce'];

    // **붙이고 나서 지운다.** 순서가 계약이다. JS 는 이미 있는 키에 대입해도
    // 자리를 안 바꾸므로, `m2m:<rootnm>` 이 rce 에 이미 있으면 그 자리에
    // 값만 갈린다. 뒤집으면 그 입력에서 키 순서가 달라진다 —
    // 응답 본문의 키 순서는 바이트의 일부다.
    //
    // 이 줄이 rce 없는 본문에서 던지는 자리다. 오른쪽(`rce[src_key]`)이 먼저
    // 평가되므로 메시지는 옛 코드와 같은 "reading '<rootnm>'" 이다.
    rce['m2m:' + rootnm] = rce[src_key];
    delete rce[src_key];

    resourceObj['m2m:rce'] = rce;
    delete resourceObj[src_key];
    delete resourceObj['rce'];

    // **한 겹 안쪽에만** 건다. resourceObj 에 걸면 typeCheckAction 이
    // 'm2m:rce' 를 리소스 하나로 보고 그 안의 uri / m2m:cnt 를 **속성 이름**
    // 으로 훑는다. 아무 속성과도 안 맞으므로 ty·st·cni 의 정수 변환도,
    // lbl·acpi 의 배열 복구도, sri->ri 치환도 통째로 안 돈다.
    //
    // 여기 걸면 index1 이 'uri' 와 'm2m:cnt' 두 번 돈다. 'uri' 쪽은 문자열
    // 위를 도는 헛돌기지만 던지지 않는다 — rcn3/uri-is-string 이 확인한다.
    normalize(rce);

    return resourceObj;
};

/**
 * fu=1 discovery 응답 본문.  `{"m2m:uril": ["Mobius2/a", …]}`
 *
 * **정규화 인자가 없다.** 네 갈래 중 유일하게 typeCheck 를 안 돈다.
 *
 * 여기 담기는 것은 URI **문자열** 배열이라 정수로 바꿀 ty 도, 배열로 되돌릴
 * lbl 도 없다. 안 도는 것이 옳다. 그런데 "안 돈다" 는 코드에 안 적히는 종류의
 * 사실이라 나중에 "왜 여기만 빠졌지" 하고 끼워 넣기 쉽다. 끼우면 조용히
 * 망가진다: typeCheckAction 의 첫 갈래가 `'' · '[]' · 'undefined' · '""'` 를
 * 빈 값으로 보고 **delete** 하므로, 그런 원소가 든 배열에 구멍이 생겨 JSON 에서
 * null 로 나간다.
 *
 * 하네스의 두 케이스가 그 자리를 지킨다:
 *
 *     search/uril/objects-inside   ty 가 "3" 문자열 그대로, lbl 이 원본 문자열
 *     search/uril/falsy-strings    ['', '[]', 'undefined', '""', …] 가 다 살아남는다
 *
 * @param {object} resourceObj  `{uril: [ …URI 문자열… ]}`. **제자리에서 고친다**
 * @param {string} rootnm       호출부에서 이미 'uril' 로 확인된 값
 * @returns {object}            고쳐진 `resourceObj` (인자와 같은 객체다)
 */
exports.uril = function uril_no_type_check(resourceObj, rootnm) {
    var src_key = String(rootnm);

    // rce 와 같은 규칙 — 붙이고 나서 지운다.
    resourceObj['m2m:' + rootnm] = resourceObj[src_key];
    delete resourceObj[src_key];

    return resourceObj;
};

/**
 * discovery(rcn=4/5/6) 와 팬아웃(fanOutPoint) 결과를 `ty` 별로 뭉친다.
 *
 *     grouped({ '/a': {ty:'3'…}, '/b': {ty:'4'…} }, 'rsp', normalize)
 *       -> { 'm2m:rsp': { 'm2m:cnt': [ {…} ], 'm2m:cin': [ {…} ] } }
 *
 * 바깥 키와 안쪽 키는 **서로 다른 것이 정한다.**
 *
 *   바깥 `m2m:<rootnm>` — 부르는 쪽이 정한다. `ty` 와 무관하다.
 *       resource.js 가 discovery 에 'rsp' 를, fopt.js 와 resource.js 가
 *       팬아웃에 'agr' 을 넣는다.
 *   안쪽 `m2m:<타입이름>` — 원소의 `ty` 가 정한다.
 *
 * 그래서 `m2m:rsp` 가 두 자리에 다른 뜻으로 나온다. discovery 응답은
 * `{"m2m:rsp":{"m2m:cnt":[…]}}` 이고, 팬아웃 응답은
 * `{"m2m:agr":{"m2m:rsp":[…]}}` 이다. 뒤엣것의 `m2m:rsp` 는 rootnm 이 아니라
 * **`ty` 가 없는 원소의 기본값**에서 나온다 (아래 참조).
 *
 * @param {object}   resourceObj  원소 맵. 키는 `ri` 문자열(discovery) 이나
 *                                멤버 주소(팬아웃). **제자리에서 고친다** —
 *                                원소를 전부 지우고 그 자리에 `m2m:<rootnm>`
 *                                하나를 남긴다
 * @param {string}   rootnm       바깥 키에 붙일 이름. `undefined` 면
 *                                `m2m:undefined` 가 된다 (옛 동작 그대로다.
 *                                막지 않는다 — 막으면 지금 나가는 응답이 바뀐다)
 * @param {function} normalize    그룹 하나를 받아 원소들의 값을 정규화하는 함수.
 *                                지금은 responder.js 의 `typeCheckforJson2` 다
 * @returns {object}              고쳐진 `resourceObj` (인자와 같은 객체다)
 */
exports.grouped = function (resourceObj, rootnm, normalize) {
    // 값 정규화를 빠뜨리면 응답 본문이 조용히 달라진다 — `subl` 이 남고
    // 정수 컬럼이 문자열로 나간다. 선택 인자로 두면 언젠가 빠뜨린다.
    if (typeof normalize !== 'function') {
        throw new TypeError('shape.grouped: normalize 함수가 필요하다');
    }

    var res_Obj = {};

    for (var prop in resourceObj) {
        if (!resourceObj.hasOwnProperty(prop)) {
            continue;
        }

        var member = resourceObj[prop];

        // `== null` 이라 `undefined` 와 `null` 이 같이 걸린다. **`0` 과 `''` 은
        // 안 걸린다** — 그때는 `typeRsrc[0]` 이 undefined 라 `m2m:undefined`
        // 그룹이 생긴다. 옛 동작 그대로다.
        //
        // 팬아웃 원소는 `{fr, rsc, rqi, rvi, pc}` 뿐이라(fopt.js 의 check_body)
        // **언제나 이 갈래로 떨어진다.** 즉 팬아웃 응답의 안쪽 키 `m2m:rsp` 는
        // 아래 `typeRsrc['99']` 하나에 매달려 있다.
        var ty = (member.ty == null) ? '99' : member.ty;

        // mgo(13)만 한 겹 더 갈린다 — `mgd` 가 fwr/bat/dvi/dvc/rbo 를 정한다.
        // 모르는 mgd 면 `mgoType[mgd]` 가 undefined 라 `m2m:undefined` 로 간다.
        // 가드를 넣지 않는다 — 넣으면 지금 나가는 응답이 바뀐다.
        var key = (typeRsrc[ty] === 'mgo')
            ? 'm2m:' + mgoType[member.mgd]
            : 'm2m:' + typeRsrc[ty];

        if (res_Obj[key] == null) {
            res_Obj[key] = [];
        }
        res_Obj[key].push(member);

        // push 가 참조를 넣었으므로 여기서 지워도 그룹 안의 원소는 살아 있다.
        // for-in 도는 중의 delete 는 현재 키에 대해서는 안전하다.
        delete resourceObj[prop];
    }

    resourceObj['m2m:' + rootnm] = res_Obj;

    normalize(res_Obj);

    return resourceObj;
};
