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

var util = require('util');
var url = require('url');
var http = require('http');
var https = require('https');
var coap = require('coap');
var js2xmlparser = require('js2xmlparser');
var xmlbuilder = require('xmlbuilder');
var fs = require('fs');
var db = require('./db_action');
var db_sql = require('./sql_action');
var cbor = require("cbor");
var merge = require('merge');

var responder = require('./responder');
var poa_util = require('./poa');
var subl_entry = require('./subl');

var sgn_man = require('./sgn_man');

function make_xml_noti_message(pc, xm2mri, callback) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        //noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
        //noti_message['m2m:rqp'].to = pc['m2m:sgn'].sur;
        noti_message['m2m:rqp'].fr = usecseid;
        noti_message['m2m:rqp'].rqi = xm2mri;
        noti_message['m2m:rqp'].pc = pc;

        if(noti_message['m2m:rqp'].pc.hasOwnProperty('m2m:sgn')) {
            if(noti_message['m2m:rqp'].pc['m2m:sgn'].hasOwnProperty('nev')) {
                for(var prop in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep) {
                    if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep.hasOwnProperty(prop)) {
                        for(var prop2 in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop]) {
                            if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop].hasOwnProperty(prop2)) {
                                if(prop2 == 'rn') {
                                    noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop]['@'] = {rn : noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]};
                                    delete noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2];
                                    break;
                                }
                                else {
                                    for (var prop3 in noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]) {
                                        if (noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2].hasOwnProperty(prop3)) {
                                            if (prop3 == 'rn') {
                                                noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2]['@'] = {rn: noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2][prop3]};
                                                delete noti_message['m2m:rqp'].pc['m2m:sgn'].nev.rep[prop][prop2][prop3];
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        noti_message['m2m:rqp']['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        var xmlString = js2xmlparser.parse("m2m:rqp", noti_message['m2m:rqp']);

        callback(xmlString);
    }
    catch (e) {
        console.log('[make_xml_noti_message] xml parsing error');
        callback(e.message);
        return "";
    }
}

function make_cbor_noti_message(pc, xm2mri) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        //noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
        //noti_message['m2m:rqp'].to = pc['m2m:sgn'].sur;
        noti_message['m2m:rqp'].fr = usecseid;
        noti_message['m2m:rqp'].rqi = xm2mri;

        noti_message['m2m:rqp'].pc = pc;

        return cbor.encode(noti_message['m2m:rqp']).toString('hex');
    }
    catch (e) {
        console.log('[make_cbor_noti_message] cbor parsing error');
    }
}

function make_json_noti_message(nu, pc, xm2mri, short_flag) {
    try {
        var noti_message = {};
        noti_message['m2m:rqp'] = {};
        noti_message['m2m:rqp'].op = 5; // notification
        noti_message['m2m:rqp'].rqi = xm2mri;

        if(short_flag == 1) {

        }
        else {
            //noti_message['m2m:rqp'].net = pc['m2m:sgn'].net;
            noti_message['m2m:rqp'].to = nu;
            noti_message['m2m:rqp'].fr = usecseid;
        }

        noti_message['m2m:rqp'].pc = pc;

        var notiString = JSON.stringify(noti_message['m2m:rqp']);
        delete noti_message;
        noti_message = null;
        return notiString;
    }
    catch (e) {
        console.log('[make_json_noti_message] json parsing error');
    }
}

