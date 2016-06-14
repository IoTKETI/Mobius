var assert     = require('assert')
	, biguint  = require('../index');


describe('biguint-format', function () {
	describe('dec formatter', function () {

		it('should be default formatter', function () {
			runTests([ [[0]], '0' ]);
		});

		it('should format Buffer instance', function () {
			runTests([
				[new Buffer([0, 0, 0, 0]), 'dec'], '0',
				[new Buffer([0, 0, 0, 0])], '0',
				[new Buffer([0]), 'dec'], '0'
			]);
		});

		it('should format array of bytes', function () {
			runTests([
				[[0, 0, 0, 0, 0, 0, 0, 0], 'dec'], '0',
				[[0, 0, 0, 0, 0, 0, 0, 0]], '0',
				[[0], 'dec'], '0'
			]);
		});

		it('should format string in hex format', function () {
			runTests([
				['0x000000', 'dec'], '0',
				['0x27A763', 'dec'], '2598755',
				['0x27A763'], '2598755',
				['0x100', 'dec'], '256',
				['0x0000100', 'dec'], '256'
			]);
		});

		it('should format with \'padding\' and \'size\' options', function () {
			runTests([
				['0x27A763', 'dec', {padstr:'0', size:10}], '0002598755',
				['0x27A763', 'dec', {padstr:'0000', size:10}], '0002598755'
			]);
		});

		it('should format with \'groupsize\' option', function () {
			runTests([ ['0x0000100', 'dec', {groupsize:1}], '2 5 6' ]);
		});

		it('should format with Little-endian (LE) format', function () {
			runTests([ 
				[[0, 0, 0x10, 0], 'dec', {format:'LE'}], '1048576',
				[[0, 0, 0x10, 0], 'dec', {format:'LE', groupsize:'3',delimiter:','}], '1,048,576',
				[[0x63, 0xA7, 0x27], 'dec', {format:'LE'}], '2598755'
			]);
		});

		it('should format with Big-endian (BE) format', function () {
			runTests([ 
				[[0x27, 0xA7, 0x63], 'dec', {format:'BE'}], '2598755',
				[[0x1, 0xDB, 0xD8, 0xA4], 'dec', {format:'BE'}], '31185060'
			]);
		});

		it('should format with Big-endian (BE) as a default format', function () {
			runTests([ [[0x27, 0xA7, 0x63], 'dec'], '2598755' ]);
		});

		it('should format very large numbers', function () {
			runTests([ 
				[[0x1, 0x23, 0x45, 0x67, 0x89, 0x0a, 0xbc, 0xde, 0xff, 0xed, 0xcb, 0xa9, 0x08, 0x76, 0x54, 0x21], 'dec'], '1512366075009453296626403467035300897',
				[[0x1, 0x23, 0x45, 0x67, 0x89, 0x0a, 0xbc, 0xde, 0xff, 0xed, 0xcb, 0xa9, 0x08, 0x76, 0x54, 0x21]], '1512366075009453296626403467035300897',
				['0x1234567890abcdeffedcba908765421', 'dec'], '1512366075009453296626403467035300897',
				['1234567890abcdeffedcba908765421', 'dec'], '1512366075009453296626403467035300897',
				['1234567890abcdeffedcba908765421', 'dec', {delimiter:',', groupsize:3}], '1,512,366,075,009,453,296,626,403,467,035,300,897'
			]);
		});
	});

	describe('hex formatter', function () {

		it('should return hex formatted number with correct prefix', function () {
			runTests([ 
				[[0x1, 0xFF, 0xFF], 'hex', {prefix:'0x'}], '0x1ffff',
				[[0x00, 0x00, 0x00, 0x01], 'hex', {prefix:'0x'}], '0x1'
			]);
		});

		it('should return hex formatted number with correct padding and size', function () {
			runTests([ 
				[[0x00, 0x00, 0x00, 0x01], 'hex', {padstr:'0', size:12}], '000000000001',
				[[0x00, 0x00, 0x00, 0x01], 'hex', {prefix:'0x', padstr:'0', size:12}], '0x0000000001'
			]);
		});

		it('should format with \'groupsize\' and \'delimiter\' opotins', function () {
			runTests([ 
				[[0x1, 0xFF, 0xFF], 'hex', {groupsize:2}], '1 ff ff',
				[[0x1, 0xFF, 0xFF], 'hex', {groupsize:2, delimiter:'::'}], '1::ff::ff'
			]);
		});

		it('should format string in hex format', function () {
			runTests([ ['0x0000100', 'hex', {prefix:'0x'}], '0x100' ]);
		});

		it('should return hex formatted string with Little-endian input', function () {
			runTests([ [[0xFF, 0xFF, 0x01], 'hex', {format:'LE', prefix:'0x'}], '0x1ffff' ]);
		});

	});

	describe('oct formatter', function () {

		it('should format info octal number', function () {
			runTests([ ['0x1FF', 'oct'], '777' ]);
		});

		it('should format with padding, prefix and size', function () {
			runTests([
				['0x1FF', 'oct', {padstr:'0', size:1}], '777',
				['0x1FF', 'oct', {padstr:'0', size:4, prefix:'0'}], '0777',
				['0x1FF', 'oct', {padstr:'0', size:6}], '000777',
				['0x1FF', 'oct', {padstr:'0', size:6, prefix:'0'}], '000777'
			]);
		});

		it('should format with Little-endian input', function () {
			runTests([ [[0xFF, 0x1], 'oct', {format:'LE'}], '777' ]);
		});

		it('should format using hex formatted input string', function () {
			runTests([ 
				['0x123456789A', 'oct', {prefix:'0'}], '01106425474232',
				['0x123456789ABCDEFF', 'oct', {prefix:'0'}], '0110642547423257157377',
				['0x123456789ABCDEFF', 'oct', {groupsize:3, delimiter:' '}], '110 642 547 423 257 157 377'
			]);
		});
	});

	describe('bin formatter', function () {

		it('should format into binary (0,1) number', function () {
			runTests([ [[0x1, 0xFF], 'bin'], '0000000111111111' ]);
		});

		it('should format Little-endian input', function () {
			runTests([ [[0xFF, 0x1], 'bin', {format:'LE'}], '0000000111111111' ]);
		});

		it('should format with delimiter, group size, prefix, padding and trimming', function () {
			runTests([
				[[0x1, 0xFF], 'bin', {delimiter:' ', groupsize:1}], '0 0 0 0 0 0 0 1 1 1 1 1 1 1 1 1',
				['0x1FF', 'bin', {delimiter:' ', groupsize:8}], '00000001 11111111',
				['0x0', 'bin', {trim:true}], '0',
				['0x1', 'bin', {trim:true}], '1',
				['0x1', 'bin', {trim:true, padstr:'0', size:8}], '00000001',
				['0x1FF', 'bin', {delimiter:'|', prefix:'B', groupsize:8}], 'B00000001|11111111',
				['0x1FF', 'bin', {trim:true}], '111111111',
				['0x1FF', 'bin', {trim:true, prefix:'B'}], 'B111111111',
				['0x1FF', 'bin', {trim:true, prefix:'B', padstr:'0', size:12}], 'B00111111111',
				['0x1FF', 'bin', {trim:true, padstr:'0', size:12}], '000111111111',
				['0x1FF', 'bin', {padstr:'0', size:12}], '0000000111111111'
			]);
		});

		it('should format with grouping only if group size is provided', function () {
			// group size needs to be provided
			runTests([ ['0x1FF', 'bin', {delimiter:' '}], '0000000111111111' ]); 
		});

		it('should format default delimiter set to \' \' if group size is provided', function () {
			runTests([ [[0x1, 0xFF], 'bin', {groupsize:1}], '0 0 0 0 0 0 0 1 1 1 1 1 1 1 1 1' ]); 
		});
	});

});

// Iterate over all tests
function runTests (tests) {
	for (var i = 0; i < tests.length; i += 2) {
		assert.equal (biguint.apply(biguint, tests[i]), tests[i+1]);
	}
}