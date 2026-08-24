# Mobius
oneM2M IoT Server Platform

## Version
2.6.0

The next version of Mobius is available on [Mobius4](https://github.com/iotketi/mobius4).

## What's New

### SQLite Support
Mobius now runs on SQLite as well as MySQL. SQLite requires no separate database server and creates its schema automatically at startup, which makes it suitable for embedded gateways, development and small deployments. Select the backend at launch (`node mobius.js sqlite`) or through the `usesqlite` option in `conf.json`. See [Configuration](#configuration).

Note that the SQLite backend currently covers CSEBase, AE, accessControlPolicy, container, contentInstance and subscription. Other resource types remain MySQL only.

### Security Fix: Discovery Parameter SQL Injection
oneM2M discovery query parameters were embedded into the WHERE clause by string concatenation, allowing SQL injection (reported by KETI, affects Mobius 2.5.15 and earlier). All discovery parameters are now normalised at a single entry point on both the MySQL and SQLite paths. Numeric parameters accept unsigned integers only, and string parameters are escaped. **Upgrading is strongly recommended.**

### Performance and Cluster Stability
Mobius runs one worker per CPU core, and several operations were not safe against concurrent workers. This release addresses that:

- Parent container counters (`cni`, `cbs`, `st`) are updated by relative increment instead of absolute overwrite, and multiple contentInstance creations are coalesced into a single debounced update.
- Retention enforcement (`mni`, `mbs`) no longer performs a full child scan, deletes the oldest instances rather than arbitrary ones, and removes exactly the amount over the limit. Each pass is bounded so a long deletion cannot hold the container row lock.
- Concurrent retention passes across workers are serialised with a transaction, preventing over-deletion.
- Notification delivery is now fire-and-forget across HTTP, CoAP, MQTT and WebSocket.
- Excessive per-request logging was removed so that operational logs remain usable for incident analysis.

### Removed: timeSeries and timeSeriesInstance
The `timeSeries` (ty=29) and `timeSeriesInstance` (ty=30) resource types and the accompanying time series agent have been removed, along with their database tables.

### Migration Notes
- **MySQL schema change.** The `cnt` table columns `mni`, `mbs`, `cni` and `cbs` were widened from `int unsigned` to `bigint unsigned`. Existing installations must apply this change:
```sql
ALTER TABLE cnt
  MODIFY mni bigint unsigned NOT NULL,
  MODIFY mbs bigint unsigned NOT NULL,
  MODIFY cni bigint unsigned NOT NULL,
  MODIFY cbs bigint unsigned NOT NULL;
```
- Applications relying on `timeSeries` / `timeSeriesInstance` must migrate to `container` / `contentInstance`.
- Applications relying on notification retry or on subscriptions being removed automatically after repeated delivery failures must handle delivery reliability on the application side.

## Introduction
Mobius is the open source IoT server platform based on the oneM2M (http://www.oneM2M.org) standard. As oneM2M specifies, Mobius provides common services functions (e.g. registration, data management, subscription/notification, security) as middleware to IoT applications of different service domains. Not just oneM2M devices, but also non-oneM2M devices (i.e. by oneM2M interworking specifications and KETI TAS) can connect to Mobius.

## Certification
Mobius has been received certification of ‘oneM2M standard’ by TTA (Telecommunications Technology Association). oneM2M Certification guarantees that oneM2M products meet oneM2M Specification and Test requirements which ensure interoperability. As Mobius is certified, it will be used as a golden sample to validate test cases and testing system.

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/40639101-e9ecd06c-6349-11e8-9fc2-0806d9bf5dc7.png" width="800"/>
</div>

TRSL (Test Requirements Status List) is available on oneM2M certification website (http://www.onem2mcert.com/sub/sub05_01.php).

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
The Mobius is based on Node.js framework and uses MySQL or SQLite for database.
<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28322607-7be7d916-6c11-11e7-9d20-ac07961971bf.png" width="600"/>
</div><br/>

- [MySQL Server](https://www.mysql.com/downloads/)<br/>
The MySQL is an open source RDB database so that it is free and ligth. And RDB is very suitable for storing tree data just like oneM2M resource stucture. Most of nCube-Rosemary will work in a restricted hardware environment and the MySQL can work in most of embeded devices.

- SQLite<br/>
SQLite is an embedded database that needs no separate server process. It is installed with the Mobius dependencies (`npm install`), stores everything in a single `mobius.db` file and builds its schema on the first run, so no manual import is required. Use it for development, embedded gateways and small deployments. See [What's New](#sqlite-support) for the supported resource types.

- [Node.js](https://nodejs.org/en/)<br/>
Node.js® is a JavaScript runtime built on Chrome's V8 JavaScript engine. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient. Node.js' package ecosystem, npm, is the largest ecosystem of open source libraries in the world. Node.js is very powerful in service impelementation because it provide a rich and free web service API. So, we use it to make RESTful API base on the oneM2M standard.

- [Mosquitto](https://mosquitto.org/)<br/>
Eclipse Mosquitto™ is an open source (EPL/EDL licensed) message broker that implements the MQTT protocol versions 3.1 and 3.1.1. MQTT provides a lightweight method of carrying out messaging using a publish/subscribe model. This makes it suitable for "Internet of Things" messaging such as with low power sensors or mobile devices such as phones, embedded computers or microcontrollers like the Arduino.

- [Mobius](https://github.com/IoTKETI/Mobius/archive/master.zip)<br/>
Mobius source codes are written in javascript. So they don't need any compilation or installation before running.

## Mobius Docker Version
We deploy Mobius as a Docker image using the virtualization open source tool Docker.

- [Mobius_Docker](https://github.com/IoTKETI/Mobius_Docker)<br/>

## Configuration
- Import SQL script (MySQL only)<br/>
After installation of MySQL server, you need the DB Schema for storing oneM2M resources in Mobius. You can find this file in the following Mobius source directory.
```
[Mobius home]/mobius/mobiusdb.sql
```
When using SQLite this step is not needed. The schema in `[Mobius home]/mobius/mobiusdb_sqlite.sql` is applied automatically at startup.
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
  "dbpass": "*******",   //MySQL root password
  "usesqlite": "false"   //"true" to use SQLite instead of MySQL
}
```

## Run
Use node.js application execution command as below
```
node mobius.js
```
The database backend follows `usesqlite` in `conf.json`, and can be overridden on the command line:
```
node mobius.js sqlite   // force SQLite
node mobius.js mysql    // force MySQL
```
`npm start` is equivalent to `node mobius.js`. On Windows the `run_sqlite.bat` and `run_mysql.bat` helper scripts are also provided.

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
- sqlite3
- url
- util
- websocket
- xml2js
- xmlbuilder

## Document
The legacy installation guide PDFs were removed from this repository as they no longer matched the current version. The installation and configuration steps above are the up-to-date reference.

# Author
Jaeho Kim (jhkim@keti.re.kr)
Il Yeup Ahn (iyahn@keti.re.kr)
