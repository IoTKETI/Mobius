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
 * Created by Il Yeup, Ahn in KETI on 2016-07-13.
 */

var responder = require('./responder');
var moment = require('moment');
var util = require('util');
var merge = require('merge');

var facade = require('./db');

// Backend-neutral error predicates; the core reads only the codes the adapter attaches.
var db_errors = require('./db/errors');

// Used by the subscription reachability audit (audit_subscriptions) to read nu and poa.
var url = require('url');
var poa_util = require('./poa');

var _this = this;

global.max_lim = 2000;

const max_search_count = 2000;

// Maximum number of rows delete_oldest removes in one pass. A lookup delete cascades to the cin body (FK cin_ri ON DELETE CASCADE); whatever is left over is removed by the next sweep.
const MAX_PURGE_PER_PASS = 100;


// Computes how much one pass must remove.
//   need_cnt   rows over the count limit
//   need_cs    bytes over the size limit
//   candidates rows to fetch. A size overrun cannot know in advance how many rows it takes, so the cap is fetched and the caller trims while accumulating
//   est_count  estimated row count for paths that cannot read cs, based on the average size
exports.purge_plan = function (cni, cbs, mni, mbs) {
    var need_cnt = (cni > mni) ? (cni - mni) : 0;
    var need_cs = (cbs > mbs) ? (cbs - mbs) : 0;

    var est_count = need_cnt;
    if (need_cs > 0) {
        var avg_cs = (cni > 0) ? Math.ceil(cbs / cni) : 1;
        var by_size = Math.ceil(need_cs / avg_cs);
        if (by_size > est_count) est_count = by_size;
    }
    if (est_count > MAX_PURGE_PER_PASS) est_count = MAX_PURGE_PER_PASS;

    return {
        need_cnt: need_cnt,
        need_cs: need_cs,
        est_count: est_count,
        candidates: (need_cs > 0) ? MAX_PURGE_PER_PASS : Math.min(need_cnt, MAX_PURGE_PER_PASS)
    };
};


exports.get_hit_all = function (connection, callback) {
    var until = moment().utc().subtract(1, 'year').format('YYYYMMDD');

    facade.run(facade.k('hit').select('*').where('ct', '>', until).limit(1000),
        connection, callback);
};

exports.set_hit = function (connection, binding, callback) {
    var _ct = moment().utc().format('YYYYMMDD');
    var _http = 0;
    var _mqtt = 0;
    var _coap = 0;
    var _ws = 0;

    if (binding === 'H') {
        _http = 1;
    }
    else if (binding === 'M') {
        _mqtt = 1;
    }
    else if (binding === 'C') {
        _coap = 1;
    }
    else if (binding === 'W') {
        _ws = 1;
    }

    bump_hit(connection, _ct, _http, _mqtt, _coap, _ws, callback);
};

// Increments the per-day protocol hit counters. The upsert is expressed with onConflict().merge() so both dialects share one statement.
function bump_hit(connection, _ct, _http, _mqtt, _coap, _ws, callback) {
    var qb = facade.k('hit')
        .insert({ ct: _ct, http: _http, mqtt: _mqtt, coap: _coap, ws: _ws })
        .onConflict('ct')
        .merge({
            http: facade.raw('http + ?', [_http]),
            mqtt: facade.raw('mqtt + ?', [_mqtt]),
            coap: facade.raw('coap + ?', [_coap]),
            ws: facade.raw('ws + ?', [_ws])
        });

    facade.run(qb, connection, callback);
}

exports.set_hit_n = function (connection, _ct, _http, _mqtt, _coap, _ws, callback) {
    bump_hit(connection, _ct, _http, _mqtt, _coap, _ws, callback);
};


// Resolves several sri at once. Rows are (ri, sri) pairs; the caller matches them up.
exports.get_ri_sri_in = function (connection, sri_list, callback) {
    facade.run(facade.k('lookup').select('ri', 'sri').whereIn('sri', sri_list || []), connection, callback);
};

exports.get_ri_sri = function (connection, sri, callback) {
    facade.run(facade.k('lookup').select('ri').where({ sri: sri }), connection, function (err, results) {
        callback(err, results);
    });
};


// Common entry point of every resource creation (insert_cb / insert_acp / insert_ae / insert_cnt / insert_cin / insert_sub ...). All values go out as bindings; JSON columns default to [] so an undefined attribute cannot crash the worker.
exports.insert_lookup = function (connection, obj, callback) {
    facade.run(facade.k('lookup').insert({
        pi: obj.pi,
        ri: obj.ri,
        ty: obj.ty,
        ct: obj.ct,
        st: obj.st,
        rn: obj.rn,
        lt: obj.lt,
        et: obj.et,
        acpi: JSON.stringify(obj.acpi || []),
        // lbl is stored with 4-space indentation; readers JSON.parse it, and the stored form is kept for consistency with existing rows.
        lbl: JSON.stringify(obj.lbl || [], null, 4),
        at: JSON.stringify(obj.at || []),
        aa: JSON.stringify(obj.aa || []),
        sri: obj.sri,
        spi: obj.spi,

        // Copies of the CIN's size and format; discovery's sza / szb / cty read these without joining cin. Null for non-CIN resources (0 would be indistinguishable from an empty body).
        cs: (obj.ty == 4 && obj.cs != null) ? obj.cs : null,
        cnf: (obj.ty == 4 && obj.cnf != null) ? obj.cnf : null
    }), connection, callback);
};

