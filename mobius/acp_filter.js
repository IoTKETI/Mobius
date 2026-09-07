'use strict';
// Filters discovery results by each resource's ACP so that a locked subtree does not leak its paths through a discovery on an ancestor.
//
// The check is cheap: rows already carry acpi (search_lookup selects r.*), ancestors are string prefixes of ri, and the discovery root has already passed the request-level check, so rows that inherit from the root need no evaluation. Only rows whose effective acpi differs from the root's are evaluated, grouped by acpi so each ACP set is read once. cr is available because this runs after select_spec_ri merged the type-specific columns.

var db_sql = require('./sql_action');
var security = require('./security');

// Batch size for ancestor lookups; same as select_spec_ri.
var CHUNK = 500;

// oneM2M DISCOVERY bit.
var DISCOVERY = '32';

function parse_acpi(v) {
    if (Array.isArray(v)) { return v; }
    if (typeof v !== 'string' || v === '' || v === '[]') { return []; }
    try {
        var o = JSON.parse(v);
        return Array.isArray(o) ? o : [];
    }
    catch (e) { return []; }
}

// Same rule as resolve_cr in app.js: ae and remoteCSE have no cr column.
function cr_of(row) {
    if (String(row.ty) === '2') { return row.aei; }
    if (String(row.ty) === '16') { return row.csi; }
    return row.cr;
}

// Returns the ancestor paths between root (exclusive) and ri (exclusive), nearest first. For '/Mobius/ae/a/b' with root '/Mobius/ae' that is ['/Mobius/ae/a'].
function ancestors_under(ri, root) {
    var out = [];
    var at = ri.lastIndexOf('/');
    while (at > 0) {
        var anc = ri.slice(0, at);
        if (anc.length <= root.length) { break; }
        out.push(anc);
        at = anc.lastIndexOf('/');
    }
    return out;
}

/**
 * Removes from foundObj the entries this originator may not discover.
 *
 * Call after select_spec_ri so type-specific columns (cr etc.) are merged in.
 *
 * @param root_ri  the discovery root; already passed the access check
 * @returns callback(null, { kept, removed, evaluated, queries }); failures follow the facade convention callback(true, errObj)
 */
exports.filter_found = function (connection, request, root_ri, foundObj, callback) {
    var stats = { kept: 0, removed: 0, evaluated: 0, queries: 0 };

    if (global.acp_discovery_filter === 'off') {
        stats.kept = Object.keys(foundObj).length;
        return callback(null, stats);
    }

    var from = request.headers ? request.headers['x-m2m-origin'] : undefined;
    var keys = Object.keys(foundObj);
    stats.kept = keys.length;

    if (keys.length === 0) { return callback(null, stats); }
    // The superuser sees no ACP at all; nothing to filter.
    if (from === global.usesuperuser || from === ('/' + global.usesuperuser)) {
        return callback(null, stats);
    }

    // 1) The row's own acpi; only non-empty ones are remembered.
    var own = {};
    var need = {};
    for (var i = 0; i < keys.length; i++) {
        var a = parse_acpi(foundObj[keys[i]].acpi);
        if (a.length > 0) { own[keys[i]] = a; }
    }

    // 2) Rows without own acpi need their ancestors; only ancestors missing from the result are fetched.
    for (var j = 0; j < keys.length; j++) {
        if (own[keys[j]]) { continue; }
        var anc = ancestors_under(keys[j], root_ri);
        for (var k = 0; k < anc.length; k++) {
            if (!foundObj.hasOwnProperty(anc[k])) { need[anc[k]] = 1; }
        }
    }

    var need_list = Object.keys(need);
    fetch_ancestors(need_list, {}, 0, function (errA, ancMap) {
        if (errA) { return callback(errA, ancMap); }
        decide(ancMap);
    });

    // Fetch only ancestors with a non-empty acpi.
    function fetch_ancestors(list, acc, at, cb) {
        if (at >= list.length) { return cb(null, acc); }
        var chunk = list.slice(at, at + CHUNK);
        stats.queries += 1;
        db_sql.select_lookup_acpi_in(connection, chunk, function (err, rows) {
            if (err) { return cb(err, rows); }
            for (var n = 0; n < (rows || []).length; n++) {
                var a = parse_acpi(rows[n].acpi);
                if (a.length > 0) { acc[rows[n].ri] = a; }
            }
            fetch_ancestors(list, acc, at + CHUNK, cb);
        });
    }

    function effective_acpi(ri, ancMap) {
        if (own[ri]) { return own[ri]; }
        var anc = ancestors_under(ri, root_ri);
        for (var n = 0; n < anc.length; n++) {
            if (own[anc[n]]) { return own[anc[n]]; }
            if (ancMap[anc[n]]) { return ancMap[anc[n]]; }
        }
        // Inherits from the root, which already passed; nothing to evaluate.
        return null;
    }

    function decide(ancMap) {
        // 3) Group by effective acpi. Rows with null pass as they are.
        var groups = {};
        for (var n = 0; n < keys.length; n++) {
            var ri = keys[n];
            var eff = effective_acpi(ri, ancMap);
            if (eff === null) { continue; }

            // The creator passes regardless of ACP, as in a direct retrieve.
            if (security._creator_bypasses(foundObj[ri].ty, cr_of(foundObj[ri]), from)) { continue; }

            var key = JSON.stringify(db_sql.fold_acpi_list(eff));
            if (!groups[key]) { groups[key] = { acpi: db_sql.fold_acpi_list(eff), ris: [] }; }
            groups[key].ris.push(ri);
        }

        var gkeys = Object.keys(groups);
        if (gkeys.length === 0) { return callback(null, stats); }

        // 4) Read the ACP rows once per group and evaluate each row with the pure evaluator.
        run_group(gkeys, 0);

        function run_group(list, at) {
            if (at >= list.length) { return callback(null, stats); }
            var g = groups[list[at]];
            stats.queries += 1;
            db_sql.select_acp_in(connection, g.acpi, function (err, acp_rows) {
                if (err) { return callback(err, acp_rows); }

                for (var n = 0; n < g.ris.length; n++) {
                    var ri = g.ris[n];
                    var row = foundObj[ri];
                    stats.evaluated += 1;
                    var v = security._evaluate_acp_rows(
                        acp_rows || [], request, cr_of(row), DISCOVERY, 'pv', true, true);
                    if (v.code !== '1') {
                        delete foundObj[ri];
                        stats.removed += 1;
                        stats.kept -= 1;
                    }
                }
                run_group(list, at + 1);
            });
        }
    }
};

exports._ancestors_under = ancestors_under;
exports._parse_acpi = parse_acpi;
exports._cr_of = cr_of;
