/**
 * Copyright (c) 2017, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file timer code of Mobius Yellow. manage state of Mobius
 * @copyright KETI Korea 2017, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var events = require('events');
var wdt = new events.EventEmitter();

var wdt_callback_q = {};
var wdt_value_q = {};
var wdt_tick_q = {};
var wdt_param1_q = {};
var wdt_param2_q = {};
var wdt_param3_q = {};

setInterval(function () {
    wdt.emit('resource_manager');
}, 1000);

wdt.on('resource_manager', function() {
    for (var id in wdt_value_q) {
        if(wdt_value_q.hasOwnProperty(id)) {
            ++wdt_tick_q[id];
            if((wdt_tick_q[id] % wdt_value_q[id]) == 0) {
                wdt_tick_q[id] = 0;
                if(wdt_callback_q[id]) {
                    wdt_callback_q[id](id, wdt_param1_q[id], wdt_param2_q[id], wdt_param3_q[id]);
                }
            }
        }
    }
});

exports.set_wdt = function (id, sec, callback_func, param1, param2, param3) {
    wdt_value_q[id] = sec;
    wdt_tick_q[id] = 0;
    wdt_callback_q[id] = callback_func;
    wdt_param1_q[id] = param1;
    wdt_param2_q[id] = param2;
    wdt_param3_q[id] = param3;
};

exports.get_wdt_callback = function (id) {
    return wdt_callback_q[id];
};

exports.get_wdt_value = function (id) {
    return wdt_value_q[id];
};

exports.del_wdt = function (id) {
    delete wdt_value_q[id];
    delete wdt_callback_q[id];
};