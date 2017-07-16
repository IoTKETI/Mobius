# Mobius
oneM2M IoT Server Platform
## Introduction
Mobius is IoT Server platform base the oneM2M standard for supporting IoT service to manage multiple devices. It provides an application platform for the control, authentication, and interconnection of several Internet of things services.
## System stucture
In oneM2M system stucture, the Mobius is a kind of IN-CSE as high level server platform exist in network. It handles all of the oneM2M data requests and performs serialization and deserialization of the resource data. 

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28245360-a2221606-6a3f-11e7-8330-ba48787133a6.png" width="800"/>
</div>

## Connectivity Stucture
In IoT concept, Things are all the gadgets around your life and provide a special function for user. But they need "&Cube" that is a kind of software for helping these things communicate with cloud server just like Mobius. In another side, IoT application monitor or control these things through the Open API that Mobius provide it.

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28245372-e7584524-6a3f-11e7-8628-16bfee65430b.png" width="800"/>
</div>

## Software Architecture

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28245393-a1159d5e-6a40-11e7-8948-4262bf29c371.png" width="800"/>
</div>

## Support Protocol
- HTTP
- COAP
- MQTT
- WebSocket(Unrealized)

## Installation
The Mobius was developed with javascript of node.js and it also uses the MySQL to store data.
<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28245482-036ee490-6a43-11e7-94f3-b854f1d944f6.png" width="600"/>
</div><br/>

- [MySQL Server](https://www.mysql.com/downloads/)<br/>
The MySQL is an open source RDB database so that it is free and ligth. And RDB is very suitable for storing tree data just like oneM2M resource stucture. Most of nCube-Rosemary will work in a restricted hardware environment and the MySQL can work in most of embeded devices.

- [Node.js](https://nodejs.org/en/)<br/>
Node.js® is a JavaScript runtime built on Chrome's V8 JavaScript engine. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient. Node.js' package ecosystem, npm, is the largest ecosystem of open source libraries in the world. Node.js is very powerful in service impelementation because it provide a rich and free web service API. So, we use it to make RESTful API base on the oneM2M standard.

- [Mosquitto](https://mosquitto.org/)<br/>
Eclipse Mosquitto™ is an open source (EPL/EDL licensed) message broker that implements the MQTT protocol versions 3.1 and 3.1.1. MQTT provides a lightweight method of carrying out messaging using a publish/subscribe model. This makes it suitable for "Internet of Things" messaging such as with low power sensors or mobile devices such as phones, embedded computers or microcontrollers like the Arduino.

- [Mobius](https://github.com/IoTKETI/Mobius/archive/master.zip)<br/>
Mobius is application base the node.js javascript. So we don't need to compile and install it before using.

## Configuration
- Import SQL script<br/>
When installation of MySQL Server finish. It also needs DB Schema for storing oneM2M resource in Mobius. You can find this file in the Mobius's source directory as below.
```
[Mobius home]/mobius/mobiusdb.sql
```
- Run Mosquitto MQTT Broker<br/>
```
mosquitto -v
```
- Open the Mobius source home directory.
- Install dependency libraries with command like below.
```
npm install
```
- Modify configuration file "conf.json"
```
{
  "csebaseport": "7579", //Mobius HTTP hosting  port
  "dbpass": "keti123"    //MySQL root password
}
```

## Running
Use node.js application execution command to run the Rosemary
```
node mobius.js
```

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28245526-c9db7850-6a43-11e7-9bfd-f0b4fb20e396.png" width="700"/>
</div><br/>

## Dependency Libraries
These is dependency libraries for nCube-Rosemary 
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
If you want more detail please dowload the full [installation guide document](https://github.com/IoTKETI/Mobius/raw/master/doc/Installation%20Guide_Mobius_v2.0.0_KR.docx).

# Author
Il Yeup (iyahn@keti.re.kr; ryeubi@gmail.com)
