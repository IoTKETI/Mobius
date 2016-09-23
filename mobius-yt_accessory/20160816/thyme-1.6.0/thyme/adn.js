/**
 * Created by ryeubi on 2015-08-31.
 */

var http = require('http');
var js2xmlparser = require("js2xmlparser");
var xml2js = require('xml2js');

var bodyStr = {};

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
    
    return ('RI' + cur_d.toISOString().replace(/-/, '').replace(/-/, '').replace(/T/, '').replace(/:/, '').replace(/:/, '').replace(/\..+/, '') + msec);
}

exports.crtae = function (cbhost, cbport, parent_path, appname, appid, callback) {
    var requestid = gen_requestid();

    var results_ae = {};

    var xmlString = '';
    if(useappprotocol == 'xml') {
        results_ae.api = appid;
        results_ae.rn = appname;
        results_ae['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        xmlString = js2xmlparser("m2m:ae", results_ae);
    }
    else {
        results_ae['m2m:ae'] = {};
        results_ae['m2m:ae'].api = appid;
        results_ae['m2m:ae'].rn = appname;
//        results_ae['m2m:ae'].acpi = '/mobius-yt/acp1';
        xmlString = JSON.stringify(results_ae);
    }

    var options = {
        hostname: cbhost,
        port: cbport,
        path: parent_path,
        method: 'post',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol+'; ty=2',
            'Content-Length' : xmlString.length
        }
    };

    bodyStr['crtae'] = '';
    var req = http.request(options, function (res) {
        //console.log('[crtae response : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['crtae'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['crtae']);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    //console.log(xmlString);

    req.write(xmlString);
    req.end();
};

exports.rtvae = function (cbhost, cbport, path, callback) {
    var requestid = gen_requestid();

    var options = {
        hostname: cbhost,
        port: cbport,
        path: path,
        method: 'get',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol,
            'nmtype': 'short'
        }
    };

    var xmlString = '';

    bodyStr['rtvae'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['rtvae'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['rtvae']);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });


    req.write(xmlString);
    req.end();
};


