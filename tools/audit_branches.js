// sql_action.js 의 `if (global.usesqlite === 'true') { ... } else { ... }` 분기를 전수 분류한다.
//
// v1 은 문자열 리터럴을 정규식으로 긁어 .replace(/'/g,...) 같은 JS 코드를 SQL 로 오인했다.
// v2 는 util.format(...) 의 첫 인자(포맷 템플릿)와 템플릿 리터럴만 추출한다.
// 템플릿은 '...' + '...' 형태로 이어붙여진 경우가 많아 연결을 복원한다.
//
// 판정:
//   fake  - 양쪽 SQL 템플릿 집합이 동일 (이스케이프/실행자만 다름) -> 기계적 병합 가능
//   real  - 템플릿이 다르거나 개수가 다름 -> 개별 검토 필요
//   dialect - 템플릿 차이가 알려진 방언 차이뿐 (ON CONFLICT vs ON DUPLICATE KEY 등) -> knex 가 흡수
//   sqlite-only - else 블록이 없음
var fs = require('fs');

var src = fs.readFileSync(process.argv[2], 'utf8');
var lines = src.split('\n');

var fnAt = [];
lines.forEach(function (l, i) {
    var m = l.match(/^exports\.([A-Za-z0-9_]+)\s*=/);
    if (m) fnAt.push({ line: i, name: m[1] });
});
function fnNameFor(idx) {
    var name = '(top-level)';
    for (var i = 0; i < fnAt.length; i++) {
        if (fnAt[i].line <= idx) name = fnAt[i].name; else break;
    }
    return name;
}

function blockEnd(startIdx) {
    var depth = 0, started = false;
    for (var i = startIdx; i < lines.length; i++) {
        for (var c = 0; c < lines[i].length; c++) {
            var ch = lines[i][c];
            if (ch === '{') { depth++; started = true; }
            else if (ch === '}') { depth--; if (started && depth === 0) return i; }
        }
    }
    return lines.length - 1;
}

// util.format( 의 첫 인자를 읽는다.
// 포맷 문자열 자체가 쉼표를 담고 있으므로("insert into t (a, b)") 문자열 리터럴을
// 건너뛰지 않으면 첫 쉼표에서 잘못 끊긴다. 따옴표 상태를 추적한다.
function extractFormatTemplates(text) {
    var out = [];
    var idx = 0;
    while ((idx = text.indexOf('util.format(', idx)) !== -1) {
        var i = idx + 'util.format('.length;
        var depth = 1, buf = '', quote = null;
        while (i < text.length) {
            var ch = text[i];

            if (quote) {
                buf += ch;
                if (ch === '\\') { buf += text[i + 1] || ''; i += 2; continue; }
                if (ch === quote) quote = null;
                i++;
                continue;
            }

            if (ch === "'" || ch === '"' || ch === '`') { quote = ch; buf += ch; i++; continue; }
            if (ch === '(') depth++;
            else if (ch === ')') { depth--; if (depth === 0) break; }
            else if (depth === 1 && ch === ',') break;   // 첫 인자 끝
            buf += ch;
            i++;
        }
        out.push(buf);
        idx = i + 1;
    }
    return out;
}

// 백틱 템플릿 리터럴 (search_lookup_sqlite 등)
function extractTemplateLiterals(text) {
    var out = [], re = /`([\s\S]*?)`/g, m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);
    return out;
}

