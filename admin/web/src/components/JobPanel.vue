<script setup lang="ts">
import { computed } from 'vue'
import type { Job } from '../types'

const props = defineProps<{ job: Job; error?: string }>()
const emit = defineEmits<{ cancel: []; dismiss: [] }>()

const pct = computed(() =>
  props.job.total === 0 ? 100 : Math.round((props.job.processed / props.job.total) * 100),
)

const stateLabel = computed(() => {
  switch (props.job.state) {
    case 'running':
      return props.job.cancelRequested ? '취소 중 — 시작한 건은 마칩니다' : '진행 중'
    case 'done':
      return '완료'
    case 'cancelled':
      return '취소됨'
    default:
      return '실패'
  }
})

/** 실패나 '다시 확인' 이 하나라도 있으면 완료라도 초록으로 보여 주지 않는다. */
const tone = computed(() => {
  if (props.job.state === 'running') return 'running'
  if (props.job.failed > 0 || props.job.unresolved > 0) return 'partial'
  if (props.job.state === 'cancelled') return 'cancelled'
  return 'ok'
})

/**
 * 끝난 뒤 한 줄로 답한다 — "정리가 된 건가?"
 *
 * 예전에는 건너뛴 것이 전부 '건너뜀' 한 덩어리라, 손댈 필요가 없어서 지나간 것까지
 * 미처리로 읽혔다. 다시 봐야 하는 것은 unresolved 와 failed 둘뿐이다.
 */
const leftover = computed(() => props.job.unresolved + props.job.failed)

const verdict = computed(() => {
  if (props.job.state === 'running') return ''
  if (props.job.state === 'cancelled') {
    return leftover.value > 0
      ? `취소했습니다. 결과를 모르는 것이 ${leftover.value.toLocaleString()}건 있습니다 — 다시 조회해서 확인하세요.`
      : '취소했습니다. 시작한 건은 모두 결과가 확인됐습니다.'
  }
  if (leftover.value === 0) return '정리 끝 — 다시 볼 것이 없습니다.'
  const bits = []
  if (props.job.unresolved) bits.push(`판단하지 못한 것 ${props.job.unresolved.toLocaleString()}건`)
  if (props.job.failed) bits.push(`실패 ${props.job.failed.toLocaleString()}건`)
  return `${bits.join(' · ')} — 다시 조회한 뒤 한 번 더 돌리세요.`
})

const CAT_LABEL: Record<string, string> = {
  settled: '이미 정리됨',
  excluded: '대상 아님',
  unresolved: '다시 확인',
}

/** 건너뛴 이유를 갈래로 묶는다. 갈래가 없는 옛 기록은 '다시 확인' 으로 본다. */
const skipGroups = computed(() => {
  const by: Record<string, { ri: string; reason: string }[]> = {}
  for (const s of props.job.skips) {
    const k = s.category ?? 'unresolved'
    ;(by[k] ||= []).push(s)
  }
  return (['unresolved', 'excluded', 'settled'] as const)
    .filter((k) => by[k]?.length)
    .map((k) => ({ key: k, label: CAT_LABEL[k], rows: by[k] }))
})
</script>

