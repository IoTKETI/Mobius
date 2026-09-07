import { ref, onUnmounted } from 'vue'
import { getJob, cancelJob, runningJob, BusyError } from './api'
import type { Job } from './types'

const POLL_MS = 700

/**
 * Holds one batch job and polls until it ends.
 *
 * The server runs one job at a time, so this hook holds one. Both screens (expired, orphans) use it, and attach() re-finds a running job when the screen changes, so progress is not lost when leaving and returning.
 */
/** @param onDone called when the job ends; the place to re-read the list. Read here, not right after start(): start() returns when the job is created (202), and reading then shows the list while the delete is running. */
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
    // A job that is already finished on attach (few targets, or a job started from another screen that ended meanwhile) is treated as completed too.
    else settle(j)
  }

  /** Starts a job. When a job is already running, attaches to it instead of refusing: what the administrator needs is not an error but 'what is running now'. */
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

  /** Called when entering the screen; attaches to a job started from another screen if one is running. */
  async function attach() {
    try {
      const j = await runningJob()
      if (j) watch(j)
    } catch {
      /* an attach failure is ignored; it must not block reading */
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
