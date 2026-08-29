<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { acpDetail, acpValidate, acpSave, acpSimulateWithRows } from '../api'
import type {
  AcpDetailResponse,
  AcpOp,
  AcpPrivileges,
  AcpRule,
  AcpSimulation,
  AcpValidation,
  WriteInfo,
} from '../types'

const props = defineProps<{ ri: string; write: WriteInfo }>()
const emit = defineEmits<{ done: [] }>()

/** acop 비트. 63 이 무슨 뜻인지 화면에서 알 수 있어야 한다. */
const OP_BITS: { bit: number; name: string; hint: string }[] = [
  { bit: 1, name: 'CREATE', hint: '자식 리소스 만들기' },
  { bit: 2, name: 'RETRIEVE', hint: '읽기' },
  { bit: 4, name: 'UPDATE', hint: '수정' },
  { bit: 8, name: 'DELETE', hint: '삭제' },
  { bit: 16, name: 'NOTIFY', hint: '알림 받기' },
  { bit: 32, name: 'DISCOVERY', hint: '검색 결과에 나오기' },
]

type EditRule = { acor: string; acop: number }

const detail = ref<AcpDetailResponse | null>(null)
const loading = ref(true)
const error = ref('')

const pv = ref<EditRule[]>([])
const pvs = ref<EditRule[]>([])

const validation = ref<Record<'pv' | 'pvs', AcpValidation | null>>({ pv: null, pvs: null })
const saving = ref(false)
const saved = ref(false)

// ── 미리보기 ──────────────────────────────────────────────────────────────
const previewTarget = ref('')
const previewOrigins = ref('')
const previewOps = ref<AcpOp[]>(['RETRIEVE', 'UPDATE', 'DELETE'])
const preview = ref<AcpSimulation | null>(null)
const previewError = ref('')
const previewing = ref(false)
/** 지금 화면의 규칙으로 미리 본 것인가. 편집하면 낡은다. */
const previewFresh = ref(false)

function toRules(p: AcpPrivileges | null | undefined): EditRule[] {
  return (p?.acr ?? []).map((r: AcpRule) => ({
    acor: (r.acor ?? []).join(', '),
    acop: Number(r.acop) || 0,
  }))
}

function toPrivileges(rules: EditRule[]): AcpPrivileges {
  return {
    acr: rules.map((r) => ({
      acor: r.acor
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      acop: r.acop,
    })),
  }
}

