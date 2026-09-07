/** Allowed (fu, rcn) combinations per HTTP method. Comparison is loose (==) because query values are strings. Pure value-to-value; knows nothing about request objects. */
'use strict';

var GATE = {
    POST:   { fu: [2],    rcn: [0, 1, 2, 3],    reject: '400-43' },
    GET:    { fu: [1, 2], rcn: [1, 4, 5, 6, 7], reject: '400-44' },
    PUT:    { fu: [2],    rcn: [0, 1],          reject: '400-45' },
    DELETE: { fu: [2],    rcn: [0, 1],          reject: '400-46' }
};

function loose_in(list, v) {
    for (var i = 0; i < list.length; i++) {
        if (v == list[i]) { return true; }   // eslint-disable-line eqeqeq — loose on purpose
    }
    return false;
}

/**
 * @param method  'POST' | 'GET' | 'PUT' | 'DELETE'
 * @param query   request.query; fu and rcn are read
 * @returns {string|null}  the rejection reason code, or null when allowed
 */
exports.reject = function (method, query) {
    var g = GATE[method];
    if (!g) { throw new TypeError('route_gate: 모르는 메서드 ' + JSON.stringify(method)); }
    return (loose_in(g.fu, query.fu) && loose_in(g.rcn, query.rcn)) ? null : g.reject;
};

exports.GATE = GATE;
