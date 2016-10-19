file-stream-rotator
===================

[![Code Climate](https://codeclimate.com/github/holidayextras/file-stream-rotator.png)](https://codeclimate.com/github/holidayextras/file-stream-rotator)

NodeJS file stream rotator

## Purpose

To provide an automated rotation of Express/Connect logs based on date.

## Install

```
npm install file-stream-rotator
```

## Usage

    # Default date added at the end of the file
    var rotatingLogStream = require('file-stream-rotator').getStream({filename:"/tmp/test.log", frequency:"daily", verbose: false});

    # Default date added using file pattern
    var rotatingLogStream = require('file-stream-rotator').getStream({filename:"/tmp/test-%DATE%.log", frequency:"daily", verbose: false});

    # Custom date added using file pattern using moment.js formats
    var rotatingLogStream = require('file-stream-rotator').getStream({filename:"/tmp/test-%DATE%.log", frequency:"daily", verbose: false, date_format: "YYYY-MM-DD"});

    .....
    
    // Use new stream in express
    app.use(express.logger({stream: rotatingLogStream, format: "default"}));
    .....
    frequency options include:
    * daily
    * rotate on given minutes using the 'm' option i.e. 5m or 30m
    ** var rotatingLogStream = require('file-stream-rotator').getStream({filename:"/tmp/test.log", frequency:"5m", verbose: false});
    * rotate on the hour or any specified number of hours
    ** var rotatingLogStream = require('file-stream-rotator').getStream({filename:"/tmp/test.log", frequency:"1h", verbose: false});
    * test - creates a log file with a date suffix

## NPM Maintainers

The npm module for this library is maintained by:

* [Dan Jenkins](http://github.com/danjenkins)
* [Roger Castells](http://github.com/rogerc)
* [Viktor Trako](http://github.com/viktort)

## License

file-stream-rotator is licensed under the MIT license.