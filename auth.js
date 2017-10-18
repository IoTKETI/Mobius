/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

var onem2mParser, responder, crypto, db, db_sql;


function check_head_auth(request, response, callback) {
    // Check Authorization Header
    var ip = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
    var agent = request.headers['user-agent'];
    //logger.log("debug",'>>>>>>>ip:',ip, ip.indexOf("127.0.0.1"), request.url);
    
    if (agent==undefined) {
        // it happens when locally invoked
        //logger.log("debug",'>>>>>>>NO user-agent!!!!!!!!!!!!');
        callback('1');
        return '1';
    } else {
        // external request
        //logger.log("debug",'>>>>>>>user-agent:',agent);
    }
    
    if ((request.headers['authorization'] == null || request.headers['authorization'] == '')) {
        
        request.headers.rootnm = 'dbg';
        request.headers.usebodytype = 'json';
        
        responder.error_result(request, response, 401, 4001, 'Authorization Header is null');
        callback('0');
        return '0';
    } else {
        // auth header present
        var context = request.url.split(/[?#]/)[0].replace("/"+usecsebase+"/", "").split("/")[0];
		var auth = request.headers['authorization'].replace("Basic ", "").trim();
        auth = new Buffer(auth, 'base64').toString();
        //logger.log("debug",'>>>>>>>auth: ',request.headers['authorization'],auth,"context:",context,"url:",request.url);
        var usr_parts = auth.split(":");
        //logger.log("debug",'>>>>>>>usr_parts: ',usr_parts);
        if (usr_parts.length!=2) {
            responder.error_result(request, response, 401, 4001, 'Unauthorized');
            callback('0');
            return '0';
        }
        // superadm_usr
        if (usr_parts[0]==superadm_usr && usr_parts[1]==superadm_pwd) {
            //logger.log("debug",'>>>>>>>user: SUPERADMIN');
            callback('1');
            return '1';
        }
        // check other users
        if (request.url=="/"+usecsebase) {
            // root not accessible for other users
            responder.error_result(request, response, 401, 4001, 'Unauthorized');
            callback('0');
            return '0';
        }
        var pwd_hash = crypto.createHash('sha256').update(usr_parts[1]).digest('base64');
        db_sql.get_user(usr_parts[0], 
            function (user_Obj) {
                logger.log("debug",'>>>>>>>user: ',user_Obj);
                if (user_Obj==null || (Array.isArray(user_Obj) && user_Obj.length==0)) {
                    // user not present
                    responder.error_result(request, response, 401, 4001, 'Unauthorized');
                    callback('0');
                    return '0';
                } else if (user_Obj[0].password!=pwd_hash) {
                    // password not match
                    responder.error_result(request, response, 401, 4001, 'Unauthorized');
                    callback('0');
                    return '0';
                } else {
                    logger.log("debug",'>>>>>>>user2: ',user_Obj,"url:",request.url);
                    // ok user present
                    if (user_Obj[0].role=="tenant") {
                        if (user_Obj[0].context.indexOf(context)!=-1 && context) {
                            // ok, context enabled fot this user
                            callback('1');
                            return '1';
                        } else {
                            // context not match
                            responder.error_result(request, response, 403, 4003, 'Forbidden');
                            callback('0');
                            return '0';
                        }
                    } else if (user_Obj[0].role=="guest") {
                        logger.log("debug",'>>>>>>>user: ',request.url, user_Obj);
                        var uris = user_Obj[0].context.split(","), test = false;
                        for (var k in uris) {
//                            if (request.url.indexOf(uris[k])==0) test = true;
                            if (request.url == uris[k]) {
                                test = true;
                                break;
                            } else if (match(request.url, uris[k])) {
                                test = true;
                                break;
                            }
                        }
                        if (test) {
                            // ok, context enabled fot this user
                            if (request.method=="POST") {
                                try {
                                    var content_type = request.headers['content-type'].split(';');
                                }
                                catch (e) {
                                    responder.error_result(request, response, 400, 4000, 'content-type is null');
                                    callback('0');
                                    return '0';
                                }
                                try {
                                    var ty = content_type[1].split('=')[1];
                                }
                                catch (e) {
                                    responder.error_result(request, response, 400, 4000, 'ty is null');
                                    callback('0');
                                    return '0';
                                }
                                if (ty=='4' || ty=='23') {
                                    // ok, context and POST CIN, SUB enabled fot this guest
                                    callback('1');
                                    return '1';
                                } else {
                                    responder.error_result(request, response, 415, 4015, 'You are not enabled to create resource of this type');
                                    callback('0');
                                    return '0';
                                }
                            } else if (request.method=="GET") {
                                callback('1');
                                return '1';
                            } else {
                                responder.error_result(request, response, 405, 4005, 'Method Not Allowed');
                                callback('0');
                                return '0';
                            }
                        } else {
                            // context not match
                            responder.error_result(request, response, 403, 4003, 'Forbidden');
                            callback('0');
                            return '0';
                        }

                    }
                }
            }
        );
    }
    
    function match(txt, regularExpression) {
        var re1 = new RegExp('^'+regularExpression+'/');
        var re2 = new RegExp('^'+regularExpression+'?');
        return re1.test(txt) || re2.test(txt);
    }
}

module.exports = {};

module.exports.check_head_auth = check_head_auth;

module.exports.init = function(deps){
    console.log('[auth].init');
    // dependencies
    onem2mParser = deps.onem2mParser;
    responder = deps.responder;
    crypto = deps.crypto;
    db_sql = deps.db_sql;
    db = deps.db;
    logger = deps.logger;
}
