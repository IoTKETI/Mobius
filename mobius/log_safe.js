'use strict';
//
// 로그에 자격증명을 적지 않는다.
//
// ── 왜 있나 ──────────────────────────────────────────────────────────────
// `X-M2M-Origin` 은 보통 AE 이름이라 진단에 유용하다. 그런데 그 자리에
// **수퍼유저 값**이 오면 이야기가 달라진다 — 그 값을 헤더에 넣으면
// security.js 가 맨 앞에서 통과시켜 **모든 ACP 검사를 건너뛴다.**
// 사실상 마스터 키다.
//
// conf_schema 는 그 값을 `secret: true, exposed: false` 로 선언해 관리
// 화면에 못 올리게 막아 두었다. 그런데 운영 로그에는 평문으로 적히고
// 있었다 — 로그는 보통 화면보다 열람 범위가 넓다.
//
// ── 어쩌다 그랬나 ────────────────────────────────────────────────────────
// 2026-08-31 에 `console.log(f_headers)` 를 걷어냈다. 헤더 객체를 통째로
// 찍어 X-M2M-Origin 이 남는다는 것이 이유였다. 그러면서 같은 커밋 묶음에서
// `[json_only]` 와 `[body_limit]` 로그에 `origin=` 을 **새로 넣었다.**
// 지운 이유와 넣은 것이 정면으로 어긋났다.
//
// 배포 로그에서 실제로 확인했다:
//     [json_only] POST /Mobius  Content-Type: ...+xml  origin=Sponde
//
// ── 무엇을 하나 ──────────────────────────────────────────────────────────
// 수퍼유저와 일치할 때만 가린다. 평범한 AE 이름은 그대로 둔다 —
// 전부 가리면 "누가 그랬나" 를 알 수 없어 로그의 값이 사라진다.
//
// 앞의 '/' 도 함께 본다. security.js:562 가 `from == usesuperuser ||
// from == ('/'+usesuperuser)` 로 둘 다 통과시키므로, 가리는 쪽도 둘 다
// 가려야 한다.

var MASK = '<superuser>';

/**
 * 로그에 실을 origin 을 돌려준다.
 *
 *   log_safe.origin(request.headers['x-m2m-origin'])
 *
 * 수퍼유저면 '<superuser>' 로, 비어 있으면 '?' 로, 그 밖에는 원본 그대로.
 */
exports.origin = function (v) {
    if (v === undefined || v === null || v === '') { return '?'; }
    var s = String(v);

    // global 이 아직 안 세워졌으면(테스트에서 mobius.js 없이 로드) 가릴 것이
    // 무엇인지 모른다. 그때는 원본을 둔다 — 그 상황에는 진짜 키도 없다.
    var su = global.usesuperuser;
    if (typeof su !== 'string' || su === '') { return s; }

    if (s === su || s === '/' + su) { return MASK; }
    return s;
};

// 테스트가 문구를 확인할 수 있게 열어 둔다.
exports.MASK = MASK;
