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
 * @file Builds response bodies: what to send.
 *
 * Everything here is value to value: no request or response objects, no headers or status codes, no callbacks. This module holds the root-key prefix rule, the resource type tables and the four body shapes (single, rce, uril, grouped).
 *
 * The normalisation function is passed in by the caller because each shape applies it at a different depth:
 *
 *   single    normalize(body)              body = {'m2m:cnt': attrs}   one level
 *   rce       normalize(body['m2m:rce'])   one level in
 *   grouped   normalize(group)             two levels (typeCheckforJson2)
 *   uril      none
 *
 * The type tables typeRsrc and mgoType live here and are re-exported by responder.js.
 */

'use strict';

var typeRsrc = {
    "1": "acp",
    "2": "ae",
    "3": "cnt",
    "4": "cin",
    "5": "cb",
    "9": "grp",
    "10": "lcp",
    "13": "mgo",
    "14": "nod",
    "16": "csr",
    "23": "sub",
    "24": "smd",
    "27": "mms",
    "28": "fcnt",
    "91": "hd_brigs",
    "92": "hd_color",
    "93": "hd_colSn",
    "94": "hd_fauDn",
    "95": "hd_binSh",
    "96": "hd_tempe",
    "97": "hd_bat",
    "98": "hd_dooLk",
    "99": "rsp"
};

var mgoType = {
    "1001": "fwr",
    "1006": "bat",
    "1007": "dvi",
    "1008": "dvc",
    "1009": "rbo"
};

exports.typeRsrc = typeRsrc;
exports.mgoType = mgoType;

/** fcnt moduleclass -> the short name used in response keys. hasOwnProperty guards against prototype keys such as 'toString'. */
var MODULE_CLASS = {
    'org.onem2m.home.moduleclass.doorlock':         'dooLk',
    'org.onem2m.home.moduleclass.battery':          'bat',
    'org.onem2m.home.moduleclass.temperature':      'tempe',
    'org.onem2m.home.moduleclass.binarySwitch':     'binSh',
    'org.onem2m.home.moduleclass.faultDetection':   'fauDn',
    'org.onem2m.home.moduleclass.colourSaturation': 'colSn',
    'org.onem2m.home.moduleclass.colour':           'color',
    'org.onem2m.home.moduleclass.brightness':       'brigs'
};

exports.MODULE_CLASS = MODULE_CLASS;

/** Returns the short name ('bat') when cnd is a known moduleclass, else null. cnd undefined gives null. */
exports.cnd_short = function (cnd) {
    return Object.prototype.hasOwnProperty.call(MODULE_CLASS, cnd) ? MODULE_CLASS[cnd] : null;
};

/** Whether the (rootnm, cnd) pair is a known moduleclass: rootnm must be 'hd_' + the short name of cnd. Returns the short name or null. CREATE checks the pair (fcnt.js build, resource.js insert dispatch); UPDATE checks cnd only (cnd_short). */
exports.hd_short = function (rootnm, cnd) {
    var s = exports.cnd_short(cnd);
    return (s !== null && rootnm == 'hd_' + s) ? s : null;
};

/**
 * Prefixes the root name. Single source of truth for the prefix rule.
 *
 *   mgo            'm2m:' + mgoType[obj.mgd]
 *   fcnt           cnd containing 'org.onem2m.home.device.' -> 'm2m:fcnt'; a known moduleclass -> 'hd:<short>'; otherwise 'm2m:fcnt'
 *   contains 'hd_' 'hd:' + rootnm with the first 'hd_' removed
 *   otherwise      'm2m:' + rootnm
 *
 * Edge behaviour kept as is: an unknown mgd yields 'm2m:undefined'; the 'hd_' test is includes, not startsWith; only the fcnt branch reads cnd, guarded by typeof; an undefined rootnm throws at .includes.
 *
 * @param {string} rootnm  the body's root key ('cnt' 'fcnt' 'mgo' 'hd_bat' ...)
 * @param {object} obj     the resource under that key; only mgd / cnd are read
 * @returns {string}       the prefixed key ('m2m:cnt' 'hd:bat' ...)
 */
exports.root_key = function (rootnm, obj) {
    if (rootnm == 'mgo') {
        return 'm2m:' + mgoType[obj.mgd];
    }

    if (rootnm == 'fcnt') {
        // device.* is a device, not a moduleclass, and keeps the standard name. This is the only substring test and the only branch that can throw.
        if (typeof obj.cnd === 'string' && obj.cnd.includes('org.onem2m.home.device.')) {
            return 'm2m:' + rootnm;
        }
        if (Object.prototype.hasOwnProperty.call(MODULE_CLASS, obj.cnd)) {
            return 'hd:' + rootnm.replace('fcnt', MODULE_CLASS[obj.cnd]);
        }
        // Unknown or missing cnd: a bare 'fcnt' is not a standard body, so it falls back to 'm2m:fcnt'.
        return 'm2m:' + rootnm;
    }

    if (rootnm.includes('hd_')) {
        return 'hd:' + rootnm.replace('hd_', '');
    }

    return 'm2m:' + rootnm;
};

/**
 * Builds the body of an ordinary CRUD response.
 *
 * @param {object}   resourceObj  body with a single root key ({cnt: {...}}). Modified in place.
 * @param {*}        rcn          request.query.rcn as received; compared with ==, so '0' and '' count as 0
 * @param {function} normalize    normalisation applied to the prefixed body, one level (responder.typeCheckforJson)
 * @returns {object|null}         the body object; null when rcn means 'no body'
 */
