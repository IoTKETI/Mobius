/**
 * Copyright (c) 2018, KETI
 * All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @file
 * @copyright KETI Korea 2018, KETI
 * @author Il Yeup Ahn [iyahn@keti.re.kr]
 */

var url = require('url');
var xml2js = require('xml2js');
var xmlbuilder = require('xmlbuilder');
var util = require('util');
var merge = require('merge');
var js2xmlparser = require("js2xmlparser");
var cbor = require("cbor");
var coap = require('coap');

var db_sql = require('./sql_action');
var outbound = require('./outbound');


var _this = this;



var attrLname = {
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
    "evi":  "eventID",
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
    "rctn":  "requestContextNotification",
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
    "rsp": "responsePrimitive",
    "dsp": "descriptor",
    "dcrp": "descriptorRepresenation",
    "soe": "semanticOpExec",
    "rels": "relatedSemantics",
    "sid":"sessionID",
    "soid":"sessionOriginatorID",
    "stid":"SessionTargetID",
    "asd":"acceptedSessionDescription",
    "osd":"offeredSessionDescriptions",
    "sst":"sessionState",
    "crb" :"createdBefore",
    "cra" :"createdAfter",
    "ms"  :"modifiedSince",
    "us"  :"unmodifiedSince",
    "sts" :"stateTagSmaller",
    "stb" :"stateTagBigger",
    "exb" :"expireBefore",
    "exa" :"expireAfter",
    "sza" :"sizeAbove",
    "szb" :"sizeBelow",
    "cty" :"contentType",
    "lim" :"limit",
    "ofst":"offset",
    "lvl" :"level",
    "atr" :"attribute",
    "net" :"notificationEventType",
    "om"  :"operationMonitor",
    "rep" :"representation",
    "fu"  :"filterUsage",
    "ect" :"eventCatType",
    "ecn" :"eventCatNo",
    "num" :"number",
    "dur" :"duration",
    "sgn" :"notification",
    "nev" :"notificationEvent",
    "vrq" :"verificationRequest",
    "sud" :"subscriptionDeletion",
    "sur" :"subscriptionReference",
    "nfu" :"notificationForwardingURI",
    "op"  :"operation",
    "aci" :"accessId",
    "msd" :"MSISDN",
    "acn" :"action",
    "sus" :"status",
    "ch"  :"childResource",
    "acr" :"accessControlRule",
    "acor":"accessControlOriginators",
    "acop":"accessControlOperations",
    "acco":"accessControlContexts",
    "actw":"accessControlWindow",
    "acip":"accessControlIpAddresses",
    "ipv4":"ipv4Addresses",
    "ipv6":"ipv6Addresses",
    "aclr":"accessControlLocationRegion",
    "accc":"countryCode",
    "accr":"circRegion",
    "nm"  :"name",
    "val" :"value",
    "typ" :"type",
    "mnn" :"maxNrOfNotify",
    "tww" :"timeWindow",
    "sce" :"scheduleEntry",
    "agn" :"aggregatedNotification",
    "atrl":"attributeList",
    "agr" :"aggregatedResponse",
    "uril":"URIList",
    "any":"anyArg",
    "ftyp":"fileType",
    "unm":"username",
    "pwd":"password",
    "fsi":"filesize",
    "tgf":"targetFile",
    "dss":"delaySeconds",
    "surl":"successURL",
    "stt":"startTime",
    "cpt":"completeTime",
    "uuid":"UUID",
    "eer":"executionEnvRef",
    "vr*":"version",
    "rst":"reset",
    "uld":"upload",
    "dld":"download",
    "swin":"softwareInstall",
    "swup":"softwareUpdate",
    "swun":"softwareUninstall",
    "tcop":"tracingOption",
    "tcin":"tracingInfo",
    "rtv":"responseTypeValue"
};

var attrSname = {
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
    "requestContextNotification"   :"rctn",
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
    "singleNotification":  "sgn",
    "responsePrimitive":"rsp",
    "descriptor":"dsp",
    "descriptorRepresenation": "dcrp",
    "semanticOpExec": "soe",
    "relatedSemantics": "rels",
    "sessionID":"sid",
    "sessionOriginatorID":"soid",
    "SessionTargetID":"stid",
    "acceptedSessionDescription":"asd",
    "offeredSessionDescriptions":"osd",
    "sessionState":"sst",
    "accessControWindow":"actw",
    "createdBefore":"crb",
    "createdAfter":"cra",
    "modifiedSince":"ms",
    "unmodifiedSince":"us",
    "stateTagSmaller":"sts",
    "stateTagBigger":"stb",
    "expireBefore":"exb",
    "expireAfter":"exa",
    "sizeAbove":"sza",
    "sizeBelow":"szb",
    "contentType":"cty",
    "limit":"lim",
    "offset":"ofst",
    "level":"lvl",
    "attribute":"atr",
    "operationMonitor":"om",
    "representation":"rep",
    "filterUsage":"fu",
    "eventCatType":"ect",
    "eventCatNo":"ecn",
    "number":"num",
    "duration":"dur",
    "notification":"sgn",
    "notificationEvent":"nev",
    "verificationRequest":"vrq",
    "subscriptionDeletion":"sud",
    "subscriptionReference":"sur",
    "accessId":"aci",
    "MSISDN":"msd",
    "action":"acn",
    "status":"sus",
    "childResource":"ch",
    "accessControlRule":"acr",
    "accessControlOriginators":"acor",
    "accessControlOperations":"acop",
    "accessControlContexts":"acco",
    "accessControlWindow":"actw",
    "accessControlIpAddresses":"acip",
    "ipv4Addresses":"ipv4",
    "ipv6Addresses":"ipv6",
    "accessControlLocationRegion":"aclr",
    "countryCode":"accc",
    "circRegion":"accr",
    "name":"nm*",
    "value":"val",
    "type":"typ",
    "maxNrOfNotify":"mnn",
    "timeWindow":"tww",
    "scheduleEntry":"sce",
    "aggregatedNotification":"agn",
    "attributeList":"atrl",
    "URIList":"uril",
    "anyArg":"any",
    "fileType":"ftyp",
    "username":"unm",
    "password":"pwd",
    "filesize":"fsi",
    "targetFile":"tgf",
    "delaySeconds":"dss",
    "successURL":"surl",
    "startTime":"stt",
    "completeTime":"cpt",
    "UUID":"uuid",
    "executionEnvRef":"eer",
    "reset":"rst",
    "upload":"uld",
    "download":"dld",
    "softwareInstall":"swin",
    "softwareUpdate":"swup",
    "softwareUninstall":"swun",
    "tracingOption":"tcop",
    "tracingInfo":"tcin",
    "responseTypeValue":"rtv",
    "firmwarename":"fwnnam"
};

var rceLname = {
    "cb" : "CSEBase",
    "ae" : "AE",
    "csr": "remoteCSE",
    "cnt": "container",
    "cin": "contentInstance",
    "sub": "subscription",
    "uril" :"URIList",
    "smd":"semanticDescriptor",
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
    "mms": "multimediaSession",
    "rce":"resource",
    "uri":"URI",
    "fwnnam":"firmwareName"
};


var rceSname = {
    "CSEBase"           : "cb",
    "AE"                : "ae",
    "remoteCSE"         : "csr",
    "container"         : "cnt",
    "contentInstance"   : "cin",
    "subscription"      : "sub",
    "URIList"            :"uril",
    "semanticDescriptor":"smd",
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
    "multimediaSession": "mms",
    "resource":"rce",
    "URI":"uri"
};


