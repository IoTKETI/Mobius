'use strict';
// Dumps the result code table as a {key: [status, rsc, msg]} snapshot.
//
//   node tools/response-golden/dump-table.js tools/response-golden/out/table-before.json
//
// This snapshot is the baseline of the static equivalence check and covers every code.
//
// ── Evaluation instead of regex capture ──
// The table's wording contains escapes such as \' that JS resolves, so the source text and the runtime value differ. What is compared is the value sent to clients, so it must be the runtime value.
//
// While the table remains a literal in app.js, only that literal is extracted and evaluated; once it is gone, the table produced by mobius/reason.js is read. app.js is not required, because requiring it starts the server.

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
    // An object literal holding only string arrays, from our own source, so evaluating it is safe.
    const table = new Function('return (' + literal + ');')();

    // A mismatch between the declared count and the evaluated count means the literal was cut wrongly.
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

// Keys are sorted to stabilise the output, so a diff is meaningful
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
