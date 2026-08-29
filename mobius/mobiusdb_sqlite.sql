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
  subl TEXT
  -- acpl 은 여기 있었다. SQLite 에만 있던 컬럼인데 저장소 어디서도 읽지
  -- 않았고, 그 값을 채우려고 리소스를 만들 때마다 acp 를 한 번 더 조회했다.
  -- MySQL 에는 애초에 없다. 기존 SQLite DB 에는 컬럼이 남아 있지만
  -- nullable 이라 삽입에 지장이 없다 (마이그레이션 불필요).
);

-- acp (Access Control Policy)
CREATE TABLE IF NOT EXISTS acp (
  ri TEXT PRIMARY KEY,
  pv TEXT NOT NULL,
  pvs TEXT NOT NULL,
  FOREIGN KEY (ri) REFERENCES lookup(ri) ON DELETE CASCADE
);

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
-- 인덱스
--
-- 여기 있는 CREATE INDEX 는 기동할 때마다 다시 실행된다(IF NOT EXISTS).
-- 이미 쓰던 DB 도 다음 기동에서 자동으로 인덱스를 갖는다.
--
-- 예전에는 SQLite 스키마에 인덱스가 하나도 없었다. MySQL 스키마에는 27개가
-- 있는데 SQLite 쪽에만 빠져 있어서, `where pi = ?` 같은 질의가 전부
-- 풀 테이블 스캔이었다 — 비용이 컨테이너 크기가 아니라 테이블 전체 크기에
-- 비례했다.
--
-- 실측 (lookup 10만 행 + cin 10만 행):
--   select_resource_from_url (매 요청)  14.19ms ->  0.18ms   77배
--   la  (최신 1건)                      11.26ms ->  0.20ms   57배
--   ol  (최고참 1건)                    11.71ms ->  0.22ms   54배
--   cin 집계 (정합 맞추기)              25.74ms ->  0.18ms  146배
--   discovery (자식 목록)               13.93ms ->  4.53ms    3배
-- 인덱스 4개 생성 비용은 10만 행에 약 340ms (기동 시 1회).
-- ============================================================================

-- 부모로 자식을 찾는 모든 질의의 기반.
-- ct, ri 까지 넣어 la/ol 의 ORDER BY 와 delete_oldest 가 정렬 없이 끝난다.
CREATE INDEX IF NOT EXISTS idx_lookup_pi_ty_ct ON lookup (pi, ty, ct, ri);

-- discovery 골격 재귀는 idx_lookup_pi_ty_ct 로 충분하다.
--
-- MySQL 쪽에는 not_cin 가상 컬럼과 (pi, not_cin) 인덱스를 따로 뒀다
-- (migrations/004). 재귀 CTE 안에서 range 접근이 안 되어 "CIN 이 아니다" 를
-- 등치로 만들어야 했기 때문이다. SQLite 는 두 가지 이유로 대상이 아니다:
--   1. INVISIBLE 컬럼이 없어서 만들면 `select *` 응답에 그대로 샌다
--   2. 임베디드 규모라 ty <> 4 를 필터로 처리해도 문제되지 않는다
-- 파사드가 백엔드별 조건을 낸다 — mobius/db/sqlite.js 의 notCinPredicate.

-- select_resource_from_url 은 (ri = ?) or (sri = ?) 로 찾는다.
-- ri 는 PRIMARY KEY 라 이미 빠르고, sri 쪽만 없었다.
CREATE INDEX IF NOT EXISTS idx_lookup_sri ON lookup (sri);

-- 만료 리소스 조회.
CREATE INDEX IF NOT EXISTS idx_lookup_et ON lookup (et);

-- cin 을 부모로 묶어 세는 질의(정합 맞추기, delete_oldest).
-- cs 까지 넣으면 sum(cs) 가 인덱스만 읽고 끝난다.
CREATE INDEX IF NOT EXISTS idx_cin_pi ON cin (pi, ri, cs);
