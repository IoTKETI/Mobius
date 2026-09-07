<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { acpValidate, acpCreate, acpSimulateWithRows } from '../api'
import type { AcpOp, AcpSimulation, AcpValidation, EditRule, WriteInfo } from '../types'
import AcpRulesEditor from '../components/AcpRulesEditor.vue'
import AcpVerdictTable from '../components/AcpVerdictTable.vue'
import AcpPolicyNote from '../components/AcpPolicyNote.vue'
import { TEMPLATES, toPrivileges } from '../components/acp_templates'

/**
 * ACP 신규 생성. 잠금 단위가 AE 하나이므로 부모는 AE 다. 검사 → 미리보기 → 저장 순서는
 * 편집 화면과 같다 — 콘솔은 수퍼유저로 붙어 자기가 만든 잠금을 자신은 통과하므로,
 * 저장 전에 판정을 보는 것이 계약이다.
 */
defineProps<{ write: WriteInfo }>()
const router = useRouter()

const parentRi = ref('')
const rn = ref('')
const pv = ref<EditRule[]>(TEMPLATES[0].pv.map((r) => ({ ...r })))
const pvs = ref<EditRule[]>([{ acor: '', acop: 63 }])
const templateApplied = ref('A')
const validation = ref<Record<'pv' | 'pvs', AcpValidation | null>>({ pv: null, pvs: null })
const error = ref('')
const saving = ref(false)

const previewOrigins = ref('')
const previewOps = ref<AcpOp[]>(['CREATE', 'RETRIEVE', 'UPDATE', 'DELETE'])
const preview = ref<AcpSimulation | null>(null)
const previewFresh = ref(false)
const previewing = ref(false)
const previewOriginList = computed(() => previewOrigins.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))

const rnOk = computed(() => /^[A-Za-z0-9_-]{1,64}$/.test(rn.value))
const parentOk = computed(() => parentRi.value.startsWith('/'))
const blocking = computed(() => !!validation.value.pv?.code || !!validation.value.pvs?.code)

function applyTemplate(key: string) {
  const t = TEMPLATES.find((x) => x.key === key)
  if (!t) return
  pv.value = t.pv.map((r) => ({ ...r }))
  templateApplied.value = key
}