exports.single = function (resourceObj, rcn, normalize) {
    if (typeof normalize !== 'function') {
        throw new TypeError('shape.single: normalize 함수가 필요하다');
    }

    // rcn == 0 means no body. The 'dbg' exception is kept for compatibility although no caller produces a 'dbg' root key.
    if (rcn == 0 && Object.keys(resourceObj)[0] != 'dbg') {
        return null;
    }

    var rootnm = Object.keys(resourceObj)[0];
    var key = exports.root_key(rootnm, resourceObj[rootnm]);

    // Insert the new key first, then delete the old one: reversing the order changes the key order of the serialised body.
    resourceObj[key] = resourceObj[rootnm];
    delete resourceObj[rootnm];

    // Normalise after prefixing: typeCheckAction branches on the prefixed key ('m2m:cb' et, 'm2m:ae'/'m2m:csr' cr, 'hd:bat' lvl). One level only; bodies here are {key: resource}.
    normalize(resourceObj);

    return resourceObj;
};

/**
 * rcn=3 (CREATE success) body: {"m2m:rce": {uri, "m2m:<rootnm>": {...}}}
 *
 * The prefix rule is not applied here: the inner key is always 'm2m:' + rootnm, so a CREATE response can carry a key such as 'm2m:hd_bat' that a RETRIEVE would render as 'hd:bat'.
 *
 * @param {object}   resourceObj  {rce: {uri, <rootnm>: {...attrs}}}. Modified in place: rce is moved to m2m:rce and the original keys deleted
 * @param {string}   rootnm       resource name; coerced to a string (undefined gives an 'm2m:undefined' key)
 * @param {function} normalize    normalisation applied one level inside m2m:rce (responder.typeCheckforJson)
 * @returns {object}              the modified resourceObj
 * @throws {TypeError}            when resourceObj.rce is missing
 */
exports.rce = function rce_type_checked_one_level_in(resourceObj, rootnm, normalize) {
    if (typeof normalize !== 'function') {
        throw new TypeError('shape.rce: normalize 함수가 필요하다');
    }

    // Object keys are always strings; an undefined rootnm looks up the string key 'undefined'.
    var src_key = String(rootnm);
    var rce = resourceObj['rce'];

    // Insert, then delete. Assigning to an existing key keeps its position, so the key order of the body is preserved. This is the line that throws when rce is missing.
    rce['m2m:' + rootnm] = rce[src_key];
    delete rce[src_key];

    resourceObj['m2m:rce'] = rce;
    delete resourceObj[src_key];
    delete resourceObj['rce'];

    // Normalise one level in only. Applied to resourceObj, typeCheckAction would treat 'm2m:rce' as a resource and none of the attribute conversions would run.
    normalize(rce);

    return resourceObj;
};

/**
 * fu=1 discovery body: {"m2m:uril": ["Mobius2/a", ...]}
 *
 * No normalisation: the elements are URI strings. Running typeCheckAction on them would delete elements such as '' or '[]' and leave holes in the array.
 *
 * @param {object} resourceObj  {uril: [ ...URI strings... ]}. Modified in place
 * @param {string} rootnm       already known to be 'uril' by the caller
 * @returns {object}            the modified resourceObj
 */
exports.uril = function uril_no_type_check(resourceObj, rootnm) {
    var src_key = String(rootnm);

    // Same rule as rce: insert, then delete.
    resourceObj['m2m:' + rootnm] = resourceObj[src_key];
    delete resourceObj[src_key];

    return resourceObj;
};

/**
 * Groups discovery (rcn=4/5/6) and fanOutPoint results by ty.
 *
 *     grouped({ '/a': {ty:'3'...}, '/b': {ty:'4'...} }, 'rsp', normalize)
 *       -> { 'm2m:rsp': { 'm2m:cnt': [ {...} ], 'm2m:cin': [ {...} ] } }
 *
 * The outer key m2m:<rootnm> comes from the caller ('rsp' for discovery, 'agr' for fan-out); the inner keys come from each element's ty. Fan-out elements have no ty and fall into typeRsrc['99'] = 'rsp'.
 *
 * @param {object}   resourceObj  element map keyed by ri (discovery) or member address (fan-out). Modified in place: the elements are removed and replaced by one m2m:<rootnm> key
 * @param {string}   rootnm       name for the outer key; undefined gives 'm2m:undefined'
 * @param {function} normalize    normalisation applied to one group (responder.typeCheckforJson2)
 * @returns {object}              the modified resourceObj
 */
exports.grouped = function (resourceObj, rootnm, normalize) {
    // Normalisation is mandatory; without it integer columns would go out as strings.
    if (typeof normalize !== 'function') {
        throw new TypeError('shape.grouped: normalize 함수가 필요하다');
    }

    var res_Obj = {};

    for (var prop in resourceObj) {
        if (!resourceObj.hasOwnProperty(prop)) {
            continue;
        }

        var member = resourceObj[prop];

        // == null catches undefined and null; 0 and '' do not match and produce an 'm2m:undefined' group. Fan-out elements ({fr, rsc, rqi, rvi, pc}) always take this branch.
        var ty = (member.ty == null) ? '99' : member.ty;

        // mgo (13) splits once more by mgd (fwr/bat/dvi/dvc/rbo); an unknown mgd goes to 'm2m:undefined'.
        var key = (typeRsrc[ty] === 'mgo')
            ? 'm2m:' + mgoType[member.mgd]
            : 'm2m:' + typeRsrc[ty];

        if (res_Obj[key] == null) {
            res_Obj[key] = [];
        }
        res_Obj[key].push(member);

        // push stored a reference, so deleting here keeps the element alive inside the group. Deleting the current key during for-in is safe.
        delete resourceObj[prop];
    }

    resourceObj['m2m:' + rootnm] = res_Obj;

    normalize(res_Obj);

    return resourceObj;
};
