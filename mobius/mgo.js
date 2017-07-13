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
 * @file
 * @copyright KETI Korea 2017, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var responder = require('./responder');


exports.build_mgo = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // check NP
    if(body_Obj[rootnm].ty) {
        body_Obj = {};
        body_Obj['dbg'] = 'ty as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ri) {
        body_Obj = {};
        body_Obj['dbg'] = 'ri as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].pi) {
        body_Obj = {};
        body_Obj['dbg'] = 'pi as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ct) {
        body_Obj = {};
        body_Obj['dbg'] = 'ct as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].lt) {
        body_Obj = {};
        body_Obj['dbg'] = 'lt as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].st) {
        body_Obj = {};
        body_Obj['dbg'] = 'st as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    // check M
    if (body_Obj[rootnm].mgd == null || body_Obj[rootnm].mgd == '') {
        body_Obj = {};
        body_Obj['dbg'] = 'mgd(mgmtDefinition) of mgmtObj resource is M Tag. it should be included in';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(rootnm == 'fwr' && body_Obj[rootnm].mgd == '1001') {
        if(body_Obj[rootnm].uds) {
            body_Obj = {};
            body_Obj['dbg'] = 'uds as NP Tag should not be included';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].vr == null || body_Obj[rootnm].vr == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'vr(version) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].fwnnam == null || body_Obj[rootnm].fwnnam == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'fwnnam(firmwareName) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].url == null || body_Obj[rootnm].url == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'url(URL) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].ud == null || body_Obj[rootnm].ud == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'ud(update) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else if(rootnm == 'bat' && body_Obj[rootnm].mgd == '1006') {
        if (body_Obj[rootnm].btl == null || body_Obj[rootnm].btl == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'btl(batteryLevel) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].bts == null || body_Obj[rootnm].bts == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'bts(batteryStatus) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else if(rootnm == 'dvi' && body_Obj[rootnm].mgd == '1007') {
        if (body_Obj[rootnm].dbl == null || body_Obj[rootnm].dbl == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'dbl(deviceLabel) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].man == null || body_Obj[rootnm].man == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'man(manufacturer) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].mod == null || body_Obj[rootnm].mod == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'mod(model) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].dty == null || body_Obj[rootnm].dty == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'dty(deviceType) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].fwv == null || body_Obj[rootnm].fwv == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'fwv(fwVersion) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].swv == null || body_Obj[rootnm].swv == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'swv(swVersion) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].hwv == null || body_Obj[rootnm].hwv == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'hwv(hwVersion) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else if(rootnm == 'dvc' && body_Obj[rootnm].mgd == '1008') {
        if (body_Obj[rootnm].can == null || body_Obj[rootnm].can == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'can(capabilityName) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].att == null || body_Obj[rootnm].att == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'att(attached) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].cas == null || body_Obj[rootnm].cas == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'cas(capabilityActionStatus) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }

        if (body_Obj[rootnm].cus == null || body_Obj[rootnm].cus == '') {
            body_Obj = {};
            body_Obj['dbg'] = 'cus(currentState) of mgmtObj resource is M Tag. it should be included in';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }
    else if(rootnm == 'rbo' && body_Obj[rootnm].mgd == '1009') {
    }
    else {
        body_Obj = {};
        body_Obj['dbg'] = 'mgmtDefinition is not match with mgmtObj resource';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    // body
    // - common and universal attributes
    make_sp_relative((body_Obj[rootnm].acpi) ? body_Obj[rootnm].acpi : []);
    resource_Obj[rootnm].acpi = (body_Obj[rootnm].acpi) ? body_Obj[rootnm].acpi : [];
    resource_Obj[rootnm].et = (body_Obj[rootnm].et) ? body_Obj[rootnm].et : resource_Obj[rootnm].et;
    resource_Obj[rootnm].lbl = (body_Obj[rootnm].lbl) ? body_Obj[rootnm].lbl : [];
    resource_Obj[rootnm].at = (body_Obj[rootnm].at) ? body_Obj[rootnm].at : [];
    resource_Obj[rootnm].aa = (body_Obj[rootnm].aa) ? body_Obj[rootnm].aa : [];

    // - specific attributes
    resource_Obj[rootnm].mgd = body_Obj[rootnm].mgd;
    resource_Obj[rootnm].objs = (body_Obj[rootnm].objs) ? body_Obj[rootnm].objs : '';
    resource_Obj[rootnm].obps = (body_Obj[rootnm].obps) ? body_Obj[rootnm].obps : '';
    resource_Obj[rootnm].dc = (body_Obj[rootnm].dc) ? body_Obj[rootnm].dc : '';

    if(rootnm == 'fwr' && body_Obj[rootnm].mgd == '1001') {
        resource_Obj[rootnm].vr = body_Obj[rootnm].vr;
        resource_Obj[rootnm].fwnnam = body_Obj[rootnm].fwnnam;
        resource_Obj[rootnm].url = body_Obj[rootnm].url;
        resource_Obj[rootnm].ud = body_Obj[rootnm].ud;
        resource_Obj[rootnm].uds = '';
    }
    else if(rootnm == 'bat' && body_Obj[rootnm].mgd == '1006') {
        resource_Obj[rootnm].btl = body_Obj[rootnm].btl;
        resource_Obj[rootnm].bts = body_Obj[rootnm].bts;
    }
    else if(rootnm == 'dvi' && body_Obj[rootnm].mgd == '1007') {
        resource_Obj[rootnm].dbl = body_Obj[rootnm].dbl;
        resource_Obj[rootnm].man = body_Obj[rootnm].man;
        resource_Obj[rootnm].mod = body_Obj[rootnm].mod;
        resource_Obj[rootnm].dty = body_Obj[rootnm].dty;
        resource_Obj[rootnm].fwv = body_Obj[rootnm].fwv;
        resource_Obj[rootnm].swv = body_Obj[rootnm].swv;
        resource_Obj[rootnm].hwv = body_Obj[rootnm].hwv;
    }
    else if(rootnm == 'dvc' && body_Obj[rootnm].mgd == '1008') {
        resource_Obj[rootnm].can = body_Obj[rootnm].can;
        resource_Obj[rootnm].att = body_Obj[rootnm].att;
        resource_Obj[rootnm].cas = body_Obj[rootnm].cas;
        resource_Obj[rootnm].cus = body_Obj[rootnm].cus;
        resource_Obj[rootnm].ena = (body_Obj[rootnm].ena) ? body_Obj[rootnm].ena : 'true';
        resource_Obj[rootnm].dis = (body_Obj[rootnm].dis) ? body_Obj[rootnm].dis : 'true';
    }
    else if(rootnm == 'rbo' && body_Obj[rootnm].mgd == '1009') {
        resource_Obj[rootnm].rbo = (body_Obj[rootnm].rbo) ? body_Obj[rootnm].rbo : 'true';
        resource_Obj[rootnm].far = (body_Obj[rootnm].far) ? body_Obj[rootnm].far : 'true';
    }

    if (resource_Obj[rootnm].et != '') {
        if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            body_Obj = {};
            body_Obj['dbg'] = 'expiration time is before now';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }

    callback('1', resource_Obj);
};



exports.modify_mgo = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // check NP
    if(body_Obj[rootnm].rn) {
        body_Obj = {};
        body_Obj['dbg'] = 'rn as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ty) {
        body_Obj = {};
        body_Obj['dbg'] = 'ty as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ri) {
        body_Obj = {};
        body_Obj['dbg'] = 'ri as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].pi) {
        body_Obj = {};
        body_Obj['dbg'] = 'pi as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ct) {
        body_Obj = {};
        body_Obj['dbg'] = 'ct as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].lt) {
        body_Obj = {};
        body_Obj['dbg'] = 'lt as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].st) {
        body_Obj = {};
        body_Obj['dbg'] = 'st as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].mgd) {
        body_Obj = {};
        body_Obj['dbg'] = 'mgd as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].objs) {
        body_Obj = {};
        body_Obj['dbg'] = 'objs as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].obps) {
        body_Obj = {};
        body_Obj['dbg'] = 'obps as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
        callback('0', resource_Obj);
        return '0';
    }

    // check M

    // body

    update_body(rootnm, body_Obj, resource_Obj);

    resource_Obj[rootnm].st = (parseInt(resource_Obj[rootnm].st, 10) + 1).toString();

    var cur_d = new Date();
    resource_Obj[rootnm].lt = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');

    if (resource_Obj[rootnm].et != '') {
        if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            body_Obj = {};
            body_Obj['dbg'] = 'expiration time is before now';
            responder.response_result(request, response, 400, body_Obj, 4000, request.url, body_Obj['dbg']);
            callback('0', resource_Obj);
            return '0';
        }
    }

    callback('1', resource_Obj);
};

