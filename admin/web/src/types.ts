// oneM2M attribute names are two-letter abbreviations, so the type definitions serve as documentation.
//   ri  resourceID (structured path, e.g. /Mobius/AE/CNT)
//   pi  parentID (the parent's structured path)
//   ty  resourceType (number)
//   rn  resourceName
//   ct  creationTime, lt  lastModifiedTime, et  expirationTime
//       all 'YYYYMMDDThhmmss' strings, so string comparison sorts them

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
  /** Whether a next page exists. The total is not counted; the MySQL lookup has no et index. */
  more: boolean
  nextEt: string | null
  nextRi: string | null
  typeNames: Record<string, string>
}

export interface ExpiredSummary {
  asOf: string
  /** The counting cap; capped is true when counting stopped here. */
  cap: number
  capped: boolean
  counted: number
  byType: Record<string, number>
  typeNames: Record<string, string>
}

export interface OrphanRow {
  ri: string
  /** Parent path; the row is an orphan because this value is not in lookup. */
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
  /** Rows scanned to build this response. */
  scanned: number
  /** Whether the scan cap was hit; if so there may be more. */
  scanCapped: boolean
  typeNames: Record<string, string>
}

export interface OrphanSummary {
  cap: number
  count: number
  capped: boolean
}

/** Types excluded from automatic cleanup; the ones that keep accumulating. */
export const NEVER_AUTO_DELETED = new Set([2, 3, 5])

/** Types the server deletes automatically on expiry. When an ACP disappears, the permissions of the resources referencing it change. */
export const AUTO_DELETED_RISKY = new Set([1])

/** Types whose et can be modified. CIN(4) cannot be UPDATEd at all under oneM2M (405); CSEBase(5) cannot be modified either (405-9). */
export const ET_EXTENDABLE = new Set([1, 2, 3, 9, 23])

/** Types that cannot be deleted; the CSEBase is the root of the tree. */
export const UNDELETABLE = new Set([5])

// ── Batch jobs ──

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
  /** Filtered out by the preflight: already gone, condition changed, or an ineligible type. */
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
  /** Whether a Mobius address is configured; without it the console is read-only. */
  enabled: boolean
  target: string | null
  /** Whether the console connects as superUser, which passes every ACP. */
  superuser: boolean
}

export interface AcpConfig {
  /** 'observe' sends denials out as allowed; left on, ACP is disabled. */
  observeMode: string
  /** 'creator' lets only the creator and the superuser attach the first acpi. */
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

// ── ACP ──

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
  /** Whether this ri is really an ACP (ty=1). If false, body_missing below is meaningless. */
  is_acp: boolean
  /** An ACP whose acp body is missing: a half resource whose referencing resources are silently unlocked. Always false when is_acp is false. */
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
  /** null means it could not be checked; not zero. */
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

/** One acpi element as stored and the actual ri it points to; the two can differ. */
export interface AcpResolvedEntry {
  /** as stored (may be absolute, SP-relative or an sri) */
  given: string
  /** resolved to an internal ri; null when it cannot be resolved */
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
   * A property of the resource, not of the originator; independent of the order originators were given. When every originator is short-circuited as superuser or creator the value is null: 'none' would read as 'no ACP', which is false. A source_unknown warning comes with it.
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

/** decided_by values in human words; the basis of the verdict is also 'how to fix it'. */
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
