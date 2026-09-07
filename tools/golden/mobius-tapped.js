'use strict';
// Starts mobius.js with the SQL tap installed first.
//
//   node tools/golden/mobius-tapped.js sqlite
//
// cluster.fork() re-executes process.argv[1], so workers pass through this file too and the tap is installed in them as well.

process.chdir(require('path').join(__dirname, '..', '..'));

require('./tap').install();
require('../../mobius.js');
