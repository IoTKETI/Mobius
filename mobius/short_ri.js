'use strict';
//
// 짧은 리소스 id(sri) 생성기 — 한 호스트 안에서 구성적으로 유일하다.
//
//   <접두><YYYYMMDDHHmmssSSS><pid base36, 5자 이상><seq base36, 3자>
//   예: '4-' + 20260906031641123 + 00k3z + 001  ->  4-2026090603164112300k3z001 (27자)
//
// ── 왜 바꿨나 ────────────────────────────────────────────────────────────
// 옛 생성기는 시각 17자리 뒤에 Math.random() 세 자리를 붙였다. 워커 24개가 각자
// 만드니 같은 ms 에 두 건이 나면 1/1000 로 겹친다. 배포 실측(2026-09-06): 8월 한 달에
// 같은 ms 에 2건인 순간이 16,887번, 실제 중복 sri 16개(7월 9 · 9월 1~6일 14).
// lookup.sri 인덱스가 비유일이라 DB 도 막지 못했고, 겹친 두 리소스는 밖으로 같은
// ri(resourceID) 를 내보냈다.
//
// ── 어떻게 유일한가 ──────────────────────────────────────────────────────
// pid 는 프로세스가 살아 있는 동안 한 호스트에서 유일하고, seq 는 프로세스 안에서
// 같은 ms 마다 0 부터 센다. 시각은 단조다 — 시계가 뒤로 가도(NTP 보정) 마지막 값을
// 넘지 않게 잡아 (ms, seq) 쌍이 반복되지 않는다. pid 가 재사용되는 것은 그 프로세스가
// 죽은 뒤라 시각이 이미 다르다. **DB 하나를 두 호스트가 나눠 쓰는 배치는 지원하지
// 않는다**(지금도 아니다) — 그때는 호스트 조각을 더해야 한다.
//
// 시각 17자리는 옛 형식 그대로 둔다 — 사람이 읽고, 시간순으로 정렬되며, 도구가
// 그 접두로 기간을 센다(`sri >= '4-20260901'`). 접두는 호출부가 준다('4-' · '5-' · 'S').
// 컬럼은 varchar(45) 다.

var SEQ_LIMIT = 36 * 36 * 36;                  // 3자리 base36 — 한 프로세스가 한 ms 에 46,656건
var PID36 = process.pid.toString(36).padStart(5, '0');

var last_ms = 0;
var seq = 0;

function pad(n, w) { return String(n).padStart(w, '0'); }

function ts17(ms) {
    var d = new Date(ms);
    return pad(d.getUTCFullYear(), 4) + pad(d.getUTCMonth() + 1, 2) + pad(d.getUTCDate(), 2) +
           pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2) + pad(d.getUTCSeconds(), 2) +
           pad(d.getUTCMilliseconds(), 3);
}

// prefix  호출부의 접두 — 리소스 타입은 '4-' 처럼 대시까지, AE 는 'S'/'C'
// now     시험용 시계(생략하면 Date.now)
function generate(prefix, now) {
    var t = (typeof now === 'function') ? now() : Date.now();
    if (t < last_ms) { t = last_ms; }             // 단조 — 시계가 뒤로 가도 반복하지 않는다
    if (t === last_ms) {
        seq += 1;
        if (seq >= SEQ_LIMIT) { t += 1; seq = 0; }  // 한 ms 에 46,656건을 넘으면 다음 ms 를 미리 쓴다
    }
    else {
        seq = 0;
    }
    last_ms = t;
    return String(prefix) + ts17(t) + PID36 + seq.toString(36).padStart(3, '0');
}

module.exports = {
    generate: generate,
    ts17: ts17
};
