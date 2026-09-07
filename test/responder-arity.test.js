'use strict';
// Contract on the argument count at every positional call of responder's response functions.
//
// The response functions take positional arguments; passing one too many shifts everything from the fourth on:
//
//   1. an object lands in the rsc slot -> apply_headers writes `X-M2M-RSC: [object Object]`
//   2. a string lands in the callback slot -> `callback()` throws TypeError and the worker dies
//
// As long as positional arguments exist this class of defect returns, so the counts are pinned.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Comments are stripped. Otherwise explanatory text satisfies the check; the comment above even contains an example call.
function code(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Counts the arguments of a call written on one line. Only commas at parenthesis depth 1 count; commas inside nested calls or object literals must not.
function arity(call) {
    var depth = 0;
    var n = 1;
    var started = false;
    var closed = false;
    for (var i = 0; i < call.length; i++) {
        var c = call[i];
        if (c === '(' || c === '[' || c === '{') { depth++; started = true; continue; }
        if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { closed = true; break; } continue; }
        if (c === ',' && depth === 1) { n++; }
    }
    // A call not closed on one line (`respond(request, response, {` with the object literal continuing on the next line) is outside this check; returning a partial count would misreport it as a 3-argument call.
    return started && closed ? n : 0;
}

// responder's positional response functions. Update when a signature changes. The remaining exits are respond and the body assembler body_of, with four or fewer positional arguments.
const EXPECTED = {
    respond: 4,
    body_of: 2
};

test('responder 의 응답 함수는 선언한 인자 개수를 그대로 받는다', function () {
    const src = code('mobius/responder.js');
    Object.keys(EXPECTED).forEach(function (name) {
        const m = src.match(new RegExp('exports\\.' + name + '\\s*=\\s*function\\s*\\(([^)]*)\\)'));
        assert.ok(m, 'responder.' + name + ' 선언을 못 찾았다 — 이 시험의 전제가 바뀌었다');
        const n = m[1].split(',').filter(function (s) { return s.trim(); }).length;
        assert.strictEqual(n, EXPECTED[name],
            'responder.' + name + ' 이 인자 ' + n + '개를 받는다 — 아래 호출부 검사의 기준값도 같이 고칠 것');
    });
});

test('responder 응답 함수를 인자 개수 맞게 부른다', function () {
    // Empty. Counting alone is not enough: adding one more argument to an already violating site keeps 'one violation' and passes, so the function and its argument count are pinned. The list may only shrink.
    const KNOWN_BAD = [];

    const files = ['app.js', 'mobius/resource.js', 'mobius/responder.js',
                   'mobius/settle.js', 'mobius/fopt.js', 'mobius/sgn.js'];
    const bad = [];      // 'response_result:7' form
    const where = [];    // human-readable location

    files.forEach(function (rel) {
        const lines = code(rel).split(/\r?\n/);
        lines.forEach(function (l, i) {
            Object.keys(EXPECTED).forEach(function (name) {
                const at = l.indexOf('responder.' + name + '(');
                if (at < 0) { return; }
                const n = arity(l.slice(at));
                // A call not contained in one line yields 0 and is outside this check.
                if (n === 0 || n === EXPECTED[name]) { return; }
                bad.push(name + ':' + n);
                where.push(rel + ':' + (i + 1) + '  ' + name + ' 에 인자 ' + n + '개 (기대 ' + EXPECTED[name] + ')');
            });
        });
    });

    assert.deepStrictEqual(bad.sort(), KNOWN_BAD.slice().sort(),
        '인자 개수가 안 맞는 호출이 달라졌다:\n  ' + where.join('\n  ') +
        '\n  넷째 인자부터 한 칸씩 밀려 X-M2M-RSC 에 객체가 나가고 callback() 이 TypeError 를 낸다' +
        '\n  고쳤으면 KNOWN_BAD 에서 그 항목을 지울 것');
});

