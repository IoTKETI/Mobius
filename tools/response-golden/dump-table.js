'use strict';
// app.js 의 resultStatusCode 리터럴을 파싱해 {key: [status, rsc, msg]} 스냅샷을 만든다.
//
//   node tools/response-golden/dump-table.js tools/response-golden/out/table-before.json
//
// app.js 를 require 하지 않는다 — require 하면 서버가 뜬다. 소스를 읽어 파싱한다.
// 이 스냅샷이 1층(정적 동등성) 검증의 기준이며 93개 코드를 100% 덮는다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app.js');
const OUT = process.argv[2];

const src = fs.readFileSync(APP, 'utf8');

const START = 'var resultStatusCode = {';
const startIdx = src.indexOf(START);
if (startIdx < 0) {
    console.error('resultStatusCode 리터럴을 찾지 못했다. app.js 구조가 바뀌었는지 확인할 것.');
    process.exit(1);
}
// 리터럴의 끝: 열린 중괄호와 짝이 맞는 닫는 중괄호
let depth = 0, endIdx = -1;
for (let i = src.indexOf('{', startIdx); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
        depth--;
        if (depth === 0) { endIdx = i + 1; break; }
    }
}
if (endIdx < 0) {
    console.error('resultStatusCode 리터럴의 끝을 찾지 못했다.');
    process.exit(1);
}
const tbl = src.slice(startIdx, endIdx);

// '400-8': ['400', '4000', "메시지"]
const RE = /'(\d{3}-\d+)'\s*:\s*\[\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g;

const table = {};
let m, count = 0;
while ((m = RE.exec(tbl)) !== null) {
    if (Object.prototype.hasOwnProperty.call(table, m[1])) {
        console.error('중복 키: ' + m[1] + ' — 뒤의 정의가 앞을 덮는다');
    }
    table[m[1]] = [m[2], m[3], m[4]];
    count++;
}

// 표에 있는 키 개수와 파싱된 개수가 다르면 정규식이 놓친 항목이 있다는 뜻이다.
const declared = (tbl.match(/^\s*'\d{3}-\d+'\s*:/gm) || []).length;
if (declared !== count) {
    console.error('파싱 누락: 선언 ' + declared + '개 중 ' + count + '개만 읽었다.');
    process.exit(1);
}

// 키 정렬로 출력을 안정화한다 — diff 가 의미를 갖도록
const sorted = {};
Object.keys(table).sort().forEach(function (k) { sorted[k] = table[k]; });

const json = JSON.stringify(sorted, null, 2) + '\n';

if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json);
    console.error('코드 ' + count + '개 -> ' + OUT);
} else {
    process.stdout.write(json);
    console.error('코드 ' + count + '개');
}
