'use strict';

/*!
 * FileStreamRotator
 * Copyright(c) 2012 Holiday Extras.
 * MIT Licensed
 */

/**
 * Module dependencies.
 */
var fs = require('fs');
var moment = require('moment');


/**
 * FileStreamRotator:
 *
 * Returns a file stream that auto-rotates based on date.
 *
 * Options:
 *
 *   - `filename`   Filename including full path used by the stream
 *   - `frequency`  How often to rotate. At present only 'daily' and 'test' are available. 'test' rotates every minute.
 *                  If frequency is set to none of the above, a YYYYMMDD string will be added to the end of the filename.
 *   - `verbose`    If set, it will log to STDOUT when it rotates files and name of log file. Default is TRUE.
 *
 * To use with Express / Connect, use as below.
 *
 * var rotatingLogStream = require('FileStreamRotator').getStream({filename:"/tmp/test.log", frequency:"daily", verbose: false})
 * app.use(express.logger({stream: rotatingLogStream, format: "default"}));
 *
 * @param {Object} options
 * @return {Object}
 * @api public
 */
var FileStreamRotator = {};

module.exports = FileStreamRotator;

var staticFrequency = ['daily', 'test', 'm', 'h'];
var DATE_FORMAT = ('YYYYMMDDHHmm');

var _checkNumAndType = function (type, num) {
    if (typeof num == 'number') {
        switch (type) {
            case 'm':
                if (num < 0 || num > 60) {
                    return false;
                }
                break;
            case 'h':
                if (num < 0 || num > 24) {
                    return false;
                }
                break;
        }
        return {type: type, digit: num};
    }
}

var _checkDailyAndTest = function (freqType) {
    switch (freqType) {
        case 'daily':
            return {type: freqType, digit: undefined};
            break;
        case 'test':
            return {type: freqType, digit: 0};
    }
    return false;
}

FileStreamRotator.getFrequency = function (frequency) {
    for (var i = 0; i < staticFrequency.length; i++) {
        var type = staticFrequency[i];
        var regex = frequency.toLowerCase().match(type);
        if (regex && Array.isArray(regex) && regex.length > 0) {
            var freqType = regex[0];

            var dailyOrTest = _checkDailyAndTest(freqType);
            if (dailyOrTest) {
                return dailyOrTest;
            }

            var numRegex = frequency.match(/(.*)[A-Za-z]/);
            if (numRegex && Array.isArray(numRegex) && numRegex.length >= 1 && numRegex[1] !== '') {
                var num = numRegex[1] / 1; //turn it into a 'number' if its a 'string'
                return _checkNumAndType(type, num);
            } else {
                return false;
            }
        } else { //no match so return false once reaching the end of the loop
            if (i == staticFrequency.length - 1) {
                return false;
            }
        }
    }
}

FileStreamRotator.getDate = function (format, date_format) {
    date_format = date_format || DATE_FORMAT;
    if (format && staticFrequency.indexOf(format.type) !== -1 && format.type !== 'daily') {
        switch (format.type) {
            case 'm':
                var minute = Math.floor(moment().minutes() / format.digit) * format.digit;
                return moment().minutes(minute).format(date_format);
                break;
            case 'h':
                var hour = Math.floor(moment().hour() / format.digit) * format.digit;
                return moment().hour(hour).format(date_format);
                break;
            case 'test':
                return moment().format(date_format);
        }
    }
    return moment().format(date_format);
}

FileStreamRotator.getStream = function (options) {
    var frequencyMetaData = null;
    var curDate = null;
    var self = this;

    var dateFormat = (options.date_format || DATE_FORMAT);

    if (!options.filename) {
        console.error("No filename supplied. Defaulting to STDOUT");
        return process.stdout;
    }

    if (options.frequency) {
        frequencyMetaData = self.getFrequency(options.frequency);
    }

    if (frequencyMetaData) {
        curDate = (options.frequency ? self.getDate(frequencyMetaData,dateFormat) : "");
    }

    var filename = options.filename;
    var logfile = filename + (curDate ? "." + curDate : "");
    if(filename.match(/%DATE%/)){
        logfile = filename.replace('%DATE%',(curDate?curDate:self.getDate(null,dateFormat)));
    }
    var verbose = (options.verbose !== undefined ? options.verbose : true);
    if (verbose) {
        console.log("Logging to", logfile);
    }
    var rotateStream = fs.createWriteStream(logfile, {flags: 'a'});
    if (curDate && frequencyMetaData && (frequencyMetaData.type == 'daily' || frequencyMetaData.type == 'h' || frequencyMetaData.type == 'm')) {
        if (verbose) {
            console.log("Rotating file", options.frequency);
        }
        var stream = {end: rotateStream.end};
        stream.write = (function (str, encoding) {
            var newDate = this.getDate(frequencyMetaData,dateFormat);
            if (newDate != curDate) {
                var newLogfile = filename + (curDate ? "." + newDate : "");
                if(filename.match(/%DATE%/) && curDate){
                    newLogfile = filename.replace('%DATE%',newDate);
                }

                if (verbose) {
                    console.log("Changing logs from %s to %s", logfile, newLogfile);
                }
                curDate = newDate;
                logfile = newLogfile;
                rotateStream.destroy();
                rotateStream = fs.createWriteStream(newLogfile, {flags: 'a'});
            }
            rotateStream.write(str, encoding);
        }).bind(this);
        return stream;
    } else {
        if (verbose) {
            console.log("File won't be rotated");
        }
        return rotateStream;
    }
}