function make_body_string_for_noti(protocol, nu, node, sub_bodytype, xm2mri, short_flag, callback) {
    if (sub_bodytype == 'xml') {
        if (protocol == 'http:' || protocol == 'https:' || protocol == 'coap:') {
            try {
                var bodyString = responder.convertXmlSgn(Object.keys(node)[0], node[Object.keys(node)[0]]);
            }
            catch (e) {
                bodyString = "";
            }
            callback(bodyString);
        }
        else if (protocol == 'ws:' || protocol == 'mqtt:') {
            make_xml_noti_message(node, xm2mri, function (bodyString) {
                callback(bodyString);
            });

        }
        else {
            callback('');
        }
    }
    else if (sub_bodytype == 'cbor') {
        if (protocol == 'http:' || protocol == 'https:' || protocol == 'coap:') {
            bodyString = cbor.encode(node).toString('hex');
            callback(bodyString);
        }
        else if (protocol == 'ws:' || protocol == 'mqtt:') {
            bodyString = make_cbor_noti_message(node, xm2mri);
            callback(bodyString);
        }
        else {
            callback('');
        }
    }
    else { // defaultbodytype == 'json')
        if (protocol == 'http:' || protocol == 'https:' || protocol == 'coap:') {
            bodyString = JSON.stringify(node);
            callback(bodyString);
        }
        else if (protocol == 'ws:' || protocol == 'mqtt:') {
            bodyString = make_json_noti_message(nu, node, xm2mri, short_flag);
            callback(bodyString);
        }
        else {
            callback('');
        }
    }
}

