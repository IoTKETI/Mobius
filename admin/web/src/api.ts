import type {
  AcpAuditPage,
  AcpDetailResponse,
  AcpLintPage,
  AcpListRow,
  AcpOp,
  AcpPrivileges,
  AcpRefLintPage,
  AcpSimulation,
  AcpValidation,
  ConfView,
  ExpiredPage,
  ExpiredSummary,
  Job,
  OrphanPage,
  OrphanSummary,
  ServerStatus,
  SessionInfo,
} from './types'

export class AuthError extends Error {}

/** 이미 도는 작업이 있어 거절당했다. 화면이 그 작업을 붙잡아 보여 줄 수 있게 실어 나른다. */
export class BusyError extends Error {
  constructor(
    message: string,
    readonly active: Job | null,
  ) {
    super(message)
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (res.status === 401) throw new AuthError('not authenticated')
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) throw new AuthError('not authenticated')
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; active?: Job }
    if (res.status === 409 && b.active) throw new BusyError(b.error ?? '이미 도는 작업이 있다', b.active)
    throw new Error(b.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function login(password: string): Promise<void> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password }),
  })
  if (res.status === 401) throw new AuthError('비밀번호가 맞지 않습니다')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
}

export function session() {
  return get<SessionInfo>('/api/session')
}

// ── 일괄 작업 ──────────────────────────────────────────────────────────────

export function startExpiredDelete(ris: string[]) {
  return post<Job>('/api/jobs/expired-delete', { ris })
}

export function startExpiredExtend(ris: string[], et: string) {
  return post<Job>('/api/jobs/expired-extend', { ris, et })
}

export function startOrphanDelete(ris: string[]) {
  return post<Job>('/api/jobs/orphan-delete', { ris })
}

export function getJob(id: string) {
  return get<Job>(`/api/jobs/${encodeURIComponent(id)}`)
}

