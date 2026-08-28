/**
 * @file 자동 생성 리소스 이름(rn) 생성기.
 *
 * rn 은 그대로 ri(= pi + '/' + rn)가 되고 ri 는 lookup 의 PK 다.
 * 따라서 rn 이 겹치면 리소스 생성이 409 로 실패한다.
 *
 * 예전 구현은 밀리초 타임스탬프뿐이었다:
 *     rn = ty + '-' + moment().utc().format('YYYYMMDDHHmmssSSS')
 *
 * 같은 밀리초에 두 건이 들어오면 rn 이 같아진다. 워커가 여러 개라 동시성이
 * 높을수록 잦다 — 실측(2026-08-28): CIN 40건 동시 POST 중 17건만 성공하고
 * 23건이 409 "resource is already exist" 로 유실됐다.
 *
 * 여기서는 타임스탬프 뒤에 두 가지를 붙인다:
 *   - 워커 태그   프로세스 간 충돌을 막는다
 *   - 순번        같은 프로세스, 같은 밀리초 안에서 증가한다
 *
 * 순번은 프로세스 안에서만 쓰이므로 경쟁이 없다(Node 는 단일 스레드).
 * 그래서 같은 워커 안에서는 충돌이 **원천적으로** 불가능하다.
 *
 * 폭이 고정이라 사전순 정렬이 곧 생성순 정렬이다. la/ol 이 같은 초에 만들어진
 * 형제들 사이에서 순서를 가릴 때 이 성질을 쓴다.
 *
 * 옛 형식(접미사 없음)과 섞여도 정렬이 깨지지 않는다. 타임스탬프 부분의 폭이
 * 같아서 차이는 그 뒤에서만 나기 때문이다 — 같은 밀리초면 옛 것이 앞에 오고,
 * 다른 밀리초면 타임스탬프가 결정한다. 마이그레이션이 필요 없다.
 */

'use strict';

var moment = require('moment');
var cluster = require('cluster');

// 동시에 살아 있는 워커끼리는 cluster 가 서로 다른 id 를 보장한다.
// 마스터에서 만들어지는 리소스(CSEBase 등)는 0 을 쓴다.
var WORKER_TAG = String(
    ((cluster.worker && cluster.worker.id) ? cluster.worker.id : 0) % 1000
).padStart(3, '0');

var seq = 0;
var last_ts = '';

// 같은 밀리초 안에서 증가하는 순번. 밀리초가 바뀌면 0 으로 돌아간다.
// 한 워커가 1밀리초에 1000건을 넘기면 순환하지만, 그 처리량은 이 코드베이스가
// 상정하는 범위를 한참 넘는다.
function next_seq(ts) {
    if (ts === last_ts) {
        seq = (seq + 1) % 1000;
    }
    else {
        last_ts = ts;
        seq = 0;
    }
    return String(seq).padStart(3, '0');
}

// 자동 생성 rn. 클라이언트가 rn 을 직접 주면 이 함수를 쓰지 않는다.
exports.next_rn = function (ty) {
    var ts = moment().utc().format('YYYYMMDDHHmmssSSS');
    return ty + '-' + ts + WORKER_TAG + next_seq(ts);
};

// 테스트용. 운영 코드는 워커 태그를 알 필요가 없다.
exports._worker_tag = function () { return WORKER_TAG; };
