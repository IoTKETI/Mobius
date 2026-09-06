<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { orphanLast, startOrphanScan, startOrphanDelete, fmtTime } from '../api'
import type { OrphanRow, OrphanScanResult, WriteInfo } from '../types'
import { useJobRunner } from '../job'
import JobPanel from '../components/JobPanel.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

/**
 * 고아 리소스 — 라이브 스캔은 없다. "탐지 시작" 이 작업을 돌리고, 화면은 마지막
 * 결과 파일만 보여 준다(배포 lookup 5,740만 행 — 설계의 명시적 비목표였다).
 */
defineProps<{ write: WriteInfo }>()

const result = ref<OrphanScanResult | null>(null)
const none = ref(false)
const error = ref('')
const loading = ref(false)
const scanCap = ref(200000)

async function loadLast() {
  loading.value = true
  error.value = ''
  // 결과를 새로 읽으면 선택을 비운다. 화면에 없는(옛 탐지의) ri 가 선택에
  // 남으면 체크된 행 없이 "N건 선택"만 보이는 유령 상태가 된다.
  selected.value = new Set()
  try {
    const r = await orphanLast()
    if ('none' in r) { none.value = true; result.value = null }
    else { none.value = false; result.value = r }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

const runner = useJobRunner(() => { void loadLast() })
const starting = ref(false)
const confirming = ref(false)

async function scan() {
  starting.value = true
  await runner.start(() => startOrphanScan({ scanCap: scanCap.value, sampleCap: 1000 }))
  starting.value = false
}

// ── 선택·삭제 ────────────────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set())
const rows = computed<OrphanRow[]>(() => result.value?.orphans ?? [])
function toggle(ri: string) { const s = new Set(selected.value); s.has(ri) ? s.delete(ri) : s.add(ri); selected.value = s }
const allSelected = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.ri)))
function toggleAll() { selected.value = allSelected.value ? new Set() : new Set(rows.value.map((r) => r.ri)) }
const selectedList = computed(() => [...selected.value])

async function runDelete() {
  starting.value = true
  const ok = await runner.start(() => startOrphanDelete(selectedList.value))
  starting.value = false
  confirming.value = false
  if (ok) selected.value = new Set()
}

function typeLabel(ty: number): string {
  const raw = result.value?.typeNames?.[String(ty)] ?? ''
  if (!raw) return `ty${ty}`
  const bare = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
  return bare.toUpperCase()
}
function rootOf(pi: string): string {
  const parts = pi.split('/').filter(Boolean)
  return parts.length >= 2 ? '/' + parts.slice(0, 2).join('/') : pi
}
function when(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '—' }

onMounted(async () => { void runner.attach(); await loadLast() })
</script>

