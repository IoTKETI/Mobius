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

    <div v-if="rows.length" class="table-wrap">
      <table>
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
    </div>

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
h2 {
  margin: 0 0 0.4rem;
  font-size: 1.6rem;
  letter-spacing: -0.02em;
  color: var(--text-strong);
}
.lead { margin: 0 0 1.5rem; color: var(--muted); font-size: 1.02rem; max-width: 72ch; }
.note { color: var(--muted); font-size: 0.92rem; margin: 0.7rem 0 0; max-width: 72ch; }
.err { color: var(--danger); font-size: 1rem; }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; font-size: 1.05rem; }

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.9rem;
}
.tile {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 1rem 1.1rem;
}
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
.tile .s { font-size: 0.88rem; color: var(--muted); }
.tile .s.never { color: var(--warn); font-weight: 600; }
.tile .s.risky { color: var(--danger); font-weight: 600; }

.filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 1.8rem 0 0.9rem;
}
.flabel {
  font-size: 0.85rem;
  color: var(--muted);
  margin-right: 0.3rem;
  font-weight: 600;
}
.filters button { padding: 0.35rem 0.85rem; font-size: 0.92rem; border-radius: 999px; }
.filters button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.filters .cnt { opacity: 0.75; font-size: 0.92em; }
.filters .clear { border-style: dashed; }

/* 표 자체가 이 화면의 본체다. 패널로 감싸 바탕에서 띄운다. */
.table-wrap {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: auto;
  max-height: 68vh;
}

.path { max-width: 560px; overflow-wrap: anywhere; font-size: 0.95rem; }
.ty {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid var(--accent);
  color: var(--accent-strong);
  background: var(--accent-wash);
  border-radius: 5px;
  padding: 0.1rem 0.45rem;
  white-space: nowrap;
}
.days { white-space: nowrap; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.fate { font-size: 0.88rem; white-space: nowrap; }
.fate.never { color: var(--warn); font-weight: 600; }
.fate.risky { color: var(--danger); font-weight: 600; }
.fate.manual { color: var(--muted); }

.footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem 0;
  font-size: 0.95rem;
}
.next {
  margin-top: 1.5rem;
  padding: 1rem 1.2rem;
  border-left: 3px solid var(--accent);
  background: var(--accent-wash);
  border-radius: 0 8px 8px 0;
  color: var(--text);
  font-size: 0.95rem;
  max-width: 78ch;
}
</style>
