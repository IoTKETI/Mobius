'use strict';
//   node tools/discovery-compare/compare.js before.json after.json
const fs = require('fs');
const a = process.argv[2], b = process.argv[3];
if (!a || !b) { console.error('usage: node compare.js <before.json> <after.json>'); process.exit(1); }

const A = JSON.parse(fs.readFileSync(a, 'utf8'));
const B = JSON.parse(fs.readFileSync(b, 'utf8'));
const keys = Array.from(new Set(Object.keys(A).concat(Object.keys(B))));

let diff = 0;
console.log('before: ' + a + '  (' + Object.keys(A).length + '개)');
console.log('after : ' + b + '  (' + Object.keys(B).length + '개)');
console.log('');

for (const k of keys) {
    const x = A[k], y = B[k];
    if (x === undefined) { console.log('  + ' + k + ' (after 에만)'); diff++; continue; }
    if (y === undefined) { console.log('  - ' + k + ' (before 에만)'); diff++; continue; }
    const sx = JSON.stringify(x), sy = JSON.stringify(y);
    if (sx === sy) { continue; }
    diff++;
    console.log('  ~ ' + k);
    if (x.status !== y.status) {
        console.log('      status: ' + x.status + ' -> ' + y.status);
    }
    if (x.uril && y.uril) {
        const only_a = x.uril.filter((v) => y.uril.indexOf(v) < 0);
        const only_b = y.uril.filter((v) => x.uril.indexOf(v) < 0);
        console.log('      건수: ' + x.uril.length + ' -> ' + y.uril.length);
        if (only_a.length) { console.log('      before 에만: ' + only_a.join(', ')); }
        if (only_b.length) { console.log('      after  에만: ' + only_b.join(', ')); }
    }
    else {
        console.log('      before: ' + sx);
        console.log('      after : ' + sy);
    }
}
console.log('');
console.log('총 차이 ' + diff + '건');
process.exit(diff ? 1 : 0);
