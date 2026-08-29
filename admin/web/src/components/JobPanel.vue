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

/** 실패가 하나라도 있으면 완료라도 초록으로 보여 주지 않는다. */
const tone = computed(() => {
  if (props.job.state === 'running') return 'running'
  if (props.job.failed > 0) return 'partial'
  if (props.job.state === 'cancelled') return 'cancelled'
  return 'ok'
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
      <span class="c skip" v-if="job.skipped">건너뜀 {{ job.skipped.toLocaleString() }}</span>
      <span class="c fail" v-if="job.failed">실패 {{ job.failed.toLocaleString() }}</span>
    </div>

    <p v-if="job.note" class="note">{{ job.note }}</p>
    <p v-if="error" class="err">{{ error }}</p>

    <!-- 건너뛴 이유는 판단 재료다. "왜 3건만 지워졌지?" 에 답하지 못하면
         관리자는 목록을 믿지 못하게 된다. -->
    <details v-if="job.skips.length" class="detail">
      <summary>건너뛴 이유 ({{ job.skipped.toLocaleString() }}건)</summary>
      <ul>
        <li v-for="s in job.skips" :key="s.ri">
          <code>{{ s.ri }}</code> — {{ s.reason }}
        </li>
      </ul>
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
.counts .skip { color: var(--warn); font-weight: 600; }
.counts .fail { color: var(--danger); font-weight: 600; }

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
