'use strict';
// 두 스냅샷을 단계별로 비교한다. 차이가 있으면 종료 코드 1.
//   node tools/equivalence/compare.js before.json after.json

const fs = require('fs');

const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

if (a.length !== b.length) {
    console.error('단계 수가 다르다: ' + a.length + ' vs ' + b.length);
    process.exit(1);
}

let diffs = 0;
for (let i = 0; i < a.length; i++) {
    if (a[i].step !== b[i].step) {
        console.error('[' + i + '] 단계 이름 불일치: ' + a[i].step + ' vs ' + b[i].step);
        diffs++;
        continue;
    }
    const x = JSON.stringify(a[i].result);
    const y = JSON.stringify(b[i].result);
    if (x !== y) {
        console.error('\n[' + a[i].step + '] 결과가 다르다');
        console.error('  before: ' + x);
        console.error('  after : ' + y);
        diffs++;
    }
}

if (diffs === 0) {
    console.log('동일 — ' + a.length + '단계 모두 일치');
    process.exit(0);
}
console.error('\n' + diffs + '단계에서 차이 발견');
process.exit(1);
