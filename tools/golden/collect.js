'use strict';
// pid 별 jsonl 조각을 모아 정규화하고, 형태별로 세어 요약한다.
//   node tools/golden/collect.js tools/golden/out/before-sqlite.json

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');
const OUT = process.argv[2];

if (!OUT) {
    console.error('usage: node collect.js <output.json>');
    process.exit(1);
}

// 값 자리는 형태가 무엇이든(문자열 리터럴 / ? 바인딩 / 맨숫자) 같은 토큰으로 만든다.
// 그래야 파라미터 바인딩 전환 전후의 SQL 이 같은 형태로 비교된다.
function shape(sql) {
    return sql
        .replace(/'(?:[^'\\]|\\.)*'/g, 'V')   // 문자열 리터럴
        .replace(/\?/g, 'V')                   // 바인딩 자리
        .replace(/\b\d+\b/g, 'V')              // 숫자 리터럴
        .replace(/`/g, '')                     // 식별자 인용
        .replace(/"/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

const counts = new Map();
let total = 0;

fs.readdirSync(OUT_DIR)
    .filter(function (f) { return /^sql-\d+\.jsonl$/.test(f); })
    .forEach(function (f) {
        fs.readFileSync(path.join(OUT_DIR, f), 'utf8')
            .split('\n')
            .filter(Boolean)
            .forEach(function (line) {
                let rec;
                try { rec = JSON.parse(line); } catch (e) { return; }
                const key = rec.backend + ' :: ' + shape(rec.sql);
                counts.set(key, (counts.get(key) || 0) + 1);
                total++;
            });
    });

const rows = Array.from(counts.entries())
    .map(function (e) { return { stmt: e[0], count: e[1] }; })
    .sort(function (x, y) { return x.stmt < y.stmt ? -1 : x.stmt > y.stmt ? 1 : 0; });

fs.writeFileSync(OUT, JSON.stringify({ total: total, distinct: rows.length, rows: rows }, null, 2), 'utf8');
console.log('SQL ' + total + '건 / 고유 형태 ' + rows.length + '종 -> ' + OUT);
