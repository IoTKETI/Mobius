'use strict';
// No stdout line per request.
//
// Three lines per request (a blank line, 'GET : <url>', 'get_resource_from_url (<shortid>) - <url>: N ms') made up 96.6% of the pm2 log and rotated the diagnostic history away within a day.
//
// Arrival is already recorded in log/access-*.log (morgan in app.js) with IP, status and UA. The per-function timers measured only the callback's first statement, so the slow discovery path (fu=1) was outside the measured interval.
//
// Instead :response-time is appended to the access log format: the whole request time as the client experiences it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Comments are stripped; otherwise the explanatory text in this file would satisfy the checks.
function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('요청 경로에 console.time 계측이 없다', function () {
    // Every instrumentation in app.js runs per request. One surviving call brings the volume back.
    const src = code('app.js');
    const hits = (src.match(/console\.time(End)?\s*\(/g) || []).length;
    assert.strictEqual(hits, 0,
        'app.js 에 console.time 계측이 ' + hits + '곳 남아 있다. ' +
        '요청마다 stdout 에 줄이 나가고 pm2 로그가 하루 만에 회전한다.');
});

test('요청 도착을 stdout 에 찍지 않는다', function () {
    // `console.log('\n' + request.method + ' : ' + request.url)` must not return; the access log records the same fact.
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
    // Allowed sites: delete_oldest (purge sweep), reconcile_cnt_counters, delete_lookup_et (expiry sweep), update_cb_poa_csi (once at startup). None runs per request.
    const src = code('mobius/sql_action.js');
    const ALLOWED = /rec_id|del_id|update_cb_poa_csi/;
    const bad = (src.match(/console\.time(End)?\([^\n]*/g) || []).filter(function (l) { return !ALLOWED.test(l); });
    assert.deepStrictEqual(bad, [], '요청 경로에 계측이 되살아났다:\n  ' + bad.join('\n  '));
    // The shortid used for labels is limited to those three as well.
    assert.strictEqual((src.match(/require\('shortid'\)/g) || []).length, 3);
});

test('resource.js 에 console.time 계측이 없다', function () {
    const src = code('mobius/resource.js');
    assert.strictEqual((src.match(/console\.time(End)?\s*\(/g) || []).length, 0);
});

test('액세스 로그가 요청 전체 소요시간을 남긴다', function () {
    // Removing the instrumentation must not lose the elapsed time altogether. morgan's 'combined' lacks that field, so the format is written explicitly.
    const src = code('app.js');

    const m = src.match(/var ACCESS_FORMAT\s*=([\s\S]*?);/);
    assert.ok(m, 'ACCESS_FORMAT 이 없다 — 액세스 로그 형식을 직접 적어야 한다');
    assert.match(m[1], /:response-time/,
        '액세스 로그 형식에 :response-time 이 없다 — 소요시간이 어디에도 안 남는다');

    // The format must actually be passed to morgan. Declaring the constant while still using 'combined' leaves the format unused.
    assert.match(src, /morgan\(\s*ACCESS_FORMAT\s*,/,
        "morgan 에 ACCESS_FORMAT 을 안 넘긴다 — 'combined' 를 쓰고 있다");
    assert.ok(!/morgan\(\s*'combined'/.test(src),
        "morgan('combined') 가 남아 있다 — 그 형식에는 소요시간 필드가 없다");

    // Elapsed time must be the last field. Inserting it in the middle breaks positional parsing and awk '{ if ($NF+0 > 1000) print }'.
    const fmt = m[1].replace(/['"+\s]/g, '');
    assert.ok(/:response-time$/.test(fmt),
        ':response-time 이 마지막 필드가 아니다: ' + fmt.slice(-40));
});

test('morgan 이 response-time 토큰을 안다', function () {
    // A token missing from morgan's format vocabulary is silently emitted empty. Guards against a typo removing the elapsed time.
    const src = fs.readFileSync(
        path.join(ROOT, 'node_modules', 'morgan', 'index.js'), 'utf8');
    assert.match(src, /morgan\.token\('response-time'/,
        '이 morgan 버전에 response-time 토큰이 없다 — 형식을 바꿔야 한다');
});

// Access log stream. The per-request elapsed time lives only in this file, and the stream writing it had two holes.

test('액세스 로그 스트림에 error 리스너가 있다 — 없으면 워커가 죽는다', function () {
    // The library bubbles the internal file stream's error up to this stream (file-stream-rotator BubbleEvents). Node throws in place when 'error' has no listener:
    //
    //     no listener:   Unhandled 'error' event -> exit code 1
    //     with listener: one line logged, keeps running
    //
    // A full disk (ENOSPC) is no reason to stop accepting requests.
    const src = code('app.js');
    assert.match(src, /accessLogStream\.on\(\s*'error'/,
        'accessLogStream 에 error 리스너가 없다 — 디스크가 차면 워커가 죽는다');
});

test('액세스 로그 회전이 대기 중인 줄을 버리지 않는다', function () {
    // Without end_stream, rotation goes through rotateStream.destroy(), which does not flush the buffer:
    //
    //     no end_stream:     841 of 3,000 lines kept (2,159 lost)
    //     end_stream: true:  all 3,000 lines kept
    //
    // Every worker rotates at midnight.
    const src = code('app.js');
    const m = src.match(/fileStreamRotator\.getStream\(\{([\s\S]*?)\}\)/);
    assert.ok(m, 'getStream 호출을 못 찾았다');
    assert.match(m[1], /end_stream\s*:\s*true/,
        'getStream 에 end_stream: true 가 없다 — 자정 회전이 줄을 버린다');
});

test('에러 로그가 폭주하지 않는다 — 억제가 붙어 있다', function () {
    // A full disk persists. One line per request would grow error.log at the same rate.
    const src = code('app.js');
    const m = src.match(/accessLogStream\.on\(\s*'error'[\s\S]*?\n\}\);/);
    assert.ok(m, 'error 리스너 본문을 못 찾았다');
    assert.match(m[0], /Date\.now\(\)/,
        'error 리스너에 시간 기반 억제가 없다 — 디스크가 차면 error.log 가 폭주한다');
    assert.match(m[0], /skipped/,
        '삼킨 건수를 안 센다 — 억제가 사실을 감추면 안 된다');
});
