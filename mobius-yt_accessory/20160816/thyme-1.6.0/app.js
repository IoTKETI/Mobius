/**
 * Created by ryeubi on 2015-08-31.
 */

var http = require('http');
var express = require('express');
var fs = require('fs');
var bodyParser = require('body-parser');
var mqtt = require('mqtt');
var util = require('util');
var xml2js = require('xml2js');
var url = require('url');
var js2xmlparser = require('js2xmlparser');
var ip = require('ip');

// for TAS
var net = require('net');

var socket_arr = {};

var sh_timer = require('./thyme/timer');
var sh_adn = require('./thyme/adn');

var usecbhost = '127.0.0.1';
var usecbport = '7579';
var usecbname = 'mobius';

var useappid = '0.2.481.1.0001.001.00000000000001';
var useappname = 'iyahn';
var useappport = 9726;
global.useappprotocol = 'xml';
var usetasport = '7622';
var usectname = [];
var usesubname = [];


global.useaeid = '';

var HTTP_SUBSCRIPTION_ENABLE = 0;
var MQTT_SUBSCRIPTION_ENABLE = 0;

// ?????? ????????.
var app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(bodyParser.json({ type: 'application/*+json' }));
app.use(bodyParser.text({ type: 'application/*+xml' }));

// ?????? ????????.
var server = null;

// This is an async file read
fs.readFile('conf.xml', 'utf-8', function (err, data) {
    if (err) {
        console.log("FATAL An error occurred trying to read in the file: " + err);
        console.log("error : set to default for configuration")
    }
    else {
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(data, function (err, result) {
            if (err) {
                console.log("Parsing An error occurred trying to read in the file: " + err);
                console.log("error : set to default for configuration")
            }
            else {
                var jsonString = JSON.stringify(result);
                var conf = JSON.parse(jsonString)['m2m:conf'];

                usecbhost = conf.cse['cbhost'];
                usecbport = conf.cse['cbport'];
                usecbname = conf.cse['cbname'];

                if(conf.ae != null) {
                    useappid = conf.ae['appid'];
                    useappname = conf.ae['appname'];
                    useappport = conf.ae['appport'];
                    useappprotocol = conf.ae['appprotocol'];
                    usetasport = conf.ae.tasport;
                }

                if(conf.cnt != null) {
                    if (conf.cnt['ctname'] != null) {
                        usectname[0] = conf.cnt;
                    }
                    else {
                        usectname = conf.cnt;
                    }
                }

                if(conf.sub != null) {
                    if (conf.sub['subname'] != null) {
                        usesubname[0] = conf.sub;
                    }
                    else {
                        usesubname = conf.sub;
                    }
                }

                // ready for mqtt
                for(var i = 0; i < usesubname.length; i++) {
                    if(usesubname[i]['subname'] != null) {
                        if(url.parse(usesubname[i]['nu']).protocol == 'http:') {
                            HTTP_SUBSCRIPTION_ENABLE = 1;
                        }
                        else if(url.parse(usesubname[i]['nu']).protocol == 'mqtt:') {
                            MQTT_SUBSCRIPTION_ENABLE = 1;
                        }
                    }
                }
            }
        });
    }
});