<template>
  <section>
    <h2>고아 리소스</h2>
    <p class="lead">
      부모(<code>pi</code>)가 <code>lookup</code> 에 없는 행입니다. 트리에서 도달할 수 없지만
      DB 에는 남아 공간을 차지하고, 컨테이너 카운터를 어긋나게 합니다.
      <strong>화면을 열어도 훑지 않습니다</strong> — 탐지는 작업으로 돌리고, 마지막 결과만 보여 줍니다.
    </p>

    <div class="caution">
      <strong>아래 숫자는 “끊긴 지점”의 표본입니다 — 총량이 아닙니다.</strong>
      <p>
        상한(기본 20만 행)까지만 훑고 표본 1,000건까지만 남깁니다. 끊긴 컨테이너 하나 아래에
        CIN 수백만 건이 있을 수 있습니다. 끊긴 지점을 지우면 그 자식들이 다음 탐지에서 새
        고아로 올라옵니다.
      </p>
    </div>

    <div class="actionbar top">
      <label class="days-pick">
        훑을 상한
        <select v-model.number="scanCap">
          <option :value="50000">5만 행</option>
          <option :value="200000">20만 행</option>
          <option :value="1000000">100만 행</option>
        </select>
      </label>
      <button class="primary" :disabled="starting" @click="scan">탐지 시작</button>
      <span class="muted" v-if="result">마지막 탐지 {{ when(result.endedAt) }} · {{ result.scanned.toLocaleString() }}행 훑음
        <span v-if="result.scanCapped" class="warntext">· 상한에서 멈춤</span>
        <span v-if="result.cancelled" class="warntext">· 취소됨</span>
      </span>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <JobPanel v-if="runner.job.value" :job="runner.job.value" :error="runner.error.value" @cancel="runner.cancel" @dismiss="runner.dismiss" />

    <p v-if="none && !loading" class="empty">아직 탐지한 적이 없습니다. “탐지 시작” 을 누르세요.</p>

    <template v-if="result">
      <div class="tiles">
        <div class="tile"><div class="k">끊긴 지점 (표본)</div><div class="v">{{ result.orphans.length.toLocaleString() }}<span v-if="result.sampleTruncated">+</span></div><div class="s">표본 상한 {{ result.sampleCap.toLocaleString() }}</div></div>
        <div class="tile"><div class="k">lookup 에만 남은 CIN (표본)</div><div class="v">{{ result.lookupOnlyCin.rows.length.toLocaleString() }}<span v-if="result.lookupOnlyCin.sampleTruncated">+</span></div><div class="s">cin 표에 짝이 없는 ty=4 행 — 원인 미상, 세지 않음</div></div>
      </div>

      <p v-if="!write.enabled" class="note ro">조회 전용으로 떠 있습니다. 삭제를 쓰려면 <code>conf.json</code> 에 <code>csebaseport</code>(또는 <code>adminCsePort</code>)를 넣어 Mobius 주소를 알려 줍니다.</p>

      <div v-if="write.enabled && selected.size" class="actionbar">
        <strong>{{ selected.size.toLocaleString() }}건 선택</strong>
        <button class="link" @click="selected = new Set()">선택 해제</button>
        <span class="spacer" />
        <button class="danger" @click="confirming = true">삭제 ({{ selected.size.toLocaleString() }}건)</button>
      </div>

      <div v-if="rows.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="cb"><input type="checkbox" :checked="allSelected" :disabled="!write.enabled" aria-label="전체 선택" @change="toggleAll" /></th>
              <th>고아 경로 (ri)</th><th>타입</th><th>사라진 부모 (pi)</th><th>어느 서브트리</th><th>생성 (ct)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.ri" :class="{ picked: selected.has(r.ri) }">
              <td class="cb"><input type="checkbox" :checked="selected.has(r.ri)" :disabled="!write.enabled" :aria-label="r.ri + ' 선택'" @change="toggle(r.ri)" /></td>
              <td class="mono path">{{ r.ri }}</td>
              <td><span class="ty">{{ typeLabel(r.ty) }}</span></td>
              <td class="mono path missing">{{ r.pi }}</td>
              <td class="mono root">{{ rootOf(r.pi) }}</td>
              <td class="mono muted">{{ fmtTime(r.ct) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">표본에 고아가 없습니다<span v-if="result.scanCapped"> (상한까지는 — 뒤에 더 있을 수 있습니다)</span>.</p>

      <h3>lookup 에만 남은 CIN</h3>
      <p class="sub">원인이 밝혀지지 않아 삭제 버튼을 두지 않습니다. 인수인계 문서 §6 을 읽고 결정합니다.</p>
      <div v-if="result.lookupOnlyCin.rows.length" class="table-wrap short">
        <table>
          <thead><tr><th>ri</th><th>부모 (pi)</th><th>생성 (ct)</th></tr></thead>
          <tbody>
            <tr v-for="r in result.lookupOnlyCin.rows" :key="r.ri">
              <td class="mono path">{{ r.ri }}</td><td class="mono path">{{ r.pi }}</td><td class="mono muted">{{ fmtTime(r.ct) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty small">표본에 없습니다.</p>
    </template>

    <ConfirmDialog v-if="confirming" title="고아 리소스를 삭제합니다" :confirm-label="`${selected.size.toLocaleString()}건 삭제`" :paths="selectedList" destructive :busy="starting" @cancel="confirming = false" @confirm="runDelete">
      <p class="dlg">되돌릴 수 없습니다. 삭제 직전에 부모가 여전히 없는지 다시 확인해서, 그사이 부모가 되살아난 것은 건너뜁니다.</p>
      <p class="dlg warn"><strong>한 번에 다 끝나지 않습니다.</strong> 끊긴 지점을 지우면 그 자식들이 새로 고아가 되어 다음 탐지에 올라옵니다. 탐지 → 삭제를 반복해야 합니다.</p>
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
.lead { margin: 0 0 1.2rem; color: var(--muted); font-size: 1.02rem; max-width: 72ch; }
.err { color: var(--danger); font-size: 1rem; }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; font-size: 1.05rem; }

/* "3건" 이 사소해 보이는데 실제로는 수백만 행이 도달 불가일 수 있다는 것은
   관리자의 판단을 바꾸는 사실이라, 설명 박스와 시각적으로 구분한다. */
.caution {
  background: var(--danger-wash);
  border: 1px solid var(--border);
  border-left: 3px solid var(--danger);
  border-radius: 0 10px 10px 0;
  padding: 1rem 1.2rem;
  margin-bottom: 1.4rem;
  max-width: 82ch;
}
.caution > strong { display: block; margin-bottom: 0.5rem; color: var(--text-strong); }
.caution p { margin: 0 0 0.6rem; font-size: 0.95rem; }
.caution p:last-child { margin-bottom: 0; }

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.9rem;
  max-width: 700px;
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
.tile .s.warn { color: var(--warn); font-weight: 600; }

.table-wrap {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: auto;
  max-height: 62vh;
  margin-top: 1.4rem;
}

.path { max-width: 430px; overflow-wrap: anywhere; font-size: 0.95rem; }
.path.missing { color: var(--danger); }
.root { color: var(--muted); }
.ty {
  font-size: 0.8rem;
  font-weight: 600;
  border: 1px solid var(--accent);
  color: var(--accent-strong);
  background: var(--accent-wash);
  border-radius: 5px;
  padding: 0.1rem 0.45rem;
  white-space: nowrap;
}
.muted { color: var(--muted); }

.footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem 0;
  font-size: 0.95rem;
}
.note { color: var(--muted); font-size: 0.92rem; margin: 0.9rem 0; max-width: 72ch; }
.note.ro { border-left: 3px solid var(--warn); padding-left: 0.8rem; }

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

.cb { width: 2.4rem; text-align: center; }
.cb input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); cursor: pointer; }
.cb input:disabled { cursor: not-allowed; opacity: 0.35; }
tr.picked td { background: var(--accent-wash); }

.dlg { margin: 0 0 0.6rem; font-size: 0.97rem; }
.dlg.warn { color: var(--danger); }

h3 { margin: 1.8rem 0 0.2rem; font-size: 1.15rem; color: var(--text-strong); }
.sub { margin: 0 0 0.8rem; color: var(--muted); font-size: 0.95rem; max-width: 78ch; }
.actionbar.top { background: var(--panel); border-color: var(--border); }
.actionbar .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.warntext { color: var(--warn); font-weight: 600; }
.table-wrap.short { max-height: 36vh; }
.empty.small { padding: 1rem 0; font-size: 0.95rem; }
.days-pick { font-size: 0.92rem; color: var(--muted); display: flex; align-items: center; gap: 0.4rem; }
.days-pick select { font: inherit; padding: 0.3rem 0.5rem; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); color: var(--text); }
</style>
