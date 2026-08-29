<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { session, login, logout, AuthError } from './api'
import type { WriteInfo } from './types'
import ExpiredView from './views/ExpiredView.vue'
import OrphanView from './views/OrphanView.vue'

type Tab = 'expired' | 'orphans'
const TABS: { id: Tab; label: string }[] = [
  { id: 'expired', label: '만료된 리소스' },
  { id: 'orphans', label: '고아 리소스' },
]
const tab = ref<Tab>('expired')

const authed = ref(false)
const backend = ref('')
const password = ref('')
const loginError = ref('')
const busy = ref(false)

const OFFLINE: WriteInfo = { enabled: false, target: null, superuser: false }
const write = ref<WriteInfo>(OFFLINE)

async function probe() {
  try {
    const s = await session()
    authed.value = s.ok
    backend.value = s.backend
    write.value = s.write ?? OFFLINE
  } catch (e) {
    authed.value = !(e instanceof AuthError)
  }
}

async function doLogin() {
  loginError.value = ''
  busy.value = true
  try {
    await login(password.value)
    password.value = ''
    await probe()
  } catch (e) {
    loginError.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function doLogout() {
  await logout()
  authed.value = false
}

onMounted(probe)
</script>

<template>
  <div v-if="!authed" class="login-wrap">
    <form class="login" @submit.prevent="doLogin">
      <h1>Mobius 관리 콘솔</h1>
      <p class="muted">만료·고아 리소스를 확인하고 정리합니다.</p>
      <input
        v-model="password"
        type="password"
        placeholder="관리자 비밀번호"
        autocomplete="current-password"
        autofocus
      />
      <button class="primary" type="submit" :disabled="busy || !password">
        {{ busy ? '확인 중…' : '로그인' }}
      </button>
      <p v-if="loginError" class="err">{{ loginError }}</p>
    </form>
  </div>

  <template v-else>
    <header>
      <strong>Mobius 관리 콘솔</strong>
      <nav>
        <button
          v-for="t in TABS"
          :key="t.id"
          class="tab"
          :class="{ on: tab === t.id }"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </nav>
      <span class="spacer" />
      <span class="pill">{{ backend }}</span>
      <!-- 콘솔이 무엇을 할 수 있는 상태인지 항상 보이게 둔다. superuser 로 붙어
           있다면 ACP 를 전부 통과한다는 뜻이라 숨기지 않는다. -->
      <span v-if="!write.enabled" class="pill readonly">조회 전용</span>
      <span v-else-if="write.superuser" class="pill super" :title="`쓰기 대상 ${write.target}`">
        쓰기 · superuser
      </span>
      <span v-else class="pill write" :title="`쓰기 대상 ${write.target}`">쓰기</span>
      <button @click="doLogout">로그아웃</button>
    </header>
    <main>
      <!-- 탭을 떠났다가 돌아오면 다시 읽는다. 두 화면 모두 무거운 스캔을
           하므로 캐시해 두면 낡은 숫자를 사실처럼 보여 주게 된다. -->
      <ExpiredView v-if="tab === 'expired'" :write="write" />
      <OrphanView v-else-if="tab === 'orphans'" :write="write" />
    </main>
  </template>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
}
.login {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 2.2rem;
  width: min(420px, 100%);
  display: grid;
  gap: 1rem;
}
.login h1 {
  margin: 0;
  font-size: 1.4rem;
  letter-spacing: -0.01em;
  color: var(--text-strong);
}
.muted { color: var(--muted); margin: 0; font-size: 0.95rem; }
.err { color: var(--danger); margin: 0; font-size: 0.95rem; }

header {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.9rem 1.4rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  box-shadow: var(--shadow);
  position: sticky;
  top: 0;
  z-index: 5;
}
header strong {
  font-size: 1.05rem;
  letter-spacing: -0.01em;
  color: var(--text-strong);
}
.spacer { flex: 1; }

nav { display: flex; gap: 0.25rem; margin-left: 0.6rem; }
.tab {
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  padding: 0.4rem 0.85rem;
  border-radius: 8px;
  font-size: 0.95rem;
}
.tab:hover:not(.on) { background: var(--accent-wash); color: var(--accent-strong); }
.tab.on {
  background: var(--accent-wash);
  border-color: var(--accent);
  color: var(--accent-strong);
  font-weight: 600;
}

.pill {
  font-size: 0.8rem;
  padding: 0.2rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
}
.pill.readonly { border-color: var(--ok); color: var(--ok); }
.pill.write { border-color: var(--accent); color: var(--accent-strong); }
.pill.super { border-color: var(--danger); color: var(--danger); font-weight: 600; }
main { padding: 1.6rem 1.4rem 3rem; max-width: 1500px; margin: 0 auto; }
</style>
