'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dd = require(path.join(__dirname, '..', 'admin', 'data_dir.js'));

test('writeJson 은 원자적으로 쓰고 listJson 은 최신순·깨진 파일 표시', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dd-'));
    const a = dd.file(root, 'orphans', 'a.json');
    dd.writeJson(a, { n: 1 });
    const b = dd.file(root, 'orphans', 'b.json');
    dd.writeJson(b, { n: 2 });
    const c = dd.file(root, 'orphans', 'c.json');
    fs.writeFileSync(c, '{not json', 'utf8');
    // mtime 을 못박는다. 연달아 쓰면 같은 밀리초에 들어가 b 와 c 가 동점이 되고, 그러면
    // 이 단정이 파일시스템 사정에 따라 뒤집힌다 — 배포 리눅스에서 실제로 깨졌다.
    fs.utimesSync(a, new Date(1e12), new Date(1e12));
    fs.utimesSync(b, new Date(1e12 + 1000), new Date(1e12 + 1000));
    fs.utimesSync(c, new Date(1e12 + 2000), new Date(1e12 + 2000));
    const list = dd.listJson(root, 'orphans');
    assert.deepStrictEqual(list.map((x) => x.name), ['c.json', 'b.json', 'a.json']);
    assert.strictEqual(list[0].broken, true);
    assert.strictEqual(list[1].broken, undefined);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(b, 'utf8')), { n: 2 });
    assert.ok(!fs.readdirSync(path.join(root, 'orphans')).some((f) => /\.tmp/.test(f)), '임시 파일이 남지 않는다');
});

test('keepLatest 는 오래된 것부터 지운다', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dd-'));
    for (let i = 0; i < 5; i++) {
        const p = dd.file(root, 'x', 'r' + i + '.json');
        dd.writeJson(p, { i });
        fs.utimesSync(p, new Date(1000 * i + 1e12), new Date(1000 * i + 1e12));
    }
    dd.keepLatest(root, 'x', 2);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, 'x')).sort(), ['r3.json', 'r4.json']);
});

test('mtime 이 같으면 이름으로 최신순을 정한다 — 순서가 흔들리지 않는다', function () {
    // 같은 밀리초에 쓰인 두 결과가 동점이면 정렬이 파일시스템 사정을 탄다.
    // 파일 이름은 runId(앞이 UTC 타임스탬프)라 이름 내림차순이 곧 최신순이다.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dd-'));
    const names = ['20260907T000001-aa.json', '20260907T000002-bb.json', '20260907T000003-cc.json'];
    for (const n of names) {
        const p = dd.file(root, 'orphans', n);
        dd.writeJson(p, { n });
        fs.utimesSync(p, new Date(1e12), new Date(1e12));   // 셋 다 같은 mtime
    }
    assert.deepStrictEqual(dd.listJson(root, 'orphans').map((x) => x.name), names.slice().reverse());
});
