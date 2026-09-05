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

const { ConfStore, APPLY, SECRET, WIZARD_KEYS } = require(path.join(__dirname, '..', 'tools', 'conf_store.js'));

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
    return new ConfStore(file);
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

test('exposed:false 인 키는 전부 고칠 수 없다 — 목록을 표에서 전수로 뽑는다', function () {
    // 예전에는 ['adminPort', 'csebaseport', 'pxyWsPort'] 를 손으로 들었다. adminPort 와
    // csebaseport 는 2026-09-05 에 편집 가능해졌고(설정은 CLI 의 일이다), pxyWsPort 는
    // 표에서 사라져 "모르는 키라" 거절되고 있었다 — 검사가 헛돌았다.
    const schema = require(path.join(__dirname, '..', 'mobius', 'conf_schema.js'));
    const hidden = schema.all().filter((k) => schema.get(k).exposed === false);
    assert.ok(hidden.length >= 4, '숨김 키가 넷보다 적다: ' + hidden.join(', '));
    const seed = {};
    hidden.forEach((k) => { seed[k] = 'orig'; });
    const file = tempConf(seed);
    const s = store(file);
    hidden.forEach((k) => {
        assert.strictEqual(s.update({ [k]: 'x' }).ok, false, k + ' 를 고칠 수 있었다');
    });
    hidden.forEach((k) => assert.strictEqual(readConf(file)[k], 'orig'));
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
    assert.strictEqual(s.update({ acpDenyLogRate: '5' }).ok, false, '문자열을 받았다');
    // 화면이 정수 입력칸을 그리는 값이다. 코어가 integer 플래그를 붙여 막는다.
    assert.strictEqual(s.update({ acpDenyLogRate: 1.5 }).ok, false, '소수를 받았다');
    assert.strictEqual(s.update({ acpDenyLogRate: 10 }).ok, true);
    assert.strictEqual(readConf(file).acpDenyLogRate, 10);
});

test('outboundTimeoutMs 는 끄거나(0) 3초 이상이어야 한다', function () {
    // 알림 발송과 원격 CSE 포워딩의 응답 대기 한도다. 켰는데 너무 짧으면
    // 정상 알림이 실패로 기록되기 시작한다 — 끄는 것보다 나쁘다.
    const file = tempConf({ outboundTimeoutMs: 0 });
    const s = store(file);

    assert.strictEqual(s.update({ outboundTimeoutMs: 0 }).ok, true, '0 은 끄는 것이라 허용');
    assert.strictEqual(s.update({ outboundTimeoutMs: 5000 }).ok, true);
    assert.strictEqual(s.update({ outboundTimeoutMs: 3000 }).ok, true, '경계값 3000 은 허용');

    const bad = s.update({ outboundTimeoutMs: 500 });
    assert.strictEqual(bad.ok, false, '0.5초를 받았다 — 정상 알림이 실패로 쌓인다');
    assert.ok(/3000/.test(bad.errors[0]), '왜 안 되는지 알려 줘야 한다: ' + bad.errors[0]);
    assert.strictEqual(s.update({ outboundTimeoutMs: 2999 }).ok, false);
});

test('db 의 유효값은 코어가 어댑터에서 실시간으로 준다', function () {
    const file = tempConf({ db: 'mysql' });
    const s = store(file);

    const item = s.view().items.find((i) => i.key === 'db');
    // 목록을 하드코딩하지 않는다 — 어댑터를 붙이면 화면이 저절로 따라와야 한다.
    // 지금 붙어 있는 것과 같은지만 본다.
    assert.deepStrictEqual(item.choices, require('../mobius/db').backends(),
        'db 유효값이 파사드의 어댑터 목록과 다르다');
    assert.ok(item.choices.length > 0);

    assert.strictEqual(s.update({ db: item.choices[0] }).ok, true);
    assert.strictEqual(s.update({ db: 'oracle' }).ok, false, '없는 어댑터를 받았다');
});

test('콘솔 자신의 conf 키를 "모르는 키" 로 오해하지 않는다', function () {
    // conf.json 하나에 Mobius 것과 콘솔 것이 같이 산다. 코어 스키마는
    // mobius.js 가 읽는 것만 알아서 adminPort 류를 모른다 — 넣어 주지 않으면
    // 화면이 "다른 세션이 넣은 키" 처럼 보여 준다.
    const file = tempConf({
        acpAudit: 'on',
        adminPort: 7580, adminHost: '127.0.0.1',
        adminCseHost: '127.0.0.1', adminCsePort: 7579,
        adminPassword: 'x',
        reallyUnknown: 1
    });
    const v = store(file).view();
    assert.deepStrictEqual(v.unknownKeys, ['reallyUnknown'],
        '콘솔 자신의 키가 모르는 키로 나왔다: ' + v.unknownKeys.join(', '));
});

