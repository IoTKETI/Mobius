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
    "pei":"periodicInterval",
    "mdd":"missingDataDetect",
    "mdn":"missingDataMaxNr",
    "mdlt":"missingDataList",
    "mdc":"missingDataCurrentNr",
    "mdt":"missingDataDetectTimer",
    "dgt":"dataGenerationTime",
    "sqn":"sequenceNr",
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
    "periodicInterval":"pei",
    "missingDataDetect":"mdd",
    "missingDataMaxNr":"mdn",
    "missingDataList":"mdlt",
    "missingDataCurrentNr":"mdc",
    "missingDataDetectTimer":"mdt",
    "dataGenerationTime":"dgt",
    "sequenceNr":"sqn",
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
    "ts" : "timeSeries",
    "tsi": "timeSeriesInstance",
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
    "timeSeries"        : "ts",
    "timeSeriesInstance": "tsi",
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
    "17": "req",
    "23": "sub",
    "24": "smd",
    "27": "mms",
    "28": "fcnt",
    "29": "ts",
    "30": "tsi",
    "38": "tm",
    "39": "tr",
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
                index2 == 'mdn' || index2 == 'mdc' || index2 == 'mdt' || index2 == 'pei' || index2 == 'mnm' || index2 == 'exc' || index2 == 'rs' || index2 == 'ors') {

                if ((index1 == 'm2m:cb' || index1 == 'm2m:cin' || index1 == 'm2m:nod' || index1 == 'm2m:ae' || index1 == 'm2m:sub' || index1 == 'm2m:acp' ||
                        index1 == 'm2m:csr' || index1 == 'm2m:grp' || index1 == 'm2m:fwr' || index1 == 'm2m:bat' || index1 == 'm2m:dvi' || index1 == 'm2m:dvc' ||
                        index1 == 'm2m:rbo' || index1 == 'm2m:smd' || index1 == 'm2m:tr' || index1 == 'm2m:tm') &&
                    index2 == 'mni') {
                    delete body_Obj[index2];
                }
                else if ((index1 == 'm2m:cb' || index1 == 'm2m:csr' || index1 == 'm2m:ae' || index1 == 'm2m:acp' || index1 == 'm2m:grp' || index1 == 'm2m:sub' ||
                        index1 == 'm2m:nod' || index1 == 'm2m:fwr' || index1 == 'm2m:bat' || index1 == 'm2m:dvi' || index1 == 'm2m:dvc' || index1 == 'm2m:rbo' ||
                        index1 == 'm2m:tr' || index1 == 'm2m:tm') &&
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
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
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
                index2 == 'far' || index2 == 'mdd' || index2 == 'disr') {
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
                if(getType(body_Obj[index2]) === 'string') {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
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

        else if (xml.name === 'm2m:ts') {
            xmlInsert(xml, body_Obj, 'daci', 'et');
            xmlInsert(xml, body_Obj, 'st');
            xmlInsert(xml, body_Obj, 'cr');
            xmlInsert(xml, body_Obj, 'mni');
            xmlInsert(xml, body_Obj, 'mbs');
            xmlInsert(xml, body_Obj, 'mia');
            xmlInsert(xml, body_Obj, 'cni');
            xmlInsert(xml, body_Obj, 'cbs');
            xmlInsert(xml, body_Obj, 'pei');
            xmlInsert(xml, body_Obj, 'mdd');
            xmlInsert(xml, body_Obj, 'mdn');
            xmlInsertList(xml, body_Obj, 'mdlt');
            xmlInsert(xml, body_Obj, 'mdc');
            xmlInsert(xml, body_Obj, 'mdt');
            xmlInsert(xml, body_Obj, 'or');
        }

        else if (xml.name === 'm2m:tsi') {
            xmlInsert(xml, body_Obj, 'dgt');
            xmlInsert(xml, body_Obj, 'con');
            xmlInsert(xml, body_Obj, 'snr');
            xmlInsert(xml, body_Obj, 'cs');
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

        else if (xml.name === 'm2m:tm') {
            xmlInsert(xml, body_Obj, 'daci', 'et');
            xmlInsert(xml, body_Obj, 'cr');
            xmlInsert(xml, body_Obj, 'tltm');
            xmlInsert(xml, body_Obj, 'text');
            xmlInsert(xml, body_Obj, 'tct');
            xmlInsert(xml, body_Obj, 'tept');
            xmlInsert(xml, body_Obj, 'tmd');
            xmlInsert(xml, body_Obj, 'tltp');
            xmlInsert(xml, body_Obj, 'tctl');
            xmlInsert(xml, body_Obj, 'tst');
            xmlInsert(xml, body_Obj, 'tmr');
            xmlInsert(xml, body_Obj, 'tmh');
            xmlInsert(xml, body_Obj, 'rqps');
            xmlInsert(xml, body_Obj, 'rsps');
        }

        else if (xml.name === 'm2m:tr') {
            xmlInsert(xml, body_Obj, 'daci', 'et');
            xmlInsert(xml, body_Obj, 'cr');
            xmlInsert(xml, body_Obj, 'tid');
            xmlInsert(xml, body_Obj, 'tctl');
            xmlInsert(xml, body_Obj, 'tst');
            xmlInsert(xml, body_Obj, 'tltm');
            xmlInsert(xml, body_Obj, 'text');
            xmlInsert(xml, body_Obj, 'tct');
            xmlInsert(xml, body_Obj, 'tltp');
            xmlInsert(xml, body_Obj, 'trqp');
            xmlInsert(xml, body_Obj, 'trsp');
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
            else if (attr == 'mdlt') {
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

function store_to_req_resource(request, bodyString, rsc, cap, callback) {
    var op = operation[request.method];
    var mi = {};
    mi.rvi = request.headers['x-m2m-rvi'];
    var rs = 1;
    var ors = rsc;
    db_sql.update_req(request.connection, '/' + request.headers.tg, bodyString, op, JSON.stringify(mi), rs, ors, function () {
        var rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = request.method + "-" + request.headers['x-m2m-ri'] + "-" + JSON.stringify(request.query);
        rspObj = cap;
        console.log(JSON.stringify(rspObj));

        if (request.headers['x-m2m-rtu'] != null && request.headers['x-m2m-rtu'] != '') {
            var nu = request.headers['x-m2m-rtu'];
            var sub_nu = url.parse(nu);
            var xm2mri = require('shortid').generate();

            if (sub_nu.protocol == 'http:') {
                request_noti_http(nu, bodyString, request.usebodytype, xm2mri);
            }
            else if (sub_nu.protocol == 'coap:') {
                request_noti_coap(nu, bodyString, request.usebodytype, xm2mri);
            }
            else if (sub_nu.protocol == 'ws:') {
                request_noti_ws(nu, bodyString, request.usebodytype, xm2mri);
            }
            else { // mqtt:
                request_noti_mqtt(nu, bodyString, request.usebodytype, xm2mri);
            }
        }

        callback();
    });
}

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
            response.status(status).end('');

            var rspObj = {
                rsc: rsc,
                dbg: cap
            };
            rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);

            console.log(JSON.stringify(rspObj));

            body_Obj = null;
            rspObj = null;

            callback();
        }
        else if (request.query.rt == 1) {
            var mi = {};
            if(request.headers.hasOwnProperty('x-m2m-rvi')) {
                mi.rvi = request.headers['x-m2m-rvi'];
            }
            db_sql.update_req(request.connection, '/'+request.headers.tg, '', operation[request.method], JSON.stringify(mi), 1, rsc, function () {
                var rspObj = {
                    rsc: rsc,
                    dbg: cap
                };
                rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);

                console.log(JSON.stringify(rspObj));

                body_Obj = null;
                rspObj = null;

                callback();
            });
        }
        else {
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

        if(rootnm === 'req') {
            body_Obj['m2m:' + rootnm].pc = JSON.parse(body_Obj['m2m:' + rootnm].pc);
            if(Object.keys(body_Obj['m2m:' + rootnm].pc)[0] === 'm2m:uril') {
                body_Obj['m2m:' + rootnm].pc['m2m:uril'] = body_Obj['m2m:' + rootnm].pc['m2m:uril'].split(' ');
            }
        }

        var bodyString = JSON.stringify(body_Obj);

        console.log(bodyString);

        if (request.query.rt == 3 || (request.query.rt == 2 && request.headers['x-m2m-rtu'] == null && request.headers['x-m2m-rtu'] == '')) {
            if (request.usebodytype == 'json') {
            }
            else if (request.usebodytype == 'cbor') {
                bodyString = cbor.encode(body_Obj).toString('hex');
            }
            else {
                bodyString = _this.convertXml(rootnm, body_Obj);
            }

            response.status(status).end(bodyString);

            rspObj = {};
            rspObj.rsc = rsc;
            rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
            rspObj = cap;
            console.log(JSON.stringify(rspObj));

            body_Obj = null;
            rspObj = null;

            callback();
        }
        else if (request.query.rt == 1 || (request.query.rt == 2 && request.headers['x-m2m-rtu'] != null && request.headers['x-m2m-rtu'] != '')) {
            store_to_req_resource(request, bodyString, rsc, cap, function () {
                body_Obj = null;
                rspObj = null;

                callback();
            });
        }
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

    if (request.query.rt == 3 || (request.query.rt == 2 && request.headers['x-m2m-rtu'] == null && request.headers['x-m2m-rtu'] == '')) {
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

        response.status(status).end(bodyString);

        var rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
        rspObj = cap;
        console.log(JSON.stringify(rspObj));

        delete body_Obj;
        delete rspObj;

        body_Obj = null;
        rspObj = null;

        callback();
    }
    else if (request.query.rt == 1 || (request.query.rt == 2 && request.headers['x-m2m-rtu'] != null && request.headers['x-m2m-rtu'] != '')) {
        store_to_req_resource(request, bodyString, rsc, cap, function () {
            body_Obj = null;
            rspObj = null;

            callback();
        });
    }
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

        if (request.query.rt == 3) {
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

            response.status(status).end(bodyString);

            var rspObj = {};
            rspObj.rsc = rsc;
            rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
            rspObj = cap;
            console.log(JSON.stringify(rspObj));

            callback();
        }
        else if (request.query.rt == 1) {
            body_Obj[rootnm] = body_Obj[rootnm].toString().replace(/,/g, ' ');

            body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
            delete body_Obj[rootnm];

            bodyString = JSON.stringify(body_Obj);

            var mi = {};
            mi.rvi = request.headers['x-m2m-rvi'];
            db_sql.update_req(request.connection, '/'+request.headers.tg, bodyString, operation[request.method], JSON.stringify(mi), 1, rsc, function () {
                rspObj = {};
                rspObj.rsc = rsc;
                rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
                rspObj = cap;
                console.log(JSON.stringify(rspObj));

                body_Obj = null;
                rspObj = null;

                callback();
            });
        }
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

        if (request.query.rt == 3 || (request.query.rt == 2 && request.headers['x-m2m-rtu'] == null && request.headers['x-m2m-rtu'] == '')) {
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

            response.status(status).end(bodyString);

            rspObj = {};
            rspObj.rsc = rsc;
            rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
            rspObj = cap;
            console.log(JSON.stringify(rspObj));

            body_Obj = null;
            rspObj = null;

            callback();
        }
        else if (request.query.rt == 1 || (request.query.rt == 2 && request.headers['x-m2m-rtu'] != null && request.headers['x-m2m-rtu'] != '')) {
            store_to_req_resource(request, bodyString, rsc, cap, function () {
                body_Obj = null;
                rspObj = null;

                callback();
            });
        }
    }
};

exports.error_result = function(request, response, status, rsc, dbg_string, callback) {
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

    response.status(status).end(bodyString);

    var rspObj = {};
    rspObj.rsc = rsc;
    rspObj.ri = request.method + "-" + request.url + "-" + JSON.stringify(request.query);
    rspObj.msg = dbg_string;
    console.log(JSON.stringify(rspObj));
    rspObj = null;

    callback();
};

function request_noti_http(nu, bodyString, bodytype, xm2mri) {
    var options = {
        hostname: url.parse(nu).hostname,
        port: url.parse(nu).port,
        path: url.parse(nu).path,
        method: 'POST',
        headers: {
            'X-M2M-RI': xm2mri,
            'Accept': 'application/'+bodytype,
            'X-M2M-Origin': usecseid,
            'Content-Type': 'application/'+bodytype,
            'X-M2M-RVI': uservi
        }
    };

    var bodyStr = '';
    var req = http.request(options, function (res) {
        //res.setEncoding('utf8');
        res.on('data', function (chunk) {
            bodyStr += chunk;
        });

        res.on('end', function () {
            console.log('----> [nonblocking-async-http] response for notification through http  ' + res.headers['x-m2m-rsc']);
        });
    });

    req.on('error', function (e) {
        if(e.message != 'read ECONNRESET') {
            console.log('[nonblocking-async-http] problem with request: ' + e.message);
        }
    });

    req.on('close', function() {
        console.log('[nonblocking-async-http] close: no response for notification');
    });

    console.log('<---- [nonblocking-async-http] notification for non-blocking request with ' + bodytype + ' to ' + nu);
    req.write(bodyString);
    req.end();
}

function request_noti_coap(nu, bodyString, bodytype, xm2mri) {
    var options = {
        host: url.parse(nu).hostname,
        port: url.parse(nu).port,
        pathname: url.parse(nu).path,
        method: 'post',
        confirmable: 'false',
        options: {
            'Accept': 'application/'+bodytype,
            'Content-Type': 'application/'+bodytype,
            'Content-Length' : bodyString.length
        }
    };

    var responseBody = '';
    var req = coap.request(options);
    req.setOption("256", new Buffer(usecseid));      // X-M2M-Origin
    req.setOption("257", new Buffer(xm2mri));    // X-M2M-RI
    req.on('response', function (res) {
        res.on('data', function () {
            responseBody += res.payload.toString();
        });

        res.on('end', function () {
            console.log('----> [nonblocking-async-coap] response for notification through coap  ' + res.code);
        });
    });

    console.log('<---- [nonblocking-async-coap] request for notification through coap with ' + bodytype);

    req.write(bodyString);
    req.end();
}

function request_noti_ws(nu, bodyString, bodytype, xm2mri) {
    var bodyStr = '';

    var WebSocketClient = require('websocket').client;
    var ws_client = new WebSocketClient();

    if(bodytype == 'xml') {
        ws_client.connect(nu, 'onem2m.r2.0.xml');
    }
    else if(bodytype == 'cbor') {
        ws_client.connect(nu, 'onem2m.r2.0.cbor');
    }
    else {
        ws_client.connect(nu, 'onem2m.r2.0.json');
    }

    ws_client.on('connectFailed', function (error) {
        console.log('[nonblocking-async-ws] Connect Error: ' + error.toString());
        ws_client.removeAllListeners();
    });

    ws_client.on('connect', function (connection) {
        console.log('<---- [nonblocking-async-ws] ' + nu);
        console.log(bodyString);
        connection.sendUTF(bodyString);

        connection.on('error', function (error) {
            console.log("[nonblocking-async-ws] Connection Error: " + error.toString());
        });

        connection.on('close', function () {
            console.log('[nonblocking-async-ws] Connection Closed');
        });

        connection.on('message', function (message) {
            console.log('----> [nonblocking-async-ws] ' + message.utf8Data.toString());

            var protocol_arr = this.protocol.split('.');

            if(bodytype === 'xml') {
                var xml2js = require('xml2js');
                var parser = new xml2js.Parser({explicitArray: false});
                parser.parseString(message.utf8Data.toString(), function (err, jsonObj) {
                    if (err) {
                        console.log('[nonblocking-async-ws] xml2js parser error');
                    }
                    else {
                        console.log('----> [nonblocking-async-ws] response for notification through mqtt ' + res.headers['x-m2m-rsc']);
                        connection.close();
                    }
                });
            }
            else if(bodytype === 'cbor') {
                var encoded = message.utf8Data.toString();
                cbor.decodeFirst(encoded, function(err, jsonObj) {
                    if (err) {
                        console.log('[nonblocking-async-ws] cbor parser error');
                    }
                    else {
                        if (jsonObj.rsc == 2001 || jsonObj.rsc == 2000) {
                            console.log('----> [nonblocking-async-ws] response for notification through ws ' + jsonObj.rsc);
                            connection.close();
                        }
                    }
                });
            }
            else { // 'json'
                var jsonObj = JSON.parse(message.utf8Data.toString());

                try {
                    if (jsonObj.rsc == 2001 || jsonObj.rsc == 2000) {
                        console.log('----> [nonblocking-async-ws] response for notification through ws ' + jsonObj.rsc + ' - ' + ri);
                        connection.close();
                    }
                }
                catch (e) {
                    console.log('----> [nonblocking-async-ws] response for notification through ws  - ' + ri);
                }
            }
        });
    });
}

function request_noti_mqtt(nu, bodyString, bodytype, xm2mri) {
    var aeid = url.parse(nu).pathname.replace('/', '').split('?')[0];
    console.log('[nonblocking-async-mqtt] - ' + aeid);

    if (aeid == '') {
        console.log('[nonblocking-async-mqtt] aeid of notification url is none');
        return;
    }

    var mqtt = require('mqtt');
    var _mqtt_client = mqtt.connect('mqtt://' + url.parse(nu).hostname + ':' + ((url.parse(nu).port != null) ? url.parse(nu).port : '1883'));

    _mqtt_client.on('connect', function () {
        var resp_topic = util.format('/oneM2M/resp/%s/#', usecseid.replace('/', ''));
        _mqtt_client.subscribe(resp_topic);

        console.log('[nonblocking-async-mqtt] subscribe resp_topic as ' + resp_topic);

        var noti_topic = util.format('/oneM2M/req/%s/%s/%s', usecseid.replace('/', ''), aeid, bodytype);

        _mqtt_client.publish(noti_topic, bodyString);
        console.log('<---- [nonblocking-async-mqtt] ' + noti_topic);
        _mqtt_client.end(function () {
            _mqtt_client = null;
        });
    });

    _mqtt_client.on('message', function (topic, message) {
        console.log('----> [nonblocking-async-mqtt] ' + topic + ' - ' + message);
        _mqtt_client.end(function () {
            _mqtt_client = null;
        });
    });

    _mqtt_client.on('error', function (error) {
        _mqtt_client.end(true, function () {
            _mqtt_client = null;
        });
    });
}