export function cancelJob(id: string) {
  return post<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`)
}

/** 지금 도는 작업이 있으면 돌려준다. 화면을 새로 열어도 진행 중인 작업을 놓치지 않는다. */
export async function runningJob(): Promise<Job | null> {
  const { jobs } = await get<{ jobs: Job[] }>('/api/jobs')
  return jobs.find((j) => j.state === 'running') ?? null
}

/** 'YYYYMMDDThhmmss' 를 오늘부터 N일 뒤로 만든다. */
export function etAfterDays(days: number): string {
  const d = new Date(Date.now() + days * 86400000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  )
}

export function expiredSummary(cap = 5000) {
  return get<ExpiredSummary>(`/api/expired/summary?cap=${cap}`)
}

export function expiredPage(opts: {
  limit?: number
  types?: number[]
  afterEt?: string | null
  afterRi?: string | null
}) {
  const q = new URLSearchParams()
  q.set('limit', String(opts.limit ?? 50))
  if (opts.types?.length) q.set('types', opts.types.join(','))
  if (opts.afterEt) q.set('afterEt', opts.afterEt)
  if (opts.afterRi) q.set('afterRi', opts.afterRi)
  return get<ExpiredPage>(`/api/expired?${q.toString()}`)
}

export function orphanSummary(cap = 5000) {
  return get<OrphanSummary>(`/api/orphans/summary?cap=${cap}`)
}

export function orphanPage(opts: { limit?: number; afterRi?: string | null; scanCap?: number }) {
  const q = new URLSearchParams()
  q.set('limit', String(opts.limit ?? 50))
  if (opts.afterRi) q.set('afterRi', opts.afterRi)
  if (opts.scanCap) q.set('scanCap', String(opts.scanCap))
  return get<OrphanPage>(`/api/orphans?${q.toString()}`)
}

// ── Mobius 기동·정지 ───────────────────────────────────────────────────────

export function serverStatus() {
  return get<ServerStatus>('/api/server/status')
}

type CtlResult = { pid?: number; warning?: string; stopped?: boolean; restarted?: boolean }
export function serverStart() {
  return post<CtlResult>('/api/server/start')
}
export function serverStop() {
  return post<CtlResult>('/api/server/stop')
}
export function serverRestart() {
  return post<CtlResult>('/api/server/restart')
}

// ── 설정 (conf.json) ───────────────────────────────────────────────────────

export function confView() {
  return get<ConfView>('/api/conf')
}

/** 보낸 키만 바뀐다. 하나라도 유효하지 않으면 아무것도 안 쓴다. */
export function confSave(patch: Record<string, unknown>) {
  return post<{ ok: boolean; changed: { key: string; from: unknown; to: unknown }[] }>(
    '/api/conf',
    { patch },
  )
}

// ── ACP ────────────────────────────────────────────────────────────────────

export function acpList(opts: { limit?: number; afterRi?: string | null } = {}) {
  const q = new URLSearchParams()
  q.set('limit', String(opts.limit ?? 100))
  if (opts.afterRi) q.set('afterRi', opts.afterRi)
  return get<{ rows: AcpListRow[]; more: boolean; nextRi: string | null }>(`/api/acp?${q}`)
}

export function acpDetail(ri: string) {
  return get<AcpDetailResponse>(`/api/acp/detail?ri=${encodeURIComponent(ri)}`)
}

export function acpLint(opts: { limit?: number; afterRi?: string | null } = {}) {
  const q = new URLSearchParams()
  q.set('limit', String(opts.limit ?? 200))
  if (opts.afterRi) q.set('afterRi', opts.afterRi)
  return get<AcpLintPage>(`/api/acp/lint?${q}`)
}

/** 이어보기가 없다 — 서버 주석 참고. 상한에 걸리면 capped 로만 알려 준다. */
export function acpLintRefs(opts: { maxRefs?: number } = {}) {
  const q = new URLSearchParams()
  if (opts.maxRefs) q.set('maxRefs', String(opts.maxRefs))
  return get<AcpRefLintPage>(`/api/acp/lint-refs?${q}`)
}

/**
 * @param acpiOverride 저장하지 않은 상태로 물어본다 — "이 ACP 를 떼면?" 미리보기.
 *   빈 배열도 의미가 있으므로 undefined 와 구분해서 넘긴다.
 */
export function acpSimulate(body: {
  ri: string
  origins: string[]
  ops: AcpOp[]
  acpiOverride?: string[]
}) {
  return post<AcpSimulation>('/api/acp/simulate', body)
}

export function acpValidate(field: 'pv' | 'pvs', value: unknown) {
  return post<AcpValidation>('/api/acp/validate', { field, value })
}

/** 보낸 것만 바뀐다 — pv 만 넘기면 pvs 는 그대로 남는다. */
export function acpSave(ri: string, body: { pv?: AcpPrivileges; pvs?: AcpPrivileges }) {
  return post<{ ok: boolean; status: number; rsc: string | null }>('/api/acp/save', {
    ri,
    ...body,
  })
}

/**
 * 저장하지 않은 본문으로 판정을 미리 본다.
 * acpRowsOverride 는 {ri, pv, pvs} 행 배열이다.
 */
export function acpSimulateWithRows(body: {
  ri: string
  origins: string[]
  ops: AcpOp[]
  rows: { ri: string; pv?: AcpPrivileges; pvs?: AcpPrivileges }[]
}) {
  return post<AcpSimulation>('/api/acp/simulate', {
    ri: body.ri,
    origins: body.origins,
    ops: body.ops,
    acpRowsOverride: body.rows,
  })
}

export function acpAudit(opts: { ri?: string; limit?: number; afterId?: number | null } = {}) {
  const q = new URLSearchParams()
  q.set('limit', String(opts.limit ?? 50))
  if (opts.ri) q.set('ri', opts.ri)
  if (opts.afterId) q.set('afterId', String(opts.afterId))
  return get<AcpAuditPage>(`/api/acp/audit?${q}`)
}

/** 'YYYYMMDDThhmmss' → '2025-06-01 00:00' */
export function fmtTime(t: string): string {
  if (!/^\d{8}T\d{6}$/.test(t)) return t || '—'
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(9, 11)}:${t.slice(11, 13)}`
}

/** 만료된 지 며칠 지났는가. 음수면 아직 안 지났다. */
export function daysSince(et: string, asOf: string): number | null {
  const p = (t: string) =>
    /^\d{8}T\d{6}$/.test(t)
      ? Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(9, 11), +t.slice(11, 13))
      : null
  const a = p(et)
  const b = p(asOf)
  if (a === null || b === null) return null
  return Math.floor((b - a) / 86400000)
}
