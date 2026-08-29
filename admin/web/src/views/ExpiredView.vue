<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { expiredSummary, expiredPage, fmtTime, daysSince } from '../api'
import { NEVER_AUTO_DELETED, AUTO_DELETED_RISKY } from '../types'
import type { ExpiredRow, ExpiredSummary } from '../types'

const summary = ref<ExpiredSummary | null>(null)
const rows = ref<ExpiredRow[]>([])
const asOf = ref('')
const more = ref(false)
const nextEt = ref<string | null>(null)
const nextRi = ref<string | null>(null)
const loading = ref(false)
const error = ref('')
const selectedTypes = ref<number[]>([])

const PAGE = 50

function typeLabel(ty: number): string {
  // responder.typeRsrc 는 { "2": "ae", "4": "cin", ... } 처럼 접두어 없는
  // 짧은 이름을 준다. 다른 경로에서 'm2m:ae' 형태로 올 수도 있어 둘 다 받는다.
  const raw = summary.value?.typeNames?.[String(ty)] ?? ''
  if (!raw) return `ty${ty}`
  const bare = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
  return bare.toUpperCase()
}

/** 이 타입이 자동 정리에서 어떻게 다뤄지는지 — 삭제 판단의 핵심 신호다. */
function fate(ty: number): { text: string; cls: string } {
  if (NEVER_AUTO_DELETED.has(ty)) return { text: '자동 삭제 안 됨', cls: 'never' }
  if (AUTO_DELETED_RISKY.has(ty)) return { text: '만료 시 자동 삭제', cls: 'risky' }
  return { text: '수동 정리 대상', cls: 'manual' }
}

const typeChips = computed(() => {
  const bt = summary.value?.byType ?? {}
  return Object.keys(bt)
    .map(Number)
    .sort((a, b) => bt[String(b)] - bt[String(a)])
    .map((ty) => ({ ty, n: bt[String(ty)], label: typeLabel(ty), fate: fate(ty) }))
})

