-- 기존 컨테이너에 보관 정책을 소급 적용한다.
-- cnt.js 의 retention_policy() 와 같은 규칙이며, 그쪽은 신규 생성 컨테이너에만 적용되므로
-- 이미 만들어진 컨테이너는 이 스크립트로 한 번 맞춰준다.
--
-- 주의: 한도를 낮추면 초과분이 오래된 것부터 실제로 삭제된다. 되돌릴 수 없다.
--
-- 선행 조건: sql_action.js 의 delete_oldest 수정(커버링 인덱스 재집계, 정렬된 DELETE,
-- 초과량 기준 삭제 건수)이 배포되어 있어야 한다. 그 전에 한도를 낮추면
-- 락을 쥔 채 도는 전수 스캔이 그대로 발동한다.
--
-- ── 범위를 쓰기가 있는 컨테이너로 한정하는 이유 ────────────────────
-- 정리 루틴은 CIN 삽입 시에만 돈다. 쓰기가 없는 컨테이너는 한도를 아무리 넘겨도
-- delete_oldest 를 호출하지 않으므로 장애를 일으킬 수 없다.
-- 전체 disarm 에 무조건 적용하면 8개 프로젝트 59개 컨테이너에서 약 2,075만 건이
-- 지워지는데, 그중 대부분은 수년째 휴면 상태인 타 프로젝트 보관 데이터다.
-- 활성 컨테이너만 맞추면 위험은 동일하게 제거하면서 휴면 데이터는 건드리지 않는다.

-- ── 범위를 Drone_Data 로 한정하는 이유 ────────────────────────────
-- 스파이럴은 건당 22~26KB 인 Drone_Data 계열에서만 용량 한도에 도달한다.
-- Mission_Data(건당 565B), GCS_Data, MarkerInfos, DroneInfos 는 같은 건수에서
-- 용량이 40배 작아 한도 근처에도 가지 않는다. 굳이 건드려 지울 이유가 없다.

-- 활성 기준 날짜. 필요에 따라 조정한다 (ct 는 UTC, 'YYYYMMDD' 접두 비교).
SET @since = '20260813';

CREATE TEMPORARY TABLE active_pi (pi varchar(200) NOT NULL PRIMARY KEY);
INSERT INTO active_pi
SELECT DISTINCT pi FROM lookup WHERE ty = 4 AND ct >= @since;

-- ── dry-run: 적용 시 삭제될 건수를 먼저 확인할 것 ─────────────────
-- SELECT c.ri, live.n AS live_cni,
--        GREATEST(live.n - (CASE WHEN c.ri LIKE '%/KETI_Simul_%' THEN 10000 ELSE 100000 END), 0) AS will_delete
--   FROM cnt c
--   JOIN active_pi a ON a.pi = c.ri
--   JOIN LATERAL (SELECT COUNT(*) n FROM cin WHERE pi = c.ri) live ON TRUE
--  WHERE c.ri LIKE '%/Drone_Data/%'
--    AND (c.ri LIKE '%/KETI_Simul_%' OR c.ri LIKE '%/disarm')
-- HAVING will_delete > 0
--  ORDER BY will_delete DESC;

-- ── 적용 ─────────────────────────────────────────────────────────

-- 시뮬레이터: sortie/disarm 구분 없이 전부 최소 보관
UPDATE cnt c JOIN active_pi a ON a.pi = c.ri
   SET c.mni = 10000, c.mbs = 3153600000
 WHERE c.ri LIKE '%/Drone_Data/%'
   AND c.ri LIKE '%/KETI_Simul_%';

-- 소티(YYYY_MM_DD_T_HH_MM): 삭제 없이 축적. mni 는 Mobius 상한, mbs 는 1TiB
-- 한도를 올리기만 하므로 삭제가 발생하지 않는다. 활성 여부와 무관하게 적용해도 안전하다.
UPDATE cnt SET mni = 3153600000, mbs = 1099511627776
 WHERE ri LIKE '%/Drone_Data/%'
   AND ri REGEXP '/[0-9]{4}_[0-9]{2}_[0-9]{2}_T_[0-9]{2}_[0-9]{2}$'
   AND ri NOT LIKE '%/KETI_Simul_%';

-- disarm: 100,000건 순환 보관. mbs 는 기본값을 남겨 디스크 안전장치로 쓴다
UPDATE cnt c JOIN active_pi a ON a.pi = c.ri
   SET c.mni = 100000, c.mbs = 3153600000
 WHERE c.ri LIKE '%/Drone_Data/%'
   AND c.ri LIKE '%/disarm'
   AND c.ri NOT LIKE '%/KETI_Simul_%';

DROP TEMPORARY TABLE active_pi;
