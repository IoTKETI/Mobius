// oneM2M 속성명은 두 글자 약어라 타입 정의가 사실상 문서다.
//   ri  resourceID (구조화 경로, 예: /Mobius/AE/CNT)
//   pi  parentID (부모의 구조화 경로)
//   ty  resourceType (숫자)
//   rn  resourceName
//   ct  creationTime, lt  lastModifiedTime, et  expirationTime
//       — 전부 'YYYYMMDDThhmmss' 문자열이라 문자열 비교로 정렬이 성립한다.

export interface ExpiredRow {
  ri: string
  pi: string
  ty: number
  rn: string
  et: string
  ct: string
  lt: string
}

export interface ExpiredPage {
  asOf: string
  rows: ExpiredRow[]
  /** 다음 쪽이 더 있는가. 전체 건수는 세지 않는다 — 5,740만 행에 et 인덱스가 없다. */
  more: boolean
  nextEt: string | null
  nextRi: string | null
  typeNames: Record<string, string>
}

export interface ExpiredSummary {
  asOf: string
  /** 센 상한. 여기서 끊었으면 capped 가 true 다. */
  cap: number
  capped: boolean
  counted: number
  byType: Record<string, number>
  typeNames: Record<string, string>
}

export interface OrphanRow {
  ri: string
  /** 부모 경로. 이 값이 lookup 에 없어서 미연결이다. */
  pi: string
  ty: number
  rn: string
  ct: string
}

/** 미연결 탐지 작업 하나의 결과 파일. 세지 않는다 — 표본이다. */
export interface OrphanScanResult {
  runId: string
  startedAt: string
  endedAt: string | null
  cancelled: boolean
  scanCap: number
  sampleCap: number
  /** 훑은 행 — 이어서 훑기로 누적된다. scanCapped 는 **이번 실행**이 상한에서 멈췄는가다. */
  scanned: number
  scanCapped: boolean
  orphans: OrphanRow[]
  sampleTruncated: boolean
  lookupOnlyCin: { rows: { ri: string; pi: string; rn: string; ct: string }[]; scanned: number; scanCapped: boolean; sampleTruncated: boolean }
  /** 앞 결과를 이어받았는가. runs 는 그 사슬의 길이. */
  continued: boolean
  runs: number
  /** 표를 끝까지 다 봤는가. */
  complete: boolean
  /** 멈춘 자리가 남아 있어 이어서 훑을 수 있는가. 화면의 '이어서 훑기' 버튼이 이것을 본다. */
  resumable: boolean
  resume: { s1: { cursor: string | null; done: boolean }; s2: { cursor: string | null; done: boolean } }
  typeNames: Record<string, string>
}

// ── 일괄 작업 ──────────────────────────────────────────────────────────────

export type JobKind = 'expired-delete' | 'expired-extend' | 'orphan-delete' | 'orphan-scan' | 'cin-missing-delete' | 'sub-delete' | 'selftest'
export type JobState = 'running' | 'done' | 'cancelled' | 'failed'

/**
 * 건너뛴 것의 갈래(jobs.js 의 SKIP_CATEGORIES). 전부 '건너뜀' 한 덩어리로 보여 주면
 * 정리가 덜 된 것처럼 읽힌다 — 실제로는 대부분 더 할 일이 없는 것이다.
 *
 *   settled     손댈 것이 없었다 (이미 없음) — 정리 끝
 *   excluded    지우면 안 되는 것으로 판정해 뺐다 — 남겨 두는 것이 옳다
 *   unresolved  판단하지 못했다 — 다시 봐야 한다
 */
export type JobSkipCategory = 'settled' | 'excluded' | 'unresolved'

export interface JobOutcome {
  ri: string
  reason: string
  /** skips 에만 있다. 옛 작업 기록에는 없을 수 있다. */
  category?: JobSkipCategory
}

export interface Job {
  id: string
  kind: JobKind
  title: string
  note: string
  state: JobState
  /** 엔진의 '대상' 개수. 대상이 곧 리소스인 작업(삭제·연장)에서만 뜻이 통한다. */
  total: number
  processed: number
  /**
   * 작업 자신의 단위로 말한 진행. 미연결 탐지처럼 대상이 조각인 작업이 채운다 —
   * 없으면 화면이 processed/total 을 쓴다.
   */
  progress: { label: string; done: number; total: number | null } | null
  /** 끝난 뒤 한 줄. 무엇을 찾았는지는 작업 자신만 안다. 비어 있을 수 있다. */
  summary: string
  ok: number
  /** 프리플라이트에서 걸러진 것 — 아래 셋의 합이다. */
  skipped: number
  /** 손댈 것이 없었다 (이미 없음). */
  settled: number
  /** 지우면 안 되는 것으로 판정해 뺐다. */
  excluded: number
  /** 판단하지 못했다 — 다시 봐야 한다. */
  unresolved: number
  failed: number
  failures: JobOutcome[]
  failuresTruncated: boolean
  skips: JobOutcome[]
  skipsTruncated: boolean
  startedAt: string
  finishedAt: string | null
  error: string | null
  cancelRequested: boolean
}