exports.insert_cb = function (connection, obj, callback) {
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb = facade.k('cb').insert({
                ri: obj.ri,
                cst: obj.cst,
                csi: obj.csi,
                srt: JSON.stringify(obj.srt),
                poa: JSON.stringify(obj.poa),
                nl: obj.nl,
                ncp: obj.ncp,
                srv: JSON.stringify(obj.srv)
            });

            facade.run(qb, connection, function (err2, results2) {
                if (!err2) {
                    callback(err2, results2);
                    return;
                }
                // The cb insert failed; remove the lookup row inserted above.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        callback(err2, results2);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_acp = function (connection, obj, callback) {
    _this.insert_lookup(connection, obj, function (err, results) {
        if (err) {
            callback(err, results);
            return;
        }

        facade.run(facade.k('acp').insert({
            ri: obj.ri,
            pv: JSON.stringify(obj.pv),
            pvs: JSON.stringify(obj.pvs)
        }), connection, function (err2, results2) {
            if (!err2) {
                callback(err2, results2);
                return;
            }

            // The body insert failed; remove the lookup row so it does not stay orphaned.
            facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection, function () {
                callback(err2, results2);
            });
        });
    });
};

exports.insert_ae = function (connection, obj, callback) {
    _this.insert_lookup(connection, obj, (err, results) => {
        if (!err) {
            facade.run(facade.k('ae').insert({
                ri: obj.ri,
                apn: obj.apn,
                api: obj.api,
                aei: obj.aei,
                poa: JSON.stringify(obj.poa || []),
                or: obj.or,
                nl: obj.nl,
                rr: obj.rr,
                csz: obj.csz,
                srv: JSON.stringify(obj.srv || [])
            }), connection, function (aerr, ares) {
                if (!aerr) {
                    callback(aerr, ares);
                    return;
                }
                // The ae insert failed; remove the lookup row inserted above.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        callback(aerr, ares);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.insert_cnt = function (connection, obj, callback) {
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            facade.run(facade.k('cnt').insert({
                ri: obj.ri,
                cr: obj.cr,
                mni: obj.mni,
                mbs: obj.mbs,
                mia: obj.mia,
                cni: obj.cni,
                cbs: obj.cbs,
                li: obj.li,
                or: obj.or,
                disr: obj.disr
            }), connection, function (cerr, cres) {
                if (!cerr) {
                    callback(cerr, cres);
                    return;
                }
                // The cnt insert failed; remove the lookup row inserted above.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        callback(cerr, cres);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

global.getType = function (p) {
    var type = 'string';
    if (Array.isArray(p)) {
        type = 'array';
    }
    else if (typeof p === 'string') {
        try {
            var _p = JSON.parse(p);
            if (typeof _p === 'object') {
                type = 'string_object';
            }
            else {
                type = 'string';
            }
        } catch (e) {
            type = 'string';
            return type;
        }
    }
    else if (p != null && typeof p === 'object') {
        type = 'object';
    }
    else {
        type = 'other';
    }

    return type;
};

// Returns the container's current cni / cbs / st from the stored counters. Read-only: limit enforcement is not done here but by the primary's purge_sweep, which is the single purger (so delete_oldest needs no locking); drift is corrected by reconcile_cnt_counters.
exports.get_cni_count = function (connection, obj, callback) {
    _this.select_cni_parent(connection, obj.ri, function (err, rows) {
        if (err || !rows || rows.length !== 1) {
            callback(0, 0, 0);
            return;
        }

        var r = rows[0];
        callback(
            parseInt(r.cni || 0, 10),
            parseInt(r.cbs || 0, 10),
            (r.st == null) ? 0 : parseInt(r.st, 10));
    });
};

exports.insert_cin = function (connection, obj, callback) {
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            var con_type = getType(obj.con);
            if (con_type === 'string_object') {
                try {
                    obj.con = JSON.parse(obj.con);
                }
                catch (e) {
                }
            }

            facade.run(facade.k('cin').insert({
                ri: obj.ri,
                pi: obj.pi,
                cr: obj.cr,
                cnf: obj.cnf,
                cs: obj.cs,
                or: obj.or,
                con: (con_type == 'string') ? obj.con : JSON.stringify(obj.con)
            }), connection, function (ierr, ires) {
                if (!ierr) {
                    callback(ierr, ires);
                    return;
                }
                // The cin insert failed; remove the lookup row inserted above.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        callback(ierr, ires);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

// ---------------------------------------------------------------------------
// Creation of resources whose body lives in a single table.
//
// Every entry has the same shape: insert into lookup -> insert into the body table -> roll back lookup if the body insert fails. Only the table name and the column list differ, and each column name is the key of the same name in obj. A new resource type is one more row in this table.
//
//   [table, columns (space separated), columns stored as JSON]
var BODY_TABLES = {
    insert_grp:      ['grp',  'ri cr mt cnm mnm mid macp mtv csy gn', 'mid macp'],
    // lcp.cr is NOT NULL without a default, so cr is part of the column list.
    insert_lcp:      ['lcp',  'ri los lou lot lor loi lon lost cr'],
    insert_fcnt:     ['fcnt', 'ri cnd cr'],

    // The eight hd_* entries all use the fcnt table and differ in one middle column. The key is the export name; the caller (resource.js) uses the same spelling.
    insert_hd_dooLk: ['fcnt', 'ri cnd lock cr'],
    insert_hd_bat:   ['fcnt', 'ri cnd lvl cr'],
    insert_hd_tempe: ['fcnt', 'ri cnd curT0 cr'],
    insert_hd_binSh: ['fcnt', 'ri cnd powerSe cr'],
    insert_hd_fauDn: ['fcnt', 'ri cnd sus cr'],
    insert_hd_colSn: ['fcnt', 'ri cnd colSn cr'],
    insert_hd_brigs: ['fcnt', 'ri cnd brigs cr'],
    insert_hd_color: ['fcnt', 'ri cnd red green blue cr'],

    // mgmtObj family.
    insert_fwr:      ['mgo',  'ri mgd objs obps dc vr fwnnam url ud uds', 'uds'],
    insert_bat:      ['mgo',  'ri mgd objs obps dc btl bts'],
    insert_dvi:      ['mgo',  'ri mgd objs obps dc dbl man mod dty fwv swv hwv'],
    insert_dvc:      ['mgo',  'ri mgd objs obps dc can att cas cus ena dis', 'cas'],
    insert_rbo:      ['mgo',  'ri mgd objs obps dc rbo far'],

    insert_nod:      ['nod',  'ri ni hcl mgca'],
    insert_csr:      ['csr',  'ri cst poa cb csi mei tri rr nl srv', 'poa srv'],
    insert_smd:      ['smd',  'ri cr dsp dcrp soe rels or', 'rels'],
    insert_mms:      ['mms',  'ri sid soid stid asd osd sst']
};

function make_body_insert(name, table, cols, json_cols) {
    return function (connection, obj, callback) {

        _this.insert_lookup(connection, obj, function (err, results) {
            if (err) {
                callback(err, results);
                return;
            }

            var row = {};
            cols.forEach(function (c) {
                // JSON columns default to [] as in insert_ae / insert_cnt, so an undefined attribute cannot crash the worker.
                if (json_cols.indexOf(c) >= 0) {
                    row[c] = JSON.stringify(obj[c] || []);
                    return;
                }
                // undefined and null are stored as an empty string. The builder would send them as NULL and most columns of these tables are NOT NULL; an attribute the client did not send (or sent as null) is stored as 'not filled'. Filling type-specific defaults belongs to each build_* function.
                row[c] = (obj[c] === undefined || obj[c] === null) ? '' : obj[c];
            });

            facade.run(facade.k(table).insert(row), connection, function (err2, results2) {
                if (!err2) {
                    callback(err2, results2);
                    return;
                }

                // The body insert failed; remove the lookup row so it does not stay orphaned (an orphan row breaks discovery).
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        callback(err2, results2);
                    });
            });
        });
    };
}

Object.keys(BODY_TABLES).forEach(function (name) {
    var t = BODY_TABLES[name];
    exports[name] = make_body_insert(
        name, t[0], t[1].split(' '), (t[2] || '').split(' ').filter(Boolean));
});
// ---------------------------------------------------------------------------

// Source of notification routing: sgn.check reads the subscriptions attached to a resource by its ri on every write. Only the six fields the sender (sub_entry.read) needs are selected, ordered by ri. nu and enc are returned as the JSON strings insert_sub stored; the reader parses them.
exports.select_subs_by_pi = function (connection, pi, callback) {
    facade.run(facade.k('sub').select('ri', 'nu', 'enc', 'nct', 'nec', 'cr')
                     .where({ pi: pi }).orderBy('ri', 'asc'), connection, callback);
};

exports.insert_sub = function (connection, obj, callback) {
    _this.insert_lookup(connection, obj, function (err, results) {
        if (!err) {
            facade.run(facade.k('sub').insert({
                ri: obj.ri,
                pi: obj.pi,
                enc: JSON.stringify(obj.enc || {}),
                exc: obj.exc,
                nu: JSON.stringify(obj.nu || []),
                gpi: obj.gpi,
                nfu: obj.nfu,
                bn: JSON.stringify(obj.bn || {}),
                rl: obj.rl,
                psn: obj.psn,
                pn: obj.pn,
                nsp: obj.nsp,
                ln: obj.ln,
                nct: obj.nct,
                nec: obj.nec,
                cr: obj.cr,
                su: obj.su
            }), connection, function (serr, sres) {
                if (!serr) {
                    callback(serr, sres);
                    return;
                }
                // The sub insert failed; remove the lookup row inserted above.
                facade.run(facade.k('lookup').where({ ri: obj.ri }).del(), connection,
                    function () {
                        callback(serr, sres);
                    });
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.select_resource_from_url = function (connection, ri, sri, callback) {
    // A structured address is looked up by ri (the primary key) alone; the caller (app.js get_target_url) sends an empty sri. Only unstructured addresses (/~/<cseid>/<id>, /<id>) look at both columns.
    var qb = facade.k('lookup').select('*');
    if (ri && sri) { qb.where({ ri: ri }).orWhere({ sri: sri }); }
    else if (ri) { qb.where({ ri: ri }); }
    else { qb.where({ sri: sri }); }

    facade.run(qb, connection, function (err, comm_Obj) {
        if (err) {
            callback(err, comm_Obj);
            return;
        }

        if (comm_Obj.length === 0) {
            callback(err, comm_Obj);
            return;
        }

        var table = responder.typeRsrc[comm_Obj[0].ty];
        if (!table) {
            // A type this CSE does not handle (an old row of a removed type left in lookup). Only the lookup row is returned, so the caller can see the ty and answer 'unsupported type' instead of a plain 404.
            console.error('[select_resource_from_url] 지원하지 않는 타입의 행: ty=' +
                          comm_Obj[0].ty + ' ' + comm_Obj[0].ri);
            callback(null, [comm_Obj[0]]);
            return;
        }

        facade.run(facade.k(table).select('*').where({ ri: comm_Obj[0].ri }), connection,
            function (err2, spec_Obj) {
                if (err2) {
                    callback(err2, spec_Obj);
                    return;
                }
                var resource_Obj = [];
                resource_Obj.push(spec_Obj.length > 0
                    ? merge(comm_Obj[0], spec_Obj[0])
                    : comm_Obj[0]);
                callback(null, resource_Obj);
            });
    });
};

// Batch form of select_resource_from_url, used by nu resolution (mobius/nu_resolve.js) to resolve all ID-form nu of a subscription at once. Reads lookup by a list of ri or sri, then reads each type table once and merges. Rows of a type this CSE does not handle are returned as the lookup row only (no poa, so the caller drops them); entries without a match are absent from the result.
exports.select_resources_in = function (connection, ri_list, sri_list, callback) {
    var ris = ri_list || [];
    var sris = sri_list || [];
    if (ris.length === 0 && sris.length === 0) {
        callback(null, []);
        return;
    }
    var qb = facade.k('lookup').select('*').where(function () {
        this.whereIn('ri', ris).orWhereIn('sri', sris);
    });
    facade.run(qb, connection, function (err, comm) {
        if (err) {
            callback(err, comm);
            return;
        }
        var byTable = {};
        (comm || []).forEach(function (row) {
            var table = responder.typeRsrc[row.ty];
            if (!table) {
                console.error('[select_resources_in] 지원하지 않는 타입의 행: ty=' + row.ty + ' ' + row.ri);
                return;
            }
            (byTable[table] = byTable[table] || []).push(row.ri);
        });
        var tables = Object.keys(byTable);
        var spec = {};
        (function next(i) {
            if (i >= tables.length) {
                callback(null, (comm || []).map(function (row) {
                    return spec[row.ri] ? merge(row, spec[row.ri]) : row;
                }));
                return;
            }
            facade.run(facade.k(tables[i]).select('*').whereIn('ri', byTable[tables[i]]), connection,
                function (err2, rows) {
                    if (err2) {
                        callback(err2, rows);
                        return;
                    }
                    (rows || []).forEach(function (r) { spec[r.ri] = r; });
                    next(i + 1);
                });
        })(0);
    });
};

// Registered remote CSEs; update_route (app.js) calls this for fanOutPoint and group creation. The wildcard lives in the bound value.
exports.select_csr_like = function (connection, cb, callback) {
    facade.run(facade.k('csr').select('*').where('ri', 'like', '/' + cb + '/%'),
        connection, callback);
};

exports.select_csr = function (connection, ri, callback) {
    facade.run(facade.k('csr').select('*').where({ ri: ri }), connection, callback);
};

exports.select_ae = function (connection, ri, callback) {
    facade.run(facade.k('ae').select('*').where({ ri: ri }), connection, callback);
};

// --- Discovery parameter normalisation ---
//
// Values are not escaped here; build_search_query passes them as named bindings.
//
// Numeric parameters are validated because they are used as literals or in branching decisions:
//   sza / szb   bound, but must parse as integers for the comparison
//   la / ofst   limit / offset literals
//   lvl         recursion depth literal
//   ty          read by requested_ty_list / size_filter_excludes_all
// A non-integer value drops that filter (fail-safe).
function sanitize_discovery_query(query) {
    if (!query || typeof query !== 'object') {
        return;
    }
    var isUint = function (v) { return /^[0-9]+$/.test(String(v)); };

    // Numeric context: sza/szb/la/ofst/lvl are inserted unquoted, so only integers are accepted.
    ['sza', 'szb', 'la', 'ofst', 'lvl'].forEach(function (k) {
        if (query[k] != null && !isUint(query[k])) {
            delete query[k];
        }
    });

    // ty: a single integer or a list of integers.
    if (query.ty != null) {
        var tys = Array.isArray(query.ty) ? query.ty : String(query.ty).split(',');
        if (!tys.every(isUint)) {
            delete query.ty;
        }
    }

    // String filters keep their value but must be scalars. Express's extended query parser turns ?cra[x]=1 into an object; binding an object would produce a malformed or silently neutralised predicate, so a non-scalar drops that filter (fail-safe, like the numeric ones). Only lbl accepts an array (lbl=a&lbl=b), which build_search_query joins with OR.
    var isScalar = function (v) {
        return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
    };

    ['rn', 'cty', 'cra', 'crb', 'ms', 'us', 'exa', 'exb', 'sts', 'stb'].forEach(function (k) {
        if (query[k] == null) { return; }
        if (!isScalar(query[k])) { delete query[k]; }
    });

    if (query.lbl != null) {
        if (Array.isArray(query.lbl)) {
            if (!query.lbl.every(isScalar)) { delete query.lbl; }
        }
        else if (!isScalar(query.lbl)) {
            delete query.lbl;
        }
    }
}
exports.sanitize_discovery_query = sanitize_discovery_query;

/**
 * Builds the WHERE fragment for discovery filters.
 *
 * All client values go out as named bindings (:name), not positional (?): a question mark inside a value would otherwise be counted as a placeholder. The skeleton CTE's :root_ri uses named bindings for the same reason.
 *
 * Returns { where, bindings }
 *   where     fragment starting with ' and ...' (empty string when none)
 *   bindings  { q_xxx: value }, merged by the caller with :root_ri
 */
function build_search_query(query) {
    var where = '';
    var b = {};
    var n = 0;
    // Names must be unique; labels and types may repeat, so a sequence number is appended.
    function bind(v) {
        var k = 'q' + (n++);
        b[k] = v;
        return ':' + k;
    }

    if (query.lbl != null) {
        // lbl is a string holding a JSON array, so it is matched with like; the whole pattern is passed as the value. % and _ inside the value keep their wildcard meaning. A comma-separated string is walked character by character by the else branch (kept as is); an array (lbl=a&lbl=b) is handled normally.
        var like = function (v) { return '%"%' + v + '%"%'; };
        if (query.lbl.toString().split(',')[1] == null) {
            where += ' and lbl like ' + bind(like(query.lbl));
        }
        else {
            // Several labels are joined with OR inside parentheses so later filters apply to the whole group (AND binds tighter than OR).
            var parts = [];
            for (var i = 0; i < query.lbl.length; i++) {
                parts.push('lbl like ' + bind(like(query.lbl[i])));
            }
            where += ' and (' + parts.join(' or ') + ')';
        }
    }

    if (query.ty != null) {
        // Types are compared with equality: inside a MySQL recursive CTE only ref access uses the index, so IN or range predicates would stop at pi. Values are bound as strings, matching the former literals.
        var tys = Array.isArray(query.ty) ? query.ty : String(query.ty).split(',');
        if (tys.length === 1) {
            where += ' and ty = ' + bind(String(tys[0]));
        }
        else {
            var ors = tys.map(function (t) { return 'ty = ' + bind(String(t)); });
            where += ' and (' + ors.join(' or ') + ')';
        }
    }

    if (query.cra != null) { where += ' and ' + bind(query.cra) + ' <= ct'; }
    if (query.crb != null) { where += ' and ct < ' + bind(query.crb); }
    if (query.ms != null) { where += ' and ' + bind(query.ms) + ' <= lt'; }
    if (query.us != null) { where += ' and lt < ' + bind(query.us); }
    if (query.exa != null) { where += ' and ' + bind(query.exa) + ' <= et'; }
    if (query.exb != null) { where += ' and et < ' + bind(query.exb); }
    if (query.sts != null) { where += ' and st < ' + bind(query.sts); }
    if (query.stb != null) { where += ' and ' + bind(query.stb) + ' <= st'; }

    // sza / szb compare the contentInstance size (cs).
    //
    // The column comes from lookup (r.cs) when the copy has been backfilled (global set by mobius/db_bootstrap.js from the migration ledger), otherwise from the joined cin (c.cs). The default is the join, which is slower but complete.
    //
    // The comparison is numeric: cs is int on MySQL and TEXT on SQLite.
    var cs_col = lookup_has_cin_attrs() ? 'r.cs' : 'c.cs';
    if (query.sza != null) {
        where += ' and ' + bind(parseInt(query.sza, 10)) + ' <= ' + facade.numericExpr(cs_col);
    }
    if (query.szb != null) {
        where += ' and ' + facade.numericExpr(cs_col) + ' < ' + bind(parseInt(query.szb, 10));
    }

    if (query.rn != null) { where += ' and rn = ' + bind(query.rn); }

    // cty is not supported; presearch_action rejects it with 400-65 before discovery runs.

    return { where: where, bindings: b };
}
exports._build_search_query = build_search_query;

// Marker telling build_children_sql not to restrict parents. It is an object so it can never be confused with null or an empty array, which mean 'no parents' (no answer).
var ALL_PARENTS = { all_parents: true };
exports.ALL_PARENTS = ALL_PARENTS;

// Whether lookup.cs / lookup.cnf can be trusted. Migration 011 adds the columns, tools/backfill-lookup-cin-attrs.js fills old rows and 012 confirms that no CIN is left unfilled; mobius/db_bootstrap.js sets the global at boot from the migration ledger. The default is false: with the join, discovery is slower but complete.
function lookup_has_cin_attrs() {
    return global.lookup_has_cin_attrs === true;
}
exports._lookup_has_cin_attrs = lookup_has_cin_attrs;

// Whether cin must be joined: sza / szb read the CIN size, which lookup also holds once the backfill is complete.
function needs_cin_join(query) {
    if (lookup_has_cin_attrs()) { return false; }
    return query.sza != null || query.szb != null;
}

// Whether the request carries a size filter, independent of whether cin is joined. The skeleton uses this to drop parents without CINs, which pays off with or without the join.
function has_size_filter(query) {
    return query.sza != null || query.szb != null;
}
exports._has_size_filter = has_size_filter;
exports.needs_cin_join = needs_cin_join;

// The ty list the request selected; null when none (no type restriction).
function requested_ty_list(query) {
    if (query.ty == null) { return null; }
    var raw = Array.isArray(query.ty) ? query.ty : String(query.ty).split(',');
    return raw.map(function (t) { return String(t).trim(); }).filter(Boolean);
}

/**
 * Whether the request uses a filter no index can narrow (lbl, matched with like '%..%') without selecting a type.
 *
 * Without a type the candidates would be every descendant, most of them CINs, so CINs are excluded via the (pi, not_cin) index. The exclusion is reported to the caller (skippedCin) rather than applied silently; CIN labels are searched by passing ty=4 explicitly.
 *
 * la requests never trigger this guard: presearch_action (mobius/resource.js) fixes ty='4' and lvl='1' for la, so the skeleton is the single root and the candidates are one container's CINs. test/discovery-truncation.test.js pins both.
 */
function like_filter_without_ty(query) {
    return query.lbl != null && query.ty == null;
}
exports._like_filter_without_ty = like_filter_without_ty;

// cs / cnf exist only on contentInstance (ty=4), so a size filter can only match ty=4. A request restricted to other types cannot have an answer and is not sent to the DB.
function size_filter_excludes_all(query) {
    // Decided by has_size_filter, not needs_cin_join: the fact holds regardless of which table the value is read from.
    if (!has_size_filter(query)) { return false; }
    var tys = requested_ty_list(query);
    if (tys === null) { return false; }   // no ty given: CINs are candidates too
    return tys.indexOf('4') < 0;
}
exports.size_filter_excludes_all = size_filter_excludes_all;

// Types the descendant walk does not traverse: leaves (4=cin, 23=sub, 17=req) and types handled by separate paths (1=acp, 9=grp).
const PRESEARCH_SKIP_TY = ['1', '9', '23', '4'];

// Collects the non-leaf descendants with one recursive CTE. max_levels bounds the depth; without it the walk is unbounded, as used by the background subtree delete (resource.js delete_descendants_background).
exports.search_parents_lookup_all = function (connection, pi_list, cur_result_ri, result_ri,
                                              callback, max_levels) {
    if (pi_list.length === 0) {
        callback('200');
        return;
    }

    var bounded = (max_levels !== undefined && max_levels !== null);
    if (bounded && max_levels <= 0) {
        callback('200');
        return;
    }

    // pi values are bound, not interpolated: they carry client-chosen rn.
    var anchor_marks = pi_list.map(function () { return '?'; }).join(',');
    var bindings = pi_list.slice();

    // The ty exclusion list is bound too; the anchor and the recursive term each need one copy.
    var ty_marks = PRESEARCH_SKIP_TY.map(function () { return '?'; }).join(',');
    bindings = bindings.concat(PRESEARCH_SKIP_TY);

    var depth_sel = bounded ? ', 1 AS depth' : '';
    var depth_rec = bounded ? ', p.depth + 1' : '';
    var depth_lim = '';
    if (bounded) {
        depth_lim = ' AND p.depth < ?';
    }

    var sql =
        'WITH RECURSIVE hierarchy AS (' +
        '  SELECT ri, ty, pi' + depth_sel + ' FROM lookup' +
        '   WHERE pi IN (' + anchor_marks + ') AND ty NOT IN (' + ty_marks + ')' +
        '  UNION ALL' +
        '  SELECT l.ri, l.ty, l.pi' + depth_rec + ' FROM lookup l JOIN hierarchy p ON l.pi = p.ri' +
        '   WHERE l.ty NOT IN (' + ty_marks + ')' + depth_lim +
        ') SELECT ri, ty, pi FROM hierarchy';

    bindings = bindings.concat(PRESEARCH_SKIP_TY);
    if (bounded) { bindings.push(max_levels); }

    facade.run(facade.raw(sql, bindings), connection, function (err, rows) {
        if (err) {
            console.error('[search_parents_lookup] Error:', rows);
            callback('500-1');
            return;
        }
        rows = rows || [];
        for (var i = 0; i < rows.length; i++) {
            result_ri.push(rows[i]);
        }
        callback('200');
    });
};


// Fills the lookup rows found by discovery with the attributes of their type table (cnt / cin / ae ...). Rows without a partner in the type table are dropped from the response (orphans left in lookup). Queries are grouped by type, one IN query per chunk. The count argument is unused; the caller passes 0.
exports.select_spec_ri = function (connection, found_Obj, count, callback) {
    // Key order is the response order. Below, values are assigned only to existing keys, so the order is preserved.
    var ris = Object.keys(found_Obj);
    if (ris.length === 0) {
        callback('200');
        return;
    }

    // Group by type table.
    var by_table = {};
    var i;
    for (i = 0; i < ris.length; i++) {
        var table = responder.typeRsrc[found_Obj[ris[i]].ty];
        if (!table) {
            // An unknown type would produce a broken query; log the cause and fail with the same code.
            console.error('[select_spec_ri] unknown ty=' + found_Obj[ris[i]].ty +
                          ' ri=' + ris[i] + ' — responder.typeRsrc 에 없다');
            callback('500-1');
            return;
        }
        if (!by_table[table]) { by_table[table] = []; }
        by_table[table].push(ris[i]);
    }

    // ri is at most 200 characters, so 500 per chunk keeps the IN list around 100KB.
    var CHUNK = 500;
    var tables = Object.keys(by_table);
    var spec_by_ri = {};

    function done() {
        for (var k = 0; k < ris.length; k++) {
            var ri = ris[k];
            if (spec_by_ri[ri]) { found_Obj[ri] = merge(found_Obj[ri], spec_by_ri[ri]); }
            else { delete found_Obj[ri]; }
        }
        callback('200');
    }

    function next_table(ti) {
        if (ti >= tables.length) { return done(); }
        var t = tables[ti];
        var list = by_table[t];
        var pos = 0;

        function next_chunk() {
            if (pos >= list.length) { return next_table(ti + 1); }
            var chunk = list.slice(pos, pos + CHUNK);
            pos += CHUNK;

            facade.run(facade.k(t).select('*').whereIn('ri', chunk), connection,
                function (err, rows) {
                    if (err) {
                        console.error('[select_spec_ri] ' + t + ': ' + db_errors.text(rows));
                        return callback('500-1');
                    }
                    rows = rows || [];
                    for (var r = 0; r < rows.length; r++) {
                        // makeObject modifies the row in place, so the key is captured first.
                        var key = rows[r].ri;
                        makeObject(rows[r]);
                        spec_by_ri[key] = rows[r];
                    }
                    next_chunk();
                });
        }

        next_chunk();
    }

    next_table(0);
};

// Discovery on both backends: a recursive CTE builds the skeleton (the descendants that can be parents), then a second statement fetches children with the skeleton as a constant parent list (pi IN (...)). With a constant list the range optimizer includes ct in the key range (pi, ty, ct); a join would use only (pi, ty) and filter ct while scanning.
//
// The skeleton widens along 'children that are not CIN (ty=4)'. The predicate is dialect-specific and comes from the facade: facade.notCinPredicate() / notCinIndexName().

// Per-statement time limit so a pathological query (lbl like '%..%' without ty on a large tree) cannot hold a connection indefinitely. Null on backends without the hint, in which case nothing is added.
const DISCOVERY_TIMEOUT_MS = 30000;

// Maximum number of parents (IN list entries) in one children query.
//
// Batching is required: when the IN list exceeds range_optimizer_max_mem_size (8MB) MySQL silently abandons range access and falls back to a full index scan. The tipping point depends on the path string length, so the batch is kept at 4,000 with a 2x margin; test/discovery-cte.test.js pins the cap. SQLite accepts this many bindings as well.
const DISCOVERY_PARENT_BATCH = 4000;

// Minimum remaining budget worth spending on one more batch.
const MIN_BATCH_BUDGET_MS = 100;

// The budget counts range combinations, not parents. With several ty values the where becomes (ty = :q0 or ty = :q1 ...) and the optimizer builds one range per parent per ty value, so the batch is divided by the number of ty values (1 when ty is absent).
function discovery_batch_size(query) {
    var n = 1;
    if (query.ty != null) {
        var list = Array.isArray(query.ty) ? query.ty : String(query.ty).split(',');
        n = list.filter(function (v) { return String(v).trim() !== ''; }).length || 1;
    }
    return Math.max(1, Math.floor(DISCOVERY_PARENT_BATCH / n));
}
exports.discovery_batch_size = discovery_batch_size;

// lvl -> how many levels the skeleton walks; null means unbounded. The root has sk_lvl=0 and its children are result depth 1, so lvl=N needs parents up to sk_lvl <= N-1.
function descendant_max_lvl(query) {
    if (query.lvl == null) { return null; }
    var n = parseInt(query.lvl, 10);
    if (isNaN(n)) { return null; }
    return Math.max(0, n - 1);
}
exports.descendant_max_lvl = descendant_max_lvl;

// SQL selecting the skeleton below ri (descendants that can be parents). Returns {sql, bindings}.
//
// The result exposes sk_ri / sk_lvl; a separate statement takes this list as pi IN (...). Columns are prefixed sk_ because build_search_query names columns without an alias (lbl, ty, ct ...), and unprefixed ri / ty would make the children query's where ambiguous.
//
// budget_ms is the limit for this one statement. The caller computes the remaining request budget and passes it, so the batch path does not multiply DISCOVERY_TIMEOUT_MS by the number of statements.
function build_skeleton_sql(ri, query, budget_ms) {
    var C = facade.pathCollate();
    var max_lvl = descendant_max_lvl(query);

    // The recursive term forces the index. Without it the optimizer may choose the clustered PRIMARY (pi, ri, ty) and filter the rest, reading every CIN of each container it widens through.
    var recur_hint = facade.indexHint(facade.notCinIndexName());

    // The skeleton widens along 'children that are not CIN' with a single branch. not_cin is a virtual generated column holding (ty <> 4) with a (pi, not_cin) index (migrations/004), so the predicate is an equality the recursive CTE can use. ty <> 4 also admits SUB / ACP / GRP, which is harmless and needs no type list.
    var branches = '';
    // With max_lvl 0 only direct children are needed, so no recursion at all.
    if (max_lvl === null || max_lvl > 0) {
        var guard = (max_lvl === null) ? '' : ' and s.sk_lvl < ' + max_lvl;
        branches = '\n  union\n' +
            '  select l.ri' + C + ', s.sk_lvl + 1 from lookup l' + recur_hint +
            ' join skel s on l.pi = s.sk_ri' +
            ' where ' + facade.notCinPredicate('l') + guard;
    }

    var timeout = facade.statementTimeoutHint(budget_ms || DISCOVERY_TIMEOUT_MS);
    // Forbids hash joins: in the recursive term the partner changes on every iteration, so a hash plan would rebuild the hash each time.
    var lead = 'select ' + facade.optimizerHints([timeout, facade.noHashJoinHint(['l', 's'])]);

    // The collation fragment (C) for the skeleton column is empty since migration 018: pi and ri share utf8mb3_bin, and a cast on the join side would lose the (pi, not_cin) index (see pathCollate in mobius/db/mysql.js). Paths differing only in case are distinct resources and are not folded by UNION.
    //
    // The root is a named binding (:root_ri); positional bindings would count question marks inside the value. The children query's :pN / :qN are named for the same reason.
    //
    // With a size filter, parents without CINs are dropped from the skeleton: the recursive predicate (ty <> 4) admits every container, and the cost of the children query is linear in the number of parents. The join is a left join with 'n.ri is null or n.cni > 0': a container can have CINs without a cnt row, and an inner join would silently drop it.
    //
    // riCollate() is likewise empty since 018; the call stays as the adapter contract.
    // Decided by has_size_filter, not needs_cin_join: the parent filter pays off whether or not cin is joined.
    var tail = 'sk_ri, sk_lvl from skel';
    if (has_size_filter(query)) {
        tail = 'sk_ri, sk_lvl from skel s' +
               ' left join cnt n on n.ri = s.sk_ri' + facade.riCollate() +
               ' where n.ri is null or n.cni > 0';
    }

    var sql =
        'with recursive skel as (\n' +
        '  select ri' + C + ' as sk_ri, 0 as sk_lvl from lookup where ri = :root_ri' + branches + '\n' +
        ')\n' +
        lead + tail;

    // Trimming by max_lvl is done in JS by the caller (search_lookup): the recursive guard s.sk_lvl < max_lvl already bounds the depth, and only the last level has to be removed from the parent list.
    return { sql: sql, bindings: { root_ri: ri } };
}
exports.build_skeleton_sql = build_skeleton_sql;

/**
 * SQL fetching the children of one skeleton batch. Returns {sql, bindings}.
 *
 * parents is the array of sk_ri strings of this batch. All values go out as named bindings (:pN); paths never enter the SQL string. The prefix differs from the filter bindings (:qN) so names cannot collide.
 *
 * lim / ofst are the limit and offset within this batch. The caller consumes the global offset against earlier batches first and passes only the remainder (see search_lookup).
 *
 * With count_cap the statement counts rows instead of returning them: select count(*) from (select 1 ... limit count_cap) t, so at most count_cap rows are scanned.
 */
function build_children_sql(parents, query, search, lim, budget_ms, ofst, count_cap) {
    // The children query forces (pi, ty, ct). It filters by the request's ty; with an out-of-index column such as lbl the optimizer would otherwise pick PRIMARY and read every CIN of each parent.
    //
    // A lbl search without ty uses (pi, not_cin) instead, so CINs are skipped per parent (see like_filter_without_ty).
    var skip_cin = like_filter_without_ty(query);
    var hint = facade.indexHint(skip_cin ? facade.notCinIndexName() : 'idx_lookup_pi_ty_ct');
    var skip_cin_where = skip_cin ? (' and ' + facade.notCinPredicate('r')) : '';

    // la does not force an index. la sorts with order by ct desc, ri desc limit N; a forced index makes MySQL pick ref access and sort with filesort. Without the hint the optimizer scans the index as a reverse range and the sort disappears. This also requires pi to be a constant, which is why la uses this batch path (pi IN) instead of a skeleton join.
    if (query.la != null) { hint = ''; }

    // No parent restriction means no forced index. Both candidate indexes start with pi; with ALL_PARENTS there is no pi predicate (where 1 = 1), so a forced index has no usable prefix and MySQL would fall back to a full table scan. Requests without ty (lbl only) also do better without the hint.
    if (parents === ALL_PARENTS) { hint = ''; }

    var timeout = facade.statementTimeoutHint(budget_ms || DISCOVERY_TIMEOUT_MS);
    var lead = 'select ' + facade.optimizerHints([timeout]);

    // sza / szb / cty join cin when the values (cs / cnf) are not in lookup. The join key is (pi, ri); the optimizer joins through PRIMARY, so the cost is proportional to the number of candidates. An inner join is correct: resources without cs / cnf (containers etc.) are not subject to a size filter.
    var cin_join = needs_cin_join(query)
        ? ' join cin c on c.pi = r.pi and c.ri = r.ri' : '';

    // With a size filter the result is always ty=4 (cs / cnf exist only on cin). The predicate is explicit so the (pi, ty) index selects CINs only; without it the optimizer would consider every child of the skeleton and probe cin one by one. Decided by has_size_filter so the clause stays when the join goes away.
    var cin_ty = has_size_filter(query) ? " and r.ty = '4'" : '';

    // An empty list would produce the syntax error 'in ()'. The caller already prevents it, but the function is exported, so null is returned here as well ('nothing to run'). ALL_PARENTS is the exception: it means 'do not restrict parents', the opposite of 'no parents'.
    if (parents !== ALL_PARENTS && (!parents || parents.length === 0)) { return null; }

    var bindings = {};
    var slots = [];
    for (var i = 0; i < parents.length; i++) {
        bindings['p' + i] = parents[i];
        slots.push(':p' + i);
    }

    // Counting reads no columns; the index alone answers.
    var cols = (count_cap != null) ? '1' : 'r.*';

    // No parent restriction (ALL_PARENTS): a request for the whole tree under the CSEBase. The skeleton would return every node and pi in (...) would filter nothing; leaving the clause out lets the optimizer choose an index from the remaining conditions (ty etc.).
    var where_head = (parents === ALL_PARENTS)
        ? ' where 1 = 1'
        : ' where r.pi in (' + slots.join(', ') + ')';

    var sql = lead + cols + ' from lookup r' + hint + cin_join + '\n' +
        where_head + cin_ty + skip_cin_where + search.where;

    // limit / offset are literals; the caller computes them as integers (sanitize_discovery_query forces la / ofst / lim to integers).
    if (count_cap != null) {
        // Bounded count: without the inner limit every candidate would be scanned.
        sql = 'select count(*) as n from (' + sql +
              ' limit ' + Math.max(0, Math.floor(count_cap)) + ') t';
    }
    else {
        // la means 'the latest N'. ct has second resolution and ties are common, so ri breaks ties for a stable order. The index hint was dropped above, so the optimizer serves this sort as a reverse index scan.
        //
        // presearch_action fixes lvl=1 for la, so there is always a single parent and the order within the batch is the global order.
        if (query.la != null) { sql += ' order by r.ct desc, r.ri desc'; }
        sql += ' limit ' + Math.max(0, Math.floor(lim));
        if (ofst > 0) { sql += ' offset ' + Math.floor(ofst); }
    }

    // The filter's :qN bindings are merged in; parents use the p prefix, filters q, so names cannot collide.
    Object.keys(search.bindings).forEach(function (k) {
        bindings[k] = search.bindings[k];
    });

    return { sql: sql, bindings: bindings };
}
exports.build_children_sql = build_children_sql;

// ── Former single-statement path; no caller ──
//
// Kept as the reference form the batch path replaced: it joins the skeleton directly, so pi is not a constant. test/discovery-cte.test.js pins that nothing calls it.
function build_descendant_sql(ri, query, search, cur_lim) {
    var query_where = search.where;
    var C = facade.pathCollate();
    var max_lvl = descendant_max_lvl(query);

    // The recursive term forces the index. Without it the optimizer may choose the clustered PRIMARY (pi, ri, ty) and filter the rest.
    var recur_hint = facade.indexHint(facade.notCinIndexName());

    // The skeleton widens along 'children that are not CIN' with a single branch; not_cin is a virtual generated column with a (pi, not_cin) index (migrations/004).
    var branches = '';
    // With max_lvl 0 only direct children are needed, so no recursion at all.
    if (max_lvl === null || max_lvl > 0) {
        var guard = (max_lvl === null) ? '' : ' and s.sk_lvl < ' + max_lvl;
        branches = '\n  union\n' +
            '  select l.ri' + C + ', s.sk_lvl + 1 from lookup l' + recur_hint +
            ' join skel s on l.pi = s.sk_ri' +
            ' where ' + facade.notCinPredicate('l') + guard;
    }

    // The outer query forces (pi, ty, ct); a lbl search without ty uses (pi, not_cin) instead (see build_children_sql).
    var skip_cin = like_filter_without_ty(query);
    var hint = facade.indexHint(skip_cin ? facade.notCinIndexName() : 'idx_lookup_pi_ty_ct');
    var skip_cin_where = skip_cin ? (' and ' + facade.notCinPredicate('r')) : '';

    var timeout = facade.statementTimeoutHint(DISCOVERY_TIMEOUT_MS);
    // Forbids hash joins in the recursive term (see build_skeleton_sql).
    var lead = 'select ' + facade.optimizerHints([timeout, facade.noHashJoinHint(['l', 's'])]);

    // The collation fragment (C) is empty since migration 018 (see build_skeleton_sql).
    //
    // Bindings are named: the skeleton's :root_ri and the filter's :qN must be mixed in one statement, and positional bindings could not keep the two fragments in order.
    //
    // sza / szb / cty join cin when the values (cs / cnf) are not in lookup; the join key is (pi, ri) and an inner join is correct.
    var cin_join = needs_cin_join(query)
        ? ' join cin c on c.pi = r.pi and c.ri = r.ri' : '';

    // With a size filter the result is always ty=4; the explicit predicate lets the (pi, ty) index select CINs only.
    var cin_ty = has_size_filter(query) ? " and r.ty = '4'" : '';

    var sql =
        'with recursive skel as (\n' +
        '  select ri' + C + ' as sk_ri, 0 as sk_lvl from lookup where ri = :root_ri' + branches + '\n' +
        ')\n' +
        lead + 'r.* from lookup r' + hint +
        ' join skel s on r.pi = s.sk_ri' + cin_join + '\n' +
        ' where 1 = 1' + cin_ty + skip_cin_where + query_where;

    if (max_lvl !== null) { sql += ' and s.sk_lvl <= ' + max_lvl; }

    // la means 'the latest N'; ri breaks ct ties for a stable order (as in select_edge_resource).
    var lim, ofst = null;
    if (query.la != null) {
        sql += ' order by r.ct desc, r.ri desc';
        lim = parseInt(query.la, 10);
    }
    else {
        lim = parseInt(cur_lim, 10);
    }
    if (isNaN(lim) || lim < 0) { lim = max_search_count; }

    if (query.ofst != null) {
        var o = parseInt(query.ofst, 10);
        if (!isNaN(o) && o > 0) { ofst = o; }
    }

    sql += ' limit ' + lim;
    if (ofst !== null) { sql += ' offset ' + ofst; }

    // limit / offset are returned as well, so the caller can decide whether the result was truncated and compute the next offset (X-M2M-CTS / X-M2M-CTO) from the same values the SQL used.
    // The skeleton's :root_ri and the filter's :qN are merged; filter names start with q so they cannot collide.
    var bindings = { root_ri: ri };
    Object.keys(search.bindings).forEach(function (k) {
        bindings[k] = search.bindings[k];
    });

    return { sql: sql, bindings: bindings, limit: lim, offset: ofst || 0,
             // Whether CINs were excluded from this request. The caller reports it in the response and the log, so 'not found' can be told from 'not searched'.
             skippedCin: skip_cin };
}
exports.build_descendant_sql = build_descendant_sql;

// The argument list is that of the former two-stage implementation; the caller (resource.js) and tests use this shape. pi_list / pi_index / skipped / cni / cur_d / loop_cnt / search_tid are no longer read.
//
// The callback is callback(code, info). On success info holds
//   { rows, limit, offset }   rows actually taken, the limit and the offset applied
// which the caller uses to decide whether the result was truncated and to compute the next offset (X-M2M-CTS / X-M2M-CTO).
//
// rows is counted before select_spec_ri drops orphan rows: the next offset must be what the DB actually skipped, not the response count.
//
// ── One path ──
// Every request takes the batch path: one skeleton statement plus ceil(parents / batch size) children statements, typically two round trips in total. build_descendant_sql has no caller.
//
// ── Row order ──
// Within a batch, range access returns rows in pi ascending order. The order is deterministic, and paging stays consistent because every page takes the same path.
exports.search_lookup = function (connection, ri, query, cur_lim, pi_list, pi_index, found_Obj, skipped, cni, cur_d, loop_cnt, callback) {
    // Only parameters used as numbers are filtered; string values go out as bindings and are not escaped (see build_search_query).
    sanitize_discovery_query(query);

    var search = build_search_query(query);
    var max_lvl = descendant_max_lvl(query);
    var la_mode = (query.la != null);

    // Effective limit; with la, its value is the limit.
    var lim = parseInt(la_mode ? query.la : cur_lim, 10);
    if (isNaN(lim) || lim < 0) { lim = max_search_count; }

    var ofst = 0;
    if (query.ofst != null) {
        var o = parseInt(query.ofst, 10);
        if (!isNaN(o) && o > 0) { ofst = o; }
    }

    var info = {
        rows: 0, limit: lim, offset: ofst,
        // Whether CINs were excluded from this request. The caller reports it in the response and the log, so 'not found' can be told from 'not searched'.
        skippedCin: like_filter_without_ty(query)
    };

    // A combination that cannot have an answer does not touch the DB (size filter with a ty list that excludes 4; see size_filter_excludes_all).
    if (size_filter_excludes_all(query)) {
        return callback('200', info);
    }

    // The callback runs exactly once; the batch loop makes double calls easy.
    var settled = false;

    // Facade contract: failure is cb(true, errObj), the error object being the second argument (see run in mobius/db/index.js).
    function bail(res) {
        if (settled) { return; }
        settled = true;

        // A statement timeout is not a DB failure but 'this query cannot cover that range' and is logged separately. The typical shape is lbl like '%..%' without ty, where LIKE cannot use an index. Only the neutral code the adapter attaches is inspected.
        if (db_errors.isStatementTimeout(res)) {
            console.error('[search_lookup] statement timeout (' + DISCOVERY_TIMEOUT_MS +
                          'ms) ri=' + ri + ' query=' + JSON.stringify(query) +
                          ' — 대상을 좁히거나(더 깊은 경로) ty 를 함께 준다');
            // A timeout is reported as 400-67 (narrow the target or add ty), not as a 500 database error.
            return callback('400-67');
        }
        // A missing index makes every discovery fail because of force index (code upgraded without running the migration); the cause is reported directly. A fresh install gets the index from mobiusdb.sql.
        else if (db_errors.isMissingIndex(res)) {
            // The recovery command names no backend; migrate.js takes the backend as an optional argument and follows the configuration otherwise.
            console.error('[search_lookup] 인덱스가 없다: ' + db_errors.text(res) +
                          ' — node tools/migrate.js --check 로 확인하고 적용할 것');
        }
        else {
            console.error('[search_lookup] ' + db_errors.text(res));
        }
        return callback('500-1');
    }

    // ── Path selection ──
    // One query shape always takes the same path. ofst is consumed by the batch path itself (see next_batch below): both pages of a paging sequence must take the same path, or the row order differs and offset N skips different rows.
    //
    // la takes the batch path too: with a constant pi and no forced index the optimizer serves order by ct desc, ri desc as a reverse index range (build_children_sql). presearch_action fixes ty=4 / lvl=1 for la, so there is a single parent and the order within the batch is the global order.

    // Batch path from here. The offset is consumed batch by batch in next_batch below.
    var skip = ofst;
    var need = lim;
    var taken = 0;

    // The DB budget of one request is still DISCOVERY_TIMEOUT_MS. With 1 + N statements the remaining budget is passed to each, and exhausting it is treated like a statement timeout.
    var started = Date.now();
    function budget_left() {
        return DISCOVERY_TIMEOUT_MS - (Date.now() - started);
    }
    function out_of_budget() {
        console.error('[search_lookup] statement timeout (' + DISCOVERY_TIMEOUT_MS +
                      'ms) ri=' + ri + ' query=' + JSON.stringify(query) +
                      ' — 대상을 좁히거나(더 깊은 경로) ty 를 함께 준다');
        if (settled) { return; }
        settled = true;
        return callback('400-67');
    }

    var batch_size = discovery_batch_size(query);

    function finish() {
        if (settled) { return; }
        settled = true;
        info.rows = taken;
        callback('200', info);
    }

    // Result of the skeleton query; next_batch slices batches from it.
    var parents = [];

    // ── A request for everything under the CSEBase builds no skeleton ──
    //
    // The skeleton exists to restrict the search to a subtree; with the CSEBase as target there is nothing to restrict, and a parent list that filters nothing keeps `limit` from ending early when a selective filter is present. Without the parent list the same rows come from idx_lookup_ty.
    //
    // The only rows a parent list would exclude are orphans (resources whose parent was deleted), which belong to this CSE and are correctly reported at the root.
    //
    // lvl still needs the skeleton: depth is only known through sk_lvl.
    //
    // cra / crb still need the skeleton: dropping the parent restriction also drops idx_lookup_pi_ty_ct (pi, ty, ct), leaving idx_lookup_ty(ty) with ct filtered on rows.
    //
    // A lbl request without ty still needs the skeleton for the same reason: the like_filter_without_ty path relies on idx_lookup_pi_notcin (pi, not_cin), whose leading column is pi.
    var root_ri = '/' + (global.usecsebase || '');
    var has_ct_bound = (query.cra != null) || (query.crb != null);
    var whole_tree = (ri === root_ri) && (max_lvl === null) &&
                     !has_ct_bound && !like_filter_without_ty(query);

    if (whole_tree) {
        // One statement without parent restriction. Batching exists to bound the IN list, and here there is no list.
        return fetch_batch(0, ALL_PARENTS);
    }

    var skel = build_skeleton_sql(ri, query, budget_left());
    facade.run(facade.raw(skel.sql, skel.bindings), connection, function (err, res) {
        if (err) { return bail(res); }

        // With lvl, nodes of the last level cannot be parents. The recursive guard s.sk_lvl < max_lvl already bounds the skeleton depth, so only one level is removed here.
        var srows = res || [];
        for (var i = 0; i < srows.length; i++) {
            if (max_lvl !== null && Number(srows[i].sk_lvl) > max_lvl) { continue; }
            parents.push(srows[i].sk_ri);
        }

        // No parents (unknown ri, or everything trimmed by lvl): nothing more to ask the DB.
        if (parents.length === 0) { return finish(); }

        next_batch(0);
    });

    function next_batch(start) {
        if (settled) { return; }
        // The limit is filled: remaining batches are not sent (early exit).
        if (need === 0) { return finish(); }
        if (start >= parents.length) { return finish(); }

        // Almost no budget left: the server would abort a statement with such a small MAX_EXECUTION_TIME immediately, so the round trip is skipped.
        var left = budget_left();
        if (left < MIN_BATCH_BUDGET_MS) { return out_of_budget(); }

        var batch = parents.slice(start, start + batch_size);

        // ── Offset consumption ──
        // With a remaining offset, count this batch first (bounded by limit skip+1).
        //   count <= skip   the whole batch is skipped without fetching rows
        //   count >  skip   fetch this batch with skip rows skipped inside it
        // The bound is required; an unbounded count scans every candidate.
        if (skip > 0) {
            var cq = build_children_sql(batch, query, search, 0, left, 0, skip + 1);
            if (cq === null) { return finish(); }
            return facade.run(facade.raw(cq.sql, cq.bindings), connection,
                function (err, res) {
                    if (err) { return bail(res); }
                    var n = (res && res[0] && Number(res[0].n)) || 0;
                    if (n <= skip) {
                        // The whole batch is inside the offset; skip it without fetching rows.
                        skip -= n;
                        return next_batch(start + batch_size);
                    }
                    fetch_batch(start, batch);
                });
        }

        fetch_batch(start, batch);
    }

    function fetch_batch(start, batch) {
        if (settled) { return; }
        var left = budget_left();
        if (left < MIN_BATCH_BUDGET_MS) { return out_of_budget(); }

        var q = build_children_sql(batch, query, search, need, left, skip);
        if (q === null) { return finish(); }

        facade.run(facade.raw(q.sql, q.bindings), connection, function (err, res) {
            if (err) { return bail(res); }
            // The offset is used up in this batch; following batches start from the beginning.
            skip = 0;
            var rows = res || [];
            for (var j = 0; j < rows.length && need > 0; j++) {
                found_Obj[rows[j].ri] = rows[j];
                taken++;
                need--;
            }
            next_batch(start + batch_size);
        });
    }
};

// Selects one child under a parent, filtered by type, at either end of creation order. Used by la / ol.
//
// The sort key is (ct, ri): ct has second resolution, so ri breaks ties (auto-generated rn are fixed width, so lexical order is creation order; mobius/rid.js). The (pi, ty, ct) index on both backends serves order by ct desc, ri desc limit 1 from the index end.
function select_edge_resource(connection, parent_ri, child_ty, direction, outObj, callback) {
    var table = responder.typeRsrc[child_ty];
    if (!table) {
        // Unknown type: no table to query; treated as an empty result.
        callback('200');
        return;
    }

    // ty is int on MySQL and INTEGER on SQLite; it is passed as a string and converted by the column type on both.
    var inner = facade.k('lookup')
        .select('*')
        .where({ pi: parent_ri, ty: String(child_ty) })
        .orderBy([{ column: 'ct', order: direction }, { column: 'ri', order: direction }])
        .limit(1);

    var qb = facade.k(inner.as('b'))
        .select('*')
        .join(table + ' as a', 'b.ri', 'a.ri');

    facade.run(qb, connection, function (err, rows) {
        if (err) {
            callback('500-1');
            return;
        }
        if (rows && rows.length > 0) {
            outObj.push(rows[0]);
        }
        callback('200');
    });
}

// loop_count is unused; the argument stays because the caller (app.js) still passes 0.
exports.select_latest_resource = function (connection, parentObj, loop_count, latestObj, callback) {
    var child_ty = parseInt(parentObj.ty, 10) + 1;
    select_edge_resource(connection, parentObj.ri, child_ty, 'desc', latestObj,
        function (code) {
            callback(code);
        });
};

// Twin of select_latest_resource with the opposite sort direction.
exports.select_oldest_resource = function (connection, ty, ri, oldestObj, callback) {
    select_edge_resource(connection, ri, parseInt(ty, 10), 'asc', oldestObj,
        function (code) {
            callback(code);
        });
};

exports.select_lookup = function (connection, ri, callback) {
    facade.run(facade.k('lookup').select('*').where({ ri: ri }), connection, callback);
};

exports.select_ri_lookup = function (connection, ri, callback) {
    facade.run(facade.k('lookup').select('ri', 'sri').where({ ri: ri }), connection,
        function (err, results) {
            callback(err, results);
        });
};


exports.select_acp = function (connection, ri, callback) {
    facade.run(facade.k('acp').select('*').where({ ri: ri }), connection, callback);
};

exports.select_acp_cnt = function (connection, loop, uri_arr, callback) {
    var pi = '';

    for (var idx in uri_arr) {
        if (uri_arr.hasOwnProperty(idx)) {
            if (uri_arr[idx] != '') {
                if (idx < uri_arr.length - (loop + 1)) {
                    pi += '/' + uri_arr[idx];
                }
            }
        }
    }

    // A row with broken acpi falls back to an empty list instead of failing the request.
    facade.run(facade.k('lookup').select('acpi', 'ty').where({ ri: pi }), connection,
        function (err, results) {
            if (err) {
                callback(err, results && results.message);
                return;
            }

            if (results.length === 0) {
                callback(err, results);
                return;
            }

            try {
                results[0].acpi = JSON.parse(results[0].acpi);
            } catch (e) {
                results[0].acpi = [];
            }

            if (results[0].acpi.length === 0 && results[0].ty == '3') {
                _this.select_acp_cnt(connection, ++loop, uri_arr, callback);
                return;
            }

            // The third argument tells which ancestor the acpi was found on, so an inherited decision can be traced. Existing callers take two arguments.
            callback(err, results[0].acpi, pi);
        });
};

// acpi comes from the client, so the IN list is bound per element. The order is fixed by ORDER BY: security.js stops evaluating at an ACP whose pv has no acr, so the evaluation order changes the result.
exports.select_acp_in = function (connection, acpiList, callback) {
    facade.run(facade.k('acp').select('*').whereIn('ri', acpiList || []).orderBy('ri', 'asc'),
        connection, callback);
};


exports.select_cb = function (connection, ri, callback) {
    facade.run(facade.k('cb').select('*').where({ ri: ri }), connection, function (err, results_cb) {
        callback(err, results_cb);
    });
};

// Reads the parent container's counters and limits in one query: cnt(cni, cbs, mni, mbs) and lookup(st), both a single primary-key row.
exports.select_cni_parent = function (connection, ri, callback) {
    var qb = facade.k('cnt')
        .join('lookup', 'lookup.ri', 'cnt.ri')
        .select('cnt.cni', 'cnt.cbs', 'cnt.mni', 'cnt.mbs', 'lookup.st')
        .where('cnt.ri', ri);

    facade.run(qb, connection, callback);
};


// Deletes the oldest children of one container. Called only by the primary's purge_sweep.
//
// Order: measure -> decide -> delete. Stored values (cnt.cni/cbs) never decide whether to delete; they can exceed the real count because delete_lookup_et and delete_descendants_background remove lookup rows without decrementing cnt, and a lookup delete cascades irreversibly to the cin body.
//
// The measurement reads only the cin_ri_idx(pi, ri, cs) covering index.
//
// No transaction and no SELECT ... FOR UPDATE: there is a single purger (get_cni_count no longer purges), so no row lock is needed and the algorithm is the same on every backend.
function delete_oldest(connection, obj, count, callback) {
    var del_id = 'delete_oldest (' + count + ') ' + obj.ri + ' - ' + require('shortid').generate() + '';
    console.time(del_id);

    var child_ty = String(parseInt(obj.ty, 10) + 1);
    var mni = parseInt(obj.mni, 10);
    var mbs = parseInt(obj.mbs, 10);

    function done(err, n) {
        console.timeEnd(del_id);
        callback(err, n);
    }

    // Unknown limits delete nothing: without a limit 'excess' is undefined. mni / mbs that are NULL or not numbers become NaN and take this path.
    if (!isFinite(mni) || !isFinite(mbs)) {
        console.error('[delete_oldest] 한도를 모른다 — 지우지 않는다 ri=' + obj.ri +
                      ' mni=' + obj.mni + ' mbs=' + obj.mbs);
        return done(null, 0);
    }

    // 1) Measure. Only this value decides the deletion.
    facade.run(facade.k('cin')
        .count('* as n')
        .sum({ s: facade.raw('coalesce(cs, 0)') })
        .where({ pi: obj.ri }), connection, function (err0, rc) {

        if (err0 || !rc || !rc.length) {
            console.error('[delete_oldest] 실측 실패 ri=' + obj.ri + ' — 아무것도 지우지 않는다');
            return done(err0 || true, rc);
        }

        var actual_cni = parseInt(rc[0].n || 0, 10);
        var actual_cbs = parseInt(rc[0].s || 0, 10);

        // 2) Within the limits: delete nothing. If the stored values disagree, fix them from the measurement (drift self-healing).
        if (actual_cni <= mni && actual_cbs <= mbs) {
            facade.run(facade.k('cnt')
                .update({ cni: actual_cni, cbs: actual_cbs })
                .where({ ri: obj.ri })
                .andWhere(function () {
                    this.whereNot('cni', actual_cni).orWhereNot('cbs', actual_cbs);
                }), connection, function (eh, rh) {
                if (eh) {
                    // If the correction fails the stored value stays inflated and select_over_limit picks this container again on the next sweep; logged so the cause can be seen.
                    console.error('[delete_oldest] 드리프트 보정 실패 ri=' + obj.ri +
                                  ' : ' + ((rh && rh.message) || rh));
                }
                else if (rh && rh.affectedRows) {
                    console.log('[delete_oldest] 이미 한도 안 — 드리프트만 보정했다 ri=' +
                                obj.ri + ' cni->' + actual_cni + ' cbs->' + actual_cbs);
                }
                done(null, 0);
            });
            return;
        }

        // 3) Plan again from the measurement. The count purge_sweep derived from stored values is only an upper bound.
        var plan = _this.purge_plan(actual_cni, actual_cbs, mni, mbs);
        var need_cnt = plan.need_cnt;
        var need_cs = plan.need_cs;
        var candidates = plan.candidates;
        if (candidates < 1) { candidates = 1; }
        if (candidates > count) { candidates = count; }

        // 4) Pick candidates. ct can tie, so ri breaks ties; otherwise LIMIT could return a different set from the one counted.
        facade.run(facade.k('lookup as l')
            .leftJoin('cin as c', 'l.ri', 'c.ri')
            .select('l.ri as ri', 'c.cs as cs')
            .where({ 'l.pi': obj.ri, 'l.ty': child_ty })
            .orderBy([{ column: 'l.ct', order: 'asc' }, { column: 'l.ri', order: 'asc' }])
            .limit(candidates), connection, function (err, rows) {

            if (err) { return done(err, rows); }
            if (!rows || rows.length === 0) { return done(null, 0); }

            // 5) Trim to what is needed: stop where both the count and the size condition are satisfied. est_count is an average-based estimate and over-estimates when actual sizes are below average.
            var total_cs = 0;
            var del_ri = [];
            for (var i = 0; i < rows.length; i++) {
                total_cs += parseInt(rows[i].cs || 0, 10);
                del_ri.push(rows[i].ri);
                if (del_ri.length >= need_cnt && total_cs >= need_cs) { break; }
            }
            if (del_ri.length === 0) { return done(null, 0); }

            // 6) Delete exactly the set that was counted; it is not re-selected.
            facade.run(facade.k('lookup').whereIn('ri', del_ri).del(),
                connection, function (err2, res2) {
                if (err2) { return done(err2, res2); }

                var deleted = del_ri.length;

                // 7) Counters are absolute values derived from the measurement, not relative decrements, so accumulated drift heals on every purge.
                //
                // Accepted inaccuracy: an increment from a concurrent CIN creation (update_parent_counters) landing between the measurement and this assignment is overwritten. The error is on the safe side (the stored value becomes smaller, so less is deleted, not more); the next sweep does not see it because select_over_limit selects by stored values, and reconcile_cnt_counters corrects it.
                var new_cni = actual_cni - deleted;
                var new_cbs = actual_cbs - total_cs;
                if (new_cni < 0) { new_cni = 0; }
                if (new_cbs < 0) { new_cbs = 0; }   // cbs is bigint unsigned

                facade.run(facade.k('cnt')
                    .update({ cni: new_cni, cbs: new_cbs })
                    .where({ ri: obj.ri }), connection, function (err4, r4) {
                    if (err4) {
                        console.error('[delete_oldest] cnt 보정 실패 ri=' + obj.ri +
                                      ' : ' + ((r4 && r4.message) || r4));
                    }

                    // Children were removed, so the parent's stateTag goes up. A failure is logged: a client holding a cached copy would otherwise miss the change.
                    facade.run(facade.k('lookup')
                        .update({ st: facade.raw('st + 1') })
                        .where({ ri: obj.ri }), connection, function (err5, r5) {
                        if (err5) {
                            console.error('[delete_oldest] st 갱신 실패 ri=' + obj.ri +
                                          ' : ' + ((r5 && r5.message) || r5));
                        }
                        done(null, deleted);
                    });
                });
            });
        });
    });
}


exports.select_in_ri_list = function (connection, tbl, ri_list, ri_index, found_Obj, loop_cnt, callback) {
    var cur_ri = [];

    for (var idx = 0; idx < 8; idx++) {
        if (ri_index < ri_list.length) {
            cur_ri.push(ri_list[ri_index++]);
        }
        else {
            break;
        }
    }

    // The IN list is bound per element (whereIn), quoted per dialect. tbl comes from responder.typeRsrc (internal), and the builder quotes the identifier.
    facade.run(facade.k(tbl).select('*').whereIn('ri', cur_ri), connection, function (err, search_Obj) {
        if (!err) {
            for (var i = 0; i < search_Obj.length; i++) {
                found_Obj.push(search_Obj[i]);
            }

            if (ri_index >= ri_list.length) {
                callback(err, found_Obj);
            }
            else {
                setTimeout(function () {
                    _this.select_in_ri_list(connection, tbl, ri_list, ri_index, found_Obj, loop_cnt, function (err, found_Obj) {
                        callback(err, found_Obj);
                    });
                }, 0);
            }
        }
        else {
            callback(err, search_Obj);
        }
    });
};

exports.update_cb_poa_csi = function (connection, poa, csi, srt, ri, callback) {
    console.time('update_cb_poa_csi ' + ri);
    facade.run(facade.k('cb').update({ poa: poa, csi: csi, srt: srt }).where({ ri: ri }),
        connection, function (err, results) {
            console.timeEnd('update_cb_poa_csi ' + ri);
            callback(err, results);
        });
};


// subl is not written here or anywhere else: notification routing reads the sub table (select_subs_by_pi) and the column was dropped by migration 015.
exports.update_lookup = function (connection, obj, callback) {
    facade.run(facade.k('lookup').update({
        lt: obj.lt,
        acpi: JSON.stringify(obj.acpi),
        et: obj.et,
        st: obj.st,
        lbl: JSON.stringify(obj.lbl),
        at: JSON.stringify(obj.at),
        aa: JSON.stringify(obj.aa)
    }).where({ ri: obj.ri }), connection, function (err, results) {
        callback(err, results);
    });
};


// lookup and acp are updated in one transaction; a half-applied update would leave resource metadata and access policy out of step.
exports.update_acp = function (connection, obj, callback) {
    facade.transaction(connection, function (conn, finish) {
        _this.update_lookup(conn, obj, function (err, results) {
            if (err) { return finish(err, results); }

            facade.run(facade.k('acp').update({
                pv: JSON.stringify(obj.pv),
                pvs: JSON.stringify(obj.pvs)
            }).where({ ri: obj.ri }), conn, function (err2, results2) {
                finish(err2, err2 ? results2 : results);
            });
        });
    }, function (err, results) {
        if (!err) {
        }
        callback(err, results);
    });
};

exports.update_ae = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            facade.run(facade.k('ae').where({ ri: obj.ri }).update({
                apn: obj.apn,
                poa: JSON.stringify(obj.poa || []),
                or: obj.or,
                rr: obj.rr
            }), connection, function (uerr, ures) {
                callback(uerr, ures);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_cnt = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            facade.run(facade.k('cnt').where({ ri: obj.ri }).update({
                mni: obj.mni,
                mbs: obj.mbs,
                mia: obj.mia,
                li: obj.li,
                or: obj.or,
                cni: obj.cni,
                cbs: obj.cbs
            }), connection, function (uerr, ures) {
                callback(uerr, ures);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_grp = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            facade.run(facade.k('grp').update({
                mnm: obj.mnm,
                mid: JSON.stringify(obj.mid),
                macp: JSON.stringify(obj.macp),
                gn: obj.gn
            }).where({ ri: obj.ri }), connection, function (err2, results2) {
                if (!err2) {
                }
                callback(err2, results2);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_lcp = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            facade.run(facade.k('lcp').update({ lou: obj.lou, lon: obj.lon })
                .where({ ri: obj.ri }), connection, function (err2, results2) {
                if (!err2) {
                }
                callback(err2, results2);
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_fcnt = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            callback(err, results);
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_dooLk = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ lock: obj.lock }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_bat = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ lvl: obj.lvl }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_tempe = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ curT0: obj.curT0 }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_binSh = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ powerSe: obj.powerSe }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_fauDn = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ sus: obj.sus }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_colSn = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ colSn: obj.colSn }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_brigs = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ brigs: obj.brigs }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

exports.update_hd_color = function (connection, obj, callback) {
    _this.update_lookup(connection, obj, function (err, results) {
        if (!err) {
            var qb2 = facade.k('fcnt').update({ red: obj.red, green: obj.green, blue: obj.blue }).where({ ri: obj.ri });
            facade.run(qb2, connection, function (err, results) {
                if (!err) {
                    callback(err, results);
                }
                else {
                    callback(err, results);
                }
            });
        }
        else {
            callback(err, results);
        }
    });
};

// ---------------------------------------------------------------------------
// Update of resources whose body lives in a single table.
//
// Counterpart of BODY_TABLES: update lookup -> update the body table. There is no rollback: a failed body UPDATE leaves lookup's lt/st changed.
//
// The column list differs from creation: creation writes all columns, update only the mutable ones (mgo's mgd/objs/obps are written at creation only), hence a separate table.
//
//   [table, columns to set (space separated), columns stored as JSON]
var BODY_UPDATES = {
    update_fwr: ['mgo', 'dc vr fwnnam url ud uds', 'uds'],
    update_bat: ['mgo', 'dc btl bts'],
    update_dvi: ['mgo', 'dc dbl man mod dty fwv swv hwv'],
    update_dvc: ['mgo', 'dc can att cas cus ena dis', 'cas'],
    update_rbo: ['mgo', 'dc rbo far'],
    update_nod: ['nod', 'ni mgca'],
    update_csr: ['csr', 'poa mei tri rr nl', 'poa'],
    update_smd: ['smd', 'dsp dcrp soe rels or', 'rels'],
    update_mms: ['mms', 'stid asd osd sst']
};

function make_body_update(name, table, cols, json_cols) {
    return function (connection, obj, callback) {

        _this.update_lookup(connection, obj, function (err, results) {
            if (err) {
                callback(err, results);
                return;
            }

            var row = {};
            cols.forEach(function (c) {
                // Unlike creation, no || [] default: an attribute that was not sent must not be overwritten with an empty array.
                if (json_cols.indexOf(c) >= 0) {
                    row[c] = JSON.stringify(obj[c]);
                    return;
                }
                // undefined / null are stored as an empty string as at creation; the builder would send NULL and fail on NOT NULL columns.
                row[c] = (obj[c] === undefined || obj[c] === null) ? '' : obj[c];
            });

            facade.run(facade.k(table).update(row).where({ ri: obj.ri }), connection,
                function (err2, results2) {
                    callback(err2, results2);
                });
        });
    };
}

Object.keys(BODY_UPDATES).forEach(function (name) {
    var t = BODY_UPDATES[name];
    exports[name] = make_body_update(
        name, t[0], t[1].split(' '), (t[2] || '').split(' ').filter(Boolean));
});
// ---------------------------------------------------------------------------

exports.update_sub = function (connection, obj, callback) {
    facade.transaction(connection, function (conn, finish) {
        _this.update_lookup(conn, obj, function (err, results) {
            if (err) { return finish(err, results); }

            facade.run(facade.k('sub').update({
                enc: JSON.stringify(obj.enc),
                exc: obj.exc,
                nu: JSON.stringify(obj.nu),
                gpi: obj.gpi,
                nfu: obj.nfu,
                bn: JSON.stringify(obj.bn),
                rl: obj.rl,
                pn: obj.pn,
                nsp: obj.nsp,
                ln: obj.ln,
                nct: obj.nct,
                nec: obj.nec
            }).where({ ri: obj.ri }), conn, function (err2, results2) {
                finish(err2, err2 ? results2 : results);
            });
        });
    }, function (err, results) {
        if (!err) {
        }
        callback(err, results);
    });
};

exports.update_cnt_cni = function (connection, obj, callback) {

    var qb = facade.k('cnt')
        .update({ cni: obj.cni, cbs: obj.cbs })
        .where({ ri: obj.ri });

    facade.run(qb, connection, function (err, results) {
        if (!err) {
        }
        callback(err, results);
    });
};

// Reconciles stored cni / cbs with the actual cin aggregates.
//
// Paths that do not decrement the counters (background subtree delete, expiry sweep, process interruption, direct DB edits) can cause drift.
//
// Design:
// 1. Cursor-based: each call checks limit containers from cursor on and returns nextCursor.
// 2. No join: each container is aggregated with a literal pi, which uses the cin_ri_idx(pi, ri, cs) covering index.
// 3. Time budget: one call stops at budgetMs and hands the rest to the cursor.
// 4. Per-container cap: (a) each aggregate gets aggTimeoutMs, tightened by the remaining budget, (b) containers whose stored cni exceeds maxCni are skipped and deferred, (c) failures and deferrals are reported so the admin console can handle them separately.
//
//    aggTimeoutMs is a server-side hint (db.statementTimeoutHint): a driver timeout would kill the connection and fail every following container. SQLite has no such hint, so no cap applies there. maxCni works on both backends.
//
// opts: { limit, cursor, budgetMs, aggTimeoutMs, maxCni }
// callback: (err, { checked, fixed, failed, failedRis, deferred, deferredRis,
//               nextCursor, done })
//   done=false means calling again with nextCursor continues.
exports.reconcile_cnt_counters = function (connection, opts, callback) {
    // The former signature (connection, limit, callback) is accepted too.
    if (typeof opts === 'number') { opts = { limit: opts }; }
    opts = opts || {};

    var limit = opts.limit || 200;
    var cursor = opts.cursor || '';
    var budgetMs = (opts.budgetMs === undefined) ? 30000 : opts.budgetMs;
    // Time allowed for one container's aggregate. 0 disables the cap.
    var aggTimeoutMs = (opts.aggTimeoutMs === undefined) ? 5000 : opts.aggTimeoutMs;
    // Containers whose stored cni exceeds this are deferred instead of aggregated. 0 aggregates all.
    var maxCni = (opts.maxCni === undefined) ? 1000000 : opts.maxCni;

    var rec_id = 'reconcile_cnt_counters - ' + require('shortid').generate();
    console.time(rec_id);
    var started = Date.now();

    var batch = facade.k('cnt')
        .select('ri', 'cni', 'cbs')
        .where('ri', '>', cursor)
        .orderBy('ri', 'asc')
        .limit(limit);

    facade.run(batch, connection, function (err, rows) {
        if (err) {
            console.timeEnd(rec_id);
            callback(err, rows);
            return;
        }

        // A non-array from the adapter would pass the loop check and throw at rows[0].ri before the callback; the contract is made explicit here.
        rows = Array.isArray(rows) ? rows : [];
        var idx = 0;
        var fixed = 0;
        var failed = [];      // containers whose aggregate failed (timeout etc.)
        var deferred = [];    // containers skipped because they exceed maxCni
        var lastRi = cursor;

        // finish does not call the callback; it only stores the result. The callback is called outside the trampoline (see pump below), so an exception thrown by the caller is not recorded as this loop's fault.
        var result = null;

        function finish(outOfBudget) {
            // console.timeEnd is called only at the trampoline's single exit; calling it here too would consume the label twice.
            if (fixed > 0 || failed.length > 0 || deferred.length > 0) {
                console.log('[reconcile_cnt_counters] ' + idx + '건 확인, ' + fixed + '건 교정' +
                            (failed.length ? ', ' + failed.length + '건 실패' : '') +
                            (deferred.length ? ', ' + deferred.length + '건 유예(대형)' : ''));
            }
            result = {
                checked: idx,
                fixed: fixed,
                failed: failed.length,
                failedRis: failed,
                deferred: deferred.length,
                deferredRis: deferred,
                nextCursor: lastRi,
                // A full batch or an exhausted budget means more remains.
                done: !outOfBudget && rows.length < limit
            };
        }

        // Do not start when the remaining budget cannot cover one container; an aggregate started with a few ms left would be recorded as a failure although it was merely out of time.
        var MIN_SLICE_MS = 200;
        // budgetMs: 0 means 'no time left' (stop before the first container), not 'no budget'. null disables the budget.
        var hasBudget = (budgetMs !== null && budgetMs !== undefined);

        // ── Trampoline ──
        //
        // A callback that returns synchronously would turn this loop into recursion: mysql2 calls the command callback in place (without process.nextTick) once the connection is closed, so next() would run the following row on the same stack and grow it by several frames per row until RangeError, losing the callback altogether.
        //
        // The trampoline takes a synchronous return as a flag and keeps the stack constant. The asynchronous (normal) path gains no extra tick.
        //
        // The cost is that on a dead connection the remaining rows are processed within one tick, blocking the event loop for that time (the primary is the accept loop). If the limit is raised substantially, add a yield point (setImmediate every N rows).
        var pumping = false;
        var again = false;

        function next() {
            if (pumping) { again = true; return; }   // synchronous re-entry: only raise the flag
            pumping = true;
            var thrown = null;
            do {
                again = false;
                try { step(); }
                catch (e) { thrown = e; break; }
            } while (again && result === null);
            pumping = false;

            // The callback is called outside the loop; inside, an exception thrown by the caller would be recorded as this loop's fault (LOOP_THREW).
            if (thrown) {
                console.timeEnd(rec_id);
                // Returned as an error instead of thrown, so the caller can release its latch. This net covers only exceptions thrown inside step(); an exception thrown inside an asynchronously delivered driver callback is outside it.
                return callback(true, { code: 'LOOP_THREW', message: thrown.message,
                                        stack: thrown.stack });
            }
            if (result !== null) {
                console.timeEnd(rec_id);
                var r = result;
                result = null;
                return callback(null, r);
            }
        }

        function step() {
            if (idx >= rows.length) { return finish(false); }
            if (hasBudget && (Date.now() - started) >= Math.max(0, budgetMs - MIN_SLICE_MS)) {
                return finish(true);
            }

            var row = rows[idx++];
            lastRi = row.ri;

            // A container too large to aggregate within the budget is skipped and reported. The gate uses the stored cni, which is the value under suspicion; a stored value that is too small passes the gate and is then caught by aggTimeoutMs.
            if (maxCni && (parseInt(row.cni, 10) || 0) > maxCni) {
                deferred.push(row.ri);
                // This branch has no asynchronous call, so plain recursion would grow the stack (limit is 2000); setImmediate also yields the event loop to traffic.
                return setImmediate(next);
            }

            // Aggregate with a literal pi; reads only the cin_ri_idx(pi, ri, cs) covering index.
            var agg = facade.k('cin')
                .count('* as n')
                .sum('cs as s')
                .where({ pi: row.ri });

            // The aggregate cap cannot exceed the remaining budget, or the last container would overrun it.
            //
            // The cap is a server-side hint. A driver timeout (run's opts.timeoutMs) would kill the connection on the first hit and fail every remaining container with PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR; the server hint aborts only that statement and keeps the connection.
            if (aggTimeoutMs) {
                var remain = hasBudget ? (budgetMs - (Date.now() - started)) : 0;
                var capMs = (remain > 0 && remain < aggTimeoutMs) ? remain : aggTimeoutMs;
                // facade.withStatementTimeout applies the cap; whether the backend has such a hint is the adapter's knowledge, not the core's.
                agg = facade.withStatementTimeout(agg, capMs);
            }

            facade.run(agg, connection, function (aerr, ares) {
                if (aerr) {
                    failed.push(row.ri);
                    console.error('[reconcile_cnt_counters] 집계 실패 ri=' + row.ri + ': ' +
                                  ((ares && (ares.driverCode || ares.code)) || ares));
                    return next();
                }

                var a = (ares && ares[0]) || {};
                var real_cni = parseInt(a.n || 0, 10);
                var real_cbs = parseInt(a.s || 0, 10);

                if (parseInt(row.cni, 10) === real_cni &&
                    parseInt(row.cbs, 10) === real_cbs) {
                    return next();
                }

                console.log('[reconcile_cnt_counters] drift ri=' + row.ri +
                            ' cni ' + row.cni + '->' + real_cni +
                            ' cbs ' + row.cbs + '->' + real_cbs);

                _this.update_cnt_cni(connection,
                    { ri: row.ri, cni: real_cni, cbs: real_cbs },
                    function (uerr, ures) {
                        if (uerr) {
                            console.error('[reconcile_cnt_counters] 교정 실패 ri=' + row.ri + ': ' +
                                          ((ures && (ures.driverCode || ures.code)) || ures));
                        }
                        else {
                            fixed++;
                        }
                        next();
                    });
            });
        }

        next();
    });
};

// One round of the retention sweep: finds containers over their limits and deletes their oldest children.
//
// Runs on the primary only (app.js). A single purger is what lets delete_oldest work without locks.
//
// A container is not fully purged in one round; at most MAX_PURGE_PER_PASS rows are deleted per round and the next round continues. Delete I/O is the bound, so larger passes would only delay other containers.
exports.purge_sweep = function (connection, opts, callback) {
    var o = opts || {};
    var limit = o.limit || 100;
    var report = { scanned: 0, purged: 0, deleted: 0, failed: 0 };

    // Called after each container is finished, so the watchdog measures 'time since the last progress' rather than the length of a whole round (purge has no budget, so a round has no upper bound).
    //
    // The hook is wrapped so it cannot prevent settlement: one of the two call sites (inside the delete_oldest callback) is reached by neither the trampoline's try nor app.js's try; an exception there would leave the callback uncalled. Same convention as release_quietly in app.js.
    var raw_progress = (typeof o.onProgress === 'function') ? o.onProgress : null;
    var onProgress = raw_progress && function (ri) {
        try { raw_progress(ri); }
        catch (e) { console.error('[purge_sweep] onProgress 실패: ' + e.message); }
    };

    _this.select_over_limit(connection, limit, function (err, rows) {
        if (err) { return callback(err, rows); }
        // The contract is made explicit as in reconcile: a non-array would pass the length check and throw at rows[0].
        rows = Array.isArray(rows) ? rows : [];
        report.scanned = rows.length;
        if (!rows.length) { return callback(null, report); }

        var i = 0;
        var result = null;

        // ── Trampoline ──
        //
        // Same device as in reconcile_cnt_counters and for the same reason: a dead connection returns callbacks synchronously (mysql2's _addCommandClosedState), which would turn this loop into recursion. The stack stays constant whatever limit app.js passes.
        var pumping = false;
        var again = false;

        function next() {
            if (pumping) { again = true; return; }
            pumping = true;
            var thrown = null;
            do {
                again = false;
                try { step(); }
                catch (e) { thrown = e; break; }
            } while (again && result === null);
            pumping = false;

            // The callback is called outside the loop, so a caller's exception is not recorded as the loop's fault.
            if (thrown) {
                return callback(true, { code: 'LOOP_THREW', message: thrown.message,
                                        stack: thrown.stack });
            }
            if (result !== null) {
                var rep = result;
                result = null;
                return callback(null, rep);
            }
        }

        function step() {
            if (i >= rows.length) { result = report; return; }
            var r = rows[i];
            i++;

            // On the SQLite schema these five columns are TEXT and arrive as strings; they are converted so purge_plan's comparisons and subtraction are numeric.
            var cni = parseInt(r.cni || 0, 10);
            var cbs = parseInt(r.cbs || 0, 10);

            // No || 0 for the limits: a NULL mni turned into 0 would mean 'limit 0', i.e. delete every child. NaN makes delete_oldest treat the limit as unknown and delete nothing.
            var mni = parseInt(r.mni, 10);
            var mbs = parseInt(r.mbs, 10);
            if (!isFinite(mni) || !isFinite(mbs)) {
                report.failed++;
                console.error('[purge_sweep] 한도가 비어 있다 — 건너뛴다 ri=' + r.ri +
                              ' mni=' + r.mni + ' mbs=' + r.mbs);
                if (onProgress) { onProgress(r.ri); }
                return next();
            }

            var plan = _this.purge_plan(cni, cbs, mni, mbs);
            var count = plan.est_count < 1 ? 1 : plan.est_count;

            console.log('[purge_sweep] ri=' + r.ri + ' cni=' + cni + '/' + mni +
                        ' cbs=' + cbs + '/' + mbs + ' -> 최대 ' + count + '건');

            // mni / mbs are passed along. delete_oldest measures against them and deletes nothing when the container is within limits; the cni / cbs above are stored values that may exceed reality, and count is only an upper bound.
            delete_oldest(connection, { ri: r.ri, ty: r.ty, mni: mni, mbs: mbs },
                count, function (e, deleted) {
                if (e) {
                    report.failed++;
                    console.error('[purge_sweep] 실패 ri=' + r.ri + ' : ' +
                                  ((deleted && deleted.message) || deleted));
                } else if (deleted) {
                    report.purged++;
                    report.deleted += deleted;
                }
                if (onProgress) { onProgress(r.ri); }
                next();
            });
        }

        next();
    });
};

// Containers over their limits. cnt is scanned in full; the table is small.
//
// ty is not in cnt, only in lookup; delete_oldest derives the child type as ty+1, so it is fetched through the join (cnt.ri references lookup.ri, 1:1).
//
// The comparison is wrapped in numericExpr: on MySQL cni / mni are bigint, but on the SQLite schema they are TEXT and cni > mni would compare lexically.
exports.select_over_limit = function (connection, limit, callback) {
    var n = parseInt(limit, 10);
    if (!(n > 0)) { n = 100; }

    var num = function (col) { return facade.numericExpr(col); };

    facade.run(facade.k('cnt')
        .join('lookup', 'lookup.ri', 'cnt.ri')
        .select('cnt.ri as ri', 'lookup.ty as ty',
                'cnt.cni as cni', 'cnt.cbs as cbs',
                'cnt.mni as mni', 'cnt.mbs as mbs')
        .where(function () {
            this.whereRaw(num('cnt.cni') + ' > ' + num('cnt.mni'))
                .orWhereRaw(num('cnt.cbs') + ' > ' + num('cnt.mbs'));
        })
        .limit(n), connection, callback);
};

// After a CIN is created: increments the parent cnt's cni / cbs and the lookup st, two statements in one transaction so a failure between them cannot leave cni raised and st unchanged. MySQL runs BEGIN/COMMIT; SQLite runs the body without one.
exports.update_parent_counters = function (connection, pi, cs, callback) {
    var n = (typeof cs === 'number' && isFinite(cs)) ? cs : 0;

    facade.transaction(connection, function (conn, finish) {
        facade.run(facade.k('cnt').update({
            cni: facade.raw('cni + 1'),
            cbs: facade.raw('cbs + ?', [n])
        }).where({ ri: pi }), conn, function (err, results) {
            if (err) { return finish(err, results); }

            // A child was created, so the parent's stateTag goes up, only when the cnt row exists (the same condition as the UPDATE above, so the two cannot diverge).
            facade.run(facade.k('lookup')
                .update({ st: facade.raw('st + 1') })
                .where({ ri: pi })
                .whereExists(facade.k('cnt').select('*').whereRaw('cnt.ri = ?', [pi])),
                conn, function (err2, r2) {
                finish(err2, err2 ? r2 : results);
            });
        });
    }, function (err, results) {
        if (err) {
            // The CIN is already stored even if the counters are off; the request is not failed. reconcile corrects the counters from a measurement.
            console.error('[update_parent_counters] 부모 갱신 실패 pi=' + pi +
                          ' : ' + ((results && results.message) || results));
        }
        callback(err, results);
    });
};

// Raises lookup.st only when the ri exists in the type table; tableName is used in the condition (EXISTS subquery), not in SET.
exports.update_parent_st = function (connection, obj, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];

    var qb = facade.k('lookup')
        .update({ st: facade.raw('st + 1') })
        .where({ ri: obj.ri })
        .whereExists(facade.k(tableName).select('*').whereRaw('??.?? = ?', [tableName, 'ri', obj.ri]));

    facade.run(qb, connection, function (err, results) {
        if (!err) {
        }
        callback(err, results);
    });
};

// Decrements the parent's cni / cbs and raises its st, two statements in one transaction. MySQL runs BEGIN/COMMIT; SQLite runs the body without one.
exports.update_parent_by_delete = function (connection, obj, cs, callback) {
    var tableName = responder.typeRsrc[parseInt(obj.ty, 10)];

    facade.transaction(connection, function (conn, finish) {
        var q1 = facade.k(tableName)
            .update({
                cni: facade.raw('cni - 1'),
                cbs: facade.raw('cbs - ?', [cs])
            })
            .where({ ri: obj.ri });

        facade.run(q1, conn, function (err1, r1) {
            if (err1) { return finish(err1, r1); }

            var q2 = facade.k('lookup')
                .update({ st: facade.raw('st + 1') })
                .where({ ri: obj.ri });

            facade.run(q2, conn, function (err2, r2) {
                finish(err2, err2 ? r2 : r1);
            });
        });
    }, function (err, results) {
        if (!err) {
        }
        callback(err, results);
    });
};

exports.delete_ri_lookup = function (connection, ri, callback) {
    facade.run(facade.k('lookup').where({ ri: ri }).del(), connection, callback);
};


function delete_lookup_action(connection, pi_list, req_count, callback) {
    if (pi_list.length <= req_count) {
        callback('200');
        return;
    }

    var pi = pi_list[req_count];

    // The facade normalises the result to {affectedRows} on both backends.
    facade.run(facade.k('lookup').where({ pi: pi }).del(), connection,
        function (err, deleted_Obj) {
            if (err) {
                // The driver code is logged: a subtree delete that stops mid-way (deadlock, query timeout, dropped connection) leaves orphans, and this line is the trace.
                console.error('[delete_lookup_action] ' + pi + ' 삭제 실패: ' +
                              ((deleted_Obj && (deleted_Obj.driverCode || deleted_Obj.code)) || '?') +
                              ' / ' + ((deleted_Obj && deleted_Obj.message) || ''));
                callback('500-1');
                return;
            }
            console.log('deleted ' + deleted_Obj.affectedRows + ' resource(s) of ' + pi);
            delete_lookup_action(connection, pi_list, ++req_count, callback);
        });
}

exports.delete_lookup = function (connection, pi_list, pi_index, found_Obj, found_Cnt, callback) {
    var cur_pi = [];
    var batch_start = pi_index;      // needed to report where a failure happened

    for (var idx = 0; idx < 32; idx++) {
        if (pi_index < pi_list.length) {
            cur_pi.push(pi_list[pi_index++]);
        }
        else {
            break;
        }
    }

    delete_lookup_action(connection, cur_pi, 0, function (code) {
        if (code === '200') {
            if (pi_index >= pi_list.length) {
                callback(code);
            }
            else {
                _this.delete_lookup(connection, pi_list, pi_index, found_Obj, found_Cnt, function (err, found_Obj) {
                    callback(err, found_Obj);
                });
            }
        }
        else {
            // A failure in one batch (32) stops without touching the rest. The batch's start index is logged: pi_index has already advanced to the batch end and would overstate progress. Rows before batch_start were deleted; the rest remain as orphans.
            console.error('[delete_lookup] ' + batch_start + '/' + pi_list.length +
                          ' 까지 지우고 다음 배치에서 멈췄다 (code=' + code +
                          '). 나머지는 고아로 남는다.');
            callback(code);
        }
    });
};

// Lists resources whose et has passed. Read-only: the admin UI shows the list and chooses what to delete or extend.
//
// AE(2), CNT(3) and CSEBase(5) are excluded, because deleting them automatically would remove everything below them.
exports.select_expired_resources = function (connection, et, limit, callback) {
    var qb = facade.k('lookup')
        .select('ri', 'ty', 'rn', 'pi', 'et')
        .where('et', '<', et)
        .whereNotIn('ty', [2, 3, 5])
        .orderBy('et', 'asc')
        .limit(limit);

    facade.run(qb, connection, callback);
};

// Expiry query for the admin console. Differs from select_expired_resources in two ways:
//
//  1. No type is excluded. The delete path excludes AE(2) / CNT(3) / CSEBase(5) as a safety measure for automatic deletion; the administrator must still see them.
//  2. Keyset cursor (et, ri): et alone would drop rows sharing the same et at a page boundary.
//
// @param opts.limit   page size
// @param opts.types   ty list to show; empty means all
// @param opts.afterEt / opts.afterRi  last row of the previous page (absent: from the start)
//
// The query has no usable index (the MySQL lookup has no et index), so a time limit is mandatory: the order by requires scanning every qualifying row, and the keyset cursor cannot seek. A proper fix is either a lookup(et) index by migration or dropping the order by in favour of the sibling's cap + capped convention; both are console decisions.
//
// On timeout the facade returns STATEMENT_TIMEOUT; the screen must show 'cannot count now', not an empty list.
var EXPIRED_PAGE_TIMEOUT_MS = 10000;

exports.select_expired_page = function (connection, et, opts, callback) {
    opts = opts || {};
    var limit = opts.limit > 0 ? opts.limit : 50;

    var qb = facade.k('lookup')
        .select('ri', 'ty', 'rn', 'pi', 'et', 'ct', 'lt')
        .where('et', '<', et)
        .orderBy('et', 'asc')
        .orderBy('ri', 'asc')
        .limit(limit + 1);          // +1 only to know whether a next page exists

    // Without an index the worst case is a full scan plus filesort; the time limit keeps it from evicting the buffer pool and stalling discovery.
    qb = facade.withStatementTimeout(qb, EXPIRED_PAGE_TIMEOUT_MS);

    if (opts.types && opts.types.length) {
        qb = qb.whereIn('ty', opts.types);
    }
    if (opts.afterEt) {
        // (et, ri) lexicographic comparison, spelled out because knex has no row-value comparison.
        qb = qb.andWhere(function () {
            this.where('et', '>', opts.afterEt)
                .orWhere(function () {
                    this.where('et', opts.afterEt).andWhere('ri', '>', opts.afterRi || '');
                });
        });
    }

    facade.run(qb, connection, function (err, rows) {
        if (err) { return callback(err, rows); }
        rows = rows || [];
        var more = rows.length > limit;
        if (more) { rows = rows.slice(0, limit); }
        var last = rows.length ? rows[rows.length - 1] : null;
        callback(null, {
            rows: rows,
            more: more,
            nextEt: last ? last.et : null,
            nextRi: last ? last.ri : null
        });
    });
};

// Counts expired resources by type, with a cap: the MySQL lookup has no et index (only SQLite has idx_lookup_et), so an exact count would be a full scan. The screen only needs 'many', so counting stops at limit and reports capped.
//
// Follows count_orphan_lookup's { count, capped } convention.
exports.count_expired_by_type = function (connection, et, limit, callback) {
    if (typeof limit === 'function') { callback = limit; limit = 1000; }
    var cap = limit > 0 ? limit : 1000;

    var qb = facade.k('lookup')
        .select('ty')
        .where('et', '<', et)
        .limit(cap + 1);

    facade.run(qb, connection, function (err, rows) {
        if (err) { return callback(err, rows); }
        rows = rows || [];
        var capped = rows.length > cap;
        if (capped) { rows = rows.slice(0, cap); }

        var by_type = {};
        for (var i = 0; i < rows.length; i++) {
            var ty = String(rows[i].ty);
            by_type[ty] = (by_type[ty] || 0) + 1;
        }
        callback(null, { byType: by_type, count: rows.length, capped: capped });
    });
};

// Deletes expired resources. Not run automatically (no periodic registration in app.js); the administrator checks with select_expired_resources first and then calls this.
//
// Deleting a lookup row removes the type table row (ae/cnt/cin ...) through FK ON DELETE CASCADE; remaining descendants are collected by delete_orphan_lookup.
exports.delete_lookup_et = function (connection, et, limit, callback) {
    var del_id = 'delete_lookup_et - ' + require('shortid').generate();
    console.time(del_id);

    _this.select_expired_resources(connection, et, limit, function (err, rows) {
        if (err) {
            console.timeEnd(del_id);
            callback(err, rows);
            return;
        }

        rows = rows || [];
        if (rows.length === 0) {
            console.timeEnd(del_id);
            callback(null, { deleted: 0, rows: [] });
            return;
        }

        var ri_list = rows.map(function (r) { return r.ri; });

        facade.run(facade.k('lookup').whereIn('ri', ri_list).del(), connection,
            function (derr, dres) {
                console.timeEnd(del_id);
                if (derr) {
                    callback(derr, dres);
                    return;
                }
                console.log('[delete_lookup_et] ' + rows.length + '건 삭제');
                callback(null, { deleted: rows.length, rows: rows });
            });
    });
};


// ── ACP queries (admin console) ──
//
// All read-only: nothing is deleted or modified, only listed; irreversible actions are the administrator's decision on the screen.
//
// lookup.acpi has no index and holds a JSON string, so it cannot be queried in SQL (acpi like '%...%' is a leading wildcard and never used). Reverse references are found by scanning the non-CIN rows by keyset and matching in the application.

var ACP_LIST_MAX = 500;
var ACP_SCAN_BATCH = 2000;
var ACP_SCAN_CAP = 200000;
var ACP_REFS_MAX = 1000;

// Resource types other than CIN. responder.typeRsrc is the single source of the types this CSE handles, so the list is not maintained by hand.
function non_cin_ty_list() {
    var out = [];
    var map = responder.typeRsrc || {};
    Object.keys(map).forEach(function (k) {
        var t = Number(k);
        if (isFinite(t) && t !== 4) { out.push(t); }
    });
    out.sort(function (a, b) { return a - b; });
    return out;
}

exports._non_cin_ty_list = non_cin_ty_list;

/**
 * ACP resource list. ty equality uses idx_lookup_ty.
 *
 * @param opts { limit=100(max 500), afterRi='' }
 * @returns callback(null, { rows:[{ri,pi,rn,ct,lt,et,acpi}], more, nextRi })
 */
exports.select_acp_list = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};
    var limit = Math.min(Math.max(parseInt(o.limit, 10) || 100, 1), ACP_LIST_MAX);
    var after = o.afterRi || '';

    var qb = facade.k('lookup')
        .select('ri', 'pi', 'rn', 'ct', 'lt', 'et', 'acpi')
        .where('ty', 1)
        .where('ri', '>', after)
        .orderBy('ri', 'asc')
        .limit(limit + 1);          // one extra row to decide more

    facade.run(qb, connection, function (err, rows) {
        if (err) { return callback(err, rows); }
        rows = rows || [];
        var more = rows.length > limit;
        if (more) { rows = rows.slice(0, limit); }
        callback(null, {
            rows: rows,
            more: more,
            // ri of the last row returned; using the trimmed limit+1th row would skip one row.
            nextRi: rows.length ? rows[rows.length - 1].ri : null
        });
    });
};

/**
 * Details of one ACP: the lookup row together with the acp body.
 *
 * @returns callback(null, {ri,rn,pi,ct,lt,et,pv,pvs,pv_parsed,pvs_parsed}) or null
 */
exports.select_acp_detail = function (connection, ri, callback) {
    facade.run(facade.k('lookup').select('ri', 'pi', 'rn', 'ty', 'ct', 'lt', 'et', 'acpi').where({ ri: ri }),
        connection, function (err, lrows) {
            if (err) { return callback(err, lrows); }
            if (!lrows || lrows.length === 0) { return callback(null, null); }

            // A non-ACP row is reported as such (is_acp:false) instead of as an ACP without a body.
            if (String(lrows[0].ty) !== '1') {
                var notAcp = lrows[0];
                notAcp.is_acp = false;
                notAcp.pv = null;
                notAcp.pvs = null;
                notAcp.pv_parsed = null;
                notAcp.pvs_parsed = null;
                notAcp.body_missing = false;
                return callback(null, notAcp);
            }

            facade.run(facade.k('acp').select('ri', 'pv', 'pvs').where({ ri: ri }), connection,
                function (err2, arows) {
                    if (err2) { return callback(err2, arows); }
                    var a = (arows && arows[0]) ? arows[0] : { pv: null, pvs: null };
                    var out = lrows[0];
                    out.is_acp = true;
                    out.pv = a.pv;
                    out.pvs = a.pvs;
                    out.pv_parsed = safe_json(a.pv);
                    out.pvs_parsed = safe_json(a.pvs);
                    // No acp row means a half resource left in lookup only; evaluation treats it as 'referenced ACP not found' and the lock silently opens.
                    out.body_missing = !arows || arows.length === 0;
                    callback(null, out);
                });
        });
};

function safe_json(s) {
    if (s === null || s === undefined) { return null; }
    if (typeof s === 'object') { return s; }
    try { return JSON.parse(s); }
    catch (e) { return null; }
}

// Reads a global safely: a bare reference to a missing global throws ReferenceError synchronously. The admin console does not require app.js, so usespid may be absent.
function g(name) {
    return (typeof global[name] === 'string') ? global[name] : '';
}

// Folds an acpi element by the same rules as make_internal_ri. No DB access during the scan (one query per row would be N+1).
function fold_acpi_entry(v) {
    if (typeof v !== 'string') { return null; }
    var spid = g('usespid');
    var cseid = g('usecseid');
    var cb = g('usecsebase');

    if (cseid !== '') {
        if (spid !== '' && v.indexOf(spid + cseid + '/') === 0) {
            return v.replace(spid + cseid + '/', '/');
        }
        if (cb !== '' && v.indexOf(cseid + '/' + cb + '/') === 0) {
            return v.replace(cseid + '/', '/');
        }
    }
    if (cb !== '' && v.indexOf(cb) === 0) { return '/' + v; }
    return v;
}

/**
 * Returns, among the given ri, only those whose acpi is filled.
 *
 * Used by the discovery filter to check ancestors' locks. ri is the primary key (equality IN); the list is the number of distinct ancestors, not rows, so it stays small even for large pages.
 */
exports.select_lookup_acpi_in = function (connection, ri_list, callback) {
    if (!ri_list || ri_list.length === 0) { return callback(null, []); }
    facade.run(facade.k('lookup').select('ri', 'acpi')
        .whereIn('ri', ri_list)
        .whereNot('acpi', '')
        .whereNot('acpi', '[]'),
        connection, callback);
};

// Folds an acpi list into internal ri notation, by the same rules as make_internal_ri but without depending on globals (the admin console does not require app.js).
exports.fold_acpi_list = function (list) {
    return (list || []).map(function (v) {
        var f = fold_acpi_entry(v);
        return f === null ? v : f;
    });
};

exports.acp_ri_context = function () {
    var missing = ['usecsebase', 'usecseid', 'usespid'].filter(function (n) { return g(n) === ''; });
    return { ok: missing.length === 0, missing: missing,
             usecsebase: g('usecsebase'), usecseid: g('usecseid'), usespid: g('usespid') };
};

// Continuation cursor combining type and ri in one value, so a caller cannot pass only the ri and restart the type from 0 (which would rescan the same range forever).
function make_scan_cursor(ty, ri) {
    return String(ty) + '|' + String(ri);
}

function parse_scan_cursor(v) {
    if (typeof v !== 'string' || v === '') { return null; }
    var at = v.indexOf('|');
    if (at < 0) { return null; }
    var ty = Number(v.slice(0, at));
    if (!isFinite(ty)) { return null; }
    return { ty: ty, ri: v.slice(at + 1) };
}

exports._make_scan_cursor = make_scan_cursor;
exports._parse_scan_cursor = parse_scan_cursor;

/**
 * Which resources use this ACP, without a full scan.
 *
 * Deleting an ACP silently opens the resources that referenced it (creator only); this is the impact analysis before deletion.
 *
 * @param opts { acpRi=null(all), tys=null, batch, scanCap, maxRefs, after }
 *        after is the previous result.next, passed as is. Never split it.
 * @returns callback(null, { refs, refsTruncated, byAcp, scanned, capped,
 *                           broken, unresolved, next })
 *          next is set only when capped; otherwise the scan is complete.
 */
exports.scan_acpi_refs = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};

    // A split cursor is rejected explicitly instead of silently rescanning from the start.
    if (o.afterRi !== undefined || o.afterTy !== undefined) {
        return callback(true, { code: 'BAD_CURSOR',
            message: 'afterRi / afterTy 는 더 쓰지 않는다. result.next 를 after 로 그대로 넘긴다' });
    }
    var cursor = null;
    if (o.after !== undefined && o.after !== null && o.after !== '') {
        cursor = parse_scan_cursor(o.after);
        if (cursor === null) {
            return callback(true, { code: 'BAD_CURSOR', message: '이어보기 커서를 읽을 수 없다: ' + o.after });
        }
    }

    var target = o.acpRi ? fold_acpi_entry(o.acpRi) : null;
    var batch = Math.min(Math.max(parseInt(o.batch, 10) || ACP_SCAN_BATCH, 1), 10000);
    var cap = parseInt(o.scanCap, 10) || ACP_SCAN_CAP;
    var maxRefs = parseInt(o.maxRefs, 10) || ACP_REFS_MAX;

    var refs = [];
    var byAcp = {};
    var unresolved = {};
    var scanned = 0;
    var broken = 0;
    var truncated = false;

    // Scanned per type with equality. A bare not_cin predicate uses no index (idx_lookup_pi_notcin leads with pi, and PRIMARY is (pi, ri, ty)), which amounts to a full traversal; ty equality uses idx_lookup_ty, and the non-CIN rows are few, so the type list is walked with a keyset per type.
    var ty_list = (Array.isArray(o.tys) && o.tys.length > 0)
        ? o.tys.map(Number).filter(function (t) { return t !== 4; })
        : non_cin_ty_list();
    var ty_at = 0;

    function scan(after) {
        if (ty_at >= ty_list.length) { return done(null); }

        var qb = facade.k('lookup')
            .select('ri', 'ty', 'pi', 'rn', 'acpi')
            .where('ty', ty_list[ty_at])
            .where('ri', '>', after)
            .orderBy('ri', 'asc')
            .limit(batch);

        facade.run(qb, connection, function (err, rows) {
            if (err) { return callback(err, rows); }
            rows = rows || [];
            if (rows.length === 0) {
                // This type is finished; the next type starts from the beginning.
                ty_at++;
                return setImmediate(scan, '');
            }

            var next = rows[rows.length - 1].ri;
            for (var i = 0; i < rows.length; i++) {
                scanned++;
                var raw = rows[i].acpi;
                if (raw === null || raw === undefined || raw === '' || raw === '[]') { continue; }

                var list = safe_json(raw);
                if (!Array.isArray(list)) { broken++; continue; }

                var folded = [];
                var hit = (target === null);
                for (var j = 0; j < list.length; j++) {
                    var f = fold_acpi_entry(list[j]);
                    if (f === null) { broken++; continue; }
                    if (f.charAt(0) !== '/') { unresolved[f] = 1; }
                    folded.push(f);
                    if (target !== null && f === target) { hit = true; }
                }
                if (!hit || folded.length === 0) { continue; }

                for (var k = 0; k < folded.length; k++) {
                    byAcp[folded[k]] = (byAcp[folded[k]] || 0) + 1;
                }
                if (refs.length < maxRefs) {
                    refs.push({ ri: rows[i].ri, ty: rows[i].ty, rn: rows[i].rn, pi: rows[i].pi,
                                acpi: folded, raw: String(raw),
                                normalized: JSON.stringify(folded) === String(raw) });
                }
                else {
                    truncated = true;
                }
            }

            if (scanned >= cap) { return done(next, true); }
            setImmediate(scan, next);
        });
    }

    function done(next, capped) {
        callback(null, {
            refs: refs,
            refsTruncated: truncated,
            byAcp: byAcp,
            scanned: scanned,
            capped: !!capped,
            broken: broken,
            unresolved: Object.keys(unresolved),
            // Type and ri are handed back as one value; a splittable cursor would eventually be split and rescan the same range forever.
            next: (capped && ty_list[ty_at] !== undefined)
                ? make_scan_cursor(ty_list[ty_at], next) : null
        });
    }

    if (cursor === null) {
        scan('');
        return;
    }
    var at = ty_list.indexOf(cursor.ty);
    if (at < 0) {
        // The cursor's type is not in the list (tys changed, or the type disappeared). Rescanning silently from the start would keep the caller's continuation loop from ending.
        return callback(true, { code: 'BAD_CURSOR',
            message: '커서의 타입 ' + cursor.ty + ' 가 이번 스캔 대상에 없다' });
    }
    ty_at = at;
    scan(cursor.ri);
};

/** Resolves acpi elements written in sri notation to internal ri; for scan_acpi_refs's unresolved list. */
exports.resolve_acpi_entries = function (connection, entries, callback) {
    var list = (entries || []).filter(function (e) { return typeof e === 'string'; });
    if (list.length === 0) { return callback(null, { map: {} }); }

    facade.run(facade.k('lookup').select('ri', 'sri').whereIn('sri', list), connection,
        function (err, rows) {
            if (err) { return callback(err, rows); }
            var bySri = {};
            (rows || []).forEach(function (r) { bySri[r.sri] = r.ri; });
            var map = {};
            list.forEach(function (e) { map[e] = bySri[e] || null; });
            callback(null, { map: map });
        });
};

/** Group macp references. fanOutPoint is authorised by grp.macp, not acpi, so the reference check before deleting an ACP must include groups. macp is mediumtext, so the acpi element limit does not apply. */
exports.scan_macp_refs = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var target = (opts && opts.acpRi) ? fold_acpi_entry(opts.acpRi) : null;

    facade.run(facade.k('grp').select('ri', 'macp'), connection, function (err, rows) {
        if (err) { return callback(err, rows); }
        var refs = [];
        var byAcp = {};
        var broken = 0;

        (rows || []).forEach(function (r) {
            var list = safe_json(r.macp);
            if (!Array.isArray(list)) {
                if (r.macp !== null && r.macp !== undefined && r.macp !== '') { broken++; }
                return;
            }
            var folded = [];
            var hit = (target === null);
            list.forEach(function (v) {
                var f = fold_acpi_entry(v);
                if (f === null) { broken++; return; }
                folded.push(f);
                if (target !== null && f === target) { hit = true; }
            });
            if (!hit || folded.length === 0) { return; }
            folded.forEach(function (f) { byAcp[f] = (byAcp[f] || 0) + 1; });
            refs.push({ ri: r.ri, macp: folded });
        });

        callback(null, { refs: refs, byAcp: byAcp, broken: broken });
    });
};

// ── ACP change history ──
//
// The acp table has no cr column and a changed acpi loses its old value, so the history is recorded here.
//
// Writes are best-effort: a failed history insert does not fail the request.

var AUDIT_LIST_MAX = 200;

/**
 * @param entry { op, ri, ty, origin, cr, before, after }
 *        op is 'acpi_set' | 'acp_create' | 'acp_update' | 'acp_delete'
 */
exports.insert_acp_audit = function (connection, entry, callback) {
    var cb = callback || function () {};
    if (global.acp_audit === 'off') { return cb(null); }

    var e = entry || {};
    var row;
    try {
        row = {
            ts: moment().utc().format('YYYYMMDDTHHmmss'),
            op: String(e.op || ''),
            ri: String(e.ri || ''),
            ty: parseInt(e.ty, 10) || 0,
            origin: e.origin === undefined ? null : String(e.origin),
            cr: e.cr === undefined || e.cr === null ? null : String(e.cr),
            before_val: e.before === undefined ? null : JSON.stringify(e.before),
            after_val: e.after === undefined ? null : JSON.stringify(e.after)
        };
    }
    catch (ex) {
        console.error('[acp_audit] 항목을 만들 수 없다: ' + (ex.message || ex));
        return cb(null);
    }

    facade.run(facade.k('acp_audit').insert(row), connection, function (err, res) {
        if (err) {
            // The table is absent before migration 007; the request is still processed normally.
            console.error('[acp_audit] 이력을 남기지 못했다 (' + row.op + ' ' + row.ri + '): ' +
                ((res && res.message) || ''));
        }
        cb(null);
    });
};

/**
 * @param opts { ri=null, op=null, limit=50(max 200), afterId=null }
 * @returns callback(null, { rows, more, nextId })
 */
exports.select_acp_audit = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};
    var limit = Math.min(Math.max(parseInt(o.limit, 10) || 50, 1), AUDIT_LIST_MAX);

    var qb = facade.k('acp_audit')
        .select('id', 'ts', 'op', 'ri', 'ty', 'origin', 'cr', 'before_val', 'after_val')
        .orderBy('id', 'desc')
        .limit(limit + 1);
    if (o.ri) { qb = qb.where({ ri: o.ri }); }
    if (o.op) { qb = qb.where({ op: o.op }); }
    // Newest first, so the cursor is 'id smaller than this'.
    if (o.afterId) { qb = qb.where('id', '<', o.afterId); }

    facade.run(qb, connection, function (err, rows) {
        if (err) { return callback(err, rows); }
        rows = rows || [];
        var more = rows.length > limit;
        if (more) { rows = rows.slice(0, limit); }
        rows.forEach(function (r) {
            r.before = safe_json(r.before_val);
            r.after = safe_json(r.after_val);
            if (r.before === null && r.before_val !== null) { r.before = r.before_val; }
            if (r.after === null && r.after_val !== null) { r.after = r.after_val; }
        });
        callback(null, {
            rows: rows,
            more: more,
            nextId: rows.length ? rows[rows.length - 1].id : null
        });
    });
};

/**
 * Deletes old history. Not run automatically; the administrator calls it.
 * @param opts { beforeTs, limit=1000 }
 */
exports.prune_acp_audit = function (connection, opts, callback) {
    var o = opts || {};
    if (!o.beforeTs) {
        return callback(true, { message: 'beforeTs 가 필요하다 — 전체 삭제를 실수로 부르지 않게 한다' });
    }
    var limit = Math.min(Math.max(parseInt(o.limit, 10) || 1000, 1), 100000);
    facade.run(facade.k('acp_audit').where('ts', '<', o.beforeTs).limit(limit).del(),
        connection, function (err, res) {
            if (err) { return callback(err, res); }
            callback(null, { deleted: (res && res.affectedRows) || 0 });
        });
};

/**
 * Counts orphan rows. Changes nothing.
 *
 * delete_orphan_lookup scans the whole lookup over several passes; this lets the administrator see whether there is anything to delete first, like select_expired_resources for the expiry sweep. Counting is a full scan as well, but a single pass.
 *
 * @param {number} limit  stop counting above this number and return it; 0 or absent counts to the end.
 * @returns callback(err, { count, capped }); capped means there are more
 */
exports.count_orphan_lookup = function (connection, limit, callback) {
    if (typeof limit === 'function') { callback = limit; limit = 0; }
    var BATCH = 5000;
    var total = 0;

    function scan(last_ri) {
        var qb = facade.k('lookup')
            .select('ri', 'pi')
            .where('ri', '>', last_ri)
            .whereNot('pi', '')          // the CSEBase has an empty pi and is excluded
            .orderBy('ri', 'asc')
            .limit(BATCH);

        facade.run(qb, connection, function (err, rows) {
            if (err) { return callback(err, rows); }
            rows = rows || [];
            if (!rows.length) { return callback(null, { count: total, capped: false }); }

            var next_ri = rows[rows.length - 1].ri;
            var pi_set = {};
            for (var i = 0; i < rows.length; i++) { pi_set[rows[i].pi] = 1; }

            facade.run(facade.k('lookup').select('ri').whereIn('ri', Object.keys(pi_set)), connection,
                function (err2, prows) {
                    if (err2) { return callback(err2, prows); }
                    var exists = {};
                    prows = prows || [];
                    for (var j = 0; j < prows.length; j++) { exists[prows[j].ri] = 1; }
                    for (var k = 0; k < rows.length; k++) {
                        if (!exists[rows[k].pi]) { total++; }
                    }
                    if (limit > 0 && total >= limit) {
                        return callback(null, { count: total, capped: true });
                    }
                    setImmediate(scan, next_ri);
                });
        });
    }

    scan('');
};

/**
 * Returns orphan rows as a list. Changes nothing.
 *
 * count_orphan_lookup answers only 'how many'; the list shows what the orphans are (remains of an interrupted subtree delete, old accumulation, concentration under one AE).
 *
 * No join: as in count_orphan_lookup the scan advances by ri keyset and checks parent existence per batch with a literal whereIn.
 *
 * @param opts.limit    maximum rows to return
 * @param opts.afterRi  last ri of the previous page (absent: from the start)
 * @param opts.scanCap  maximum rows to scan; with few orphans a page could otherwise run to the end of the table. When reached, scanCapped=true.
 * @returns callback(err, { rows, more, nextRi, scanned, scanCapped })
 */
exports.select_orphan_page = function (connection, opts, callback) {
    opts = opts || {};
    var limit = opts.limit > 0 ? opts.limit : 50;
    var scan_cap = opts.scanCap > 0 ? opts.scanCap : 200000;
    var BATCH = 5000;

    var found = [];
    var scanned = 0;
    var last_seen = opts.afterRi || '';

    function scan(last_ri) {
        var qb = facade.k('lookup')
            .select('ri', 'pi', 'ty', 'rn', 'ct', 'lt', 'et')
            .where('ri', '>', last_ri)
            .whereNot('pi', '')          // the CSEBase has an empty pi and is excluded
            .orderBy('ri', 'asc')
            .limit(BATCH);

        facade.run(qb, connection, function (err, rows) {
            if (err) { return callback(err, rows); }
            rows = rows || [];
            if (!rows.length) {
                return callback(null, {
                    rows: found, more: false, nextRi: null,
                    scanned: scanned, scanCapped: false
                });
            }

            var next_ri = rows[rows.length - 1].ri;
            var pi_set = {};
            for (var i = 0; i < rows.length; i++) { pi_set[rows[i].pi] = 1; }

            facade.run(facade.k('lookup').select('ri').whereIn('ri', Object.keys(pi_set)), connection,
                function (err2, prows) {
                    if (err2) { return callback(err2, prows); }
                    var exists = {};
                    prows = prows || [];
                    for (var j = 0; j < prows.length; j++) { exists[prows[j].ri] = 1; }

                    for (var k = 0; k < rows.length; k++) {
                        scanned++;
                        last_seen = rows[k].ri;
                        if (exists[rows[k].pi]) { continue; }
                        found.push(rows[k]);
                        if (found.length > limit) {
                            // The limit+1th row was found, so a next page exists; this row is discarded, not returned.
                            found.pop();
                            // The cursor is the last row returned, not the discarded one: last_seen holds the discarded row's ri, and a cursor there would make the next page start after it and skip it forever.
                            return callback(null, {
                                rows: found, more: true,
                                nextRi: found[found.length - 1].ri,
                                scanned: scanned, scanCapped: false
                            });
                        }
                    }

                    if (scanned >= scan_cap) {
                        return callback(null, {
                            rows: found, more: found.length >= limit, nextRi: last_seen,
                            scanned: scanned, scanCapped: true
                        });
                    }
                    setImmediate(scan, next_ri);
                });
        });
    }

    scan(last_seen);
};

// Deletes orphan rows (rows whose pi is not in lookup, left by a crash during an asynchronous subtree delete). Not run automatically (no periodic registration in app.js); the administrator checks with count_orphan_lookup first.
//
// Scans by ri keyset in batches of 5000 and checks parent existence per batch with a PK IN query; every statement is an index range read and the event loop is released between batches. Multi-level orphans (a child whose parent was deleted in the same pass) are caught by the next pass; passes repeat while deletions occur.
exports.delete_orphan_lookup = function (connection, callback) {
    var BATCH = 5000;
    var grand_total = 0;

    function run_pass(pass_deleted, last_ri, pass_done) {
        // The CSEBase has an empty pi; it is not an orphan and is excluded.
        var scan = facade.k('lookup')
            .select('ri', 'pi')
            .where('ri', '>', last_ri)
            .whereNot('pi', '')
            .orderBy('ri', 'asc')
            .limit(BATCH);

        facade.run(scan, connection, function (err, rows) {
            if (err) {
                console.error('[delete_orphan_lookup] scan error:', rows);
                callback(rows);
                return;
            }
            rows = rows || [];
            if (!rows.length) {
                pass_done(pass_deleted);
                return;
            }
            var next_ri = rows[rows.length - 1].ri;
            var pi_set = {};
            for (var i = 0; i < rows.length; i++) { pi_set[rows[i].pi] = 1; }
            var pi_list = Object.keys(pi_set);

            facade.run(facade.k('lookup').select('ri').whereIn('ri', pi_list), connection,
                function (err2, prows) {
                    if (err2) {
                        console.error('[delete_orphan_lookup] parent check error:', prows);
                        callback(prows);
                        return;
                    }
                    prows = prows || [];
                    var exists = {};
                    for (var j = 0; j < prows.length; j++) { exists[prows[j].ri] = 1; }
                    var orphans = rows.filter(function (r) { return !exists[r.pi]; })
                        .map(function (r) { return r.ri; });
                    if (!orphans.length) {
                        setImmediate(run_pass, pass_deleted, next_ri, pass_done);
                        return;
                    }
                    facade.run(facade.k('lookup').whereIn('ri', orphans).del(), connection,
                        function (err3, dres) {
                            if (err3) {
                                console.error('[delete_orphan_lookup] delete error:', dres);
                                callback(dres);
                                return;
                            }
                            // The facade normalises both backends to affectedRows.
                            var n = (dres && dres.affectedRows) || 0;
                            grand_total += n;
                            console.log('[delete_orphan_lookup] deleted ' + n + ' orphan row(s)');
                            setImmediate(run_pass, pass_deleted + n, next_ri, pass_done);
                        });
                });
        });
    }

    (function next_pass() {
        run_pass(0, '', function (deleted_in_pass) {
            if (deleted_in_pass > 0) {
                next_pass();
            }
            else {
                if (grand_total > 0) console.log('[delete_orphan_lookup] done, total ' + grand_total + ' row(s)');
                callback(null);
            }
        });
    })();
};

exports.select_sum_cbs = function (connection, callback) {
    // The aggregate column name (sum(cbs)) goes into the response as is, so the SQL is kept raw instead of the builder.
    facade.run(facade.raw('select sum(cbs) from cnt'), connection, function (err, result_Obj) {
        callback(err, result_Obj);
    });
};

exports.select_sum_ae = function (connection, callback) {
    // The aggregate column name (count(*)) goes into the response as is, so the SQL is kept raw instead of the builder.
    facade.run(facade.raw('select count(*) from ae'), connection, function (err, result_Obj) {
        callback(err, result_Obj);
    });
};

/*
 * ─── Subscription reachability audit ───
 *
 * Finds subscriptions whose receiver is gone. Read-only.
 *
 * The notification path (sgn.js) makes the same decision on every send but only logs it, and only when a notification actually fires. This reproduces the decision offline, without sending, so the admin UI can build the list without waiting for notifications.
 *
 * ── Not done here
 *
 * Subscriptions whose et has passed are not classified as undeliverable: et is not enforced anywhere at runtime, so most of them are delivering normally. Expiry is handled separately by select_expired_resources.
 *
 * ── subl is not consulted
 *
 * Delivery reads the same source as this audit: lookup(ty=23) + sub (select_subs_by_pi). There is no copy.
 */

// Finding reasons, given as codes so the admin UI can group them.
var SUB_AUDIT_REASON = {
    NO_SUB_ROW:    'no_sub_row',      // lookup has ty=23 but no sub row
    NU_EMPTY:      'nu_empty',        // nu is empty or unreadable
    NU_UNRESOLVED: 'nu_unresolved',   // ID form, but the resource does not exist (the receiver is gone)
    NU_NO_POA:     'nu_no_poa',       // the resource exists but has no address to send to
    NU_BAD_SCHEME: 'nu_bad_scheme',   // not http/https/coap/ws/mqtt
    MQTT_TOPIC_UNREGISTERED: 'mqtt_topic_unregistered'  // the topic's AE-ID is not registered
};
exports.SUB_AUDIT_REASON = SUB_AUDIT_REASON;

/**
 * Confidence grade of a reason.
 *
 *   broken   undeliverable by itself; the evidence is complete within the DB.
 *   suspect  probably undeliverable, but the DB alone cannot prove it.
 *            Must not be listed as a deletion candidate directly.
 *
 * An admin UI that mixes the two would delete working subscriptions.
 */
var SUB_AUDIT_SEVERITY = {
    no_sub_row:               'broken',
    nu_empty:                 'broken',
    nu_unresolved:            'broken',
    nu_no_poa:                'broken',
    nu_bad_scheme:            'broken',
    // A client may listen on an MQTT topic without registering as an AE. A missing registration is a strong signal but not proof; MQTT 3.1.1 gives the publisher no way to know whether a subscriber exists.
    mqtt_topic_unregistered:  'suspect'
};
exports.SUB_AUDIT_SEVERITY = SUB_AUDIT_SEVERITY;

var SUB_AUDIT_BATCH = 500;
var SUB_AUDIT_CAP = 20000;
var SUB_AUDIT_MAX_FINDINGS = 2000;
var SUB_NU_SCHEMES = ['http:', 'https:', 'coap:', 'ws:', 'mqtt:'];

function parse_json_array(raw) {
    if (Array.isArray(raw)) { return raw; }
    if (raw === null || raw === undefined || raw === '') { return []; }
    try {
        var v = JSON.parse(raw);
        return Array.isArray(v) ? v : null;
    }
    catch (e) { return null; }
}

/**
 * Finds subscriptions that cannot be notified. No DB writes.
 *
 * @param opts { batch, scanCap, maxFindings, after, targets }
 *        after is the previous result.next, passed as is.
 * @returns callback(null, {
 *            findings: [{ ri, pi, nu, reason, severity, detail }],
 *            findingsTruncated, scanned, capped, byReason, bySeverity, next })
 *          next is null when the scan is complete.
 *
 * severity is decided by SUB_AUDIT_SEVERITY: broken / suspect. Only broken goes on the deletion candidate list; the reader (admin console) must not define its own criterion, or core and console would disagree on which subscriptions may be deleted.
 */
exports.audit_subscriptions = function (connection, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    var o = opts || {};

    var batch = Math.min(Math.max(parseInt(o.batch, 10) || SUB_AUDIT_BATCH, 1), 5000);
    var cap = parseInt(o.scanCap, 10) || SUB_AUDIT_CAP;
    var maxFindings = parseInt(o.maxFindings, 10) || SUB_AUDIT_MAX_FINDINGS;
    var after = (o.after === undefined || o.after === null) ? '' : String(o.after);

    // targets: report only subscriptions pointing at these resources.
    //
    // Used by the admin UI before deleting an AE to ask 'whose notifications stop if this is deleted'. nu values are mostly URL form, so ID matching alone is not enough; the AE-ID of mqtt topics (mqtt://host/<AE-ID>) is matched as well.
    var targets = null;
    if (Array.isArray(o.targets) && o.targets.length > 0) {
        targets = {};
        o.targets.forEach(function (t) {
            var s = String(t);
            targets[s] = true;
            // Match whether the target is given as a structured path or as an ID.
            var tail = s.split('/').filter(Boolean).pop();
            if (tail) { targets[tail] = true; }
        });
    }

    // Whether this finding matches targets; without targets everything passes.
    function inTargets(hit) {
        if (targets === null) { return true; }
        for (var i = 0; i < hit.length; i++) {
            if (hit[i] && targets[hit[i]]) { return true; }
        }
        return false;
    }

    var findings = [];
    var byReason = {};
    var bySeverity = {};
    var scanned = 0;
    var truncated = false;

    // hit: the candidate targets this finding points at (structured path / AE-ID etc.); the targets filter is decided on these.
    function note(ri, pi, nu, reason, detail, hit) {
        if (!inTargets(hit || [])) { return; }
        var sev = SUB_AUDIT_SEVERITY[reason] || 'broken';
        byReason[reason] = (byReason[reason] || 0) + 1;
        bySeverity[sev] = (bySeverity[sev] || 0) + 1;
        if (findings.length >= maxFindings) { truncated = true; return; }
        findings.push({ ri: ri, pi: pi, nu: nu, reason: reason,
                        severity: sev, detail: detail || '' });
    }

    function done(next, capped) {
        callback(null, {
            findings: findings,
            findingsTruncated: truncated,
            scanned: scanned,
            capped: !!capped,
            byReason: byReason,
            // broken and suspect are reported separately; mixing them would delete working subscriptions.
            bySeverity: bySeverity,
            // A continuation cursor is given only when the cap was hit; nothing is truncated silently.
            next: capped ? next : null
        });
    }

    // Splits an ID-form nu into the absolute path and its first segment.
    //
    // Same method as get_nu_arr in sgn.js, so the decisions agree. Resolution is two-step: the first segment (sri) finds the resource's ri, which replaces the head of the path, and the full path then finds the target.
    function split_id_nu(nu) {
        var s = String(nu);
        s = s.replace(usespid + usecseid + '/', '/');
        s = s.replace(usecseid + '/', '/');
        if (s.charAt(0) !== '/') { s = '/' + s; }
        var parts = s.split('/');
        return { abs: s, head: (parts[1] || '').split('?')[0] };
    }

    function classify(found, pending, next) {
        pending.forEach(function (p) {
            var target = found[p.target_path];
            if (!target) {
                // This is the 'receiver is gone' subscription: when an AE deregisters, every subscription with that AE as nu lands here.
                note(p.ri, p.pi, p.nu, SUB_AUDIT_REASON.NU_UNRESOLVED, '대상: ' + p.target_path,
                     [p.target_path, p.head]);
                return;
            }
            if (!POA_TABLE[String(target.ty)]) {
                // A type other than AE/CSEBase/remoteCSE has no poa at all; a configuration mistake such as a container written as nu lands here.
                note(p.ri, p.pi, p.nu, SUB_AUDIT_REASON.NU_NO_POA,
                     '대상 ty=' + target.ty + ' 는 poa 를 갖지 않는다');
                return;
            }
            var poa = poa_util.parse(target.poa, '[audit] ' + target.ri);
            if (poa === null || poa.length === 0) {
                note(p.ri, p.pi, p.nu, SUB_AUDIT_REASON.NU_NO_POA, '대상: ' + target.ri,
                     [target.ri, target.sri]);
            }
        });
        next();
    }

    // Extracts the AE-ID sgn_man uses for the topic from an mqtt nu.
    //
    // Same method as sgn_man.request_noti_mqtt so the decisions agree:
    //   var aeid = url.parse(nu).pathname.replace('/', '').split('?')[0];
    // Only the first slash is removed; a value with a remaining slash goes into the AE-ID position as is.
    function mqtt_topic_id(parsed) {
        if (!parsed.pathname) { return ''; }
        return parsed.pathname.replace('/', '').split('?')[0];
    }

    // Checks in one query whether the topics' AE-IDs are registered AEs.
    function resolve_aeids(wantAei, pendingMqtt, next) {
        var keys = Object.keys(wantAei);
        if (keys.length === 0) { return next(); }

        // ae.aei has a UNIQUE index (aei_UNIQUE in mobiusdb.sql).
        facade.run(facade.k('ae').select('aei').whereIn('aei', keys),
            connection, function (err, rows) {
                if (err) { return callback(true, rows); }

                var known = {};
                (rows || []).forEach(function (r) { known[r.aei] = true; });

                pendingMqtt.forEach(function (p) {
                    if (known[p.topic]) { return; }
                    note(p.ri, p.pi, p.nu, SUB_AUDIT_REASON.MQTT_TOPIC_UNREGISTERED,
                         '토픽 ' + p.topic + ' 로 등록된 AE 가 없다', [p.topic]);
                });
                next();
            });
    }

    // Resolves targets in two steps, batched per page; one query per subscription would cost one round trip each.
    //
    // poa is not in lookup but in the type tables (ae/cb/csr), so one more read follows, as in select_resource_from_url.
    function resolve_targets(want, pending, next) {
        var heads = Object.keys(want);
        if (heads.length === 0) { return next(); }

        // Step 1: the first segment (sri) finds the resource's ri.
        facade.run(facade.k('lookup').select('ri', 'sri').whereIn('sri', heads),
            connection, function (err, head_rows) {
                if (err) { return callback(true, head_rows); }

                var head_ri = {};
                (head_rows || []).forEach(function (r) { head_ri[r.sri] = r.ri; });

                // Step 2: the substituted full path finds the target. When the first segment is not found the path is used as is, as in sgn.js.
                var paths = {};
                pending.forEach(function (p) {
                    var hr = head_ri[p.head];
                    p.target_path = hr ? p.abs.replace('/' + p.head, hr) : p.abs;
                    p.target_path = p.target_path.split('?')[0];
                    paths[p.target_path] = true;
                });

                var keys = Object.keys(paths);
                if (keys.length === 0) { return next(); }

                facade.run(facade.k('lookup').select('ri', 'sri', 'ty').whereIn('ri', keys),
                    connection, function (err2, rows) {
                        if (err2) { return callback(true, rows); }

                        var found = {};
                        (rows || []).forEach(function (r) { found[r.ri] = r; });

                        // Not found by ri: try sri as well, because select_resource_from_url looks at both.
                        var miss = keys.filter(function (k) { return !found[k]; });
                        if (miss.length === 0) { return fetch_poa(found, pending, next); }

                        facade.run(facade.k('lookup').select('ri', 'sri', 'ty').whereIn('sri', miss),
                            connection, function (err3, rows2) {
                                if (err3) { return callback(true, rows2); }
                                (rows2 || []).forEach(function (r) { found[r.sri] = r; });
                                fetch_poa(found, pending, next);
                            });
                    });
            });
    }

    // Only ae(2) / cb(5) / csr(16) carry a poa. Any other type as nu target has no address to send to.
    var POA_TABLE = { '2': 'ae', '5': 'cb', '16': 'csr' };

    function fetch_poa(found, pending, next) {
        var byTable = {};
        Object.keys(found).forEach(function (k) {
            var t = POA_TABLE[String(found[k].ty)];
            if (!t) { return; }              // a type without poa; classify handles it
            if (!byTable[t]) { byTable[t] = []; }
            byTable[t].push(found[k].ri);
        });

        var tables = Object.keys(byTable);
        if (tables.length === 0) { return classify(found, pending, next); }

        var poa_by_ri = {};
        var at = 0;
        (function step() {
            if (at >= tables.length) {
                Object.keys(found).forEach(function (k) {
                    found[k].poa = poa_by_ri[found[k].ri];
                });
                return classify(found, pending, next);
            }
            var t = tables[at++];
            facade.run(facade.k(t).select('ri', 'poa').whereIn('ri', byTable[t]),
                connection, function (err, rows) {
                    if (err) { return callback(true, rows); }
                    (rows || []).forEach(function (r) { poa_by_ri[r.ri] = r.poa; });
                    step();
                });
        })();
    }

    function scan(cursor) {
        // ty equality uses idx_lookup_ty; a leading-wildcard LIKE or a global COUNT(*) would be a full scan.
        var qb = facade.k('lookup')
            .select('ri', 'pi', 'rn', 'ct', 'lt', 'et')
            .where({ ty: 23 })
            .andWhere('ri', '>', cursor)
            .orderBy('ri', 'asc')
            .limit(batch);

        function advance(last_ri) {
            if (scanned >= cap) { return done(last_ri, true); }
            setImmediate(scan, last_ri);
        }

        facade.run(qb, connection, function (err, rows) {
            if (err) { return callback(true, rows); }
            if (!rows || rows.length === 0) { return done(null, false); }

            scanned += rows.length;
            // The cursor is the last row returned; a computed one would be off by one.
            var last = rows[rows.length - 1].ri;
            var ri_list = rows.map(function (r) { return r.ri; });
            var by_ri = {};
            rows.forEach(function (r) { by_ri[r.ri] = r; });

            // sub's primary key is ri, so whereIn uses the index.
            facade.run(facade.k('sub').select('ri', 'nu').whereIn('ri', ri_list),
                connection, function (err2, subs) {
                    if (err2) { return callback(true, subs); }

                    var have = {};
                    (subs || []).forEach(function (s) { have[s.ri] = s; });

                    // Collect what this page has to check; one query per subscription would cost one round trip each.
                    var want = {};          // first segment of ID-form nu
                    var pending = [];
                    var wantAei = {};       // AE-ID of mqtt topics
                    var pendingMqtt = [];

                    ri_list.forEach(function (ri) {
                        var row = by_ri[ri];
                        var s = have[ri];
                        if (!s) {
                            // Does not happen normally because of FK ON DELETE CASCADE; if it does, it is itself worth reporting.
                            note(ri, row.pi, '', SUB_AUDIT_REASON.NO_SUB_ROW, 'sub 행이 없다');
                            return;
                        }
                        var nu_arr = parse_json_array(s.nu);
                        if (nu_arr === null) {
                            note(ri, row.pi, String(s.nu), SUB_AUDIT_REASON.NU_EMPTY, 'nu 를 읽을 수 없다');
                            return;
                        }
                        if (nu_arr.length === 0) {
                            note(ri, row.pi, '', SUB_AUDIT_REASON.NU_EMPTY, 'nu 가 비어 있다');
                            return;
                        }
                        nu_arr.forEach(function (nu) {
                            var parsed = url.parse(String(nu));
                            if (parsed.protocol === null) {
                                // ID form: the target resource has to be checked.
                                var split = split_id_nu(nu);
                                if (split.head === '') {
                                    note(ri, row.pi, nu, SUB_AUDIT_REASON.NU_EMPTY, 'nu 형식을 읽을 수 없다');
                                    return;
                                }
                                want[split.head] = true;
                                pending.push({ ri: ri, pi: row.pi, nu: nu,
                                               head: split.head, abs: split.abs });
                                return;
                            }
                            if (parsed.protocol === 'mqtt:') {
                                // MQTT cannot be judged by the send result (QoS 0, and MQTT 3.1.1 gives the publisher no way to know whether a subscriber exists).
                                //
                                // The DB can check one thing: sgn_man takes the first path segment of nu as the AE-ID and publishes to /oneM2M/req/<cseid>/<AE-ID>/<bodytype>. An unregistered AE-ID probably has no listener.
                                //
                                // Not a proof: a client may listen on the topic without registering as an AE, so the grade is suspect.
                                var topic = mqtt_topic_id(parsed);
                                if (topic === '') {
                                    note(ri, row.pi, nu, SUB_AUDIT_REASON.NU_EMPTY,
                                         'mqtt nu 에 토픽이 없다');
                                    return;
                                }
                                wantAei[topic] = true;
                                pendingMqtt.push({ ri: ri, pi: row.pi, nu: nu, topic: topic });
                                return;
                            }
                            if (SUB_NU_SCHEMES.indexOf(parsed.protocol) < 0) {
                                note(ri, row.pi, nu, SUB_AUDIT_REASON.NU_BAD_SCHEME, parsed.protocol);
                            }
                            // URL form: reachability cannot be known here; the notification result signal ([noti] log) answers that.
                        });
                    });

                    // ID-form check -> mqtt topic check -> next page
                    function afterIds() {
                        if (pendingMqtt.length === 0) { return advance(last); }
                        resolve_aeids(wantAei, pendingMqtt, function () { advance(last); });
                    }
                    if (pending.length === 0) { return afterIds(); }
                    resolve_targets(want, pending, afterIds);
                });
        });
    }

    scan(after);
};
