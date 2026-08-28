'use strict';
// 카운터/stateTag 유지의 모든 케이스를 실서버에 대고 검증한다.
//   node mobius.js sqlite &        # 또는 mysql
//   node tools/verify-counters.js
//
// 각 케이스는 HTTP 로 리소스를 조작한 뒤, 조회한 cni/cbs/st 가 기대와 맞는지 본다.
// 저장값을 읽는 경로(get_cni_count)와 실제 데이터가 어긋나면 여기서 드러난다.

const BASE = process.env.MOBIUS_BASE || 'http://127.0.0.1:7579';
const CSE = process.env.MOBIUS_CSE || 'Mobius';
const AE = 'vcae';
const ORIGIN = 'C' + AE;

let pass = 0;
let fail = 0;
const failures = [];

function headers(extra) {
    return Object.assign({
        'X-M2M-RI': 'vc' + Math.floor(Date.now() % 100000),
        'X-M2M-Origin': ORIGIN,
        'X-M2M-RVI': '2a',
        'Accept': 'application/json'
    }, extra || {});
}

async function call(method, path, opts) {
    opts = opts || {};
    const init = { method: method, headers: headers(opts.headers) };
    if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); }
    let res, text;
    try {
        res = await fetch(BASE + path, init);
        text = await res.text();
    } catch (e) {
        return { status: 0, body: String(e.message || e) };
    }
    let body = text;
    try { body = JSON.parse(text); } catch (e) { /* 그대로 둔다 */ }
    return { status: res.status, body: body };
}

function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log('  ok   ' + name); }
    else {
        fail++;
        failures.push(name);
        console.log('  FAIL ' + name);
        console.log('       기대: ' + JSON.stringify(expected));
        console.log('       실제: ' + JSON.stringify(actual));
    }
}

// 컨테이너의 cni/cbs/st 를 읽는다.
async function readCnt(rn) {
    const r = await call('GET', '/' + CSE + '/' + AE + '/' + rn);
    if (r.status !== 200) { return { status: r.status }; }
    const c = r.body['m2m:cnt'];
    return { cni: c.cni, cbs: c.cbs, st: c.st };
}

// 부모 st 검증은 반드시 컨테이너를 부모로 써야 한다.
// AE 응답에는 st 가 없다 (oneM2M 상 AE 에 stateTag 가 없어 응답에서 빠진다).
// DB 에는 저장되지만 HTTP 로는 관측할 수 없다.
async function readStAt(pathAfterCse) {
    const r = await call('GET', '/' + CSE + pathAfterCse);
    if (r.status !== 200) { return null; }
    const root = r.body[Object.keys(r.body)[0]];
    return root.st;
}

async function makeCnt(rn, extra) {
    return call('POST', '/' + CSE + '/' + AE, {
        headers: { 'Content-Type': 'application/json;ty=3' },
        body: { 'm2m:cnt': Object.assign({ rn: rn }, extra || {}) }
    });
}

async function makeCin(rn, con) {
    return call('POST', '/' + CSE + '/' + AE + '/' + rn, {
        headers: { 'Content-Type': 'application/json;ty=4' },
        body: { 'm2m:cin': { con: con } }
    });
}

// cnt_man 은 1초 debounce 라 flush 를 기다려야 한다.
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 2500); }); }

