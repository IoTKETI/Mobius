'use strict';
// Single source of truth for deciding a request's resource type (ty) from the body root name and the Content-Type ty parameter. Pure and synchronous; it only reads the type tables in responder.

var responder = require('./responder');

// Mobius-internal aliases that are not part of oneM2M: 91-98 (hd_*) are aliases of flexContainer (28). A request may send ty=28 with an hd:* body.
var ALIAS_OF = {
    '91': '28', '92': '28', '93': '28', '94': '28',
    '95': '28', '96': '28', '97': '28', '98': '28'
};

function canonical(ty) {
    return ALIAS_OF.hasOwnProperty(ty) ? ALIAS_OF[ty] : ty;
}

// 'm2m:cnt' -> 'cnt', 'hd:dooLk' -> 'hd_dooLk', bare 'cnt' -> 'cnt'.
exports.normalize_root_name = function (key) {
    if (typeof key !== 'string') {
        return '';
    }
    if (key.split(':')[0] === 'hd') {
        return key.replace('hd:', 'hd_');
    }
    return key.replace('m2m:', '');
};

/**
 * Resolves the resource type from the body root name and the Content-Type ty.
 * 
 * @param {string} root_key   raw top-level body key ('m2m:cnt', 'hd:dooLk', 'cnt' ...)
 * @param {string|null} header_ty  ty from Content-Type; null when absent
 * @returns {{rsc: string, ty: string|null, rootnm: string|null}}
 * 
 * ty is always a string. When header_ty is given and disagrees with the body, the result is 400-42; otherwise the body's type wins (with alias refinement, e.g. ty=28 + hd:dooLk -> '98'). When header_ty is null the body decides alone.
 */
exports.resolve = function (root_key, header_ty) {
    var rootnm = exports.normalize_root_name(root_key);

    var ty = null;
    for (var key in responder.typeRsrc) {
        if (responder.typeRsrc.hasOwnProperty(key)) {
            if (responder.typeRsrc[key] === rootnm) {
                ty = String(key);
                break;
            }
        }
    }

    if (ty === null) {
        // Concrete mgmtObj types (fwr/bat/dvi/dvc/rbo) are not in typeRsrc and are rejected here.
        return { rsc: '400-3', ty: null, rootnm: null };
    }

    if (header_ty != null && header_ty !== '' && canonical(header_ty) !== canonical(ty)) {
        return { rsc: '400-42', ty: null, rootnm: null };
    }

    return { rsc: '200', ty: ty, rootnm: rootnm };
};

exports._ALIAS_OF = ALIAS_OF;
exports._canonical = canonical;
