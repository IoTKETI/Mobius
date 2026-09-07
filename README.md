# Mobius
oneM2M IoT Server Platform

## Version
3.0.1

Mobius is actively maintained and keeps being updated. [Mobius4](https://github.com/iotketi/mobius4) is a **separate edition** of Mobius built for AI integration; it is not the successor of this project. Use Mobius for a standard oneM2M IN-CSE, and Mobius4 when you need the AI integration layer on top of oneM2M.

## What's New in 3.0

Mobius 3.0 is a rewrite of the server core on the same oneM2M resource model and API. The main items:

### Database layer
- One database facade (`mobius/db/`) with two adapters: MySQL (`mysql2` driver) and SQLite. The backend is a name in `conf.json` (`db`); adding a backend is adding one adapter file.
- Every SQL statement is built with the knex query builder and executed with bound values. No string interpolation remains, which closes the discovery-parameter SQL injection reported against 2.5.15 and earlier at its root.
- A fresh MySQL install is one import of `mobius/db/mobiusdb.sql`: the file carries the tables, the indexes and the migration ledger. Schema changes for existing installs are `migrations/001` to `019`, applied with `node tools/migrate.js`.
- Identifiers and names are compared byte for byte (binary collation), as oneM2M requires; `rn`, `sri` and `spi` are 200 characters wide.

### SQLite support
Mobius runs on SQLite as well as MySQL. SQLite requires no separate database server and creates its schema automatically at startup, which makes it suitable for embedded gateways, development and small deployments. Select the backend at launch (`node mobius.js sqlite`) or through the `db` option in `conf.json`. See [Configuration](#configuration).

The SQLite backend currently covers six resource types: CSEBase, AE, accessControlPolicy, container, contentInstance and subscription. Creating any other type while running on SQLite is rejected with `501 Not Implemented` (`X-M2M-RSC: 5001`) instead of being attempted, so the resource tree is never left in a partial state. Deployments that need group, flexContainer, node, remoteCSE, mgmtObj or semanticDescriptor should run on MySQL.

### Configuration
- `conf.json` is the only configuration; nothing is hard-coded in the source. `mobius/conf_schema.js` declares every key with its type, default, when it takes effect and help text.
- The first start asks seven questions and writes `conf.json`. `npm run conf` lists and edits keys; `npm run status` shows the running master, its port and the keys waiting for a restart.
- `dbpass` and `superUser` are sealed (`conf.seal.json`): they are changed through `npm run setup` only, and a hand-edited value is refused at boot.

### Request handling
- Every request is settled exactly once: one settlement function sends the response and returns the database connection, so a lost or doubled response can no longer hang a connection or crash a worker.
- Result codes live in one catalogue (`mobius/rsc.js`, `mobius/reason.js`): one HTTP status per oneM2M response status code, following TS-0009.
- JSON only. XML and CBOR request bodies are rejected with `400`; responses and notifications are always JSON.
- Request bodies are capped (`maxBodyBytes`, default 10 MB, `413` when exceeded). Resource names, structured paths and client-supplied AE-IDs are length-checked (`400`); the AE-ID format itself is not checked.
- Outgoing requests (remoteCSE forwarding, group fan-out, notifications) carry a timeout and ask for JSON.

### Discovery and identifiers
- Discovery runs as a recursive CTE for the skeleton plus batched child queries on both backends. `lim` and `ofst` are global, and a truncated result carries `X-M2M-CTS` / `X-M2M-CTO`.
- `la` / `ol` read the `(pi, ty, ct)` index directly; the time-window retry is gone.
- Short resource ids (the `ri` in responses, the `aei` of an AE) are generated unique across cluster workers and enforced UNIQUE in the database.
- Group fan-out sends member requests in parallel (at most 8 at a time) and aggregates them in member order.

### Notifications
- Subscriptions are read from the `sub` table at every write; the subscription copy on the parent resource is gone.
- Delivery is fire-and-forget over HTTP, CoAP and MQTT, in event order with no artificial delay. Every delivery is classified (`ok` / `reject` / `fail` / `unknown`) in the log together with the subscription id.
- MQTT notifications are not queued while the broker is unreachable, and broker disconnects are logged.

### Cluster and operations
- Container counters (`cni`, `cbs`) are updated by relative increment inside the contentInstance insert transaction. Retention (`mni` / `mbs`) and counter reconciliation run in the master only and count live rows before deleting anything.
- Startup failures exit instead of leaving a process without ports: missing `conf.json` (exit 13), broken seal (14), port in use (12), no database (1).
- Per-request stdout logging is gone; the request time is the last field of `log/access-*.log`. The super-user origin is never written to logs.
- A boot record (`log/mobius-boot.jsonl`) shows which configuration the running server actually applied.

### Admin console
- `admin/` is an operator console that runs as a separate process (`node admin/server.js`): expired resources, orphan rows, access control policy review and simulation, batch deletion. It uses the core database facade and the core policy tables. Configuration and process control are deliberately not part of the web UI.
- `/hit`, `/total_ae` and `/total_cbs` are no longer served by the core; the console provides them behind its session.

### Removed
- The MQTT, CoAP and WebSocket request bindings (the protocol proxies). HTTP is the only request binding; three years of traffic showed http 124,988,941 / mqtt 32 / coap 0 / ws 0.
- ASN-CSE / MN-CSE modes; the `timeSeries` / `timeSeriesInstance`, `request` and transaction (`tm` / `tr`) resource types; non-blocking requests (`rt=1` / `rt=2` are answered as unsupported); the semantic broker; the AE notification relay; subscription verification requests; WebSocket notification delivery.
- The per-worker resource cache and the legacy database paths.

### Tests
- `npm test` runs 1,359 tests under the Node.js test runner without MySQL. `npm run test:mysql` installs the schema into a scratch database, runs the request-path queries for real and checks their execution plans.

### Upgrading from 2.x
1. Apply pending migrations before starting the new core: `node tools/migrate.js --check mysql`, then `--apply`. Migration 018 rewrites the identifier columns and blocks writes for hours on a large database, so schedule it. For an existing SQLite file use `--check sqlite` / `--apply sqlite`.
2. Create the secret seal once: run `npm run setup -- --superuser` and press Enter (the value is kept). `--dbpass` follows the same rule.
3. In `conf.json`, `usesqlite` is replaced by `db` (`"mysql"` or `"sqlite"`). `cntManPort`, `pxyWsPort`, `pxyMqttPort`, `wsAllowedOrigins`, `sgnManPort`, `hitManPort` and `adminPm2Name` are no longer read; `npm run conf` reports unknown keys.
4. Clients using the MQTT, CoAP or WebSocket request bindings must move to HTTP; clients sending XML or CBOR must send JSON.
5. Applications relying on `timeSeries` / `timeSeriesInstance` must migrate to `container` / `contentInstance`. Applications relying on notification retry or automatic subscription removal must handle delivery reliability on their side.
6. Upgrading from 2.5 or earlier: the `cnt` counters were widened in 2.6 and existing installations must apply this change as well:
```sql
ALTER TABLE cnt
  MODIFY mni bigint unsigned NOT NULL,
  MODIFY mbs bigint unsigned NOT NULL,
  MODIFY cni bigint unsigned NOT NULL,
  MODIFY cbs bigint unsigned NOT NULL;
```

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
Requests are accepted over **HTTP only**. The MQTT, CoAP and WebSocket request bindings (the `pxy_mqtt`, `pxy_coap` and `pxy_ws` proxies of 2.x) have been removed; a client that used one of them must switch to the HTTP binding.

Notifications are still sent over HTTP, CoAP and MQTT, according to the scheme of the subscription's `nu` (`http://`, `coap://`, `mqtt://`). WebSocket notification delivery has been removed as well; a `ws://` `nu` is accepted but never delivered.

## Installation
The Mobius is based on Node.js framework and uses MySQL or SQLite for database.

**MySQL: importing `mobius/db/mobiusdb.sql` is the whole install.** The schema file carries the
tables, the indexes and the migration ledger (`schema_migrations`), so a fresh database starts in
the same state as a fully migrated deployment — data switches such as 012 (discovery reads
`lookup.cs`) are on from the first request, and nothing is left to apply by hand. The one thing
a schema file cannot carry is the MySQL server settings (migration 010, `SET PERSIST`); Mobius
applies those on its first start. `npm run test:mysql` proves this against a scratch database:
import, and only 010 is left for the first start.
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

### Database tuning on a new install

**Nothing to do.** A fresh install ends up in the same state as an existing one.

| | What sets it | When |
|---|---|---|
| Schema and indexes | `mobius/db/mobiusdb.sql` | On first connect |
| Connection pool | Built-in defaults | Every start |
| SQLite journal mode, sync, busy timeout | `mobius/db/sqlite.js` | Every connect |
| MySQL server settings | `migrations/010-server-durability.js` | First start, once |

The MySQL server settings — durability, isolation level and the connection
ceiling — live in the database server itself, so the schema file cannot create
them. Mobius applies them on first start and records that it did, then never
touches them again. Change them afterwards and they stay changed.

Only migrations that finish instantly run at startup. Anything that rebuilds an
index is left alone and logged instead, because that can take many minutes on a
large database. Apply those when you choose to:

```bash
node tools/migrate.js --check mysql    # show what is pending
node tools/migrate.js --apply mysql    # apply it
```

Running on SQLite? None of this applies — SQLite has no server to configure, and
the pool settings are unused there.

All of these values are declared in `mobius/conf_schema.js`, which `npm run conf`
reads, so they can be inspected and changed from there.

## Mobius Docker Version
We deploy Mobius as a Docker image using the virtualization open source tool Docker.

- [Mobius_Docker](https://github.com/IoTKETI/Mobius_Docker)<br/>

## Configuration
- Import SQL script (MySQL only)<br/>
After installation of MySQL server, you need the DB Schema for storing oneM2M resources in Mobius. You can find this file in the following Mobius source directory.
```
[Mobius home]/mobius/db/mobiusdb.sql
```
When using SQLite this step is not needed. The schema in `[Mobius home]/mobius/db/mobiusdb_sqlite.sql` is applied automatically at startup.
- Run Mosquitto MQTT broker<br/>
```
mosquitto -v
```
- Open the Mobius source home directory
- Install dependent libraries as below
```
npm install
```
- Start Mobius once from an interactive terminal. When `conf.json` is missing, `node mobius.js` itself asks seven questions (database, database password, CSE name, CSE-ID, SP-ID, super-user origin, HTTP port), writes `conf.json`, and then boots — no separate setup command is needed:
```
node mobius.js         # first run: asks, writes conf.json, starts
npm run setup          # same wizard without starting the server (optional)
```
Everything else has a default. Inspect and change settings with the CLI — there is no web page for this, because `conf.json` holds the master keys:
```
npm run conf                        # list all keys with their file value and whether the running server has applied them
npm run conf -- set cseBase Vita    # gated keys print a warning and ask you to type the key name
npm run conf -- edit                # walk through the user keys one by one, Enter keeps the current value
npm run conf -- --all               # advanced keys too (default: the seven first-run keys)
npm run status                      # master pid, port, boot record, keys waiting for a restart
```
`dbpass` and `superUser` are stored in plain text; the wizard hides them while you type. To re-enter one later: `npm run setup -- --dbpass` or `npm run setup -- --superuser` (prompt only — never a command-line argument).

Both secrets are sealed against hand-editing: alongside `conf.json` the server keeps `conf.seal.json` (gitignored), and hand-edits of the two secrets are refused at boot. Existing installs have no seal yet — before restarting on a new core, run `npm run setup -- --superuser` once and press **Enter** — the value is kept and the seal is created. `--dbpass` follows the same rule.

### Default Retention Policies (optional)
By default a container created without `mni` / `mbs` uses the Mobius defaults. If a deployment needs different defaults for particular container paths, they can be declared in `conf.json` as `retentionPolicies`. Omit the key to disable the feature entirely.

```
{
  "retentionPolicies": [
    {"match": "contains", "value": "/Simul_", "mni": "10000"},
    {"match": "regex", "value": "/\\d{4}_\\d{2}_\\d{2}_T_\\d{2}_\\d{2}$",
     "mni": "3153600000", "mbs": "1099511627776"},
    {"match": "suffix", "value": "/archive", "mni": "100000"}
  ]
}
```

- `match` — `contains` (default), `prefix`, `suffix` or `regex`, compared against the container resource identifier
- `value` — the string or JavaScript regular expression source to compare with
- `mni` / `mbs` — either may be omitted, in which case the Mobius default applies

The first matching rule wins, so array order is priority order. A rule that is malformed is reported on the console and skipped rather than blocking container creation. A value explicitly supplied by the client in the CREATE request always takes precedence over these defaults, as required by oneM2M.

## Run
Use node.js application execution command as below
```
node mobius.js
```
The database backend follows the `db` key in `conf.json`, and can be overridden on the command line:
```
node mobius.js sqlite   // force SQLite
node mobius.js mysql    // force MySQL
```
`npm start` is equivalent to `node mobius.js`. On Windows the `run_sqlite.bat` and `run_mysql.bat` helper scripts are also provided.

If `conf.json` is missing and the terminal is interactive, `node mobius.js` runs the setup wizard itself. If it is missing and the output is not a terminal (a service, `npm start > log`), Mobius exits with code 1 without creating the file — start it once from an interactive terminal (`node mobius.js`, or `npm run setup`) to create it. If the port is already taken, Mobius exits with code 12 instead of respawning workers forever.

<div align="center">
<img src="https://user-images.githubusercontent.com/29790334/28245526-c9db7850-6a43-11e7-9bfd-f0b4fb20e396.png" width="700"/>
</div><br/>

## Library Dependencies
This is the list of library dependencies for Mobius (`package.json`)
- coap
- cors
- crypto
- events
- express
- file-stream-rotator
- fs
- http
- https
- ip
- knex
- merge
- moment
- morgan
- mqtt
- mysql2
- shortid
- sqlite3
- url
- util

## Document
The legacy installation guide PDFs were removed from this repository as they no longer matched the current version. The installation and configuration steps above are the up-to-date reference.

# Author
Jaeho Kim (jhkim@keti.re.kr)
Il Yeup Ahn (iyahn@keti.re.kr)