// 'a' + 'b' 형태를 이어붙이고 정규화
function normalizeTemplate(raw) {
    var parts = [], re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g, m;
    while ((m = re.exec(raw)) !== null) parts.push(m[1] !== undefined ? m[1] : m[2]);
    var s = parts.join('');
    if (!s) s = raw;
    return s
        .replace(/\$\{[^}]*\}/g, 'V')
        .replace(/%[sdj]/g, 'V')
        .replace(/\\'/g, "'")
        .replace(/`/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function sqlOf(text) {
    return extractFormatTemplates(text).concat(extractTemplateLiterals(text))
        .map(normalizeTemplate)
        .filter(function (s) {
            return /^(select|insert|update|delete|with|replace)\b/.test(s);
        });
}

// 알려진 방언 차이만으로 설명되는가?
function dialectOnly(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
        var x = a[i].replace(/on conflict\s*\([^)]*\)\s*do update set/g, 'UPSERT')
                    .replace(/on duplicate key update/g, 'UPSERT')
                    .replace(/\s+for update(\s+nowait)?/g, '');
        var y = b[i].replace(/on conflict\s*\([^)]*\)\s*do update set/g, 'UPSERT')
                    .replace(/on duplicate key update/g, 'UPSERT')
                    .replace(/\s+for update(\s+nowait)?/g, '');
        if (x !== y) return false;
    }
    return true;
}

var results = [];
for (var i = 0; i < lines.length; i++) {
    if (!/if\s*\(\s*global\.usesqlite\s*===?\s*'true'\s*\)/.test(lines[i])) continue;

    var ifEnd = blockEnd(i);
    var elseStart = -1;
    for (var j = ifEnd; j < Math.min(ifEnd + 4, lines.length); j++) {
        if (/\belse\b/.test(lines[j])) { elseStart = j; break; }
    }

    var aText = lines.slice(i, ifEnd + 1).join('\n');
    var bText = elseStart >= 0 ? lines.slice(elseStart, blockEnd(elseStart) + 1).join('\n') : '';
    var a = sqlOf(aText), b = sqlOf(bText);

    // 분기 안에 SQL 이 없고 실행자 호출만 있는 경우가 가장 흔하다.
    // SQL 은 if 밖에서 만들어 두고 분기는 sqlite.getResult / db.getResult 만 고른다.
    // 이건 "못 읽은 것"이 아니라 가장 순수한 가짜 분기다.
    var execOnly = /\b(sqlite|db)\.getResult\s*\(/.test(aText) && /\b(sqlite|db)\.getResult\s*\(/.test(bText);

    var kind;
    if (elseStart < 0) kind = 'sqlite-only';
    else if (a.length === 0 && b.length === 0) kind = execOnly ? 'executor-only' : 'unparsed';
    else if (a.join('|') === b.join('|')) kind = 'fake';
    else if (dialectOnly(a, b)) kind = 'dialect';
    else kind = 'real';

    results.push({ line: i + 1, fn: fnNameFor(i), kind: kind, a: a, b: b });
}

var by = { 'executor-only': [], fake: [], dialect: [], real: [], 'sqlite-only': [], unparsed: [] };
results.forEach(function (r) { by[r.kind].push(r); });

console.log('분기 총 ' + results.length + '개\n');
console.log('  [기계적 병합 가능]');
console.log('    executor-only ' + by['executor-only'].length + '  SQL 은 분기 밖, 실행자만 선택');
console.log('    fake          ' + by.fake.length + '  분기 안 SQL 이 동일 (이스케이프만 다름)');
console.log('    dialect       ' + by.dialect.length + '  방언 차이뿐 → knex 가 흡수');
console.log('  [개별 검토 필수]');
console.log('    real          ' + by.real.length + '  SQL 자체가 다름');
console.log('    sqlite-only   ' + by['sqlite-only'].length + '  else 없음');
console.log('    unparsed      ' + by.unparsed.length + '  도구가 판정 못 함 → 수동 확인');

['real', 'sqlite-only', 'unparsed', 'dialect', 'fake', 'executor-only'].forEach(function (k) {
    if (!by[k].length) return;
    console.log('\n──── ' + k + ' ────');
    by[k].forEach(function (r) { console.log('  L' + String(r.line).padEnd(6) + r.fn); });
});

if (process.argv[3] === '--detail') {
    console.log('\n════ real / sqlite-only 상세 ════');
    by.real.concat(by['sqlite-only']).forEach(function (r) {
        console.log('\n[' + r.fn + '] L' + r.line + '  (' + r.kind + ')');
        console.log('  sqlite:'); r.a.forEach(function (s) { console.log('    ' + s.slice(0, 200)); });
        console.log('  mysql :'); r.b.forEach(function (s) { console.log('    ' + s.slice(0, 200)); });
    });
}
