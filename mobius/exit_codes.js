'use strict';
// Dedicated process exit codes. 1 is not used here because uncaught exceptions (backstop) and DB connection failure already exit with 1.
exports.PORT_TAKEN = 12;   // the port is held by another process; the primary exits with the same code
exports.NO_CONF = 13;      // a worker found no conf.json; the primary exits too
exports.BAD_SEAL = 14;      // a worker found a seal mismatch; the primary exits too
