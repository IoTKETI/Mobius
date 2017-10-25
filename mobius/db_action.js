/**
 * Copyright (c) 2015, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Created by ryeubi on 2015-10-19.
 */

var mysql = require('mysql');

var mysql_pool = null;

//var _this = this;


exports.connect = function (host, port, database, user, password, callback) {
    mysql_pool = mysql.createPool({
        host: host,
        port: port,
        user: user,
        password: password,
        database: database,
        connectionLimit: 100,
        waitForConnections: true,
        debug: false,
        acquireTimeout: 50000,
        queueLimit: 0
    });

    callback('1');
};


function executeQuery(pool, query, callback) {
    pool.getConnection(function (err, connection) {
        if (err) {
            return callback(err, null);
        }
        else if (connection) {
            connection.query({sql:query, timeout:60000}, function (err, rows, fields) {
                connection.release();
                if (err) {
                    return callback(err, null);
                }
                return callback(null, rows);
            })
        }
        else {
            return callback(true, "No Connection");
        }
    });
}


exports.getResult = function(query, db_Obj, callback) {
    if(mysql_pool == null) {
        console.error("mysql is not connected");
        return '0';
    }

    executeQuery(mysql_pool, query, function (err, rows) {
        if (!err) {
            callback(null,rows);
        }
        else {
            callback(true,err);
        }
    });
};

/* [TIM] using fields escape */
exports.getResultEsc = function(query, values, callback) {
    if(mysql_pool == null) {
        console.error("mysql is not connected");
        return '0';
    }

    mysql_pool.getConnection(function (err, connection) {
        if (err) {
            return callback(err, null);
        } else if (connection) {
            connection.query({
                sql: query,     // 'SELECT * FROM `table` WHERE `field1` = ?',
                timeout: 60000, // 60s
                values: values, // ['field1_val']
            }, function (err, rows, fields) {
                connection.release();
                if (err) {
                    return callback(true, err);
                }
                return callback(null, rows);
            });
        } else {
            return callback(true, "No Connection");
        }
    });
};

