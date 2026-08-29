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

/** 자동 정리에서 제외되는 타입 — 방치하면 계속 쌓이는 쪽이다. */
export const NEVER_AUTO_DELETED = new Set([2, 3, 5])

/** 서버가 만료되면 자동으로 지우는 타입. ACP 가 사라지면 참조하던 리소스의 권한이 바뀐다. */
export const AUTO_DELETED_RISKY = new Set([1])
