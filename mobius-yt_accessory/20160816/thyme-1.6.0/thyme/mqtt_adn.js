/**
 * Created by ryeubi on 2015-11-21.
 */

/**
 * Created by ryeubi on 2015-08-31.
 */

var http = require('http');
var js2xmlparser = require("js2xmlparser");
var xml2js = require('xml2js');
const crypto = require('crypto');

var bodyStr = {};

var _this = this;


exports.randomValueBase64 = function(len) {
    return crypto.randomBytes(Math.ceil(len * 3 / 4))
        .toString('base64')   // convert to base64 format
        .slice(0, len)        // return required number of characters
        .replace(/\+/g, '0')  // replace '+' with '0'
        .replace(/\//g, '0'); // replace '/' with '0'
};



function gen_requestid() {
    var cur_d = new Date();
    var cur_o = cur_d.getTimezoneOffset()/(-60);
    cur_d.setHours(cur_d.getHours() + cur_o);
    var msec = '';
    if((parseInt(cur_d.getMilliseconds(), 10)<10)) {
        msec = ('00'+cur_d.getMilliseconds());
    }
    else if((parseInt(cur_d.getMilliseconds(), 10)<100)) {
        msec = ('0'+cur_d.getMilliseconds());
    }
    else {
        msec = cur_d.getMilliseconds();
    }

    return ('rqi' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec + _this.randomValueBase64(4));
}

global.callback_q = {};

exports.crtae = function (req_topic, aeid, cbcseid, bodytype, parent_path, appname, appid, callback) {
    var rqi = gen_requestid();

    callback_q[rqi] = callback;

    for(var i = 0; i < resp_mqtt_client_arr.length; i++) {
        var mqtt_client = resp_mqtt_client_arr[i];

        resp_mqtt_ri_arr.push(rqi);
        resp_mqtt_path_arr[rqi] = parent_path;

        var req_message = {};
        req_message['m2m:rqp'] = {};
        req_message['m2m:rqp'].op = '1'; // create
        req_message['m2m:rqp'].to = parent_path;
        req_message['m2m:rqp'].fr = aeid;
        req_message['m2m:rqp'].rqi = rqi;
        req_message['m2m:rqp'].ty = '2'; // ae
        req_message['m2m:rqp'].pc = {};
        req_message['m2m:rqp'].pc.ae = {};
        req_message['m2m:rqp'].pc.ae.rn = appname;
        req_message['m2m:rqp'].pc.ae.api = appid;

        if (bodytype == 'xml') {
            req_message['m2m:rqp']['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

            mqtt_client.publish(req_topic, xmlString);

            console.log(req_topic + ' (' + rqi + ' - xml) ---->');
        }
        else { // 'json'
            mqtt_client.publish(req_topic, JSON.stringify(req_message));

            console.log(req_topic + ' (json) ---->');
        }
    }
};

exports.rtvae = function (req_topic, aeid, cbcseid, bodytype, path, callback) {
    var rqi = gen_requestid();

    callback_q[rqi] = callback;

    for(var i = 0; i < resp_mqtt_client_arr.length; i++) {
        var mqtt_client = resp_mqtt_client_arr[i];

        resp_mqtt_ri_arr.push(rqi);
        resp_mqtt_path_arr[rqi] = path;

        var req_message = {};
        req_message['m2m:rqp'] = {};
        req_message['m2m:rqp'].op = '2'; // retrieve
        req_message['m2m:rqp'].to = path;
        req_message['m2m:rqp'].fr = aeid;
        req_message['m2m:rqp'].rqi = rqi;
        req_message['m2m:rqp'].pc = {};

        if (bodytype == 'xml') {
            req_message['m2m:rqp']['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

            mqtt_client.publish(req_topic, xmlString);

            console.log(req_topic + ' (' + rqi + ' - xml) ---->');
        }
        else { // 'json'
            mqtt_client.publish(req_topic, JSON.stringify(req_message));

            console.log(req_topic + ' (json) ---->');
        }
    }
};


exports.udtae = function (path, callback) {
    // to do
};


exports.delae = function (path, callback) {
    // to do
};

exports.crtct = function(req_topic, aeid, cbcseid, bodytype, parent_path, ctname, callback) {
    var rqi = gen_requestid();

    callback_q[rqi] = callback;

    for(var i = 0; i < resp_mqtt_client_arr.length; i++) {
        var mqtt_client = resp_mqtt_client_arr[i];

        resp_mqtt_ri_arr.push(rqi);
        resp_mqtt_path_arr[rqi] = parent_path;

        var req_message = {};
        req_message['m2m:rqp'] = {};
        req_message['m2m:rqp'].op = '1'; // create
        req_message['m2m:rqp'].to = parent_path;
        req_message['m2m:rqp'].fr = aeid;
        req_message['m2m:rqp'].rqi = rqi;
        req_message['m2m:rqp'].ty = '3'; // cnt
        req_message['m2m:rqp'].pc = {};
        req_message['m2m:rqp'].pc.cnt = {};
        req_message['m2m:rqp'].pc.cnt.rn = ctname;
        req_message['m2m:rqp'].pc.cnt.lbl = ctname;

        if (bodytype == 'xml') {
            req_message['m2m:rqp']['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

            mqtt_client.publish(req_topic, xmlString);

            console.log(req_topic + ' (' + rqi + ' - xml) ---->');
        }
        else { // 'json'
            mqtt_client.publish(req_topic, JSON.stringify(req_message));

            console.log(req_topic + ' (json) ---->');
        }
    }
};


exports.rtvct = function(req_topic, aeid, cbcseid, bodytype, path, callback) {
    var rqi = gen_requestid();

    callback_q[rqi] = callback;

    for(var i = 0; i < resp_mqtt_client_arr.length; i++) {
        var mqtt_client = resp_mqtt_client_arr[i];

        resp_mqtt_ri_arr.push(rqi);
        resp_mqtt_path_arr[rqi] = path;

        var req_message = {};
        req_message['m2m:rqp'] = {};
        req_message['m2m:rqp'].op = '2'; // retrieve
        req_message['m2m:rqp'].to = path;
        req_message['m2m:rqp'].fr = aeid;
        req_message['m2m:rqp'].rqi = rqi;
        req_message['m2m:rqp'].pc = {};

        if (bodytype == 'xml') {
            req_message['m2m:rqp']['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

            mqtt_client.publish(req_topic, xmlString);

            console.log(req_topic + ' (' + rqi + ' - xml) ---->');
        }
        else { // 'json'
            mqtt_client.publish(req_topic, JSON.stringify(req_message));

            console.log(req_topic + ' (json) ---->');
        }
    }
};


exports.udtct = function(path, callback) {
    // to do
};


exports.delct = function(path, callback) {
    // to do
};


exports.delsub = function(req_topic, aeid, cbcseid, bodytype, path, callback) {
    var rqi = gen_requestid();

    callback_q[rqi] = callback;

    for(var i = 0; i < resp_mqtt_client_arr.length; i++) {
        var mqtt_client = resp_mqtt_client_arr[i];

        resp_mqtt_ri_arr.push(rqi);
        resp_mqtt_path_arr[rqi] = path;

        var req_message = {};
        req_message['m2m:rqp'] = {};
        req_message['m2m:rqp'].op = '4'; // delete
        req_message['m2m:rqp'].to = path;
        req_message['m2m:rqp'].fr = aeid;
        req_message['m2m:rqp'].rqi = rqi;
        req_message['m2m:rqp'].pc = {};

        if (bodytype == 'xml') {
            req_message['m2m:rqp']['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

            mqtt_client.publish(req_topic, xmlString);

            console.log(req_topic + ' (' + rqi + ' - xml) ---->');
        }
        else { // 'json'
            mqtt_client.publish(req_topic, JSON.stringify(req_message));

            console.log(req_topic + ' (json) ---->');
        }
    }
};

exports.crtsub = function(req_topic, aeid, cbcseid, bodytype, parent_path, subname, nu, callback) {
    var rqi = gen_requestid();

    callback_q[rqi] = callback;

    for(var i = 0; i < resp_mqtt_client_arr.length; i++) {
        var mqtt_client = resp_mqtt_client_arr[i];

        resp_mqtt_ri_arr.push(rqi);
        resp_mqtt_path_arr[rqi] = parent_path;

        var req_message = {};
        req_message['m2m:rqp'] = {};
        req_message['m2m:rqp'].op = '1'; // create
        req_message['m2m:rqp'].to = parent_path;
        req_message['m2m:rqp'].fr = aeid;
        req_message['m2m:rqp'].rqi = rqi;
        req_message['m2m:rqp'].ty = '23'; // sub
        req_message['m2m:rqp'].pc = {};
        req_message['m2m:rqp'].pc.sub = {};
        req_message['m2m:rqp'].pc.sub.rn = subname;
        req_message['m2m:rqp'].pc.sub.enc = {net:3};
        req_message['m2m:rqp'].pc.sub.nu = nu;
        req_message['m2m:rqp'].pc.sub.nct = '2';

        if (bodytype == 'xml') {
            req_message['m2m:rqp']['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

            mqtt_client.publish(req_topic, xmlString);

            console.log(req_topic + ' (' + rqi + ' - xml) ---->');
        }
        else { // 'json'
            mqtt_client.publish(req_topic, JSON.stringify(req_message));

            console.log(req_topic + ' (json) ---->');
        }
    }
};

exports.crtci = function(req_topic, aeid, cbcseid, bodytype, parent_path, ciname, content, callback) {
    var rqi = gen_requestid();

    callback_q[rqi] = callback;

    for(var i = 0; i < resp_mqtt_client_arr.length; i++) {
        var mqtt_client = resp_mqtt_client_arr[i];

        resp_mqtt_ri_arr.push(rqi);
        resp_mqtt_path_arr[rqi] = parent_path;

        var req_message = {};
        req_message['m2m:rqp'] = {};
        req_message['m2m:rqp'].op = '1'; // create
        req_message['m2m:rqp'].to = parent_path;
        req_message['m2m:rqp'].fr = aeid;
        req_message['m2m:rqp'].rqi = rqi;
        req_message['m2m:rqp'].ty = '4'; // cin
        req_message['m2m:rqp'].pc = {};
        req_message['m2m:rqp'].pc.cin = {};
        req_message['m2m:rqp'].pc.cin.rn = (ciname != null && ciname != '') ? ciname : '';
        req_message['m2m:rqp'].pc.cin.con = content;

        if (bodytype == 'xml') {
            req_message['m2m:rqp']['@'] = {
                "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
            };

            var xmlString = js2xmlparser("m2m:rqp", req_message['m2m:rqp']);

            mqtt_client.publish(req_topic, xmlString);

            console.log(req_topic + ' (' + rqi + ' - xml) ---->');
        }
        else { // 'json'
            mqtt_client.publish(req_topic, JSON.stringify(req_message));

            console.log(req_topic + ' (json) ---->');
        }
    }
};

