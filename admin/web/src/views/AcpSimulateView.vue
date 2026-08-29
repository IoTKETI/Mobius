<script setup lang="ts">
import { ref, computed } from 'vue'
import { acpSimulate } from '../api'
import { ACP_OPS, DECIDED_BY_LABEL } from '../types'
import type { AcpOp, AcpSimulation, AcpVerdict } from '../types'

const props = defineProps<{ initialRi?: string | null }>()

const ri = ref(props.initialRi ?? '')
const originsText = ref('')
const ops = ref<AcpOp[]>(['RETRIEVE', 'UPDATE', 'DELETE'])
const previewRemoved = ref(false)

const result = ref<AcpSimulation | null>(null)
const error = ref('')
const busy = ref(false)

const origins = computed(() =>
  originsText.value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean),
)

/** 서버가 거절하는 상한(원본 20 · 연산 7 · 곱 120)을 화면에서 먼저 알려 준다. */
const overLimit = computed(() => {
  if (origins.value.length > 20) return `원본은 20개까지입니다 (지금 ${origins.value.length}개)`
  if (ops.value.length > 7) return '연산은 7개까지입니다'
  if (origins.value.length * ops.value.length > 120)
    return `칸이 ${origins.value.length * ops.value.length}개입니다 — 120개까지입니다`
  return ''
})

function toggleOp(o: AcpOp) {
  const i = ops.value.indexOf(o)
  if (i >= 0) ops.value.splice(i, 1)
  else ops.value.push(o)
}

