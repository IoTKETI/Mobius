import { ref, onUnmounted } from 'vue'
import { getJob, cancelJob, runningJob, BusyError } from './api'
import type { Job } from './types'

const POLL_MS = 700

/**
 * 일괄 작업 하나를 붙잡고 끝날 때까지 폴링한다.
 *
 * 서버는 한 번에 한 작업만 돌리므로 이 훅도 하나만 쥔다. 두 화면(만료·고아)이
 * 각자 쓰지만, 화면을 옮기면 attach() 가 도는 작업을 다시 찾아 붙는다 —
 * 삭제를 걸어 두고 탭을 옮겼다가 돌아왔을 때 진행 상황을 잃지 않는다.
 */
/**
 * @param onDone 작업이 끝났을 때 부른다. 목록을 다시 읽는 자리다.
 *   **시작 직후가 아니라 여기서 읽어야 한다** — start() 는 작업이 만들어진
 *   시점(202)에 돌아오므로, 그때 읽으면 삭제가 도는 중의 목록을 찍는다.
 */
export function useJobRunner(onDone?: (job: Job) => void) {
  const job = ref<Job | null>(null)
  const error = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  function stopPolling() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function settle(j: Job) {
    timer = null
    onDone?.(j)
  }

  async function tick(id: string) {
    try {
      const j = await getJob(id)
      job.value = j
      if (j.state === 'running') {
        timer = setTimeout(() => tick(id), POLL_MS)
        return
      }
      return settle(j)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    timer = null
  }

  function watch(j: Job) {
    stopPolling()
    error.value = ''
    job.value = j
    if (j.state === 'running') timer = setTimeout(() => tick(j.id), POLL_MS)
    // 붙자마자 이미 끝나 있는 경우(대상이 적어 즉시 끝났거나, 다른 화면에서
    // 시작한 작업이 그사이 끝난 경우)도 완료로 다룬다.
    else settle(j)
  }

  /**
   * 작업을 시작한다. 이미 도는 작업이 있으면 거절 대신 **그 작업에 붙는다** —
   * 관리자에게 필요한 것은 에러 메시지가 아니라 "지금 무엇이 돌고 있는가" 다.
   */
  async function start(fn: () => Promise<Job>): Promise<boolean> {
    error.value = ''
    try {
      watch(await fn())
      return true
    } catch (e) {
      if (e instanceof BusyError) {
        if (e.active) watch(e.active)
        error.value = e.message
        return false
      }
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  /** 화면에 들어올 때 호출한다. 다른 화면에서 시작한 작업이 돌고 있으면 붙는다. */
  async function attach() {
    try {
      const j = await runningJob()
      if (j) watch(j)
    } catch {
      /* 붙기 실패는 조용히 넘긴다 — 조회를 막을 이유가 없다 */
    }
  }

  async function cancel() {
    if (!job.value) return
    try {
      job.value = await cancelJob(job.value.id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function dismiss() {
    stopPolling()
    job.value = null
    error.value = ''
  }

  onUnmounted(stopPolling)

  return { job, error, start, attach, cancel, dismiss }
}
