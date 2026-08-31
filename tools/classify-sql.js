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

var emitting = facade.length + hand.length + both.length;

console.log('파일: ' + P);
console.log('함수 총계: ' + heads.length);
console.log('  파사드만        : ' + facade.length);
console.log('  손으로 쓴 SQL만 : ' + hand.length);
console.log('  섞임            : ' + both.length);
console.log('  SQL 없음        : ' + none.length);
console.log('');
console.log('전환율: ' + facade.length + ' / ' + emitting + ' (' +
            Math.round(facade.length / emitting * 100) + '%)  — SQL 을 내는 함수 기준');
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
