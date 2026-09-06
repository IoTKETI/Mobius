<script setup lang="ts">
/**
 * 판정 행렬 표 하나. 편집·생성·연결 세 화면이 저장 전 미리보기로 이것을 쓴다 —
 * 마크업을 세 번 베끼면 한 곳만 고치는 사고가 난다.
 */
import type { AcpOp, AcpVerdict } from '../types'

withDefaults(
  defineProps<{ matrix: AcpVerdict[]; origins: string[]; ops: AcpOp[]; stale?: boolean; staleNote?: string }>(),
  { stale: false, staleNote: '바뀐 내용을 아직 미리 보지 않았습니다 — 아래는 이전 결과입니다.' },
)
</script>

<template>
  <div class="ptable" :class="{ stale }">
    <p v-if="stale" class="stalenote">{{ staleNote }}</p>
    <table>
      <thead><tr><th>원본 \ 연산</th><th v-for="o in ops" :key="o">{{ o }}</th></tr></thead>
      <tbody>
        <tr v-for="og in origins" :key="og">
          <th class="rowh mono">{{ og }}</th>
          <td v-for="o in ops" :key="o">
            <template v-for="m in matrix.filter((x) => x.origin === og && x.op === o)" :key="m.op">
              <div class="verdict" :class="[m.allowed ? 'yes' : 'no', m.decided_by]">
                <span class="mark">{{ m.allowed ? '허용' : '거부' }}</span>
                <span class="why">{{ m.decided_by }}</span>
              </div>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.ptable { margin-top: 1rem; overflow: auto; }
.ptable.stale { opacity: 0.55; }
.stalenote { color: var(--warn); font-size: 0.92rem; margin: 0 0 0.5rem; }
.ptable th.rowh { text-align: left; font-family: var(--mono); font-weight: 600; text-transform: none; letter-spacing: 0; font-size: 0.95rem; color: var(--text); position: static; }
.verdict { display: grid; gap: 0.1rem; padding: 0.3rem 0.5rem; border-radius: 7px; min-width: 90px; }
.verdict .mark { font-weight: 700; font-size: 0.9rem; }
.verdict .why { font-size: 0.73rem; opacity: 0.85; font-family: var(--mono); }
.verdict.yes { background: rgba(46, 160, 118, 0.14); color: var(--ok); }
.verdict.no { background: var(--danger-wash); color: var(--danger); }
.verdict.creator, .verdict.superuser { background: var(--accent-wash); color: var(--accent-strong); }
</style>
