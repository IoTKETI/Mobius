# hit_ri.ri collation fix — verification report

Date: 2026-08-28
Environment: local MySQL 8.0.45 (Windows service `MySQL80`, `localhost:3306`, user `root`), reachable and used for live verification.

## Fix applied

Added `CHARACTER SET utf8 COLLATE utf8_bin` to `hit_ri.ri`, matching the exact
style `lookup.ri` uses, in both places the DDL appears:

1. `mobius/mobiusdb.sql` (line 268) — `hit_ri` `CREATE TABLE` for new installs.
2. `docs/mysql-migration-2.7.md` (line 30) — `hit_ri` `CREATE TABLE` in the
   migration section for existing installs.

Diff:

```diff
--- a/docs/mysql-migration-2.7.md
+++ b/docs/mysql-migration-2.7.md
@@ -27,7 +27,7 @@ CREATE INDEX idx_lookup_pi_sri ON lookup(pi, sri);

 ```sql
 CREATE TABLE IF NOT EXISTS hit_ri (
-  ri   varchar(200) NOT NULL,
+  ri   varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
   ct   varchar(8)   NOT NULL,
   http int NOT NULL DEFAULT 0,
   mqtt int NOT NULL DEFAULT 0,

--- a/mobius/mobiusdb.sql
+++ b/mobius/mobiusdb.sql
@@ -265,7 +265,7 @@ DROP TABLE IF EXISTS `hit_ri`;
 /*!40101 SET @saved_cs_client     = @@character_set_client */;
 /*!50503 SET character_set_client = utf8mb4 */;
 CREATE TABLE `hit_ri` (
-  `ri` varchar(200) NOT NULL,
+  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
   `ct` varchar(8) NOT NULL,
   `http` int NOT NULL DEFAULT 0,
   `mqtt` int NOT NULL DEFAULT 0,
```

Not touched (as instructed): `ct`/counter columns, `mobius/mobiusdb_sqlite.sql`, any JavaScript.

## Declarations now read identically to `lookup.ri`

`mobiusdb.sql:311` (`lookup.ri`):
```
`ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
```
`mobiusdb.sql:268` (`hit_ri.ri`, after fix):
```
`ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
```
Byte-for-byte identical. Confirmed at runtime too — after importing the full
schema into a scratch database, `information_schema.COLUMNS` reports both as
`utf8mb3_bin` (MySQL 8's resolved name for `utf8_bin`):

```
TABLE_NAME  COLUMN_NAME  COLLATION_NAME
hit_ri      ri           utf8mb3_bin
lookup      ri           utf8mb3_bin
```

## 1. Two-table comparison (old declaration vs. new declaration)

Created scratch database `mobius_collation_scratch` with two tables carrying
`PRIMARY KEY (ri, ct)`: `hit_ri_old` (current unpatched declaration — no
explicit collation, inherits table default `utf8mb3_general_ci`) and
`hit_ri_new` (patched declaration — `CHARACTER SET utf8 COLLATE utf8_bin`).
Inserted `/Mobius/ae1/c1` then `/Mobius/AE1/C1` (same `ct='20260828'`) into
each, then ran an `ON DUPLICATE KEY UPDATE` upsert mirroring
`upsert_hit_ri_batch`, then dropped the database.

Verbatim `mysql` client output (warnings about password-on-CLI omitted):

```
marker
=== show collation of ri column: hit_ri_old ===
COLUMN_NAME	COLLATION_NAME
ri	utf8mb3_general_ci
marker
=== show collation of ri column: hit_ri_new ===
COLUMN_NAME	COLLATION_NAME
ri	utf8mb3_bin
marker
=== hit_ri_old: insert row 1 ===
marker
=== hit_ri_old: insert row 2 (case-distinct) - expect ER_DUP_ENTRY ===
ERROR 1062 (23000) at line 42: Duplicate entry '/Mobius/AE1/C1-20260828' for key 'hit_ri_old.PRIMARY'
marker
=== hit_ri_old: upsert row 2 via ON DUPLICATE KEY UPDATE (mirrors upsert_hit_ri_batch) ===
marker
=== hit_ri_old: final row count and contents (expect 1 row, silently merged) ===
ri	ct	http	mqtt	coap	ws
/Mobius/ae1/c1	20260828	2	0	0	0
marker
=== hit_ri_new: insert row 1 ===
marker
=== hit_ri_new: insert row 2 (case-distinct) - expect success, no dup ===
marker
=== hit_ri_new: upsert via ON DUPLICATE KEY UPDATE on a THIRD distinct case variant ===
marker
=== hit_ri_new: final row count and contents (expect 3 rows, all distinct) ===
ri	ct	http	mqtt	coap	ws
/Mobius/AE1/C1	20260828	1	0	0	0
/Mobius/ae1/c1	20260828	1	0	0	0
/mobius/AE1/c1	20260828	1	0	0	0
marker
=== join hit_ri_new with lookup_scratch (utf8_bin both sides) ===
ri	ct	lookup_ri
/Mobius/AE1/C1	20260828	/Mobius/AE1/C1
/Mobius/ae1/c1	20260828	/Mobius/ae1/c1
```

Interpretation:

- **Old declaration**: a plain `INSERT` of the case-distinct second row hits
  `ER_DUP_ENTRY` (1062) directly — confirms the PK is case-insensitive under
  the inherited `utf8mb3_general_ci` collation. The `ON DUPLICATE KEY UPDATE`
  form used by `upsert_hit_ri_batch` raises no error at all and instead
  *merges* the two case-distinct resources' counters into one row
  (`http` incremented to 2 under the lowercase key only) — exactly the silent
  data-corruption scenario described in the finding.
- **New declaration**: both case-distinct inserts succeed as independent rows;
  a third case variant also inserts as a distinct row via the same
  `ON DUPLICATE KEY UPDATE` path. Final table holds 3 distinct rows, matching
  oneM2M's case-sensitive resource-identifier semantics.
- The `hit_ri_new ⋈ lookup_scratch` join (both `utf8_bin`) still returns both
  rows correctly — confirms the join is unaffected by the fix, as expected.

`mobius_collation_scratch` was dropped at the end of the script; confirmed
absent afterward (`SHOW DATABASES LIKE 'mobius_collation_scratch'` → empty).

## 2. Clean-import check

Imported the full, patched `mobius/mobiusdb.sql` into a fresh scratch database
`mobius_import_scratch`:

```
DROP DATABASE IF EXISTS mobius_import_scratch; CREATE DATABASE mobius_import_scratch;
<mobiusdb.sql piped into mysql client, database mobius_import_scratch>
---IMPORT EXIT CODE: 0---
```

No syntax/collation errors — only the routine "using a password on the
command line" client warning. Exit code 0. Column-collation check on the
imported schema (see above) confirmed `hit_ri.ri` and `lookup.ri` both
resolve to `utf8mb3_bin`, and `hit_ri` table exists.

`mobius_import_scratch` was dropped afterward; confirmed only the developer's
real `mobiusdb` database remains (`SHOW DATABASES LIKE 'mobius%'` → `mobiusdb`
only). The real `mobiusdb` database was never opened or modified.

## 3. npm test

```
> mobius@2.6.0 test
> node --test test/*.test.js
...
ℹ tests 126
ℹ suites 0
ℹ pass 126
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2066.2585
```

126/126 passing, unchanged from baseline (no JavaScript was modified).

## Files changed

- `mobius/mobiusdb.sql`
- `docs/mysql-migration-2.7.md`
