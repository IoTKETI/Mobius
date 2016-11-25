/**
 * Copyright (c) 2015, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2015, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var moment = require('moment');
var util = require('util');
var merge = require('merge');

var responder = require('./responder');

exports.build_ae = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    if(body_Obj[rootnm].ty) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'ty as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ri) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'ri as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].pi) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'pi as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ct) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'ct as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].lt) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'lt as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].st) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'st as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].aei) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'aei as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].nl) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'nl as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    // check M
    if(!body_Obj[rootnm].api) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'api as M Tag should be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(!body_Obj[rootnm].rr) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'rr as M Tag should be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    // body
    resource_Obj[rootnm].api = body_Obj[rootnm].api;

    resource_Obj[rootnm].acpi = (body_Obj[rootnm].acpi) ? body_Obj[rootnm].acpi : [];
    resource_Obj[rootnm].et = (body_Obj[rootnm].et) ? body_Obj[rootnm].et : resource_Obj[rootnm].et;
    resource_Obj[rootnm].lbl = (body_Obj[rootnm].lbl) ? body_Obj[rootnm].lbl : [];
    resource_Obj[rootnm].at = (body_Obj[rootnm].at) ? body_Obj[rootnm].at : [];
    resource_Obj[rootnm].aa = (body_Obj[rootnm].aa) ? body_Obj[rootnm].aa : [];

    resource_Obj[rootnm].apn = (body_Obj[rootnm].apn) ? body_Obj[rootnm].apn : '';
    resource_Obj[rootnm].poa = (body_Obj[rootnm].poa) ? body_Obj[rootnm].poa : [];
    resource_Obj[rootnm].or = (body_Obj[rootnm].or) ? body_Obj[rootnm].or : '';
    resource_Obj[rootnm].rr = (body_Obj[rootnm].rr) ? body_Obj[rootnm].rr : 'true';

    //var cur_d = new Date();
    //var msec = (parseInt(cur_d.getMilliseconds(), 10)<10) ? ('00'+cur_d.getMilliseconds()) : ((parseInt(cur_d.getMilliseconds(), 10)<100) ? ('0'+cur_d.getMilliseconds()) : cur_d.getMilliseconds());
    //resource_Obj[rootnm].aei = 'S' + '0.2.481.1.' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec;

    if( (request.headers['x-m2m-origin'] == 'S') ) {
        resource_Obj[rootnm].aei = 'S' + moment().utc().format('YYYYMMDDHHmmssSSS') + randomValueBase64(4);
    }
    else if( (request.headers['x-m2m-origin'] == 'C') ) {
        resource_Obj[rootnm].aei = 'C' + moment().utc().format('YYYYMMDDHHmmssSSS') + randomValueBase64(4);
    }
    else {
        resource_Obj[rootnm].aei = request.headers['x-m2m-origin'];
    }

    resource_Obj[rootnm].nl = '';

    if (resource_Obj[rootnm].et != '') {
        if (resource_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            body_Obj = {};
            body_Obj['rsp'] = {};
            body_Obj['rsp'].cap = 'expiration is before now';
            responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
            callback('0', resource_Obj);
            return '0';
        }
    }

    callback('1', resource_Obj);
};



exports.update_ae = function(request, response, resource_Obj, body_Obj, callback) {
    var rootnm = request.headers.rootnm;

    // check NP
    if(body_Obj[rootnm].rn) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'rn as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ty) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'ty as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ri) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'ri as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].pi) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'pi as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].ct) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'ct as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].lt) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'lt as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].st) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'st as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].aei) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'aei as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].nl) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'nl as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    if(body_Obj[rootnm].api) {
        body_Obj = {};
        body_Obj['rsp'] = {};
        body_Obj['rsp'].cap = 'api as NP Tag should not be included';
        responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
        callback('0', resource_Obj);
        return '0';
    }

    // check M

    // body
    if(body_Obj[rootnm].acpi) {
        resource_Obj[rootnm].acpi = body_Obj[rootnm].acpi;
    }

    if(body_Obj[rootnm].et) {
        resource_Obj[rootnm].et = body_Obj[rootnm].et;
    }

    if(body_Obj[rootnm].lbl) {
        resource_Obj[rootnm].lbl = body_Obj[rootnm].lbl;
    }

    resource_Obj[rootnm].st = (parseInt(resource_Obj[rootnm].st, 10) + 1).toString();
    
    if(body_Obj[rootnm].at) {
        resource_Obj[rootnm].at = body_Obj[rootnm].at;
    }

    if(body_Obj[rootnm].aa) {
        resource_Obj[rootnm].aa = body_Obj[rootnm].aa;
    }

    if(body_Obj[rootnm].apn) {
        resource_Obj[rootnm].apn = body_Obj[rootnm].apn;
    }

    if(body_Obj[rootnm].poa) {
        resource_Obj[rootnm].poa = body_Obj[rootnm].poa;
    }

    if(body_Obj[rootnm].or) {
        resource_Obj[rootnm].or = body_Obj[rootnm].or;
    }

    if(body_Obj[rootnm].rr) {
        resource_Obj[rootnm].rr = body_Obj[rootnm].rr;
    }
    
    var cur_d = new Date();
    resource_Obj[rootnm].lt = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');

    if(body_Obj[rootnm].et == '') {
        if (body_Obj[rootnm].et < resource_Obj[rootnm].ct) {
            body_Obj = {};
            body_Obj['rsp'] = {};
            body_Obj['rsp'].cap = 'expiration time is before now';
            responder.response_result(request, response, 400, body_Obj, 4000, url.parse(request.url).pathname.toLowerCase(), body_Obj['rsp'].cap);
            callback('0', resource_Obj);
            return '0';
        }
    }

    callback('1', resource_Obj);
};

