# ACP 사용 현황 조사 (배포 서버, 2026-08-29)

"ACP 를 설정하면 동작이 안 되고, 안 될 때 대응 방법이 없어서 거의 안 쓴다" 는
문제의 원인을 찾기 위해 실제 데이터와 코드를 조사했다. 전부 배포 서버 실측이다.

---

## 1. 실제로 거의 안 쓰인다 — 그리고 쓴 것 중 절반이 깨져 있다

| | 수 |
|---|---|
| ACP 리소스 (`acp` 테이블 / `lookup` 의 `ty=1`) | **1개** |
| `acpi` 가 채워진 리소스 (비-CIN 34,313행 전수) | **2개** |

그 2개는:

```
/Mobius/Camera1/health   acpi=["/Mobius/Camera1/acp-Camera1"]   → 정상
/Mobius/sch8             acpi=["/Mobius/acp_sch1"]              → **그 ACP 가 없다**
```

`/Mobius/acp_sch1` 은 존재하지 않는다. 그 결과 `/Mobius/sch8` 은 이렇게 된다:

```
GET /Mobius/sch8  as S0.0.0.0  -> HTTP 403 {"m2m:dbg":"ACCESS DENIED"}
GET /Mobius/sch8  as Ssch8     -> HTTP 403 {"m2m:dbg":"ACCESS DENIED"}
GET /Mobius/sch8  as Sponde    -> HTTP 200   (수퍼유저만 통과)
```

**AE 하나가 수퍼유저 말고는 아무도 못 쓰는 상태로 잠겨 있다.** 사용자가 말한
"설정해 버리면 동작을 안 한다" 가 운영 데이터에 그대로 남아 있는 셈이다.

근거는 `mobius/security.js` 의 `security_check_action`:

```js
if (results_acp.length == 0) {
    callback(request.headers['x-m2m-origin'] == cr ? '1' : '0');
    return;
}
```

참조한 ACP 를 못 찾으면 **생성자만 허용하고 나머지는 전부 거부**한다.
경고도 로그도 없다.

## 2. 잘못된 참조를 서버가 그대로 받는다

`acpi` 에 존재하지 않는 ri 를 넣어도 검증 없이 저장된다. 로컬 재현:

```
PUT /Mobius/lock_probe_ae  {"m2m:ae":{"acpi":["/Mobius/does_not_exist"]}}  -> 200
그 뒤 제3자 조회                                                            -> 403
```

즉 **오타 한 번으로 리소스가 잠긴다.** 되돌리는 방법은 있다:

```
PUT ... {"m2m:ae":{"acpi":[]}}  as 생성자        -> 200, 되살아난다
PUT ... {"m2m:ae":{"acpi":[]}}  as 제3자         -> 403
```

**생성자만 되살릴 수 있다.** `/Mobius/sch8` 의 생성자는 이제 없거나 알 수
없으므로 수퍼유저로만 고칠 수 있다.

> `app.js:1260` 에 "acpi 만 바꾸는 UPDATE 는 권한 검사를 건너뛴다" 는 코드와
> 주석이 있는데, 실측에서는 제3자의 `acpi` 만 바꾸는 PUT 도 403 이었다.
> 주석과 실제 동작이 어긋난다 — 복구 절차를 세우기 전에 확인이 필요하다.

## 3. 지금은 사실상 "권한 없음" 상태로 돌고 있다

`mobius.js:88` 에 **하드코딩**돼 있다 (conf.json 으로 못 바꾼다):

```js
global.useaccesscontrolpolicy = 'disable';
```

`acpi` 가 비어 있으면 `security_default_check_action` 이 판정하는데,
`disable` 이면:

| | 생성자 | 그 밖의 누구든 |
|---|---|---|
| CREATE(1) / RETRIEVE(2) / DISCOVERY(32) | 허용 | **허용** |
| UPDATE(4) / DELETE(8) | 허용 | 거부 |

`acpi` 가 채워진 2개를 빼면 전 시스템이 이 규칙으로 돈다.
읽기는 누구나, 수정은 만든 사람만 — 개발용으로는 합리적이지만
**운영 정책으로 선택된 값이 아니라 하드코딩된 기본값**이다.

