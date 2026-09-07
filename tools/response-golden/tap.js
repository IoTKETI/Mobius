'use strict';
// Wraps responder's single outlet (respond) and records what actually went out (status, rsc, dbg). Behaviour is unchanged: the original is called as is and only the record is added.
//
// The scenario runner labels each case with the X-Golden-Case header. Resource names contain timestamps, so paths differ per run and the label is the key instead of the path.
//
// Every worker is a separate process, so each writes its own pid file; collect.js merges them.
//
// Only respond is wrapped: it is the one place where response bytes reach the wire, and what is being protected is the (status, rsc, dbg) the client receives, not which function was passed through.
//
// spec of respond(request, response, spec, done) is one of
//   error    { code: <rsc.js catalogue entry>, dbg, detail }
//   success  { status, rsc, body, headers }
// With code present it is an error.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

function install() {
    try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) { /* already exists */ }

    const responder = require('../../mobius/responder');
    if (responder.__respTapped) { return; }
    responder.__respTapped = true;

    const orig = responder.respond;
    if (typeof orig !== 'function') {
        console.error('[resp-tap] responder.respond 가 없다 — 기록하지 않는다');
        return;
    }

    const stream = fs.createWriteStream(
        path.join(OUT_DIR, 'resp-' + process.pid + '.jsonl'), { flags: 'a' });

    responder.respond = function (request, response, spec) {
        try {
            const h = (request && request.headers) || {};
            const err = spec && spec.code;
            stream.write(JSON.stringify({
                case: h['x-golden-case'] || '(unlabeled)',
                fn: err ? 'error' : 'ok',
                status: String(err ? err.http : (spec && spec.status)),
                rsc: String(err ? err.rsc : (spec && spec.rsc)),
                arg5: (spec && typeof spec.dbg === 'string') ? spec.dbg : null,
                method: String((request && request.method) || '')
            }) + '\n');
        } catch (e) {
            // A recording failure must not block the response
            console.error('[resp-tap] ' + e.message);
        }
        return orig.apply(this, arguments);
    };

    console.error('[resp-tap] installed (respond, pid ' + process.pid + ')');
}

module.exports = { install: install, OUT_DIR: OUT_DIR };
