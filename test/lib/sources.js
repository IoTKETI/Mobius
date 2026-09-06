'use strict';
// 소스 감시 시험의 공통 조각 — **저장소에 추적되는** 실행 파일을 전체로 훑는다.
//
// 왜 목록이 아니라 트리인가 (요청 흐름 남은 일 §7.3): 손으로 적은 파일 목록에만 기대는
// 부재 어서션("X 가 되살아나면 안 된다")은 그 X 가 목록 밖 파일로 옮겨 가면 조용히
// 통과한다. 2026-09-04 실측으로 소스 감시 시험의 79% 가 그랬다. 여기서 한 번 훑고
// test/core-invariants.test.js 가 그 위에 불변식을 건다.
//
// 왜 readdirSync 가 아니라 git ls-files 인가: 배포 서버에 굴러다니는 임시 파일
// (dbq_tmp.js 같은)을 코어로 세면 "배포에서 시험을 돌려 본다" 가 성립하지 않는다
// (test/usesqlite-single-reader.test.js 의 사정).
//
// 주석은 뺀다 — 주석에 낱말 하나 적어 검사를 통과시키거나 실패시키면 안 된다.

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

// 범위 — 불변식마다 고른다.
//   core      app.js · mobius.js · mobius/**            요청을 처리하는 코드
//   runtime   core + migrations/** + admin/*.js          서버에서 실행되는 모든 것 (admin/web 은 브라우저)
//   all       runtime + tools/**                          시험을 뺀 전부
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

// 블록 주석과 `//` 로 시작하는 줄을 걷어낸다. 줄 번호는 유지한다(빈 줄로 바꾼다).
function code(rel) {
    return read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '))
        .split(/\r?\n/).map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
}

// re 에 맞는 줄을 [{file, line, text}] 로. allow 에 든 파일은 뺀다.
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
