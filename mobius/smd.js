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

// require 가 하나도 없다. 브로커 호출을 걷어내고 나니 build_smd 는
// 넘겨받은 객체의 필드를 옮겨 담기만 한다 — 순수 함수다.
//
// 예전에는 열 개를 require 했다(url · xml2js · xmlbuilder · util · body ·
// responder · http · https · fs · outbound). 전부 브로커로 나가는 HTTP
// 요청과 그 응답 처리에 쓰던 것이라 함께 죽었다.

exports.build_smd = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // body
    resource_Obj[rootnm].dsp = body_Obj[rootnm].dsp;
    resource_Obj[rootnm].dcrp = body_Obj[rootnm].dcrp;

    resource_Obj[rootnm].or = (body_Obj[rootnm].or) ? body_Obj[rootnm].or : '';
    // cr 은 서버가 정한다 — 이유는 mobius/cnt.js 의 같은 자리 주석 참조.
    resource_Obj[rootnm].cr = request.headers['x-m2m-origin'];
    resource_Obj[rootnm].soe = (body_Obj[rootnm].soe) ? body_Obj[rootnm].soe : '';
    resource_Obj[rootnm].rels = (body_Obj[rootnm].rels) ? body_Obj[rootnm].rels : [];

    request.resourceObj = JSON.parse(JSON.stringify(resource_Obj));
    resource_Obj = null;

    callback('200');
};

// ── 여기 있던 시맨틱 브로커 호출 둘을 걷어냈다 (2026-08-31) ────────────
//
//     request_post           ty=24 생성 후 브로커로 POST (fire-and-forget)
//     request_get_discovery  ?fu=1&smf= 로 브로커에 시맨틱 탐색을 위임
//
// 사용자가 브로커를 쓰지 않기로 했다. 주소가 mobius.js 에
// usesemanticbroker = 사설 IP 로 박혀 있었는데, 그것은 CLAUDE.md 의
// 배포 종속 값 금지 규약 위반이기도 했다. 포트 7591 도 하드코딩이었다.
//
// 배포 실측: semanticDescriptor 리소스 0건, 그 주소는 닿지도 않는다.
// 즉 request_post 는 매번 조용히 실패했고, smf 탐색은 아웃바운드
// 타임아웃(기본 10초)을 다 쓰고 404-2 를 냈다.
//
// **ty=24 자체는 그대로다.** 생성·조회·수정·삭제 전부 영향이 없다.
// build_smd 가 위에 남아 있고 smd 테이블도 스키마에 그대로다.
// 브로커를 다시 쓸 일이 생기면 그때 주소를 conf 로 빼서 새로 만든다.