var typeRsrc = {
    "1": "acp",
    "2": "ae",
    "3": "cnt",
    "4": "cin",
    "5": "cb",
    "9": "grp",
    "10": "lcp",
    "13": "mgo",
    "14": "nod",
    "16": "csr",
    "23": "sub",
    "24": "smd",
    "27": "mms",
    "28": "fcnt",
    "91": "hd_brigs",
    "92": "hd_color",
    "93": "hd_colSn",
    "94": "hd_fauDn",
    "95": "hd_binSh",
    "96": "hd_tempe",
    "97": "hd_bat",
    "98": "hd_dooLk",
    "99": "rsp"
};

var mgoType = {
    "1001": "fwr",
    "1006": "bat",
    "1007": "dvi",
    "1008": "dvc",
    "1009": "rbo"
};

exports.typeRsrc = typeRsrc;
exports.mgoType = mgoType;
exports.rsrcSname = rceSname;
exports.rsrcLname = rceLname;
exports.attrLname = attrLname;
exports.attrSname = attrSname;

/**
 * 배열이어야 하는 컬럼 값을 배열로 읽는다. 절대 던지지 않는다.
 *
 * 응답을 만드는 도중이라 여기서 예외가 나면 응답 전송도 커넥션 반납도 못 한다.
 * 깨진 행 하나가 그 리소스를 읽는 모든 요청을 죽이는 크래시 루프가 된다.
 *
 * 읽을 수 없으면 빈 배열로 둔다 — resource.js 의 makeObject 가 null/'' 을
 * '[]' 로 채우는 것과 같은 방침이다.
 */
function parse_db_array(raw, attr) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (raw == null || raw === '') {
        return [];
    }
    var parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        console.error('[typeCheckAction] ' + attr + ' 를 배열로 읽을 수 없다: ' + e.message);
        return [];
    }
    if (!Array.isArray(parsed)) {
        console.error('[typeCheckAction] ' + attr + ' 가 배열이 아니다');
        return parsed == null ? [] : [].concat(parsed);
    }
    return parsed;
}

