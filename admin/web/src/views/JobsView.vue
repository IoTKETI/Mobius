<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { jobList, cancelJob } from '../api'
import type { Job } from '../types'
import JobPanel from '../components/JobPanel.vue'

/**
 * 최근 작업. 메모리에만 있어 콘솔을 재시작하면 사라진다 — 화면에 그렇게 적는다.
 * 도는 작업이 있으면 1초마다 다시 읽는다.
 */
const jobs = ref<Job[]>([])
const error = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

async function load() {
  try {
    jobs.value = (await jobList()).jobs
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  if (timer !== null) clearTimeout(timer)
  timer = jobs.value.some((j) => j.state === 'running') ? setTimeout(load, 1000) : null
}

async function cancel(j: Job) {
  try {
    await cancelJob(j.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

const KIND_LABEL: Record<string, string> = {
  'expired-delete': '만료 삭제',
  'expired-extend': 'et 연장',
  'orphan-delete': '고아 삭제',
  'orphan-scan': '고아 탐지',
  'sub-delete': '구독 삭제',
  selftest: '종합 테스트',
}

onMounted(load)
onUnmounted(() => { if (timer !== null) clearTimeout(timer) })
</script>

<template>
  <section>
    <h2>작업</h2>
    <p class="lead">
      콘솔이 돌린 일괄 작업입니다. 한 번에 하나만 돕니다. 기록은 메모리에만 있어
      콘솔을 재시작하면 사라집니다 — 이미 지운 것이 되살아나지는 않습니다.
    </p>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!jobs.length" class="empty">작업이 없습니다.</p>
    <div v-for="j in jobs" :key="j.id" class="row">
      <div class="kind">{{ KIND_LABEL[j.kind] ?? j.kind }}</div>
      <JobPanel :job="j" @cancel="cancel(j)" @dismiss="() => {}" />
    </div>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 74ch; }
.err { color: var(--danger); }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; }
.row { margin-bottom: 1rem; }
.kind { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; margin-bottom: 0.3rem; }
</style>