## 4. 수퍼유저가 하드코딩된 문자열이다

`mobius.js:50-51`:

```js
global.usesuperuser = (typeof conf.superUser === 'string' && conf.superUser !== '')
    ? conf.superUser : 'Sponde';
```

배포 서버 `conf.json` 에 `superUser` 키가 **없다** → 기본값 `Sponde` 가 쓰인다.
`security.check` 첫 줄에서 무조건 통과하므로, 이 문자열을 아는 사람은
`X-M2M-Origin: Sponde` 하나로 모든 접근 제어를 우회한다.

## 5. 거부돼도 아무 흔적이 안 남는다

로그 22개 파일에서 실제 권한 거부 기록:

| 검색어 | 건수 |
|---|---|
| `ACCESS DENIED` | 0 |
| `403-3` | 0 |
| `ACCESS_DENIED` | 0 |

`mobius/security.js` 의 `console` 호출 5개는 전부 "ACP 를 파싱 못 해서
건너뛴다" 같은 예외 처리용이고, **누가·무엇을·왜 거부당했는지 남기는 곳이
없다.** 클라이언트가 받는 것도 `{"m2m:dbg":"ACCESS DENIED"}` 한 줄뿐이라
어느 ACP 의 어느 규칙 때문인지 알 수 없다.

이것이 두 번째 고통("ACP 인 줄 알아도 대응 방법이 없다")의 직접적 원인이다.

> 참고: 로그에 `4103` 이 265건 보이지만 **전부 URL 안의 타임스탬프**다
> (`cra=20201117T234103`). 실제 거부가 아니다.

## 6. discovery 는 개별 리소스 권한을 아예 안 본다

`app.js` 의 `lookup_retrieve` 는 **주소로 지정한 리소스 하나**에만
DISCOVERY(32)를 검사하고, 결과로 나온 리소스는 한 건도 검사하지 않는다.
로컬·배포 서버 양쪽에서 재현했다 (`tools/discovery-compare/acp-leak.js`):

```
GET /Mobius/acp_probe_ae/secret  as Cstranger  -> HTTP 403   (막힌다)
GET /Mobius/acp_probe_ae?fu=1    as Cstranger  -> HTTP 200
      Mobius/acp_probe_ae/secret                 ← 경로가 그대로 새어 나온다
```

## 7. 관리 UI 에 필요한 역조회는 싸다

"이 ACP 를 참조하는 리소스가 무엇인가" 는 `acpi` 에 인덱스가 없어 걱정했지만,
**CIN 을 빼면 34,313행뿐**이라 `idx_lookup_ty` 범위 스캔으로 끝난다:

| 질의 | 시간 |
|---|---|
| 비-CIN 행 수 세기 | 20ms |
| `acpi` 가 채워진 것 전수 | **119ms** (2건) |
| 특정 ACP 참조 검색 (`acpi like`) | **113ms** (1건) |

CIN 에 ACP 를 다는 일은 없다(표본 3만 건 중 0). 새 인덱스 없이 가능하다.

## 8. `acpi` 컬럼이 좁다

`lookup.acpi` 는 `varchar(200)` 이다. ACP ri 하나가 22자 남짓이고 JSON 배열
표기(`["...","..."]`)를 감안하면 **3~4개가 한계**다. oneM2M 은 여러 ACP 를
걸 수 있게 돼 있으므로 설계 시 염두에 둬야 한다.

---

## 정리 — 왜 못 쓰게 됐는가

| 사용자가 겪은 것 | 실제 원인 |
|---|---|
| 설정하면 동작이 안 된다 | 없는 ACP 를 가리켜도 서버가 받아 주고, 그러면 생성자 외 전원 거부 (§1, §2) |
| 뭐가 문제인지 모른다 | 응답은 `ACCESS DENIED` 한 줄, 서버 로그는 아무것도 없음 (§5) |
| 어떻게 되돌리는지 모른다 | 생성자만 `acpi=[]` 로 복구 가능. 절차가 문서화된 적 없음 (§2) |
| 안 쓰면 그냥 되던데 | 기본 정책이 "읽기는 누구나" 라서 (§3) |
