<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { subsEndpoints, subsSample, startSubDelete } from '../api'
import type { SubsEndpoint, SubsEndpointsPage, SubsSampleRow, WriteInfo } from '../types'
import { useJobRunner } from '../job'
import JobPanel from '../components/JobPanel.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

/**
 * 구독을 nu 의 엔드포인트로 묶어 본다(배포: 3,463건, 고유 nu 202개, 상위 3개가 57%).
 * 판정은 코어 감사 함수의 것이다. **broken 만 미리 선택되고 suspect 는 섞이지 않는다** —
 * suspect(예: mqtt 토픽 미등록)는 멀쩡히 동작 중인 구독일 수 있다.
 */
defineProps<{ write: WriteInfo }>()

const page = ref<SubsEndpointsPage | null>(null)
const picked = ref<SubsEndpoint | null>(null)
const sample = ref<SubsSampleRow[]>([])
const sampleMore = ref(false)
const loading = ref(false)
const loadingSample = ref(false)
const error = ref('')

const selected = ref<Set<string>>(new Set())
const selectedList = computed(() => [...selected.value])
const brokenRows = computed(() => sample.value.filter((r) => r.severity === 'broken'))
const suspectSelected = computed(() => sample.value.filter((r) => r.severity === 'suspect' && selected.value.has(r.ri)).length)

async function load() {
  loading.value = true
  error.value = ''
  try { page.value = await subsEndpoints({ limit: 100 }) }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { loading.value = false }
}

async function open(e: SubsEndpoint) {
  picked.value = e
  sample.value = []
  selected.value = new Set()
  loadingSample.value = true
  try {
    const p = await subsSample(e.endpoint, 200)
    sample.value = p.rows
    sampleMore.value = p.more
    // broken 만 미리 선택한다. suspect 는 사람이 하나씩 고른다.
    selected.value = new Set(p.rows.filter((r) => r.severity === 'broken').map((r) => r.ri))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loadingSample.value = false
  }
}

function toggle(ri: string) { const s = new Set(selected.value); s.has(ri) ? s.delete(ri) : s.add(ri); selected.value = s }

const runner = useJobRunner(() => { void load(); if (picked.value) void open(picked.value) })
const confirming = ref(false)
const starting = ref(false)
async function runDelete() {
  starting.value = true
  const ok = await runner.start(() => startSubDelete(selectedList.value))
  starting.value = false
  confirming.value = false
  if (ok) selected.value = new Set()
}

const REASON_LABEL: Record<string, string> = {
  mqtt_topic_unregistered: 'MQTT 토픽의 AE 가 등록돼 있지 않음',
}
function sev(r: SubsSampleRow): string {
  if (r.severity === 'broken') return '깨짐'
  if (r.severity === 'suspect') return '의심'
  return '정상'
}

onMounted(async () => { void runner.attach(); await load() })
</script>

