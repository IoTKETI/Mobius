Big UInteger Formatter 
====
[![Build Status](https://travis-ci.org/T-PWK/biguint-format.svg?branch=master)](https://travis-ci.org/T-PWK/biguint-format) [![npm version](https://badge.fury.io/js/biguint-format.svg)](http://badge.fury.io/js/biguint-format) [![Dependency Status](https://gemnasium.com/T-PWK/biguint-format.svg)](https://gemnasium.com/T-PWK/biguint-format) [![Code Climate](https://codeclimate.com/github/T-PWK/biguint-format/badges/gpa.svg)](https://codeclimate.com/github/T-PWK/biguint-format) [![Test Coverage](https://codeclimate.com/github/T-PWK/biguint-format/badges/coverage.svg)](https://codeclimate.com/github/T-PWK/biguint-format)

An arbitrary length unsigned integer formatter library for Node.js.

JavaScript uses [IEEE 754 double-precision floats](http://en.wikipedia.org/wiki/IEEE_floating_point) to represents numbers. That works perfectly fine for small numbers, however, it is an issue for big integers. This means they lose integer precision for values beyond `+/- 2 pow 53`

### Problem ###

Presentation of *small* integer in decimal format works fine (e.g. `0x1FF`). However, we can see an issue when we try to convert big integers like `0x1234567890abcdeffedcba908765421` to string decimal.

```js
(0x1FF).toString(10) // returns '511' - correct
(0x1234567890abcdeffedcba908765421).toString(10) 

// output is '1.5123660750094533e+36' - incorrect - lose integer precision
```

### Solution ###

Node.js `biguint-format` module has been built in order to help display very large (arbitrary lengh) unsigned integers without any integer precision lose.

Example:
```js
var format  = require('biguint-format');

// 0x1234567890abcdeffedcba908765421 split into bytes
format([
  0x1, 0x23, 0x45, 0x67, 0x89, 0x0a, 0xbc, 0xde, 
  0xff, 0xed, 0xcb, 0xa9, 0x08, 0x76, 0x54, 0x21], 'dec')

// output value is '1512366075009453296626403467035300897' - no integer precision lose
```
## Instalation ##
```
$ npm install biguint-format
```

## API ##

The `biguint-format` module is a function (`fn(number, format [, options])`) which performs number conversion to the required string format. 

The `number` argument represents an arbitrary lenght unsigned integer number to be converted to string. It can be provided in one of the following formats:
* Node.js [Buffer](http://nodejs.org/api/buffer.html) e.g. `new Buffer([0x1, 0xFF])`
* An array of bytes (values from `0x00` to `0xFF`) e.g. `[0x1, 0xFF]`.
* A string with a number in a hexadecimal format e.g. `0x1FF0A` or `1FF0A`

The `format` argument represents output string format and it can be one of the following options:
* `dec` - convertion to decimal format e.g. `123324884`
* `bin` - conversion to binary format e.g. `1100101010`
* `hex` - conversion to hexadecimal format e.g. `0xADFFAA11`
* `oct` - conversion to octet format e.g. `07771`

If `format` argument is missing, `dec` format is used as a default option. Note that you will have to specify format if you would like to use `options` argument.

The `options` argument (optional) is an object which provides some additional conversion details:
* `format` - specifies format of the input number. It can be either `BE` for Big Endian or `LE` for Little Endian. `BE` is a default value. Check [wikipedia](http://en.wikipedia.org/wiki/Endianness) for more details.
* `prefix` - output string prefix. Note that this option is not supported by `dec` conversion.
* `groupsize` - splits output string into groups of `groupsize` lenght characters.
* `delimiter` - specifes delimiter string to be inserted in between character groups. Default value is space. It is quite handy option when dealing with large numbers.
* `trim` - (works only with `bin` formatting) specifies if the leading 0's should be trimmed.
* `padstr` - string used for right-padding of the fomratted string if its length (inlucing prefix and grouping) is less than value of `size` parameter.
* `size` - determines formatted string size. That opiton has effect only with `padstr` option. Note that the formatted string is not trimmed if its length is longer than value of `size` parameter.

### Examples ###

```js
var format = require('biguint-format');

var buffer1 = new Buffer([0x63, 0xA7, 0x27]);
var buffer2 = new Buffer([0x27, 0xA7, 0x63]);

format(buffer1, 'dec', {format:'LE'})   // returns '2598755'
format(buffer2, 'dec', {format:'BE'})   // returns '2598755'
format(buffer2, 'dec')                  // returns '2598755'

format(buffer1, 'hex', {format:'LE'})   // returns '27a763'
format(buffer2, 'hex', {format:'BE'})   // returns '27a763'
format(buffer2, 'hex', {prefix:'0x'})   // returns '0x27a763'

format(buffer2, 'bin')                  // 001001111010011101100011
format(buffer2, 'bin', {groupsize:8})   // 00100111 10100111 01100011
format(buffer2, 'oct')                  // 11723543
format(buffer2, 'oct', {prefix:'0'})    // 011723543
```

Use of `delimiter` option which helps with large numbers e.g.
```js
var format = require('biguint-format');

format([0x2A, 0xFF, 0x1E, 0x22, 0x11, 0x30, 0x12, 0x2F], 'bin')
format([0x2A, 0xFF, 0x1E, 0x22, 0x11, 0x30, 0x12, 0x2F], 'bin', {groupsize:8})

// returned values
0010101011111111000111100010001000010001001100000001001000101111        // no delimiter
00101010 11111111 00011110 00100010 00010001 00110000 00010010 00101111 // with delimiter
```

Example of `trim` option which works only with binary formatter
```js
var format = require('biguint-format');
var buffer = new Buffer([0x1, 0xA7, 0x63]);

format(buffer, 'bin');              // returns 000000011010011101100011
format(buffer, 'bin', {trim:true}); // returns 11010011101100011
```

Example of `padstr` and `size` options
```js
var format = require('biguint-format');
var buffer = new Buffer([0x1, 0xA7, 0x63]);

format(buffer, 'dec'); // returns 108387
format(buffer, 'oct'); // returns 323543
format(buffer, 'hex'); // returns 1a763

format(buffer, 'dec', {padstr:'0', size:6});  // returns 108387 - no padding effect
format(buffer, 'oct', {padstr:'0', size:10}); // returns 0000323543
format(buffer, 'hex', {padstr:'0', size:6});  // returns 01a763
```

## Author ##
Writen by Tom Pawlak - [Blog](http://blog.tompawlak.org)

## License ##

Copyright (c) 2014 Tom Pawlak

MIT License : http://blog.tompawlak.org/mit-license
