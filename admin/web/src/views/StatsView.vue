<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { statsHit, statsTotalAe, statsTotalCbs } from '../api'
import type { HitRow } from '../types'
import BarChart from '../components/BarChart.vue'

/**
 * 코어의 /hit · /total_ae · /total_cbs 가 보여 주던 것. 그 경로는 인증 없이 외부에
 * 열려 있어 코어에서 걷어냈고(인수인계 §7), 이제 세션 뒤의 이 화면이 유일한 창이다.
 */
const rows = ref<HitRow[]>([])
const asOf = ref('')
const totalAe = ref<number | null>(null)
const totalCbs = ref<number | null>(null)
const error = ref('')
const loading = ref(false)

const DAYS = 30
const recent = computed(() => {
  const byDay = new Map(rows.value.map((r) => [r.ct, r]))
  const out: { label: string; value: number }[] = []
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const key = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    const r = byDay.get(key)
    out.push({ label: key.slice(4, 6) + '/' + key.slice(6, 8), value: r ? (r.http || 0) + (r.mqtt || 0) + (r.coap || 0) + (r.ws || 0) : 0 })
  }
  return out
})

const table = computed(() => [...rows.value].sort((a, b) => (a.ct < b.ct ? 1 : -1)).slice(0, DAYS))

/** 바이트를 KB·MB·GB 로(1024 단위). 1 KB 미만만 B 그대로. */
function bytes(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n.toLocaleString() + ' B'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [h, a, c] = await Promise.all([statsHit(), statsTotalAe(), statsTotalCbs()])
    rows.value = h.rows
    asOf.value = h.asOf
    totalAe.value = a.total
    totalCbs.value = c.total
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
    <h2>통계</h2>
    <p class="lead">일별 호출 건수와 등록된 AE 수, 데이터 크기를 표시합니다.</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="tiles">
      <div class="tile"><div class="k">AE</div><div class="v">{{ totalAe === null ? '—' : totalAe.toLocaleString() }}</div><div class="s">등록된 AE 수</div></div>
      <div class="tile"><div class="k">데이터 크기</div><div class="v">{{ bytes(totalCbs) }}</div><div class="s">컨테이너 cbs 의 합 (CIN 바이트)</div></div>
      <div class="tile"><div class="k">오늘 호출</div><div class="v">{{ recent.length ? recent[recent.length - 1].value.toLocaleString() : '—' }}</div><div class="s">UTC 기준</div></div>
    </div>

    <div class="panel">
      <h3>최근 {{ DAYS }}일 호출</h3>
      <!-- 폭은 패널을 그대로 채운다. viewBox 높이만 낮춰 세로를 줄인다(폭 640 은 그대로라
           같은 폭에서 그래프가 더 납작해진다). -->
      <BarChart :values="recent" :height="110" />
    </div>

    <div v-if="table.length" class="table-wrap">
      <table>
        <thead><tr><th class="c">날짜 (UTC)</th><th class="c">HTTP</th><th class="c">MQTT</th><th class="c">CoAP</th><th class="c">WS</th></tr></thead>
        <tbody>
          <tr v-for="r in table" :key="r.ct">
            <td class="c mono">{{ r.ct }}</td>
            <td class="c num">{{ (r.http || 0).toLocaleString() }}</td>
            <td class="c num">{{ (r.mqtt || 0).toLocaleString() }}</td>
            <td class="c num">{{ (r.coap || 0).toLocaleString() }}</td>
            <td class="c num">{{ (r.ws || 0).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="footer">
      <button :disabled="loading" @click="load">{{ loading ? '읽는 중…' : '다시 읽기' }}</button>
      <span class="muted">{{ asOf }}</span>
    </div>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 74ch; }
.err { color: var(--danger); }
.muted { color: var(--muted); font-size: 0.92rem; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.9rem; }
.tile { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; }
.tile .k { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
.tile .v { font-size: 2.1rem; font-weight: 650; line-height: 1.25; letter-spacing: -0.02em; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.tile .s { font-size: 0.88rem; color: var(--muted); }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; margin: 1.2rem 0; }
.table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: auto; max-height: 50vh; }
/* 헤더와 값이 서로 다른 정렬로 틀어져 보였다 — 전부 중앙 (사용자 결정 2026-09-07). */
.table-wrap th.c, .table-wrap td.c { text-align: center; }
.num { font-variant-numeric: tabular-nums; }
.footer { display: flex; align-items: center; gap: 1rem; padding: 1rem 0; }
</style>
