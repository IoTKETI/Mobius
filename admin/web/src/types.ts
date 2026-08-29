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
  /** 부모 경로. 이 값이 lookup 에 없어서 고아다. */
  pi: string
  ty: number
  rn: string
  ct: string
  lt: string
  et: string
}

export interface OrphanPage {
  rows: OrphanRow[]
  more: boolean
  nextRi: string | null
  /** 이 응답을 만들려고 훑은 행 수. */
  scanned: number
  /** 훑기 상한에 걸렸는가. 걸렸으면 뒤에 더 있을 수 있다. */
  scanCapped: boolean
  typeNames: Record<string, string>
}

export interface OrphanSummary {
  cap: number
  count: number
  capped: boolean
}

/** 자동 정리에서 제외되는 타입 — 방치하면 계속 쌓이는 쪽이다. */
export const NEVER_AUTO_DELETED = new Set([2, 3, 5])

/** 서버가 만료되면 자동으로 지우는 타입. ACP 가 사라지면 참조하던 리소스의 권한이 바뀐다. */
export const AUTO_DELETED_RISKY = new Set([1])

/**
 * et 를 수정할 수 있는 타입. CIN(4)은 oneM2M 상 UPDATE 자체가 405 다
 * (app.js:1839). CSEBase(5)도 수정할 수 없다(405-9).
 */
export const ET_EXTENDABLE = new Set([1, 2, 3, 9, 23])

/** 삭제할 수 없는 타입 — CSEBase 는 트리의 뿌리다. */
export const UNDELETABLE = new Set([5])

// ── 일괄 작업 ──────────────────────────────────────────────────────────────

export type JobKind = 'expired-delete' | 'expired-extend' | 'orphan-delete'
export type JobState = 'running' | 'done' | 'cancelled' | 'failed'

export interface JobOutcome {
  ri: string
  reason: string
}

export interface Job {
  id: string
  kind: JobKind
  title: string
  note: string
  state: JobState
  total: number
  processed: number
  ok: number
  /** 프리플라이트에서 걸러진 것 — 이미 없거나, 조건이 바뀌었거나, 타입이 안 되거나. */
  skipped: number
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
  /** lookup 에만 있고 acp 본문이 없는 반쪽. 참조하는 리소스의 잠금이 조용히 풀린다. */
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
  nextRi: string | null
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
  /** own | inherited | override | override_inherited | none */
  source: string
  inherited_from?: string | null
  acpi: string[]
  resolved?: AcpResolvedEntry[]
  /**
   * 리소스의 권한 출처를 원본과 무관하게 확인했는가.
   * false 면 source/acpi 를 믿을 수 없으므로 화면이 단정하지 않는다.
   */
  factsResolved?: boolean
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
