
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
 * @file code of cache manager.
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var ss_ri_cache_keep = 10;
var os = require('os');

function ss_ri_cache_ttl_manager() {
    try {
        var ss_ri_cache = get_all_ss_ri_cache();
        for (var idx in ss_ri_cache) {
            if (ss_ri_cache.hasOwnProperty(idx)) {
                ss_ri_cache[idx].ttl--;
                if (ss_ri_cache[idx].ttl <= 0) {
                    delete ss_ri_cache[idx];
                    console.log('delete cache of ' + idx);
                    del_ss_ri_cache(idx);
                }
                else {
                    console.log('ttl of cache of ' + idx + ' : ' + ss_ri_cache[idx].ttl);
                    set_ss_ri_cache(idx, ss_ri_cache[idx]);
                }
            }
        }
    }
    catch (e) {
        console.log("[ss_ri_cache_ttl_manager] " + e.message);
    }
}

wdt.set_wdt(require('shortid').generate(), ss_ri_cache_keep, ss_ri_cache_ttl_manager);

/*
var cbs_cache_keep = 10 * 60;
function cbs_cache_ttl_manager() {
    try {
        for(var idx in cbs_cache) {
            if(cbs_cache.hasOwnProperty(idx)) {
                if(cbs_cache[idx].ttl <= 0) {
                    delete cbs_cache[idx];
                    console.log('delete cache of ' + idx);
                    del_cbs_cache(idx);
                }
                else {
                    cbs_cache[idx].ttl--;
                    console.log('ttl of cache of ' + idx + ' : ' + cbs_cache[idx].ttl);
                    set_cbs_cache(idx, cbs_cache[idx]);
                }
            }
        }
    }
    catch (e) {
        console.log("[cbs_cache_ttl_manager] " + e.message);
    }
}

wdt.set_wdt(require('shortid').generate(), cbs_cache_keep, cbs_cache_ttl_manager);
*/