test('콘솔 키는 고칠 수 있다 — 설정은 이제 CLI 의 일이다', function () {
    // 웹에서 자기 발밑(adminPort)을 고치지 못하게 막던 규칙은 웹이 설정을 안
    // 고치게 되면서 의미가 없어졌다. CLI 는 SSH 로 들어온 사람이 쓴다.
    const file = tempConf({ adminPort: 7580, adminCsePort: 7579 });
    const s = store(file);
    assert.strictEqual(s.update({ adminPort: 9999 }).ok, true);
    assert.strictEqual(readConf(file).adminPort, 9999);
    // 비밀인 콘솔 키는 여전히 안 된다
    assert.strictEqual(s.update({ adminPassword: 'x' }).ok, false);
    assert.strictEqual(s.update({ adminOrigin: 'x' }).ok, false);
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
        '비밀·콘솔·코어 스키마에 없는 키만 모르는 키다');
});

test('readOnly 키는 보여 주되 고치지 못한다', function () {
    const file = tempConf({ retentionPolicies: [{ x: 1 }] });
    const s = store(file);
    const item = s.view().items.find((i) => i.key === 'retentionPolicies');
    assert.strictEqual(item.readOnly, true);
    assert.strictEqual(s.update({ retentionPolicies: [] }).ok, false,
        '단순 필드가 아니라 규칙 배열이다 — 화면이 함부로 덮으면 안 된다');
});

test('모든 항목이 분류를 갖는다 — 화면에서 조용히 빠지지 않게', function () {
    // 소속은 코어가 정한다(describe().group). 화면은 순서만 정하는데,
    // group 이 비면 '기타' 로 가고 그건 "코어가 분류를 안 줬다" 는 신호다.
    // 조용히 사라지는 것보다 낫지만, 여기서 잡아 두면 더 빨리 안다.
    const file = tempConf({});
    const missing = store(file).view().items
        .filter((i) => !i.group)
        .map((i) => i.key);
    assert.deepStrictEqual(missing, [],
        '코어 스키마가 group 을 안 준 키가 있다: ' + missing.join(', '));
});

test('reload 키는 무엇을 다시 불러야 하는지 알려 준다', function () {
    // 코어 describe() 가 reloadWith 를 안 실어 줘서 _SCHEMA 에서 집어 온다.
    // 이걸 모르면 화면이 "재기동 없이 반영" 이라고만 하고 무엇이 필요한지
    // 말하지 못한다.
    const file = tempConf({});
    const items = store(file).view().items;
    items.filter((i) => i.apply === APPLY.RELOAD).forEach((i) => {
        assert.ok(i.reloadWith, i.key + ' 가 reload 인데 reloadWith 가 없다');
    });
    const observe = items.find((i) => i.key === 'acpObserveMode');
    assert.strictEqual(observe.reloadWith, 'acp_observe.configure');
});

// --- 2026-09-05 CLI·마법사가 쓰는 API ------------------------------------------

test('SECRET 은 표에서 온다 — 손 목록이 아니다', function () {
    const schema = require(path.join(__dirname, '..', 'mobius', 'conf_schema.js'));
    assert.deepStrictEqual(SECRET, schema.all().filter((k) => schema.get(k).secret === true));
    assert.ok(SECRET.indexOf('dbpass') >= 0 && SECRET.indexOf('adminOrigin') >= 0);
});

test('L5 removeKey 는 update 와 같은 관문을 지난다 — unset dbpass 가 통하면 안 된다', function () {
    const file = tempConf({ dbpass: 'x', acpObserveMode: 'observe', retentionPolicies: [] });
    const s = store(file);
    assert.strictEqual(s.removeKey('dbpass').ok, false);
    assert.strictEqual(s.removeKey('retentionPolicies').ok, false, '읽기 전용이 지워졌다');
    assert.strictEqual(s.removeKey('noSuchKey').ok, false);
    assert.strictEqual(readConf(file).dbpass, 'x');

    const r = s.removeKey('acpObserveMode');
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.changed, [{ key: 'acpObserveMode', from: 'observe', to: null }]);
    assert.ok(!('acpObserveMode' in readConf(file)));
    // 없는 키를 지우면 아무 일도 없다
    assert.deepStrictEqual(s.removeKey('acpObserveMode'), { ok: true, changed: [], errors: [] });
});

