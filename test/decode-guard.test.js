'use strict';
// 파서가 성공했다고 최상위가 객체인 것은 아니다.
//
// cbor.decodeFirst('f6') 는 err 없이 null 을 준다 — CBOR 의 null 값이라
// 파서 입장에서는 정상이다. 그런데 그것을 성공으로 넘기면 호출부가
// null 을 역참조한다.
//
// 실측으로 확인한 것:
//   WS 7577(인증 없음)에 subprotocol onem2m.r2.0.cbor 로 붙어 1바이트 0xF6
//     -> pxy_ws.js 의 jsonObj['m2m:rqp'] 에서 TypeError
//     -> 프록시는 cluster.isMaster 블록에서 require 되므로 마스터가 죽고,
//        워커 재시작 로직까지 함께 사라진다. 리스닝 포트가 전부 없어졌다.
//   POST /Mobius, Content-Type: application/cbor, 본문 'f6'
//     -> app.js 의 Object.keys(result) 에서 TypeError
//     -> 워커 사망 + db.getConnection 으로 빌린 커넥션 누수

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

// ── 전제: 파서가 성공해도 최상위가 객체인 것은 아니다 ────────────────
//
// 이 파일 전체의 근거다.
//
// 예전에는 이 자리에 cbor 로 같은 것을 보였다 — `cbor.decodeFirst('f6')` 이
// 오류 없이 null 을 준다는 것. 그 분기가 json 전용이 되며 사라졌고(2026-08-31)
// cbor 패키지도 의존성에서 뺐다. **교훈은 json 에도 그대로 있다.**

test('JSON.parse 는 오류 없이 객체가 아닌 것을 준다', function () {
    // 셋 다 던지지 않는다. 그대로 Object.keys 에 넣으면 그때 던진다 —
    // 그 자리가 DB 콜백이나 응답 직렬화 도중이라 잡을 곳이 없다.
    assert.strictEqual(JSON.parse('null'), null, '이 null 이 호출부로 흘러갔다');
    assert.strictEqual(JSON.parse('3'), 3);
    assert.strictEqual(JSON.parse('"문자열"'), '문자열');

    assert.throws(function () { return Object.keys(JSON.parse('null')); }, TypeError);
});

test('빈 Buffer 는 isBuffer 를 통과하고 [0] 이 undefined 다', function () {
    // pxy_coap.js 의 옵션 267 처리가 이것을 인덱싱했다.
    const empty = Buffer.alloc(0);
    assert.strictEqual(Buffer.isBuffer(empty), true);
    assert.strictEqual(empty[0], undefined);
    assert.throws(function () { return empty[0].toString(); }, TypeError);
});

// ── 가드가 자리에 있는가 ────────────────────────────────────────────
//
// app.js 는 require 하면 cluster.fork() 와 listen 이 돌아 함수를 직접
// 부를 수 없다. 소스에 가드가 남아 있는지로 확인한다.

// make_json_obj 시험이 여기 있었다. 그 함수는 2026-09-04 에 프로토콜 프록시
// 3종과 함께 지웠다 — 호출자가 그 셋뿐이었다.
//
// **뜻은 아래 parse_to_json 시험이 이어받는다.** 파서가 성공했다고 최상위가
// 객체인 것은 아니다 — JSON.parse('null') 은 null 을, JSON.parse('3') 은
// 숫자를 준다. 그대로 Object.keys 에 넣으면 던진다. 그 가드는 지금
// 코어의 유일한 본문 파싱 경로인 parse_to_json 에 있다.

test('parse_to_json 의 settle 이 최상위 객체 여부를 본다', function () {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

    const start = src.indexOf('function parse_to_json');
    assert.ok(start > 0);
    const body = src.slice(start, src.indexOf('\nfunction parse_body_format', start));

    assert.ok(/function settle\(result\) \{\s*\r?\n\s*if \(!usable_object\(result\)\)/.test(body),
        'settle 이 Object.keys 앞에서 결과를 검사하지 않는다 — 워커가 죽던 자리다');

    // json 분기가 settle 실패를 자기 코드로 받아야 한다.
    //
    // 예전에는 셋이었다 — 400-5(xml) / 400-6(cbor) / 400-7(json).
    // json 전용이 되면서 앞의 둘은 참조를 잃어 사유 카탈로그에서도 빠졌다
    // (2026-08-31). 남은 것은 400-7 하나다.
    assert.ok(body.indexOf("callback('400-7')") > 0,
        'json 분기가 settle 실패를 400-7 로 받지 않는다');

    // settle 은 boolean 을 돌려준다. 그 값을 안 보면 검사한 의미가 없다.
    assert.ok(/if \(!settle\(/.test(body),
        'settle 의 반환값을 보지 않는 호출부가 있다');

    // 되살아나면 안 되는 것: 사유 카탈로그에서 뺀 코드를 여기서 다시 쓰는 것.
    // reason.get('400-5') 는 이제 null 이라 respond 가 터진다.
    for (const gone of ['400-5', '400-6']) {
        assert.strictEqual(body.indexOf("callback('" + gone + "')"), -1,
            gone + ' 이 되살아났다 — 그 사유는 카탈로그에 없어 respond 가 터진다');
    }
});


