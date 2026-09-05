/**
 * Copyright (c) 2018, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

// fanOutPoint 의 입구. 멤버 목록을 풀고(DB) 보낼 곳을 정한 뒤 실제 요청은
// mobius/fanout.js 가 상한 있는 병렬로 보낸다 — 남은 일 §5.2 (2026-09-05).
// 옛 fopt_member(직렬 재귀 · 멤버마다 get_ri_sri) 는 없다.

var resource = require('./resource');   // make_internal_ri 전역을 세운다
var fanout = require('./fanout');
var once = require('./once');

exports.check = function(request, response, grp, body_Obj, callback) {
    // 팬아웃의 최상위 콜백이다. 응답 전송과 커넥션 반납으로 이어진다.
    callback = once(callback, 'fopt.check');

    request.headers.rootnm = 'agr';
    var cse_poa = {};
    update_route(request.db_connection, cse_poa, function (code) {
        if (code !== '200') {
            callback(code);
            return;
        }

        // 멤버 목록을 **한 번의 질의**로 푼다. 옛 코드는 원값으로 풀고(get_ri_list_sri) →
        // 접고(make_internal_ri) → 멤버마다 접은 값으로 또 풀었다(fopt_member 의
        // get_ri_sri). 그 뜻은 "원값이 sri 면 그 ri, 아니면 접은 값이 sri 면 그 ri, 아니면
        // 접은 값 그대로" 다. lookup 은 ri 가 구조 경로('/Mobius/ae/cnt') 이고 sri 가 짧은
        // id('3-2026…') 라서 원값과 접은 값 중 어느 쪽이 맞을지 미리 알 수 없다 — 둘을
        // 합쳐 whereIn 한 번에 묻고 옛 우선순위대로 고른다. 멤버별 조회는 없다.
        // (배포 그룹 5개의 mid 는 전부 'Mobius/…' 형이라 접은 값 쪽으로 간다 — 2026-09-05 실측.)
        // grp.mid 는 그대로 둔다 — make_internal_ri 는 제자리에서 고친다.
        var raw = grp.mid.slice();
        var folded = raw.slice();
        make_internal_ri(folded);
        var resolved = [];
        get_ri_list_sri(request, response, raw.concat(folded), resolved, 0, function (code) {
            if (code !== '200') {
                callback(code);
                return;
            }

            var ri_list = raw.map(function (r, i) {
                // 원값이 sri 로 맞았으면 그 ri(옛 1단). 아니면 접은 값으로 맞은 ri 또는 접은 값(옛 2단).
                return (resolved[i] !== r) ? resolved[i] : resolved[raw.length + i];
            });

            var targets = fanout.route(ri_list, cse_poa, { cb: usecsebase, port: usecsebaseport });
            fanout.run(request, targets, function (agr) {
                if (Object.keys(agr).length == 0) {
                    callback('404-5');
                    return;
                }
                request.resourceObj = agr;

                // 결과가 인자로 올라간다 — 옛 run_fanout 이 '200' 을 보고
                // search 200/2000(grouped, rootnm 'agr')을 골랐다. 2단계 9번.
                callback(null, { rsc: 'OK', shape: 'grouped', rootnm: 'agr', body: request.resourceObj });
            });
        });
    });
};
