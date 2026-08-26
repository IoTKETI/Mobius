# 동작 동등성 하네스

리팩터링 전후로 Mobius 의 관측 가능한 동작이 같은지 확인한다.
SQL 텍스트가 바뀌어도 무관하다.

## 사용

    # 1) 기준선 (리팩터링 전)
    node mobius.js sqlite > /dev/null 2>&1 &
    sleep 12
    node tools/equivalence/run-scenarios.js tools/equivalence/out/before.json
    # 서버 종료

    # 2) 변경 후
    node mobius.js sqlite > /dev/null 2>&1 &
    sleep 12
    node tools/equivalence/run-scenarios.js tools/equivalence/out/after.json
    # 서버 종료

    # 3) 비교
    node tools/equivalence/compare.js \
        tools/equivalence/out/before.json tools/equivalence/out/after.json

## 주의

- 시나리오는 고정 이름(`eqv_ae`, `eqv_acp`)을 쓰고 시작할 때 지우므로
  재실행 가능하다.
- 생성된 `ri` 와 타임스탬프는 `<RI>` / `<TS>` 로 치환해 비교한다.
- MySQL 모드로도 같은 절차를 돌린다 (`node mobius.js mysql`).
  단 `before`/`after` 는 같은 백엔드끼리 비교해야 한다.
- `grp-create-unsupported` 단계는 SQLite 에서 501, MySQL 에서 201 이
  정상이다. 백엔드별로 기준선을 따로 뜬다.
