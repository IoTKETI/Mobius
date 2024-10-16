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

require('dotenv').config();

global.defaultbodytype      = 'json';

global.use_db_user          = process.env.DB_USER;
global.use_db_host          = process.env.DB_HOST;
global.use_db_database      = process.env.DB_DATABASE;
global.use_db_password      = process.env.DB_PASSWORD;
global.use_db_port          = process.env.DB_PORT;

// my CSE information
global.use_cb_type          = process.env.CB_TYPE;
global.use_cb_name          = process.env.CB_NAME;
global.use_cb_id            = process.env.CB_ID;
global.use_cb_port          = process.env.CB_PORT;

global.use_pxy_ws_port      = process.env.PXY_WS_PORT;
global.use_pxy_mqtt_port    = process.env.PXY_MQTT_PORT;

global.use_secure           = process.env.SECURE_MODE;
global.use_mqtt_broker      = process.env.NOTI_MQTT_BROKER; // mqttbroker for mobius
global.use_mqtt_port        = process.env.NOTI_MQTT_PORT;

global.useaccesscontrolpolicy = 'disable';

global.allowed_ae_ids = [];
//allowed_ae_ids.push('ryeubi');

global.allowed_app_ids = [];
//allowed_app_ids.push('APP01');

global.usesemanticbroker    = '10.10.202.114';

global.uservi = '2a';

global.useCert = 'disable';

// CSE core
require('./app');
