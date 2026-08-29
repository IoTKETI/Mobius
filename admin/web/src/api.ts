import type { ExpiredPage, ExpiredSummary, OrphanPage, OrphanSummary } from './types'

export class AuthError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (res.status === 401) throw new AuthError('not authenticated')
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
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
  return get<{ ok: boolean; backend: string }>('/api/session')
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