test('mgmtObj 의 mgd 분기가 형제와 같게 코드만 돌려준다', function () {
    // The ty=13 branch of create_action sends the five mgd values (1001 fwr, 1006 bat, 1007 dvi, 1008 dvc, 1009 rbo) to their inserts and rejects the rest. The final else must return through the callback like its five siblings, not respond directly.
    //
    // The branch is currently unreachable: concrete mgmtObj types are absent from typeRsrc, so type_resolver rejects with 400-3 first. It is pinned so that opening mgmtObj does not run into an [object Object] header and a dead worker.
    const src = code('mobius/resource.js');

    // Only the ty=13 branch is inspected; strings in other branches would confuse the check.
    const at = src.indexOf("else if (ty == '13')");
    assert.ok(at > 0, "create_action 의 ty=13 분기를 못 찾았다 — 이 시험의 전제가 바뀌었다");

    // The end is whatever the next ty branch is. Pinning a specific type number would break this test on unrelated edits to that branch.
    const rest = src.slice(at + 1);
    const m = rest.match(/else if \(ty == '\d+'/);
    const end = m ? at + 1 + m.index : src.length;
    const branch = src.slice(at, end);

    assert.ok(branch.indexOf("callback('400-53')") >= 0,
        'mgmtObj 의 알 수 없는 mgd 갈래가 400-53 으로 답하지 않는다');
    assert.strictEqual(/responder\./.test(branch), false,
        'mgmtObj 분기가 responder 를 직접 부른다 — 응답은 라우트의 정산기가 한다');
    assert.strictEqual(/callback\('0'/.test(branch), false,
        "카탈로그에 없는 '0' 을 위로 올린다 — 그 코드는 reason.get 이 null 을 내고 500 이 된다");
});

test('resource.js 는 응답을 직접 보내지 않는다', function () {
    // The route's settler (settle) sends the response exactly once. A lower module sending directly opens two problems at once: the settler's double-settlement guard does not engage (the first response was not claimed), and if the module also passes a code upward the route writes to a finished response.
    //
    // No allow-list: 'only these functions are forbidden' lets anything outside the list through, and responder.respond, the single response entry point, is easy to omit. The lock runs the other way: only data reads are allowed.
    const src = code('mobius/resource.js');

    // Data access only: reads tables, builds no response.
    const DATA_ONLY = ['typeRsrc', 'mgoType', 'typeCheckforJson'];

    const bad = [];
    src.split(/\r?\n/).forEach(function (l, i) {
        const m = l.match(/responder\.([A-Za-z0-9_]+)/g);
        if (!m) { return; }
        m.forEach(function (hit) {
            const name = hit.slice('responder.'.length);
            if (DATA_ONLY.indexOf(name) >= 0) { return; }
            bad.push('resource.js:' + (i + 1) + '  ' + hit);
        });
    });

    assert.deepStrictEqual(bad, [],
        'resource.js 가 responder 의 응답 함수를 직접 부른다:\n  ' + bad.join('\n  ') +
        '\n  코드만 callback 으로 올리고 응답은 라우트의 정산기에 맡길 것' +
        '\n  (표를 읽기만 하는 것이면 이 시험의 DATA_ONLY 에 추가할 것)');
});

test('죽은 create_resource 가 되살아나지 않았다', function () {
    // create_resource was a 53-line function with no callers. build_resource does the same job and returns a catalogue code through the callback, which is the correct form. Dead code left behind becomes the next person's template.
    const src = code('mobius/resource.js');
    assert.strictEqual(/function\s+create_resource\s*\(/.test(src), false,
        'create_resource 가 돌아왔다 — 지운 이유는 그 자리 주석에 있다');

    // The live twin must remain. If it disappears too, the validation is gone entirely.
    assert.match(src, /function\s+build_resource\s*\(/,
        'build_resource 가 없다 — 속성 검증이 통째로 사라졌는지 확인할 것');

    // build_resource answers with catalogue codes. The four branches correspond to the four branches of the deleted function.
    ['400-22', '400-25', '400-26', '405-5'].forEach(function (k) {
        assert.ok(src.indexOf("'" + k + "'") >= 0,
            'build_resource 가 ' + k + ' 를 안 쓴다 — 지운 함수가 하던 검증이 빠졌는지 확인할 것');
    });
});