async function loadSummary() {
  try {
    summary.value = await expiredSummary(5000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadFirst() {
  loading.value = true
  error.value = ''
  try {
    const p = await expiredPage({ limit: PAGE, types: selectedTypes.value })
    rows.value = p.rows
    asOf.value = p.asOf
    more.value = p.more
    nextEt.value = p.nextEt
    nextRi.value = p.nextRi
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!more.value || loading.value) return
  loading.value = true
  try {
    const p = await expiredPage({
      limit: PAGE,
      types: selectedTypes.value,
      afterEt: nextEt.value,
      afterRi: nextRi.value,
    })
    rows.value = rows.value.concat(p.rows)
    more.value = p.more
    nextEt.value = p.nextEt
    nextRi.value = p.nextRi
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function toggleType(ty: number) {
  const i = selectedTypes.value.indexOf(ty)
  if (i >= 0) selectedTypes.value.splice(i, 1)
  else selectedTypes.value.push(ty)
  loadFirst()
}

onMounted(async () => {
  await loadSummary()
  await loadFirst()
})
</script>

<template>
  <section>
    <h2>만료된 리소스</h2>
    <p class="lead">
      <code>et</code>(expirationTime)가 이미 지난 리소스입니다. 만료 스윕은
      <strong>주기 실행이 걸려 있지 않아</strong> 이 목록은 저절로 줄어들지 않습니다.
    </p>

    <div v-if="summary" class="tiles">
      <div class="tile">
        <div class="k">확인된 만료 리소스</div>
        <div class="v">
          {{ summary.counted.toLocaleString() }}<span v-if="summary.capped">+</span>
        </div>
        <div class="s" v-if="summary.capped">
          {{ summary.cap.toLocaleString() }}건에서 세기를 멈췄습니다 — 실제로는 더 많습니다
        </div>
        <div class="s" v-else>전수 확인</div>
      </div>
      <div class="tile" v-for="c in typeChips.slice(0, 4)" :key="c.ty">
        <div class="k">{{ c.label }}</div>
        <div class="v">{{ c.n.toLocaleString() }}</div>
        <div class="s" :class="c.fate.cls">{{ c.fate.text }}</div>
      </div>
    </div>

    <p v-if="summary?.capped" class="note">
      전체 건수를 세지 않습니다. 배포의 <code>lookup</code> 은 5,740만 행이고 MySQL 에는
      <code>et</code> 인덱스가 없어, 끝까지 세면 풀스캔이 됩니다.
    </p>

    <div class="filters">
      <span class="flabel">타입 필터</span>
      <button
        v-for="c in typeChips"
        :key="c.ty"
        :class="{ on: selectedTypes.includes(c.ty) }"
        @click="toggleType(c.ty)"
      >
        {{ c.label }} <span class="cnt">{{ c.n }}</span>
      </button>
      <button v-if="selectedTypes.length" class="clear" @click="selectedTypes = []; loadFirst()">
        전체 보기
      </button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <table v-if="rows.length">
      <thead>
        <tr>
          <th>경로 (ri)</th>
          <th>타입</th>
          <th>만료 (et)</th>
          <th>경과</th>
          <th>생성 (ct)</th>
          <th>자동 정리</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.ri">
          <td class="mono path">{{ r.ri }}</td>
          <td><span class="ty">{{ typeLabel(r.ty) }}</span></td>
          <td class="mono">{{ fmtTime(r.et) }}</td>
          <td class="mono days">
            <template v-if="daysSince(r.et, asOf) !== null">
              {{ daysSince(r.et, asOf)!.toLocaleString() }}일
            </template>
            <template v-else>—</template>
          </td>
          <td class="mono muted">{{ fmtTime(r.ct) }}</td>
          <td>
            <span class="fate" :class="fate(r.ty).cls">{{ fate(r.ty).text }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-else-if="!loading" class="empty">만료된 리소스가 없습니다.</p>

    <div class="footer">
      <button v-if="more" :disabled="loading" @click="loadMore">
        {{ loading ? '불러오는 중…' : `다음 ${PAGE}건` }}
      </button>
      <span class="muted">{{ rows.length }}건 표시 중<template v-if="more"> · 더 있음</template></span>
    </div>

    <p class="next">
      다음 단계에서 선택 삭제와 <code>et</code> 연장을 붙입니다. 그 전에 워커 간 캐시 무효화가
      먼저 들어가야 합니다 — 없으면 지운 리소스를 다른 워커가 계속 <code>200</code> 으로 돌려줍니다.
    </p>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.3rem; font-size: 1.15rem; }
.lead { margin: 0 0 1rem; color: var(--muted); }
.note { color: var(--muted); font-size: 0.82rem; margin: 0.4rem 0 0; }
.err { color: var(--danger); }
.empty { color: var(--muted); padding: 2rem 0; text-align: center; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; }
.tile {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.7rem 0.8rem;
}
.tile .k { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.tile .v { font-size: 1.5rem; font-weight: 600; line-height: 1.3; }
.tile .s { font-size: 0.74rem; color: var(--muted); }
.tile .s.never { color: var(--warn); }
.tile .s.risky { color: var(--danger); }

.filters { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; margin: 1rem 0 0.6rem; }
.flabel { font-size: 0.75rem; color: var(--muted); margin-right: 0.2rem; }
.filters button { padding: 0.25rem 0.6rem; font-size: 0.82rem; }
.filters button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.filters .cnt { opacity: 0.7; font-size: 0.9em; }
.filters .clear { border-style: dashed; }

.path { max-width: 520px; overflow-wrap: anywhere; }
.ty {
  font-size: 0.72rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.05rem 0.35rem;
}
.days { white-space: nowrap; }
.muted { color: var(--muted); }
.fate { font-size: 0.74rem; }
.fate.never { color: var(--warn); }
.fate.risky { color: var(--danger); }
.fate.manual { color: var(--muted); }

.footer { display: flex; align-items: center; gap: 0.8rem; padding: 0.9rem 0; }
.next {
  margin-top: 1.2rem;
  padding-top: 0.9rem;
  border-top: 1px dashed var(--border);
  color: var(--muted);
  font-size: 0.85rem;
}
</style>
