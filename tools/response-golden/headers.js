'use strict';
/*
 * 응답의 **헤더와 본문 모양**을 찍는다. responder 를 손보기 전후로 돌려 대조한다.
 *
 *   node tools/response-golden/headers.js <포트> <출력파일>
 *   node tools/response-golden/headers.js --diff <전> <후>
 *
 * ── 왜 따로 있나 ────────────────────────────────────────────────────────
 * 같은 디렉터리의 골든 하네스(tap.js -> collect.js -> compare.js)는
 * fn / status / rsc / dbg / method 만 기록한다. **헤더는 안 본다.**
 *
 * 그런데 responder 는 응답 헤더를 다섯 자리에서 각자 세운다:
 *   response_result / response_rcn3_result / search_result / sendError, 그리고
 *   response_result 안의 rt=3 분기. 그 다섯이 이미 갈려 있다 — 예를 들어
 *   Accept 에코를 어떤 경로는 하고 어떤 경로는 안 한다. 그것을 합치려면
 *   합치기 전에 무엇이 나가는지 적어 둬야 한다.
 *
 * ── 무엇을 지우고 무엇을 남기나 ─────────────────────────────────────────
 * 실행마다 달라지는 값은 지우거나 자리표시자로 바꾼다. 안 그러면 코드를
 * 하나도 안 고쳐도 diff 가 뜬다:
 *   date / content-length / etag / connection / x-m2m-ri  -> 통째로 뺀다
 *   원점 이름, CIN 의 ri                                  -> <ORIGIN>, <CIN-ID>
 * 본문은 값이 아니라 **최상위 키 집합**만 본다. 값에는 시각과 id 가 섞인다.
 */

var http = require('http');
var fs = require('fs');

var VOLATILE = /^(date|content-length|etag|connection|keep-alive|x-m2m-ri)$/;

/*
 * 헤더 값이 이 모양이면 무언가를 잘못 문자열로 만든 것이다.
 *
 * 실제로 당했다. json 전용 관문이 `X-M2M-RSC: [object Object]` 를 내보냈다 —
 * reason 항목의 `code` 는 숫자가 아니라 rsc.js 의 카탈로그 객체인데
 * `String(r.code)` 를 했다. 관문 케이스('xml 본문 accept 없음')는 이 표에
 * 이미 있었고 값도 찍히고 있었는데, 눈으로 훑다 놓쳤다.
 *
 * 대조(diff)만으로는 못 잡는 부류다. **전에도 후에도 똑같이 틀리면** 차이가
 * 0 이다. 그래서 대조와 별개로 값 자체를 본다.
 */
var GARBAGE = /^(\[object [A-Za-z]+\]|undefined|null|NaN)$/;

/* ── 대조 ──────────────────────────────────────────────────────────── */

function diff(beforePath, afterPath) {
    var a = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
    var b = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

    if (a.length !== b.length) {
        console.log('건수가 다르다: ' + a.length + ' vs ' + b.length);
        process.exit(1);
    }
    var n = 0;
    for (var i = 0; i < a.length; i++) {
        if (JSON.stringify(a[i]) === JSON.stringify(b[i])) { continue; }
        n++;
        console.log('── ' + a[i].label);
        var ha = a[i].headers || {}, hb = b[i].headers || {};
        var keys = {};
        Object.keys(ha).forEach(function (k) { keys[k] = 1; });
        Object.keys(hb).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).sort().forEach(function (k) {
            if (ha[k] !== hb[k]) {
                console.log('   헤더 ' + k + '\n     전= ' + ha[k] + '\n     후= ' + hb[k]);
            }
        });
        ['status', 'bodyKeys', 'bodyLen'].forEach(function (k) {
            if (JSON.stringify(a[i][k]) !== JSON.stringify(b[i][k])) {
                console.log('   ' + k + '   전= ' + JSON.stringify(a[i][k]) +
                            '   후= ' + JSON.stringify(b[i][k]));
            }
        });
    }
    console.log('');
    console.log(n === 0 ? a.length + '건 전부 동일' : '차이 ' + n + '건 / ' + a.length);
    process.exit(n === 0 ? 0 : 1);
}

/* ── 수집 ──────────────────────────────────────────────────────────── */

