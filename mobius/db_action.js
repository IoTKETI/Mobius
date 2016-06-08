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

var mongodb = require('mongodb');
var MongoClient = mongodb.MongoClient;

var mysql = require('mysql');

var mysql_pool = null;
var mongodb_pool = null;

_this = this;

var mongodb_url = 'mongodb://localhost:27017/mobiusdb';

exports.connect = function (host, port, user, password, callback) {
    if(usedbname == 'mysql') {
        mysql_pool = mysql.createPool({
            host: host,
            port: port,
            user: user,
            password: password,
            database: 'mobiusdb',
            connectionLimit: 100,
            waitForConnections: true,
            debug: false,
            acquireTimeout: 50000,
            queueLimit: 0
        });
        callback('1');
    }
    else {
        MongoClient.connect(mongodb_url, function (err, db) {
            if (err) {
                console.log('Unable to connect to the mongoDB server. Error:', err);
                callback('0');
            } else {
                //HURRAY!! We are connected. :)
                console.log('Connection established to', mongodb_url);

                mongodb_pool = db;
                callback('1');
            }
        });
    }
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
    if(usedbname == '') {
        usedbname = 'mysql';
    }

    if(usedbname == 'mysql') {
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
    }
    else { // mongodb
        if(mongodb_pool == null) {
            console.error("mongodb is not connected");
            return '0';
        }

        executeQuery_mongo(mongodb_pool, db_Obj, function (err, rows) {
            if (!err) {
                callback(null, rows);
            }
            else {
                callback(true, err);
            }
        });
    }
};

function executeQuery_mongo(pool, db_Obj, callback) {
    MongoClient.connect(mongodb_url, function (err, db) {
        if (err) {
            console.log('Unable to connect to the mongoDB server. Error:', err);
            callback('0');
        } else {
            //HURRAY!! We are connected. :)
            console.log('Connection established to', mongodb_url);

            if (db_Obj.type == 'insert') {
                var collection = db.collection(db_Obj.table);

                //db_Obj.values._id = db_Obj.values.ri;
                collection.insert(db_Obj.values, function (err, result) {
                    if (err) {
                        console.log(err);
                        db.close();
                        return callback(err, null);
                    } else {
                        console.log('Inserted %d documents into the "users" collection. The documents inserted with "_id" are:', result.length, result);
                        db.close();
                        return callback(null, result);
                    }
                });
            }
        }
    });
}

