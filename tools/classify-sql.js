'use strict';
// Classifies the functions of sql_action.js as 'converted to the facade' or 'hand-written SQL' and prints the conversion ratio.
//
//   node tools/classify-sql.js mobius/sql_action.js
//   node tools/classify-sql.js mobius/sql_action.js --list   (with function names)

var fs = require('fs');

var P = process.argv[2] || 'mobius/sql_action.js';
var LIST = process.argv.indexOf('--list') >= 0;

var lines = fs.readFileSync(P, 'utf8').split('\n');

// Marks the lines inside block comments (/* ... */). Otherwise a commented-out function would be counted as live; filtering lines starting with * is not enough because code lines inside a comment do not look like that.
var inBlock = new Array(lines.length).fill(false);
(function () {
    var open = false;
    lines.forEach(function (l, i) {
        var t = l.trim();
        if (!open && /^\/\*/.test(t) && !/\*\//.test(t)) { open = true; inBlock[i] = true; return; }
        if (open) {
            inBlock[i] = true;
            if (/\*\//.test(t)) { open = false; }
        }
    });
})();

// Function boundaries: both exports.foo = function and function foo( are matched.
var heads = [];
lines.forEach(function (l, i) {
    if (inBlock[i]) { return; }
    var m = l.match(/^(?:exports\.([a-zA-Z_0-9]+)\s*=\s*function|function\s+([a-zA-Z_0-9]+)\s*\()/);
    if (m) { heads.push({ name: m[1] || m[2], start: i }); }
});
heads.forEach(function (h, i) {
    h.end = (i + 1 < heads.length) ? heads[i + 1].start : lines.length;
});

// Functions assigned from a table are counted too.
//
// Those made as exports[name] = generator(...) from a table (BODY_TABLES / BODY_UPDATES) do not match the regex above. Leaving them out would fold many functions into two generators and inflate the ratio, so the table keys are counted. By definition they all use the facade (there is one generator).
var tableAssigned = [];
var src2 = lines.join('\n');
(src2.match(/^var (BODY_\w+) = \{[\s\S]*?^\};/gm) || []).forEach(function (block) {
    (block.match(/^\s{4}([a-zA-Z_0-9]+)\s*:/gm) || []).forEach(function (k) {
        tableAssigned.push(k.trim().replace(':', ''));
    });
});

// Comment lines are not counted; SQL examples inside comments would falsify the numbers.
function isComment(l) { return /^\s*(\/\/|\*|\/\*)/.test(l); }

var facade = [], hand = [], both = [], none = [], dialect = [];

heads.forEach(function (h) {
    var body = lines.slice(h.start, h.end).filter(function (l) {
        return !isComment(l);
    }).join('\n');

    var usesFacade = /facade\.(k|raw|run|execRaw|transaction)\(/.test(body);
    // Hand-written SQL is recognised by util.format assembly and the old executor (db.getResult).
    var usesHand = /util\.format\(/.test(body) || /\bdb(_sqlite)?\.getResult\(/.test(body);

    if (usesFacade && usesHand) { both.push(h.name); }
    else if (usesFacade) { facade.push(h.name); }
    else if (usesHand) { hand.push(h.name); }
    else { none.push(h.name); }

    // Constructs that break immediately on another backend.
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

// Table-assigned functions are folded into two generators, so the generators are subtracted and the table keys added; otherwise the 'vanished functions' illusion leaks into the ratio.
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
