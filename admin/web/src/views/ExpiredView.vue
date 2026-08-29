<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  expiredSummary,
  expiredPage,
  fmtTime,
  daysSince,
  etAfterDays,
  startExpiredDelete,
  startExpiredExtend,
} from '../api'
import { NEVER_AUTO_DELETED, AUTO_DELETED_RISKY, ET_EXTENDABLE, UNDELETABLE } from '../types'
import type { ExpiredRow, ExpiredSummary, WriteInfo } from '../types'
import { useJobRunner } from '../job'
import JobPanel from '../components/JobPanel.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

defineProps<{ write: WriteInfo }>()

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

// ── 선택 ──────────────────────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set())
const byRi = computed(() => new Map(rows.value.map((r) => [r.ri, r])))

/** CSEBase 는 트리의 뿌리라 지울 수 없다(405-9). 고를 수도 없게 한다. */
function selectable(r: ExpiredRow): boolean {
  return !UNDELETABLE.has(r.ty)
}

function toggle(ri: string) {
  const s = new Set(selected.value)
  if (s.has(ri)) s.delete(ri)
  else s.add(ri)
  selected.value = s
}

const selectableRows = computed(() => rows.value.filter(selectable))
const allSelected = computed(
  () => selectableRows.value.length > 0 && selectableRows.value.every((r) => selected.value.has(r.ri)),
)

function toggleAll() {
  selected.value = allSelected.value
    ? new Set()
    : new Set(selectableRows.value.map((r) => r.ri))
}

const selectedList = computed(() => [...selected.value])

/** 선택 중 et 를 실제로 늘릴 수 있는 것들. CIN 은 oneM2M 상 수정이 안 된다. */
const extendable = computed(() =>
  selectedList.value.filter((ri) => {
    const ty = byRi.value.get(ri)?.ty
    return ty !== undefined && ET_EXTENDABLE.has(ty)
  }),
)

/** 지우면 하위 트리가 통째로 사라지는 선택이 섞여 있는가. */
const hasSubtree = computed(() =>
  selectedList.value.some((ri) => {
    const ty = byRi.value.get(ri)?.ty
    return ty === 2 || ty === 3
  }),
)

// ── 작업 ──────────────────────────────────────────────────────────────────
// 목록은 작업이 **끝난 뒤** 다시 읽는다. 시작 직후에 읽으면 삭제가 도는 중의
// 상태를 찍어, 이미 지운 것이 아직 남아 있는 것처럼 보인다.
const runner = useJobRunner(() => {
  void loadFirst()
  void loadSummary()
})
const confirming = ref<'delete' | 'extend' | null>(null)
const starting = ref(false)
const extendDays = ref(365)
const newEt = computed(() => etAfterDays(extendDays.value))

async function run(fn: () => Promise<import('../types').Job>) {
  starting.value = true
  const ok = await runner.start(fn)
  starting.value = false
  confirming.value = null
  if (ok) selected.value = new Set()
}

