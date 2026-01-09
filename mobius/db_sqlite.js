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
 */

var sqlite3 = require('sqlite3').verbose();

var db = null;

exports.connect = function (callback) {
    db = new sqlite3.Database('./mobius.db', (err) => {
        if (err) {
            console.error(err.message);
        }
        else {
            console.log('Connected to the mobius database.');
            db.configure('busyTimeout', 50000);
            db.run('PRAGMA foreign_keys = ON'); // Enable Foreign Key Support

            var fs = require('fs');
            var path = require('path');
            try {
                var schemaPath = path.join(__dirname, 'mobiusdb_sqlite.sql');
                var schema = fs.readFileSync(schemaPath, 'utf8');
                db.exec(schema, (err) => {
                    if (err) console.error('SQLite Schema Init Error:', err);
                    else console.log('SQLite Schema Initialized');
                });
            } catch (e) {
                console.error('Failed to read schema file:', e);
            }
        }
        callback('1');
    });
};

exports.getConnection = function (callback) {
    if (db) {
        callback('200', db);
    }
    else {
        callback('500-5');
    }
};

exports.getResult = function (query, connection, callback) {
    if (db == null) {
        console.error("sqlite is not connected");
        return '0';
    }

    // Check if query is SELECT or others (INSERT, UPDATE, DELETE)
    // For simpler implementation in pilot phase, we use all, run based on generic guess or caller context if needed.
    // However, sqlite3 has .all() for SELECT and .run() for others usually.
    // We can try to guess from query string.

    var query_trim = query.trim().toUpperCase();
    if (query_trim.startsWith('SELECT') || query_trim.startsWith('WITH')) {
        db.all(query, [], (err, rows) => {
            if (err) {
                callback(true, err);
            }
            else {
                callback(null, rows);
            }
        });
    }
    else {
        db.run(query, [], function (err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    err.code = 'ER_DUP_ENTRY';
                }
                callback(true, err);
            }
            else {
                // Mimic MySQL result format for affectedRows, etc if necessary
                var result = {
                    affectedRows: this.changes,
                    insertId: this.lastID
                };
                callback(null, result);
            }
        });
    }
};
