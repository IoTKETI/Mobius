<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { acpList, acpSimulate, acpAttach } from '../api'
import type { AcpListRow, AcpOp, AcpSimulation, WriteInfo } from '../types'
import AcpVerdictTable from '../components/AcpVerdictTable.vue'

/**
 * AE 에 acpi 를 붙이고 뗀다. 손입력이 없다 — 목록에서 고른다(최대 7, 컬럼 폭 200).
 * 지금 붙은 것은 시뮬레이터의 acpi 필드로 읽는다(코어가 실제로 푼 값이다).
 */
const props = defineProps<{ initialRi: string | null; write: WriteInfo }>()
const router = useRouter()

const targetRi = ref(props.initialRi ?? '')
const current = ref<string[] | null>(null)
const chosen = ref<Set<string>>(new Set())
const acps = ref<AcpListRow[]>([])
const error = ref('')
const loading = ref(false)
const saving = ref(false)

const previewOrigins = ref('')
const previewOps = ref<AcpOp[]>(['CREATE', 'RETRIEVE', 'UPDATE', 'DELETE'])
const preview = ref<AcpSimulation | null>(null)
const previewFresh = ref(false)
const previewOriginList = computed(() => previewOrigins.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))

const chosenList = computed(() => [...chosen.value])
const changed = computed(() => JSON.stringify([...(current.value ?? [])].sort()) !== JSON.stringify(chosenList.value.slice().sort()))

/** ACP 목록을 끝까지 읽는다 — 고를 목록이 잘려 있으면 "없는 줄" 알게 된다. */
async function loadAcps() {
  const out: AcpListRow[] = []
  let after: string | null = null
  for (let i = 0; i < 50; i++) {
    const p = await acpList({ limit: 500, afterRi: after })
    out.push(...p.rows)
    if (!p.more) break
    after = p.nextRi
  }
  acps.value = out
}

/** 대상의 현재 acpi. 시뮬레이터가 실제로 푼 값을 준다(존재하지 않는 ri 는 오류). */
async function loadCurrent() {
  if (!targetRi.value.startsWith('/')) return
  loading.value = true
  error.value = ''
  try {
    const s = await acpSimulate({ ri: targetRi.value, origins: ['__probe__'], ops: ['RETRIEVE'] })
    if (s.ty !== 2) { error.value = '대상은 AE 여야 합니다 (잠금 단위는 AE 하나입니다)'; current.value = null; return }
    current.value = s.acpi ?? []
    chosen.value = new Set(current.value)
    preview.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    current.value = null
  } finally {
    loading.value = false
  }
}

function toggle(ri: string) {
  const s = new Set(chosen.value)
  if (s.has(ri)) s.delete(ri)
  else if (s.size >= 7) { error.value = 'acpi 는 최대 7개입니다'; return }
  else s.add(ri)
  chosen.value = s
  previewFresh.value = false
}

async function runPreview() {
  if (!previewOriginList.value.length || current.value === null) return
  error.value = ''
  try {
    preview.value = await acpSimulate({ ri: targetRi.value, origins: previewOriginList.value, ops: previewOps.value, acpiOverride: chosenList.value })
    previewFresh.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    await acpAttach({ targetRi: targetRi.value, acpi: chosenList.value })
    await loadCurrent()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

watch(() => props.initialRi, (v) => { if (v) { targetRi.value = v; void loadCurrent() } })
onMounted(async () => {
  try { await loadAcps() } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  if (targetRi.value) await loadCurrent()
})
</script>

<template>
  <section>
    <div class="head">
      <h2>acpi 연결 / 해제</h2>
      <span class="spacer" />
      <button @click="router.push({ name: 'judge-acp-list' })">목록으로</button>
    </div>
    <p class="lead">AE 하나에 ACP 를 붙이거나 뗍니다. 컨테이너·CIN 에는 붙이지 않습니다 — 잠금 단위는 AE 하나입니다.</p>
    <p v-if="!write.enabled" class="banner danger">조회 전용으로 떠 있어 저장할 수 없습니다.</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="pform">
      <label class="field"><span>대상 AE (경로)</span><input v-model.trim="targetRi" class="mono" placeholder="/Mobius/Cdevice1" @keyup.enter="loadCurrent" /></label>
      <button :disabled="loading || !targetRi.startsWith('/')" @click="loadCurrent">{{ loading ? '읽는 중…' : '읽기' }}</button>
    </div>

    <template v-if="current !== null">
      <p class="muted">지금 붙은 것: <code v-if="current.length" class="mono">{{ current.join(', ') }}</code><span v-else>없음 — 기본 정책이 적용됩니다</span></p>

      <div class="table-wrap">
        <table>
          <thead><tr><th class="cb"></th><th>ACP (ri)</th><th>이름</th></tr></thead>
          <tbody>
            <tr v-for="a in acps" :key="a.ri" :class="{ picked: chosen.has(a.ri) }">
              <td class="cb"><input type="checkbox" :checked="chosen.has(a.ri)" :aria-label="a.ri + ' 선택'" @change="toggle(a.ri)" /></td>
              <td class="mono path">{{ a.ri }}</td>
              <td class="mono">{{ a.rn }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!acps.length" class="empty">ACP 가 없습니다. 먼저 “새 ACP” 로 만듭니다.</p>

      <div class="preview">
        <h3>저장하기 전에 — 이 조합이면 누가 무엇을 할 수 있나</h3>
        <div class="pform">
          <label class="field"><span>원본</span><input v-model="previewOrigins" class="mono" placeholder="Cteam, Cother" /></label>
          <button :disabled="!previewOriginList.length" @click="runPreview">미리 보기</button>
        </div>
        <AcpVerdictTable
          v-if="preview"
          :matrix="preview.matrix"
          :origins="previewOriginList"
          :ops="previewOps"
          :stale="!previewFresh"
          stale-note="선택을 바꿨습니다 — 아래는 바꾸기 전 결과입니다."
        />
      </div>

      <div class="actions">
        <button class="primary" :disabled="!write.enabled || saving || !changed" @click="save">{{ saving ? '저장 중…' : chosen.size ? `저장 (${chosen.size}개 연결)` : '저장 (전부 해제)' }}</button>
        <span v-if="!changed" class="muted">바뀐 것이 없습니다.</span>
        <span v-else-if="!previewFresh" class="muted">바뀐 조합을 아직 미리 보지 않았습니다.</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: baseline; gap: 0.8rem; margin-bottom: 0.5rem; }
h2 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.spacer { flex: 1; }
.lead { margin: 0 0 1.2rem; color: var(--muted); font-size: 1.02rem; max-width: 74ch; }
.err { color: var(--danger); }
.muted { color: var(--muted); font-size: 0.95rem; }
.empty { color: var(--muted); padding: 2rem 0; text-align: center; }
.banner { padding: 0.85rem 1.1rem; border-radius: 0 8px 8px 0; margin: 1rem 0; font-size: 0.95rem; max-width: 88ch; }
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.pform { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; margin: 0.6rem 0; }
.field { display: grid; gap: 0.3rem; }
.field > span { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.field input { font: inherit; padding: 0.4rem 0.6rem; min-width: 300px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); }
.table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); overflow: auto; max-height: 40vh; margin-top: 0.8rem; }
.cb { width: 2.4rem; text-align: center; }
.cb input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); cursor: pointer; }
tr.picked td { background: var(--accent-wash); }
.path { max-width: 520px; overflow-wrap: anywhere; font-size: 0.95rem; }
.preview { margin-top: 1.4rem; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1.2rem 1.3rem; }
.actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.4rem; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.actions .primary:disabled { opacity: 0.5; }
</style>
