/**
 * Support arbitrary lenght unsigned integer number convertion to string representation 
 * in the specified radix (base) in Node.js.
 *
 * JavaScript Numbers are IEEE-754 binary double-precision floats, which limits the
 * range of values that can be represented with integer precision to:
 *
 * 2^53 <= N <= 2^53
 *
 * For more details about IEEE-754 see: http://en.wikipedia.org/wiki/IEEE_floating_point
 */
 /*jslint bitwise: true */
(function () {
    "use strict";

    var FORMATS = {
        'dec': toDecimalString,
        'hex': toHexString,
        'bin': toBinaryString,
        'oct': toOctetString
    };

    module.exports = function (buffer, base, options) {
        base = base || 'dec';
        var buf = _toBuffer(buffer), format = FORMATS[base];

        if (format) {
            return format(buf, options);
        }
    };

    function toDecimalString(buffer, options) {
        options = options || {};
        var bits = buffer.length * 8,                           // number of bits in the buffer
            lastBit = buffer.length - 1,                        // last bit index
            digits = new Buffer(Math.floor(bits / 3 + 1 + 1)),  // digits buffer
            lastDigit = digits.length - 1, carry;               // last digit index, digit index, carry flag

        // reset digits buffer
        digits.fill(0);

        // reverse buffer if not in LE format
        if ((options.format || 'BE') !== 'LE') {
            _reverseBuffer(buffer);
        }

        for (var i = 0; i < bits; i++) {
            carry = buffer[lastBit] >= 0x80;

            _leftShift(buffer);  // shift buffer bits

            for (var d = lastDigit; d >= 0; d--) {
                digits[d] += digits[d] + (carry ? 1 : 0);
                carry = (digits[d] > 9);
                if (carry) {
                    digits[d] -= 10;
                }
            }
        }

        // get rid of leading 0's; reuse d for the first non-zero value index
        var idx = _lastHeadIndex(digits, 0);

        // if there are only 0's use the last digit
        idx = idx >= 0 ? idx : lastDigit;

        // convert numbers to ascii digits
        _toAsciiDigits(digits, idx);

        return _pad(
            _split(digits.toString('ascii', idx), options.groupsize, options.delimiter),
            '', options.padstr, options.size);
    }

    function toBinaryString(buffer, options) {
        options = options || {};
        var digits = new Array(buffer.length),
            size = options.groupsize || -1, num,
            prefix = options.prefix || '',
            output;

        if ((options.format || 'BE') !== 'BE') {
            _reverseBuffer(buffer);
        }

        for (var i = 0; i < buffer.length; i++) {
            num = buffer[i].toString(2);
            digits[i] = '00000000'.slice(0, 8 - num.length) + buffer[i].toString(2);
        }

        output = digits.join('');

        if (options.trim) {
            output = output.substr(output.indexOf('1'));
        }

        if (size > 0) {
            output = _split(output, size, options.delimiter);
        }

        return prefix + _pad(output, prefix, options.padstr, options.size);
    }

    /*
     * Converts given input (node Buffer or array of bytes) to hexadecimal string 0xDDDD where D is [0-9a-f].
     * All leading 0's are stripped out i.e. [0x00, 0x00, 0x00, 0x01] -> '0x1'
     */
    function toHexString(buffer, options) {
        options = options || {};
        var prefix = options.prefix || '', digits, idx;

        if ((options.format || 'BE') !== 'BE') {
            _reverseBuffer(buffer);
        }

        digits = buffer.toString('hex');
        idx = _lastHeadIndex(digits, '0');

        // if there are only 0's use the last digit
        idx = idx >= 0 ? idx : digits.length - 1;

        return prefix + _pad(
            _split(digits.slice(idx), options.groupsize, options.delimiter), prefix, options.padstr, options.size);
    }

    function toOctetString(buffer, options) {
        options = options || {};
        var shifts = Math.floor(buffer.length * 8 / 3),
            lastIdx = buffer.length - 1,
            digits = new Buffer(shifts),
            prefix = options.prefix || '', idx;

        digits.fill(0); // reset digits buffer
        if ((options.format || 'BE') !== 'BE') {
            _reverseBuffer(buffer);
        }

        for (var i = digits.length - 1; i >= 0; i--) {
            digits[i] = buffer[lastIdx] & 0x7;

            // right shift buffer by 3 bits
            _rightShift(buffer);
            _rightShift(buffer);
            _rightShift(buffer);
        }

        // get rid of leading 0's; reuse d for the first non-zero value index
        idx = _lastHeadIndex(digits, 0);
        idx = idx >= 0 ? idx : lastIdx;

        // convert numbers to ascii digits
        _toAsciiDigits(digits, idx);

        return prefix + _pad(
            _split(digits.toString('ascii', idx), options.groupsize, options.delimiter), prefix, options.padstr, options.size);
    }

    function _split(string, size, delim) {
        if (typeof delim === 'undefined') {
            delim = ' ';
        }
        if (typeof string !== 'undefined' && +size > 0) {
            string = string.replace(new RegExp('(.)(?=(.{' + +size + '})+(?!.))', 'g'), "$1" + delim);
        }
        return string;
    }

    function _pad(str, prefix, pad, size) {
        if ('undefined' === typeof pad || 'undefined' === typeof size || pad.length === 0 || str.length + prefix.length >= size) {
            return str;
        }
        var padlen = size - str.length - prefix.length;
        return new Array(Math.ceil(padlen / pad.length) + 1).join(pad).substr(0, padlen) + str;
    }

    function _toAsciiDigits(buffer, offset) {
        for (var i = offset; i < buffer.length; i++) {
            buffer[i] += 48;
        }
    }

    /*
     * Finds last head index of the given value in the given buffer
     * Otherwise it returns -1.
     */
    function _lastHeadIndex(buffer, value) {
        for (var i = 0; i < buffer.length; i++) {
            if (buffer[i] !== value) {
                return i;
            }
        }
        return -1;
    }

    /*
     * Checks type of data and perform conversion if necessary
     */
    function _toBuffer(buffer) {
        var _buffer, nums;

        if (Buffer.isBuffer(buffer)) {
            _buffer = new Buffer(buffer.length);
            buffer.copy(_buffer);
        }
        else if (Array.isArray(buffer)) {
            _buffer = new Buffer(buffer);
        }
        else if (typeof buffer === 'string') {
            nums = buffer.replace(/^0x/i, '').match(/.{1,2}(?=(..)+(?!.))|..?$/g);
            _buffer = new Buffer(nums.length);

            _buffer.fill(0);

            for (var i = nums.length - 1; i >= 0; i--) {
                _buffer.writeUInt8(parseInt(nums[i], 16), i);
            }
        }

        return _buffer;
    }

    /*
     * Performs byte order reverse
     */
    function _reverseBuffer(buffer) {
        var tmp, len = buffer.length - 1, half = Math.floor(buffer.length / 2);
        for (var i = len; i >= half; i--) {
            tmp = buffer[i];
            buffer[i] = buffer[len - i];
            buffer[len - i] = tmp;
        }
    }

    /*
     * Performs buffer left bits shift
     */
    function _leftShift(buffer) {
        var carry;
        for (var i = buffer.length; i >= 0; i--) {
            carry = (buffer[i] & 0x80) !== 0;
            buffer[i] = (buffer[i] << 1) & 0xFF;
            if (carry && i >= 0) {
                buffer[i + 1] |= 0x01;
            }
        }
    }

    /*
     * Performs buffer right bits shift
     */
    function _rightShift(buffer) {
        var carry, prevcarry;
        for (var i = 0; i < buffer.length; i++) {
            carry = prevcarry;
            prevcarry = (buffer[i] & 0x1) !== 0;
            buffer[i] >>= 1;
            if (carry && i > 0) {
                buffer[i] |= 0x80;
            }
        }
    }

}());