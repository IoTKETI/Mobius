#!/usr/bin/env node
/**
* Logger node module
* @author piero@tilab
* @version 0.0.3
* @description winston wrapper. nb: use console overrides in sub-modules of main app
*/
var fs = require('fs');
var winston = require('winston');
var dateFormat = require("dateformat");
var datePattern = 'yyyyMMdd';
// Create the log directory if it does not exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}
var tsFormat = function() { return dateFormat(Date.now(), "dd/mm/yyyy HH:MM:ss.l");  }
global.logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
        timestamp: tsFormat,
        formatter: function(options) {
          return options.timestamp() +' ['+ options.level.toUpperCase() +']   '+ (options.message ? options.message : '') +
            (options.meta && Object.keys(options.meta).length ? '\n\t'+ JSON.stringify(options.meta) : '' );
        }
    }),
    new (require('winston-daily-rotate-file'))({
        filename: `${logDir}/.log`,
        timestamp: tsFormat,
        datePattern: 'log-'+datePattern,
        prepend: true,
        json: false,
        level: 'info',
        handleExceptions: true,
		humanReadableUnhandledException: true,
        zippedArchive: true
    })
  ],
  exitOnError: false
});
// console override
console.log = logger.info;
console.info = logger.info;
console.error = logger.error;
console.warn = logger.warn;
// module export
module.exports.logger = logger;
logger.fileName = function() {
    return 'log-'+dateFormat(Date.now(), datePattern.toLowerCase());
}
