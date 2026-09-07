'use strict';
// Shared piece of the source-watch tests: walks every executable file tracked in the repository.
//
// A tree rather than a list: an absence assertion ('X must not return') that relies on a hand-written file list passes silently once X moves to a file outside the list. test/core-invariants.test.js builds its invariants on this walk.
//
// git ls-files rather than readdirSync: stray files on a deployment server (dbq_tmp.js and the like) must not count as core.
//
// Comments are stripped so a word in a comment can neither pass nor fail a check.

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

let tracked = null;
function trackedJs() {
    if (!tracked) {
        tracked = cp.execFileSync('git', ['ls-files', '*.js'], { cwd: ROOT, encoding: 'utf8' })
            .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (tracked.length < 50) { throw new Error('git ls-files 가 ' + tracked.length + '개만 줬다 — 저장소가 아니거나 git 이 없다'); }
    }
    return tracked;
}

// Scopes, chosen per invariant.
//   core      app.js, mobius.js, mobius/**            request-handling code
//   runtime   core + migrations/** + admin/*.js        everything that runs on the server (admin/web runs in the browser)
//   all       runtime + tools/**                        everything except tests
const SCOPES = {
    core: (f) => f === 'app.js' || f === 'mobius.js' || f.startsWith('mobius/'),
    runtime: (f) => SCOPES.core(f) || f.startsWith('migrations/') || (f.startsWith('admin/') && !f.startsWith('admin/web/')),
    all: (f) => SCOPES.runtime(f) || f.startsWith('tools/')
};

function files(scope) {
    const pick = SCOPES[scope || 'core'];
    if (!pick) { throw new Error('모르는 범위 ' + scope); }
    return trackedJs().filter(pick);
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// Strips block comments and lines starting with `//`. Line numbers are preserved (replaced with blank lines).
function code(rel) {
    return read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '))
        .split(/\r?\n/).map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
}

// Lines matching re as [{file, line, text}]. Files in allow are excluded.
function grep(re, opts) {
    const o = opts || {};
    const allow = new Set(o.allow || []);
    const out = [];
    files(o.scope).forEach((f) => {
        if (allow.has(f)) { return; }
        code(f).split('\n').forEach((l, i) => {
            if (re.test(l)) { out.push({ file: f, line: i + 1, text: l.trim().slice(0, 120) }); }
        });
    });
    return out;
}

module.exports = { ROOT, SCOPES, files, read, code, grep };