export interface WriteInfo {
  /** Mobius 주소가 설정되어 있는가. 없으면 콘솔은 조회 전용이다. */
  enabled: boolean
  target: string | null
  /** 콘솔이 superUser 로 붙는가 — 그렇다면 ACP 를 전부 통과한다. */
  superuser: boolean
}

export interface AcpConfig {
  /** 'observe' 면 거부가 허용으로 나간다 — 켠 채로 두면 ACP 가 무력해진다. */
  observeMode: string
  /** 'creator' 면 생성자와 수퍼유저만 처음 acpi 를 붙일 수 있다. */
  attachPolicy: string
  defaultPolicy: string
  audit: string
  denyLog: string
  /** 'off' 면 잠근 컨테이너의 경로가 상위 discovery 에 그대로 나온다 — 시뮬레이터가 보호를 과장한다. */
  discoveryFilter: string
}

/** 코어가 정하는 만료 정책. 화면은 이것만 본다 — 상수를 두지 않는다. */
export interface ExpiryPolicy {
  autoDeletedTypes: number[]
  etExtendableTypes: number[]
  undeletableTypes: number[]
  typeNames: Record<string, string>
}

export interface HitRow { ct: string; http: number; mqtt: number; coap: number; ws: number }

// ── 구독 (엔드포인트 롤업) ───────────────────────────────────────────────────

/** 같은 nu 엔드포인트(scheme://host)로 묶은 구독 집계 한 줄. */
export interface SubsEndpoint {
  endpoint: string
  total: number
  /** 알림을 보낼 수 없는 구독 수 — 일괄 삭제 후보. */
  broken: number
  /** 보낼 수는 있으나 받을 상대가 확인되지 않는 구독 수 — 사람이 하나씩 골라야 한다. */
  suspect: number
  sample: string[]
}

export interface SubsEndpointsPage {
  endpoints: SubsEndpoint[]
  endpointsTruncated: boolean
  scanned: number
  capped: boolean
  audit: { scanned: number; capped: boolean; findingsTruncated: boolean; bySeverity: Record<string, number>; byReason: Record<string, number> }
}

/** 코어 구독 감사(audit_subscriptions)가 낸 판정이 붙은 구독 한 행. */
export interface SubsSampleRow {
  ri: string
  pi: string
  nu: string[]
  enc: unknown
  cr: string
  severity: 'broken' | 'suspect' | null
  reason: string | null
}

export interface SubsSamplePage {
  rows: SubsSampleRow[]
  more: boolean
  scanned: number
  capped: boolean
}

export interface SessionInfo {
  ok: boolean
  backend: string
  write: WriteInfo
  acp: AcpConfig
}

// ── ACP ────────────────────────────────────────────────────────────────────

export interface AcpProblem {
  severity: 'error' | 'warn'
  rule: string
  path: string
  message: string
}

export interface AcpListRow {
  ri: string
  pi: string
  rn: string
  ct: string
  lt: string
  et: string
  acpi: string
}

export interface AcpDetail {
  ri: string
  rn: string
  pi: string
  ct: string
  lt: string
  et: string
  acpi: string
  pv: unknown
  pvs: unknown
  pv_parsed: AcpPrivileges | null
  pvs_parsed: AcpPrivileges | null
  /** 이 ri 가 정말 ACP(ty=1)인가. false 면 아래 body_missing 은 뜻이 없다. */
  is_acp: boolean
  /**
   * ACP 인데 acp 본문이 없는 반쪽. 참조하는 리소스의 잠금이 조용히 풀린다.
   * is_acp 가 false 면 항상 false 다 — ACP 가 아닌 것을 반쪽이라고 하지 않는다.
   */
  body_missing: boolean
}

export interface AcpRule {
  acor?: string[]
  acop?: number | string
  acco?: unknown[]
}

export interface AcpPrivileges {
  acr?: AcpRule[]
}