var tas_ready = new process.EventEmitter();
tas_ready.on('connect', function() {
    var buffers = {};

    net.createServer(function (socket) {
        console.log('socket connected');
        socket.id = Math.random() * 1000;
        buffers[socket.id] = '';
        socket.on('data', function(data) {
            // 'this' refers to the socket calling this callback.
            buffers[this.id] += data.toString();
            //console.log(buffers[this.id]);
            var data_arr = buffers[this.id].split('}');
            //console.log(data_arr[1]);
            if(data_arr.length >= 2) {
                buffers[this.id] = '';
                for (var i = 0; i < data_arr.length-1; i++) {
                    var line = data_arr[i];
                    line += '}';
                    var jsonObj = JSON.parse(line);
                    var ctname = jsonObj.ctname;
                    var content = jsonObj.con;

                    socket_arr[ctname] = socket;

                    console.log('----> got data for [' + ctname + '] from tas ---->');

                    if (jsonObj.con == 'hello') {
                        socket.write(line);
                    }
                    else {
                        if (sh_state == 'crtci') {
                            for (var j = 0; j < usectname.length; j++) {
                                if (usectname[j].ctname == ctname) {
                                    //console.log(line);
                                    var parent_path = '/' + usecbname + usectname[j].parentpath + '/' + ctname;
                                    sh_adn.crtci(usecbhost, usecbport, parent_path, '', content, socket, function (status, ctname, res_body) {
                                        console.log('x-m2m-rsc : ' + status + ' <----');
                                        if (status == 5106 || status == 2001 || status == 4105) {
                                            socket.write('{\"ctname\":\"' + ctname + '\",\"con\":\"' + status + '\"}');
                                        }
                                        else if (status == 5000) {
                                            sh_state = 'crtae';
                                            socket.write('{\"ctname\":\"' + ctname + '\",\"con\":\"' + status + '\"}');
                                        }
                                        else if(status == 9999) {
                                            socket.write('{\"ctname\":\"'+ctname+'\",\"con\":\"'+ res_body +'\"}');
                                        }
                                        else {
                                            socket.write('{\"ctname\":\"' + ctname + '\",\"con\":\"' + status + '\"}');
                                        }
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        });
        socket.on('end', function() {
            console.log('end');
        });
        socket.on('close', function() {
            console.log('close');
        });
        socket.on('error', function(e) {
            console.log('error ', e);
        });
        //socket.write('hello from tcp server');
    }).listen(usetasport, function() {
        console.log('TCP Server (' + ip.address() + ') is listening on port ' + usetasport);
    });
});


global.sh_state = 'crtae';
var return_count = 0;
var request_count = 0;

function ae_response_action(status, res_body) {
    if(useappprotocol == 'xml') {
        var message = res_body;
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(message.toString(), function (err, result) {
            if (err) {
                console.log('[rtvae xml2js parser error]');
            }
            else {
                var nmtype = (result['m2m:AE'] != null) ? 'long' : 'short';
                if(nmtype == 'long') {
                    var aeid = result['m2m:AE']['AE-ID'];
                }
                else { // 'short'
                    aeid = result['m2m:ae']['aei'];
                }

                console.log('x-m2m-rsc : ' + status + ' - ' + aeid + ' <----');
                useaeid = aeid;
                if(HTTP_SUBSCRIPTION_ENABLE == 1) {
                    server = http.createServer(app);
                    server.listen(useappport, function () {
                        console.log('server running at ' + useappport + ' port');
                    });
                }

                if(MQTT_SUBSCRIPTION_ENABLE == 1) {
                    mqtt_connect(usecbhost);
                }

            }
        });
    }
    else {
        var result = JSON.parse(res_body);
        var nmtype = (result['m2m:AE'] != null) ? 'long' : 'short';
        if(nmtype == 'long') {
            var aeid = result['m2m:AE']['AE-ID'];
        }
        else { // 'short'
            aeid = result['m2m:ae']['aei'];
        }

        console.log('x-m2m-rsc : ' + status + ' - ' + aeid + ' <----');
        useaeid = aeid;
        if(HTTP_SUBSCRIPTION_ENABLE == 1) {
            server = http.createServer(app);
            server.listen(useappport, function () {
                console.log('server running at ' + useappport + ' port');
            });
        }

        if(MQTT_SUBSCRIPTION_ENABLE == 1) {
            mqtt_connect(usecbhost);
        }
    }
}

sh_timer.timer.on('tick', function() {
    if(sh_state == 'crtae') {
        console.log('[sh_state] : ' + sh_state);
        var parent_path = '/' + usecbname;
        sh_adn.crtae(usecbhost, usecbport, parent_path, useappname, useappid, function(status, res_body) {
            if(status == 5106 || status == 2001) {
                ae_response_action(status, res_body);
                sh_state = 'crtct';
            }
            else if(status == 4105) {
                console.log('x-m2m-rsc : ' + status + ' <----');
                sh_state = 'rtvae'
            }
        });
    }
    else if(sh_state == 'rtvae') {
        console.log('[sh_state] : ' + sh_state);
        var path = '/' + usecbname + '/' + useappname;
        sh_adn.rtvae(usecbhost, usecbport, path, function(status, res_body) {
            if(status == 5106 || status == 2000) {
                ae_response_action(status, res_body);
                sh_state = 'crtct';
            }
            else {
                console.log('x-m2m-rsc : ' + status + ' <----');
            }
        });
    }
    else if(sh_state == 'crtct') {
        console.log('[sh_state] : ' + sh_state);
        request_count = 0;
        return_count = 0;
        for(var i = 0; i < usectname.length; i++) {
            request_count++;
            parent_path = '/' + usecbname + usectname[i].parentpath;
            sh_adn.crtct(usecbhost, usecbport, parent_path, usectname[i]['ctname'], function(status, body) {
                console.log('x-m2m-rsc : ' + status + ' <----' + body);
                if(status == 5106 || status == 2001 || status == 4105) {
                    return_count++;
                    if(return_count == request_count) {
                        sh_state = 'delsub';
                    }
                }
            });
        }

        if(request_count == 0) {
            sh_state = 'delsub';
        }
    }
    else if(sh_state == 'delsub') {
        console.log('[sh_state] : ' + sh_state);
        request_count = 0;
        return_count = 0;
        for(i = 0; i < usesubname.length; i++) {
            if(usesubname[i]['subname'] != null) {
                request_count++;
                path = '/' + usecbname + usesubname[i].parentpath + '/' + usesubname[i]['subname'];
                sh_adn.delsub(usecbhost, usecbport, path, usesubname[i]['nu'], function(status, body) {
                    console.log('x-m2m-rsc : ' + status + ' <----' + body);
                    if(status == 5106 || status == 2002 || status == 2000 || status == 4105 || status == 4004) {
                        return_count++;
                        if(return_count == request_count) {
                            sh_state = 'crtsub';
                        }
                    }
                });
            }
        }

        if(request_count == 0) {
            sh_state = 'crtsub';
        }
    }

    else if(sh_state == 'crtsub') {
        console.log('[sh_state] : ' + sh_state);
        request_count = 0;
        return_count = 0;

        for(i = 0; i < usesubname.length; i++) {
            if(usesubname[i]['subname'] != null) {
                if(url.parse(usesubname[i]['nu']).protocol == 'http:') {
                    if(url.parse(usesubname[i]['nu']).hostname == 'autoset') {
                        usesubname[i]['nu'] = 'http://' + ip.address() + ':' + useappport + url.parse(usesubname[i]['nu']).pathname;
                    }
                }
                else if(url.parse(usesubname[i]['nu']).protocol == 'mqtt:') {
                    if(url.parse(usesubname[i]['nu']).hostname == 'autoset') {
                        usesubname[i]['nu'] = 'mqtt://' + usecbhost + '/' + useaeid;
                    }
                }
                request_count++;
                parent_path = '/' + usecbname + usesubname[i].parentpath;
                sh_adn.crtsub(usecbhost, usecbport, parent_path, usesubname[i]['subname'], usesubname[i]['nu'], function(status, body) {
                    console.log('x-m2m-rsc : ' + status + ' <----' + body);
                    if(status == 5106 || status == 2001 || status == 4105) {
                        return_count++;
                        if(return_count == request_count) {
                            sh_state = 'crtci';
                            console.log('[sh_state] : ' + sh_state);

                            tas_ready.emit('connect');
                        }
                    }
                });
            }
        }

        if(request_count == 0) {
            sh_state = 'crtci';
            console.log('[sh_state] : ' + sh_state);

            tas_ready.emit('connect');
        }

    }
    else if(sh_state == 'crtci') {

    }
});


// for notification
var xmlParser = bodyParser.text({ type: '*/*' });


function response_mqtt(mqtt_client, rsp_topic, rsc, to, fr, rqi, inpc, bodytype) {
    var rsp_message = {};
    rsp_message['m2m:rsp'] = {};
    rsp_message['m2m:rsp'].rsc = rsc;
    rsp_message['m2m:rsp'].to = to;
    rsp_message['m2m:rsp'].fr = fr;
    rsp_message['m2m:rsp'].rqi = rqi;
    rsp_message['m2m:rsp'].pc = inpc;

    if(bodytype == 'xml') {
        rsp_message['m2m:rsp']['@'] = {
            "xmlns:m2m": "http://www.onem2m.org/xml/protocols",
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
        };

        var xmlString = js2xmlparser("m2m:rsp", rsp_message['m2m:rsp']);

        mqtt_client.publish(rsp_topic, xmlString);
    }
    else { // 'json'
        mqtt_client.publish(rsp_topic, JSON.stringify(rsp_message));
    }
}

function send_tweet(cinObj) {
    var cur_d = new Date();
    var cur_o = cur_d.getTimezoneOffset() / (-60);
    cur_d.setHours(cur_d.getHours() + cur_o);
    var cur_time = cur_d.toISOString().replace(/\..+/, '');

    var con_arr = (cinObj.con != null ? cinObj.con : cinObj.content).split(',');

    if(cin.con == '') {
        console.log('---- is not cin message');
    }
    else {
        if (parseFloat(con_arr[1]) <= 40.0) {
            if (con_arr[2] != null) {
                var bitmap = new Buffer(con_arr[2], 'base64');
                fs.writeFileSync('decode.jpg', bitmap);

                twitter_client.post('media/upload', {media: bitmap}, function (error, media, response) {
                    if (error) {
                        console.log(error[0].message);
                        return;
                    }
                    // If successful, a media object will be returned.
                    console.log(media);

                    // Lets tweet it
                    var status = {
                        status: '[' + cur_time + '] Give me water ! - ' + con_arr[0] + '\'C , Humi: ' + con_arr[1] + '%',
                        media_ids: media.media_id_string // Pass the media id string
                    };

                    twitter_client.post('statuses/update', status, function (error, tweet, response) {
                        if (!error) {
                            console.log(tweet.text);
                        }
                    });
                });
            }
            else {
                twitter_client.post('statuses/update', {status: '[' + cur_time + '] Give me water ! - ' + con_arr[0] + '\'C , ' + con_arr[1] + '%'}, function (error, tweet, response) {
                    if (error) {
                        console.log(error[0].message);
                        return;
                    }
                    console.log(tweet.text);  // Tweet body.
                    //console.log(response);  // Raw response object.

                });
            }
        }
        else {
            if (con_arr[2] != null) {
                bitmap = new Buffer(con_arr[2], 'base64');
                fs.writeFileSync('decode.jpg', bitmap);

                twitter_client.post('media/upload', {media: bitmap}, function (error, media, response) {
                    if (error) {
                        console.log(error[0].message);
                        return;
                    }
                    // If successful, a media object will be returned.
                    console.log(media);

                    // Lets tweet it
                    var status = {
                        status: '[' + cur_time + '] Ryeubi\'s pot status is Temp: ' + con_arr[0] + '\'C , Humi: ' + con_arr[1] + '%',
                        media_ids: media.media_id_string // Pass the media id string
                    };

                    twitter_client.post('statuses/update', status, function (error, tweet, response) {
                        if (!error) {
                            console.log(tweet.text);
                        }
                    });
                });
            }
            else {
                twitter_client.post('statuses/update', {status: '[' + cur_time + '] Ryeubi\'s pot status is Temp: ' + con_arr[0] + '\'C , Humi: ' + con_arr[1] + '%'}, function (error, tweet, response) {
                    if (error) {
                        console.log(error.message);
                        return;
                    }
                    console.log(tweet.text);  // Tweet body.
                    //console.log(response);  // Raw response object.
                });
            }
        }
    }
}

function send_tas(path_arr, cinObj) {
    var cin = {};
    cin.ctname = path_arr[3];
    cin.con = (cinObj.con != null) ? cinObj.con : cinObj.content;

    if(cin.con == '') {
        console.log('---- is not cin message');
    }
    else {
        //console.log(JSON.stringify(cin));
        console.log('<---- send to tas');

        if (socket_arr[path_arr[3]] != null) {
            socket_arr[path_arr[3]].write(JSON.stringify(cin));
        }
    }
}

function mqtt_noti_action(mqtt_client, topic_arr, jsonObj) {
    if (jsonObj != null) {
        var op = (jsonObj['m2m:rqp']['op'] == null) ? '' : jsonObj['m2m:rqp']['op'];
        var to = (jsonObj['m2m:rqp']['to'] == null) ? '' : jsonObj['m2m:rqp']['to'];
        var fr = (jsonObj['m2m:rqp']['fr'] == null) ? '' : jsonObj['m2m:rqp']['fr'];
        var rqi = (jsonObj['m2m:rqp']['rqi'] == null) ? '' : jsonObj['m2m:rqp']['rqi'];
        var pc = (jsonObj['m2m:rqp']['pc'] == null) ? '' : jsonObj['m2m:rqp']['pc'];

        var nmtype = pc['sgn'] != null ? 'short' : 'long';
        var sgnObj = pc['sgn'] != null ? pc['sgn'] : pc['singleNotification'];

        var bodytype = topic_arr[5];
        if (sgnObj != null && sgnObj != '') {
            if(nmtype == 'long') {
                var path_arr = sgnObj.subscriptionReference.split('/');
                var cinObj = {};
                if(sgnObj.notificationEvent.representation.contentInstance == null) {
                    cinObj.con = '';
                }
                else {
                    cinObj = sgnObj.notificationEvent.representation.contentInstance;
                }
            }
            else { // 'short'
                path_arr = sgnObj.sur.split('/');
                cinObj = {};
                if(sgnObj.nev.rep.cin == null) {
                    cinObj.con = '';
                }
                else {
                    cinObj = sgnObj.nev.rep.cin;
                }
            }

            for(var i = 0; i < usesubname.length; i++) {
                if (usesubname[i].parentpath.split('/')[2] == path_arr[3]) {
                    if (usesubname[i].subname == path_arr[4]) {
                        var rsp_topic = '/oneM2M/resp/' + topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5];
                        response_mqtt(mqtt_client, rsp_topic, 2001, '', useaeid, rqi, '', topic_arr[5]);

                        //console.log((cinObj.con != null ? cinObj.con : cinObj.content));
                        console.log('mqtt ' + bodytype + ' ' + nmtype + ' notification <----');

                        //send_tweet(cinObj);
                        send_tas(path_arr, cinObj);
                    }
                }
            }
        }
        else {
            console.log('[mqtt-noti] message is not mine');
        }
    }
    else {
        console.log('[mqtt-noti] message is not noti');
    }
}

function mqtt_connect(serverip) {
    var noti_topic = util.format('/oneM2M/req/+/%s/#', useaeid);
    var mqtt_client = mqtt.connect('mqtt://' + serverip);

    mqtt_client.on('connect', function () {
        mqtt_client.subscribe(noti_topic);
    });

    mqtt_client.on('message', function (topic, message) {
        var topic_arr = topic.split("/");

        if(topic_arr[5] != null) {
            var bodytype = (topic_arr[5] == 'xml') ? topic_arr[5] : ((topic_arr[5] == 'json') ? topic_arr[5] : 'json');
        }

        if(topic_arr[1] == 'oneM2M' && topic_arr[2] == 'req' && topic_arr[4] == useaeid) {
            if(bodytype == 'xml') {
                var parser = new xml2js.Parser({explicitArray: false});
                parser.parseString(message.toString(), function (err, result) {
                    if (err) {
                        console.log('[mqtt noti xml2js parser error]');
                    }
                    else {
                        mqtt_noti_action(mqtt_client, topic_arr, result);
                    }
                });
            }
            else { // json
                var jsonObj = JSON.parse(message.toString());
                mqtt_noti_action(mqtt_client, topic_arr, jsonObj);
            }
        }
        else {
            console.log('topic is not supported');
        }
    });
}



var noti_count = 0;
app.post('/:resourcename0', xmlParser, function(request, response, next) {
    noti_count = 0;
    for(var i = 0; i < usesubname.length; i++) {
        if(usesubname[i]['nu'] != null) {
            var nu_path = url.parse(usesubname[i]['nu']).pathname.toString().split('/')[1];
            if (nu_path == request.params.resourcename0) {
                var content_type = request.headers['content-type'];
                if((content_type != 'application/vnd.onem2m-ntfy+xml') && (content_type != 'application/vnd.onem2m-ntfy+json')) {
                    console.log('Bad Request : content-type');
                    response.setHeader('X-M2M-RSC', '4000');
                    response.status(400).end('<h1>Bad Request : content-type</h1>');
                    return;
                }

                noti_count++;
                console.log('[CO notification <-- ' + request.headers['x-m2m-origin'] + ']');
                //console.log('[CO notification] Accept: ' + request.headers.accept);
                //console.log('[CO notification] Content-Type: ' + request.headers['content-type']);
                //console.log('[CO notification] x-m2m-ri: ' + request.headers['x-m2m-ri']);
                //console.log('[CO notification] X-M2M-Origin: ' + request.headers['x-m2m-origin']);
                //console.log('[CO notification] locale: ' + request.headers.locale);

                var bodytype = content_type.split('+')[1];
                if (bodytype == 'json') {
                    var result = request.body;
                    var nmtype = result['m2m:sgn'] != null ? 'short' : 'long';
                    var sgnObj = result['m2m:sgn'] != null ? result['m2m:sgn'] : result['m2m:singleNotification'];

                    if(nmtype == 'long') {
                        var path_arr = sgnObj.subscriptionReference.split('/');
                        var cinObj = {};
                        if(sgnObj.notificationEvent.representation.contentInstance == null) {
                            cinObj.con = '';
                        }
                        else {
                            cinObj = sgnObj.notificationEvent.representation.contentInstance;
                        }
                    }
                    else { // 'short'
                        path_arr = sgnObj.sur.split('/');
                        cinObj = {};
                        if(sgnObj.nev.rep.cin == null) {
                            cinObj.con = '';
                        }
                        else {
                            cinObj = sgnObj.nev.rep.cin;
                        }
                    }

                    for(var j = 0; j < usesubname.length; j++) {
                        if (usesubname[j].parentpath.split('/')[2] == path_arr[3]) {
                            if (usesubname[j].subname == path_arr[4]) {
                                response.setHeader('X-M2M-RSC', '2001');
                                response.setHeader('X-M2M-RI', request.headers['x-m2m-ri']);
                                response.status(201).end('<h1>success to receive notification</h1>');

                                //console.log((cinObj.con != null ? cinObj.con : cinObj.content));
                                console.log('http ' + bodytype + ' ' + nmtype + ' notification <----');

                                //send_tweet(cinObj);
                                send_tas(path_arr, cinObj);
                            }
                        }
                    }
                }
                else {
                    console.log(request.body);
                    var parser = new xml2js.Parser({explicitArray: false});
                    parser.parseString(request.body.toString(), function (err, result) {
                        if (err) {
                            console.log("Parsing An error occurred trying to read in the file: " + err);
                            console.log("error : set to default for configuration")
                        }
                        else {
                            var nmtype = result['m2m:sgn'] != null ? 'short' : 'long';
                            var sgnObj = result['m2m:sgn'] != null ? result['m2m:sgn'] : result['m2m:singleNotification'];

                            if (nmtype == 'long') {
                                var path_arr = sgnObj.subscriptionReference.split('/');
                                var cinObj = {};
                                if (sgnObj.notificationEvent.representation.contentInstance == null) {
                                    cinObj.con = '';
                                }
                                else {
                                    cinObj.con = sgnObj.notificationEvent.representation.contentInstance.content;
                                }
                            }
                            else { // 'short'
                                path_arr = sgnObj.sur.split('/');
                                cinObj = {};
                                if (sgnObj.nev.rep.cin == null) {
                                    cinObj.con = '';
                                }
                                else {
                                    cinObj.con = sgnObj.nev.rep.cin.con;
                                }
                            }
                        }

                        for(var j = 0; j < usesubname.length; j++) {
                            if (usesubname[j].parentpath.split('/')[2] == path_arr[3]) {
                                if (usesubname[j].subname == path_arr[4]) {
                                    response.setHeader('X-M2M-RSC', '2001');
                                    response.setHeader('X-M2M-RI', request.headers['x-m2m-ri']);
                                    response.status(201).end('<h1>success to receive notification</h1>');

                                    //console.log((cinObj.con != null ? cinObj.con : cinObj.content));
                                    console.log('http ' + bodytype + ' ' + nmtype + ' notification <----');

                                    //send_tweet(cinObj);
                                    send_tas(path_arr, cinObj);
                                }
                            }
                        }
                    });
                }
            }
        }
    }

    if(noti_count == 0) {
        response.setHeader('X-M2M-RSC', '0404');
        if (request.headers['x-m2m-ri'] != null) {
            response.setHeader('X-M2M-RI', request.headers['x-m2m-ri']);
        }

        response.status(404).end('<h1>Do not support</h1>');
    }
});

app.get('/conf', xmlParser, function(request, response, next) {

});