<template>
  <section>
    <h2>구독 엔드포인트</h2>
    <p class="lead">
      구독을 알림 주소(<code>nu</code>)의 <code>scheme://host</code> 로 묶었습니다. 판정은 코어의 구독 감사와 같습니다 —
      <strong>깨짐(broken)</strong> 은 알림을 보낼 수 없는 구독, <strong>의심(suspect)</strong> 은 보낼 수는 있으나 받을 상대가
      확인되지 않는 구독입니다. 의심은 일괄 선택에 섞이지 않습니다.
    </p>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="page" class="tiles">
      <div class="tile"><div class="k">훑은 구독</div><div class="v">{{ page.scanned.toLocaleString() }}<span v-if="page.capped">+</span></div><div class="s" :class="{ warn: page.capped }">{{ page.capped ? '상한에 걸림 — 더 있을 수 있음' : '전수' }}</div></div>
      <div class="tile" :class="{ hot: (page.audit.bySeverity.broken ?? 0) > 0 }"><div class="k">깨짐</div><div class="v">{{ (page.audit.bySeverity.broken ?? 0).toLocaleString() }}</div><div class="s">알림을 보낼 수 없음</div></div>
      <div class="tile"><div class="k">의심</div><div class="v">{{ (page.audit.bySeverity.suspect ?? 0).toLocaleString() }}</div><div class="s">받을 상대 미확인</div></div>
      <div class="tile"><div class="k">엔드포인트</div><div class="v">{{ page.endpoints.length }}<span v-if="page.endpointsTruncated">+</span></div><div class="s">건수 순</div></div>
    </div>
    <p v-if="page?.audit.findingsTruncated" class="note warn">
      감사 결과가 2,000건에서 잘렸습니다 — 표의 깨짐/의심 건수는 실제보다 적게 보일 수 있습니다.
    </p>

    <JobPanel v-if="runner.job.value" :job="runner.job.value" :error="runner.error.value" @cancel="runner.cancel" @dismiss="runner.dismiss" />

    <div v-if="page?.endpoints.length" class="table-wrap">
      <table>
        <thead><tr><th>엔드포인트</th><th class="num">구독</th><th class="num">깨짐</th><th class="num">의심</th></tr></thead>
        <tbody>
          <tr v-for="e in page.endpoints" :key="e.endpoint" :class="{ picked: picked?.endpoint === e.endpoint }">
            <td class="mono path"><button class="linkish" @click="open(e)">{{ e.endpoint }}</button></td>
            <td class="num">{{ e.total.toLocaleString() }}</td>
            <td class="num" :class="{ bad: e.broken }">{{ e.broken.toLocaleString() }}</td>
            <td class="num" :class="{ warn: e.suspect }">{{ e.suspect.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="empty">구독이 없습니다.</p>

    <div v-if="picked" class="drawer">
      <div class="dhead">
        <strong class="mono">{{ picked.endpoint }}</strong>
        <span class="muted">표본 {{ sample.length }}건<span v-if="sampleMore"> · 더 있음(상한 200)</span></span>
        <span class="spacer" />
        <button @click="picked = null">닫기</button>
      </div>
      <p v-if="loadingSample" class="muted">읽는 중…</p>

      <div v-if="write.enabled && selected.size" class="actionbar">
        <strong>{{ selected.size }}건 선택</strong>
        <span class="muted">(깨짐 {{ brokenRows.filter((r) => selected.has(r.ri)).length }} · 의심 {{ suspectSelected }})</span>
        <button class="link" @click="selected = new Set()">선택 해제</button>
        <span class="spacer" />
        <button class="danger" @click="confirming = true">구독 삭제 ({{ selected.size }}건)</button>
      </div>

      <table v-if="sample.length" class="sample">
        <thead><tr><th class="cb"></th><th>구독 (ri)</th><th>판정</th><th>사유</th><th>nu</th></tr></thead>
        <tbody>
          <tr v-for="r in sample" :key="r.ri" :class="[r.severity ?? 'ok', { picked: selected.has(r.ri) }]">
            <td class="cb"><input type="checkbox" :checked="selected.has(r.ri)" :disabled="!write.enabled" :aria-label="r.ri + ' 선택'" @change="toggle(r.ri)" /></td>
            <td class="mono path">{{ r.ri }}</td>
            <td><span class="sev" :class="r.severity ?? 'ok'">{{ sev(r) }}</span></td>
            <td class="small">{{ r.reason ? (REASON_LABEL[r.reason] ?? r.reason) : '' }}</td>
            <td class="mono small nu">{{ r.nu.join(', ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ConfirmDialog v-if="confirming" title="구독을 삭제합니다" :confirm-label="`${selected.size}건 삭제`" :paths="selectedList" destructive :busy="starting" @cancel="confirming = false" @confirm="runDelete">
      <p class="dlg">되돌릴 수 없습니다. 삭제 직전에 여전히 구독인지 다시 확인합니다.</p>
      <p v-if="suspectSelected" class="dlg warn"><strong>의심 {{ suspectSelected }}건이 섞여 있습니다.</strong> 의심 구독은 지금 정상 동작 중일 수 있습니다 — 정말 지울 것인지 다시 보세요.</p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 80ch; }
.err { color: var(--danger); }
.note { font-size: 0.88rem; margin: -0.5rem 0 1.1rem; color: var(--muted); }
.note.warn { color: var(--warn); font-weight: 600; }
.muted { color: var(--muted); font-size: 0.92rem; }
.small { font-size: 0.88rem; }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.9rem; margin-bottom: 1.2rem; }
.tile { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1rem 1.1rem; }
.tile.hot { border-color: var(--danger); }
.tile .k { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600; }
.tile .v { font-size: 2.1rem; font-weight: 650; line-height: 1.25; letter-spacing: -0.02em; color: var(--text-strong); }
.tile .s { font-size: 0.86rem; color: var(--muted); }
.tile .s.warn { color: var(--warn); font-weight: 600; }
.table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: auto; max-height: 45vh; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.num.bad { color: var(--danger); font-weight: 600; }
.num.warn { color: var(--warn); font-weight: 600; }
.path { max-width: 520px; overflow-wrap: anywhere; font-size: 0.95rem; }
.linkish { border: none; background: none; padding: 0; font: inherit; color: var(--accent-strong); text-decoration: underline; cursor: pointer; text-align: left; }
tr.picked td { background: var(--accent-wash); }
.drawer { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1.2rem 1.4rem; margin-top: 1rem; }
.dhead { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.8rem; }
.dhead .spacer { flex: 1; }
.sample { font-size: 0.93rem; }
.sample tr.broken td:first-child { box-shadow: inset 3px 0 0 var(--danger); }
.sample tr.suspect td:first-child { box-shadow: inset 3px 0 0 var(--warn); }
.sev { font-size: 0.75rem; font-weight: 700; border-radius: 4px; padding: 0.05rem 0.4rem; white-space: nowrap; }
.sev.broken { background: var(--danger); color: #fff; }
.sev.suspect { background: var(--warn); color: #fff; }
.sev.ok { background: var(--accent-wash); color: var(--accent-strong); }
.nu { max-width: 360px; overflow-wrap: anywhere; color: var(--muted); }
.cb { width: 2.4rem; text-align: center; }
.cb input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); cursor: pointer; }
.actionbar { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; margin: 0.6rem 0 1rem; padding: 0.8rem 1rem; background: var(--accent-wash); border: 1px solid var(--accent); border-radius: 10px; }
.actionbar .spacer { flex: 1; }
.actionbar .link { border: none; background: none; color: var(--muted); text-decoration: underline; padding: 0; font-size: 0.92rem; }
.actionbar .danger { background: var(--danger); border-color: var(--danger); color: #fff; font-weight: 600; }
.dlg { margin: 0 0 0.6rem; font-size: 0.97rem; }
.dlg.warn { color: var(--danger); }
</style>
