'use strict';
// 비밀 봉인 (S2~S5). 실제 파일을 쓴다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const seal = require('../mobius/conf_seal');

function tmpConf(obj) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'confseal-'));
    const file = path.join(dir, 'conf.json');
    fs.writeFileSync(file, JSON.stringify(obj, null, 4), 'utf8');
    return file;
}

test('S4 seal → verify 가 맞고, 다시 봉인해도 key 는 유지된다', function () {
    const file = tmpConf({ dbpass: 'p', superUser: 'S', csebaseport: '7579' });
    const rec = seal.seal(file, JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.ok(fs.existsSync(seal.sealPath(file)));
    assert.match(rec.key, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(rec.keys, ['dbpass', 'superUser']);
    assert.deepStrictEqual(seal.verify(file, { dbpass: 'p', superUser: 'S', csebaseport: '7579' }), { ok: true });
    const again = seal.seal(file, { dbpass: 'q', superUser: 'S' });
    assert.strictEqual(again.key, rec.key, 'key 가 바뀌었다');
    assert.notStrictEqual(again.seal, rec.seal);
});
test('S2 dbpass 나 superUser 를 손으로 고치면 불일치', function () {
    const file = tmpConf({ dbpass: 'p', superUser: 'S' });
    seal.seal(file, { dbpass: 'p', superUser: 'S' });
    assert.strictEqual(seal.verify(file, { dbpass: 'hacked', superUser: 'S' }).ok, false);
    assert.strictEqual(seal.verify(file, { dbpass: 'p', superUser: 'Vader' }).ok, false);
    assert.strictEqual(seal.verify(file, { dbpass: 'p' }).ok, false, 'superUser 를 지운 것도 잡아야 한다');
});
test('S5 비밀이 아닌 키를 바꿔도 봉인은 그대로 맞는다', function () {
    const file = tmpConf({ dbpass: 'p', superUser: 'S', csebaseport: '7579' });
    seal.seal(file, { dbpass: 'p', superUser: 'S', csebaseport: '7579' });
    assert.strictEqual(seal.verify(file, { dbpass: 'p', superUser: 'S', csebaseport: '7580', dbConnectionLimit: 40 }).ok, true);
});
test('S3 봉인 파일이 없거나 깨졌으면 거부하고 사유를 말한다', function () {
    const file = tmpConf({ dbpass: 'p' });
    const v1 = seal.verify(file, { dbpass: 'p' });
    assert.strictEqual(v1.ok, false); assert.match(v1.reason, /봉인이 없다/);
    fs.writeFileSync(seal.sealPath(file), '{ not json', 'utf8');
    const v2 = seal.verify(file, { dbpass: 'p' });
    assert.strictEqual(v2.ok, false); assert.match(v2.reason, /깨졌다/);
    fs.writeFileSync(seal.sealPath(file), JSON.stringify({ key: 'ab', seal: 'cd' }), 'utf8');
    assert.strictEqual(seal.verify(file, { dbpass: 'p' }).ok, false);
});
test('없는 비밀은 null 로 봉인한다 — sqlite 설치(dbpass 없음)도 봉인된다', function () {
    const file = tmpConf({ db: 'sqlite', superUser: 'S' });
    seal.seal(file, { db: 'sqlite', superUser: 'S' });
    assert.strictEqual(seal.verify(file, { db: 'sqlite', superUser: 'S' }).ok, true);
    assert.strictEqual(seal.verify(file, { db: 'sqlite', superUser: 'S', dbpass: 'x' }).ok, false, '없던 비밀을 손으로 넣은 것도 잡는다');
});
