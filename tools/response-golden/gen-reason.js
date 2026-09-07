'use strict';
// Generates mobius/reason.js from the resultStatusCode literal in app.js.
//
//   node tools/response-golden/gen-reason.js > mobius/reason.js
//
// The table is evaluated and the runtime values are carried over as they are, so there are no transcription errors.
//
// Generated once and committed; this script records where the values came from and serves to re-compare with the original later.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const rsc = require(path.join(ROOT, 'mobius', 'rsc.js'));

// ── Evaluate the literal in app.js (runtime values are needed, not source text)
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
const keys = Object.keys(table);          // original order kept (grouping by status code reads well)

// ── Attach each entry to its catalogue entry
const lines = [];
const unresolved = [];
let prevPrefix = null;

keys.forEach(function (key) {
    const row = table[key];
    const http = row[0], code = row[1], msg = row[2];
    const cat = rsc.byPair(http, code);
    if (!cat) { unresolved.push(key + ' (http ' + http + ' / rsc ' + code + ')'); return; }

    // An empty line where the status code changes keeps the original grouping
    const prefix = key.split('-')[0];
    if (prevPrefix !== null && prefix !== prevPrefix) { lines.push(''); }
    prevPrefix = prefix;

    lines.push("    '" + key + "': { code: RSC." + cat.name + ", msg: " + JSON.stringify(msg) + " },");
});

if (unresolved.length) {
    console.error('카탈로그에서 못 찾은 항목:\n  ' + unresolved.join('\n  '));
    process.exit(1);
}

// Remove the comma of the last entry
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
