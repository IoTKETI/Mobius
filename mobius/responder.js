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

var db_sql = require('./sql_action');


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
    "dspt": "descriptor",
    "cap":"caption",
    "pei":"periodicInterval",
    "mdd":"missingDataDetect",
    "mdn":"missingDataMaxNr",
    "mdl":"missingDataList",
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
    "descriptor":"dspt",
    "caption":"cap",
    "periodicInterval":"pei",
    "missingDataDetect":"mdd",
    "missingDataMaxNr":"mdn",
    "missingDataList":"mdl",
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
    "responseTypeValue":"rtv"
};

const rceLname = {
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
    "mms": "multimediaSession",
    "rce":"resource",
    "uri":"URI"
};


const rceSname = {
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
    "multimediaSession": "mms",
    "resource":"rce",
    "URI":"uri"
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
    "17": "req",
    "23": "sub",
    "24": "sd",
    "27": "mms",
    "29": "ts",
    "30": "tsi",
    "99": "rsp"
};

exports.typeRsrc = typeRsrc;
exports.rsrcSname = rceSname;
exports.rsrcLname = rceLname;
exports.attrLname = attrLname;
exports.attrSname = attrSname;

function typeCheckAction(index1, body_Obj) {
    for (var index2 in body_Obj) {
        if(body_Obj.hasOwnProperty(index2)) {
            if (body_Obj[index2] == null || body_Obj[index2] == '' || body_Obj[index2] == 'undefined' || body_Obj[index2] == '[]') {
                delete body_Obj[index2];
            }

            else if (index2 == 'cst' || index2 == 'los' || index2 == 'mt' || index2 == 'csy' || index2 == 'nct' || index2 == 'cnf' ||
                index2 == 'cs' || index2 == 'st' || index2 == 'ty' || index2 == 'cbs' || index2 == 'cni' || index2 == 'mni' ||
                index2 == 'cnm' || index2 == 'mia' || index2 == 'mbs') {

                if (index1 == 'm2m:cin' && index2 == 'mni') {
                    delete body_Obj[index2];
                }
                else if ((index1 == 'm2m:cb' || index1 == 'm2m:csr' || index1 == 'm2m:ae' || index1 == 'm2m:acp') && index2 == 'st') {
                    delete body_Obj[index2];
                }
                else {
                    body_Obj[index2] = parseInt(body_Obj[index2]);
                }
            }
            else if (index2 == 'aa' || index2 == 'at' || index2 == 'poa' || index2 == 'lbl' || index2 == 'acpi' || index2 == 'srt' || index2 == 'nu' || index2 == 'mid' || index2 == 'macp') {
                if (!Array.isArray(body_Obj[index2])) {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
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
            else if (index2 == 'srt') {
                for (index3 in body_Obj[index2]) {
                    if (body_Obj[index2].hasOwnProperty(index3)) {
                        body_Obj[index2][index3] = parseInt(body_Obj[index2][index3]);
                    }
                }
            }
            else if (index2 == 'rr' || index2 == 'mtv') {
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
                if (!Array.isArray(body_Obj[index2].acr)) {
                    body_Obj[index2] = JSON.parse(body_Obj[index2]);
                }

                body_Obj[index2]['acr'].splice(body_Obj[index2]['acr'].length-1, 1);
            }
        }
    }
}

function xmlAction(xml, body_Obj) {
    for (var attr in body_Obj) {
        if (body_Obj.hasOwnProperty(attr)) {
            if (attr == 'resourceName' || attr == 'rn') {
                xml.att(attr, body_Obj[attr]);
            }
            else if (attr == 'eventNotificationCriteria' || attr == 'enc') {
                var xml2 = xml.ele(attr, '');
                for (sub_attr in body_Obj[attr]) {
                    if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                        xml2.ele(sub_attr, body_Obj[attr][sub_attr].toString().replace(/,/g, ' '));
                    }
                }
            }
            else if (attr == 'privileges' || attr == 'pv' || attr == 'selfPrivileges' || attr == 'pvs') {
                xml2 = xml.ele(attr, '');
                for (var sub_attr in body_Obj[attr]) {
                    if (body_Obj[attr].hasOwnProperty(sub_attr)) {
                        for (var sub_attr2 in body_Obj[attr][sub_attr]) {
                            if (body_Obj[attr][sub_attr].hasOwnProperty(sub_attr2)) {
                                var xml3 = xml2.ele(sub_attr, '');
                                for (var sub_attr3 in body_Obj[attr][sub_attr][sub_attr2]) {
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
            else {
                xml.ele(attr, body_Obj[attr]);
            }
        }
    }
}

function convertXml(rootnm, body_Obj) {
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
            if (index == 'm2m:uri' || index == 'm2m:URI') {
                xml.ele(index, body_Obj[index]);
            }
            else if (index == 'm2m:dbg') {
                xml.ele(index, body_Obj[index]);
            }
            else {
                xmlAction(xml, body_Obj[index]);
            }
        }
    }
    return xml.end({pretty: false, indent: '  ', newline: '\n'}).toString();
}

function convertXml2(rootnm, body_Obj) {
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

                                            /*for (attr in body_Obj[index][prop][agr_attr][pc_attr]) {
                                                if (body_Obj[index][prop][agr_attr][pc_attr].hasOwnProperty(attr)) {
                                                    if (attr == 'resourceName' || attr == 'rn') {
                                                        xml_1.att(attr, body_Obj[index][prop][agr_attr][pc_attr][attr]);
                                                    }
                                                    else if (attr == 'eventNotificationCriteria' || attr == 'enc') {
                                                        xml2 = xml_1.ele(attr, '');
                                                        for (sub_attr in body_Obj[index][prop][agr_attr][pc_attr][attr]) {
                                                            if (body_Obj[index][prop][agr_attr][pc_attr][attr].hasOwnProperty(sub_attr)) {
                                                                xml2.ele(sub_attr, body_Obj[index][prop][pc_attr][attr][sub_attr].toString().replace(/,/g, ' '));
                                                            }
                                                        }
                                                    }
                                                    else if (attr == 'privileges' || attr == 'pv' || attr == 'selfPrivileges' || attr == 'pvs') {
                                                        xml2 = xml_1.ele(attr, '');
                                                        for (sub_attr in body_Obj[index][prop][agr_attr][pc_attr][attr]) {
                                                            if (body_Obj[index][prop][agr_attr][pc_attr][attr].hasOwnProperty(sub_attr)) {
                                                                for (sub_attr2 in body_Obj[index][prop][agr_attr][pc_attr][attr][sub_attr]) {
                                                                    if (body_Obj[index][prop][agr_attr][pc_attr][attr][sub_attr].hasOwnProperty(sub_attr2)) {
                                                                        xml3 = xml2.ele(sub_attr, '');
                                                                        for (sub_attr3 in body_Obj[index][prop][agr_attr][pc_attr][attr][sub_attr][sub_attr2]) {
                                                                            if (body_Obj[index][prop][agr_attr][pc_attr][attr][sub_attr][sub_attr2].hasOwnProperty(sub_attr3)) {
                                                                                xml3.ele(sub_attr3, body_Obj[index][prop][agr_attr][pc_attr][attr][sub_attr][sub_attr2][sub_attr3].toString().replace(/,/g, ' '));
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                    else if (attr == 'accessControlPolicyIDs' || attr == 'acpi') {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                                    }
                                                    else if (attr == 'labels' || attr == 'lbl') {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                                    }
                                                    else if (attr == 'supportedResourceType' || attr == 'srt') {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                                    }
                                                    else if (attr == 'pointOfAccess' || attr == 'poa') {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                                    }
                                                    else if (attr == 'notificationURI' || attr == 'nu') {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                                    }
                                                    else if (attr == 'memberIDs' || attr == 'mid') {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                                    }
                                                    else if (attr == 'membersAccessControlPolicyIDs' || attr == 'macp') {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr].toString().replace(/,/g, ' '));
                                                    }
                                                    else if (attr == 'primitiveContent' || attr == 'pc') {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr].toString());
                                                    }
                                                    else {
                                                        xml_1.ele(attr, body_Obj[index][prop][agr_attr][pc_attr][attr]);
                                                    }
                                                }
                                            }*/
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
}

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

exports.response_result = function(request, response, status, body_Obj, rsc, ri, cap) {
    if (request.query.rt == 3) {
        if (request.headers['x-m2m-ri'] != null) {
            response.setHeader('X-M2M-RI', request.headers['x-m2m-ri']);
        }

        if (request.headers.locale != null) {
            response.setHeader('locale', request.headers.locale);
        }

        response.setHeader('X-M2M-RSC', rsc);

        if (request.headers.accept) {
            try {
                if ((request.headers.accept.split('/')[1] == 'xml') || (request.headers.accept.split('+')[1] == 'xml')) {
                    request.headers.usebodytype = 'xml';
                }
            }
            catch (e) {
            }
        }

        if (request.headers.usebodytype == 'json') {
            response.setHeader('Content-Type', 'application/json');
        }
        else {
            response.setHeader('Content-Type', 'application/xml');
        }
    }

    if (request.query.rcn == 0 && Object.keys(body_Obj)[0] != 'dbg') {
        if (request.query.rt == 3) {
            response.status(status).end('');

            var rspObj = {
                rsc: rsc,
                ri: ri,
                dbg: cap
            };
            console.log(JSON.stringify(rspObj));
        }
        else if (request.query.rt == 1) {
            db_sql.update_req(request.headers.tg, '', rsc, function () {
                var rspObj = {
                    rsc: rsc,
                    ri: ri,
                    dbg: cap
                };
                console.log(JSON.stringify(rspObj));
            });
        }
    }
    else {
        var rootnm = Object.keys(body_Obj)[0];

        body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
        delete body_Obj[rootnm];

        _this.typeCheckforJson(body_Obj);

        var bodyString = JSON.stringify(body_Obj);

        if (request.headers.usebodytype == 'json') {
        }
        else {
            bodyString = convertXml(rootnm, body_Obj);
        }

        //console.log(bodyString);

        if (request.query.rt == 3) {
            response.status(status).end(bodyString);

            rspObj = {};
            rspObj.rsc = rsc;
            rspObj.ri = request.method + "-" + ri + "-" + JSON.stringify(request.query);
            rspObj = cap;
            console.log(JSON.stringify(rspObj));

            // for test of measuring elapsed time of processing in mobius
            // var hrend = process.hrtime(elapsed_hrstart[elapsed_tid]);
            // var elapsed_hr_str = util.format(require('moment')().utc().format('YYYYMMDDTHHmmss') + "(hr): %ds %dms\r\n", hrend[0], hrend[1]/1000000);
            // console.info(elapsed_hr_str);
            // console.timeEnd(elapsed_tid);
            // var fs = require('fs');
            // fs.appendFileSync('get_elapsed_time.log', elapsed_hr_str, 'utf-8');
            // delete elapsed_hrstart[elapsed_tid];
        }
        else if (request.query.rt == 1) {
            db_sql.update_req(request.headers.tg, bodyString, rsc, function () {
                rspObj = {};
                rspObj.rsc = rsc;
                rspObj.ri = request.method + "-" + ri + "-" + JSON.stringify(request.query);
                rspObj = cap;
                console.log(JSON.stringify(rspObj));
            });
        }
    }
};


exports.response_rcn3_result = function(request, response, status, body_Obj, rsc, ri, cap) {
    if (request.query.rt == 3) {
        if (request.headers['x-m2m-ri'] != null) {
            response.setHeader('X-M2M-RI', request.headers['x-m2m-ri']);
        }

        if (request.headers.locale != null) {
            response.setHeader('locale', request.headers.locale);
        }

        response.setHeader('X-M2M-RSC', rsc);

        if (request.headers.accept) {
            try {
                if ((request.headers.accept.split('/')[1] == 'xml') || (request.headers.accept.split('+')[1] == 'xml')) {
                    request.headers.usebodytype = 'xml';
                }
            }
            catch (e) {
            }
        }

        if (request.headers.usebodytype == 'json') {
            response.setHeader('Content-Type', 'application/json');
        }
        else {
            response.setHeader('Content-Type', 'application/xml');
        }
    }

    var rootnm = request.headers.rootnm;

    body_Obj[rootnm] = {};
    body_Obj[rootnm] = body_Obj['rce'][rootnm];

    body_Obj['rce']['m2m:' + rootnm] = body_Obj[rootnm];
    body_Obj['rce']['m2m:uri'] = body_Obj.rce.uri;
    body_Obj['m2m:rce'] = body_Obj.rce;
    delete body_Obj[rootnm];
    delete body_Obj['rce'][rootnm];
    delete body_Obj.rce.uri;
    delete body_Obj.rce;
    var rce_nm = 'rce';

    _this.typeCheckforJson(body_Obj['m2m:rce']);

    var bodyString = JSON.stringify(body_Obj);

    if (request.headers.usebodytype == 'json') {
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
                        if (index == 'm2m:uri') {
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

    if (request.query.rt == 3) {
        response.status(status).end(bodyString);

        var rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = request.method + "-" + ri + "-" + JSON.stringify(request.query);
        rspObj = cap;
        console.log(JSON.stringify(rspObj));
    }
    else if (request.query.rt == 1) {
        db_sql.update_req(request.headers.tg, bodyString, rsc, function () {
            rspObj = {};
            rspObj.rsc = rsc;
            rspObj.ri = request.method + "-" + ri + "-" + JSON.stringify(request.query);
            rspObj = cap;
            console.log(JSON.stringify(rspObj));
        });
    }
};


exports.search_result = function(request, response, status, body_Obj, rsc, ri, cap) {
    if (request.query.rt == 3) {
        if (request.headers['x-m2m-ri'] != null) {
            response.setHeader('X-M2M-RI', request.headers['x-m2m-ri']);
        }

        if (request.headers.locale != null) {
            response.setHeader('locale', request.headers.locale);
        }

        response.setHeader('X-M2M-RSC', rsc);

        if (request.headers.accept) {
            try {
                if ((request.headers.accept.split('/')[1] == 'xml') || (request.headers.accept.split('+')[1] == 'xml')) {
                    request.headers.usebodytype = 'xml';
                }
            }
            catch (e) {
            }
        }

        if (request.headers.usebodytype == 'json') {
            response.setHeader('Content-Type', 'application/json');
        }
        else {
            response.setHeader('Content-Type', 'application/xml');
        }
    }

    if (Object.keys(body_Obj)[0] == 'rsp') {
        rootnm = 'rsp';
    }

    if (request.headers.rootnm == 'uril') {
        var rootnm = request.headers.rootnm;
        body_Obj[rootnm] = body_Obj[rootnm].toString().replace(/,/g, ' ');
        if (request.headers.nmtype == 'long') {
            body_Obj['m2m:' + attrLname[rootnm]] = body_Obj[rootnm];
            delete body_Obj[rootnm];
            rootnm = attrLname[rootnm];
        }
        else {
            body_Obj['m2m:' + rootnm] = body_Obj[rootnm];
            delete body_Obj[rootnm];
        }

        var bodyString = JSON.stringify(body_Obj);

        if (request.headers.usebodytype == 'json') {
        }
        else {
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
                if (res_Obj['m2m:' + typeRsrc[ty]] == null) {
                    res_Obj['m2m:' + typeRsrc[ty]] = [];
                }
                var tmp_Obj = {};
                tmp_Obj['m2m:' + typeRsrc[ty]] = body_Obj[prop];
                delete body_Obj[prop];
                res_Obj['m2m:' + typeRsrc[ty]].push(tmp_Obj['m2m:' + typeRsrc[ty]]);
            }
        }

        body_Obj['m2m:' + rootnm] = res_Obj;

        typeCheckforJson2(body_Obj['m2m:' + rootnm]);

        bodyString = JSON.stringify(body_Obj['m2m:' + rootnm]);

        if (request.headers.usebodytype == 'json') {
        }
        else {
            if(rootnm == 'agr') {
                bodyString = convertXml2(rootnm, body_Obj['m2m:' + rootnm]);
            }
            else {
                bodyString = convertXml2(rootnm, body_Obj);
            }
        }
    }

    if (request.query.rt == 3) {
        response.status(status).end(bodyString);

        var rspObj = {};
        rspObj.rsc = rsc;
        rspObj.ri = request.method + "-" + request.url;
        rspObj = cap;
        console.log(JSON.stringify(rspObj));
    }
    else if (request.query.rt == 1) {
        db_sql.update_req(request.headers.tg, bodyString, rsc, function () {
            rspObj = {};
            rspObj.rsc = rsc;
            rspObj.ri = request.method + "-" + ri + "-" + JSON.stringify(request.query);
            rspObj = cap;
            console.log(JSON.stringify(rspObj));
        });
    }
};

exports.error_result = function(request, response, status, rsc, dbg_string) {
    request.query.rt = 3;
    var body_Obj = {};
    body_Obj['dbg'] = dbg_string;

    _this.response_result(request, response, status, body_Obj, rsc, request.url, body_Obj['dbg']);
};