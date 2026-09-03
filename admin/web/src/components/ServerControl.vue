<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { serverStatus, serverStart, serverStop, serverRestart } from '../api'
import type { ServerStatus } from '../types'

const emit = defineEmits<{ changed: [] }>()

const st = ref<ServerStatus | null>(null)
const busy = ref('')
const error = ref('')
const note = ref('')
const confirming = ref<'stop' | 'restart' | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

async function refresh() {
  try {
    st.value = await serverStatus()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function act(kind: 'start' | 'stop' | 'restart') {
  busy.value = kind
  error.value = ''
  note.value = ''
  confirming.value = null
  try {
    const fn = kind === 'start' ? serverStart : kind === 'stop' ? serverStop : serverRestart
    const r = await fn()
    note.value =
      kind === 'start' ? `기동했습니다 (pid ${r.pid ?? '?'})`
      : kind === 'stop' ? '정지했습니다.'
      : '재기동했습니다.'
    if (r.warning) note.value += ` — ${r.warning}`
    emit('changed')
  } catch (e) {
    const anyE = e as { message?: string; job?: { title: string } }
    error.value = anyE.job
      ? `${anyE.message} — ${anyE.job.title}`
      : (anyE.message ?? String(e))
  } finally {
    busy.value = ''
    await refresh()
  }
}

onMounted(() => {
  refresh()
  // 기동·정지는 몇 초가 걸린다. 눌러 놓고 기다리는 동안 상태가 따라오게 한다.
  timer = setInterval(refresh, 4000)
})
onUnmounted(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<template>
  <div class="ctl" :class="{ up: st?.running, down: st && !st.running }">
    <div class="row">
      <span class="dot" :class="{ on: st?.running }" />
      <strong v-if="!st">확인 중…</strong>
      <strong v-else-if="st.running">Mobius 가 돌고 있습니다</strong>
      <strong v-else>Mobius 가 내려가 있습니다</strong>

      <code v-if="st" class="addr mono">:{{ st.port }}</code>
      <span v-if="st?.mode === 'pm2'" class="pill">pm2 · {{ st.pm2Name }}</span>
      <span v-else-if="st?.ours" class="pill">이 콘솔이 기동 · pid {{ st.pid }}</span>

      <span class="spacer" />

      <button v-if="st && !st.running" :disabled="!!busy" @click="act('start')">
        {{ busy === 'start' ? '기동 중…' : '기동' }}
      </button>
      <template v-if="st?.running">
        <button :disabled="!!busy" @click="confirming = 'restart'">재기동</button>
        <button class="danger" :disabled="!!busy" @click="confirming = 'stop'">정지</button>
      </template>
    </div>

    <!-- 포트는 열렸는데 이 콘솔이 띄운 것이 아니다. 남의 프로세스는 안 건드린다. -->
    <p v-if="st?.foreign" class="foreign">
      포트가 열려 있지만 <strong>이 콘솔이 기동한 프로세스가 아닙니다.</strong>
      정지·재기동은 띄운 쪽에서 해야 합니다 — 포트를 쥔 프로세스를 찾아 죽이지는 않습니다.
    </p>

    <p v-if="st?.busyJob" class="busyjob">
      일괄 작업이 도는 중입니다 — <strong>{{ st.busyJob.title }}</strong>
      ({{ st.busyJob.processed }}/{{ st.busyJob.total }}). 정지·재기동은 막혀 있습니다.
    </p>

    <p v-if="note" class="ok">{{ note }}</p>
    <p v-if="error" class="err">{{ error }}</p>

    <!-- 되돌릴 수 없는 쪽은 한 번 더 묻는다. -->
    <div v-if="confirming" class="confirm">
      <template v-if="confirming === 'stop'">
        <strong>Mobius 를 정지합니다.</strong>
        <p>
          정지하면 <strong>아무도 자동으로 되살리지 않습니다.</strong>
          이 CSE 를 쓰는 장치와 애플리케이션의 요청이 전부 실패합니다.
          다시 띄우려면 이 화면에서 기동하거나 서버에서 직접 실행해야 합니다.
        </p>
      </template>
      <template v-else>
        <strong>Mobius 를 재기동합니다.</strong>
        <p>
          내렸다가 다시 띄웁니다. 그동안의 요청은 실패합니다.
          <code>conf.json</code> 에 저장한 설정이 이때 반영됩니다.
        </p>
      </template>
      <div class="cbtns">
        <button @click="confirming = null">그만두기</button>
        <button class="danger" @click="act(confirming)">
          {{ confirming === 'stop' ? '정지합니다' : '재기동합니다' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ctl {
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  border-radius: 0 11px 11px 0;
  background: var(--panel);
  padding: 0.85rem 1.1rem;
  margin-bottom: 1.2rem;
  max-width: 92ch;
}
.ctl.up { border-left-color: var(--ok); }
.ctl.down { border-left-color: var(--danger); }

.row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.row strong { color: var(--text-strong); }
.spacer { flex: 1; }
.dot {
  width: 0.6rem; height: 0.6rem; border-radius: 50%;
  background: var(--danger); flex: none;
}
.dot.on { background: var(--ok); }
.addr { color: var(--muted); font-size: 0.9rem; }
.pill {
  font-size: 0.78rem; color: var(--muted);
  border: 1px solid var(--border); border-radius: 999px; padding: 0.05rem 0.5rem;
}
.danger { background: var(--danger); border-color: var(--danger); color: #fff; font-weight: 600; }

.foreign, .busyjob { margin: 0.6rem 0 0; font-size: 0.92rem; color: var(--warn); }
.ok { margin: 0.6rem 0 0; font-size: 0.93rem; color: var(--ok); }
.err { margin: 0.6rem 0 0; font-size: 0.93rem; color: var(--danger); }

.confirm {
  margin-top: 0.8rem;
  padding: 0.85rem 1rem;
  background: var(--danger-wash);
  border-radius: 8px;
  font-size: 0.95rem;
}
.confirm p { margin: 0.4rem 0 0; }
.cbtns { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.8rem; }
</style>