async function check() {
  try {
    const [a, b] = await Promise.all([acpValidate('pv', toPrivileges(pv.value)), acpValidate('pvs', toPrivileges(pvs.value))])
    validation.value = { pv: a, pvs: b }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function runPreview() {
  if (!parentOk.value || !previewOriginList.value.length) return
  previewing.value = true
  error.value = ''
  try {
    // 아직 없는 ACP 라 rows 에 가짜 ri 를 넣어 판정만 본다. 대상은 부모 AE 다.
    preview.value = await acpSimulateWithRows({
      ri: parentRi.value, origins: previewOriginList.value, ops: previewOps.value,
      rows: [{ ri: parentRi.value + '/' + (rn.value || 'new-acp'), pv: toPrivileges(pv.value), pvs: toPrivileges(pvs.value) }],
    })
    previewFresh.value = true
  } catch (e) {
    preview.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    previewing.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const r = await acpCreate({ parentRi: parentRi.value, rn: rn.value, pv: toPrivileges(pv.value), pvs: toPrivileges(pvs.value) })
    router.push({ name: 'judge-acp-list', query: { ri: r.ri } })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

watch([pv, pvs], () => { previewFresh.value = false; void check() }, { deep: true, immediate: true })
</script>

<template>
  <section>
    <div class="head">
      <h2>새 ACP</h2>
      <span class="spacer" />
      <button @click="router.push({ name: 'judge-acp-list' })">목록으로</button>
    </div>
    <AcpPolicyNote variant="compact" />
    <p v-if="!write.enabled" class="banner danger">조회 전용으로 떠 있어 만들 수 없습니다.</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="form">
      <label class="field"><span>부모 AE (경로)</span><input v-model.trim="parentRi" class="mono" placeholder="/Mobius/Cdevice1" /></label>
      <label class="field"><span>이름 (rn)</span><input v-model.trim="rn" class="mono" placeholder="acp_team" /></label>
      <p v-if="parentRi && !parentOk" class="err small">경로는 / 로 시작합니다.</p>
      <p v-if="rn && !rnOk" class="err small">영문·숫자·_·- 1~64자.</p>
    </div>

    <div class="templates">
      <span class="tlabel">템플릿에서 시작</span>
      <button v-for="t in TEMPLATES" :key="t.key" class="tbtn" :class="{ on: templateApplied === t.key }" :title="t.hint" @click="applyTemplate(t.key)">{{ t.name }}</button>
    </div>

    <div class="cols">
      <AcpRulesEditor v-model="pv" title="pv — 지켜지는 리소스의 권한" placeholder="Cteam, Cmaint (비우면 누구나)" empty-note="규칙이 없습니다 — 생성자만 통과합니다." />
      <AcpRulesEditor v-model="pvs" title="pvs — 이 ACP 를 고칠 권한" placeholder="Cowner" empty-note="규칙이 없습니다 — 수퍼유저 말고는 못 고칩니다." />
    </div>

    <div v-if="blocking" class="banner danger">
      <strong>이대로는 만들 수 없습니다.</strong>
      <div v-if="validation.pv?.code" class="prob"><code>{{ validation.pv.code }}</code> <code class="at">{{ validation.pv.path }}</code></div>
      <div v-if="validation.pvs?.code" class="prob"><code>{{ validation.pvs.code }}</code> <code class="at">{{ validation.pvs.path }}</code></div>
    </div>

    <div class="preview">
      <h3>만들기 전에 — 누가 무엇을 할 수 있게 되나</h3>
      <div class="pform">
        <label class="field"><span>원본</span><input v-model="previewOrigins" class="mono" placeholder="Cteam, Cother" /></label>
        <button :disabled="previewing || !parentOk || !previewOriginList.length" @click="runPreview">{{ previewing ? '판정 중…' : '미리 보기' }}</button>
      </div>
      <AcpVerdictTable
        v-if="preview"
        :matrix="preview.matrix"
        :origins="previewOriginList"
        :ops="previewOps"
        :stale="!previewFresh"
        stale-note="규칙을 고쳤습니다 — 아래는 고치기 전 결과입니다."
      />
    </div>

    <div class="actions">
      <button class="primary" :disabled="!write.enabled || blocking || saving || !rnOk || !parentOk" @click="save">{{ saving ? '만드는 중…' : '만들기' }}</button>
      <span class="muted">만든 뒤에는 “acpi 연결/해제” 로 AE 에 붙입니다 — 붙이기 전에는 효력이 없습니다.</span>
    </div>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: baseline; gap: 0.8rem; margin-bottom: 0.5rem; }
h2 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.spacer { flex: 1; }
.err { color: var(--danger); }
.small { font-size: 0.88rem; }
.muted { color: var(--muted); font-size: 0.92rem; }
.form { display: grid; gap: 0.6rem; max-width: 560px; margin: 1rem 0; }
.field { display: grid; gap: 0.3rem; }
.field > span { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.field input { font: inherit; padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); }
.templates { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
.tlabel { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.tbtn { font-size: 0.9rem; padding: 0.3rem 0.75rem; border-radius: 999px; }
.tbtn.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.4rem; }
.banner { padding: 0.85rem 1.1rem; border-radius: 0 8px 8px 0; margin: 1rem 0; font-size: 0.95rem; max-width: 88ch; }
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.prob { margin-top: 0.35rem; }
.at { color: var(--accent-strong); }
.preview { margin-top: 1.6rem; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1.2rem 1.3rem; }
.pform { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
.actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.4rem; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.actions .primary:disabled { opacity: 0.5; }
</style>