/** 편집기의 규칙 한 줄. acor 는 쉼표로 구분한 문자열, acop 은 비트 합. */
export interface EditRule {
  acor: string
  acop: number
}

export interface AcpRef {
  ri: string
  ty: number
  rn: string
  pi: string
  acpi: string
  raw: string
  normalized: string
}

export interface AcpRefs {
  refs: AcpRef[]
  refsTruncated: boolean
  scanned: number
  capped: boolean
  broken: number
  unresolved: string[]
  nextRi?: string | null
}

export interface AcpMacpRefs {
  refs: { ri: string; macp: string }[]
  broken: number
}

export interface AcpDetailResponse {
  detail: AcpDetail
  /** null 이면 확인하지 못한 것이다 — 0건이 아니다. */
  refs: AcpRefs | null
  refsError: string | null
  macpRefs: AcpMacpRefs | null
  macpError: string | null
  problems: AcpProblem[]
}

export interface AcpLintRow {
  ri: string
  rn: string
  ct: string
  lt: string
  et: string
  problems: AcpProblem[]
}

export interface AcpLintPage {
  rows: AcpLintRow[]
  more: boolean
  nextRi: string | null
  counts: { error: number; warn: number; clean: number }
}

export interface AcpRefLintRow {
  ri: string
  ty: number
  rn: string
  acpi: string
  problems: AcpProblem[]
}

export interface AcpRefLintPage {
  rows: AcpRefLintRow[]
  counts: { error: number; warn: number; clean: number }
  scanned: number
  capped: boolean
  broken: number
  unresolved: string[]
}

export type AcpOp =
  | 'CREATE'
  | 'CREATE_SUB'
  | 'RETRIEVE'
  | 'UPDATE'
  | 'DELETE'
  | 'NOTIFY'
  | 'DISCOVERY'

export const ACP_OPS: AcpOp[] = [
  'CREATE',
  'CREATE_SUB',
  'RETRIEVE',
  'UPDATE',
  'DELETE',
  'NOTIFY',
  'DISCOVERY',
]

export interface AcpVerdict {
  origin: string
  op: AcpOp
  allowed: boolean
  code: string
  /** superuser | creator | acr | no_acr_cr | no_acp_row | exhausted | eval_error | default_policy */
  decided_by: string
  acp_ri: string | null
}

/** acpi 원소 하나의 저장 원문과 그것이 가리키는 실제 ri. 둘은 다를 수 있다. */
export interface AcpResolvedEntry {
  /** 저장된 그대로 (절대 표기·SP상대·sri 일 수 있다) */
  given: string
  /** 내부 ri 로 푼 값. 못 풀면 null */
  ri: string | null
  exists: boolean
}

export interface AcpSimulation {
  ri: string
  ty: number
  cr: string
  /**
   * own | inherited | override | override_inherited | none
   *
   * **리소스의 성질이지 원본의 성질이 아니다.** 원본을 적은 순서와 무관하다.
   * 전부 수퍼유저·생성자로 단축 판정되면 `null` 이다 — 'none' 으로 적으면
   * "ACP 가 없다" 로 읽히고 그것이 거짓이기 때문이다. 그때는
   * `source_unknown` 경고가 함께 온다.
   */
  source: string | null
  inherited_from?: string | null
  acpi: string[] | null
  resolved?: AcpResolvedEntry[] | null
  matrix: AcpVerdict[]
  warnings: { rule: string; message: string }[]
}

export interface AcpAuditRow {
  id: number
  ts: string
  op: string
  ri: string
  ty: number
  origin: string
  cr: string
  before: string | null
  after: string | null
}

export interface AcpAuditPage {
  rows: AcpAuditRow[]
  more: boolean
  nextId: number | null
}

export interface AcpValidation {
  code: string | null
  path: string | null
  warnings: { rule: string; path: string; message: string }[]
}

/** decided_by 값을 사람이 읽을 말로. 판정 근거가 곧 "어떻게 고쳐야 하나" 다. */
export const DECIDED_BY_LABEL: Record<string, string> = {
  superuser: '수퍼유저 — ACP 를 보지 않고 통과',
  creator: '생성자 — ACP 와 무관하게 통과',
  acr: 'ACP 규칙이 허용',
  no_acr_cr: 'pv 에 acr 이 없어 생성자만 통과',
  no_acp_row: '참조한 ACP 본문이 없음',
  exhausted: '맞는 규칙이 없음',
  eval_error: '평가 중 오류',
  default_policy: 'acpi 가 없어 기본 정책',
}
