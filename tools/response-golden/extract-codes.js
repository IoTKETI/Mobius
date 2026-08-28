'use strict';
// 현재 코드베이스에 흩어진 결과 코드를 한자리에 모아 보여 준다.
// mobius/rsc.js 카탈로그의 값이 어디서 왔는지 확인하는 근거 도구다.
//
//   node tools/response-golden/extract-codes.js
//
// 출처 세 곳
//   1. app.js  resultStatusCode        rsc -> (http, 메시지)
//   2. pxy_coap.js  coap_rsc_code      rsc -> CoAP 코드
//   3. responder.* 호출부 리터럴        성공 코드 (status, rsc) 쌍

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); };

// ── 1) resultStatusCode
const app = read('app.js');
const tblStart = app.indexOf('var resultStatusCode');
const tbl = app.slice(tblStart, app.indexOf('function response_error_result', tblStart));

const ROW = /'(\d{3}-\d+)'\s*:\s*\[\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g;
const byRsc = {};
const byPair = {};          // (http, rsc) 쌍 -> 그 쌍을 쓰는 키 목록
let m, rows = 0;
while ((m = ROW.exec(tbl)) !== null) {
    rows++;
    const rsc = m[3];
    if (!byRsc[rsc]) { byRsc[rsc] = { https: new Set(), msgs: [], keys: [] }; }
    byRsc[rsc].https.add(m[2]);
    byRsc[rsc].msgs.push(m[4]);
    byRsc[rsc].keys.push(m[1]);

    const pair = m[2] + '|' + m[3];
    if (!byPair[pair]) { byPair[pair] = []; }
    byPair[pair].push(m[1]);
}

// ── 2) coap_rsc_code
const coapSrc = read('pxy_coap.js');
const cStart = coapSrc.indexOf('var coap_rsc_code');
const cTbl = coapSrc.slice(cStart, coapSrc.indexOf('}', cStart));
const coap = {};
let c;
const CROW = /'(\d{4})'\s*:\s*'([^']*)'/g;
while ((c = CROW.exec(cTbl)) !== null) { coap[c[1]] = c[2]; }

// ── 3) 성공 코드 (responder 호출부 리터럴)
const files = ['app.js'].concat(
    fs.readdirSync(path.join(ROOT, 'mobius')).filter(function (f) { return f.endsWith('.js'); })
        .map(function (f) { return 'mobius/' + f; }));
const success = {};
const CALL = /responder\.(?:response_result|response_rcn3_result|search_result|error_result)\s*\(\s*[^,]+,\s*[^,]+,\s*'(\d{3})'\s*,\s*'(\d{4})'/g;
files.forEach(function (f) {
    let s;
    try { s = read(f); } catch (e) { return; }
    let k;
    while ((k = CALL.exec(s)) !== null) {
        if (k[2][0] === '2' || k[2][0] === '1') { success[k[2]] = k[1]; }
    }
});

// ── 출력
console.log('=== 1) resultStatusCode 가 쓰는 rsc (' + rows + '행) ===');
console.log('rsc    http        건수  CoAP    대표 메시지');
console.log('-'.repeat(104));
Object.keys(byRsc).sort().forEach(function (r) {
    const e = byRsc[r];
    console.log(
        r.padEnd(7) +
        Array.from(e.https).sort().join(',').padEnd(12) +
        String(e.keys.length).padEnd(6) +
        (coap[r] || '(없음)').padEnd(8) +
        e.msgs[0].slice(0, 58));
});

console.log('');
console.log('=== 2) 성공 코드 (호출부 리터럴) ===');
Object.keys(success).sort().forEach(function (r) {
    console.log('  rsc ' + r + ' -> http ' + success[r] + '   CoAP ' + (coap[r] || '(없음)'));
});

console.log('');
console.log('=== 3) CoAP 표에만 있고 resultStatusCode 에는 없는 rsc ===');
const onlyCoap = Object.keys(coap).filter(function (r) { return !byRsc[r] && !success[r]; }).sort();
console.log('  ' + (onlyCoap.join(', ') || '없음'));

console.log('');
console.log('=== 4) CoAP 매핑이 없는 rsc (D19) ===');
const noCoap = Object.keys(byRsc).concat(Object.keys(success))
    .filter(function (r) { return !coap[r]; }).sort();
console.log('  ' + (noCoap.join(', ') || '없음'));

console.log('');
console.log('=== 5) 서로 다른 (http, rsc) 쌍 — 카탈로그 항목이 될 단위 ===');
console.log('  같은 rsc 가 다른 http 로 나가는 경우가 있어 rsc 하나에 http 하나로 묶을 수 없다.');
Object.keys(byPair).sort().forEach(function (p) {
    const parts = p.split('|');
    console.log('  http ' + parts[0] + ' / rsc ' + parts[1].padEnd(6)
        + String(byPair[p].length).padEnd(4) + '건  '
        + byPair[p].slice(0, 6).join(' ') + (byPair[p].length > 6 ? ' ...' : ''));
});

console.log('');
console.log('요약: resultStatusCode rsc ' + Object.keys(byRsc).length + '종, (http,rsc) 쌍 '
    + Object.keys(byPair).length + '종, 성공 코드 ' + Object.keys(success).length
    + '종, CoAP 표 ' + Object.keys(coap).length + '종');
