/** Settles one request: sends the response and releases the DB connection, exactly once. A second settlement attempt is logged with its call site and ignored. */

var responder = require('./responder');
var RSC = require('./rsc').RSC;


/**
 * @param request
 * @param response
 * @param connection  connection from db.getConnection, or null when none was acquired (then only the response is sent)
 * @param on_error    function that sends an error response for a reason code (app.js response_error_result)
 */
exports.make = function (request, response, connection, on_error, release) {
    var settled = false;

    // The release function is injected so this module does not depend on the DB facade. The default duck-types the handle.
    release = release || function (c) {
        if (c && typeof c.release === 'function') { c.release(); }
    };

    function claim(what) {
        if (settled) {
            // Keep a few stack frames so the second call site can be found.
            var where = (new Error().stack || '').split('\n').slice(2, 5).join('\n');
            console.error('[settle] 이미 정산된 요청을 또 정산하려 했다 (' + what + ')\n' + where);
            return false;
        }
        settled = true;
        return true;
    }

    function finish() {
        if (connection) { release(connection); }
    }

    var api = {
        /**
         * Settles with an operation result; the single entry point for routes.
         *
         *   done(code)        failure: error response for the reason code (same as error)
         *   done(null, out)   success. out = { rsc, shape, rootnm, body }
         *                     rsc is an rsc.js catalogue name ('CREATED'), shape one of the four shape.js shapes; the body comes as an argument.
         *
         * A malformed out (unknown rsc or shape, body assembly throwing) is answered with 500 instead of throwing, so the connection is still released.
         */
        done: function (code, out) {
            if (out) {
                if (!claim('done ' + out.rsc)) { return; }
                var c = Object.prototype.hasOwnProperty.call(RSC, out.rsc) ? RSC[out.rsc] : null;
                var body;
                try {
                    if (!c) { throw new TypeError('unknown rsc ' + JSON.stringify(out.rsc)); }
                    body = responder.body_of(out, request.query.rcn);
                }
                catch (e) {
                    console.error('[settle] done: ' + e.message);
                    on_error(request, response, '500-8', finish);
                    return;
                }
                responder.respond(request, response, { status: c.http, rsc: c.rsc, body: body }, finish);
                return;
            }
            api.error(code);
        },

        /** Error response for a reason code; the most common settlement in app.js. */
        error: function (code) {
            if (!claim('error ' + code)) { return; }
            on_error(request, response, code, finish);
        },

        /** Sends a response that does not fit the shapes above (e.g. a forwarded remote CSE result). fn sends the response; the connection is released afterwards. */
        raw: function (what, fn) {
            if (!claim('raw ' + what)) { return; }
            fn();
            finish();
        },

        /** Whether the request has been settled; for tests and diagnostics. */
        isSettled: function () { return settled; }
    };
    return api;
};