function sgn_action_send(nu_arr, req_count, sub_bodytype, node, short_flag, check_value, ss_cr, ss_ri, xm2mri, exc, parentObj, callback) {
    if(nu_arr.length <= req_count) {
        callback('200');
        return;
    }

    var nu = nu_arr[req_count];
    var sub_nu = url.parse(nu);

    // nu 마다 자기 값을 쓴다. 예전에는 파라미터 자체를 덮어쓰고 그 값을
    // 그대로 다음 nu 로 넘겨서, 앞선 nu 의 옵션이 뒤에 전부 번졌다.
    //
    // 실측: nu = ['http://a/?rcn=9', 'http://b/'] 로 두면 b 도 축약본을 받았다.
    // 요청하지도 않은 형식·내용이 가는 것이고, 로그에는 아무것도 남지 않는다.
    var this_bodytype = sub_bodytype;
    var this_node = node;
    var this_short = short_flag;

    if (sub_nu.query != null) {
        var sub_nu_query_arr = sub_nu.query.split('&');
        for (var prop in sub_nu_query_arr) {
            if (sub_nu_query_arr.hasOwnProperty(prop)) {
                if (sub_nu_query_arr[prop].split('=')[0] == 'ct') {
                    if (sub_nu_query_arr[prop].split('=')[1] == 'xml') {
                        this_bodytype = 'xml';
                    }
                    else {
                        this_bodytype = 'json';
                    }
                }
                else if (sub_nu_query_arr[prop].split('=')[0] == 'rcn') {
                    if (sub_nu_query_arr[prop].split('=')[1] == '9') {
                        // 여기서만 복제한다. 대부분의 nu 는 옵션이 없으므로
                        // 매번 복제하면 알림마다 그만큼이 그대로 낭비다.
                        this_node = JSON.parse(JSON.stringify(node));

                        for (var index in this_node['m2m:sgn'].nev.rep) {
                            if (this_node['m2m:sgn'].nev.rep.hasOwnProperty(index)) {
                                if (this_node['m2m:sgn'].nev.rep[index].cr) {
                                    delete this_node['m2m:sgn'].nev.rep[index].cr;
                                }

                                if (this_node['m2m:sgn'].nev.rep[index].st) {
                                    delete this_node['m2m:sgn'].nev.rep[index].st;
                                }

                                delete this_node['m2m:sgn'].nev.rep[index].ct;
                                delete this_node['m2m:sgn'].nev.rep[index].lt;
                                delete this_node['m2m:sgn'].nev.rep[index].et;
                                delete this_node['m2m:sgn'].nev.rep[index].ri;
                                delete this_node['m2m:sgn'].nev.rep[index].pi;
                                delete this_node['m2m:sgn'].nev.rep[index].rn;
                                delete this_node['m2m:sgn'].nev.rep[index].ty;
                                delete this_node['m2m:sgn'].nev.rep[index].fr;

                                this_short = 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // 아래 둘은 nu 와 무관하게 모든 수신자에게 똑같이 적용된다.
    // 몇 번을 돌려도 같은 결과라 공유 객체에 그대로 둔다.
    if(check_value == 128) {
        this_node['m2m:sgn'].sud = true;
        delete this_node['m2m:sgn'].nev;
    }
    else if(check_value == 256) {
        if(!this_node['m2m:sgn'].hasOwnProperty('vrq')) {
            this_node['m2m:sgn'].vrq = true;
        }
        this_node['m2m:sgn'].vrq = true;
        var temp = this_node['m2m:sgn'].sur;
        delete this_node['m2m:sgn'].sur;
        this_node['m2m:sgn'].sur = temp;
        this_node['m2m:sgn'].cr = ss_cr;
        delete this_node['m2m:sgn'].nev;
    }

    this_node['m2m:sgn'].rvi = uservi;

    make_body_string_for_noti(sub_nu.protocol, nu, this_node, this_bodytype, xm2mri, this_short, function (bodyString) {
        if (bodyString === '') { // parse error
            // 어느 구독인지 없으면 이 줄로 아무것도 못 한다.
            console.error('[noti] fail - sub=' + (ss_ri || '?') + ' nu=' + nu +
                          ' (본문을 ' + this_bodytype + ' 로 만들지 못했다)');
        }
        else {
            // ss_ri 는 이 함수가 이미 인자로 들고 있던 값이다 — 추가 조회가 없다.
            // 알림 로그에 구독 ri 가 없어서 "어느 구독이 실패했나" 를
            // 역추적할 수 없었다. 관리 UI 가 물어볼 첫 번째 질문이 그것이다.
            setTimeout(function (nu, bodytype, xm2mri, bodyString, ri) {
                sgn_man.post(nu, bodytype, xm2mri, bodyString, ri);
            }, parseInt(1 + Math.random() * 10), nu, this_bodytype, xm2mri, bodyString, ss_ri);
        }

        // 다음 nu 에는 **원래 값**을 넘긴다. 이 nu 의 옵션이 번지면 안 된다.
        sgn_action_send(nu_arr, ++req_count, sub_bodytype, node, short_flag, check_value, ss_cr, ss_ri, xm2mri, exc, parentObj, function (code) {
            callback(code);
        });
    });
}

// sub_ri 는 로그 역추적용이다. 어느 구독의 nu 를 풀다 실패했는지가
// "받을 놈이 사라진 구독" 을 찾는 유일한 단서인데, 예전에는 로그에
// nu 대상의 ri 만 있고 구독 ri 가 없어 되짚을 수가 없었다.
function get_nu_arr(connection, nu_arr, req_count, callback, sub_ri) {
    if(nu_arr.length <= req_count) {
        callback('200');
        return;
    }

    var nu = nu_arr[req_count];
    var sub_nu = url.parse(nu);

    if(sub_nu.protocol == null) { // ID format
        var absolute_url = nu;
        absolute_url = absolute_url.replace(usespid + usecseid + '/', '/');
        absolute_url = absolute_url.replace(usecseid + '/', '/');

        if(absolute_url.charAt(0) != '/') {
            absolute_url = '/' + absolute_url;
        }

        var absolute_url_arr = absolute_url.split('/');

        db_sql.get_ri_sri(connection, absolute_url_arr[1].split('?')[0], function (err, results) {
            if (err) {
                console.error('[noti] fail - sub=' + (sub_ri || '?') + ' nu=' + nu +
                              ' (nu 해석 중 DB 오류)');
                nu_arr.splice(req_count, 1);
                get_nu_arr(connection, nu_arr, req_count, callback, sub_ri);
            }
            else {
                absolute_url = (results.length == 0) ? absolute_url : ((results[0].hasOwnProperty('ri')) ? absolute_url.replace('/' + absolute_url_arr[1], results[0].ri) : absolute_url);

                var sri = absolute_url_arr[1].split('?')[0];
                var ri = absolute_url.split('?')[0];
                db_sql.select_resource_from_url(connection, ri, sri, function (err, result_Obj) {
                    if (!err) {
                        // 예전에는 이 두 조건에 else 가 없어, 리소스를 못 찾거나
                        // poa 가 비면 콜백이 사라졌다. 알림 사슬이 그대로 멈췄다.
                        //
                        // 그다음 고칠 때 '순회만 이어 간다' 고 주석을 적었는데
                        // 코드는 callback 후 return 이라 **거기서 끝났다**.
                        // 그러면 뒤에 오는 ID 형식 nu 가 영영 안 풀린다.
                        // 그리고 못 푼 문자열을 배열에 남기면 발송 단계가 그것을
                        // 주소로 착각해 엉뚱한 두 번째 실패 로그를 낸다 —
                        // 구독 하나가 두 줄로 보인다. 그래서 빼고 이어 간다.
                        // splice 로 한 칸 줄었으므로 재귀는 req_count 그대로다.
                        if (result_Obj.length != 1) {
                            console.error('[noti] fail - sub=' + (sub_ri || '?') + ' nu=' + nu +
                                          ' (받을 리소스가 없다: ' + ri + ')');
                            nu_arr.splice(req_count, 1);
                            get_nu_arr(connection, nu_arr, req_count, callback, sub_ri);
                            return;
                        }

                        // 원래는 (poa != null || poa != '') 였다. 둘 중 하나는 항상
                        // 참이라 이 조건은 언제나 통과했고, poa 가 null 이면 아래
                        // JSON.parse(null) 이 null 을 돌려줘 .length 에서 워커가 죽었다.
                        var poa_arr = poa_util.parse(result_Obj[0].poa, '[sgn_action] ' + ri);
                        if (poa_arr === null || poa_arr.length === 0) {
                            console.error('[noti] fail - sub=' + (sub_ri || '?') + ' nu=' + nu +
                                          ' (받을 리소스에 poa 가 없다: ' + ri + ')');
                            nu_arr.splice(req_count, 1);
                            get_nu_arr(connection, nu_arr, req_count, callback, sub_ri);
                            return;
                        }

                        // 이 자리의 ID 형식 항목을 풀어낸 URL 들로 갈아 끼운다.
                        // 예전에는 pop() 이라 배열의 *마지막* 항목을 지웠다 —
                        // nu 가 2개 이상이면 엉뚱한 항목이 통째로 사라졌다.
                        var resolved = [];
                        for (var i = 0; i < poa_arr.length; i++) {
                            sub_nu = url.parse(poa_arr[i]);
                            if(sub_nu.protocol == null) {
                                resolved.push('http://localhost:7579' + absolute_url);
                            }
                            else {
                                if(poa_arr[i].charAt(poa_arr[i].length-1) == '/') {
                                    poa_arr[i] = poa_arr[i].slice(0, -1);
                                }
                                resolved.push(poa_arr[i]);
                            }
                        }
                        Array.prototype.splice.apply(nu_arr, [req_count, 1].concat(resolved));

                        // 갈아 끼운 만큼 건너뛴다. 새로 넣은 것들은 이미 URL 이다.
                        get_nu_arr(connection, nu_arr, req_count + resolved.length, function (code) {
                            callback(code);
                        }, sub_ri);
                    }
                    else {
                        console.error('[noti] fail - sub=' + (sub_ri || '?') + ' nu=' + nu +
                                      ' (받을 리소스 조회 중 DB 오류)');
                        nu_arr.splice(req_count, 1);
                        get_nu_arr(connection, nu_arr, req_count, callback, sub_ri);
                    }
                });
            }
        });
    }
    else {
        // 이미 URL 형식이라 풀 것이 없다. 예전에는 여기서 callback('200') 으로
        // 순회를 끝내버려, URL 이 하나라도 앞에 있으면 그 뒤의 ID 형식 nu 는
        // 영영 풀리지 않았다. nu 가 하나뿐이면 결과는 같다 — 다음이 없으니
        // 바로 위 종료 조건에 걸린다.
        get_nu_arr(connection, nu_arr, req_count + 1, function (code) {
            callback(code);
        }, sub_ri);
    }
}

function sgn_action(connection, rootnm, check_value, subl, req_count, noti_Obj, sub_bodytype, parentObj, callback) {
    if(subl.length <= req_count) {
        callback('200');
        return;
    }

    var results_ss = subl_entry.read(subl[req_count]);
    if (!results_ss) {
        var broken = subl[req_count];
        console.error('[sgn] subl 항목을 읽을 수 없어 건너뛴다 — 부모=' +
                      ((parentObj && parentObj.ri) || '?') + ' 항목 ' + req_count +
                      ' sub=' + ((broken && broken.ri) || '?'));
        sgn_action(connection, rootnm, check_value, subl, ++req_count, noti_Obj, sub_bodytype, parentObj, function (code) {
            callback(code);
        });
        return;
    }

    var notiObj = merge({}, noti_Obj);

    var nct = results_ss.nct;
    var net_arr = JSON.parse(JSON.stringify(results_ss.net));
    var nu_arr = JSON.parse(JSON.stringify(results_ss.nu));

    var xm2mri = require('shortid').generate();
    var short_flag = 0;

    var node = {};
    node['m2m:sgn'] = {};

    if(results_ss.ri.charAt(0) == '/') {
        node['m2m:sgn'].sur = results_ss.ri.replace('/', '');
    }
    else {
        node['m2m:sgn'].sur = results_ss.ri;
    }

    if (results_ss.nec) {
        node['m2m:sgn'].nec = results_ss.nec;
    }
    node['m2m:sgn'].nev = {};
    node['m2m:sgn'].nev.rep = {};

    if(rootnm == 'mgo') {
        node['m2m:sgn'].nev.rep['m2m:' + responder.mgoType[notiObj.mgd]] = JSON.parse(JSON.stringify(notiObj));
    }
    else if(rootnm == 'fcnt') {
        // cnd 가 없을 수 있다. 요청 URL 에 #attr 필터가 붙으면 remove_no_value 가
        // 지정한 속성만 남기고 나머지를 지운다(resource.js 의 hash 분기) — cnd 도
        // 같이 사라진다. 그 객체가 그대로 여기로 온다.
        //
        // 그러면 아래 .includes 가 undefined 위에서 돌아 워커가 죽었다. 이 코드는
        // db 커넥션을 빌린 채라 죽으면 커넥션도 함께 샜다. create·update 는
        // 예전부터 이 입력에 죽었고, DELETE 는 headers.rootnm 이 늘 'rsp' 로
        // 잡히는 바람에 이 분기에 오지 않아 우연히 가려져 있었다. 그 우회를
        // 걷어내면서(resource.js 의 set_rootnm) DELETE 도 같이 드러났다.
        //
        // 아래 == 비교들은 undefined 라도 그냥 false 라 안전하다. 던지는 것은
        // .includes 하나뿐이므로 그것만 막는다.
        if (typeof notiObj.cnd === 'string' && notiObj.cnd.includes('org.onem2m.home.device.')) {
            node['m2m:sgn'].nev.rep['m2m:' + rootnm] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.doorlock') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'dooLk')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.battery') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'bat')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.temperature') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'tempe')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.binarySwitch') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'binSh')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.faultDetection') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'fauDn')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.colourSaturation') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'colSn')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.colour') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'color')] = JSON.parse(JSON.stringify(notiObj));
        }
        else if (notiObj.cnd == 'org.onem2m.home.moduleclass.brightness') {
            node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('fcnt', 'brigs')] = JSON.parse(JSON.stringify(notiObj));
        }
        else {
            // 아는 cnd 가 아니거나 cnd 가 없다. 예전에는 여기서 아무것도 안 담아
            // nev.rep 가 {} 인 채로 알림이 나갔다 — 구독자는 무엇이 바뀌었는지
            // 알 수 없다. 표준 이름으로라도 실어 보낸다.
            node['m2m:sgn'].nev.rep['m2m:' + rootnm] = JSON.parse(JSON.stringify(notiObj));
        }
    }
    else if(rootnm.includes('hd_')) {
        node['m2m:sgn'].nev.rep['hd:' + rootnm.replace('hd_', '')] = JSON.parse(JSON.stringify(notiObj));
    }
    else {
        node['m2m:sgn'].nev.rep['m2m:' + rootnm] = JSON.parse(JSON.stringify(notiObj));
    }

    responder.typeCheckforJson(node['m2m:sgn'].nev.rep);

    notiObj = null;

    var matched = false;
    for (var j = 0; j < net_arr.length; j++) {
        if (net_arr[j] == check_value || check_value == 256 || check_value == 128) { // 1 : Update_of_Subscribed_Resource, 3 : Create_of_Direct_Child_Resource, 4 : Delete_of_Direct_Child_Resource
            matched = true;
            node['m2m:sgn'].nev.net = parseInt(net_arr[j].toString());

            get_nu_arr(connection, nu_arr, 0, function (code) {
                if(code == '200') {
                    if (nct == 2 || nct == 1) {
                        setTimeout(function (nu_arr, count, sub_bodytype, node, short_flag, check_value, cr, ri, xm2mri, exc, parentObj) {
                            sgn_action_send(nu_arr, count, sub_bodytype, node, short_flag, check_value, results_ss.cr, results_ss.ri, xm2mri, results_ss.exc, parentObj, function (code) {
                                console.log('[sgn_action_send] - ' + code);
                            });
                        }, parseInt(1 + Math.random() * 10), nu_arr, 0, sub_bodytype, node, short_flag, check_value, results_ss.cr, results_ss.ri, xm2mri, results_ss.exc, parentObj);

                        sgn_action(connection, rootnm, check_value, subl, ++req_count, noti_Obj, sub_bodytype, parentObj, function (code) {
                            callback(code);
                        });
                    }
                    else {
                        console.log('nct except 2 (All Attribute) do not support');
                        sgn_action(connection, rootnm, check_value, subl, ++req_count, noti_Obj, sub_bodytype, parentObj, function (code) {
                            callback(code);
                        });
                    }
                }
                else {
                    // get_nu_arr 은 지금 언제나 '200' 을 준다. 그래도 else 를
                    // 둔다 — 없으면 그 계약이 바뀌는 순간 콜백이 조용히
                    // 사라지고 알림 사슬이 거기서 멈춘다. 이 파일에서 이미
                    // 두 번 일어난 부류다(get_nu_arr 의 두 조기 반환).
                    console.error('[noti] sub=' + results_ss.ri +
                                  ' nu 해석이 200 이 아닌 코드를 줬다: ' + code);
                    sgn_action(connection, rootnm, check_value, subl, ++req_count, noti_Obj, sub_bodytype, parentObj, function (code) {
                        callback(code);
                    });
                }
            }, results_ss.ri);
            break;
        }
    }

    // net_arr에 check_value가 없는 경우에도 다음 subl로 진행
    if (!matched) {
        sgn_action(connection, rootnm, check_value, subl, ++req_count, noti_Obj, sub_bodytype, parentObj, function (code) {
            callback(code);
        });
    }
}

