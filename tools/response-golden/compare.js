'use strict';
// 두 스냅샷을 비교한다. 정적(table-*.json)·런타임(runtime-*.json) 양쪽에 쓴다.
//
//   node tools/response-golden/compare.js out/table-before.json out/table-after.json
//
// 차이가 없으면 exit 0, 있으면 차이를 출력하고 exit 1.
// 목적은 "통과"가 아니라 차이 목록 확보다. 의도한 차이인지는 사람이 판단한다.

const fs = require('fs');

const A = process.argv[2], B = process.argv[3];
if (!A || !B) {
    console.error('usage: node compare.js <before.json> <after.json>');
    process.exit(2);
}

function load(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.error('읽지 못했다: ' + p + ' (' + e.message + ')'); process.exit(2); }
}

const a = load(A), b = load(B);
const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort();

const onlyA = [], onlyB = [], changed = [];
keys.forEach(function (k) {
    const inA = Object.prototype.hasOwnProperty.call(a, k);
    const inB = Object.prototype.hasOwnProperty.call(b, k);
    if (inA && !inB) { onlyA.push(k); return; }
    if (!inA && inB) { onlyB.push(k); return; }
    const sa = JSON.stringify(a[k]), sb = JSON.stringify(b[k]);
    if (sa !== sb) { changed.push({ key: k, before: a[k], after: b[k] }); }
});

console.log('before: ' + A + '  (' + Object.keys(a).length + '개)');
console.log('after : ' + B + '  (' + Object.keys(b).length + '개)');
console.log('');

if (!onlyA.length && !onlyB.length && !changed.length) {
    console.log('차이 없음 — 동등');
    process.exit(0);
}

if (onlyA.length) {
    console.log('== before 에만 있음 (' + onlyA.length + ') ==');
    onlyA.forEach(function (k) { console.log('  - ' + k + '  ' + JSON.stringify(a[k])); });
    console.log('');
}
if (onlyB.length) {
    console.log('== after 에만 있음 (' + onlyB.length + ') ==');
    onlyB.forEach(function (k) { console.log('  + ' + k + '  ' + JSON.stringify(b[k])); });
    console.log('');
}
if (changed.length) {
    console.log('== 값이 달라짐 (' + changed.length + ') ==');
    changed.forEach(function (c) {
        console.log('  ~ ' + c.key);
        console.log('      before: ' + JSON.stringify(c.before));
        console.log('      after : ' + JSON.stringify(c.after));
    });
    console.log('');
}

console.log('총 차이 ' + (onlyA.length + onlyB.length + changed.length) + '건');
process.exit(1);
