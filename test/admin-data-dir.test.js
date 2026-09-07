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
    fs.utimesSync(a, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    fs.writeFileSync(dd.file(root, 'orphans', 'c.json'), '{not json', 'utf8');
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