// 이 알림이 DB 를 만져야 하는가.
//
// get_nu_arr 은 nu 가 URL 이 아니라 ID 형식일 때만 조회한다
// (sub_nu.protocol == null). 대부분의 배포는 nu 에 URL 을 쓰므로 그런 경우
// 커넥션을 아예 빌리지 않는다 — 알림마다 풀에서 하나씩 더 빼면
// 워커당 100 인 한도가 금방 빡빡해진다.
function needs_connection(subl) {
    if (!Array.isArray(subl)) {
        return false;
    }
    for (var i = 0; i < subl.length; i++) {
        // sgn_action 과 같은 눈으로 읽어야 한다. 예전에는 여기서만
        // Array.isArray 로 걸러서, nu 가 문자열인 항목은 커넥션을 안 빌리고도
        // 발송 경로로 들어갔다 — ID 형식이면 get_ri_sri(null, ...) 에서 죽는다.
        var ss = subl_entry.read(subl[i]);
        if (!ss) { continue; }
        for (var j = 0; j < ss.nu.length; j++) {
            if (url.parse(String(ss.nu[j])).protocol == null) {
                return true;
            }
        }
    }
    return false;
}

exports.check = function(request, notiObj, check_value, callback) {
    var rootnm = request.headers.rootnm;

    if((request.method.toLowerCase() == "put" && check_value == 1)) {
        var pi = notiObj.ri;
    }
    else if ((request.method.toLowerCase() == "post" && check_value == 3) || (request.method.toLowerCase() == "delete" && check_value == 4)) {
        pi = notiObj.pi;
    }

    var ri = notiObj.ri;

    var noti_Str = JSON.stringify(notiObj);
    var noti_Obj = JSON.parse(noti_Str);

    // 대상 객체 전체를 깊은 복제한 뒤 그중 하나만 꺼내 쓰고 있었다.
    // 요청마다 도는 자리라 그만큼이 그대로 낭비다. sgn_action 이 parentObj 를
    // 읽기만 하므로 복제 없이 넘긴다.
    var target_root = Object.keys(request.targetObject)[0];
    var parentObj = request.targetObject[target_root];
    var subl = parentObj.subl;

    if(check_value != 256 && check_value != 128) {
        var noti_ri = noti_Obj.ri;
        noti_Obj.ri = noti_Obj.sri;
        delete noti_Obj.sri;
        noti_Obj.pi = noti_Obj.spi;
        delete noti_Obj.spi;
    }

    // 요청 커넥션을 쓰면 안 된다.
    //
    // 호출부 네 곳이 전부 빈 콜백으로 부르고 곧바로 응답을 내보낸다 —
    // 정산이 connection.release() 를 하고 나서도 여기 질의가 계속 돈다.
    // 반납된 커넥션은 풀로 돌아가 다른 요청에 넘어가므로, 알림 질의가
    // 남의 트랜잭션(checkAndPurge 의 SELECT ... FOR UPDATE) 안에서 실행될 수 있다.
    // 크래시가 아니라 조용한 뒤섞임이라 로그에 아무것도 남지 않는다.
    //
    // 실측으로 확인했다 — nu 를 ID 형식으로 둔 구독에 CIN 3건을 넣으니
    // 반납 후 질의가 6건 찍혔다(get_ri_sri, select_resource_from_url).
    run_with_own_connection(subl, function (connection, release) {
        sgn_action(connection, rootnm, check_value, subl, 0, noti_Obj, request.usebodytype, parentObj, function (code) {
            release();
            callback(code);
        });
    }, callback);
};