<template>
  <div class="job" :class="tone">
    <div class="head">
      <strong>{{ job.title }}</strong>
      <span class="state">{{ stateLabel }}</span>
      <span class="spacer" />
      <button v-if="job.state === 'running' && !job.cancelRequested" @click="emit('cancel')">
        취소
      </button>
      <button v-if="job.state !== 'running'" @click="emit('dismiss')">닫기</button>
    </div>

    <div class="bar" :aria-valuenow="pct" role="progressbar" aria-valuemin="0" aria-valuemax="100">
      <div class="fill" :style="{ width: pct + '%' }" />
    </div>

    <div class="counts">
      <span class="c">{{ job.processed.toLocaleString() }} / {{ job.total.toLocaleString() }}</span>
      <span class="c ok" v-if="job.ok">처리 {{ job.ok.toLocaleString() }}</span>
      <span class="c done" v-if="job.settled">이미 정리됨 {{ job.settled.toLocaleString() }}</span>
      <span class="c skip" v-if="job.excluded">대상 아님 {{ job.excluded.toLocaleString() }}</span>
      <span class="c warn" v-if="job.unresolved">다시 확인 {{ job.unresolved.toLocaleString() }}</span>
      <span class="c fail" v-if="job.failed">실패 {{ job.failed.toLocaleString() }}</span>
    </div>

    <!-- "정리가 된 건가?" 에 한 줄로 답한다. 숫자만 늘어놓으면 관리자가 그 판단을
         직접 해야 하고, 그러면 손댈 필요 없던 것까지 미처리로 읽는다. -->
    <p v-if="verdict" class="verdict" :class="leftover ? 'left' : 'clear'">{{ verdict }}</p>

    <p v-if="job.note" class="note">{{ job.note }}</p>
    <p v-if="error" class="err">{{ error }}</p>

    <!-- 건너뛴 이유는 판단 재료다. "왜 3건만 지워졌지?" 에 답하지 못하면
         관리자는 목록을 믿지 못하게 된다. 갈래 순서는 다시 볼 것이 맨 위다. -->
    <details v-if="job.skips.length" class="detail">
      <summary>지우지 않은 것 ({{ job.skipped.toLocaleString() }}건)</summary>
      <template v-for="g in skipGroups" :key="g.key">
        <p class="grp" :class="g.key">{{ g.label }} {{ g.rows.length.toLocaleString() }}건</p>
        <ul>
          <li v-for="s in g.rows" :key="s.ri">
            <code>{{ s.ri }}</code> — {{ s.reason }}
          </li>
        </ul>
      </template>
      <p v-if="job.skipsTruncated" class="trunc">
        상세는 {{ job.skips.length }}건까지만 보관합니다. 개수는 위가 전부입니다.
      </p>
    </details>

    <details v-if="job.failures.length" class="detail fail" open>
      <summary>실패 ({{ job.failed.toLocaleString() }}건)</summary>
      <ul>
        <li v-for="f in job.failures" :key="f.ri">
          <code>{{ f.ri }}</code> — {{ f.reason }}
        </li>
      </ul>
      <p v-if="job.failuresTruncated" class="trunc">
        상세는 {{ job.failures.length }}건까지만 보관합니다. 개수는 위가 전부입니다.
      </p>
    </details>

    <p v-if="job.state !== 'running' && job.ok > 0" class="after">
      Mobius 는 삭제 요청에 곧바로 응답하고 하위 리소스는 배경에서 지웁니다.
      큰 서브트리를 지웠다면 목록에서 사라진 뒤에도 정리가 잠시 더 이어집니다.
    </p>
  </div>
</template>

<style scoped>
.job {
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 0 12px 12px 0;
  box-shadow: var(--shadow);
  padding: 1rem 1.2rem;
  margin: 1.2rem 0;
}
.job.partial { border-left-color: var(--danger); }
.job.ok { border-left-color: var(--ok); }
.job.cancelled { border-left-color: var(--warn); }

.head { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.7rem; }
.head strong { color: var(--text-strong); }
.state { font-size: 0.88rem; color: var(--muted); }
.spacer { flex: 1; }

.bar {
  height: 8px;
  background: var(--accent-wash);
  border-radius: 999px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.job.partial .fill { background: var(--danger); }
.job.ok .fill { background: var(--ok); }
.job.cancelled .fill { background: var(--warn); }

.counts {
  display: flex;
  gap: 1rem;
  margin-top: 0.6rem;
  font-size: 0.92rem;
  font-variant-numeric: tabular-nums;
}
.counts .c { color: var(--muted); }
.counts .ok { color: var(--ok); font-weight: 600; }
/* 갈래마다 색이 곧 뜻이다 — 정리된 것과 남겨 둔 것은 경고색을 쓰지 않는다. */
.counts .done { color: var(--ok); }
.counts .skip { color: var(--muted); }
.counts .warn { color: var(--warn); font-weight: 600; }
.counts .fail { color: var(--danger); font-weight: 600; }

.verdict { margin: 0.6rem 0 0; font-size: 0.95rem; font-weight: 600; }
.verdict.clear { color: var(--ok); }
.verdict.left { color: var(--warn); }

.grp { margin: 0.7rem 0 0.2rem; font-size: 0.9rem; font-weight: 600; color: var(--muted); }
.grp.unresolved { color: var(--warn); }
.grp.settled { color: var(--ok); }

.note { margin: 0.7rem 0 0; font-size: 0.9rem; color: var(--muted); max-width: 80ch; }
.err { margin: 0.6rem 0 0; font-size: 0.92rem; color: var(--danger); }
.after { margin: 0.8rem 0 0; font-size: 0.88rem; color: var(--muted); max-width: 80ch; }

.detail { margin-top: 0.8rem; font-size: 0.92rem; }
.detail summary { cursor: pointer; color: var(--muted); }
.detail.fail summary { color: var(--danger); font-weight: 600; }
.detail ul {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  max-height: 220px;
  overflow: auto;
}
.detail li { margin-bottom: 0.25rem; overflow-wrap: anywhere; }
.trunc { color: var(--muted); font-size: 0.88rem; margin: 0.4rem 0 0; }
</style>
