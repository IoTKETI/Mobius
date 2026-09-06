import type { EditRule } from '../types'

/**
 * 운영 방안이 정한 템플릿 셋. 문서는 "예외 세 가지만 쓴다 / 리소스마다 만들지
 * 않는다 / ACP 개수를 한 자리로 유지한다" 고 못박았다.
 * 출처: docs/superpowers/specs/2026-08-29-acp-operating-model.md
 */
export const TEMPLATES: { key: string; name: string; hint: string; pv: EditRule[] }[] = [
  { key: 'A', name: 'A · 완전 비공개', hint: '정해진 곳만 봅니다. 장치 ID 는 적지 않아도 됩니다 — 생성자는 자동으로 통과합니다.', pv: [{ acor: '', acop: 63 }] },
  { key: 'B', name: 'B · 올리기는 열고, 보는 것만 제한', hint: '장비는 계속 올리고 조회·탐색만 제한합니다.', pv: [{ acor: '', acop: 63 }, { acor: 'all', acop: 1 }] },
  { key: 'C', name: 'C · 보는 건 열고, 만드는 것만 막기', hint: '읽기는 지금처럼 열되 아무나 데이터를 넣지는 못하게 합니다.', pv: [{ acor: '', acop: 63 }, { acor: 'all', acop: 34 }] },
]

export function toPrivileges(rules: EditRule[]) {
  return { acr: rules.map((r) => ({ acor: r.acor.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean), acop: r.acop })) }
}
