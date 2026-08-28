'use strict';
// 자동 생성 rn 이 겹치지 않고, 사전순 정렬이 생성순과 같은지 확인한다.
//
// rn 은 그대로 ri 가 되고 ri 는 lookup 의 PK 다. 겹치면 리소스 생성이 409 로
// 실패한다 — 실측(2026-08-28): CIN 40건 동시 POST 중 23건이 그렇게 유실됐다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const rid = require('../mobius/rid');

test('같은 밀리초에 연속 호출해도 겹치지 않는다', function () {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) { seen.add(rid.next_rn('4')); }
    assert.strictEqual(seen.size, 2000, '중복이 나왔다 (' + (2000 - seen.size) + '건)');
});

test('폭이 고정이라 사전순 == 생성순', function () {
    const list = [];
    for (let i = 0; i < 500; i++) { list.push(rid.next_rn('4')); }

    const widths = new Set(list.map(function (s) { return s.length; }));
    assert.strictEqual(widths.size, 1, '폭이 일정하지 않다: ' + JSON.stringify([...widths]));

    const sorted = list.slice().sort();
    assert.deepStrictEqual(sorted, list, '사전순이 생성순과 다르다');
});

test('형식: <ty>-<타임스탬프17><워커3><순번3>', function () {
    const rn = rid.next_rn('4');
    assert.match(rn, /^4-\d{17}\d{3}\d{3}$/, '형식이 다르다: ' + rn);
    assert.strictEqual(rn.length, 2 + 17 + 3 + 3);
});

test('ty 가 앞에 그대로 붙는다', function () {
    assert.ok(rid.next_rn('23').startsWith('23-'));
    assert.ok(rid.next_rn('3').startsWith('3-'));
});

test('워커 태그는 3자리다', function () {
    assert.match(rid._worker_tag(), /^\d{3}$/);
});

// 옛 형식(접미사 없음)과 섞여도 정렬이 깨지면 안 된다. 타임스탬프 폭이 같아서
// 차이는 그 뒤에서만 난다 — 같은 밀리초면 옛 것이 앞, 다른 밀리초면 타임스탬프가 결정.
test('옛 형식과 섞여도 시간 순서가 유지된다', function () {
    const OLD_EARLY = '4-20260828003448242';            // 옛 형식, 242ms
    const NEW_SAME  = '4-20260828003448242' + '001000'; // 새 형식, 같은 242ms
    const OLD_LATE  = '4-20260828003448251';            // 옛 형식, 251ms
    const NEW_LATE  = '4-20260828003448251' + '001000'; // 새 형식, 251ms

    const sorted = [NEW_LATE, OLD_EARLY, NEW_SAME, OLD_LATE].sort();
    assert.deepStrictEqual(sorted, [OLD_EARLY, NEW_SAME, OLD_LATE, NEW_LATE],
        '옛/새 형식이 섞이면 시간 순서가 깨진다');
});

// --- 호출부가 실제로 이걸 쓰는지 ---------------------------------------------

test('resource.js 가 타임스탬프만으로 rn 을 만들지 않는다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'resource.js'), 'utf8');
    assert.ok(src.indexOf('rid.next_rn') !== -1, 'resource.js 가 rid.next_rn 을 쓰지 않는다');
    assert.strictEqual(
        /\.rn = request\.ty \+ '-' \+ moment\(\)\.utc\(\)\.format\('YYYYMMDDHHmmssSSS'\)/.test(src),
        false,
        'rn 이 타임스탬프만으로 되돌아갔다 — 같은 밀리초에 겹친다');
});

// --- la / ol / delete_oldest 의 정렬 ------------------------------------------
// ct 는 초 단위라 같은 초에 만들어진 형제들 사이에서 순서를 못 가린다.
// 어느 정렬이든 ri 타이브레이커가 있어야 한다.

test('형제 순서를 가리는 모든 정렬에 ri 타이브레이커가 있다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');

    // "order by ct <방향>" 뒤에 곧바로 limit 이 오면 타이브레이커가 없는 것이다.
    const bare = src.match(/order by\s+(?:l\.)?ct\s+(?:asc|desc)\s+limit/gi) || [];
    assert.deepStrictEqual(bare, [],
        'ri 타이브레이커 없는 정렬이 남아 있다: ' + JSON.stringify(bare));
});

test('select_oldest_resource 는 두 백엔드 모두 정렬한다', function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'mobius', 'sql_action.js'), 'utf8');
    const body = src.slice(src.indexOf('exports.select_oldest_resource'));
    // 주석은 뺀다 — 주석에 적힌 'limit 1' 까지 세면 안 된다.
    const fn = body.slice(0, body.indexOf('\nexports.'))
        .split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');

    // 예전 MySQL 분기는 ORDER BY 없이 limit 1 이라 임의의 행을 골랐다.
    const limits = fn.match(/limit 1/gi) || [];
    const ordered = fn.match(/order by ct asc, ri asc limit 1/gi) || [];
    assert.strictEqual(ordered.length, limits.length,
        'limit 1 인데 정렬이 없는 분기가 있다 (limit ' + limits.length +
        '개 중 정렬 ' + ordered.length + '개)');
});
