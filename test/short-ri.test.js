'use strict';
// Short resource id (sri) generator.
//
// The generator is constructively unique within one host: the pid is unique while the process lives, and seq increments within a process for the same millisecond. The property is exercised with real bursts (200,000 in one process, four processes concurrently).

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MOD = path.join(__dirname, '..', 'mobius', 'short_ri.js');
const short_ri = require(MOD);

function utc17(d) {
    const p = (n, w) => String(n).padStart(w, '0');
    return p(d.getUTCFullYear(), 4) + p(d.getUTCMonth() + 1, 2) + p(d.getUTCDate(), 2) +
           p(d.getUTCHours(), 2) + p(d.getUTCMinutes(), 2) + p(d.getUTCSeconds(), 2) + p(d.getUTCMilliseconds(), 3);
}

test('모양 — <접두><UTC 17자리><pid·seq base36>, 45자 안, URL 안전 문자만', () => {
    const before = utc17(new Date());
    const id = short_ri.generate('4-');
    const after = utc17(new Date());
    assert.match(id, /^4-\d{17}[0-9a-z]+$/, id);
    const ts = id.slice(2, 19);
    assert.ok(ts >= before && ts <= after, '시각 ' + ts + ' 가 [' + before + ', ' + after + '] 밖이다');
    assert.ok(id.length <= 45 && id.length > 19, '길이 ' + id.length);
    // The prefix comes from the caller: the type number up to the dash, S/C alone for AEs.
    assert.match(short_ri.generate('23-'), /^23-\d{17}/);
    assert.match(short_ri.generate('S'), /^S\d{17}[0-9a-z]+$/);
});

test('시각 17자리가 moment 의 YYYYMMDDHHmmssSSS 와 같은 형식이다 (옛 접두 유지)', () => {
    const moment = require('moment');
    const id = short_ri.generate('4-');
    const m = moment().utc().format('YYYYMMDDHHmmssSSS');
    assert.strictEqual(id.slice(2, 14), m.slice(0, 12), '분 단위까지는 같아야 한다');
});

test('한 프로세스 폭주 20만 건 — 중복 0', () => {
    const N = 200000;
    const seen = new Set();
    for (let i = 0; i < N; i++) { seen.add(short_ri.generate('4-')); }
    assert.strictEqual(seen.size, N, '중복 ' + (N - seen.size) + '건');
});

test('같은 ms 안에서는 seq 가 늘고, 시계가 뒤로 가도 반복하지 않는다', () => {
    // Fixed clock twice, then rewound once: all three must differ. The generator is monotonic within the process (the test above used the current time), so the fixed time is set in the future.
    const F = Date.now() + 120000;
    const fixed = [F, F, F - 1123];
    let i = 0;
    const ids = [short_ri.generate('4-', () => fixed[i++]), short_ri.generate('4-', () => fixed[i++]), short_ri.generate('4-', () => fixed[i++])];
    assert.strictEqual(new Set(ids).size, 3, ids.join(' '));
    assert.strictEqual(ids[0].slice(2, 19), short_ri.ts17(F));
    assert.strictEqual(ids[1].slice(2, 19), short_ri.ts17(F), '같은 ms 는 seq 로 갈라야 한다');
    assert.ok(ids[2].slice(2, 19) >= short_ri.ts17(F), '시계가 뒤로 갔는데 시각이 따라 내려갔다: ' + ids[2]);
});

test('생산 코드는 이 생성기만 쓴다 — 난수 세 자리 생성기와 shortid aei 가 없다', () => {
    const fs = require('node:fs');
    const live = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    for (const f of ['mobius/resource.js', 'mobius/cb.js', 'mobius/ae.js']) {
        const s = live(f);
        assert.doesNotMatch(s, /YYYYMMDDHHmmssSSS'\) \+ \(Math\.random\(\)/, f + ' 에 옛 생성기가 남아 있다');
        assert.doesNotMatch(s, /shortid'\)\.generate\(\)/, f + ' 가 shortid 로 id 를 만든다 — 프로세스마다 카운터가 0 에서 시작해 겹친다');
    }
    assert.match(live('mobius/resource.js'), /\.sri = short_ri\.generate\(request\.ty \+ '-'\)/);
    assert.match(live('mobius/cb.js'), /\.sri = short_ri\.generate\('5-'\)/);
    assert.match(live('mobius/ae.js'), /\.aei = 'S' \+ short_ri\.generate\('S'\)|\.aei = short_ri\.generate\('S'\)/);
    assert.match(live('mobius/ae.js'), /\.aei = short_ri\.generate\('C'\)/);
});

test('프로세스 넷이 동시에 3만 건씩 — 서로 겹치지 않는다', async () => {
    const script = 'const s=require(' + JSON.stringify(MOD) + ');const out=[];for(let i=0;i<30000;i++)out.push(s.generate("4-"));process.stdout.write(out.join("\\n"));';
    const runs = [0, 1, 2, 3].map(() => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        child.stdout.on('data', (d) => { buf += d; });
        child.on('close', (code) => code === 0 ? resolve(buf.split('\n')) : reject(new Error('exit ' + code)));
    }));
    const lists = await Promise.all(runs);
    const all = [].concat(...lists);
    assert.strictEqual(all.length, 120000);
    const seen = new Set(all);
    assert.strictEqual(seen.size, all.length, '프로세스 간 중복 ' + (all.length - seen.size) + '건');
    // The pid segment differs per process: five or more characters after the timestamp.
    const pids = new Set(lists.map((l) => l[0].slice(19, l[0].length - 3)));
    assert.strictEqual(pids.size, 4, 'pid 조각이 갈리지 않았다: ' + [...pids].join(','));
});