exports.udtae = function (cbhost, cbport, path, callback) {
    var requestid = gen_requestid();

    var options = {
        hostname: cbhost,
        port: cbport,
        path: path,
        method: 'put',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol
        }
    };

    var xmlString = '';
    if(useappprotocol == 'xml') {
        results_ae.lbl = 'seahorse';
        results_ae['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        xmlString = js2xmlparser("m2m:ae", results_ae);
    }
    else {
        results_ae['m2m:ae'] = {};
        results_ae['m2m:ae'].lbl = 'seahorse';
        xmlString = JSON.stringify(results_ae);
    }

    bodyStr['udtae'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['udtae'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['udtae']);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    console.log(xmlString);
    req.write(xmlString);
    req.end();
};


exports.delae = function (cbhost, cbport, path, callback) {
    var requestid = gen_requestid();

    var options = {
        hostname: cbhost,
        port: cbport,
        path: path,
        method: 'delete',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol
        }
    };

    var xmlString = '';

    bodyStr['delae'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['delae'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['delae']);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    req.write(xmlString);
    req.end();
};

exports.crtct = function(cbhost, cbport, parent_path, ctname, callback) {
    var requestid = gen_requestid();

    var results_ct = {};

    var xmlString = '';
    if(useappprotocol == 'xml') {
        results_ct.rn = ctname;
        results_ct.lbl = ctname;
        results_ct['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        xmlString = js2xmlparser("m2m:cnt", results_ct);
    }
    else {
        results_ct['m2m:cnt'] = {};
        results_ct['m2m:cnt'].rn = ctname;
        results_ct['m2m:cnt'].lbl = [ctname];
        xmlString = JSON.stringify(results_ct);
    }

    var options = {
        hostname: cbhost,
        port: cbport,
        path: parent_path,
        method: 'post',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol+'; ty=3',
            'Content-Length' : xmlString.length
        }
    };

    bodyStr['crtct'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['crtct'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['crtct']);
            bodyStr['crtct'] = '';
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    console.log(xmlString);
    req.write(xmlString);
    req.end();
};


exports.rtvct = function(cbhost, cbport, path, callback) {
    var requestid = gen_requestid();

    var xmlString = '';

    var options = {
        hostname: cbhost,
        port: cbport,
        path: path,
        method: 'get',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol
        }
    };

    bodyStr['rtvct'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['rtvct'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['rtvct']);
            bodyStr['rtvct'] = '';
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    req.write(xmlString);
    req.end();
};


exports.udtct = function(cbhost, cbport, path, callback) {
    var requestid = gen_requestid();

    var results_ct = {};
    var xmlString = '';
    if(useappprotocol == 'xml') {
        results_ct.lbl = 'seahorese/'+ctname;
        results_ct['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        xmlString = js2xmlparser("m2m:cnt", results_ct);
    }
    else {
        results_ct['m2m:cnt'] = {};
        results_ct['m2m:cnt'].lbl = 'seahorese/'+ctname;
        xmlString = JSON.stringify(results_ct);
    }

    var options = {
        hostname: cbhost,
        port: cbport,
        path: path,
        method: 'put',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol
        }
    };

    bodyStr['udtct'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['udtct'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['udtct']);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    console.log(xmlString);
    req.write(xmlString);
    req.end();
};


exports.delct = function(cbhost, cbport, path, callback) {
    var requestid = gen_requestid();

    var xmlString = '';

    var options = {
        hostname: cbhost,
        port: cbport,
        path: path,
        method: 'delete',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol
        }
    };

    bodyStr['delct'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['delct'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['delct']);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    req.write(xmlString);
    req.end();
};


exports.delsub = function(cbhost, cbport, path, nu, callback) {
    var requestid = gen_requestid();

    var options = {
        hostname: cbhost,
        port: cbport,
        path: path,
        method: 'delete',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol
        }
    };

    bodyStr['delsub'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['delsub'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['delsub']);
            bodyStr['delsub'] = '';
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    req.write('');
    req.end();
};

exports.crtsub = function(cbhost, cbport, parent_path, subname, nu, callback) {
    var requestid = gen_requestid();

    var results_ss = {};
    var xmlString = '';
    if(useappprotocol == 'xml') {
        results_ss.rn = subname;
        results_ss.enc = {net:3};
        results_ss.nu = nu;
        results_ss.nct = 2;
        results_ss['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        xmlString = js2xmlparser("m2m:sub", results_ss);
    }
    else {
        results_ss['m2m:sub'] = {};
        results_ss['m2m:sub'].rn = subname;
        results_ss['m2m:sub'].enc = {net:[3]};
        results_ss['m2m:sub'].nu = [nu];
        results_ss['m2m:sub'].nct = 2;

        xmlString = JSON.stringify(results_ss);
    }

    var options = {
        hostname: cbhost,
        port: cbport,
        path: parent_path,
        method: 'post',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol+'; ty=23',
            'Content-Length' : xmlString.length
        }
    };

    bodyStr['crtsub'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['crtsub'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], bodyStr['crtsub']);
            bodyStr['crtsub'] = '';
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
        }
    });

    //console.log(xmlString);
    req.write(xmlString);
    req.end();
};

exports.crtci = function(cbhost, cbport, parent_path, ciname, content, socket, callback) {
    var requestid = gen_requestid();

    var results_ci = {};
    var xmlString = '';
    if(useappprotocol == 'xml') {
        results_ci.rn = (ciname != null && ciname != '') ? ciname : '';
        results_ci.con = content;

        results_ci['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        xmlString = js2xmlparser("m2m:cin", results_ci);
    }
    else {
        results_ci['m2m:cin'] = {};
        results_ci['m2m:cin'].rn = (ciname != null && ciname != '') ? ciname : '';
        results_ci['m2m:cin'].con = content;

        xmlString = JSON.stringify(results_ci);
    }

    var options = {
        hostname: cbhost,
        port: cbport,
        path: parent_path,
        method: 'post',
        headers: {
            'locale': 'ko',
            'X-M2M-RI': requestid,
            'Accept': 'application/'+useappprotocol,
            'X-M2M-Origin': useaeid,
            'Content-Type': 'application/vnd.onem2m-res+'+useappprotocol+'; ty=4',
            'Content-Length' : xmlString.length
        }
    };

    var parent_path_arr = parent_path.split('/');

    bodyStr['crtci'] = '';
    var req = http.request(options, function (res) {
        //console.log('[rtvae response] : ' + res.statusCode);

        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            bodyStr['crtci'] += chunk;
        });

        res.on('end', function () {
            callback(res.headers['x-m2m-rsc'], parent_path_arr[3], bodyStr['crtci']);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('problem with request: ' + e.message);
            callback(9999, parent_path_arr[3], e.message);
        }
    });

    //console.log(xmlString);
    req.write(xmlString);
    req.end();
};