function collect(PORT, OUT) {
    var ORIGIN = 'Cres' + Date.now().toString(36);
    var AE = '/Mobius/' + ORIGIN;
    var rows = [];

    function req(label, m, p, b, ctype, extra, cb) {
        var d = b ? (typeof b === 'string' ? b : JSON.stringify(b)) : null;
        var h = { 'X-M2M-RI': 'fixed-ri', 'X-M2M-Origin': ORIGIN };
        if (ctype) { h['Content-Type'] = ctype; }
        if (d) { h['Content-Length'] = Buffer.byteLength(d); }
        Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });

        var r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: m, headers: h },
            function (res) {
                var x = '';
                res.on('data', function (c) { x += c; });
                res.on('end', function () {
                    var hdr = {};
                    Object.keys(res.headers).sort().forEach(function (k) {
                        if (VOLATILE.test(k)) { return; }
                        var v = String(res.headers[k]);
                        v = v.split(ORIGIN).join('<ORIGIN>').replace(/4-\d{15,}/g, '<CIN-ID>');
                        hdr[k] = v;
                    });
                    rows.push({ label: label, method: m, status: res.statusCode,
                                headers: hdr, bodyKeys: shape(x), bodyLen: x.length });
                    cb(res.statusCode, x);
                });
            });
        r.on('error', function (e) { rows.push({ label: label, error: e.message }); cb(0, ''); });
        if (d) { r.write(d); }
        r.end();
    }

    function shape(s) {
        if (!s) { return '(빈 본문)'; }
        try {
            var o = JSON.parse(s);
            var root = Object.keys(o)[0];
            if (o[root] && typeof o[root] === 'object' && !Array.isArray(o[root])) {
                return root + ': ' + Object.keys(o[root]).sort().join(',');
            }
            return root + ': ' + (Array.isArray(o[root]) ? '[배열]' : typeof o[root]);
        }
        catch (e) {
            if (s.trim().charAt(0) === '<') { return 'xml: ' + (s.match(/<([a-z0-9:_]+)/i) || [])[1]; }
            return '(json 아님, ' + s.length + '자)';
        }
    }

    var J = 'application/json';
    var CNT;

    req('AE 생성', 'POST', '/Mobius', { 'm2m:ae': { rn: ORIGIN, api: 'res', rr: true } }, J + ';ty=2', null,
    function (a) {
        if (a !== 201) { console.log('AE 생성 실패 ' + a + ' — 서버가 떠 있는지 확인할 것'); process.exit(1); }
        CNT = AE + '/c';
        req('CNT 생성', 'POST', AE, { 'm2m:cnt': { rn: 'c' } }, J + ';ty=3', null, function () {
        req('CIN 생성', 'POST', CNT, { 'm2m:cin': { con: 'v1' } }, J + ';ty=4', null, function () {

        // 다섯 응답 경로를 전부 밟는다:
        //   response_result   GET / PUT / DELETE
        //   search_result     discovery
        //   response_rcn3     rcn=3
        //   sendError         404 / 400 / 409
        var steps = [
            ['GET json',        'GET', CNT, null, null, { Accept: J }],
            ['GET xml',         'GET', CNT, null, null, { Accept: 'application/xml' }],
            ['GET cbor',        'GET', CNT, null, null, { Accept: 'application/cbor' }],
            ['GET accept 없음', 'GET', CNT, null, null, {}],
            ['GET rvi 있음',    'GET', CNT, null, null, { 'X-M2M-RVI': '2a', Accept: J }],
            ['GET locale 있음', 'GET', CNT, null, null, { Locale: 'ko', Accept: J }],
            ['GET la',          'GET', CNT + '/la', null, null, { Accept: J }],
            ['discovery',       'GET', AE + '?fu=1&rcn=6', null, null, { Accept: J }],
            ['discovery xml',   'GET', AE + '?fu=1&rcn=6', null, null, { Accept: 'application/xml' }],
            ['404 없는 리소스', 'GET', AE + '/nope', null, null, { Accept: J }],
            ['404 xml',         'GET', AE + '/nope', null, null, { Accept: 'application/xml' }],
            ['400 잘못된 ty',   'POST', AE, '{"m2m:cnt":{"rn":"x"}}', J + ';ty=99', {}],
            ['409 la 에 POST',  'POST', CNT + '/la', '{"m2m:cin":{"con":"x"}}', J + ';ty=4', {}],
            ['PUT json',        'PUT', CNT, { 'm2m:cnt': { lbl: ['a'] } }, J, { Accept: J }],
            ['PUT xml',         'PUT', CNT, { 'm2m:cnt': { lbl: ['b'] } }, J, { Accept: 'application/xml' }],
            ['POST rcn3',       'POST', CNT + '?rcn=3', { 'm2m:cin': { con: 'v2' } }, J + ';ty=4', { Accept: J }],

            // Accept 가 없을 때 무엇으로 답하는가.
            //
            // **지금은 언제나 json 이다.** Accept 도 요청의 Content-Type 도
            // 응답 형식을 바꾸지 못한다 — responder.apply_headers 가 한 자리에서
            // `application/json` 으로 고정한다.
            //
            // 이 서술은 2026-09-03 에 고쳤다. 그전에는 "usebodytype 이 요청의
            // Content-Type 에서 오고, 경로에 따라 그것을 그대로 두거나 json 으로
            // 덮는다" 고 적혀 있었다. xml/cbor 시절에는 맞았지만 json 전용이 된
            // 뒤로는 **틀린 서술이 코드보다 오래 남아 있었다.**
            //
            // 그래도 이 세 줄은 계속 찍는다. 경로가 셋(response_result ·
            // search_result · response_rcn3_result)이라, 그중 하나가 형식을
            // 다시 갈라 놓으면 여기서 드러난다.
            ['xml 본문 accept 없음',  'PUT', CNT, '<m2m:cnt xmlns:m2m="http://www.onem2m.org/xml/protocols"><lbl>c</lbl></m2m:cnt>',
                                       'application/xml', {}],
            ['discovery accept 없음', 'GET', AE + '?fu=1&rcn=6', null, null, {}],
            ['404 accept 없음',       'GET', AE + '/nope', null, null, {}],

            // json 전용 관문. 위 'xml 본문' 이 이미 하나 밟지만, 관문은 셋을
            // 구분해야 한다 — 거절하는 MIME 둘과, 이름에 xml 이 섞였을 뿐인
            // 정상 요청 하나. 마지막 것이 400 이 되면 부분 문자열로 되돌아간 것이다.
            ['cbor 본문 거절',   'PUT', CNT, 'a1', 'application/vnd.onem2m-res+cbor', {}],
            ['xml+접미사 거절',  'PUT', CNT, '<x/>', 'application/vnd.onem2m-res+xml;ty=3', {}],
            ['json 인데 xml 글자', 'PUT', CNT, { 'm2m:cnt': { lbl: ['d'] } }, J + ';ty=3;note=xmlish', {}]
        ];

        var i = 0;
        (function next() {
            if (i >= steps.length) { return finish(); }
            var s = steps[i++];
            req(s[0], s[1], s[2], s[3], s[4], s[5], function () { next(); });
        })();
        }); });
    });

    function finish() {
        req('AE 삭제', 'DELETE', AE, null, null, { Accept: J }, function () {
            fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
            console.log('응답 ' + rows.length + '건을 ' + OUT + ' 에 기록\n');
            var bad = [];
            rows.forEach(function (r) {
                var h = r.headers || {};
                Object.keys(h).forEach(function (k) {
                    if (GARBAGE.test(h[k])) { bad.push(r.label + '  ' + k + ': ' + h[k]); }
                });
                console.log('  ' + String(r.status || 'ERR').padStart(3) + '  ' +
                            (r.label + '                      ').slice(0, 22) +
                            '  ct=' + (h['content-type'] || '-') +
                            '  rsc=' + (h['x-m2m-rsc'] || '-') +
                            (h.accept !== undefined ? '  accept에코=' + h.accept : ''));
            });
            if (bad.length) {
                console.log('\n헤더에 망가진 값 ' + bad.length + '건 — 무언가를 잘못 문자열로 만들었다:');
                bad.forEach(function (b) { console.log('  ' + b); });
                process.exit(1);
            }
            process.exit(0);
        });
    }

    setTimeout(function () { console.log('시간 초과 — 서버가 응답하지 않는다'); process.exit(2); }, 60000);
}

/* ── 진입 ──────────────────────────────────────────────────────────── */

var argv = process.argv.slice(2);
var d = argv.indexOf('--diff');
if (d >= 0 && argv[d + 1] && argv[d + 2]) { diff(argv[d + 1], argv[d + 2]); }
else if (argv[0] && argv[1]) { collect(Number(argv[0]), argv[1]); }
else {
    console.log('사용법:');
    console.log('  node tools/response-golden/headers.js <포트> <출력파일>');
    console.log('  node tools/response-golden/headers.js --diff <전> <후>');
    process.exit(2);
}
