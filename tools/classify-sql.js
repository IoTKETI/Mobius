'use strict';
// sql_action.js 의 함수를 "파사드로 전환됨 / 손으로 쓴 SQL" 로 분류한다.
//
// 헌장(docs/superpowers/specs/2026-08-28-phase2-charter.md)의 전환율 숫자가
// 여기서 나온다. 문서를 갱신할 때 추측하지 말고 이것을 돌려라.
//
//   node tools/classify-sql.js mobius/sql_action.js
//   node tools/classify-sql.js mobius/sql_action.js --list   (함수 이름까지)

var fs = require('fs');

var P = process.argv[2] || 'mobius/sql_action.js';
var LIST = process.argv.indexOf('--list') >= 0;

var lines = fs.readFileSync(P, 'utf8').split('\n');

// 함수 경계. exports.foo = function 과 function foo( 둘 다 잡는다.
var heads = [];
lines.forEach(function (l, i) {
    var m = l.match(/^(?:exports\.([a-zA-Z_0-9]+)\s*=\s*function|function\s+([a-zA-Z_0-9]+)\s*\()/);
    if (m) { heads.push({ name: m[1] || m[2], start: i }); }
});
heads.forEach(function (h, i) {
    h.end = (i + 1 < heads.length) ? heads[i + 1].start : lines.length;
});

// **표로 대입되는 함수도 센다.**
//
// BODY_TABLES / BODY_UPDATES 처럼 표를 두고 exports[name] = 생성자(...) 로
// 만드는 것들은 위 정규식에 안 걸린다. 그것을 빼먹으면 29개 함수가 생성자
// 2개로 접혀 전환율이 부풀려진다 — 실제로 63% -> 95% 로 뛰었는데 그중 상당
// 부분이 "함수가 사라진" 착시였다. 표의 키를 세어 되돌려 놓는다.
//
// 이 함수들은 정의상 전부 파사드를 쓴다(생성자가 하나뿐이다).
var tableAssigned = [];
var src2 = lines.join('\n');
(src2.match(/^var (BODY_\w+) = \{[\s\S]*?^\};/gm) || []).forEach(function (block) {
    (block.match(/^\s{4}([a-zA-Z_0-9]+)\s*:/gm) || []).forEach(function (k) {
        tableAssigned.push(k.trim().replace(':', ''));
    });
});

// 주석 줄은 세지 않는다 — 주석 안의 SQL 예시에 걸리면 숫자가 거짓이 된다.
function isComment(l) { return /^\s*(\/\/|\*|\/\*)/.test(l); }

var facade = [], hand = [], both = [], none = [], dialect = [];

heads.forEach(function (h) {
    var body = lines.slice(h.start, h.end).filter(function (l) {
        return !isComment(l);
    }).join('\n');

    var usesFacade = /facade\.(k|raw|run|execRaw|transaction)\(/.test(body);
    // 손으로 쓴 SQL 은 util.format 조립 + 구 실행자(db.getResult)로 판별한다.
    var usesHand = /util\.format\(/.test(body) || /\bdb(_sqlite)?\.getResult\(/.test(body);

    if (usesFacade && usesHand) { both.push(h.name); }
    else if (usesFacade) { facade.push(h.name); }
    else if (usesHand) { hand.push(h.name); }
    else { none.push(h.name); }

    // 새 백엔드에서 곧바로 깨지는 구문들.
    var d = [];
    if (/ON DUPLICATE KEY/i.test(body)) { d.push('ON DUPLICATE KEY'); }
    if (/\bIFNULL\(/i.test(body)) { d.push('IFNULL'); }
    if (/SET GLOBAL/i.test(body)) { d.push('SET GLOBAL'); }
    if (/GROUP_CONCAT/i.test(body)) { d.push('GROUP_CONCAT'); }
    if (/STRAIGHT_JOIN/i.test(body)) { d.push('STRAIGHT_JOIN'); }
    if (/update\s+\w+\s*,\s*\w+\s+set/i.test(body)) { d.push('다중테이블 UPDATE'); }
    if (/\.escape\(/.test(body)) { d.push('conn.escape()'); }
    if (/`/.test(body.replace(/facade[\s\S]*?\n/g, ''))) { d.push('백틱 식별자(확인 요)'); }
    if (/LIMIT\s+%s\s*,\s*%s/i.test(body)) { d.push('LIMIT n,m'); }
    if (d.length) { dialect.push({ name: h.name, what: d }); }
});

// 표로 대입된 것들은 생성자 2개로 접혀 있으므로, 생성자를 빼고 표의 키 수를
// 더한다. 안 그러면 "함수가 사라진" 착시가 전환율로 새어 든다.
var GENERATORS = ['make_body_insert', 'make_body_update'];
var facadeCount = facade.filter(function (n) {
    return GENERATORS.indexOf(n) < 0;
}).length + tableAssigned.length;

var emitting = facadeCount + hand.length + both.length;

console.log('파일: ' + P);
console.log('함수 총계(표 대입 포함): ' + (heads.length - GENERATORS.length + tableAssigned.length));
console.log('  파사드만        : ' + facadeCount +
            (tableAssigned.length ? '  (표로 대입된 ' + tableAssigned.length + '개 포함)' : ''));
console.log('  손으로 쓴 SQL만 : ' + hand.length);
console.log('  섞임            : ' + both.length);
console.log('  SQL 없음        : ' + none.length);
console.log('');
console.log('전환율: ' + facadeCount + ' / ' + emitting + ' (' +
            Math.round(facadeCount / emitting * 100) + '%)  — SQL 을 내는 함수 기준');
console.log('');

if (dialect.length === 0) {
    console.log('방언 종속 구문: 없음');
} else {
    console.log('방언 종속 구문이 남은 함수 (' + dialect.length + '개):');
    dialect.forEach(function (d) { console.log('  ' + d.name + ' — ' + d.what.join(', ')); });
}

if (LIST) {
    console.log('');
    console.log('아직 손으로 쓴 SQL (' + hand.length + '):');
    hand.forEach(function (n) { console.log('  ' + n); });
}
