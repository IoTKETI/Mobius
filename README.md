# Mobius
oneM2M IoT Server Platform
## Introduction
Mobius is the open source IoT server platform based on the oneM2M (http://www.oneM2M.org) standard. As oneM2M specifies, Mobius provides common services functions (e.g. registration, data management, subscription/notification, security) as middleware to IoT applications of different service domains. Not just oneM2M devices, but also non-oneM2M devices (i.e. by oneM2M interworking specifications and OCEAN TAS) can connect to Mobius.
## System Stucture
In oneM2M architecture, Mobius implements the IN-CSE which is the cloud server in the infrastructure domain. IoT applications communicate with field domain IoT gateways/devices via Mobius.

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28322739-d7fddbc4-6c11-11e7-9180-827be6d997f0.png" width="800"/>
</div>

## Connectivity Stucture
To enable Internet of Things, things are connected to &Cube via TAS (Thing Adaptation Software), then &Cube communicate with Mobius over oneM2M standard APIs. Also IoT applications use oneM2M standard APIs to retrieve thing data control things of Mobius.

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28322868-33e97f4c-6c12-11e7-97fc-6de66c06add7.png" width="800"/>
</div>

## Software Architecture

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28245393-a1159d5e-6a40-11e7-8948-4262bf29c371.png" width="800"/>
</div>

## Supported Protocol Bindings
- HTTP
- CoAP
- MQTT
- WebSocket

## Installation
The Mobius is based on Node.js framework and uses MySQL for database.
<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28322607-7be7d916-6c11-11e7-9d20-ac07961971bf.png" width="600"/>
</div><br/>

- [MySQL Server](https://www.mysql.com/downloads/)<br/>
The MySQL is an open source RDB database so that it is free and ligth. And RDB is very suitable for storing tree data just like oneM2M resource stucture. Most of nCube-Rosemary will work in a restricted hardware environment and the MySQL can work in most of embeded devices.

- [Node.js](https://nodejs.org/en/)<br/>
Node.js® is a JavaScript runtime built on Chrome's V8 JavaScript engine. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient. Node.js' package ecosystem, npm, is the largest ecosystem of open source libraries in the world. Node.js is very powerful in service impelementation because it provide a rich and free web service API. So, we use it to make RESTful API base on the oneM2M standard.

- [Mosquitto](https://mosquitto.org/)<br/>
Eclipse Mosquitto™ is an open source (EPL/EDL licensed) message broker that implements the MQTT protocol versions 3.1 and 3.1.1. MQTT provides a lightweight method of carrying out messaging using a publish/subscribe model. This makes it suitable for "Internet of Things" messaging such as with low power sensors or mobile devices such as phones, embedded computers or microcontrollers like the Arduino.

- [Mobius](https://github.com/IoTKETI/Mobius/archive/master.zip)<br/>
Mobius source codes are written in javascript. So they don't need any compilation or installation before running.

## Configuration
- Import SQL script<br/>
After installation of MySQL server, you need the DB Schema for storing oneM2M resources in Mobius. You can find this file in the following Mobius source directory.
```
[Mobius home]/mobius/mobiusdb.sql
```
- Run Mosquitto MQTT broker<br/>
```
mosquitto -v
```
- Open the Mobius source home directory
- Install dependent libraries as below
```
npm install
```
- Modify the configuration file "conf.json" per your setting
```
{
  "csebaseport": "7579", //Mobius HTTP hosting  port
  "dbpass": "keti123"    //MySQL root password
}
```

## Run
Use node.js application execution command as below
```
node mobius.js
```

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28245526-c9db7850-6a43-11e7-9bfd-f0b4fb20e396.png" width="700"/>
</div><br/>

## Library Dependencies
This is the list of library dependencies for Mobius 
- body-parser
- cbor
- coap
- crypto
- events
- express
- file-stream-rotator
- fs
- http
- https
- ip
- js2xmlparser
- merge
- morgan
- mqtt
- mysql
- shortid
- url
- util
- websocket
- xml2js
- xmlbuilder

## Document
If you want more details please dowload the full [installation guide document](https://github.com/IoTKETI/Mobius/raw/master/doc/Installation%20Guide_Mobius_v2.0.0_EN(170718).pdf).

# Author
Il Yeup (iyahn@keti.re.kr; ryeubi@gmail.com)
