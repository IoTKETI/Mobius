'use strict';
// Compares two SQL summaries. It does not fail; it lists the changes. SQL changing with the switch to parameter binding is intended, so a person reads the list and judges.
//
//   node tools/golden/diff.js before.json after.json

const fs = require('fs');

const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

const A = new Map(a.rows.map(function (r) { return [r.stmt, r.count]; }));
const B = new Map(b.rows.map(function (r) { return [r.stmt, r.count]; }));

const gone = [], added = [], changed = [];

A.forEach(function (cnt, stmt) {
    if (!B.has(stmt)) { gone.push(stmt); }
    else if (B.get(stmt) !== cnt) { changed.push({ stmt: stmt, before: cnt, after: B.get(stmt) }); }
});
B.forEach(function (cnt, stmt) { if (!A.has(stmt)) { added.push(stmt); } });

console.log('before: ' + a.total + '건 / ' + a.distinct + '종');
console.log('after : ' + b.total + '건 / ' + b.distinct + '종');

if (gone.length) {
    console.log('\n── 사라진 SQL 형태 (' + gone.length + ') ──');
    gone.forEach(function (s) { console.log('  - ' + s); });
}
if (added.length) {
    console.log('\n── 새로 생긴 SQL 형태 (' + added.length + ') ──');
    added.forEach(function (s) { console.log('  + ' + s); });
}
if (changed.length) {
    console.log('\n── 실행 횟수가 바뀐 형태 (' + changed.length + ') ──');
    changed.forEach(function (c) { console.log('  ~ ' + c.before + ' -> ' + c.after + '  ' + c.stmt); });
}
if (!gone.length && !added.length && !changed.length) {
    console.log('\nSQL 형태와 실행 횟수가 완전히 동일하다.');
}

console.log('\n※ 이 도구는 판정하지 않는다. 변화가 의도한 것인지는 사람이 본다.');
console.log('   특히 "실행 횟수가 바뀐 형태"는 쿼리가 늘거나 줄었다는 뜻이므로 반드시 확인한다.');
