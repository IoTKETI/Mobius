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

// conf 로딩은 mobius/conf_load.js 로 옮겼다(2026-09-05). 이 파일은 순서만 잡는다.
//
//   설정을 읽어 전역을 세운다 → 실패면 종료 → CSE 코어를 띄운다
//
// **종료는 여기서만 한다.** conf_load 는 어떤 경로에서도 exit 하지 않는다 —
// 모듈이 exit 하면 시험 러너가 통째로 죽는다.
var conf_load = require('./mobius/conf_load');
var boot_record = require('./mobius/boot_record');

conf_load(function (err, applied) {
    if (err) {
        console.error(err.message);
        process.exit(1);
        return;
    }
    // 기동 시 적용된 값을 남긴다. 던지지 않는다 — 기록 실패가 기동을 막지 않는다.
    // 마스터는 여기서 파일을 비운다.
    boot_record.write(applied, { confPath: conf_load.DEFAULT_FILE });
    // CSE core
    require('./app');
});
