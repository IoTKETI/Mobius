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

var _this = this;

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

exports.select_csr = function(ri, callback) {
    var sql = util.format("select * from csr where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, results_csr) {
        callback(err, results_csr);
    });
};

exports.search_parents_lookup = function(ri, callback) {
    console.time('search_parents_lookup');
    var sql = util.format("select ri from lookup where (ri =\'%s\' or pi=\'%s\' or pi like \'%s/%%\') and ty != \'4\'", ri, ri, ri);
    db.getResult(sql, '', function (err, result_lookup_ri) {
        console.timeEnd('search_parents_lookup');
        callback(err, result_lookup_ri);
    });
};

function build_discovery_sql(ty, lbl, cra, crb, lim, pi_list, bef_ct, callback) {
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

    var ty_str = '';
    if(ty != null) {
        ty_str = ' and ';
        if(query_count == 0) {
            query_where = ' where ';
        }
        else if(query_count > 0) {
            query_where += ' and ';
        }
        if(ty.toString().split(',')[1] == null) {
            query_where += util.format('a.ty = \'%s\'', ty);
            ty_str += util.format('ty = \'%s\'', ty);
        }
        else {
            for(i = 0; i < ty.length; i++) {
                query_where += util.format('a.ty = \'%s\'', ty[i]);
                ty_str += util.format('ty = \'%s\'', ty[i]);
                if(i < ty.length-1) {
                    query_where += ' or ';
                    ty_str += ' or ';
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

    query_where = util.format("select a.* from (select ri from lookup where pi in ("+JSON.stringify(pi_list).replace('[','').replace(']','')+") %s and ct > \'%s\' order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri", ty_str, bef_ct) + query_where;

    return query_where;
}

exports.search_lookup = function (ty, lbl, cra, crb, lim, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, callback) {
    var cur_pi = [];

    if(loop_cnt == 0) {
        loop_cnt++;
        console.time('search_lookup');
    }

    cur_d.setDate(cur_d.getDate()-(loop_cnt*3));
    var bef_ct = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');

    if(lim != null) {
        if(lim > max_lim) {
            lim = max_lim;
        }
    }
    else {
        lim = 1000;
    }

    for(var j = 0; j < 1; j++) {
        cur_pi.push(pi_list[pi_index++]);
        if(pi_index >= pi_list.length) {
            break;
        }
    }

    var sql = build_discovery_sql(ty, lbl, cra, crb, lim, cur_pi, bef_ct);
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            for(var i = 0; i < search_Obj.length; i++) {
                found_Obj[found_Cnt++] = search_Obj[i];
                if(found_Cnt >= lim) {
                    console.timeEnd('search_lookup');
                    callback(err, found_Obj);
                    return;
                }
            }

            if(pi_index >= pi_list.length) {
                if(loop_cnt > 4) {
                    console.timeEnd('search_lookup');
                    callback(err, found_Obj);
                }
                else {
                    pi_index = 0;
                    loop_cnt++;
                    _this.search_lookup(ty, lbl, cra, crb, lim, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, function (err, found_Obj) {
                        callback(err, found_Obj);
                    });
                }
            }
            else {
                _this.search_lookup(ty, lbl, cra, crb, lim, pi_list, pi_index, found_Obj, found_Cnt, cur_d, loop_cnt, function (err, found_Obj) {
                    callback(err, found_Obj);
                });
            }
        }
    });
};

exports.select_latest_lookup = function(ri, cur_d, loop_cnt, ty, callback) {
    cur_d.setDate(cur_d.getDate()-(loop_cnt*2+1));
    var bef_ct = cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '');

    if(loop_cnt++ == 0) {
        console.time('select_latest');
    }

    var sql = util.format('select a.* from (select ri from lookup where (pi = \'%s\') and ct > \'%s\' order by ct desc limit 1000) b left join lookup as a on b.ri = a.ri where a.ty = \'%s\' limit 1', ri, bef_ct, ty);
    db.getResult(sql, '', function (err, latest_Obj) {
        if(!err) {
            if(latest_Obj.length == 1) {
                console.timeEnd('select_latest');
                callback(err, latest_Obj);
            }
            else {
                if(loop_cnt > 8) {
                    callback(err, latest_Obj);
                }
                else {
                    _this.select_latest_lookup(ri, cur_d, loop_cnt, ty, function(err, latest_Obj) {
                        callback(err, latest_Obj);
                    });
                }
            }
        }
        else {
            console.timeEnd('select_latest');
            callback(err, latest_Obj);
        }
    });
};

exports.select_oldest_lookup = function(ri, callback) {
    console.time('select_oldest');
    var sql = util.format('select a.* from (select ri from lookup where (pi = \'%s\') limit 1000) b left join lookup as a on b.ri = a.ri where a.ty = \'4\' or a.ty = \'26\' limit 1', ri);
    db.getResult(sql, '', function (err, oldest_Obj) {
        console.timeEnd('select_oldest');
        callback(err, oldest_Obj);
    });
};

exports.select_direct_lookup = function(ri, callback) {
    console.time('select_direct');
    var sql = util.format("select * from lookup where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, direct_Obj) {
        console.timeEnd('select_direct');
        callback(err, direct_Obj);
    });
};

exports.select_grp_lookup = function(ri, callback) {
    console.time('select_group');
    var sql = util.format("select * from lookup where ri = \'%s\' and ty = '9'", ri);
    db.getResult(sql, '', function (err, group_Obj) {
        console.timeEnd('select_group');
        callback(err, group_Obj);
    });
};

exports.select_grp = function(ri, callback) {
    var sql = util.format("select * from grp where ri = \'%s\'", ri);
    db.getResult(sql, '', function (err, group_Obj) {
        callback(err, group_Obj);
    });
};

exports.delete_lookup = function (ri, pi_list, pi_index, found_Obj, found_Cnt, callback) {
    var cur_pi = [];
    cur_pi.push(pi_list[pi_index]);

    if(pi_index == 0) {
        console.time('delete_lookup');
    }

    var sql = util.format("delete a.* from (select ri from lookup where pi in ("+JSON.stringify(cur_pi).replace('[','').replace(']','') + ")) b left join lookup as a on b.ri = a.ri");
    db.getResult(sql, '', function (err, search_Obj) {
        if(!err) {
            found_Cnt += search_Obj.affectedRows;
            if(++pi_index >= pi_list.length) {
                sql = util.format("delete from lookup where ri = \'%s\'", pi_list[0]);
                db.getResult(sql, '', function (err, search_Obj) {
                    if(!err) {
                        console.timeEnd('delete_lookup');
                        found_Cnt += search_Obj.affectedRows;
                        console.log('deleted ' + found_Cnt + ' resource(s).');
                    }
                    callback(err, found_Obj);
                });
            }
            else {
                _this.delete_lookup(ri, pi_list, pi_index, found_Obj, found_Cnt, function (err, found_Obj) {
                    callback(err, found_Obj);
                });
            }
        }
    });
};
