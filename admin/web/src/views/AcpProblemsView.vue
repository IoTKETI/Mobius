<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { acpLint, acpLintRefs } from '../api'
import type { AcpLintPage, AcpRefLintPage } from '../types'

const emit = defineEmits<{ open: [ri: string] }>()

const lint = ref<AcpLintPage | null>(null)
const refs = ref<AcpRefLintPage | null>(null)
const loading = ref(false)
const error = ref('')

const bodyRows = computed(() => (lint.value?.rows ?? []).filter((r) => r.problems.length))
const refRows = computed(() => (refs.value?.rows ?? []).filter((r) => r.problems.length))

const errorCount = computed(
  () => (lint.value?.counts.error ?? 0) + (refs.value?.counts.error ?? 0),
)
const warnCount = computed(() => (lint.value?.counts.warn ?? 0) + (refs.value?.counts.warn ?? 0))

function worst(problems: { severity: string }[]): string {
  return problems.some((p) => p.severity === 'error') ? 'error' : 'warn'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    // 둘은 서로 다른 것을 본다. 본문 검사는 ACP 자신이 성한가, 참조 검사는
    // 그 ACP 를 가리키는 쪽이 성한가 — 한쪽만 봐서는 "왜 안 먹는지" 를 못 찾는다.
    const [a, b] = await Promise.all([acpLint({ limit: 200 }), acpLintRefs({ maxRefs: 500 })])
    lint.value = a
    refs.value = b
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h2>권한 설정의 문제</h2>
    <p class="lead">
      가드레일은 <strong>새로 쓰는 값만</strong> 막습니다. 이미 저장된 잘못된 값은 그대로 남아
      HTTP 500 이나 조용한 거부를 계속 냅니다. 여기부터 보는 이유입니다.
    </p>

    <div class="tiles">
      <div class="tile" :class="{ hot: errorCount > 0 }">
        <div class="k">오류</div>
        <div class="v">{{ errorCount.toLocaleString() }}</div>
        <div class="s">권한이 의도대로 동작하지 않습니다</div>
      </div>
      <div class="tile">
        <div class="k">경고</div>
        <div class="v">{{ warnCount.toLocaleString() }}</div>
        <div class="s">동작은 하지만 위험합니다</div>
      </div>
      <div class="tile">
        <div class="k">정상 ACP</div>
        <div class="v">{{ (lint?.counts.clean ?? 0).toLocaleString() }}</div>
        <div class="s">본문에 문제가 없습니다</div>
      </div>
      <div class="tile">
        <div class="k">훑은 행</div>
        <div class="v">{{ (refs?.scanned ?? 0).toLocaleString() }}</div>
        <div class="s" :class="{ warn: refs?.capped }">
          {{ refs?.capped ? '훑기 상한에 걸림 — 뒤에 더 있을 수 있음' : 'CIN 을 제외한 전수' }}
        </div>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="!loading && !bodyRows.length && !refRows.length" class="empty">
      문제가 발견되지 않았습니다.
      <span v-if="refs?.capped">(훑기 상한까지는 — 뒤에 더 있을 수 있습니다)</span>
    </div>

    <template v-if="bodyRows.length">
      <h3>ACP 본문</h3>
      <p class="sub">이 ACP 자신이 성한가.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ACP</th>
              <th>문제</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in bodyRows" :key="r.ri" :class="worst(r.problems)">
              <td class="mono path">
                <button class="linkish" @click="emit('open', r.ri)">{{ r.ri }}</button>
              </td>
              <td>
                <div v-for="(p, i) in r.problems" :key="i" class="prob">
                  <span class="sev" :class="p.severity">{{
                    p.severity === 'error' ? '오류' : '경고'
                  }}</span>
                  <code class="rule">{{ p.rule }}</code>
                  <span class="msg">{{ p.message }}</span>
                  <code v-if="p.path" class="at">{{ p.path }}</code>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-if="refRows.length">
      <h3>ACP 를 가리키는 쪽</h3>
      <p class="sub">
        리소스의 <code>acpi</code> 가 성한가. <strong>없는 ACP 를 가리키면</strong>(dangling)
        그 리소스의 잠금은 조용히 풀려 생성자만 통과하는 상태가 됩니다.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>리소스</th>
              <th>acpi</th>
              <th>문제</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in refRows" :key="r.ri" :class="worst(r.problems)">
              <td class="mono path">{{ r.ri }}</td>
              <td class="mono acpi">{{ r.acpi }}</td>
              <td>
                <div v-for="(p, i) in r.problems" :key="i" class="prob">
                  <span class="sev" :class="p.severity">{{
                    p.severity === 'error' ? '오류' : '경고'
                  }}</span>
                  <code class="rule">{{ p.rule }}</code>
                  <span class="msg">{{ p.message }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div class="footer">
      <button :disabled="loading" @click="load">{{ loading ? '검사 중…' : '다시 검사' }}</button>
      <span v-if="refs?.unresolved?.length" class="muted">
        표기를 풀지 못한 항목 {{ refs.unresolved.length }}건
      </span>
    </div>
  </section>
</template>

<style scoped>
h2 {
  margin: 0 0 0.4rem;
  font-size: 1.6rem;
  letter-spacing: -0.02em;
  color: var(--text-strong);
}
h3 {
  margin: 2rem 0 0.2rem;
  font-size: 1.15rem;
  color: var(--text-strong);
}
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 74ch; }
.sub { margin: 0 0 0.8rem; color: var(--muted); font-size: 0.95rem; max-width: 78ch; }
.err { color: var(--danger); }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; font-size: 1.05rem; }

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.9rem;
}
.tile {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 1rem 1.1rem;
}
.tile.hot { border-color: var(--danger); }
.tile .k {
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 600;
}
.tile .v {
  font-size: 2.1rem;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: -0.02em;
  color: var(--text-strong);
}
.tile.hot .v { color: var(--danger); }
.tile .s { font-size: 0.86rem; color: var(--muted); }
.tile .s.warn { color: var(--warn); font-weight: 600; }

.table-wrap {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: auto;
  max-height: 55vh;
}
tr.error td:first-child { box-shadow: inset 3px 0 0 var(--danger); }
tr.warn td:first-child { box-shadow: inset 3px 0 0 var(--warn); }

.path { max-width: 420px; overflow-wrap: anywhere; font-size: 0.95rem; }
.acpi { max-width: 300px; overflow-wrap: anywhere; font-size: 0.88rem; color: var(--muted); }
.linkish {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--accent-strong);
  text-decoration: underline;
  cursor: pointer;
  text-align: left;
}
.prob { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; padding: 0.15rem 0; }
.sev {
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: 4px;
  padding: 0.05rem 0.4rem;
  white-space: nowrap;
}
.sev.error { background: var(--danger); color: #fff; }
.sev.warn { background: var(--warn); color: #fff; }
.rule { font-size: 0.85rem; color: var(--muted); }
.msg { font-size: 0.95rem; }
.at { font-size: 0.85rem; color: var(--accent-strong); }

.footer { display: flex; align-items: center; gap: 1rem; padding: 1.2rem 0; }
.muted { color: var(--muted); font-size: 0.92rem; }
</style>