function typeCheckAction(index1, body_Obj) {
    for (var index2 in body_Obj) {
        if(body_Obj.hasOwnProperty(index2)) {
            if (body_Obj[index2] == null || body_Obj[index2] == '' || body_Obj[index2] == 'undefined' || body_Obj[index2] == '[]' || body_Obj[index2] == '\"\"') {
                //delete body_Obj[index2];
                if(index2 == 'pi') {
                }
                else if(index2 == 'pv') {
                }
                else {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'subl') {
                delete body_Obj[index2];
            }
            else if (index2 == 'et') {
                if (index1 == 'm2m:cb') {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'cr') {
                if (index1 == 'm2m:ae' || index1 == 'm2m:csr') {
                    delete body_Obj[index2];
                }
            }
            else if (index2 == 'acp' || index2 == 'cst' || index2 == 'los' || index2 == 'mt' || index2 == 'csy' || index2 == 'nct' ||
                index2 == 'cs' || index2 == 'st' || index2 == 'ty' || index2 == 'cbs' || index2 == 'cni' || index2 == 'mni' ||
                index2 == 'cnm' || index2 == 'mia' || index2 == 'mbs' || index2 == 'mgd' || index2 == 'btl' || index2 == 'bts' ||
                index2 == 'mnm' || index2 == 'exc' || index2 == 'rs' || index2 == 'ors') {

                if ((index1 == 'm2m:cb' || index1 == 'm2m:cin' || index1 == 'm2m:nod' || index1 == 'm2m:ae' || index1 == 'm2m:sub' || index1 == 'm2m:acp' ||
                        index1 == 'm2m:csr' || index1 == 'm2m:grp' || index1 == 'm2m:fwr' || index1 == 'm2m:bat' || index1 == 'm2m:dvi' || index1 == 'm2m:dvc' ||
                        index1 == 'm2m:rbo' || index1 == 'm2m:smd') &&
                    index2 == 'mni') {
                    delete body_Obj[index2];
                }
                else if ((index1 == 'm2m:cb' || index1 == 'm2m:csr' || index1 == 'm2m:ae' || index1 == 'm2m:acp' || index1 == 'm2m:grp' || index1 == 'm2m:sub' ||
                        index1 == 'm2m:nod' || index1 == 'm2m:fwr' || index1 == 'm2m:bat' || index1 == 'm2m:dvi' || index1 == 'm2m:dvc' || index1 == 'm2m:rbo' ||
                        index1 == 'm2m:smd') &&
                    index2 == 'st') {
                    delete body_Obj[index2];
                }
                else if ((index1 == 'm2m:acp') && index2 == 'acpi') {
                    delete body_Obj[index2];
                }
                else {
                    body_Obj[index2] = parseInt(body_Obj[index2]);
                }
            }
            else if (index2 == 'lvl' || index2 == 'colSn' || index2 == 'red' || index2 == 'green' || index2 == 'blue' || index2 == 'brigs' ||
                index2 == 'lock' || index2 == 'powerSe' || index2 == 'sus' || index2 == 'curT0') {
                if(index1 == 'm2m:fcnt') {
                    delete body_Obj[index2];
                }
                else if(index1 == 'hd:dooLk') {
                    if(index2 == 'lock') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:bat') {
                    if(index2 == 'lvl') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:tempe') {
                    if(index2 == 'curT0') {
                        body_Obj[index2] = parseFloat(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:binSh') {
                    if(index2 == 'powerSe') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:fauDn') {
                    if(index2 == 'sus') {
                        body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:colSn') {
                    if(index2 == 'colSn') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:color') {
                    if(index2 == 'red' || index2 == 'green' || index2 == 'blue') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
                else if(index1 == 'hd:brigs') {
                    if(index2 == 'brigs') {
                        body_Obj[index2] = parseInt(body_Obj[index2]);
                    }
                    else {
                        delete body_Obj[index2];
                    }
                }
            }
            else if (index2 == 'srv' || index2 == 'aa' || index2 == 'at' || index2 == 'poa' || index2 == 'lbl' || index2 == 'acpi' || index2 == 'srt' || index2 == 'nu' || index2 == 'mid' || index2 == 'macp') {
                if (!Array.isArray(body_Obj[index2])) {
                    // 여기 오는 값은 이미 한 번 파싱에 실패한 것이다.
                    // resource.js 의 makeObject 가 같은 컬럼을 try/catch 로 파싱하는데,
                    // 실패하면 로그만 찍고 깨진 원본 문자열을 그대로 남긴다.
                    // 그래서 이 두 번째 파싱은 "성공할 값은 안 오고 던질 값만 오는" 자리다.
                    //
                    // 응답 직렬화 도중이라 여기서 던지면 응답도 커넥션 반납도 못 하고
                    // 워커가 죽는다. 깨진 행 하나가 그 리소스를 읽는 모든 요청을
                    // 죽이는 크래시 루프가 된다.
                    body_Obj[index2] = parse_db_array(body_Obj[index2], index2);
                }

                if (index2 == 'srt') {
                    for (index3 in body_Obj[index2]) {
                        if (body_Obj[index2].hasOwnProperty(index3)) {
                            body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                        }
                    }
                }
                else if (index2 == 'mid') {
                    if(body_Obj[index2].length > 0) {
                        for(var idx in body_Obj[index2]) {
                            if(body_Obj[index2].hasOwnProperty(idx)) {
                                body_Obj[index2][idx] = body_Obj[index2][idx].replace(usespid + usecseid + '/', '/'); // absolute
                                body_Obj[index2][idx] = body_Obj[index2][idx].replace(usecseid + '/', '/'); // SP

                                // if(body_Obj[index2][idx].charAt(0) != '/') {
                                //     body_Obj[index2][idx] = '/' + body_Obj[index2][idx];
                                // }

                                if(body_Obj[index2][idx].charAt(0) == '/') {
                                    body_Obj[index2][idx] = body_Obj[index2][idx].replace('/', '');
                                }
                            }
                        }
                    }
                }
            }
            else if (index2 == 'enc') {
                if (Object.keys(body_Obj[index2])[0] != 'net') {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
                }

                for (var index3 in body_Obj[index2]) {
                    if (body_Obj[index2].hasOwnProperty(index3)) {
                        if(index3 == 'net') {
                            for (var index4 in body_Obj[index2][index3]) {
                                if (body_Obj[index2][index3].hasOwnProperty(index4)) {
                                    body_Obj[index2][index3][index4] = parseInt(body_Obj[index2][index3][index4]);
                                }
                            }
                        }
                    }
                }
            }
            else if (index2 == 'bn') {
                if(Object.keys(body_Obj[index2]).length == 0) {
                    delete body_Obj[index2];
                }
                else {
                    for (var index3 in body_Obj[index2]) {
                        if (body_Obj[index2].hasOwnProperty(index3)) {
                            if(index3 == 'num') {
                                body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                            }
                        }
                    }
                }
            }
            else if (index2 == 'cas' || index2 == 'uds') {
                for (var index3 in body_Obj[index2]) {
                    if (body_Obj[index2].hasOwnProperty(index3)) {
                        if(index3 == 'sus') {
                            body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                        }
                    }
                }
            }
            else if (index2 == 'rr' || index2 == 'mtv' || index2 == 'ud' || index2 == 'att' || index2 == 'cus' || index2 == 'ena' || index2 == 'dis' || index2 == 'rbo' ||
                index2 == 'far' || index2 == 'disr') {
                body_Obj[index2] = ((body_Obj[index2] == 'true') || ((body_Obj[index2] == true)));
            }
            else if (index2 == 'sri') {
                body_Obj.ri = body_Obj[index2];
                delete body_Obj[index2];
            }
            else if (index2 == 'spi') {
                body_Obj.pi = body_Obj[index2];
                delete body_Obj[index2];
            }
            else if (index2 == 'pv' || index2 == 'pvs') {
                // 가드가 뒤집혀 있었다. getType 은 문자열이 객체로 파싱되면
                // 'string_object' 를, *파싱에 실패하면* 'string' 을 돌려준다.
                // 그래서 === 'string' 조건은 정상적으로 저장된 pv 를 걸러내고
                // (원래 의도한 파싱은 영영 일어나지 않았다) 파싱 불가능한 값만
                // JSON.parse 로 넘겼다 — 반드시 던지는 자리였다.
                //
                // makeObject 가 이미 pv/pvs 를 파싱하므로 정상 값은 여기 오면
                // 객체다. 문자열로 남아 있다는 것은 그때 실패했다는 뜻이다.
                // 빈 객체로 바꿔치면 없는 권한을 지어내는 셈이라, 원본을 그대로
                // 두고 로그만 남긴다 — 운영자가 깨진 행을 알아볼 수 있어야 한다.
                if (getType(body_Obj[index2]) === 'string_object') {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
                }
                else if (typeof body_Obj[index2] === 'string') {
                    console.error('[typeCheckAction] ' + index2 + ' 를 읽을 수 없어 원본 그대로 내보낸다');
                }
            }
        }
    }
}

function xmlInsert(xml, body_Obj, attr_name) {
    for (var attr in body_Obj) {
        if (body_Obj.hasOwnProperty(attr)) {
            if (attr === attr_name) {
                var con_type = getType(body_Obj[attr]);
                if(con_type === 'object') {
                    var xml2 = xml.ele(attr);
                    for(var attr2 in body_Obj[attr]) {
                        if (body_Obj[attr].hasOwnProperty(attr2)) {
                            xmlInsert(xml2, body_Obj[attr], attr2)
                        }
                    }
                }
                else if(con_type === 'array') {
                    for(var idx in body_Obj[attr]) {
                        if (body_Obj[attr].hasOwnProperty(idx)) {
                            var attr_type = getType(body_Obj[attr][idx]);
                            if(attr_type === 'object') {
                                xml2 = xml.ele(attr);
                                for(attr2 in body_Obj[attr][idx]) {
                                    if (body_Obj[attr][idx].hasOwnProperty(attr2)) {
                                        xmlInsert(xml2, body_Obj[attr][idx], attr2)
                                    }
                                }
                            }
                            else {
                                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
                                delete body_Obj[attr];
                                break;
                            }
                        }
                    }

                }
                else {
                    xml.ele(attr, body_Obj[attr]);
                }
                delete body_Obj[attr];
                break;
            }
        }
    }
}

function xmlInsertAfter(xml, body_Obj, attr_name, attr_name_after) {
    for (var attr in body_Obj) {
        if (body_Obj.hasOwnProperty(attr)) {
            if (attr == attr_name) {
                xml.ele(attr, body_Obj[attr]).insertAfter(attr_name_after);
                delete body_Obj[attr];
                break;
            }
        }
    }
}

function xmlInsertList(xml, body_Obj, attr_name) {
    for (var attr in body_Obj) {
        if (body_Obj.hasOwnProperty(attr)) {
            if (attr == attr_name) {
                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
                delete body_Obj[attr];
                break;
            }
        }
    }
}

function xmlAction(xml, body_Obj) {
    xmlInsert(xml, body_Obj, 'ty');
    xmlInsert(xml, body_Obj, 'ri');
    xmlInsert(xml, body_Obj, 'pi');
    xmlInsert(xml, body_Obj, 'ct');
    xmlInsert(xml, body_Obj, 'lt');
    xmlInsertList(xml, body_Obj, 'lbl');
    xmlInsertList(xml, body_Obj, 'acpi');

    if(xml.name === 'm2m:cb') {
        xmlInsert(xml, body_Obj, 'cst');
        xmlInsert(xml, body_Obj, 'csi');
        xmlInsertList(xml, body_Obj, 'srt');
        xmlInsertList(xml, body_Obj, 'poa');
        xmlInsert(xml, body_Obj, 'nl');
        xmlInsert(xml, body_Obj, 'dac');
        xmlInsert(xml, body_Obj, 'esi');
        xmlInsert(xml, body_Obj, 'ch');
        xmlInsert(xml, body_Obj, 'srv');
    }
    else {
        xmlInsert(xml, body_Obj, 'et');
        xmlInsert(xml, body_Obj, 'at');
        xmlInsert(xml, body_Obj, 'aa');
        if (xml.name === 'm2m:csr') {
            xmlInsertAfter(xml, body_Obj, 'daci', 'et');
            xmlInsert(xml, body_Obj, 'cst');
            xmlInsertList(xml, body_Obj, 'poa');
            xmlInsert(xml, body_Obj, 'cb');
            xmlInsert(xml, body_Obj, 'csi');
            xmlInsert(xml, body_Obj, 'mei');
            xmlInsert(xml, body_Obj, 'tri');
            xmlInsert(xml, body_Obj, 'rr');
            xmlInsert(xml, body_Obj, 'nl');
            xmlInsert(xml, body_Obj, 'trn');
            xmlInsert(xml, body_Obj, 'esi');
            xmlInsert(xml, body_Obj, 'srv');
        }
        else if (xml.name === 'm2m:ae') {
            xmlInsert(xml, body_Obj, 'daci', 'et');
            xmlInsert(xml, body_Obj, 'apn');
            xmlInsert(xml, body_Obj, 'api');
            xmlInsert(xml, body_Obj, 'aei');
            xmlInsertList(xml, body_Obj, 'poa');
            xmlInsert(xml, body_Obj, 'or');
            xmlInsert(xml, body_Obj, 'nl');
            xmlInsert(xml, body_Obj, 'rr');
            xmlInsert(xml, body_Obj, 'csz');
            xmlInsert(xml, body_Obj, 'esi');
            xmlInsert(xml, body_Obj, 'srv');
        }
        else if (xml.name === 'm2m:cnt') {
            xmlInsert(xml, body_Obj, 'daci', 'et');
            xmlInsert(xml, body_Obj, 'st');
            xmlInsert(xml, body_Obj, 'cr');
            xmlInsert(xml, body_Obj, 'mni');
            xmlInsert(xml, body_Obj, 'mbs');
            xmlInsert(xml, body_Obj, 'mia');
            xmlInsert(xml, body_Obj, 'cni');
            xmlInsert(xml, body_Obj, 'cbs');
            xmlInsert(xml, body_Obj, 'li');
            xmlInsert(xml, body_Obj, 'or');
            xmlInsert(xml, body_Obj, 'disr');
        }
        else if (xml.name === 'm2m:cin') {
            xmlInsert(xml, body_Obj, 'st');
            xmlInsert(xml, body_Obj, 'cr');
            xmlInsert(xml, body_Obj, 'cnf');
            xmlInsert(xml, body_Obj, 'cs');
            xmlInsert(xml, body_Obj, 'conr');
            xmlInsert(xml, body_Obj, 'or');
            xmlInsert(xml, body_Obj, 'con');
        }
        else if (xml.name === 'm2m:smd') {
            xmlInsert(xml, body_Obj, 'daci', 'et');
            xmlInsert(xml, body_Obj, 'cr');
            xmlInsert(xml, body_Obj, 'dcrp');
            xmlInsert(xml, body_Obj, 'soe');
            xmlInsert(xml, body_Obj, 'dsp');
            xmlInsert(xml, body_Obj, 'or');
            xmlInsert(xml, body_Obj, 'rels');
        }
        else if (xml.name === 'm2m:sub') {
            xmlInsert(xml, body_Obj, 'daci', 'et');

            for (attr in body_Obj) {
                if (body_Obj.hasOwnProperty(attr)) {
                    if (attr == 'enc') {
                        var xml2 = xml.ele(attr, '');
                        for (var sub_attr in body_Obj[attr]) {
                            if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                                xml2.ele(sub_attr, body_Obj[attr][sub_attr].toString().replace(/,/g, ' '));
                            }
                        }
                        delete body_Obj[attr];
                        break;
                    }
                }
            }

            xmlInsert(xml, body_Obj, 'exc');
            xmlInsertList(xml, body_Obj, 'nu');
            xmlInsert(xml, body_Obj, 'gpi');
            xmlInsert(xml, body_Obj, 'nfu');

            for (attr in body_Obj) {
                if (body_Obj.hasOwnProperty(attr)) {
                    if (attr == 'bn') {
                        xml2 = xml.ele(attr, '');
                        for (sub_attr in body_Obj[attr]) {
                            if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                                xml2.ele(sub_attr, body_Obj[attr][sub_attr].toString());
                            }
                        }
                        delete body_Obj[attr];
                        break;
                    }
                }
            }

            xmlInsert(xml, body_Obj, 'rl');
            xmlInsert(xml, body_Obj, 'psn');
            xmlInsert(xml, body_Obj, 'pn');
            xmlInsert(xml, body_Obj, 'nsp');
            xmlInsert(xml, body_Obj, 'ln');
            xmlInsert(xml, body_Obj, 'nct');
            xmlInsert(xml, body_Obj, 'nec');
            xmlInsert(xml, body_Obj, 'cr');
            xmlInsert(xml, body_Obj, 'su');
        }

        else if (xml.name === 'm2m:grp') {
            xmlInsert(xml, body_Obj, 'daci', 'et');
            xmlInsert(xml, body_Obj, 'cr');
            xmlInsert(xml, body_Obj, 'mt');
            xmlInsert(xml, body_Obj, 'cnm');
            xmlInsert(xml, body_Obj, 'mnm');
            xmlInsertList(xml, body_Obj, 'mid');
            xmlInsertList(xml, body_Obj, 'macp');
            xmlInsert(xml, body_Obj, 'mtv');
            xmlInsert(xml, body_Obj, 'csy');
            xmlInsert(xml, body_Obj, 'gn');
            xmlInsert(xml, body_Obj, 'csi');
        }

        else if (xml.name === 'm2m:acp') {
            for (attr in body_Obj) {
                if (body_Obj.hasOwnProperty(attr)) {
                    if (attr == 'pv' || attr == 'pvs') {
                        xml2 = xml.ele(attr, '');
                        for (sub_attr in body_Obj[attr]) {
                            if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                                for (sub_attr2 in body_Obj[attr][sub_attr]) {
                                    if (body_Obj[attr][sub_attr].hasOwnProperty(sub_attr2)) {
                                        var xml3 = xml2.ele(sub_attr, '');
                                        for (var sub_attr3 in body_Obj[attr][sub_attr][sub_attr2]) {
                                            if (body_Obj[attr][sub_attr][sub_attr2].hasOwnProperty(sub_attr3)) {
                                                if(sub_attr3 == 'acco') {
                                                    for (var sub_attr4 in body_Obj[attr][sub_attr][sub_attr2][sub_attr3]) {
                                                        if (body_Obj[attr][sub_attr][sub_attr2][sub_attr3].hasOwnProperty(sub_attr4)) {
                                                            var xml4 = xml3.ele(sub_attr3, '');
                                                            for (var sub_attr5 in body_Obj[attr][sub_attr][sub_attr2][sub_attr3][sub_attr4]) {
                                                                if (body_Obj[attr][sub_attr][sub_attr2][sub_attr3][sub_attr4].hasOwnProperty(sub_attr5)) {
                                                                    if(sub_attr5 == 'acip') {
                                                                        var xml5 = xml4.ele(sub_attr5, '');
                                                                        for (var sub_attr6 in body_Obj[attr][sub_attr][sub_attr2][sub_attr3][sub_attr4][sub_attr5]) {
                                                                            if (body_Obj[attr][sub_attr][sub_attr2][sub_attr3][sub_attr4][sub_attr5].hasOwnProperty(sub_attr6)) {
                                                                                var xml6 = xml5.ele(sub_attr6, '');
                                                                                xml6.txt(body_Obj[attr][sub_attr][sub_attr2][sub_attr3][sub_attr4][sub_attr5][sub_attr6]);
                                                                            }
                                                                        }
                                                                    }
                                                                    if(sub_attr5 == 'actw') {
                                                                        xml5 = xml4.ele(sub_attr5, '');
                                                                        xml5.txt(body_Obj[attr][sub_attr][sub_attr2][sub_attr3][sub_attr4][sub_attr5]);
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                else {
                                                    xml3.ele(sub_attr3, body_Obj[attr][sub_attr][sub_attr2][sub_attr3].toString().replace(/,/g, ' '));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        delete body_Obj[attr];
                    }
                }
            }
            xmlInsert(xml, body_Obj, 'cr');
        }
    }

    for (var attr in body_Obj) {
        if (body_Obj.hasOwnProperty(attr)) {
            if (attr == 'resourceName' || attr == 'rn') {
                xml.att(attr, body_Obj[attr]);
            }
            else if (attr == 'eventNotificationCriteria' || attr == 'enc') {
                xml2 = xml.ele(attr, '');
                for (sub_attr in body_Obj[attr]) {
                    if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                        xml2.ele(sub_attr, body_Obj[attr][sub_attr].toString().replace(/,/g, ' '));
                    }
                }
            }
            else if (attr == 'bn' || attr == 'uds' || attr == 'cas') {
                xml2 = xml.ele(attr, '');
                for (sub_attr in body_Obj[attr]) {
                    if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                        xml2.ele(sub_attr, body_Obj[attr][sub_attr].toString());
                    }
                }
            }
            else if (attr == 'privileges' || attr == 'pv' || attr == 'selfPrivileges' || attr == 'pvs') {
                xml2 = xml.ele(attr, '');
                for (sub_attr in body_Obj[attr]) {
                    if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                        for (var sub_attr2 in body_Obj[attr][sub_attr]) {
                            if (body_Obj[attr][sub_attr].hasOwnProperty(sub_attr2)) {
                                xml3 = xml2.ele(sub_attr, '');
                                for (sub_attr3 in body_Obj[attr][sub_attr][sub_attr2]) {
                                    if (body_Obj[attr][sub_attr][sub_attr2].hasOwnProperty(sub_attr3)) {
                                        xml3.ele(sub_attr3, body_Obj[attr][sub_attr][sub_attr2][sub_attr3].toString().replace(/,/g, ' '));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else if (attr == 'accessControlPolicyIDs' || attr == 'acpi') {
                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
            }
            else if (attr == 'labels' || attr == 'lbl') {
                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
            }
            else if (attr == 'supportedResourceType' || attr == 'srt') {
                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
            }
            else if (attr == 'pointOfAccess' || attr == 'poa') {
                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
            }
            else if (attr == 'notificationURI' || attr == 'nu') {
                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
            }
            else if (attr == 'memberIDs' || attr == 'mid') {
                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
            }
            else if (attr == 'membersAccessControlPolicyIDs' || attr == 'macp') {
                xml.ele(attr, body_Obj[attr].toString().replace(/,/g, ' '));
            }
            else if (attr == 'pc') {
                xml2 = xml.ele(attr, '');
                for (var sub_attr in body_Obj[attr]) {
                    if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                        xml2.ele(sub_attr, body_Obj[attr][sub_attr]);
                    }
                }
            }
            else {
                xml.ele(attr, body_Obj[attr]);
            }
        }
    }
}

exports.convertXml = function(rootnm, body_Obj) {
    var xml = xmlbuilder.create('m2m:' + rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
        {pubID: null, sysID: null}, {
            allowSurrogateChars: false,
            skipNullAttributes: false,
            headless: false,
            ignoreDecorators: false,
            stringify: {}
        }
    ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

    for (var index in body_Obj) {
        if (body_Obj.hasOwnProperty(index)) {
            if (index == 'uri' || index == 'm2m:uri') {
                xml.txt(body_Obj[index]);
            }
            else if (index == 'm2m:dbg') {
                xml.txt(body_Obj[index]);
            }
            else {
                xmlAction(xml, body_Obj[index]);
            }
        }
    }
    return xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
};

exports.convertXml2 = function(rootnm, body_Obj) {
    var xml = xmlbuilder.create('m2m:' + rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
        {pubID: null, sysID: null}, {
            allowSurrogateChars: false,
            skipNullAttributes: false,
            headless: false,
            ignoreDecorators: false,
            stringify: {}
        }
    ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

    for (var index in body_Obj) {
        if (body_Obj.hasOwnProperty(index)) {
            for (var prop in body_Obj[index]) {
                if (body_Obj[index].hasOwnProperty(prop)) {
                    if (body_Obj[index][prop].pc) { // aggregated response for fanout
                        var xml_0 = xml.ele(index);
                        for (var agr_attr in body_Obj[index][prop]) {
                            if (body_Obj[index][prop].hasOwnProperty(agr_attr)) {
                                if (agr_attr == 'pc') {
                                    var xml_01 = xml_0.ele(agr_attr);
                                    for (var pc_attr in body_Obj[index][prop][agr_attr]) {
                                        if (body_Obj[index][prop][agr_attr].hasOwnProperty(pc_attr)) {
                                            var xml_1 = xml_01.ele(pc_attr);
                                            xmlAction(xml_1, body_Obj[index][prop][agr_attr][pc_attr]);
                                        }
                                    }
                                }
                                else {
                                    xml_1 = xml_0.ele(agr_attr, body_Obj[index][prop][agr_attr]);
                                }
                            }
                        }
                    }
                    else {
                        for (var attr in body_Obj[index][prop]) {
                            if (body_Obj[index][prop].hasOwnProperty(attr)) {
                                xml_1 = xml.ele(prop);
                                xmlAction(xml_1, body_Obj[index][prop][attr]);
                            }
                        }
                    }
                }
            }
        }
    }

    return xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
};


exports.convertXmlMqtt = function(rootnm, body_Obj) {
    var xml = xmlbuilder.create('m2m:' + rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
        {pubID: null, sysID: null}, {
            allowSurrogateChars: false,
            skipNullAttributes: false,
            headless: false,
            ignoreDecorators: false,
            stringify: {}
        }
    ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

    xmlInsert(xml, body_Obj, 'rsc');
    xmlInsert(xml, body_Obj, 'rqi');
    var xml2 = xml.ele('pc');

    for (var index in body_Obj) {
        if (body_Obj.hasOwnProperty(index)) {
            if(index == 'pc') {
                for (var attr in body_Obj[index]) {
                    if (body_Obj[index].hasOwnProperty(attr)) {
                        if(attr == 'm2m:dbg') {
                            xmlAction(xml2, body_Obj[index]);
                            break;
                        }
                        else {
                            var xml3 = xml2.ele(attr);
                            xmlAction(xml3, body_Obj[index][attr]);
                            break;
                        }
                    }
                }
            }
        }
    }
    return xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
};

exports.convertXmlSgn = function(rootnm, body_Obj) {
    var sgn = xmlbuilder.create(rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
        {pubID: null, sysID: null}, {
            allowSurrogateChars: false,
            skipNullAttributes: false,
            headless: false,
            ignoreDecorators: false,
            stringify: {}
        }
    ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

    var sequence1 = ['nev', 'vrq', 'sud', 'sur', 'cr'];
    var sequence2 = ['rep', 'net'];

    for(var seq1 in sequence1) {
        if(sequence1.hasOwnProperty(seq1)) {
            for (var prop in body_Obj) {
                if (body_Obj.hasOwnProperty(prop)) {
                    if (prop === sequence1[seq1]) {
                        if (prop === 'nev') {
                            var xml_0 = sgn.ele(prop);
                            for(var seq2 in sequence2) {
                                if (sequence2.hasOwnProperty(seq2)) {
                                    for (var agr_attr in body_Obj[prop]) {
                                        if (body_Obj[prop].hasOwnProperty(agr_attr)) {
                                            if (agr_attr === sequence2[seq2]) {
                                                if (agr_attr === 'rep') {
                                                    var xml_01 = xml_0.ele(agr_attr);
                                                    for (var pc_attr in body_Obj[prop][agr_attr]) {
                                                        if (body_Obj[prop][agr_attr].hasOwnProperty(pc_attr)) {
                                                            var xml_1 = xml_01.ele(pc_attr);
                                                            xmlAction(xml_1, body_Obj[prop][agr_attr][pc_attr]);
                                                        }
                                                    }
                                                    break;
                                                }
                                                else if (agr_attr === 'net') {
                                                    xml_0.ele(agr_attr, body_Obj[prop][agr_attr]);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            break;
                        }
                        else {
                            sgn.ele(prop, body_Obj[prop]);
                            break;
                        }
                    }
                }
            }
        }
    }

    return sgn.end({pretty: false, indent: '  ', newline: '\n'}).toString();
};

exports.typeCheckforJson = function(body_Obj) {
    for (var index1 in body_Obj) {
        if(body_Obj.hasOwnProperty(index1)) {
            typeCheckAction(index1, body_Obj[index1]);
        }
    }
};

function typeCheckforJson2(body_Obj) {
    for (var index1 in body_Obj) {
        if(body_Obj.hasOwnProperty(index1)) {
            for (var index2 in body_Obj[index1]) {
                if (body_Obj[index1].hasOwnProperty(index2)) {
                    typeCheckAction(index1, body_Obj[index1][index2]);
                }
            }
        }
    }
}

var operation = {
    'post': 1,
    'get': 2,
    'put': 3,
    'delete': 4
};

exports.response_result = function(request, response, status, rsc, cap, callback) {
    var body_Obj = request.resourceObj;

    if(request.headers.hasOwnProperty('x-m2m-ri')) {
        response.header('X-M2M-RI', request.headers['x-m2m-ri']);
    }

    if(request.headers.hasOwnProperty('x-m2m-rvi')) {
        response.header('X-M2M-RVI', request.headers['x-m2m-rvi']);
    }

    if(request.headers.hasOwnProperty('accept')) {
        response.header('Accept', request.headers['accept']);

        if(request.headers['accept'].includes('xml')) {
            request.usebodytype = 'xml';
            response.header('Content-Type', 'application/xml');
        }
        else if(request.headers['accept'].includes('cbor')) {
            request.usebodytype = 'cbor';
            response.header('Content-Type', 'application/cbor');
        }
        else {
            request.usebodytype = 'json';
            response.header('Content-Type', 'application/json');
        }
    }

    if(request.headers.hasOwnProperty('locale')) {
        response.header('Locale', request.headers['locale']);
    }

    response.header('X-M2M-RSC', rsc);

    if (request.query.rcn == 0 && Object.keys(body_Obj)[0] != 'dbg') {
        if (request.query.rt == 3) {
            // parseInt: status 는 resultStatusCode 테이블에서 '400' 같은 문자열로
            // 온다. Express 는 문자열 상태코드를 deprecated 로 경고하는데, 그게 모든
            // 응답마다 찍혀 에러 로그를 덮어써서 진짜 에러가 묻혔다.
            response.status(parseInt(status, 10)).end('');

            var rspObj = {
                rsc: rsc,
                dbg: cap
            };
            rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);

            // console.log(JSON.stringify(rspObj)); // 응답 바디 전체 덤프 - 로그 폭주 원인이라 비활성

            body_Obj = null;
            rspObj = null;

            callback();
        }
        else {
            // 예전에는 rt==1 일 때 req 리소스에 결과를 적는 분기가 있었다.
            // 논블로킹을 지원하지 않게 되면서 도달할 수 없다.
            callback();
        }
    }
    else {
        if (request.query.rt == 3) {
            var check_header = ['x-m2m-ri', 'x-m2m-rvi', 'locale', 'accept'];
            for(var idx in check_header) {
                if(check_header.hasOwnProperty(idx)) {
                    var chk = check_header[idx];
                    if (request.headers.hasOwnProperty(chk)) {
                        if (chk === 'x-m2m-ri' || chk === 'x-m2m-rvi' || chk === 'locale') {
                            response.header(chk, request.headers[chk]);
                        }
                        else if (chk === 'accept') {
                            if (request.headers[chk].includes('xml')) {
                                request.usebodytype = 'xml';
                                response.header('Content-Type', 'application/xml');
                            }
                            else if (request.headers[chk].includes('cbor')) {
                                request.usebodytype = 'cbor';
                                response.header('Content-Type', 'application/cbor');
                            }
                            else {
                                request.usebodytype = 'json';
                                response.header('Content-Type', 'application/json');
                            }
                        }
                    }
                    else {
                        if (chk === 'accept') {
                            request.usebodytype = 'json';
                            response.header('Content-Type', 'application/json');
                        }
                    }
                }
            }
            response.header('X-M2M-RSC', rsc);
        }

        var rootnm = Object.keys(body_Obj)[0];

        if(rootnm == 'mgo') {
            body_Obj['m2m:' + mgoType[body_Obj[rootnm].mgd]] = body_Obj[rootnm];
            delete body_Obj[rootnm];
        }
        else if(rootnm == 'fcnt') {
            if (body_Obj[rootnm].cnd.includes('org.onem2m.home.device.')) {
                body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
            else if (body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.doorlock') {
                body_Obj['hd:' + rootnm.replace('fcnt', 'dooLk')] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
            else if (body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.battery') {
                body_Obj['hd:' + rootnm.replace('fcnt', 'bat')] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
            else if (body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.temperature') {
                body_Obj['hd:' + rootnm.replace('fcnt', 'tempe')] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
            else if (body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.binarySwitch') {
                body_Obj['hd:' + rootnm.replace('fcnt', 'binSh')] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
            else if (body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.faultDetection') {
                body_Obj['hd:' + rootnm.replace('fcnt', 'fauDn')] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
            else if (body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colourSaturation') {
                body_Obj['hd:' + rootnm.replace('fcnt', 'colSn')] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
            else if (body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.colour') {
                body_Obj['hd:' + rootnm.replace('fcnt', 'color')] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
            else if (body_Obj[rootnm].cnd == 'org.onem2m.home.moduleclass.brightness') {
                body_Obj['hd:' + rootnm.replace('fcnt', 'brigs')] = body_Obj[rootnm];
                delete body_Obj[rootnm];
            }
        }
        else if(rootnm.includes('hd_')) {
            body_Obj['hd:' + rootnm.replace('hd_', '')] = body_Obj[rootnm];
            delete body_Obj[rootnm];
        }
        else {
            body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
            delete body_Obj[rootnm];
        }

        _this.typeCheckforJson(body_Obj);

        // req(ty=17)의 pc 를 특별 취급하던 분기는 걷어냈다. 논블로킹을 지원하지
        // 않게 되면서 이 리소스를 만드는 경로도, 저장할 테이블도 없어졌다.
        // (migrations/003-drop-req-table.js)

        var bodyString = JSON.stringify(body_Obj);

        // console.log(bodyString); // 응답 바디 전체 덤프 - 로그 폭주 원인이라 비활성

        // 논블로킹(rt=1/2)은 지원하지 않는다 — app.js 의 check_request_query_rt 가
        // 405-4 로 막으므로 여기까지 오는 요청은 모두 블로킹이다.
        // 예전에는 여기서 rt 로 갈라져 한쪽이 req 리소스에 결과를 적었다.
        if (request.usebodytype == 'json') {
        }
        else if (request.usebodytype == 'cbor') {
            bodyString = cbor.encode(body_Obj).toString('hex');
        }
        else {
            bodyString = _this.convertXml(rootnm, body_Obj);
        }

        response.status(parseInt(status, 10)).end(bodyString);

        rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
        rspObj = cap;
        // console.log(JSON.stringify(rspObj)); // 응답 바디 전체 덤프 - 로그 폭주 원인이라 비활성

        body_Obj = null;
        rspObj = null;

        callback();
    }
};


exports.response_rcn3_result = function(request, response, status, rsc, cap, callback) {
    var body_Obj = request.resourceObj;

    if (request.query.rt == 3) {
        var check_header = ['x-m2m-ri', 'x-m2m-rvi', 'locale', 'accept'];

        for(var idx in check_header) {
            var chk = check_header[idx];
            if(request.headers.hasOwnProperty(chk)) {
                if(chk === 'x-m2m-ri' || chk === 'x-m2m-rvi') {
                    response.header(chk.toUpperCase(), request.headers[chk]);
                }
                else if(chk === 'locale') {
                    response.header(chk, request.headers[chk]);
                }
                else if(chk === 'accept') {
                    if(request.headers[chk].includes('xml')) {
                        request.usebodytype = 'xml';
                        response.header('Content-Type', 'application/xml');
                    }
                    else if(request.headers[chk].includes('cbor')) {
                        request.usebodytype = 'cbor';
                        response.header('Content-Type', 'application/cbor');
                    }
                    else {
                        request.usebodytype = 'json';
                        response.header('Content-Type', 'application/json');
                    }
                }
            }
            else {
                if(chk === 'accept') {
                    request.usebodytype = 'json';
                    response.header('Content-Type', 'application/json');
                }
            }
        }

        response.header('X-M2M-RSC', rsc);
    }

    var rootnm = request.headers.rootnm;

    body_Obj[rootnm] = {};
    body_Obj[rootnm] = body_Obj['rce'][rootnm];

    body_Obj['rce']['m2m:' + rootnm] = body_Obj[rootnm];
    //body_Obj['rce']['uri'] = body_Obj.rce.uri;
    body_Obj['m2m:rce'] = body_Obj.rce;
    delete body_Obj[rootnm];
    delete body_Obj['rce'][rootnm];
    //delete body_Obj.rce.uri;
    delete body_Obj.rce;
    var rce_nm = 'rce';

    _this.typeCheckforJson(body_Obj['m2m:rce']);

    var bodyString = JSON.stringify(body_Obj);

    // rt 가 1/2/3 이 아니거나 rt==2 인데 x-m2m-rtu 가 없으면, 예전에는 두 조건이
    // 모두 거짓이 되어 콜백이 사라졌다 — 응답도 connection.release() 도 없이
    // 요청이 매달렸다. 크래시가 아니라 워커 재시작도 안 걸리는 조용한 고갈이다.
    // 이제 논블로킹만 명시적으로 잡고 나머지는 기본(블로킹)으로 보낸다.
    // 논블로킹(rt=1/2)은 지원하지 않는다 — app.js 의 check_request_query_rt 가
    // 405-4 로 막으므로 여기까지 오는 요청은 모두 블로킹이다.
    // 예전에는 여기서 rt 로 갈라져 한쪽이 req 리소스에 결과를 적었다.
    if (request.usebodytype == 'json') {
    }
    else if (request.usebodytype == 'cbor') {
        bodyString = cbor.encode(body_Obj).toString('hex');
    }
    else {
        var xml_root = xmlbuilder.create('m2m:' + rce_nm, {version: '1.0', encoding: 'UTF-8', standalone: true},
            {pubID: null, sysID: null}, {
                allowSurrogateChars: false,
                skipNullAttributes: false,
                headless: false,
                ignoreDecorators: false,
                stringify: {}
            }
        ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

        for (var rce in body_Obj) {
            if (body_Obj.hasOwnProperty(rce)) {
                for (var index in body_Obj[rce]) {
                    if (body_Obj[rce].hasOwnProperty(index)) {
                        if (index == 'uri') {
                            var xml = xml_root.ele(index, body_Obj[rce][index]);
                        }
                        else {
                            xml = xml_root.ele(index, '');
                            xmlAction(xml, body_Obj[rce][index]);
                        }
                    }
                }
            }
        }
        bodyString = xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
    }

    response.status(parseInt(status, 10)).end(bodyString);

    var rspObj = {};
    rspObj.rsc = rsc;
    rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
    rspObj = cap;
    // console.log(JSON.stringify(rspObj)); // 응답 바디 전체 덤프 - 로그 폭주 원인이라 비활성

    delete body_Obj;
    delete rspObj;

    body_Obj = null;
    rspObj = null;

    callback();
};


exports.search_result = function(request, response, status, rsc, cap, callback) {
    var body_Obj = request.resourceObj;

    if (request.query.rt == 3) {
        var check_header = ['x-m2m-ri', 'x-m2m-rvi', 'locale', 'accept'];

        for(var idx in check_header) {
            var chk = check_header[idx];
            if(request.headers.hasOwnProperty(chk)) {
                if(chk === 'x-m2m-ri' || chk === 'x-m2m-rvi') {
                    response.header(chk.toUpperCase(), request.headers[chk]);
                }
                else if(chk === 'locale') {
                    response.header(chk, request.headers[chk]);
                }
                else if(chk === 'accept') {
                    if(request.headers[chk].includes('xml')) {
                        request.usebodytype = 'xml';
                        response.header('Content-Type', 'application/xml');
                    }
                    else if(request.headers[chk].includes('cbor')) {
                        request.usebodytype = 'cbor';
                        response.header('Content-Type', 'application/cbor');
                    }
                    else {
                        request.usebodytype = 'json';
                        response.header('Content-Type', 'application/json');
                    }
                }
            }
            else {
                if(chk === 'accept') {
                    request.usebodytype = 'json';
                    response.header('Content-Type', 'application/json');
                }
            }
        }

        response.header('X-M2M-RSC', rsc);
    }

    if (Object.keys(body_Obj)[0] == 'rsp') {
        rootnm = 'rsp';
    }

    if (request.headers.rootnm == 'uril') {
        var rootnm = request.headers.rootnm;

        // rt 가 1/2/3 이 아니거나 rt==2 인데 x-m2m-rtu 가 없으면, 예전에는 두 조건이
        // 모두 거짓이 되어 콜백이 사라졌다 — 응답도 connection.release() 도 없이
        // 요청이 매달렸다. 크래시가 아니라 워커 재시작도 안 걸리는 조용한 고갈이다.
        // 이제 논블로킹만 명시적으로 잡고 나머지는 기본(블로킹)으로 보낸다.
        // 논블로킹(rt=1/2)은 지원하지 않는다 — app.js 의 check_request_query_rt 가
        // 405-4 로 막으므로 여기까지 오는 요청은 모두 블로킹이다.
        // 예전에는 여기서 rt 로 갈라져 한쪽이 req 리소스에 결과를 적었다.
        body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
        delete body_Obj[rootnm];

        var bodyString = JSON.stringify(body_Obj);

        if (request.usebodytype == 'json') {
        }
        else if (request.usebodytype == 'cbor') {
            bodyString = cbor.encode(body_Obj).toString('hex');
        }
        else {
            body_Obj['m2m:' + rootnm] = body_Obj['m2m:' + rootnm].toString().replace(/,/g, ' ');
            var xml = xmlbuilder.create('m2m:' + rootnm, {version: '1.0', encoding: 'UTF-8', standalone: true},
                {pubID: null, sysID: null}, {
                    allowSurrogateChars: false,
                    skipNullAttributes: false,
                    headless: false,
                    ignoreDecorators: false,
                    stringify: {}
                }
            ).att('xmlns:m2m', 'http://www.onem2m.org/xml/protocols').att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
            xml.txt(body_Obj['m2m:' + rootnm]);
            bodyString = xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
        }

        response.status(parseInt(status, 10)).end(bodyString);

        var rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
        rspObj = cap;
        // console.log(JSON.stringify(rspObj)); // 응답 바디 전체 덤프 - 로그 폭주 원인이라 비활성

        callback();
    }
    else {
        rootnm = request.headers.rootnm;

        var res_Obj = {};
        for (var prop in body_Obj) {
            if (body_Obj.hasOwnProperty(prop)) {
                if (body_Obj[prop].ty == null) {
                    var ty = '99';
                }
                else {
                    ty = body_Obj[prop].ty;
                }

                if(typeRsrc[ty] == 'mgo') {
                    if (res_Obj['m2m:' + mgoType[body_Obj[prop].mgd]] == null) {
                        res_Obj['m2m:' + mgoType[body_Obj[prop].mgd]] = [];
                    }

                    var tmp_Obj = {};
                    tmp_Obj['m2m:' + mgoType[body_Obj[prop].mgd]] = body_Obj[prop];
                    res_Obj['m2m:' + mgoType[body_Obj[prop].mgd]].push(tmp_Obj['m2m:' + mgoType[body_Obj[prop].mgd]]);
                    delete body_Obj[prop];
                }
                else {
                    if (res_Obj['m2m:' + typeRsrc[ty]] == null) {
                        res_Obj['m2m:' + typeRsrc[ty]] = [];
                    }

                    tmp_Obj = {};
                    tmp_Obj['m2m:' + typeRsrc[ty]] = body_Obj[prop];
                    res_Obj['m2m:' + typeRsrc[ty]].push(tmp_Obj['m2m:' + typeRsrc[ty]]);
                    delete body_Obj[prop];
                }
            }
        }

        body_Obj['m2m:' + rootnm] = res_Obj;

        typeCheckforJson2(body_Obj['m2m:' + rootnm]);

        bodyString = JSON.stringify(body_Obj);

        // rt 가 1/2/3 이 아니거나 rt==2 인데 x-m2m-rtu 가 없으면, 예전에는 두 조건이
        // 모두 거짓이 되어 콜백이 사라졌다 — 응답도 connection.release() 도 없이
        // 요청이 매달렸다. 크래시가 아니라 워커 재시작도 안 걸리는 조용한 고갈이다.
        // 이제 논블로킹만 명시적으로 잡고 나머지는 기본(블로킹)으로 보낸다.
        // 논블로킹(rt=1/2)은 지원하지 않는다 — app.js 의 check_request_query_rt 가
        // 405-4 로 막으므로 여기까지 오는 요청은 모두 블로킹이다.
        // 예전에는 여기서 rt 로 갈라져 한쪽이 req 리소스에 결과를 적었다.
        if (request.usebodytype == 'json') {
        }
        else if (request.usebodytype == 'cbor') {
            bodyString = cbor.encode(body_Obj['m2m:' + rootnm]).toString('hex');
        }
        else {
            if(rootnm == 'agr') {
                bodyString = _this.convertXml2(rootnm, body_Obj['m2m:' + rootnm]);
            }
            else {
                bodyString = _this.convertXml2(rootnm, body_Obj);
            }
        }

        response.status(parseInt(status, 10)).end(bodyString);

        rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
        rspObj = cap;
        // console.log(JSON.stringify(rspObj)); // 응답 바디 전체 덤프 - 로그 폭주 원인이라 비활성

        body_Obj = null;
        rspObj = null;

        callback();
    }
};

// 에러 응답 본체. 아래 respond() 와 error_result() 가 공유한다.
//
// httpStatus 는 number 로 와도 되고 문자열로 와도 된다. 카탈로그(mobius/rsc.js)는
// number 를 주지만, 옛 시그니처를 쓰는 호출부는 '400' 처럼 문자열을 준다.
// Express 는 문자열 상태코드에 deprecated 경고를 찍는데 그게 모든 응답마다 나와
// 에러 로그를 덮어써서 진짜 에러가 묻혔다. 여기서 한 번에 숫자로 만든다.
function sendError(request, response, httpStatus, rsc, dbg_string, callback) {
    request.query.rt = 3;
    var body_Obj = {};
    body_Obj['m2m:dbg'] = dbg_string;

    if(request.headers.hasOwnProperty('x-m2m-ri')) {
        response.header('X-M2M-RI', request.headers['x-m2m-ri']);
    }

    if(request.headers.hasOwnProperty('x-m2m-rvi')) {
        response.header('X-M2M-RVI', request.headers['x-m2m-rvi']);
    }

    if(request.headers.hasOwnProperty('accept')) {
        response.header('Accept', request.headers['accept']);

        if(request.headers['accept'].includes('xml')) {
            request.usebodytype = 'xml';
            response.header('Content-Type', 'application/xml');
        }
        else if(request.headers['accept'].includes('cbor')) {
            request.usebodytype = 'cbor';
            response.header('Content-Type', 'application/cbor');
        }
        else {
            request.usebodytype = 'json';
            response.header('Content-Type', 'application/json');
        }
    }

    if(request.headers.hasOwnProperty('locale')) {
        response.header('Locale', request.headers['locale']);
    }

    response.header('X-M2M-RSC', rsc);

    if (request.usebodytype == 'json') {
        var bodyString = JSON.stringify(body_Obj);
    }
    else if (request.usebodytype == 'cbor') {
        bodyString = cbor.encode(body_Obj).toString('hex');
    }
    else {
        bodyString = _this.convertXml('dbg', body_Obj);
    }

    body_Obj = null;

    response.status(Number(httpStatus)).end(bodyString);

    var rspObj = {};
    rspObj.rsc = rsc;
    rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
    rspObj.msg = dbg_string;
    // console.log(JSON.stringify(rspObj)); // 응답 바디 전체 덤프 - 로그 폭주 원인이라 비활성
    rspObj = null;

    callback();
}

// 단일 응답 진입점.
//
//   result = {
//     code:   mobius/rsc.js 의 카탈로그 항목 (http·rsc·coap 을 들고 있다)
//     dbg:    클라이언트 응답 본문(m2m:dbg)에 실릴 문구
//     detail: 로그에만 남길 상세 (드라이버 에러 원문, 내부 함수명 등)
//   }
//
// dbg 와 detail 을 나눈 이유: 지금은 내부 함수명과 DB 드라이버 에러 원문이
// m2m:dbg 로 클라이언트에 그대로 나간다. 문구 정리 단계에서 detail 로 옮기면
// 응답에는 안 나가고 로그에만 남는다.
//
// 성공 응답은 아직 response_result / search_result / response_rcn3_result 를
// 거친다. 그쪽 통합은 뒤 단계다.
exports.respond = function (request, response, result, callback) {
    var code = result.code;
    if (result.detail) {
        console.error('[' + (code && code.name ? code.name : '?') + '] ' + result.detail);
    }
    sendError(request, response, code.http, code.rsc, result.dbg, callback);
};

// 옛 시그니처 어댑터. status 가 '400' 같은 문자열로 들어온다.
// 새 코드는 respond() 를 쓴다.
exports.error_result = function (request, response, status, rsc, dbg_string, callback) {
    sendError(request, response, status, rsc, dbg_string, callback);
};
