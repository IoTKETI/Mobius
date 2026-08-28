'use strict';
// app.js 의 resultStatusCode 리터럴에서 mobius/reason.js 를 생성한다.
//
//   node tools/response-golden/gen-reason.js > mobius/reason.js
//
// 93개를 손으로 옮기면 전사 오류가 난다 (Task 2 에서 COAP_ONLY 7개가 실제로
// 그랬다). 표를 평가해 런타임 값을 그대로 옮긴다.
//
// 한 번 생성해 커밋하면 끝이다. 이 스크립트는 값이 어디서 왔는지 남기는
// 근거이자, 나중에 원본과 다시 대조할 때 쓰는 도구다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const rsc = require(path.join(ROOT, 'mobius', 'rsc.js'));

// ── app.js 의 리터럴을 평가한다 (소스 텍스트가 아니라 런타임 값이 필요하다)
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const startIdx = src.indexOf('var resultStatusCode = {');
if (startIdx < 0) { console.error('resultStatusCode 리터럴이 없다 — 이미 생성본으로 바뀌었나?'); process.exit(1); }

let depth = 0, endIdx = -1;
for (let i = src.indexOf('{', startIdx); i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
}
const literal = src.slice(src.indexOf('{', startIdx), endIdx);
const table = new Function('return (' + literal + ');')();
const keys = Object.keys(table);          // 원본 순서 유지 (상태코드별 묶음이 읽기 좋다)

// ── 각 항목을 카탈로그 항목에 붙인다
const lines = [];
const unresolved = [];
let prevPrefix = null;

keys.forEach(function (key) {
    const row = table[key];
    const http = row[0], code = row[1], msg = row[2];
    const cat = rsc.byPair(http, code);
    if (!cat) { unresolved.push(key + ' (http ' + http + ' / rsc ' + code + ')'); return; }

    // 상태코드가 바뀌는 자리에 빈 줄을 넣어 원본의 묶음을 유지한다
    const prefix = key.split('-')[0];
    if (prevPrefix !== null && prefix !== prevPrefix) { lines.push(''); }
    prevPrefix = prefix;

    lines.push("    '" + key + "': { code: RSC." + cat.name + ", msg: " + JSON.stringify(msg) + " },");
});

if (unresolved.length) {
    console.error('카탈로그에서 못 찾은 항목:\n  ' + unresolved.join('\n  '));
    process.exit(1);
}

// 마지막 항목의 쉼표 제거
for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]) { lines[i] = lines[i].replace(/,$/, ''); break; }
}

const out = `'use strict';
//
// 사유 카탈로그 — 무엇이 잘못됐는가
//
// RSC 카탈로그(mobius/rsc.js)가 "어떤 결과 코드인가"를 담는다면, 여기는
// "왜 그 코드가 났는가"를 담는다. 한 결과 코드를 여러 사유가 공유한다
// (BAD_REQUEST 하나에 사유 48개).
//
// ─────────────────────────────────────────────────────────────────────────
// 키는 아직 '400-8' 같은 옛 이름 그대로다. 의미 있는 이름으로 바꾸는 것은
// 별도 단계에서 한다 — 구조 변경과 개명을 같이 하면 회귀가 났을 때 원인을
// 가릴 수 없다.
//
// 문구도 아직 손대지 않는다. 접두어('BAD REQUEST: ' 등)가 msg 에 그대로
// 들어 있고, 오타와 이스케이프 잔재도 원본 그대로다. 값 보존이 우선이다.
//
// 이 파일은 생성물이다:  node tools/response-golden/gen-reason.js > mobius/reason.js
// ─────────────────────────────────────────────────────────────────────────

var RSC = require('./rsc').RSC;

var REASON = {
${lines.join('\n')}
};

// app.js 가 쓰던 { key: [status, rsc, msg] } 형태를 그대로 만들어 준다.
// 호출부 60곳(직접 인덱싱 47 + 래퍼 13)이 바뀌지 않고 동작한다.
// status 는 문자열이어야 한다 — 기존 표가 '400' 처럼 문자열이었다.
function toLegacyTable() {
    var out = {};
    Object.keys(REASON).forEach(function (k) {
        var r = REASON[k];
        out[k] = [String(r.code.http), r.code.rsc, r.msg];
    });
    return out;
}

// 사유 하나를 꺼낸다. 없으면 null (호출부가 판단한다).
function get(key) {
    return Object.prototype.hasOwnProperty.call(REASON, key) ? REASON[key] : null;
}

module.exports = {
    REASON: REASON,
    toLegacyTable: toLegacyTable,
    get: get
};
`;

process.stdout.write(out);
console.error('사유 ' + keys.length + '개 생성');
