/**
 * Copyright (c) 2016, OCEAN
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

var util = require('util');
var db = require('./db_action');

const max_lim = 1000;

exports.select_csr_like = function(cb, callback) {
    var sql = util.format("select * from csr where ri like \'/%s/%%\'", cb);
    db.getResult(sql, '', function (err, results_csr) {
        if (!Array.isArray(results_csr.poa)) {
            results_csr.poa = [];
        }
        callback(err, results_csr);
    });
};

exports.search_parents = function(ri, callback) {
    console.time('search_parents');
    var sql = util.format("select ri from lookup where (ri =\'%s\' or pi=\'%s\' or pi like \'%s/%%\') and ty != \'4\'", ri, ri, ri);
    db.getResult(sql, '', function (err, result_lookup_ri) {
        console.timeEnd('search_parents');
        callback(err, result_lookup_ri);
    });
};


function build_discovery_sql(ty, lbl, cra, crb, lim, pi_list, callback) {
    var list_ri = '';
    var query_where = '';
    var query_count = 0;
    if(lbl != null) {
        query_where = ' where ';
        if(lbl.toString().split(',')[1] == null) {
            query_where += util.format(' a.lbl like \'%%%s%%\'', lbl);
            //query_where += util.format(' lbl like \'%s\'', request.query.lbl);
        }
        else {
            for(var i = 0; i < lbl.length; i++) {
                query_where += util.format(' a.lbl like \'%%%s%%\'', lbl[i]);
                //query_where += util.format(' lbl like \'%s\'', request.query.lbl[i]);

                if(i < lbl.length-1) {
                    query_where += ' or ';
                }
            }
        }
        query_count++;
    }

    if(ty != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else if(query_count > 0) {
            query_where += ' and ';
        }
        if(ty.toString().split(',')[1] == null) {
            query_where += util.format('a.ty = \'%s\'', ty);
        }
        else {
            for(i = 0; i < ty.length; i++) {
                query_where += util.format('a.ty = \'%s\'', ty[i]);
                if(i < ty.length-1) {
                    query_where += ' or ';
                }
            }
        }
        query_count++;
    }

    if(cra != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else if(query_count > 0) {
            query_where += ' and ';
        }
        query_where += util.format('\'%s\' <= a.ct', cra);
        query_count++;
    }

    if(crb != null) {
        if(query_count == 0) {
            query_where = ' where ';
        }
        else if(query_count > 0) {
            query_where += ' and ';
        }
        query_where += util.format(' a.ct <= \'%s\'', crb);
        query_count++;
    }

    if(lim != null) {
        if(lim > max_lim) {
            lim = max_lim;
        }
        //query_where += util.format(' order by ri desc limit %s', request.query.lim);
        query_where += util.format(' limit %s', lim);
    }
    else {
        //query_where += util.format(' order by ri desc limit 1000');
        query_where += util.format(' limit 1000');
    }

    query_where = util.format("select a.* from (select ri from lookup where pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+") order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri") + query_where;

    return query_where;
}

exports.search_lookup = function (ty, lbl, cra, crb, lim, pi_list, callback) {
    console.time('search_lookup');
    var sql = build_discovery_sql(ty, lbl, cra, crb, lim, pi_list);
    db.getResult(sql, '', function (err, search_Obj) {
        console.timeEnd('search_lookup');
        callback(err, search_Obj);
    });
};
