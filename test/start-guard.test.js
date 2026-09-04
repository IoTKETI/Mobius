'use strict';
/*
 * 기동 실패는 조용하면 안 된다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────────
 * DB 커넥션을 못 얻으면 `[db.connect] No Connection` 한 줄만 찍고 끝났다.
 *
 *   마스터  cluster.fork() 가 getConnection 성공 분기 **안**에 있어서
 *           워커를 한 개도 안 띄운다. 어떤 포트도 열리지 않는다
 *   워커    listen 을 하지 않는다. 그런데 죽지도 않으니
 *           cluster.on('exit') 이 발화하지 않아 **재포크도 안 걸린다**
 *
 * 두 경우 다 **프로세스는 살아 있다.** 감독 프로세스(pm2)는 'online' 으로
 * 보고, 헬스체크도 프로세스만 보면 통과한다. 그런데 요청은 전부 연결
 * 거부다 — 가장 알아채기 어려운 실패 모양이다.
 *
 * MySQL 어댑터의 connect 는 createPool 만 하고 언제나 '1' 을 준다. 실제
 * 접속은 첫 getConnection 에서 일어난다. 그래서 기동 순간 MySQL 이 잠깐
 * 늦거나 비밀번호가 틀리면 정확히 이 상태가 된다.
 *
 * ── 어떻게 고쳤나 ────────────────────────────────────────────────────────
 * 살아 있지 않는다. 로그를 남기고 종료해서 감독 프로세스가 다시 띄우게 한다.
 * 종료 전에 액세스 로그를 비우는 것은 backstop 이 이미 풀어 둔 문제라
 * 그 기계를 그대로 쓴다.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const backstop = require('../mobius/backstop');

function quiet(fn) {
    const log = console.log, err = console.error;
    console.log = function () {}; console.error = function () {};
    try { return fn(); } finally { console.log = log; console.error = err; }
}

test('exitAfterFlush 는 로그를 비운 뒤에 종료한다', function (t, done) {
    // 순서가 반대면 마지막 줄을 잃는다. backstop 이 크래시 경로에서 이미
    // 겪은 문제다 — 실측 10회 중 10회 유실이었다.
    backstop._resetFlushers();
    let flushed = false;

    backstop.flushOnExit(function (cb) {
        flushed = true;
        setImmediate(cb);              // 실제 스트림 end() 처럼 비동기
    });

    quiet(function () {
        backstop.exitAfterFlush(1, {
            onFatal: function (code) {
                assert.strictEqual(flushed, true, '비우기 전에 종료했다');
                assert.strictEqual(code, 1, '종료 코드가 1 이어야 감독이 실패로 본다');
                backstop._resetFlushers();
                done();
            }
        });
    });
});

test('비우기가 안 끝나도 종료는 한다', function (t, done) {
    // 기동에 실패한 프로세스다. 스트림이 아직 제대로 서지도 않았을 수 있어
    // end() 콜백이 영영 안 올 수 있다. 그때 종료가 걸리면 **고치려던 상태로
    // 되돌아간다** — 포트 없이 살아 있는 프로세스.
    backstop._resetFlushers();
    backstop.flushOnExit(function () { /* done 을 영영 안 부른다 */ });

    quiet(function () {
        backstop.exitAfterFlush(1, {
            flushTimeoutMs: 40,
            onFatal: function (code) {
                assert.strictEqual(code, 1);
                backstop._resetFlushers();
                done();
            }
        });
    });
});

test('등록된 비우기가 없으면 곧바로 종료한다', function (t, done) {
    backstop._resetFlushers();
    quiet(function () {
        backstop.exitAfterFlush(1, {
            onFatal: function (code) { assert.strictEqual(code, 1); done(); }
        });
    });
});

/* ── 기동 경로가 실제로 이것을 쓰는가 ───────────────────────────────────── */

const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function liveLines(src) {
    return src.split(/\r?\n/).map(function (l, i) { return { n: i + 1, t: l }; })
        .filter(function (x) { return !/^\s*(\/\/|\*|\/\*)/.test(x.t); });
}

test('기동 실패 분기가 로그만 찍고 끝나지 않는다', function () {
    // 다섯 자리다 — 마스터/워커/비클러스터 각각의 getConnection 실패와
    // connect 실패. 어느 하나라도 로그만 찍으면 그 경로가 조용히 산다.
    const live = liveLines(APP);

    const silent = live.filter(function (x) {
        return /\[db\.connect\] No Connection/.test(x.t) ||
               /\[db\] connect 실패/.test(x.t);
    });

    // 그 줄 자체는 남아도 된다. **그 다음에 종료가 와야 한다.**
    for (const s of silent) {
        const after = live.filter(function (x) { return x.n > s.n && x.n <= s.n + 6; })
                          .map(function (x) { return x.t; }).join('\n');
        assert.match(after, /fail_start\(/,
            'app.js:' + s.n + ' 이 실패를 로그로만 남기고 끝난다 — ' +
            '포트 없이 살아 있는 프로세스가 된다. fail_start() 로 종료할 것');
    }

    assert.ok(silent.length >= 5,
        '기동 실패 분기를 ' + silent.length + '개만 찾았다 — 5개여야 한다. ' +
        '문구가 바뀌었다면 이 시험도 같이 고칠 것');
});

test('fail_start 가 종료를 미룬다 — 감독의 재시작 폭주를 막는다', function () {
    // pm2 는 min_uptime(기본 1초)보다 오래 산 프로세스만 '정상 기동' 으로 세고,
    // 그보다 빨리 죽으면 max_restarts(기본 15) 를 세다가 **errored 로 두고
    // 포기한다.** DB 가 부팅 때 몇 초 늦는 흔한 경우에 그러면, MySQL 이
    // 돌아와도 서비스가 영영 안 뜬다.
    //
    // 그래서 곧바로 나가지 않고 잠깐 쉰다. 그 사이 감독은 이 프로세스를
    // '살았다' 로 세고 재시작 카운터를 되돌린다.
    const m = APP.match(/var\s+START_FAIL_EXIT_MS\s*=\s*(\d+)/);
    assert.ok(m, 'START_FAIL_EXIT_MS 상수가 없다');
    assert.ok(Number(m[1]) >= 2000,
        '종료 지연이 ' + m[1] + 'ms 다 — pm2 의 min_uptime(1초)보다 넉넉해야 ' +
        '재시작 카운터가 안 튄다');
});
