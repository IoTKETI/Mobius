'use strict';
// ty 결정의 단일 진실원.
//
// 예전에는 리소스 타입을 정하는 곳이 다섯 군데였다.
//
//   check_xm2m_headers        Content-Type 의 ty=N
//   check_resource_supported  본문 루트 이름 — 위를 무조건 덮어쓴다
//   check_type_update_resource  본문 루트 이름 — 또 다른 알고리즘
//   check_allowed_app_ids     둘이 어긋났는지 뒤늦게 검사
//   check_request_query_rt    '17' 로 바꿨다 되돌린다
//
// 덮어쓰기 때문에 Content-Type 의 ty 는 어디에도 쓰이지 않고 버려졌다.
// application/json;ty=3 에 {"m2m:ae":...} 를 보내면 AE 가 201 로 만들어졌다.
// 알고리즘이 두 벌이라 한쪽만 mgoType 을 알았고, 그래서 mgmtObj 는
// 생성이 막힌 채로 남았다.
//
// 이 모듈은 responder 의 표만 읽는 순수 동기 모듈이다. app.js 는 require 하는
// 순간 cluster.fork() 와 listen 이 돌아 단위 테스트가 불가능하므로 여기에 둔다.

var responder = require('./responder');

// oneM2M 표준에 없는 Mobius 내부 별칭이다.
//
// 91~98(hd_*)은 flexContainer(28)의 별칭이다 — resource.js:939 가 저장 직전
// 다시 '28' 로 되돌린다. 클라이언트가 Content-Type 에 넣을 수 있는 표준 값은
// 28 뿐이므로 "ty=28 인데 본문은 hd:dooLk" 는 어긋남이 아니라 정상 트래픽이다.
// WS·MQTT 프록시는 CREATE 에 항상 ty 를 붙이므로, 이것을 불일치로 보면
// 두 바인딩의 hd:* 생성이 예외 없이 전부 깨진다.
var ALIAS_OF = {
    '91': '28', '92': '28', '93': '28', '94': '28',
    '95': '28', '96': '28', '97': '28', '98': '28'
};

function canonical(ty) {
    return ALIAS_OF.hasOwnProperty(ty) ? ALIAS_OF[ty] : ty;
}

// 'm2m:cnt' -> 'cnt', 'hd:dooLk' -> 'hd_dooLk', 접두 없는 'cnt' -> 'cnt'
//
// 접두를 떼는 규칙이 app.js 두 곳에 따로 복사돼 있었다. 한쪽만 고치면
// 두 경로의 판정이 갈린다 — 그래서 한 곳에 둔다.
exports.normalize_root_name = function (key) {
    if (typeof key !== 'string') {
        return '';
    }
    if (key.split(':')[0] === 'hd') {
        return key.replace('hd:', 'hd_');
    }
    return key.replace('m2m:', '');
};

/**
 * 본문 루트 이름과 Content-Type 의 ty 로 리소스 타입을 정한다.
 *
 * @param {string} root_key   본문 최상위 키 원문 ('m2m:cnt', 'hd:dooLk', 'cnt' ...)
 * @param {string|null} ty_hint  Content-Type 의 ty 값. 헤더에 ty 가 없었으면 null
 * @returns {{rsc: string, ty: string|null, rootnm: string|null}}
 *
 * ty 는 반드시 문자열이다. typeRsrc 의 키가 문자열이고, resource.js 가
 * rid.next_rn(request.ty) 로 ri 접두 문자열을 만들기 때문이다.
 *
 * ty_hint 가 null 이면 대조하지 않고 본문이 이긴다. WS·MQTT 는 PUT 에
 * ty 를 붙이지 않으므로(pxy_ws.js, pxy_mqtt.js) 이 경로가 필요하다.
 */
exports.resolve = function (root_key, ty_hint) {
    var rootnm = exports.normalize_root_name(root_key);

    var ty = null;
    for (var key in responder.typeRsrc) {
        if (responder.typeRsrc.hasOwnProperty(key)) {
            if (responder.typeRsrc[key] === rootnm) {
                ty = String(key);
                break;
            }
        }
    }

    if (ty === null) {
        // mgmtObj 구체 타입(fwr/bat/dvi/dvc/rbo)이 여기로 온다. typeRsrc 에는
        // 13:"mgo" 만 있고 구체 타입은 responder.mgoType 에 따로 있다.
        // 하위 계층은 이미 ty=13 + rootnm='fwr' 을 전제로 쓰여 있으나
        // (mgo.js 의 build_mgo, resource.js 의 mgd 분기, sql_action 의 insert_fwr),
        // sql_action 의 mgo 계열 10개가 아직 이스케이프 없는 문자열 조립이라
        // 여기서 열어 주면 요청 본문이 그대로 SQL 에 들어간다.
        // 파사드 전환이 끝날 때까지 종전대로 400-3 으로 둔다.
        return { rsc: '400-3', ty: null, rootnm: null };
    }

    if (ty_hint != null && ty_hint !== '' && canonical(ty_hint) !== canonical(ty)) {
        return { rsc: '400-42', ty: null, rootnm: null };
    }

    return { rsc: '200', ty: ty, rootnm: rootnm };
};

exports._ALIAS_OF = ALIAS_OF;
exports._canonical = canonical;