// DB 가 필요하면 자기 커넥션을 빌려 넘기고, 아니면 null 로 진행한다.
// release 는 몇 번 불려도 한 번만 반납한다.
function run_with_own_connection(subl, body, on_giveup) {
    // 예전에는 여기에 `global.usesqlite === 'true' ||` 가 붙어 있었다.
    // 커넥션 원천이 MySQL 풀로 고정이라 SQLite 모드가 그 풀을 안 건드리게
    // 하려던 우회였다. 원천이 파사드로 옮겨졌으니 필요 없다.
    // 남은 조건은 하나 — 이 알림에 DB 조회가 필요한가.
    if (!needs_connection(subl)) {
        body(null, function () {});
        return;
    }

    db.getConnection(function (code, connection) {
        if (code !== '200') {
            // 알림은 fire-and-forget 이다. 여기서 매달리거나 재시도하면
            // 풀이 고갈된 상황을 더 악화시킨다. 남기고 포기한다.
            console.error('[sgn] 커넥션을 못 빌려 알림의 ID 해석을 건너뛴다 (풀 고갈?)');
            on_giveup('200');
            return;
        }

        var released = false;
        body(connection, function () {
            if (released) { return; }
            released = true;
            // 핸들에 직접 부르지 않는다 — 그건 "MySQL 풀 커넥션" 이라는 가정이다.
            // 커넥션 원천이 파사드로 옮겨진 뒤로 여기에 다른 백엔드의 핸들이
            // 올 수 있다(SQLite 싱글턴에는 release 가 없다).
            db.release(connection);
        });
    });
}

