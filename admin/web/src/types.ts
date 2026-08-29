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

export interface SessionInfo {
  ok: boolean
  backend: string
  write: WriteInfo
}