const pvObj = computed(() => toPrivileges(pv.value))
const pvsObj = computed(() => toPrivileges(pvs.value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const d = await acpDetail(props.ri)
    detail.value = d
    pv.value = toRules(d.detail.pv_parsed)
    pvs.value = toRules(d.detail.pvs_parsed)
    // 이 ACP 를 실제로 쓰는 리소스가 있으면 그것으로 미리 본다.
    previewTarget.value = d.refs?.refs?.[0]?.ri ?? ''
    await check()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function check() {
  try {
    const [a, b] = await Promise.all([acpValidate('pv', pvObj.value), acpValidate('pvs', pvsObj.value)])
    validation.value = { pv: a, pvs: b }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

const blocking = computed(
  () => !!validation.value.pv?.code || !!validation.value.pvs?.code,
)
const warnings = computed(() => [
  ...(validation.value.pv?.warnings ?? []).map((w) => ({ ...w, field: 'pv' })),
  ...(validation.value.pvs?.warnings ?? []).map((w) => ({ ...w, field: 'pvs' })),
])

function toggleBit(rule: EditRule, bit: number) {
  rule.acop = (rule.acop & bit) === bit ? rule.acop & ~bit : rule.acop | bit
}
function addRule(list: EditRule[]) {
  list.push({ acor: '', acop: 2 })
}
function removeRule(list: EditRule[], i: number) {
  list.splice(i, 1)
}

async function runPreview() {
  if (!previewTarget.value || !previewOriginList.value.length) return
  previewing.value = true
  previewError.value = ''
  try {
    preview.value = await acpSimulateWithRows({
      ri: previewTarget.value,
      origins: previewOriginList.value,
      ops: previewOps.value,
      rows: [{ ri: props.ri, pv: pvObj.value, pvs: pvsObj.value }],
    })
    previewFresh.value = true
  } catch (e) {
    preview.value = null
    previewError.value = e instanceof Error ? e.message : String(e)
  } finally {
    previewing.value = false
  }
}

const previewOriginList = computed(() =>
  previewOrigins.value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean),
)

async function save() {
  saving.value = true
  error.value = ''
  try {
    await acpSave(props.ri, { pv: pvObj.value, pvs: pvsObj.value })
    saved.value = true
    await load()
    previewFresh.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

// 규칙을 만지면 검사를 다시 하고, 미리 본 결과는 낡은 것으로 표시한다.
watch(
  [pv, pvs],
  () => {
    saved.value = false
    previewFresh.value = false
    void check()
  },
  { deep: true },
)

onMounted(load)
</script>

<template>
  <section>
    <div class="head">
      <h2>권한 편집</h2>
      <code class="mono target">{{ ri }}</code>
      <span class="spacer" />
      <button @click="emit('done')">목록으로</button>
    </div>

    <p v-if="loading" class="muted">불러오는 중…</p>
    <p v-if="error" class="err">{{ error }}</p>

    <p v-if="!write.enabled" class="banner danger">
      조회 전용으로 떠 있어 저장할 수 없습니다. <code>conf.json</code> 에
      <code>csebaseport</code> 를 넣어 Mobius 주소를 알려 주세요.
    </p>

    <template v-if="detail">
      <p class="lead">
        <strong>pv</strong> 는 이 ACP 를 <em>가리키는 리소스</em>의 권한이고,
        <strong>pvs</strong> 는 <em>이 ACP 자신을</em> 고칠 수 있는 권한입니다.
        <code>pvs</code> 에서 자기를 빼면 수퍼유저 말고는 되돌릴 수 없습니다.
      </p>

      <div class="cols">
        <div class="col">
          <h3>pv — 지켜지는 리소스의 권한</h3>
          <div v-for="(r, i) in pv" :key="'pv' + i" class="rule">
            <div class="rowline">
              <input v-model="r.acor" class="mono" placeholder="Cteam, Cmaint (비우면 누구나)" />
              <button class="del" title="이 규칙 지우기" @click="removeRule(pv, i)">×</button>
            </div>
            <div class="bits">
              <button
                v-for="o in OP_BITS"
                :key="o.bit"
                class="bit"
                :class="{ on: (r.acop & o.bit) === o.bit }"
                :title="o.hint"
                @click="toggleBit(r, o.bit)"
              >
                {{ o.name }}
              </button>
              <span class="acopval">acop = {{ r.acop }}</span>
            </div>
          </div>
          <button class="add" @click="addRule(pv)">＋ 규칙 추가</button>
          <p v-if="!pv.length" class="none">
            규칙이 없습니다 — 이 ACP 를 가리키는 리소스는 생성자만 통과합니다.
          </p>
        </div>

        <div class="col">
          <h3>pvs — 이 ACP 를 고칠 권한</h3>
          <div v-for="(r, i) in pvs" :key="'pvs' + i" class="rule">
            <div class="rowline">
              <input v-model="r.acor" class="mono" placeholder="Cowner" />
              <button class="del" title="이 규칙 지우기" @click="removeRule(pvs, i)">×</button>
            </div>
            <div class="bits">
              <button
                v-for="o in OP_BITS"
                :key="o.bit"
                class="bit"
                :class="{ on: (r.acop & o.bit) === o.bit }"
                :title="o.hint"
                @click="toggleBit(r, o.bit)"
              >
                {{ o.name }}
              </button>
              <span class="acopval">acop = {{ r.acop }}</span>
            </div>
          </div>
          <button class="add" @click="addRule(pvs)">＋ 규칙 추가</button>
        </div>
      </div>

      <!-- 검사: code 는 막고, warnings 는 막지 않는다. -->
      <div v-if="blocking" class="banner danger">
        <strong>이대로는 저장할 수 없습니다.</strong>
        <div v-if="validation.pv?.code" class="prob">
          <code>{{ validation.pv.code }}</code> <code class="at">{{ validation.pv.path }}</code>
        </div>
        <div v-if="validation.pvs?.code" class="prob">
          <code>{{ validation.pvs.code }}</code> <code class="at">{{ validation.pvs.path }}</code>
        </div>
      </div>

      <div v-if="warnings.length" class="banner warnbox">
        <strong>저장은 되지만 확인하세요.</strong>
        <div v-for="(w, i) in warnings" :key="i" class="prob">
          <code>{{ w.rule }}</code> {{ w.message }}
          <code v-if="w.path" class="at">{{ w.path }}</code>
        </div>
      </div>

      <!-- 미리보기. 계약이 요구하는 단계다 — 콘솔은 수퍼유저로 붙어 자기가 만든
           잠금을 자신은 한 번도 통과 검사받지 않는다. -->
      <div class="preview">
        <h3>저장하기 전에 — 누가 무엇을 할 수 있게 되나</h3>
        <p class="sub">
          콘솔은 수퍼유저로 붙기 때문에 <strong>저장한 뒤 직접 시험해도 통과합니다.</strong>
          바꾼 규칙이 실제로 어떻게 판정되는지는 여기서만 볼 수 있습니다.
        </p>
        <div class="pform">
          <label class="field">
            <span>어느 리소스에 대해</span>
            <select v-if="detail.refs?.refs?.length" v-model="previewTarget">
              <option v-for="r in detail.refs.refs" :key="r.ri" :value="r.ri">{{ r.ri }}</option>
            </select>
            <input v-else v-model="previewTarget" class="mono" placeholder="/Mobius/ae1/cnt1" />
          </label>
          <label class="field">
            <span>원본</span>
            <input v-model="previewOrigins" class="mono" placeholder="Cteam, Cother" />
          </label>
          <button :disabled="previewing || !previewTarget || !previewOriginList.length" @click="runPreview">
            {{ previewing ? '판정 중…' : '미리 보기' }}
          </button>
        </div>
        <p v-if="!detail.refs?.refs?.length" class="none">
          이 ACP 를 가리키는 리소스가 없어 대상을 직접 적어야 합니다.
        </p>
        <p v-if="previewError" class="err">{{ previewError }}</p>

        <div v-if="preview" class="ptable" :class="{ stale: !previewFresh }">
          <p v-if="!previewFresh" class="stalenote">
            규칙을 고쳤습니다 — 아래는 <strong>고치기 전</strong> 결과입니다. 다시 미리 보세요.
          </p>
          <table>
            <thead>
              <tr>
                <th>원본 \ 연산</th>
                <th v-for="o in previewOps" :key="o">{{ o }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="og in previewOriginList" :key="og">
                <th class="rowh mono">{{ og }}</th>
                <td v-for="o in previewOps" :key="o">
                  <template v-for="m in preview.matrix.filter((x) => x.origin === og && x.op === o)" :key="m.op">
                    <div class="verdict" :class="[m.allowed ? 'yes' : 'no', m.decided_by]">
                      <span class="mark">{{ m.allowed ? '허용' : '거부' }}</span>
                      <span class="why">{{ m.decided_by }}</span>
                    </div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="preview.matrix.some((m) => m.decided_by === 'creator')" class="note">
            <code>creator</code> 로 통과한 칸은 <strong>이 ACP 와 무관합니다</strong> —
            규칙을 어떻게 바꿔도 생성자는 남습니다.
          </p>
        </div>
      </div>

      <div class="actions">
        <button
          class="primary"
          :disabled="!write.enabled || blocking || saving"
          @click="save"
        >
          {{ saving ? '저장 중…' : '저장' }}
        </button>
        <span v-if="saved" class="ok">저장했습니다. 이력에 남았습니다.</span>
        <span v-else-if="!previewFresh && preview" class="muted">
          바뀐 규칙을 아직 미리 보지 않았습니다.
        </span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: baseline; gap: 0.8rem; margin-bottom: 0.5rem; }
h2 { margin: 0; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.target { font-size: 1rem; color: var(--accent-strong); }
.spacer { flex: 1; }
.lead { margin: 0 0 1.3rem; color: var(--muted); font-size: 1rem; max-width: 82ch; }
.sub { margin: 0 0 0.8rem; color: var(--muted); font-size: 0.95rem; max-width: 82ch; }
.err { color: var(--danger); }
.ok { color: var(--ok); font-weight: 600; }
.muted { color: var(--muted); }
.none { color: var(--muted); font-size: 0.93rem; }

.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.4rem; }
.col {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 1.1rem 1.2rem;
}
.rule {
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0.7rem 0.8rem;
  margin-bottom: 0.6rem;
  background: var(--bg);
}
.rowline { display: flex; gap: 0.5rem; align-items: center; }
.rowline input {
  font: inherit; flex: 1; padding: 0.4rem 0.6rem;
  border: 1px solid var(--border); border-radius: 7px;
  background: var(--panel); color: var(--text);
}
.del {
  border: none; background: none; color: var(--muted);
  font-size: 1.3rem; line-height: 1; padding: 0 0.3rem; cursor: pointer;
}
.del:hover { color: var(--danger); }
.bits { display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center; margin-top: 0.5rem; }
.bit {
  font-size: 0.78rem; padding: 0.2rem 0.5rem; border-radius: 5px;
  border: 1px solid var(--border); background: var(--panel); color: var(--muted);
}
.bit.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent-strong); font-weight: 600; }
.acopval { font-size: 0.8rem; color: var(--muted); font-family: var(--mono); margin-left: 0.3rem; }
.add { margin-top: 0.3rem; font-size: 0.9rem; }

.banner { padding: 0.85rem 1.1rem; border-radius: 0 8px 8px 0; margin: 1rem 0; font-size: 0.95rem; max-width: 88ch; }
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.banner.warnbox { background: var(--accent-wash); border-left: 3px solid var(--warn); }
.prob { margin-top: 0.35rem; }
.at { color: var(--accent-strong); }

.preview {
  margin-top: 1.6rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 1.2rem 1.3rem;
}
.pform { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
.field { display: grid; gap: 0.3rem; }
.field > span { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.field input, .field select {
  font: inherit; padding: 0.4rem 0.6rem; min-width: 260px;
  border: 1px solid var(--border); border-radius: 7px;
  background: var(--bg); color: var(--text);
}
.ptable { margin-top: 1rem; overflow: auto; }
.ptable.stale { opacity: 0.55; }
.stalenote { color: var(--warn); font-size: 0.92rem; margin: 0 0 0.5rem; }
.ptable th.rowh {
  text-align: left; font-family: var(--mono); font-weight: 600;
  text-transform: none; letter-spacing: 0; font-size: 0.95rem;
  color: var(--text); position: static;
}
.verdict { display: grid; gap: 0.1rem; padding: 0.3rem 0.5rem; border-radius: 7px; min-width: 90px; }
.verdict .mark { font-weight: 700; font-size: 0.9rem; }
.verdict .why { font-size: 0.73rem; opacity: 0.85; font-family: var(--mono); }
.verdict.yes { background: rgba(46, 160, 118, 0.14); color: var(--ok); }
.verdict.no { background: var(--danger-wash); color: var(--danger); }
.verdict.creator, .verdict.superuser { background: var(--accent-wash); color: var(--accent-strong); }
.note { font-size: 0.92rem; color: var(--muted); margin: 0.7rem 0 0; max-width: 80ch; }

.actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.4rem; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.actions .primary:disabled { opacity: 0.5; }
</style>