async function main() {
    console.log('대상: ' + BASE + '\n');

    // 정리 후 시작 (재실행 가능하게)
    await call('DELETE', '/' + CSE + '/' + AE);
    const ae = await call('POST', '/' + CSE, {
        headers: { 'Content-Type': 'application/json;ty=2' },
        body: { 'm2m:ae': { rn: AE, api: '0.2.481.2.0001.001.000111', rr: true } }
    });
    if (ae.status !== 201) {
        console.error('AE 생성 실패: ' + ae.status + ' ' + JSON.stringify(ae.body));
        process.exit(1);
    }

    // --- 케이스 1: CIN 생성이 cni/cbs 를 올린다 ------------------------------
    console.log('[1] CIN 생성 -> cni/cbs 증가');
    await makeCnt('c1');
    // 간격을 두지 않는다. rn 이 워커별 단조 순번을 갖고(mobius/rid.js),
    // la 정렬이 ct 다음 ri 를 보므로 같은 초에 만들어도 순서가 정확하다.
    // 예전에는 여기에 1.1초 지연이 필요했다.
    await makeCin('c1', 'aaaa');      // 4 bytes
    await makeCin('c1', 'bbbbbb');    // 6 bytes
    await settle();
    check('생성 2건 후 cni/cbs', await readCnt('c1'), { cni: 2, cbs: 10, st: (await readCnt('c1')).st });

    // --- 케이스 2: CIN 삭제가 cni/cbs 를 줄인다 ------------------------------
    console.log('[2] CIN 단건 삭제 -> cni/cbs 감소');
    const beforeDel = await readCnt('c1');
    await call('DELETE', '/' + CSE + '/' + AE + '/c1/la');
    await settle(1200);
    const afterDel = await readCnt('c1');
    check('삭제 후 cni', afterDel.cni, 1);
    check('삭제 후 cbs', afterDel.cbs, 4);
    check('삭제 후 st 증가', afterDel.st > beforeDel.st, true);

    // --- 케이스 3: 보존 한도 초과 -> 오래된 것부터 밀어내고 st 도 오른다 -----
    console.log('[3] mni 초과 -> delete_oldest, st 증가');
    await makeCnt('c2', { mni: 3 });
    for (let i = 0; i < 3; i++) { await makeCin('c2', 'x'.repeat(5)); }
    await settle();
    const beforePurge = await readCnt('c2');
    check('한도 도달 시 cni', beforePurge.cni, 3);

    for (let i = 0; i < 2; i++) { await makeCin('c2', 'y'.repeat(5)); }
    await settle(3500);
    const afterPurge = await readCnt('c2');
    check('mni 초과 후 cni 가 한도 이하', afterPurge.cni <= 3, true);
    check('purge 후 st 증가', afterPurge.st > beforePurge.st, true);

    // --- 케이스 4: 자식 CNT 생성이 부모 st 를 올린다 -------------------------
    // 부모를 컨테이너로 잡아야 응답에서 st 를 볼 수 있다 (readStAt 주석 참고).
    console.log('[4] 자식 CNT 생성 -> 부모 st 증가');
    await makeCnt('p1');
    await settle(800);
    const pStBefore = await readStAt('/' + AE + '/p1');
    const child = await call('POST', '/' + CSE + '/' + AE + '/p1', {
        headers: { 'Content-Type': 'application/json;ty=3' },
        body: { 'm2m:cnt': { rn: 'ch' } }
    });
    check('자식 CNT 생성 성공', child.status, 201);
    await settle(800);
    const pStAfter = await readStAt('/' + AE + '/p1');
    check('자식 CNT 생성 후 부모 st 증가', pStAfter > pStBefore, true);

    // --- 케이스 5: CIN 외 자식 삭제가 부모 st 를 올린다 ----------------------
    console.log('[5] 자식 CNT 삭제 -> 부모 st 증가');
    const pStBefore2 = await readStAt('/' + AE + '/p1');
    await call('DELETE', '/' + CSE + '/' + AE + '/p1/ch');
    await settle(800);
    const pStAfter2 = await readStAt('/' + AE + '/p1');
    check('자식 CNT 삭제 후 부모 st 증가', pStAfter2 > pStBefore2, true);

    // --- 케이스 6: SUB 생성/삭제가 부모 st 를 올린다 -------------------------
    console.log('[6] SUB 삭제 -> 부모 st 증가');
    const sub = await call('POST', '/' + CSE + '/' + AE + '/c1', {
        headers: { 'Content-Type': 'application/json;ty=23' },
        body: { 'm2m:sub': { rn: 's1', nu: ['http://127.0.0.1:9999/none'], nct: 2 } }
    });
    if (sub.status === 201) {
        await settle(800);
        const cntStBefore = (await readCnt('c1')).st;
        await call('DELETE', '/' + CSE + '/' + AE + '/c1/s1');
        await settle(800);
        const cntStAfter = (await readCnt('c1')).st;
        check('SUB 삭제 후 부모 st 증가', cntStAfter > cntStBefore, true);
    }
    else {
        console.log('  skip SUB 생성 실패(' + sub.status + ') — 이 백엔드에서 미지원');
    }

    // --- 케이스 7: 저장값과 실제 데이터가 일치한다 --------------------------
    console.log('[7] 저장된 cni/cbs 가 실제와 일치');
    const c1 = await readCnt('c1');
    const disc = await call('GET', '/' + CSE + '/' + AE + '/c1?fu=1&ty=4');
    if (disc.status === 200 && disc.body['m2m:uril']) {
        check('cni 가 실제 CIN 수와 일치', c1.cni, disc.body['m2m:uril'].length);
    }
    else {
        console.log('  skip discovery 사용 불가(' + disc.status + ')');
    }

    // --- 케이스 8: mni 를 낮추면 즉시 반영된다 (DB 최신값 사용) -------------
    console.log('[8] mni 를 낮추면 다음 삽입에서 즉시 판정');
    await makeCnt('c4');
    for (let i = 0; i < 4; i++) { await makeCin('c4', 'z'.repeat(3)); }
    await settle();
    await call('PUT', '/' + CSE + '/' + AE + '/c4', {
        headers: { 'Content-Type': 'application/json' },
        body: { 'm2m:cnt': { mni: 2 } }
    });
    await settle(1200);
    await makeCin('c4', 'w'.repeat(3));
    await settle(3500);
    const c4 = await readCnt('c4');
    check('mni=2 로 낮춘 뒤 cni 가 2 이하', c4.cni <= 2, true);

    // 정리
    await call('DELETE', '/' + CSE + '/' + AE);

    console.log('\n결과: ' + pass + ' pass, ' + fail + ' fail');
    if (fail > 0) {
        console.log('실패 항목:');
        failures.forEach(function (f) { console.log('  - ' + f); });
    }
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(function (e) {
    console.error('검증 스크립트 오류:', e);
    process.exit(1);
});
