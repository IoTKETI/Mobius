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
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 * @revision 2024.06
 */

require('dotenv').config();
const pg = require('pg');

const pool = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
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

exports.getConnection = async (callback) => {
    let client = null;
    try {
        client = await pool.connect();
        callback('200', client);
    }
    catch (e) {
        console.error('pg error ', e);
        callback('500-5');
    }

    // if(mysql_pool == null) {
    //     console.error("mysql is not connected");
    //     callback(true, "mysql is not connected");
    //     return '0';
    // }
    //
    // mysql_pool.getConnection((err, connection) => {
    //     if (err) {
    //         console.log(`Cant get connection from pool`);
    //         callback('500-5');
    //     }
    //     else {
    //         const connectionIdleTimer = connection.__idleCloseTimer;
    //         if (connectionIdleTimer) {
    //             clearTimeout(connectionIdleTimer);
    //         }
    //
    //         connection.__idleCloseTimer = setTimeout(() => {
    //             console.log('close connection due inactivity');
    //             mysql_pool._purgeConnection(connection);
    //         }, 30 * 1000);
    //
    //         callback('200', connection);
    //     }
    // });
};

exports.getResult = async (query, connection, callback) => {
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

    // if(mysql_pool == null) {
    //     console.error("mysql is not connected");
    //     return '0';
    // }
    //
    // executeQuery(mysql_pool, query, connection, (err, rows) => {
    //     if (!err) {
    //         callback(null, rows);
    //     }
    //     else {
    //         callback(true, err);
    //     }
    // });
};