test('update 는 파일이 없으면 만든다 — 읽기는 기본값으로, 쓰기만 파일을 만든다', function () {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'confstore-')), 'conf.json');
    const s = store(file);
    assert.strictEqual(s.update({ acpObserveMode: 'observe' }).ok, true);
    assert.deepStrictEqual(readConf(file), { acpObserveMode: 'observe' });
});

test('W3 create 는 마법사의 일곱 키만 받고, 파일이 있으면 동작하지 않는다', function () {
    assert.deepStrictEqual(WIZARD_KEYS, ['db', 'dbpass', 'cseBase', 'cseId', 'spId', 'superUser', 'csebaseport']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'confstore-'));
    const file = path.join(dir, 'conf.json');
    const s = store(file);

    let r = s.create({ db: 'mysql', dbpass: 'p', cseBase: 'Vita', acpObserveMode: 'off' });
    assert.strictEqual(r.ok, false, '일곱 밖의 키를 받았다');
    assert.ok(/acpObserveMode/.test(r.errors.join(' ')));
    assert.strictEqual(fs.existsSync(file), false);

    r = s.create({ db: 'mysql', cseBase: 'Mo/bius' });
    assert.strictEqual(r.ok, false, '유효값 검사를 안 지났다');
    assert.strictEqual(fs.existsSync(file), false);

    r = s.create({ db: 'mysql', dbpass: 'p', cseBase: 'Vita', cseId: '/Vita1', spId: '//example.com', csebaseport: '7579' });
    assert.strictEqual(r.ok, true, r.errors.join(' '));
    assert.strictEqual(readConf(file).dbpass, 'p', 'dbpass 를 못 썼다 — create 는 isWritable 을 지나지 않는다');
    assert.strictEqual(readConf(file).cseBase, 'Vita');

    r = s.create({ db: 'sqlite' });
    assert.strictEqual(r.ok, false, '파일이 있는데 만들었다');
    assert.strictEqual(readConf(file).cseBase, 'Vita', '있던 파일을 덮었다');
});

test('W3 setSecret 은 dbpass·superUser 만, 파일이 있을 때만', function () {
    const file = tempConf({ dbpass: 'old', cseBase: 'Vita' });
    const s = store(file);
    assert.strictEqual(s.setSecret('adminPassword', 'x').ok, false, '콘솔의 비밀이 이 경로로 써졌다');
    assert.strictEqual(s.setSecret('adminOrigin', 'x').ok, false);
    assert.strictEqual(s.setSecret('acpObserveMode', 'off').ok, false);
    assert.strictEqual(s.setSecret('dbpass', 42).ok, false, '문자열이 아닌데 받았다');
    assert.strictEqual(readConf(file).dbpass, 'old');

    assert.strictEqual(s.setSecret('dbpass', 'new').ok, true);
    assert.strictEqual(readConf(file).dbpass, 'new');
    assert.strictEqual(readConf(file).cseBase, 'Vita', '다른 키를 날렸다');

    // superUser 도 같은 길 — 파일에 없던 키면 추가된다
    assert.strictEqual(s.setSecret('superUser', 'Vader').ok, true);
    assert.strictEqual(readConf(file).superUser, 'Vader');
    assert.strictEqual(readConf(file).dbpass, 'new', 'dbpass 를 날렸다');

    const missing = store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'confstore-')), 'conf.json'));
    assert.throws(function () { missing.setSecret('dbpass', 'x'); }, /ENOENT/);
});

test('conf_schema.checkValue 는 관문 없이 타입·유효값만 본다', function () {
    const schema = require(path.join(__dirname, '..', 'mobius', 'conf_schema.js'));
    assert.strictEqual(schema.checkValue('dbpass', 'x').ok, true, 'exposed:false 를 관문으로 썼다');
    assert.strictEqual(schema.checkValue('dbpass', 1).ok, false);
    assert.strictEqual(schema.checkValue('cseBase', 'la').ok, false);
    assert.strictEqual(schema.checkValue('noSuchKey', 'x').ok, false);
    assert.strictEqual(schema.validate('dbpass', 'x').ok, false, 'validate 는 여전히 관문이다');
    // groups() 는 선언 순서다
    const g = schema.groups();
    assert.ok(g.indexOf('권한') >= 0 && g.indexOf('콘솔') >= 0);
    assert.strictEqual(g.length, new Set(g).size);
});
