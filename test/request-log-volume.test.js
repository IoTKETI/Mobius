'use strict';
// 요청마다 stdout 에 줄을 내지 않는다.
//
// ── 무엇이 문제였나 ──────────────────────────────────────────────────────
// 요청 하나가 stdout 에 세 줄을 냈다 — 빈 줄, 'GET : <url>',
// 'get_resource_from_url (<shortid>) - <url>: N ms'. 배포 실측으로
// pm2 로그 30,787줄 중 29,748줄(96.6%)이 이 셋이었고, 약 6MB/시간으로
// 불어났다. pm2-logrotate 가 max_size 10M × retain 10 이라
// **하루도 안 되어 진단 이력이 사라졌다.** 사고를 조사할 로그가 없다는
// 것이 디스크보다 큰 문제였다.
//
// ── 없앤 것은 로그가 아니라 중복과 헛measurement 다 ──────────────────────
// 도착 기록은 log/access-*.log 에 이미 들어간다(app.js 의 morgan). 거기에는
// IP·상태·UA 까지 있어 더 낫다.
//
// 계측 쪽은 더 나빴다. 배포에서 그 숫자들을 실제로 세어 보니:
//
//     get_resource_from_url    표본 44,126   p99.9 10.0ms   최대 19.1ms
//     select_latest_resource   표본  1,912   p99   4.6ms    최대  6.5ms
//     select_latest            표본  1,912   p99   4.0ms    최대  5.9ms
//     -> 셋 다 200ms 초과 0건
//
// **한 번도 느려진 적이 없다.** 그럴 수밖에 없는 것이, get_resource_from_url
// 타이머는 그 콜백의 첫 문장에서 끝나는데 실제로 느린 discovery(fu=1)는
// 그 뒤에 시작한다. 30초 상한에 걸리던 경로가 측정 구간 밖이었다.
//
// 대신 액세스 로그 형식에 :response-time 을 붙였다 — 요청 **전체** 시간이고,
// 구간이 아니라 사람이 실제로 겪는 값이다.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// 주석은 걷어낸다. **이걸 안 하면 이 파일의 설명 문장이 검사를 통과시킨다** —
// 이 저장소가 네 번 겪은 함정이다.
function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('요청 경로에 console.time 계측이 없다', function () {
    // app.js 의 계측은 전부 요청마다 돈다. 하나라도 살아나면 96.6% 가 돌아온다.
    const src = code('app.js');
    const hits = (src.match(/console\.time(End)?\s*\(/g) || []).length;
    assert.strictEqual(hits, 0,
        'app.js 에 console.time 계측이 ' + hits + '곳 남아 있다. ' +
        '요청마다 stdout 에 줄이 나가고 pm2 로그가 하루 만에 회전한다.');
});

test('요청 도착을 stdout 에 찍지 않는다', function () {
    // `console.log('\n' + request.method + ' : ' + request.url)` 이 있었다.
    // 같은 사실이 액세스 로그에 있다.
    const src = code('app.js');
    assert.ok(!/console\.log\(\s*'\\n'\s*\+\s*request\.method/.test(src),
        'app.js 가 요청 도착을 stdout 에 찍는다 — 액세스 로그와 중복이다');
});

test('la 경로에도 요청마다 도는 계측이 없다', function () {
    const src = code('mobius/sql_action.js');
    assert.ok(!/console\.time\(\s*'select_latest/.test(src),
        'select_latest 계측이 살아 있다 — la 는 이 배포에서 가장 잦은 요청이다');
});

test('sql_action.js 의 계측은 마스터 주기 작업과 기동 것뿐이다 (남은 일 §5.5)', function () {
    // 2026-09-05 전에는 요청 경로 33곳이 있었다 — CIN 생성마다 stdout 한 줄.
    // 남긴 넷: delete_oldest(purge 스윕) · reconcile_cnt_counters · delete_lookup_et
    // (만료 스윕) · update_cb_poa_csi(기동 때 한 번). 요청마다 도는 것이 아니다.
    const src = code('mobius/sql_action.js');
    const ALLOWED = /rec_id|del_id|update_cb_poa_csi/;
    const bad = (src.match(/console\.time(End)?\([^\n]*/g) || []).filter(function (l) { return !ALLOWED.test(l); });
    assert.deepStrictEqual(bad, [], '요청 경로에 계측이 되살아났다:\n  ' + bad.join('\n  '));
    // 라벨용 shortid 도 그 셋에서만
    assert.strictEqual((src.match(/require\('shortid'\)/g) || []).length, 3);
});

test('resource.js 에 console.time 계측이 없다', function () {
    const src = code('mobius/resource.js');
    assert.strictEqual((src.match(/console\.time(End)?\s*\(/g) || []).length, 0);
});

test('액세스 로그가 요청 전체 소요시간을 남긴다', function () {
    // 계측을 지우면서 소요시간을 통째로 잃으면 안 된다. morgan 의 'combined'
    // 에는 그 필드가 없어서 형식을 직접 적었다.
    const src = code('app.js');

    const m = src.match(/var ACCESS_FORMAT\s*=([\s\S]*?);/);
    assert.ok(m, 'ACCESS_FORMAT 이 없다 — 액세스 로그 형식을 직접 적어야 한다');
    assert.match(m[1], /:response-time/,
        '액세스 로그 형식에 :response-time 이 없다 — 소요시간이 어디에도 안 남는다');

    // morgan 에 그 형식을 실제로 넘겨야 한다. 상수만 만들고 'combined' 를
    // 그대로 쓰면 형식은 선언돼 있는데 안 쓰이는 상태가 된다.
    assert.match(src, /morgan\(\s*ACCESS_FORMAT\s*,/,
        "morgan 에 ACCESS_FORMAT 을 안 넘긴다 — 'combined' 를 쓰고 있다");
    assert.ok(!/morgan\(\s*'combined'/.test(src),
        "morgan('combined') 가 남아 있다 — 그 형식에는 소요시간 필드가 없다");

    // **소요시간은 마지막 필드여야 한다.** 중간에 끼우면 위치로 파싱하던
    // 것이 어긋나고, awk '{ if ($NF+0 > 1000) print }' 도 안 먹는다.
    const fmt = m[1].replace(/['"+\s]/g, '');
    assert.ok(/:response-time$/.test(fmt),
        ':response-time 이 마지막 필드가 아니다: ' + fmt.slice(-40));
});

test('morgan 이 response-time 토큰을 안다', function () {
    // 형식 문자열에 없는 토큰을 적으면 morgan 은 그 자리를 조용히 비운다.
    // 오타 하나로 소요시간이 사라지는 것을 막는다.
    const src = fs.readFileSync(
        path.join(ROOT, 'node_modules', 'morgan', 'index.js'), 'utf8');
    assert.match(src, /morgan\.token\('response-time'/,
        '이 morgan 버전에 response-time 토큰이 없다 — 형식을 바꿔야 한다');
});

// --- 액세스 로그 스트림 -------------------------------------------------------
//
// 8b 로 요청별 소요시간이 이 파일에만 남게 됐다. 그 파일을 쓰는 스트림에
// 구멍이 둘 있었고 둘 다 실측으로 확인했다.

test('액세스 로그 스트림에 error 리스너가 있다 — 없으면 워커가 죽는다', function () {
    // 라이브러리가 내부 파일 스트림의 error 를 이 스트림으로 그대로 올린다
    // (node_modules/file-stream-rotator/FileStreamRotator.js:537 BubbleEvents).
    // Node 는 'error' 에 리스너가 0개면 그 자리에서 throw 한다 — 재현했다:
    //
    //     리스너 없음:  Unhandled 'error' event -> 종료코드 1
    //     리스너 있음:  한 줄 찍고 계속 돈다
    //
    // 디스크가 차는 것(ENOSPC)이 요청을 못 받을 이유는 아니다.
    const src = code('app.js');
    assert.match(src, /accessLogStream\.on\(\s*'error'/,
        'accessLogStream 에 error 리스너가 없다 — 디스크가 차면 워커가 죽는다');
});

test('액세스 로그 회전이 대기 중인 줄을 버리지 않는다', function () {
    // end_stream 을 안 주면 회전이 rotateStream.destroy() 를 탄다
    // (FileStreamRotator.js:465-469). destroy 는 버퍼를 안 비운다.
    // 같은 조건으로 재 본 결과:
    //
    //     end_stream 없음:   3,000줄 중 841줄만 남음 (2,159줄 유실)
    //     end_stream: true:  3,000줄 전부 남음
    //
    // 배포는 워커 25개가 각자 자정에 회전한다.
    const src = code('app.js');
    const m = src.match(/fileStreamRotator\.getStream\(\{([\s\S]*?)\}\)/);
    assert.ok(m, 'getStream 호출을 못 찾았다');
    assert.match(m[1], /end_stream\s*:\s*true/,
        'getStream 에 end_stream: true 가 없다 — 자정 회전이 줄을 버린다');
});

test('에러 로그가 폭주하지 않는다 — 억제가 붙어 있다', function () {
    // 디스크가 찬 상태는 지속된다. 요청마다 한 줄이면 이번엔 error.log 가
    // 그 속도로 불어난다. 이 저장소가 이미 겪은 사고다(09477df).
    const src = code('app.js');
    const m = src.match(/accessLogStream\.on\(\s*'error'[\s\S]*?\n\}\);/);
    assert.ok(m, 'error 리스너 본문을 못 찾았다');
    assert.match(m[0], /Date\.now\(\)/,
        'error 리스너에 시간 기반 억제가 없다 — 디스크가 차면 error.log 가 폭주한다');
    assert.match(m[0], /skipped/,
        '삼킨 건수를 안 센다 — 억제가 사실을 감추면 안 된다');
});
