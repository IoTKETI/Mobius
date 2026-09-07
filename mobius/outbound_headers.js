'use strict';
// Builds the header set for requests the server sends to other hosts. The client's headers are copied and Accept is forced to application/json, since this CSE only handles JSON.

var JSON_ACCEPT = 'application/json';

/**
 * Returns the headers for an outbound request.
 * 
 *   headers: outbound_headers(request.headers)
 * 
 * Only Accept is replaced; every other header is copied as is. The input object is not modified.
 */
module.exports = function outbound_headers(headers) {
    var h = {};
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });

    // Accept may arrive in any letter case; drop every variant before setting one.
    Object.keys(h).forEach(function (k) {
        if (k.toLowerCase() === 'accept') { delete h[k]; }
    });

    h['Accept'] = JSON_ACCEPT;
    return h;
};
