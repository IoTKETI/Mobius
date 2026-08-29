<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { session, login, logout, AuthError } from './api'
import ExpiredView from './views/ExpiredView.vue'

const authed = ref(false)
const backend = ref('')
const password = ref('')
const loginError = ref('')
const busy = ref(false)

async function probe() {
  try {
    const s = await session()
    authed.value = s.ok
    backend.value = s.backend
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
      <p class="muted">조회 전용입니다. 삭제·수정 기능은 아직 없습니다.</p>
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
      <span class="pill">{{ backend }}</span>
      <span class="pill readonly">조회 전용</span>
      <span class="spacer" />
      <button @click="doLogout">로그아웃</button>
    </header>
    <main>
      <ExpiredView />
    </main>
  </template>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
}
.login {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.6rem;
  width: min(360px, 100%);
  display: grid;
  gap: 0.7rem;
}
.login h1 { margin: 0; font-size: 1.1rem; }
.muted { color: var(--muted); margin: 0; font-size: 0.85rem; }
.err { color: var(--danger); margin: 0; font-size: 0.85rem; }

header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 1rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 5;
}
.spacer { flex: 1; }
.pill {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
}
.pill.readonly { border-color: var(--ok); color: var(--ok); }
main { padding: 1rem; max-width: 1400px; margin: 0 auto; }
</style>
