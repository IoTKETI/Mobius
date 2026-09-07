'use strict';
// Computes the relation between the connection pool size and MySQL max_connections in one place, shared by the boot-time floor check (db_bootstrap) and the admin console.

var os = require('os');

// Process count = workers + primary. app.js forks os.cpus().length workers.
exports.processCount = function () {
    return os.cpus().length + 1;
};

// Total connections the application can demand; every process has its own pool.
exports.appDemand = function (connectionLimit, processes) {
    return connectionLimit * processes;
};

// Floor for max_connections: demand plus 20% headroom, rounded up to the next 100.
// 
//   e.g. 25 x 25 = 625 -> 750 -> 800
exports.floorFor = function (connectionLimit, processes) {
    var demand = exports.appDemand(connectionLimit, processes);
    return Math.ceil(demand * 1.2 / 100) * 100;
};

// Floor for the current configuration: the global pool limit and the real CPU count.
exports.currentFloor = function () {
    var limit = (typeof global.use_db_connection_limit === 'number')
        ? global.use_db_connection_limit : 25;
    return exports.floorFor(limit, exports.processCount());
};
