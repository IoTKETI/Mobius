CREATE TABLE IF NOT EXISTS hit (
    ct TEXT PRIMARY KEY,
    http INTEGER DEFAULT 0,
    mqtt INTEGER DEFAULT 0,
    coap INTEGER DEFAULT 0,
    ws INTEGER DEFAULT 0
);

-- lookup (Base Resource Table)
CREATE TABLE IF NOT EXISTS lookup (
  pi TEXT NOT NULL,
  ri TEXT PRIMARY KEY,
  ty INTEGER NOT NULL,
  ct TEXT NOT NULL,
  st INTEGER NOT NULL,
  rn TEXT NOT NULL,
  lt TEXT NOT NULL,
  et TEXT NOT NULL,
  acpi TEXT,
  lbl TEXT,
  at TEXT,
  aa TEXT,
  sri TEXT,
  spi TEXT,
  -- Copies of the CIN's contentSize / contentInfo, read by discovery's sza / szb / cty (see the same columns in mobius/db/mobiusdb.sql).
  --
  -- NULL means unknown: not a CIN, or not yet backfilled. 0 would be indistinguishable from a real CIN with an empty body.
  --
  -- MySQL uses int / varchar(45). SQLite is type-affine, so INTEGER / TEXT, and the facade wraps comparisons in a CAST via numericExpr (mobius/db/sqlite.js).
  cs INTEGER,
  cnf TEXT
);

-- acp (Access Control Policy)
CREATE TABLE IF NOT EXISTS acp (
  ri TEXT PRIMARY KEY,
  pv TEXT NOT NULL,
  pvs TEXT NOT NULL,
  FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE
);

-- acp_audit: change history of ACPs and acpi. No FK to lookup, so the history survives the resource's deletion.
CREATE TABLE IF NOT EXISTS acp_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  op TEXT NOT NULL,
  ri TEXT NOT NULL,
  ty INTEGER NOT NULL,
  origin TEXT,
  cr TEXT,
  before_val TEXT,
  after_val TEXT
);
CREATE INDEX IF NOT EXISTS idx_acp_audit_ri ON acp_audit (ri);
CREATE INDEX IF NOT EXISTS idx_acp_audit_ts ON acp_audit (ts);

-- cb (CSEBase)
CREATE TABLE IF NOT EXISTS cb (
  ri TEXT PRIMARY KEY,
  cst TEXT NOT NULL,
  csi TEXT NOT NULL,
  srt TEXT NOT NULL,
  poa TEXT NOT NULL,
  nl TEXT NOT NULL,
  ncp TEXT NOT NULL,
  srv TEXT,
  FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE
);

-- ae (Application Entity)
CREATE TABLE IF NOT EXISTS ae (
  ri TEXT PRIMARY KEY,
  apn TEXT NOT NULL,
  api TEXT NOT NULL,
  aei TEXT NOT NULL,
  poa TEXT NOT NULL,
  "or" TEXT NOT NULL,
  rr TEXT NOT NULL,
  nl TEXT NOT NULL,
  csz TEXT DEFAULT NULL,
  srv TEXT DEFAULT NULL,
  FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE
);

-- cnt (Container)
CREATE TABLE IF NOT EXISTS cnt (
  ri TEXT PRIMARY KEY,
  cr TEXT NOT NULL,
  mni TEXT NOT NULL,
  mbs TEXT NOT NULL,
  mia TEXT NOT NULL,
  cni TEXT NOT NULL,
  cbs TEXT NOT NULL,
  li TEXT NOT NULL,
  "or" TEXT NOT NULL,
  disr TEXT NOT NULL,
  FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE
);