async function run() {
  if (!ri.value || !origins.value.length || !ops.value.length) return
  busy.value = true
  error.value = ''
  try {
    result.value = await acpSimulate({
      ri: ri.value,
      origins: origins.value,
      ops: ops.value,
      ...(previewRemoved.value ? { acpiOverride: [] } : {}),
    })
  } catch (e) {
    result.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function cell(origin: string, op: AcpOp): AcpVerdict | undefined {
  return result.value?.matrix.find((m) => m.origin === origin && m.op === op)
}

const resultOrigins = computed(() => [...new Set(result.value?.matrix.map((m) => m.origin) ?? [])])
const resultOps = computed(() => [...new Set(result.value?.matrix.map((m) => m.op) ?? [])])

/** 생성자 때문에 통과한 칸이 하나라도 있는가 — "완전히 잠갔다"가 거짓이 되는 지점. */
const creatorPasses = computed(
  () => result.value?.matrix.filter((m) => m.decided_by === 'creator').length ?? 0,
)
</script>

<template>
  <section>
    <h2>권한 시뮬레이터</h2>
    <p class="lead">
      누가 무엇을 할 수 있는지 <strong>저장하기 전에</strong> 봅니다. 콘솔은 수퍼유저로 붙기
      때문에 HTTP 로 직접 시험해서는 정책을 검증할 수 없습니다 — 무엇을 걸든 콘솔 자신은
      통과합니다. 이 화면은 서버의 실제 판정 함수를 그대로 씁니다.
    </p>

    <div class="form">
      <label class="field wide">
        <span>리소스 경로 (ri)</span>
        <input v-model="ri" class="mono" placeholder="/Mobius/ae1/cnt1" @keyup.enter="run" />
      </label>

      <label class="field wide">
        <span>원본 (X-M2M-Origin) — 쉼표나 공백으로 구분</span>
        <input
          v-model="originsText"
          class="mono"
          placeholder="Cteam, Cdevice, Cother"
          @keyup.enter="run"
        />
      </label>

      <div class="field">
        <span>연산</span>
        <div class="ops">
          <button
            v-for="o in ACP_OPS"
            :key="o"
            class="opbtn"
            :class="{ on: ops.includes(o) }"
            @click="toggleOp(o)"
          >
            {{ o }}
          </button>
        </div>
      </div>

      <!-- acpiOverride:[] 경로가 지금 실제와 반대로 답한다. 실측: acpi 를 비우면
           실제로는 전원 허용(HTTP 200)인데 시뮬레이터는 no_acp_row 로 전원 거부라고
           답한다. "이 ACP 를 떼도 안전한가" 에 정확히 거꾸로 답하는 셈이라,
           고쳐질 때까지 잠가 둔다 — 틀린 미리보기는 없는 것보다 나쁘다.
           코어 수정(mobius/acp_simulate.js:131)이 들어오면 disabled 만 걷으면 된다. -->
      <label class="check off">
        <input v-model="previewRemoved" type="checkbox" disabled />
        <span>
          이 리소스의 <code>acpi</code> 를 뗐다고 가정하고 보기
          <em>— 코어 수정 대기 중. 지금은 실제와 반대로 답합니다(보고됨).</em>
        </span>
      </label>

      <div class="actions">
        <button class="primary" :disabled="busy || !ri || !origins.length || !!overLimit" @click="run">
          {{ busy ? '판정 중…' : '판정 보기' }}
        </button>
        <span v-if="overLimit" class="limit">{{ overLimit }}</span>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <template v-if="result">
      <div class="meta">
        <span>생성자(<code>cr</code>): <strong class="mono">{{ result.cr || '(없음)' }}</strong></span>
        <span>
          권한 출처:
          <strong>{{
            result.source === 'own'
              ? '이 리소스의 acpi'
              : result.source === 'inherited'
                ? '조상에서 상속'
                : result.source === 'override'
                  ? '가정한 값'
                  : 'acpi 없음 (기본 정책)'
          }}</strong>
          <template v-if="result.inherited_from">
            — <code class="mono">{{ result.inherited_from }}</code>
          </template>
        </span>
      </div>

      <p v-if="result.source === 'inherited'" class="banner warnbox">
        이 리소스에는 <code>acpi</code> 가 없어 <strong>조상의 것을 씁니다.</strong>
        컨테이너의 <code>acpi</code> 는 조상과 합쳐지지 않고 <strong>가장 가까운 것 하나만</strong>
        쓰이므로, 중간 컨테이너에 <code>acpi</code> 가 생기면 AE 의 ACP 를 고쳐도 먹지 않습니다.
      </p>

      <p v-if="creatorPasses > 0" class="banner warnbox">
        <strong>생성자는 ACP 와 무관하게 통과합니다.</strong>
        아래에서 {{ creatorPasses }}칸이 그렇습니다. 어떤 ACP 를 걸어도
        <code class="mono">{{ result.cr }}</code> 는 남으므로, 이 리소스를
        “완전히 잠갔다”고 할 수 없습니다.
      </p>

      <div class="table-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th>원본 \ 연산</th>
              <th v-for="o in resultOps" :key="o">{{ o }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="og in resultOrigins" :key="og">
              <th class="mono rowh">{{ og }}</th>
              <td v-for="o in resultOps" :key="o">
                <div
                  v-if="cell(og, o)"
                  class="verdict"
                  :class="[cell(og, o)!.allowed ? 'yes' : 'no', cell(og, o)!.decided_by]"
                  :title="DECIDED_BY_LABEL[cell(og, o)!.decided_by] ?? cell(og, o)!.decided_by"
                >
                  <span class="mark">{{ cell(og, o)!.allowed ? '허용' : '거부' }}</span>
                  <span class="why">{{ cell(og, o)!.decided_by }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <details class="legend">
        <summary>판정 근거 읽는 법</summary>
        <dl>
          <template v-for="(v, k) in DECIDED_BY_LABEL" :key="k">
            <dt><code>{{ k }}</code></dt>
            <dd>{{ v }}</dd>
          </template>
        </dl>
      </details>

      <div v-if="result.warnings?.length" class="banner warnbox">
        <div v-for="(w, i) in result.warnings" :key="i">
          <code>{{ w.rule }}</code> {{ w.message }}
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 78ch; }
.err { color: var(--danger); margin-top: 0.8rem; }

.form {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 1.2rem 1.4rem;
  display: grid;
  gap: 1rem;
  max-width: 900px;
}
.field { display: grid; gap: 0.35rem; }
.field > span { font-size: 0.88rem; color: var(--muted); font-weight: 600; }
.field input {
  font: inherit;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  width: 100%;
}
.ops { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.opbtn { padding: 0.3rem 0.7rem; font-size: 0.88rem; border-radius: 999px; }
.opbtn.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; }
.check input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); }
.check.off { color: var(--muted); }
.check.off em { font-style: normal; color: var(--warn); font-size: 0.9em; }
.actions { display: flex; align-items: center; gap: 1rem; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.limit { color: var(--danger); font-size: 0.92rem; }

.meta {
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
  margin: 1.3rem 0 0.6rem;
  font-size: 0.95rem;
  color: var(--muted);
}
.meta strong { color: var(--text-strong); }

.banner {
  padding: 0.85rem 1.1rem;
  border-radius: 0 8px 8px 0;
  margin: 0.8rem 0;
  font-size: 0.95rem;
  max-width: 88ch;
  background: var(--accent-wash);
  border-left: 3px solid var(--warn);
}

.table-wrap {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: auto;
  margin-top: 1rem;
}
/* 행 머리는 원본 ID(X-M2M-Origin)다. **대소문자를 구분하므로** 표 머리의
   uppercase 를 되돌린다 — 'Cplantops' 를 'CPLANTOPS' 로 보여 주면 관리자가
   틀린 값을 옮겨 적는다. 크기·색도 데이터로 읽히게 되돌린다. */
table.matrix th.rowh {
  text-align: left;
  font-family: var(--mono);
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.95rem;
  color: var(--text);
  position: static;
}
.verdict {
  display: grid;
  gap: 0.1rem;
  padding: 0.35rem 0.5rem;
  border-radius: 7px;
  min-width: 96px;
}
.verdict .mark { font-weight: 700; font-size: 0.92rem; }
.verdict .why { font-size: 0.74rem; opacity: 0.85; font-family: var(--mono); }
.verdict.yes { background: var(--ok-wash, rgba(46, 160, 118, 0.14)); color: var(--ok); }
.verdict.no { background: var(--danger-wash); color: var(--danger); }
/* 생성자·수퍼유저로 통과한 칸은 "ACP 가 허용한 것"이 아니라는 뜻이라 따로 칠한다. */
.verdict.creator, .verdict.superuser { background: var(--accent-wash); color: var(--accent-strong); }

.legend { margin-top: 1rem; font-size: 0.92rem; }
.legend summary { cursor: pointer; color: var(--muted); }
.legend dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0.6rem 0 0; }
.legend dt { font-family: var(--mono); }
.legend dd { margin: 0; color: var(--muted); }
</style>
