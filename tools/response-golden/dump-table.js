'use strict';
// 결과 코드 표를 {key: [status, rsc, msg]} 스냅샷으로 뽑는다.
//
//   node tools/response-golden/dump-table.js tools/response-golden/out/table-before.json
//
// 이 스냅샷이 1층(정적 동등성) 검증의 기준이며 93개 코드를 100% 덮는다.
//
// ── 왜 정규식 캡처가 아니라 평가(eval)인가 ────────────────────────────────
// 표의 문구에는 "BAD REQUEST: \'Not Present\' attribute" 처럼 불필요한
// 이스케이프가 남아 있다. JS 는 이걸 '  로 해석하므로 소스 텍스트와 런타임
// 값이 다르다. 정규식으로 원문을 긁으면 소스 텍스트가 잡힌다.
//
// 우리가 비교해야 하는 것은 "클라이언트에게 나가는 값"이므로 런타임 값이어야
// 한다. 그래야 표를 생성물로 바꾼 뒤(Task 3)에도 같은 기준으로 비교된다.
//
// 표가 app.js 에 리터럴로 남아 있으면 그 리터럴만 떼어 평가하고,
// 사라졌으면 mobius/reason.js 가 만들어 주는 표를 읽는다.
// app.js 를 require 하지 않는다 — require 하면 서버가 뜬다.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv[2];

function fromAppLiteral() {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const startIdx = src.indexOf('var resultStatusCode = {');
    if (startIdx < 0) { return null; }

    let depth = 0, endIdx = -1;
    for (let i = src.indexOf('{', startIdx); i < src.length; i++) {
        if (src[i] === '{') { depth++; }
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) { endIdx = i + 1; break; }
        }
    }
    if (endIdx < 0) { throw new Error('resultStatusCode 리터럴의 끝을 찾지 못했다'); }

    const literal = src.slice(src.indexOf('{', startIdx), endIdx);
    // 문자열 배열만 든 객체 리터럴이다. 우리 소스이므로 평가해도 안전하다.
    const table = new Function('return (' + literal + ');')();

    // 선언 수와 평가 결과 수가 다르면 리터럴을 잘못 떼었다는 뜻이다.
    const declared = (literal.match(/^\s*'\d{3}-\d+'\s*:/gm) || []).length;
    if (declared !== Object.keys(table).length) {
        throw new Error('파싱 누락: 선언 ' + declared + '개, 평가 ' + Object.keys(table).length + '개');
    }
    return { table: table, source: 'app.js 리터럴' };
}

function fromReason() {
    const reason = require(path.join(ROOT, 'mobius', 'reason.js'));
    return { table: reason.toLegacyTable(), source: 'mobius/reason.js' };
}

let got = fromAppLiteral();
if (!got) {
    try { got = fromReason(); }
    catch (e) {
        console.error('app.js 에 리터럴이 없고 mobius/reason.js 도 읽지 못했다: ' + e.message);
        process.exit(1);
    }
}

// 키 정렬로 출력을 안정화한다 — diff 가 의미를 갖도록
const sorted = {};
Object.keys(got.table).sort().forEach(function (k) { sorted[k] = got.table[k]; });

const json = JSON.stringify(sorted, null, 2) + '\n';

if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json);
    console.error('코드 ' + Object.keys(sorted).length + '개 (' + got.source + ') -> ' + OUT);
} else {
    process.stdout.write(json);
    console.error('코드 ' + Object.keys(sorted).length + '개 (' + got.source + ')');
}
