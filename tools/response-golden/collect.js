'use strict';
// Merges the per-pid jsonl fragments and normalises them by case.
//   node tools/response-golden/collect.js tools/response-golden/out/runtime-before.json
//
// Normalisation
//   - entries without a label ('(unlabeled)') are dropped: cleanup calls whose count varies per run
//   - entries of a case are sorted: in a cluster the worker processing order varies per run, and without sorting the diff would move with identical content

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

function sortKey(e) {
    // A control character as separator would make git treat the file as binary; JSON serialisation is used instead.
    return JSON.stringify([e.fn, e.status, e.rsc, e.dbg, e.method]);
}

function collect(outPath) {
    const rows = [];
    fs.readdirSync(OUT_DIR)
        .filter(function (f) { return /^resp-\d+\.jsonl$/.test(f); })
        .forEach(function (f) {
            fs.readFileSync(path.join(OUT_DIR, f), 'utf8')
                .split('\n')
                .filter(Boolean)
                .forEach(function (line) {
                    try { rows.push(JSON.parse(line)); } catch (e) { /* ignore truncated lines */ }
                });
        });

    const byCase = {};
    rows.forEach(function (r) {
        if (r.case === '(unlabeled)') { return; }
        if (!byCase[r.case]) { byCase[r.case] = []; }
        byCase[r.case].push({
            fn: r.fn,
            status: r.status,
            rsc: r.rsc,
            dbg: (r.arg5 === undefined) ? null : r.arg5,
            method: r.method
        });
    });

    const snapshot = {};
    Object.keys(byCase).sort().forEach(function (c) {
        snapshot[c] = byCase[c].sort(function (a, b) {
            const ka = sortKey(a), kb = sortKey(b);
            return ka < kb ? -1 : (ka > kb ? 1 : 0);
        });
    });

    const json = JSON.stringify(snapshot, null, 2) + '\n';
    if (outPath) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, json);
    } else {
        process.stdout.write(json);
    }

    const combos = new Set();
    Object.keys(snapshot).forEach(function (c) {
        snapshot[c].forEach(function (e) { combos.add(e.status + '/' + e.rsc); });
    });
    console.error('케이스 ' + Object.keys(snapshot).length
        + '개, 서로 다른 (status,rsc) 조합 ' + combos.size + '종'
        + (outPath ? ' -> ' + outPath : ''));
    console.error('  조합: ' + Array.from(combos).sort().join(', '));
    return snapshot;
}

module.exports = { collect: collect };

if (require.main === module) {
    collect(process.argv[2]);
}
