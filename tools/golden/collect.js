'use strict';
// Merges the per-pid jsonl fragments, normalises them and counts by shape.
//   node tools/golden/collect.js tools/golden/out/before-sqlite.json

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');
const OUT = process.argv[2];

if (!OUT) {
    console.error('usage: node collect.js <output.json>');
    process.exit(1);
}

// Value positions become the same token whatever their form (string literal / ? binding / bare number), so SQL before and after the switch to parameter binding compares in the same shape.
function shape(sql) {
    return sql
        .replace(/'(?:[^'\\]|\\.)*'/g, 'V')   // string literal
        .replace(/\?/g, 'V')                   // binding placeholder
        .replace(/\b\d+\b/g, 'V')              // numeric literal
        .replace(/`/g, '')                     // identifier quoting
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
