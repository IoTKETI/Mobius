/**
 * Copyright (c) 2024, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2024, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

const pg = require('pg');

const pool = new pg.Pool({
    user: use_db_user,
    host: use_db_host,
    database: use_db_database,
    password: use_db_password,
    port: use_db_port,
    max: 1000,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});


exports.connect = async (callback) => {
    let client = null;
    try {
        client = await pool.connect();
        if(client) {
            client.release();
        }
        callback('1');
    }
    catch (e) {
        console.error('pg error ', e);
        callback('0');
    }
};


// function executeQuery(pool, query, callback) {
//     pool.getConnection(function (err, connection) {
//         if (err) {
//             return callback(err, null);
//         }
//         else if (connection) {
//             connection.query({sql:query, timeout:60000}, function (err, rows, fields) {
//                 connection.release();
//                 if (err) {
//                     return callback(err, null);
//                 }
//                 return callback(null, rows);
//             });
//         }
//         else {
//             return callback(true, "No Connection");
//         }
//     });
// }

function executeQuery(pool, query, connection, callback) {
    connection.query({sql:query, timeout:60000}, function (err, rows, fields) {
        if (err) {
            return callback(err, null);
        }
        return callback(null, rows);
    });
}

const getConnection = async (callback) => {
    let client = null;
    try {
        client = await pool.connect();
        callback('200', client);
    }
    catch (e) {
        console.error('pg error ', e);
        callback('500-5');
    }
};

const connection = async () => {
    let client = null;
    try {
        client = await pool.connect();
        return ['200', client];
    }
    catch (e) {
        console.error('pg error ', e);
        return ['500-5'];
    }
};

exports.getConnection = getConnection;
exports.connection = connection;

const getResult = async (query, connection, callback) => {
    let res = null;
    try {
        res = await connection.query(query);
        // console.log(res.rows);
        callback(null, res.rows);
    }
    catch (e) {
        console.error('pg error ', e);
        callback(true, e);
    }
};

const query = async (sql, connection) => {
    let res = null;
    try {
        res = await connection.query(sql);
        return [null, res.rows];
    }
    catch (e) {
        console.error('pg error ', e);
        return [true];
    }
};

exports.getResult = getResult;
exports.query = query;