const runDelete = () => run(() => startExpiredDelete(selectedList.value))
const runExtend = () => run(() => startExpiredExtend(extendable.value, newEt.value))

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
  // 목록을 새로 읽으면 선택을 비운다. 화면에 없는 행이 선택에 남으면 타입을
  // 알 수 없어 "지울 수 있는가 / 늘릴 수 있는가" 판단이 어긋난다.
  selected.value = new Set()
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
  // 다른 화면에서 시작한 작업이 돌고 있으면 먼저 붙는다.
  void runner.attach()
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

    <JobPanel
      v-if="runner.job.value"
      :job="runner.job.value"
      :error="runner.error.value"
      @cancel="runner.cancel"
      @dismiss="runner.dismiss"
    />

    <p v-if="!write.enabled" class="note ro">
      조회 전용으로 떠 있습니다. 삭제·연장을 쓰려면 <code>conf.json</code> 에
      <code>csebaseport</code>(또는 <code>adminCsePort</code>)를 넣어 Mobius 주소를 알려 줍니다.
    </p>

    <!-- 선택이 있을 때만 나타난다. 평소에 위험한 버튼이 화면에 떠 있지 않게 한다. -->
    <div v-if="write.enabled && selected.size" class="actionbar">
      <strong>{{ selected.size.toLocaleString() }}건 선택</strong>
      <button class="link" @click="selected = new Set()">선택 해제</button>
      <span class="spacer" />

      <label class="days-pick">
        연장
        <select v-model.number="extendDays">
          <option :value="30">30일</option>
          <option :value="90">90일</option>
          <option :value="365">1년</option>
          <option :value="3650">10년</option>
        </select>
      </label>
      <button :disabled="!extendable.length" @click="confirming = 'extend'">
        et 연장 ({{ extendable.length.toLocaleString() }}건)
      </button>
      <button class="danger" @click="confirming = 'delete'">
        삭제 ({{ selected.size.toLocaleString() }}건)
      </button>
    </div>

    <div v-if="rows.length" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="cb">
              <input
                type="checkbox"
                :checked="allSelected"
                :disabled="!write.enabled || !selectableRows.length"
                aria-label="이 쪽 전체 선택"
                @change="toggleAll"
              />
            </th>
            <th>경로 (ri)</th>
            <th>타입</th>
            <th>만료 (et)</th>
            <th>경과</th>
            <th>생성 (ct)</th>
            <th>자동 정리</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.ri" :class="{ picked: selected.has(r.ri) }">
            <td class="cb">
              <input
                type="checkbox"
                :checked="selected.has(r.ri)"
                :disabled="!write.enabled || !selectable(r)"
                :title="selectable(r) ? '' : 'CSEBase 는 지울 수 없습니다'"
                :aria-label="r.ri + ' 선택'"
                @change="toggle(r.ri)"
              />
            </td>
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

    <ConfirmDialog
      v-if="confirming === 'delete'"
      title="선택한 리소스를 삭제합니다"
      :confirm-label="`${selected.size.toLocaleString()}건 삭제`"
      :paths="selectedList"
      destructive
      :busy="starting"
      @cancel="confirming = null"
      @confirm="runDelete"
    >
      <p class="dlg">
        되돌릴 수 없습니다. 삭제 직전에 <code>et</code> 를 다시 확인해서, 그사이 만료가
        풀린 것은 건너뜁니다.
      </p>
      <p v-if="hasSubtree" class="dlg warn">
        선택에 <strong>AE 또는 컨테이너</strong>가 들어 있습니다. 그 아래의 모든 리소스가
        함께 사라집니다 — 컨테이너 하나에 CIN 수백만 건이 있을 수 있습니다.
      </p>
    </ConfirmDialog>

    <ConfirmDialog
      v-if="confirming === 'extend'"
      title="만료 시각을 연장합니다"
      :confirm-label="`${extendable.length.toLocaleString()}건 연장`"
      :paths="extendable"
      :busy="starting"
      @cancel="confirming = null"
      @confirm="runExtend"
    >
      <p class="dlg">
        새 <code>et</code> 는 <strong>{{ fmtTime(newEt) }}</strong> (UTC)입니다.
      </p>
      <p v-if="extendable.length < selected.size" class="dlg warn">
        선택 {{ selected.size.toLocaleString() }}건 중
        {{ (selected.size - extendable.length).toLocaleString() }}건은 제외했습니다 —
        CIN 은 oneM2M 상 수정할 수 없습니다.
      </p>
    </ConfirmDialog>
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
.note.ro { border-left: 3px solid var(--warn); padding-left: 0.8rem; }

/* 위험한 버튼은 선택이 있을 때만 나타난다. */
.actionbar {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin: 1rem 0;
  padding: 0.8rem 1rem;
  background: var(--accent-wash);
  border: 1px solid var(--accent);
  border-radius: 10px;
}
.actionbar strong { color: var(--accent-strong); }
.actionbar .spacer { flex: 1; }
.actionbar .link {
  border: none;
  background: none;
  color: var(--muted);
  text-decoration: underline;
  padding: 0;
  font-size: 0.92rem;
}
.actionbar .danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
  font-weight: 600;
}
.days-pick { font-size: 0.92rem; color: var(--muted); display: flex; align-items: center; gap: 0.4rem; }
.days-pick select {
  font: inherit;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  color: var(--text);
}

.cb { width: 2.4rem; text-align: center; }
.cb input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); cursor: pointer; }
.cb input:disabled { cursor: not-allowed; opacity: 0.35; }
tr.picked td { background: var(--accent-wash); }

.dlg { margin: 0 0 0.6rem; font-size: 0.97rem; }
.dlg.warn { color: var(--danger); }
</style>
