'use strict';
/**
 * conf.json 을 화면에서 고칠 때 지켜야 할 것들을 못박는다.
 *
 * 이 파일은 여러 세션·사람이 동시에 고치고, Mobius 워커 25개가 기동 때 읽는다.
 * 그래서 "모르는 키 보존" 과 "원자적 쓰기" 가 편의가 아니라 정합성 요구다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ConfStore, APPLY, SECRET } = require(path.join(__dirname, '..', 'admin', 'conf_store.js'));

function tempConf(obj) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'confstore-'));
    const file = path.join(dir, 'conf.json');
    fs.writeFileSync(file, JSON.stringify(obj, null, 4), 'utf8');
    return file;
}
function readConf(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function store(file) {
    return new ConfStore(file, { backends: () => ['mysql', 'sqlite'] });
}

test('모르는 키를 보존한다 — 남이 넣은 것을 날리지 않는다', function () {
    const file = tempConf({
        dbpass: 'secret',
        acpObserveMode: 'off',
        // 다른 세션이 넣은 것들
        someNewKeyFromAnotherSession: { deep: [1, 2, 3] },
        anotherOne: 'keep me'
    });
    const s = store(file);

    const r = s.update({ acpObserveMode: 'observe' });
    assert.strictEqual(r.ok, true);

    const after = readConf(file);
    assert.strictEqual(after.acpObserveMode, 'observe', '고친 키는 바뀐다');
    assert.deepStrictEqual(after.someNewKeyFromAnotherSession, { deep: [1, 2, 3] },
        '모르는 키가 사라졌다 — 남의 설정을 날린다');
    assert.strictEqual(after.anotherOne, 'keep me');
    assert.strictEqual(after.dbpass, 'secret', '비밀 키도 파일에는 그대로 남아야 한다');
});

test('비밀 값은 화면에 나가지 않는다 — 존재 여부만', function () {
    const file = tempConf({ dbpass: 'p4ssw0rd', superUser: 'Sponde', adminPassword: 'admin123' });
    const v = store(file).view();

    const asText = JSON.stringify(v);
    SECRET.forEach((k) => {
        assert.ok(!v.items.some((i) => i.key === k), k + ' 가 편집 항목에 있다');
    });
    assert.ok(!asText.includes('p4ssw0rd'), 'dbpass 값이 응답에 들어갔다');
    assert.ok(!asText.includes('Sponde'), 'superUser 값이 응답에 들어갔다');
    assert.ok(!asText.includes('admin123'), 'adminPassword 값이 응답에 들어갔다');

    const pass = v.secrets.find((x) => x.key === 'adminPassword');
    assert.strictEqual(pass.present, true, '있다는 사실은 알려야 한다');
    assert.ok(!('value' in pass) && !('length' in pass), '값도 길이도 주면 안 된다');
});

test('비밀 키는 고칠 수 없다', function () {
    const file = tempConf({ dbpass: 'x', superUser: 'Sponde', adminPassword: 'a' });
    const s = store(file);
    SECRET.forEach((k) => {
        const r = s.update({ [k]: 'hacked' });
        assert.strictEqual(r.ok, false, k + ' 를 고칠 수 있었다');
    });
    const after = readConf(file);
    assert.strictEqual(after.dbpass, 'x');
    assert.strictEqual(after.superUser, 'Sponde');
    assert.strictEqual(after.adminPassword, 'a');
});

test('숨김 키도 고칠 수 없다 — 콘솔이 자기 발밑을 무너뜨리지 않게', function () {
    const file = tempConf({ adminPort: 7580, csebaseport: '7579', usesqlite: 'true' });
    const s = store(file);
    ['adminPort', 'csebaseport', 'usesqlite'].forEach((k) => {
        assert.strictEqual(s.update({ [k]: 'x' }).ok, false, k + ' 를 고칠 수 있었다');
    });
    assert.strictEqual(readConf(file).adminPort, 7580);
});

test('유효값이 아니면 거절하고, 하나라도 틀리면 아무것도 안 쓴다', function () {
    const file = tempConf({ acpObserveMode: 'off', acpAudit: 'on' });
    const s = store(file);

    const bad = s.update({ acpObserveMode: 'maybe' });
    assert.strictEqual(bad.ok, false);
    assert.ok(/off \/ observe/.test(bad.errors[0]), '유효값을 알려 줘야 한다: ' + bad.errors[0]);

    // 하나는 맞고 하나는 틀린 경우
    const mixed = s.update({ acpAudit: 'off', acpObserveMode: 'nonsense' });
    assert.strictEqual(mixed.ok, false);
    assert.strictEqual(readConf(file).acpAudit, 'on',
        '일부만 적용되면 화면이 보여 준 상태와 파일이 어긋난다');
});

test('정수 키는 범위를 지킨다', function () {
    const file = tempConf({ acpDenyLogRate: 5 });
    const s = store(file);
    assert.strictEqual(s.update({ acpDenyLogRate: -1 }).ok, false, '음수를 받았다');
    assert.strictEqual(s.update({ acpDenyLogRate: 1.5 }).ok, false, '소수를 받았다');
    assert.strictEqual(s.update({ acpDenyLogRate: '5' }).ok, false, '문자열을 받았다');
    assert.strictEqual(s.update({ acpDenyLogRate: 10 }).ok, true);
    assert.strictEqual(readConf(file).acpDenyLogRate, 10);
});

test('db 의 유효값은 파사드에서 받는다 — 어댑터가 늘면 따라온다', function () {
    const file = tempConf({ db: 'mysql' });
    // 어댑터가 셋인 척
    const s = new ConfStore(file, { backends: () => ['mysql', 'sqlite', 'postgres'] });

    const item = s.view().items.find((i) => i.key === 'db');
    assert.deepStrictEqual(item.values, ['mysql', 'sqlite', 'postgres'],
        '유효값을 하드코딩하면 어댑터를 붙인 날 화면이 못 따라온다');
    assert.strictEqual(s.update({ db: 'postgres' }).ok, true);
    assert.strictEqual(s.update({ db: 'oracle' }).ok, false);
});

test('파일에 없는 키는 기본값을 쓴다고 구분해서 말한다', function () {
    const file = tempConf({ dbpass: 'x' });   // 정책 키가 하나도 없다
    const v = store(file).view();

    const observe = v.items.find((i) => i.key === 'acpObserveMode');
    assert.strictEqual(observe.usingDefault, true);
    assert.strictEqual(observe.fileValue, null);
    assert.strictEqual(observe.effective, 'off', '기본값이 실제로 쓰이는 값이다');
});

test('위험한 값을 위험하다고 표시한다', function () {
    const file = tempConf({ acpObserveMode: 'observe', acpDiscoveryFilter: 'off' });
    const items = store(file).view().items;
    assert.strictEqual(items.find((i) => i.key === 'acpObserveMode').danger, true,
        '관찰 모드는 거부를 허용으로 내보낸다');
    assert.strictEqual(items.find((i) => i.key === 'acpDiscoveryFilter').danger, true,
        '필터를 끄면 잠근 경로가 샌다');
    assert.strictEqual(items.find((i) => i.key === 'acpAudit').danger, false);
});

test('적용 시점을 키마다 말한다 — 저장하면 언제 반영되는가', function () {
    const file = tempConf({});
    const items = store(file).view().items;
    const by = {};
    items.forEach((i) => { by[i.key] = i.apply; });

    // 요청마다 global 을 읽는 것 — 값만 바꾸면 즉시
    assert.strictEqual(by.acpiAttachPolicy, APPLY.RUNTIME);
    assert.strictEqual(by.acpAudit, APPLY.RUNTIME);
    assert.strictEqual(by.acpDiscoveryFilter, APPLY.RUNTIME);
    assert.strictEqual(by.defaultAccessPolicy, APPLY.RUNTIME);
    // 모듈이 값을 캐시하는 것 — configure() 재호출이 필요하다
    assert.strictEqual(by.acpObserveMode, APPLY.RELOAD);
    assert.strictEqual(by.acpDenyLog, APPLY.RELOAD);
    assert.strictEqual(by.acpDenyLogRate, APPLY.RELOAD);
    // 재기동이 필요한 것
    assert.strictEqual(by.db, APPLY.RESTART);
});

test('원자적으로 쓴다 — 임시 파일을 남기지 않는다', function () {
    const file = tempConf({ acpAudit: 'on' });
    const dir = path.dirname(file);
    const s = store(file);

    s.update({ acpAudit: 'off' });

    const left = fs.readdirSync(dir).filter((f) => f !== 'conf.json');
    assert.deepStrictEqual(left, [], '임시 파일이 남았다: ' + left.join(', '));
    assert.strictEqual(readConf(file).acpAudit, 'off');
});

test('쓴 결과는 언제나 온전한 JSON 이다', function () {
    const file = tempConf({ acpAudit: 'on', nested: { a: [1, { b: 2 }] } });
    const s = store(file);
    for (let i = 0; i < 20; i++) {
        s.update({ acpDenyLogRate: i });
        const parsed = readConf(file);   // 던지면 실패
        assert.strictEqual(parsed.acpDenyLogRate, i);
        assert.deepStrictEqual(parsed.nested, { a: [1, { b: 2 }] });
    }
});

test('바꿀 것이 없으면 파일을 건드리지 않는다', function () {
    const file = tempConf({ acpAudit: 'on' });
    const before = fs.statSync(file).mtimeMs;
    const r = store(file).update({ acpAudit: 'on' });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.changed, []);
    assert.strictEqual(fs.statSync(file).mtimeMs, before, '같은 값인데 다시 썼다');
});

test('모르는 키를 화면이 알려 준다 — 다른 세션이 넣은 것일 수 있다', function () {
    const file = tempConf({ acpAudit: 'on', mysteryKey: 1, dbpass: 'x', adminPort: 7580 });
    const v = store(file).view();
    assert.deepStrictEqual(v.unknownKeys, ['mysteryKey'],
        '비밀·숨김·스키마에 없는 키만 모르는 키다');
});

test('readonly 키는 보여 주되 고치지 못한다', function () {
    const file = tempConf({ retentionPolicies: [{ x: 1 }] });
    const s = store(file);
    const item = s.view().items.find((i) => i.key === 'retentionPolicies');
    assert.strictEqual(item.readonly, true);
    assert.strictEqual(s.update({ retentionPolicies: [] }).ok, false,
        '단순 필드가 아니라 규칙 배열이다 — 화면이 함부로 덮으면 안 된다');
});