-- cin (ContentInstance)
CREATE TABLE IF NOT EXISTS cin (
  ri TEXT PRIMARY KEY,
  pi TEXT NOT NULL,
  cr TEXT NOT NULL,
  cnf TEXT NOT NULL,
  cs TEXT NOT NULL,
  "or" TEXT NOT NULL,
  con TEXT NOT NULL,
  CONSTRAINT cin_ri FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE,
  CONSTRAINT cin_pi FOREIGN KEY (pi) REFERENCES cnt(ri) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sub (
  ri VARCHAR(200) NOT NULL,
  pi VARCHAR(400) DEFAULT NULL,
  enc VARCHAR(45) DEFAULT NULL,
  exc VARCHAR(45) DEFAULT NULL,
  nu VARCHAR(200) DEFAULT NULL,
  gpi VARCHAR(45) DEFAULT NULL,
  nfu VARCHAR(45) DEFAULT NULL,
  bn VARCHAR(45) DEFAULT NULL,
  rl VARCHAR(45) DEFAULT NULL,
  psn VARCHAR(45) DEFAULT NULL,
  pn VARCHAR(45) DEFAULT NULL,
  nsp VARCHAR(45) DEFAULT NULL,
  ln VARCHAR(45) DEFAULT NULL,
  nct VARCHAR(45) DEFAULT NULL,
  nec VARCHAR(45) DEFAULT NULL,
  cr VARCHAR(45) DEFAULT NULL,
  su VARCHAR(45) DEFAULT NULL,
  PRIMARY KEY (ri),
  CONSTRAINT sub_ri FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes
--
-- The CREATE INDEX statements run at every boot (IF NOT EXISTS), so an existing DB gets the indexes at its next boot.
-- ============================================================================

-- Base of every query that finds children by parent. ct and ri are included so the ORDER BY of la/ol and delete_oldest need no sort.
CREATE INDEX IF NOT EXISTS idx_lookup_pi_ty_ct ON lookup (pi, ty, ct, ri);

-- The discovery skeleton recursion uses idx_lookup_pi_ty_ct. MySQL has a separate not_cin virtual column with a (pi, not_cin) index (migrations/004) because its recursive CTE cannot use range access; SQLite has no INVISIBLE column (it would leak into `select *`) and filters ty <> 4 instead. The facade provides the per-backend predicate (notCinPredicate in mobius/db/sqlite.js).

-- select_resource_from_url looks up (ri = ?) or (sri = ?); ri is the PRIMARY KEY, this index covers sri.
CREATE INDEX IF NOT EXISTS idx_lookup_sri ON lookup (sri);

-- Expired resource lookup.
CREATE INDEX IF NOT EXISTS idx_lookup_et ON lookup (et);

-- Queries that aggregate cin by parent (counter reconciliation, delete_oldest). cs is included so sum(cs) is answered from the index alone.
CREATE INDEX IF NOT EXISTS idx_cin_pi ON cin (pi, ri, cs);

-- Source of notification routing: sgn.check reads `sub where pi = ?` on every write (MySQL: migrations/013-sub-pi-index.js).
CREATE INDEX IF NOT EXISTS idx_sub_pi ON sub (pi);

-- ============================================================================
-- Migration ledger (schema_migrations)
--
-- The same table tools/migrate.js ensureTable creates; change both together.
--
-- This file already contains the shape the migrations produce, so a new DB must be 'fully applied' after its first boot, and the ledger rows are written here as well.
--
-- This file runs at every boot, on old DBs too, so each row is inserted only when that migration's state is already present: the INSERT OR IGNORE carries the same condition as the migration's inspect. On an old DB where the condition is false the migration stays pending and `node tools/migrate.js --apply sqlite` handles it. When the row already exists the condition is not evaluated (the left side of AND comes first; SQLite short-circuits).
--
-- Rule: when adding a migration whose backends include sqlite, add a row here. test/schema-drift.test.js compares the list and test/sqlite-fresh-ledger.test.js runs the file against a new and an old DB.
-- ============================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(160) NOT NULL,
  applied_at VARCHAR(21) NOT NULL,
  duration_ms INTEGER,
  PRIMARY KEY (id)
);

-- 007: acp_audit table, created above in this file. No condition.
INSERT OR IGNORE INTO schema_migrations (id, applied_at, duration_ms)
  SELECT '007-acp-audit-table', '20260906T000000', NULL;

-- 015: drop lookup.subl; only when the column is absent.
INSERT OR IGNORE INTO schema_migrations (id, applied_at, duration_ms)
  SELECT '015-drop-lookup-subl', '20260906T000000', NULL
  WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = '015-drop-lookup-subl')
    AND NOT EXISTS (SELECT 1 FROM pragma_table_info('lookup') WHERE name = 'subl');

-- 017: sri dedupe; only when there are no duplicate groups (the same query as groups() in migrations/017).
INSERT OR IGNORE INTO schema_migrations (id, applied_at, duration_ms)
  SELECT '017-dedupe-lookup-sri', '20260906T000000', NULL
  WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id = '017-dedupe-lookup-sri')
    AND NOT EXISTS (SELECT 1 FROM lookup GROUP BY sri HAVING count(*) > 1);
