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

// sql_action is required for its side effect: loading it installs global.getType, which typeCheckAction below uses. The db_sql name itself is not referenced here.
var db_sql = require('./sql_action');


var _this = this;

var shape = require('./shape');

// The resource type tables live in shape.js and are re-exported here for callers that use responder.typeRsrc.
var typeRsrc = shape.typeRsrc;
var mgoType = shape.mgoType;

exports.typeRsrc = typeRsrc;
exports.mgoType = mgoType;

/** Sets the response headers. The response is always application/json regardless of Accept; Content-Type and X-M2M-RSC are always set, and X-M2M-RI, X-M2M-RVI and Locale are echoed from the request when present. */
function apply_headers(request, response, rsc) {
    var h = request.headers || {};

    if (h.hasOwnProperty('x-m2m-ri'))  { response.header('X-M2M-RI',  h['x-m2m-ri']); }
    if (h.hasOwnProperty('x-m2m-rvi')) { response.header('X-M2M-RVI', h['x-m2m-rvi']); }
    if (h.hasOwnProperty('locale'))    { response.header('Locale',    h['locale']); }

    response.header('Content-Type', 'application/json');
    response.header('X-M2M-RSC', rsc);
}

/** Reads a column that must be an array as an array. Never throws; an unreadable value becomes an empty array, matching makeObject in resource.js. */
function parse_db_array(raw, attr) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (raw == null || raw === '') {
        return [];
    }
    var parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        console.error('[typeCheckAction] ' + attr + ' 를 배열로 읽을 수 없다: ' + e.message);
        return [];
    }
    if (!Array.isArray(parsed)) {
        console.error('[typeCheckAction] ' + attr + ' 가 배열이 아니다');
        return parsed == null ? [] : [].concat(parsed);
    }
    return parsed;
}

