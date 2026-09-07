<script setup lang="ts">
import { ref, onMounted, provide } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { session, login, logout, AuthError } from './api'
import type { AcpConfig, WriteInfo } from './types'
import { GROUPS, NAV } from './router'

const route = useRoute()

const authed = ref(false)
const backend = ref('')
const password = ref('')
const loginError = ref('')
const busy = ref(false)

const OFFLINE: WriteInfo = { enabled: false, target: null, superuser: false }
const write = ref<WriteInfo>(OFFLINE)
const acpCfg = ref<AcpConfig | null>(null)
const target = ref<string | null>(null) // probe 에서 write.target 을 넣는다

async function probe() {
  try {
    const s = await session()
    authed.value = s.ok
    backend.value = s.backend
    write.value = s.write ?? OFFLINE
    acpCfg.value = s.acp ?? null
    target.value = s.write?.target ?? null
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

provide('write', write)
provide('acpCfg', acpCfg)

onMounted(probe)
</script>

<template>
  <div v-if="!authed" class="login-wrap">
    <form class="login" @submit.prevent="doLogin">
      <h1>Mobius 관리 콘솔</h1>
      <p class="muted">만료·미연결 리소스를 확인하고 정리합니다.</p>
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
    <div class="frame">
      <aside>
        <div class="brand">
          <strong>Mobius 관리 콘솔</strong>
          <span class="muted small">{{ backend }} · {{ target ?? '조회 전용' }}</span>
        </div>
        <nav>
          <template v-for="g in GROUPS" :key="g.id">
            <div class="group">{{ g.label }}</div>
            <RouterLink
              v-for="n in NAV.filter((x) => x.group === g.id)"
              :key="n.name"
              :to="{ name: n.name }"
              class="tab"
              :class="{ on: route.name === n.name || String(route.name ?? '').startsWith(n.name + '-') || (n.name === 'judge-acp-list' && ['judge-acp-edit', 'judge-acp-create', 'judge-acp-attach'].includes(String(route.name))) }"
            >
              {{ n.label }}
            </RouterLink>
          </template>
        </nav>
        <div class="foot">
          <span v-if="!write.enabled" class="pill readonly">조회 전용</span>
          <span v-else-if="write.superuser" class="pill super" :title="`쓰기 대상 ${write.target}`">쓰기 · superuser</span>
          <span v-else class="pill write" :title="`쓰기 대상 ${write.target}`">쓰기</span>
          <button @click="doLogout">로그아웃</button>
        </div>
      </aside>

      <div class="content">
        <!-- 관찰 모드는 거부를 허용으로 내보낸다. 켠 채로 잊으면 ACP 가 통째로
             무력하므로 화면 맨 위에 항상 띄운다. -->
        <div v-if="acpCfg && acpCfg.observeMode === 'observe'" class="alertbar">
          <strong>ACP 관찰 모드가 켜져 있습니다</strong> —
          <strong>ACP 평가로 난 거부가 허용으로 나갑니다</strong>.
          규칙에 안 맞아 막혔을 요청이 그대로 통과하므로, 잠그기 전 하루만 켜는 설정입니다.
          (<code>acpi</code> 가 없어 기본 정책으로 막히는 것은 그대로 막힙니다.)
          <code>conf.json</code> 의 <code>acpObserveMode</code> 를 <code>'off'</code> 로 되돌린 뒤
          Mobius 를 재기동하세요.
          <em>(콘솔이 읽은 설정값 기준입니다 — 워커의 실제 상태는 콘솔이 알 수 없습니다.)</em>
        </div>

        <main>
          <!-- write·acp 는 defineProps 로 선언한 뷰만 받는다 — 선언하지 않으면
               fallthrough attribute 로 떨어지고 무해하다. -->
          <RouterView :write="write" :acp="acpCfg" />
        </main>
      </div>
    </div>
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

.alertbar {
  background: var(--danger-wash);
  border-bottom: 1px solid var(--danger);
  color: var(--text);
  padding: 0.75rem 1.4rem;
  font-size: 0.95rem;
}
.alertbar strong { color: var(--danger); }
.alertbar em { font-style: normal; color: var(--muted); }

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

.frame { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
aside {
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 1rem 0.9rem;
  display: flex; flex-direction: column; gap: 0.6rem;
  position: sticky; top: 0; height: 100vh; overflow: auto;
}
.brand { display: grid; gap: 0.15rem; padding: 0.2rem 0.4rem 0.8rem; }
.brand strong { font-size: 1.05rem; letter-spacing: -0.01em; color: var(--text-strong); }
.small { font-size: 0.8rem; }
.muted { color: var(--muted); }
nav { display: grid; gap: 0.15rem; }
.group {
  font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em;
  font-weight: 700; margin: 0.9rem 0.4rem 0.25rem;
}
.tab {
  display: block; text-decoration: none; color: var(--muted);
  padding: 0.45rem 0.7rem; border-radius: 8px; font-size: 0.95rem; border: 1px solid transparent;
}
.tab:hover { background: var(--accent-wash); color: var(--accent-strong); }
.tab.on { background: var(--accent-wash); border-color: var(--accent); color: var(--accent-strong); font-weight: 600; }
.foot { margin-top: auto; display: grid; gap: 0.5rem; padding: 0.6rem 0.4rem 0; }
.content { min-width: 0; }
main { padding: 1.6rem 1.6rem 3rem; max-width: 1500px; }
@media (max-width: 900px) {
  .frame { grid-template-columns: 1fr; }
  aside { position: static; height: auto; }
}
</style>
