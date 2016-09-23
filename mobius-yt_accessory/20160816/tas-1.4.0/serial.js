/**
 * Created by ryeubi on 2015-08-31.
 */


var util = require('util');
var os = require('os');
var serialport = require('serialport');

var SerialPort;
var myPort;

exports.open = function(portname, baudrate) {
    SerialPort = serialport.SerialPort;

    myPort = new SerialPort(portname, {
        baudRate : baudrate,
        buffersize : 1
        //parser : serialport.parsers.readline("\r\n")
    });

    myPort.on('open', showPortOpen);
    myPort.on('data', saveLastestData);
    myPort.on('close', showPortClose);
    myPort.on('error', showError);
};



var cur_c = '';
var pre_c = '';
var g_sink_buf = '';
var g_sink_ready;
var g_sink_buf_start = 0;


exports.g_down_buf = '';

exports.serial_event = new process.EventEmitter();
exports.g_sink_buf = g_sink_buf;


// list serial ports:
serialport.list(function (err, ports) {
    ports.forEach(function (port) {
        console.log(port.comName);
    });
});


function showPortOpen() {
    console.log('port open. Data rate: ' + myPort.options.baudRate);
}

var counter = 0;
var interval = setInterval(function () {
    //console.log('Bar', counter);
    //counter++;

    //console.log(os.platform());

 //   if (util.format("%s", os.platform()) == 'win32') {
 //       myPort.open();
 //   }


//    if (counter >= 3) {
//        clearInterval(interval);
//    }
}, 10000);


function saveLastestData(data) {
    //var c = util.format('%s', data);
    //console.log(data);



    //g_sink_buf_index = g_sink_buf_index + 1;
    //console.log(g_sink_buf_index);

    if (data == '{') {
//        console.log('%s', data);
        g_sink_buf_index = 0;
        g_sink_buf_start = 1;
        pre_c = '';
        cur_c = util.format('%s', data);
        g_sink_buf = pre_c + cur_c;
        pre_c = g_sink_buf;
    }
    else if (data ==  '}') {
        //console.log('%s', data);
        cur_c = util.format('%s', data);
        g_sink_buf = pre_c + cur_c;
        pre_c = g_sink_buf;

        exports.g_sink_buf = g_sink_buf;

        exports.serial_event.emit('up');

        exports.myPort = myPort;

        g_sink_buf_start = 0;
        g_sink_ready = 1;
        //g_sink_buf.toString('ascii');
    }
    else if (g_sink_buf_start == 1) {
        //       console.log('%s', data);
        cur_c = util.format('%s', data);
        g_sink_buf = pre_c + cur_c;
        pre_c = g_sink_buf;
    }
}

exports.serial_event.on('down', function () {
    console.log(exports.g_down_buf);
    myPort.write(exports.g_down_buf);
});


function showPortClose() {
    console.log('port closed.');
}

function showError(error) {
    var error_str = util.format("%s", error);
    console.log(error.message);
    if (error_str.substring(0, 14) == "Error: Opening") {

    }
    else {
        console.log('Serial port error : ' + error);
    }

}