function typeCheckAction(index1, body_Obj) {
    for (var index2 in body_Obj) {
        if(body_Obj.hasOwnProperty(index2)) {
            if (body_Obj[index2] == null || body_Obj[index2] == '' || body_Obj[index2] == 'undefined' || body_Obj[index2] == '[]' || body_Obj[index2] == '\"\"') {
                if(index2 == 'pi') {
                }
                else if(index2 == 'pv') {
                }
                else {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'et') {
                if (index1 == 'm2m:cb') {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'cr') {
                if (index1 == 'm2m:ae' || index1 == 'm2m:csr') {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'acp' || index2 == 'cst' || index2 == 'los' || index2 == 'mt' || index2 == 'csy' || index2 == 'nct' ||
                index2 == 'cs' || index2 == 'st' || index2 == 'ty' || index2 == 'cbs' || index2 == 'cni' || index2 == 'mni' ||
                index2 == 'cnm' || index2 == 'mia' || index2 == 'mbs' || index2 == 'mgd' || index2 == 'btl' || index2 == 'bts' ||
                index2 == 'mnm' || index2 == 'exc' || index2 == 'rs' || index2 == 'ors') {

                if ((index1 == 'm2m:cb' || index1 == 'm2m:cin' || index1 == 'm2m:nod' || index1 == 'm2m:ae' || index1 == 'm2m:sub' || index1 == 'm2m:acp' ||
                        index1 == 'm2m:csr' || index1 == 'm2m:grp' || index1 == 'm2m:fwr' || index1 == 'm2m:bat' || index1 == 'm2m:dvi' || index1 == 'm2m:dvc' ||
                        index1 == 'm2m:rbo' || index1 == 'm2m:smd') &&
                    index2 == 'mni') {
                    delete body_Obj[index2];
                }
                else if ((index1 == 'm2m:cb' || index1 == 'm2m:csr' || index1 == 'm2m:ae' || index1 == 'm2m:acp' || index1 == 'm2m:grp' || index1 == 'm2m:sub' ||
                        index1 == 'm2m:nod' || index1 == 'm2m:fwr' || index1 == 'm2m:bat' || index1 == 'm2m:dvi' || index1 == 'm2m:dvc' || index1 == 'm2m:rbo' ||
                        index1 == 'm2m:smd') &&
                    index2 == 'st') {
                    delete body_Obj[index2];
                }
                else if ((index1 == 'm2m:acp') && index2 == 'acpi') {
                    delete body_Obj[index2];
                }
                else {
                    body_Obj[index2] = parseInt(body_Obj[index2]);
                }
            }
            else if (index2 == 'lvl' || index2 == 'colSn' || index2 == 'red' || index2 == 'green' || index2 == 'blue' || index2 == 'brigs' ||
                index2 == 'lock' || index2 == 'powerSe' || index2 == 'sus' || index2 == 'curT0') {
                if(index1 == 'm2m:fcnt') {
                    delete body_Obj[index2];
                }
                else if(index1 == 'hd:dooLk') {
                    if(index2 == 'lock') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:bat') {
                    if(index2 == 'lvl') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:tempe') {
                    if(index2 == 'curT0') {
                        body_Obj[index2] = parseFloat(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:binSh') {
                    if(index2 == 'powerSe') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:fauDn') {
                    if(index2 == 'sus') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:colSn') {
                    if(index2 == 'colSn') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:color') {
                    if(index2 == 'red' || index2 == 'green' || index2 == 'blue') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:brigs') {
                    if(index2 == 'brigs') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
            }
            else if (index2 == 'srv' || index2 == 'aa' || index2 == 'at' || index2 == 'poa' || index2 == 'lbl' || index2 == 'acpi' || index2 == 'srt' || index2 == 'nu' || index2 == 'mid' || index2 == 'macp') {
                if (!Array.isArray(body_Obj[index2])) {
                    // Values arriving here already failed to parse once in makeObject (resource.js), which leaves the original string; parse_db_array never throws, so a broken row cannot kill the worker during serialisation.
                    body_Obj[index2] = parse_db_array(body_Obj[index2], index2);
                }

                if (index2 == 'srt') {
                    for (index3 in body_Obj[index2]) {
                        if (body_Obj[index2].hasOwnProperty(index3)) {
                            body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                        }
                    }
                }
                else if (index2 == 'mid') {
                    if(body_Obj[index2].length > 0) {
                        for(var idx in body_Obj[index2]) {
                            if(body_Obj[index2].hasOwnProperty(idx)) {
                                body_Obj[index2][idx] = body_Obj[index2][idx].replace(usespid + usecseid + '/', '/'); // absolute
                                body_Obj[index2][idx] = body_Obj[index2][idx].replace(usecseid + '/', '/'); // SP


                                if(body_Obj[index2][idx].charAt(0) == '/') {
                                    body_Obj[index2][idx] = body_Obj[index2][idx].replace('/', '');
                                }
                            }
                        }
                    }
                }
            }
            else if (index2 == 'enc') {
                if (Object.keys(body_Obj[index2])[0] != 'net') {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
                }

                for (var index3 in body_Obj[index2]) {
                    if (body_Obj[index2].hasOwnProperty(index3)) {
                        if(index3 == 'net') {
                            for (var index4 in body_Obj[index2][index3]) {
                                if (body_Obj[index2][index3].hasOwnProperty(index4)) {
                                    body_Obj[index2][index3][index4] = parseInt(body_Obj[index2][index3][index4]);
                                }
                            }
                        }
                    }
                }
            }
            else if (index2 == 'bn') {
                if(Object.keys(body_Obj[index2]).length == 0) {
                    delete body_Obj[index2];
                }
                else {
                    for (var index3 in body_Obj[index2]) {
                        if (body_Obj[index2].hasOwnProperty(index3)) {
                            if(index3 == 'num') {
                                body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                            }
                        }
                    }
                }
            }
            else if (index2 == 'cas' || index2 == 'uds') {
                for (var index3 in body_Obj[index2]) {
                    if (body_Obj[index2].hasOwnProperty(index3)) {
                        if(index3 == 'sus') {
                            body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                        }
                    }
                }
            }
            else if (index2 == 'rr' || index2 == 'mtv' || index2 == 'ud' || index2 == 'att' || index2 == 'cus' || index2 == 'ena' || index2 == 'dis' || index2 == 'rbo' ||
                index2 == 'far' || index2 == 'disr') {
                body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
            }
            else if (index2 == 'sri') {
                body_Obj.ri = body_Obj[index2];
                delete body_Obj[index2];
            }
            else if (index2 == 'spi') {
                body_Obj.pi = body_Obj[index2];
                delete body_Obj[index2];
            }
            else if (index2 == 'pv' || index2 == 'pvs') {
                // getType returns 'string_object' for a string that parses as an object and 'string' when parsing fails. makeObject already parsed pv/pvs, so a value still stored as a string could not be parsed; it is left as is and logged rather than replaced with an empty object.
                if (getType(body_Obj[index2]) === 'string_object') {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
                }
                else if (typeof body_Obj[index2] === 'string') {
                    console.error('[typeCheckAction] ' + index2 + ' 를 읽을 수 없어 원본 그대로 내보낸다');
                }
            }
        }
    }
}

// typeCheckAction above and typeCheckforJson below are the JSON normalisation path: sri->ri substitution, pv/pvs handling and array column recovery.

exports.typeCheckforJson = function(body_Obj) {
    for (var index1 in body_Obj) {
        if(body_Obj.hasOwnProperty(index1)) {
            typeCheckAction(index1, body_Obj[index1]);
        }
    }
};

function typeCheckforJson2(body_Obj) {
    for (var index1 in body_Obj) {
        if(body_Obj.hasOwnProperty(index1)) {
            for (var index2 in body_Obj[index1]) {
                if (body_Obj[index1].hasOwnProperty(index2)) {
                    typeCheckAction(index1, body_Obj[index1][index2]);
                }
            }
        }
    }
}

var operation = {
    'post': 1,
    'get': 2,
    'put': 3,
    'delete': 4
};

/**
 * Result object -> response body. The producer gives out = { shape, rootnm, body }.
 *
 * This layer decides which normalisation each shape gets; shape.js takes the function as an argument because the depth differs per shape (uril gets none). An unknown shape throws a TypeError, which settle.done turns into a 500.
 *
 * With rcn=0 shape.single returns null and the outlet sends an empty body.
 */
// Exported so tests can build the expected grouped body from shape.grouped and this function independently of body_of.
exports.typeCheckforJson2 = typeCheckforJson2;

exports.body_of = function (out, rcn) {
    switch (out.shape) {
        case 'single':  return shape.single(out.body, rcn, _this.typeCheckforJson);
        case 'rce':     return shape.rce(out.body, out.rootnm, _this.typeCheckforJson);
        case 'uril':    return shape.uril(out.body, out.rootnm);
        case 'grouped': return shape.grouped(out.body, out.rootnm, typeCheckforJson2);
    }
    throw new TypeError('body_of: unknown shape ' + JSON.stringify(out.shape));
};

// Outlet.
//
// send() below is the only place in this file that writes response bytes. respond() takes named fields, and send() validates rsc and status: an invalid spec is answered with 500 instead of throwing, because throwing mid-response would skip the connection release.

/**
 * Transmit. The only call to response.status().end() in this file.
 *
 * @param status   HTTP status; a string such as '200' is accepted (parseInt)
 * @param rsc      four-digit string for X-M2M-RSC
 * @param body     object to serialise as JSON; null sends an empty body
 * @param headers  extra headers set after apply_headers (or null)
 * @param done     called after transmission; settle releases the connection there
 */
function send(request, response, status, rsc, body, headers, done) {
    var st = parseInt(status, 10);

    if (!/^\d{4}$/.test(String(rsc)) || !(st >= 100 && st <= 599)) {
        console.error('[respond] 잘못된 응답 명세: status=' + status + ' rsc=' + rsc +
                      ' (' + request.method + ' ' + request.url + ')');
        st = 500;
        rsc = '5000';
        body = { 'm2m:dbg': 'internal error' };
        headers = null;
    }

    apply_headers(request, response, rsc);
    if (headers) {
        Object.keys(headers).forEach(function (k) { response.header(k, headers[k]); });
    }
    response.status(st).end(body == null ? '' : JSON.stringify(body));
    done();
}

/**
 * Public outlet.
 *
 *   respond(request, response, { code, dbg, detail }, done)          error
 *   respond(request, response, { status, rsc, body, headers }, done) success
 *
 * code is an rsc.js catalogue object (the code field of reason.js); it decides status, rsc and body. detail is logged with console.error and not sent.
 */
exports.respond = function (request, response, spec, done) {
    if (spec.code) {
        var code = spec.code;
        if (spec.detail) {
            console.error('[' + (code && code.name ? code.name : '?') + '] ' + spec.detail);
        }
        // Kept from the old error path: rt is forced to 3; it does not appear in the response.
        request.query.rt = 3;
        send(request, response, code.http, code.rsc, { 'm2m:dbg': spec.dbg }, null, done);
        return;
    }
    send(request, response, spec.status, spec.rsc, spec.body, spec.headers, done);
};
