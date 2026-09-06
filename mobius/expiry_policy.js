'use strict';
/**
 * 만료(et) 정책의 단일 진실원.
 *
 * 관리 콘솔의 만료 화면이 "et 를 늘릴 수 있는 타입" 과 "만료되면 자동으로 지워지는
 * 타입" 을 화면 상수로 들고 있었다. 둘 다 코어와 어긋나 있었다 — ACP 만 자동
 * 삭제된다고 표시했는데 실제로는 지금 아무것도 자동 삭제되지 않고, 코어가 et 를
 * 받아 주는 NOD·CSR·LCP·FCNT·SMD·MMS 를 화면이 막고 있었다(2026-09-01 목적 문서 §0층).
 *
 * 화면은 이 두 함수의 결과만 본다. test/expiry-policy.test.js 가 속성 목록·app.js 와 대조한다.
 */
var attr = require('./attr_lists');
var shape = require('./shape');

/** 리소스 이름 → ty. shape.typeRsrc 의 역방향. 없으면 null (fwr/bat/… 은 mgo 의 하위 이름이다). */
function ty_of(name) {
    var keys = Object.keys(shape.typeRsrc);
    for (var i = 0; i < keys.length; i++) {
        if (shape.typeRsrc[keys[i]] === name) { return Number(keys[i]); }
    }
    return null;
}

/**
 * UPDATE 에서 et 를 받는 타입. resource.js 의 update_opt_attr_list 에서 계산한다.
 * hd_*(91~98) 는 fcnt(28) 의 별칭이라 28 로 접는다.
 */
exports.etExtendableTypes = function () {
    var out = [];
    Object.keys(attr.update_opt_attr_list).forEach(function (name) {
        if (attr.update_opt_attr_list[name].indexOf('et') < 0) { return; }
        var ty = ty_of(name);
        if (ty === null) { return; }
        if (ty >= 91 && ty <= 98) { ty = 28; }
        if (out.indexOf(ty) < 0) { out.push(ty); }
    });
    return out.sort(function (a, b) { return a - b; });
};

/**
 * 만료 스윕이 지우는 타입. **지금은 없다** — app.js 가 del_expired_resource 를
 * 주기 실행하던 것을 뺐다(app.js 상단 "예전에는 del_expired_resource 를 24시간마다"
 * 주석). 스윕을 되살리면 여기서 그 타입 목록을 돌려주고, 시험이 app.js 와 대조한다.
 */
exports.autoDeletedTypes = function () {
    return [];
};
