# MySQL 마이그레이션 — 2.7 (관리 콘솔 선행 작업)

기존 MySQL 설치에 아래를 적용한다. SQLite 는 기동 시 자동 적용되므로 불필요하다.

**새로 설치하는 경우에는 이 문서가 필요 없다** — `mobius/mobiusdb.sql` 에 아래
내용이 모두 반영돼 있다(`hit_ri` 테이블, `idx_lookup_ty_et`, `idx_lookup_pi_sri`,
그리고 `idx_lookup_pi` 의 `INVISIBLE` 제거). 이 문서는 **기존 설치 전용** 경로다.

## 1. 인덱스

`idx_lookup_pi` 는 스키마에 이미 있으나 `INVISIBLE` 로 선언되어 옵티마이저가 무시한다.

```sql
ALTER TABLE lookup ALTER INDEX idx_lookup_pi VISIBLE;
CREATE INDEX idx_lookup_ty_et  ON lookup(ty, et);
CREATE INDEX idx_lookup_pi_sri ON lookup(pi, sri);
```

`cin` 은 `cin_ri_idx(pi,ri,cs)` 가 이미 `pi` 로 시작하므로 추가 인덱스가 필요 없다.

### 보류: `lookup(ty, ri)`

경로 접두어 범위 안에서 타입을 거르는 질의(`WHERE ri >= ? AND ri < ? AND ty <> 4`)에는 `(ty, ri)` 가 유리하다. 하지만 `lookup` 은 CIN 등록마다 INSERT 가 일어나는 쓰기 집중 테이블이고, 이 계획은 이미 인덱스 3개를 추가한다. 네 번째 인덱스의 쓰기 비용이 조회 이득보다 큰지는 **콘솔의 scope 필터 화면을 실제로 만든 뒤 측정해서 판단한다.** 지금 추가하지 않는다.


## 2. `hit_ri` 테이블

```sql
CREATE TABLE IF NOT EXISTS hit_ri (
  ri   varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  ct   varchar(8)   NOT NULL,
  http int NOT NULL DEFAULT 0,
  mqtt int NOT NULL DEFAULT 0,
  coap int NOT NULL DEFAULT 0,
  ws   int NOT NULL DEFAULT 0,
  PRIMARY KEY (ri, ct),
  KEY idx_hit_ri_ct (ct)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

## 운영 주의

대형 `lookup` 테이블에 `CREATE INDEX` 는 락을 잡을 수 있다. MySQL 5.6 이상은
온라인 DDL 을 지원하지만 배포처 버전과 부하를 확인하고 트래픽이 적은 시간에
적용한다. 필요하면 `ALGORITHM=INPLACE, LOCK=NONE` 을 명시한다:

```sql
CREATE INDEX idx_lookup_ty_et ON lookup(ty, et) ALGORITHM=INPLACE, LOCK=NONE;
```
