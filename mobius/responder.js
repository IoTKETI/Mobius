/**
 * Copyright (c) 2015, OCEAN
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2015, OCEAN
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var merge = require('merge');
var js2xmlparser = require("js2xmlparser");


var _this = this;



const attrLname = {
    "acpi": "accessControlPolicyIDs",
    "aa":   "announcedAttribute",
    "at":   "announceTo",
    "ct":   "creationTime",
    "et":   "expirationTime",
    "lbl":  "labels",
    "lt":   "lastModifiedTime",
    "pi":   "parentID",
    "ri":   "resourceID",
    "ty":  "resourceType",
    "st":   "stateTag",
    "rn":   "resourceName",
    "pv":   "privileges",
    "pvs":  "selfPrivileges",
    "api":  "App-ID",
    "aei":  "AE-ID",
    "apn":  "appName",
    "poa":  "pointOfAccess",
    "or":   "ontologyRef",
    "nl":   "nodeLink",
    "cr":   "creator",
    "mni":  "maxNrOfInstances",
    "mbs":  "maxByteSize",
    "mia":  "maxInstanceAge",
    "cni":  "currentNrOfInstances",
    "cbs":  "currentByteSize",
    "li":   "locationID",
    "cnf":  "contentInfo",
    "cs":   "contentSize",
    "pc":  "primitiveContent ",
    "con":  "content",
    "cst":  "cseType",
    "csi":  "CSE-ID",
    "srt":  "supportedResourceType",
    "ncp":  "notificationCongestionPolicy",
    "sr":   "source",
    "tg":   "target",
    "ls":   "lifespan",
    "ec":  "eventCat",
    "dmd":  "deliveryMetaData",
    "arq":  "aggregatedRequest",
    "agr":  "aggregatedResponse",
    "evi":  "eventID",
    "net":  "notificationEventType",
    "evs":  "evenStart",
    "eve":  "eventEnd",
    "opt":  "operationType",
    "ds":   "dataSize",
    "exs":  "execStatus",
    "exr":  "execResult",
    "exd":  "execDisable",
    "ext":  "execTarget",
    "exm":  "execMode",
    "exf":  "execFrequency",
    "exy":  "execDelay",
    "exn":  "execNumber",
    "exra": "execReqArgs",
    "exe":  "execEnable",
    "mt":   "memberType",
    "cnm":  "currentNrOfMembers",
    "mnm":  "maxNrOfMembers",
    "mid":  "memberIDs",
    "macp": "membersAccessControlPolicyIDs",
    "mtv":  "memberTypeValidated",
    "csy":  "consistencyStrategy",
    "gn":   "groupName",
    "los":  "locationSource",
    "lou":  "locationUpdatePeriod",
    "lot":  "locationTargetId",
    "lor":  "locationServer",
    "loi":  "locationContainerID",
    "lon":  "locationContainerName",
    "lost": "locationStatus",
    "svr":  "serviceRoles",
    "dc":   "description",
    "cmt":  "cmdType",
    "mgd":  "mgmtDefinition",
    "obis": "objectIDs",
    "obps": "objectPaths",
    "ni":   "nodeID",
    "hcl":  "hostedCSELink",
    "cb":   "CSEBase",
    "mei":  "M2M-Ext-ID",
    "tri":  "Trigger-Recipient-ID",
    "rr":   "requestReachability",
    "og":   "originator",
    "mi":   "metaInformation",
    "rs":   "requestStatus",
    "ol":   "operationResult",
    "opn":  "operation",
    "rid":  "requestID",
    "se":   "scheduleElement",
    "di":   "deviceIdentifier",
    "rlk":  "ruleLinks",
    "sci":  "statsCollectID",
    "cei":  "collectingEntityID",
    "cdi":  "collectedEntityID",
    "ss":   "devStatus",
    "srs":  "statsRuleStatus",
    "sm":   "statModel",
    "cp":   "collectPeriod",
    "enc":  "eventNotificationCriteria",
    "exc":  "expirationCounter",
    "nu":   "notificationURI",
    "gpi":  "groupID",
    "nfu":  "notificationForwardingURI",
    "bn":   "batchNotify",
    "rl":   "rateLimit",
    "psn":  "preSubscriptionNotify",
    "pn":   "pendingNotification",
    "nsp":  "notificationStoragePriority",
    "ln":   "latestNotify",
    "nct":  "notificationContentType",
    "nec":  "notificationEventCat",
    "su":   "subscriberURI",
    "vr":   "version",
    "url":  "URL",
    "ud":   "update",
    "uds":  "updateStatus",
    "in":   "install",
    "un":   "uninstall",
    "ins":  "installStatus",
    "act":  "activate",
    "dea":  "deactivate",
    "acts": "activeStatus",
    "mma":  "memAvailable",
    "mmt":  "memTotal",
    "ant":  "areaNwkType",
    "ldv":  "listOfDevices",
    "dvd":  "devId",
    "dvt":  "devType",
    "awi":  "areaNwkId",
    "sli":  "sleepInterval",
    "sld":  "sleepDuration",
    "lnh":  "listOfNeighbors",
    "btl":  "batteryLevel",
    "bts":  "batteryStatus",
    "dlb":  "deviceLabel",
    "man":  "manufacturer",
    "mod":  "model",
    "dty":  "deviceType",
    "fwv":  "fwVersion",
    "swv":  "swVersion",
    "hwv":  "hwVersion",
    "can":  "capabilityName",
    "att":  "attached",
    "cas":  "capabilityActionStatus",
    "ena":  "enable",
    "dis":  "disable",
    "cus":  "currentState",
    "rbo":  "reboot",
    "far":  "factoryReset",
    "lgt":  "logTypeId",
    "lgd":  "logData",
    "lgs":  "logActionStatus",
    "lgst": "logStatus",
    "lga":  "logStart",
    "lgo":  "logStop",
    "fwnnam":"firmwareNames",
    "swn":  "softwareName",
    "cpn":  "cmdhPolicyName",
    "cmlk": "mgmtLink",
    "acmlk":"activeCmdhPolicyLink",
    "od":   "order",
    "dev":  "defEcValue",
    "ror":  "requestOrigin",
    "rct":  "requestContext",
    "rcn":  "requestContextNotification",
    "rch":  "requestCharacteristics",
    "aecs": "applicableEventCategories",
    "aec":  "applicableEventCategory",
    "dqet": "defaultRequestExpTime",
    "dset": "defaultResultExpTime",
    "doet": "defaultOpExecTime",
    "drp":  "defaultRespPersistence",
    "dda":  "defaultDelAggregation",
    "lec":  "limitsEventCategory",
    "lqet": "limitsRequestExpTime",
    "lset": "limitsResultExpTime",
    "loet": "limitsOpExecTime",
    "lrp":  "limitsRespPersistence",
    "lda":  "limitsDelAggregation",
    "ttn":  "targetNetwork",
    "mrv":  "minReqVolume",
    "bop":  "backOffParameters",
    "ohc":  "otherConditions",
    "mbfs": "maxBufferSize",
    "sgp":  "storagePriority",
    "apci": "applicableCredIDs",
    "aai":  "allowedApp-IDs",
    "aae":  "allowedAEs",
    "uril": "URIList",
    "sgn":  "singleNotification",
    "nev":  "notificationEvent",
    "rep":  "representation",
    "sur": "subscriptionReference",
    "rsp": "responsePrimitive",
    "dspt": "descriptor",
    "cap":"caption",
    "pin":"periodicInterval",
    "mdd":"missingDataDetect",
    "mdmn":"missingDataMaxNr",
    "mdl":"missingDataList",
    "mdcn":"missingDataCurrentNr",
    "mddt":"missingDataDetectTimer",
    "dgt":"dataGenerationTime",
    "sqn":"sequenceNr",
    "sid":"sessionID",
    "soid":"sessionOriginatorID",
    "stid":"SessionTargetID",
    "asd":"acceptedSessionDescription",
    "osd":"offeredSessionDescriptions",
    "sst":"sessionState",
    "acr":"accessControlRule",
    "acor":"accessControlOriginators",
    "acop":"accessControlOperations",
    "acco":"accessControlContexts",
    "actw":"accessControWindow",
    "acip":"accessControlIpAddresses"
};

const attrSname = {
    "accessControlPolicyIDs"       :"acpi",
    "announcedAttribute"           :"aa",
    "announceTo"                   :"at",
    "creationTime"                 :"ct",
    "expirationTime"               :"et",
    "labels"                       :"lbl",
    "lastModifiedTime"             :"lt",
    "parentID"                     :"pi",
    "resourceID"                   :"ri",
    "resourceType"                 :"ty*",
    "stateTag"                     :"st",
    "resourceName"                 :"rn",
    "privileges"                   :"pv",
    "selfPrivileges"               :"pvs",
    "App-ID"                       :"api",
    "AE-ID"                        :"aei",
    "appName"                      :"apn",
    "pointOfAccess"                :"poa",
    "ontologyRef"                  :"or",
    "nodeLink"                     :"nl",
    "creator"                      :"cr",
    "maxNrOfInstances"             :"mni",
    "maxByteSize"                  :"mbs",
    "maxInstanceAge"               :"mia",
    "currentNrOfInstances"         :"cni",
    "currentByteSize"              :"cbs",
    "locationID"                   :"li",
    "contentInfo"                  :"cnf",
    "contentSize"                  :"cs",
    "primitiveContent "            :"pc*",
    "content"                      :"con",
    "cseType"                      :"cst",
    "CSE-ID"                       :"csi",
    "supportedResourceType"        :"srt",
    "notificationCongestionPolicy" :"ncp",
    "source"                       :"sr",
    "target"                       :"tg",
    "lifespan"                     :"ls",
    "eventCat"                     :"ec*",
    "deliveryMetaData"             :"dmd",
    "aggregatedRequest"            :"arq",
    "aggregatedResponse"           :"agr",
    "eventID"                      :"evi",
    "notificationEventType"        :"net",
    "evenStart"                    :"evs",
    "eventEnd"                     :"eve",
    "operationType"                :"opt",
    "dataSize"                     :"ds",
    "execStatus"                   :"exs",
    "execResult"                   :"exr",
    "execDisable"                  :"exd",
    "execTarget"                   :"ext",
    "execMode"                     :"exm",
    "execFrequency"                :"exf",
    "execDelay"                    :"exy",
    "execNumber"                   :"exn",
    "execReqArgs"                  :"exra",
    "execEnable"                   :"exe",
    "memberType"                   :"mt",
    "currentNrOfMembers"           :"cnm",
    "maxNrOfMembers"               :"mnm",
    "memberIDs"                    :"mid",
    "membersAccessControlPolicyIDs":"macp",
    "memberTypeValidated"          :"mtv",
    "consistencyStrategy"          :"csy",
    "groupName"                    :"gn",
    "locationSource"               :"los",
    "locationUpdatePeriod"         :"lou",
    "locationTargetId"             :"lot",
    "locationServer"               :"lor",
    "locationContainerID"          :"loi",
    "locationContainerName"        :"lon",
    "locationStatus"               :"lost",
    "serviceRoles"                 :"svr",
    "description"                  :"dc",
    "cmdType"                      :"cmt",
    "mgmtDefinition"               :"mgd",
    "objectIDs"                    :"obis",
    "objectPaths"                  :"obps",
    "nodeID"                       :"ni",
    "hostedCSELink"                :"hcl",
    "CSEBase"                      :"cb",
    "M2M-Ext-ID"                   :"mei",
    "Trigger-Recipient-ID"         :"tri",
    "requestReachability"          :"rr",
    "originator"                   :"og",
    "metaInformation"              :"mi",
    "requestStatus"                :"rs",
    "operationResult"              :"ol",
    "operation"                    :"opn",
    "requestID"                    :"rid",
    "scheduleElement"              :"se",
    "deviceIdentifier"             :"di",
    "ruleLinks"                    :"rlk",
    "statsCollectID"               :"sci",
    "collectingEntityID"           :"cei",
    "collectedEntityID"            :"cdi",
    "devStatus"                    :"ss",
    "statsRuleStatus"              :"srs",
    "statModel"                    :"sm",
    "collectPeriod"                :"cp",
    "eventNotificationCriteria"    :"enc",
    "expirationCounter"            :"exc",
    "notificationURI"              :"nu",
    "groupID"                      :"gpi",
    "notificationForwardingURI"    :"nfu",
    "batchNotify"                  :"bn",
    "rateLimit"                    :"rl",
    "preSubscriptionNotify"        :"psn",
    "pendingNotification"          :"pn",
    "notificationStoragePriority"  :"nsp",
    "latestNotify"                 :"ln",
    "notificationContentType"      :"nct",
    "notificationEventCat"         :"nec",
    "subscriberURI"                :"su",
    "version"                      :"vr",
    "URL"                          :"url",
    "update"                       :"ud",
    "updateStatus"                 :"uds",
    "install"                      :"in",
    "uninstall"                    :"un",
    "installStatus"                :"ins",
    "activate"                     :"act",
    "deactivate"                   :"dea",
    "activeStatus"                 :"acts",
    "memAvailable"                 :"mma",
    "memTotal"                     :"mmt",
    "areaNwkType"                  :"ant",
    "listOfDevices"                :"ldv",
    "devId"                        :"dvd",
    "devType"                      :"dvt",
    "areaNwkId"                    :"awi",
    "sleepInterval"                :"sli",
    "sleepDuration"                :"sld",
    "listOfNeighbors"              :"lnh",
    "batteryLevel"                 :"btl",
    "batteryStatus"                :"bts",
    "deviceLabel"                  :"dlb",
    "manufacturer"                 :"man",
    "model"                        :"mod",
    "deviceType"                   :"dty",
    "fwVersion"                    :"fwv",
    "swVersion"                    :"swv",
    "hwVersion"                    :"hwv",
    "capabilityName"               :"can",
    "attached"                     :"att",
    "capabilityActionStatus"       :"cas",
    "enable"                       :"ena",
    "disable"                      :"dis",
    "currentState"                 :"cus",
    "reboot"                       :"rbo",
    "factoryReset"                 :"far",
    "logTypeId"                    :"lgt",
    "logData"                      :"lgd",
    "logActionStatus"              :"lgs",
    "logStatus"                    :"lgst",
    "logStart"                     :"lga",
    "logStop"                      :"lgo",
    "firmwareNames"                :"fwnnam",
    "softwareName"                 :"swn",
    "cmdhPolicyName"               :"cpn",
    "mgmtLink"                     :"cmlk",
    "activeCmdhPolicyLink"         :"acmlk",
    "order"                        :"od",
    "defEcValue"                   :"dev",
    "requestOrigin"                :"ror",
    "requestContext"               :"rct",
    "requestContextNotification"   :"rcn",
    "requestCharacteristics"       :"rch",
    "applicableEventCategories"    :"aecs",
    "applicableEventCategory"      :"aec",
    "defaultRequestExpTime"        :"dqet",
    "defaultResultExpTime"         :"dset",
    "defaultOpExecTime"            :"doet",
    "defaultRespPersistence"       :"drp",
    "defaultDelAggregation"        :"dda",
    "limitsEventCategory"          :"lec",
    "limitsRequestExpTime"         :"lqet",
    "limitsResultExpTime"          :"lset",
    "limitsOpExecTime"             :"loet",
    "limitsRespPersistence"        :"lrp",
    "limitsDelAggregation"         :"lda",
    "targetNetwork"                :"ttn",
    "minReqVolume"                 :"mrv",
    "backOffParameters"            :"bop",
    "otherConditions"              :"ohc",
    "maxBufferSize"                :"mbfs",
    "storagePriority"              :"sgp",
    "applicableCredIDs"            :"apci",
    "allowedApp-IDs"               :"aai",
    "allowedAEs"                   :"aae",
    "URIList"                      :"uril",
    "singleNotification":  "sgn",
    "notificationEvent": "nev" ,
    "representation":"rep",
    "subscriptionReference":"sur",
    "responsePrimitive":"rsp",
    "descriptor":"dspt",
    "caption":"cap",
    "periodicInterval":"pin",
    "missingDataDetect":"mdd",
    "missingDataMaxNr":"mdmn",
    "missingDataList":"mdl",
    "missingDataCurrentNr":"mdcn",
    "missingDataDetectTimer":"mddt",
    "dataGenerationTime":"dgt",
    "sequenceNr":"sqn",
    "sessionID":"sid",
    "sessionOriginatorID":"soid",
    "SessionTargetID":"stid",
    "acceptedSessionDescription":"asd",
    "offeredSessionDescriptions":"osd",
    "sessionState":"sst",
    "accessControlRule":"acr",
    "accessControlOriginators":"acor",
    "accessControlOperations":"acop",
    "accessControlContexts":"acco",
    "accessControWindow":"actw",
    "accessControlIpAddresses":"acip"
};

const rsrcLname = {
    "cb" : "CSEBase",
    "ae" : "AE",
    "csr": "remoteCSE",
    "cnt": "container",
    "cin": "contentInstance",
    "sub": "subscription",
    "ts" : "timeSeries",
    "tsi": "timeSeriesInstance",
    "uril" :"URIList",
    "sd":"semanticDescriptor",
    "rsp": "responsePrimitive",
    "acp":"accessControlPolicy",
    "acpA":"accessControlPolicyAnnc",
    "aeA":"AEAnnc",
    "cntA":"containerAnnc",
    "la":"latest",
    "ol":"oldest",
    "cinA":"contentInstanceAnnc",
    "dlv":"delivery",
    "evcg":"eventConfig",
    "exin":"execInstance",
    "fopt":"fanOutPoint",
    "grp":"group",
    "grpA":"groupAnnc",
    "lcp":"locationPolicy",
    "lcpA":"locationPolicyAnnc",
    "mssp":"m2mServiceSubscriptionProfile",
    "mgc":"mgmtCmd",
    "mgo":"mgmtObj",
    "mgoA":"mgmtObjAnnc",
    "nod":"node",
    "nodA":"nodeAnnc",
    "pch":"pollingChannel",
    "pcu":"pollingChannelURI",
    "csrA":"remoteCSEAnnc",
    "req":"request",
    "sch":"schedule",
    "schA":"scheduleAnnc",
    "asar":"serviceSubscribedAppRule",
    "svsn":"serviceSubscribedNode",
    "stcl":"statsCollect",
    "stcg":"statsConfig",
    "fwr":"firmware",
    "fwrA":"firmwareAnnc",
    "swr":"software",
    "swrA":"softwareAnnc",
    "mem":"memory",
    "memA":"memoryAnnc",
    "ani":"areaNwkInfo",
    "aniA":"areaNwkInfoAnnc",
    "andi":"areaNwkDeviceInfo",
    "andiA":"areaNwkDeviceInfoAnnc",
    "bat":"battery",
    "batA":"batteryAnnc",
    "dvi":"deviceInfo",
    "dviA":"deviceInfoAnnc",
    "dvc":"deviceCapability",
    "dvcA":"deviceCapabilityAnnc",
    "rbo":"reboot",
    "rboA":"rebootAnnc",
    "evl":"eventLog",
    "evlA":"eventLogAnnc",
    "cmp":"cmdhPolicy",
    "acmp":"activeCmdhPolicy",
    "cmdf":"cmdhDefaults",
    "cmdv":"cmdhDefEcValue",
    "cmpv":"cmdhEcDefParamValues",
    "cml":"cmdhLimits",
    "cmnr":"cmdhNetworkAccessRules",
    "cmwr":"cmdhNwAccessRule",
    "cmbf":"cmdhBuffer",
    "mms": "multimediaSession"
};


const rsrcSname = {
    "CSEBase"           : "cb",
    "AE"                : "ae",
    "remoteCSE"         : "csr",
    "container"         : "cnt",
    "contentInstance"   : "cin",
    "subscription"      : "sub",
    "timeSeries"        : "ts",
    "timeSeriesInstance": "tsi",
    "URIList"            :"uril",
    "semanticDescriptor":"sd",
    "responsePrimitive":"rsp",
    "accessControlPolicy":"acp",
    "accessControlPolicyAnnc":"acpA",
    "AEAnnc":"aeA",
    "containerAnnc":"cntA",
    "latest":"la",
    "oldest":"ol",
    "contentInstanceAnnc":"cinA",
    "delivery":"dlv",
    "eventConfig":"evcg",
    "execInstance":"exin",
    "fanOutPoint":"fopt",
    "group":"grp",
    "groupAnnc":"grpA",
    "locationPolicy":"lcp",
    "locationPolicyAnnc":"lcpA",
    "m2mServiceSubscriptionProfile":"mssp",
    "mgmtCmd":"mgc",
    "mgmtObj":"mgo",
    "mgmtObjAnnc":"mgoA",
    "node":"nod",
    "nodeAnnc":"nodA",
    "pollingChannel":"pch",
    "pollingChannelURI":"pcu",
    "remoteCSEAnnc":"csrA",
    "request":"req",
    "schedule":"sch",
    "scheduleAnnc":"schA",
    "serviceSubscribedAppRule":"asar",
    "serviceSubscribedNode":"svsn",
    "statsCollect":"stcl",
    "statsConfig":"stcg",
    "firmware":"fwr",
    "firmwareAnnc":"fwrA",
    "software":"swr",
    "softwareAnnc":"swrA",
    "memory":"mem",
    "memoryAnnc":"memA",
    "areaNwkInfo":"ani",
    "areaNwkInfoAnnc":"aniA",
    "areaNwkDeviceInfo":"andi",
    "areaNwkDeviceInfoAnnc":"andiA",
    "battery":"bat",
    "batteryAnnc":"batA",
    "deviceInfo":"dvi",
    "deviceInfoAnnc":"dviA",
    "deviceCapability":"dvc",
    "deviceCapabilityAnnc":"dvcA",
    "reboot":"rbo",
    "rebootAnnc":"rboA",
    "eventLog":"evl",
    "eventLogAnnc":"evlA",
    "cmdhPolicy":"cmp",
    "activeCmdhPolicy":"acmp",
    "cmdhDefaults":"cmdf",
    "cmdhDefEcValue":"cmdv",
    "cmdhEcDefParamValues":"cmpv",
    "cmdhLimits":"cml",
    "cmdhNetworkAccessRules":"cmnr",
    "cmdhNwAccessRule":"cmwr",
    "cmdhBuffer":"cmbf",
    "multimediaSession": "mms"
};


const typeRsrc = {
    "1": "acp",
    "2": "ae",
    "3": "cnt",
    "4": "cin",
    "5": "cb",
    "9": "grp",
    "10": "lcp",
//    "13": "mgo",
//    "14": "nod",
    "16": "csr",
//    "17": "req",
    "23": "sub",
    "25": "ts",
    "26": "tsi",
    "27": "mms",
    "28": "sd",
    "99": "rsp"
};

exports.typeRsrc = typeRsrc;
exports.rsrcSname = rsrcSname;
exports.rsrcLname = rsrcLname;
exports.attrLname = attrLname;
exports.attrSname = attrSname;


exports.response_result = function(request, response, status, body_Obj, rsc, ri, cap) {
    response.setHeader('X-M2M-RI', request.headers['x-m2m-ri']);

    if(request.headers.locale != null) {
        response.setHeader('locale', request.headers.locale);
    }

    if(request.query.rcn == 0) {
        response.setHeader('X-M2M-RSC', rsc);
        response.status(status).end('');

        var rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = ri;
        rspObj.sts = cap;
        console.log(JSON.stringify(rspObj));
    }
    else {
        var rootnm = request.headers.rootnm;

        if (Object.keys(body_Obj)[0] == 'rsp') {
            rootnm = 'rsp';
        }

        if (Object.keys(body_Obj)[0] == 'cb' || Object.keys(body_Obj)[0] == 'csr' || Object.keys(body_Obj)[0] == 'ae' || Object.keys(body_Obj)[0] == 'acp') {
            delete body_Obj[rootnm].st;
        }

        if(body_Obj[rootnm].pv) {
            body_Obj[rootnm]['pv']['acr'].splice(body_Obj[rootnm]['pv']['acr'].length-1, 1);
        }
        
        if(body_Obj[rootnm].pvs) {
            body_Obj[rootnm]['pvs']['acr'].splice(body_Obj[rootnm]['pvs']['acr'].length-1, 1);
        }

        if (request.headers.nmtype == 'long') {
            for (var index in body_Obj[rootnm]) {
                if (index == "$") {
                    delete body_Obj['m2m:' + rsrcShortName][index];
                    continue;
                }
                else if (index == 'enc') {
                    body_Obj[rootnm][attrLname[index]] = {};
                    body_Obj[rootnm][attrLname[index]][attrLname['net']] = body_Obj[rootnm][index]['net'];
                }
                else if (index == 'pv' || index == 'pvs') {
                    body_Obj[rootnm][attrLname[index]] = {};
                    for (var sub_attr in body_Obj[rootnm][index]) {
                        body_Obj[rootnm][attrLname[index]][attrLname[sub_attr]] = [];
                        for (var sub_attr2 in body_Obj[rootnm][index][sub_attr]) {
                            body_Obj[rootnm][attrLname[index]][attrLname[sub_attr]][sub_attr2] = {};
                            for (var sub_attr3 in body_Obj[rootnm][index][sub_attr][sub_attr2]) {
                                body_Obj[rootnm][attrLname[index]][attrLname[sub_attr]][sub_attr2][attrLname[sub_attr3]] = body_Obj[rootnm][index][sub_attr][sub_attr2][sub_attr3];
                            }
                        }
                    }
                }
                else {
                    body_Obj[rootnm][attrLname[index]] = body_Obj[rootnm][index];
                }
                delete body_Obj[rootnm][index];
            }
            body_Obj['m2m:' + rsrcLname[rootnm]] = body_Obj[rootnm];
            delete body_Obj[rootnm];
            rootnm = rsrcLname[rootnm];
        }
        else {
            body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
            delete body_Obj[Object.keys(body_Obj)[0]];
        }

        var bodyString = JSON.stringify(body_Obj);
        if (request.headers.accept == null) {
            response.setHeader('Accept', 'application/'+request.headers.usebodytype);
            //response.setHeader('Accept', 'application/vnd.onem2m-res'+request.headers.usebodytype);
        }
        
        if (request.headers.usebodytype == 'json') {
            //response.setHeader('Accept', 'application/vnd.onem2m-res+json');
            response.setHeader('Accept', 'application/json');
        }
        else {
            //response.setHeader('Accept', 'application/vnd.onem2m-res+xml');
            response.setHeader('Accept', 'application/xml');
            var xml = xmlbuilder.create('m2m:' + rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
                {pubID: null, sysID: null}, {allowSurrogateChars: false, skipNullAttributes: false, headless: false, ignoreDecorators: false, stringify: {}}
            ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

            for (index in body_Obj) {
                for (var attr in body_Obj[index]) {
                    if (attr == 'resourceName' || attr == 'rn') {
                        xml.att(attr, body_Obj[index][attr]);
                    }
                    else if (attr == 'eventNotificationCriteria' || attr == 'enc') {
                        var xml2 = xml.ele(attr, '');
                        for (var sub_attr in body_Obj[index][attr]) {
                            xml2.ele(sub_attr, body_Obj[index][attr][sub_attr].toString().replace(/,/g, ' '));
                        }
                    }
                    else if (attr == 'privileges' || attr == 'pv' || attr == 'selfPrivileges' || attr == 'pvs') {
                        var xml2 = xml.ele(attr, '');
                        for (var sub_attr in body_Obj[index][attr]) {
                            for (var sub_attr2 in body_Obj[index][attr][sub_attr]) {
                                var xml3 = xml2.ele(sub_attr, '');
                                for (var sub_attr3 in body_Obj[index][attr][sub_attr][sub_attr2]) {
                                    xml3.ele(sub_attr3, body_Obj[index][attr][sub_attr][sub_attr2][sub_attr3].toString().replace(/,/g, ' '));
                                }
                            }
                        }
                    }
                    else if (attr == 'accessControlPolicyIDs' || attr == 'acpi') {
                        xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                    }
                    else if (attr == 'labels' || attr == 'lbl') {
                        xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                    }
                    else if (attr == 'supportedResourceType' || attr == 'srt') {
                        xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                    }
                    else if (attr == 'pointOfAccess' || attr == 'poa') {
                        xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                    }
                    else if (attr == 'notificationURI' || attr == 'nu') {
                        xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                    }
                    else if (attr == 'memberIDs' || attr == 'mid') {
                        xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                    }
                    else if (attr == 'membersAccessControlPolicyIDs' || attr == 'macp') {
                        xml.ele(attr, body_Obj[index][attr].toString().replace(/,/g, ' '));
                    }
                    else {
                        xml.ele(attr, body_Obj[index][attr]);
                    }
                }
            }
            bodyString = xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
        }

        response.setHeader('X-M2M-RSC', rsc);
        if(request.headers['content-type'] == null) {
            if (request.headers.usebodytype == 'json') {
                //response.setHeader('Content-Type', 'application/vnd.onem2m-res+json');
                response.setHeader('Content-Type', 'application/json');
            }
            else {
                //response.setHeader('Content-Type', 'application/vnd.onem2m-res+xml');
                response.setHeader('Content-Type', 'application/xml');
            }
        }
        else {
            response.setHeader('Content-Type', request.headers['content-type']);
        }
        
        response.status(status).end(bodyString);

        rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = request.method + "-" + ri + "-" + JSON.stringify(request.query);
        rspObj.sts = cap;
        console.log(JSON.stringify(rspObj));
    }
};


exports.search_result = function(request, response, status, body_Obj, rsc, ri, cap) {
    if(request.headers.locale != null) {
        response.setHeader('locale', request.headers.locale);
    }

    response.setHeader('X-M2M-RI', request.headers['x-m2m-ri']);

    if(Object.keys(body_Obj)[0] == 'rsp') {
        rootnm = 'rsp';
    }

    if(request.headers.rootnm == 'uril') {
        var rootnm = request.headers.rootnm;
        body_Obj[rootnm] = body_Obj[rootnm].toString().replace(/,/g, ' ');
        if (request.headers.nmtype == 'long') {
            body_Obj['m2m:'+attrLname[rootnm]] = body_Obj[rootnm];
            delete body_Obj[rootnm];
            rootnm = attrLname[rootnm];
        }
        else {
            body_Obj['m2m:'+rootnm] = body_Obj[rootnm];
            delete body_Obj[rootnm];
        }

        var bodyString = JSON.stringify(body_Obj);
        if (request.headers.accept == null) {
            response.setHeader('Accept', 'application/'+request.headers.usebodytype);
            //response.setHeader('Accept', 'application/vnd.onem2m-res'+request.headers.usebodytype);
        }

        if (request.headers.usebodytype == 'json') {
            //response.setHeader('Accept', 'application/vnd.onem2m-res+json');
            response.setHeader('Accept', 'application/json');
        }
        else {
            //response.setHeader('Accept', 'application/vnd.onem2m-res+xml');
            response.setHeader('Accept', 'application/xml');
            var options = {
                prettyPrinting: {enabled: false},
                wrapArray: {enabled: true}
            };
            bodyString = js2xmlparser('m2m:'+rootnm, body_Obj, options);

            var xml  = xmlbuilder.create('m2m:'+rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
                {pubID: null, sysID: null}, {allowSurrogateChars: false, skipNullAttributes: false, headless: false, ignoreDecorators: false, stringify: {}}
            ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
            xml.txt(body_Obj['m2m:'+rootnm]);
            bodyString = xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
        }
    }
    else {
        rootnm = request.headers.rootnm;

        for (var prop in body_Obj) {
            for(var idx in body_Obj[prop]) {
                if(body_Obj[prop][idx] == null || body_Obj[prop][idx] == '' || body_Obj[prop][idx] == 'undefined' || body_Obj[prop][idx] == '[]') {
                    delete body_Obj[prop][idx];
                }
            }

            if((body_Obj[prop].ty == '1') || (body_Obj[prop].ty == '2') || (body_Obj[prop].ty == '5') || (body_Obj[prop].ty == '16')) {
                delete body_Obj[prop].st;
            }

            if (body_Obj[prop].poa) {
                body_Obj[prop].poa = JSON.parse(body_Obj[prop].poa);
            }

            if (body_Obj[prop].lbl) {
                body_Obj[prop].lbl = JSON.parse(body_Obj[prop].lbl);
            }

            if (body_Obj[prop].enc) {
                body_Obj[prop].enc = JSON.parse(body_Obj[prop].enc);
            }

            if(body_Obj[prop].nu) {
                body_Obj[prop].nu = JSON.parse(body_Obj[prop].nu);
            }

            if (body_Obj[prop].acpi) {
                body_Obj[prop].acpi = JSON.parse(body_Obj[prop].acpi);
            }
            
            if (body_Obj[prop].srt) {
                body_Obj[prop].srt = JSON.parse(body_Obj[prop].srt);
            }

            if (body_Obj[prop].mid) {
                body_Obj[prop].mid = JSON.parse(body_Obj[prop].mid);
            }

            if (body_Obj[prop].pv) {
                body_Obj[prop].pv = JSON.parse(body_Obj[prop].pv);
                body_Obj[prop]['pv']['acr'].splice(body_Obj[prop]['pv']['acr'].length-1, 1);
            }

            if (body_Obj[prop].pvs) {
                body_Obj[prop].pvs = JSON.parse(body_Obj[prop].pvs);
                body_Obj[prop]['pvs']['acr'].splice(body_Obj[prop]['pvs']['acr'].length-1, 1);
            }
        }

        if (request.headers.nmtype == 'long') {
            var res_Obj = {};
            rootnm = attrLname[rootnm];
            for (var prop in body_Obj) {
                var ty = body_Obj[prop].ty;
                if(res_Obj['m2m:'+rsrcLname[typeRsrc[ty]]] == null) {
                    res_Obj['m2m:'+rsrcLname[typeRsrc[ty]]] = [];
                }
                var tmp_Obj = {};
                tmp_Obj['m2m:'+rsrcLname[typeRsrc[ty]]] = {};
                for(var index in body_Obj[prop]) {
                    tmp_Obj['m2m:'+rsrcLname[typeRsrc[ty]]][attrLname[index]] = body_Obj[prop][index]
                }
                delete body_Obj[prop];
                res_Obj['m2m:'+rsrcLname[typeRsrc[ty]]].push(tmp_Obj['m2m:'+rsrcLname[typeRsrc[ty]]]);
            }
            body_Obj['m2m:'+rootnm] = res_Obj;
        }
        else {
            res_Obj = {};
            for (prop in body_Obj) {
                if(body_Obj[prop].ty == null) {
                    ty = '99';
                }
                else {
                    ty = body_Obj[prop].ty;
                }
                if(res_Obj['m2m:'+typeRsrc[ty]] == null) {
                    res_Obj['m2m:'+typeRsrc[ty]] = [];
                }
                tmp_Obj = {};
                tmp_Obj['m2m:' + typeRsrc[ty]] = body_Obj[prop];
                delete body_Obj[prop];
                res_Obj['m2m:' + typeRsrc[ty]].push(tmp_Obj['m2m:' + typeRsrc[ty]]);
            }
            body_Obj['m2m:'+rootnm] = res_Obj;
        }

        bodyString = JSON.stringify(body_Obj);

        if (request.headers.usebodytype == 'json') {
            //response.setHeader('Accept', 'application/vnd.onem2m-res+json');
            response.setHeader('Accept', 'application/json');
        }
        else {
            //response.setHeader('Accept', 'application/vnd.onem2m-res+xml');
            response.setHeader('Accept', 'application/xml');
            var xml  = xmlbuilder.create('m2m:'+rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
                {pubID: null, sysID: null}, {allowSurrogateChars: false, skipNullAttributes: false, headless: false, ignoreDecorators: false, stringify: {}}
            ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

            for(var index in res_Obj) {
                for(var prop in res_Obj[index]) {
                    if(res_Obj[index][prop].pc) { // aggregated response for fanout
                        var xml_0 = xml.ele(index);
                        for (var agr_attr in res_Obj[index][prop]) {
                            if(agr_attr == 'pc') {
                                var xml_01 = xml_0.ele(agr_attr);
                                for (var pc_attr in res_Obj[index][prop][agr_attr]) {
                                    xml_1 = xml_01.ele(pc_attr);
                                    for (var attr in res_Obj[index][prop][agr_attr][pc_attr]) {
                                         if (attr == 'resourceName' || attr == 'rn') {
                                            xml_1.att(attr, res_Obj[index][prop][agr_attr][pc_attr][attr]);
                                        }
                                        else if (attr == 'eventNotificationCriteria' || attr == 'enc') {
                                            var xml2 = xml_1.ele(attr, '');
                                            for (var sub_attr in res_Obj[index][prop][agr_attr][pc_attr][attr]) {
                                                xml2.ele(sub_attr, res_Obj[index][prop][pc_attr][attr][sub_attr].toString().replace(/,/g, ' '));
                                            }
                                        }
                                        else if (attr == 'privileges' || attr == 'pv' || attr == 'selfPrivileges' || attr == 'pvs') {
                                            var xml2 = xml_1.ele(attr, '');
                                            for (var sub_attr in res_Obj[index][prop][agr_attr][pc_attr][attr]) {
                                                for (var sub_attr2 in res_Obj[index][prop][agr_attr][pc_attr][attr][sub_attr]) {
                                                    var xml3 = xml2.ele(sub_attr, '');
                                                    for (var sub_attr3 in res_Obj[index][prop][agr_attr][pc_attr][attr][sub_attr][sub_attr2]) {
                                                        xml3.ele(sub_attr3, res_Obj[index][prop][agr_attr][pc_attr][attr][sub_attr][sub_attr2][sub_attr3].toString().replace(/,/g, ' '));
                                                    }
                                                }
                                            }
                                        }
                                        else if (attr == 'accessControlPolicyIDs' || attr == 'acpi') {
                                            xml_1.ele(attr, res_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                        }
                                        else if (attr == 'labels' || attr == 'lbl') {
                                            xml_1.ele(attr, res_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                        }
                                        else if (attr == 'supportedResourceType' || attr == 'srt') {
                                            xml_1.ele(attr, res_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                        }
                                        else if (attr == 'pointOfAccess' || attr == 'poa') {
                                            xml_1.ele(attr, res_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                        }
                                        else if (attr == 'notificationURI' || attr == 'nu') {
                                            xml_1.ele(attr, res_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                        }
                                        else if (attr == 'memberIDs' || attr == 'mid') {
                                            xml_1.ele(attr, res_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                        }
                                        else if (attr == 'membersAccessControlPolicyIDs' || attr == 'macp') {
                                            xml_1.ele(attr, res_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                        }
                                        else {
                                            xml_1.ele(attr, res_Obj[index][prop][agr_attr][pc_attr][attr]);
                                        }
                                    }
                                }
                            }
                            else {
                                xml_1 = xml_0.ele(agr_attr, res_Obj[index][prop][agr_attr]);
                            }
                        }
                    }
                    else {
                        var xml_1 = xml.ele(index);
                        for (var attr in res_Obj[index][prop]) {
                            // if(attr == 'resourceName' || attr == 'rn') {
                            //     xml_1.att(attr, res_Obj[index][prop][attr]);
                            // }
                            // else {
                            //     xml_1.ele(attr, res_Obj[index][prop][attr]);
                            // }

                            if (attr == 'resourceName' || attr == 'rn') {
                                xml_1.att(attr, res_Obj[index][prop][attr]);
                            }
                            else if (attr == 'eventNotificationCriteria' || attr == 'enc') {
                                var xml2 = xml_1.ele(attr, '');
                                for (var sub_attr in res_Obj[index][prop][attr]) {
                                    xml2.ele(sub_attr, res_Obj[index][prop][attr][sub_attr].toString().replace(/,/g, ' '));
                                }
                            }
                            else if (attr == 'privileges' || attr == 'pv' || attr == 'selfPrivileges' || attr == 'pvs') {
                                var xml2 = xml_1.ele(attr, '');
                                for (var sub_attr in res_Obj[index][prop][attr]) {
                                    for (var sub_attr2 in res_Obj[index][prop][attr][sub_attr]) {
                                        var xml3 = xml2.ele(sub_attr, '');
                                        for (var sub_attr3 in res_Obj[index][prop][attr][sub_attr][sub_attr2]) {
                                            // for (var sub_attr4 in body_Obj[index][prop][attr][sub_attr][sub_attr2][sub_attr3]) {
                                            //     xml3.ele(sub_attr3, body_Obj[index][prop][attr][sub_attr][sub_attr2][sub_attr3][sub_attr4]);
                                            // }
                                            xml3.ele(sub_attr3, res_Obj[index][prop][attr][sub_attr][sub_attr2][sub_attr3].toString().replace(/,/g, ' '));
                                        }
                                    }
                                }
                            }
                            else if (attr == 'accessControlPolicyIDs' || attr == 'acpi') {
                                xml_1.ele(attr, res_Obj[index][prop][attr].toString().replace(/,/g, ' '));
                            }
                            else if (attr == 'labels' || attr == 'lbl') {
                                xml_1.ele(attr, res_Obj[index][prop][attr].toString().replace(/,/g, ' '));
                            }
                            else if (attr == 'supportedResourceType' || attr == 'srt') {
                                xml_1.ele(attr, res_Obj[index][prop][attr].toString().replace(/,/g, ' '));
                            }
                            else if (attr == 'pointOfAccess' || attr == 'poa') {
                                xml_1.ele(attr, res_Obj[index][prop][attr].toString().replace(/,/g, ' '));
                            }
                            else if (attr == 'notificationURI' || attr == 'nu') {
                                xml_1.ele(attr, res_Obj[index][prop][attr].toString().replace(/,/g, ' '));
                            }
                            else if (attr == 'memberIDs' || attr == 'mid') {
                                xml_1.ele(attr, res_Obj[index][prop][attr].toString().replace(/,/g, ' '));
                            }
                            else if (attr == 'membersAccessControlPolicyIDs' || attr == 'macp') {
                                xml_1.ele(attr, res_Obj[index][prop][attr].toString().replace(/,/g, ' '));
                            }
                            else {
                                xml_1.ele(attr, res_Obj[index][prop][attr]);
                            }
                        }
                    }
                }
            }

            bodyString = xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
        }
    }

    response.setHeader('X-M2M-RSC', rsc);
    if(request.headers['content-type'] == null) {
        if (request.headers.usebodytype == 'json') {
            //response.setHeader('Content-Type', 'application/vnd.onem2m-res+json');
            response.setHeader('Content-Type', 'application/json');
        }
        else {
            //response.setHeader('Content-Type', 'application/vnd.onem2m-res+xml');
            response.setHeader('Content-Type', 'application/xml');
        }
    }
    else {
        response.setHeader('Content-Type', request.headers['content-type']);
    }
    
    response.status(status).end(bodyString);

    var rspObj = {};
    rspObj.rsc = rsc;
    rspObj.ri = request.method + "-" + request.url;
    rspObj.sts = cap;
    console.log(JSON.stringify(rspObj));
};
