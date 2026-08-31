<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { confView, confSave } from '../api'
import type { ConfItem, ConfView as ConfViewData, WriteInfo } from '../types'

defineProps<{ write: WriteInfo }>()

const data = ref<ConfViewData | null>(null)
const loading = ref(true)
const error = ref('')
const problems = ref<string[]>([])
const saving = ref(false)
const savedKeys = ref<string[]>([])

/** 편집 중인 값. 키가 여기 있으면 파일 값과 다르게 만진 것이다. */
const draft = ref<Record<string, unknown>>({})

const items = computed(() => data.value?.items ?? [])

/**
 * 묶음을 무슨 순서로 보일 것인가. **소속은 코어가 정한다**(`describe().group`) —
 * 여기서 다시 적으면 표가 두 벌이 되어 언젠가 갈라진다. 순서와 설명 문구만
 * 화면의 몫이다.
 *
 * 여기 없는 묶음도 뒤에 그대로 붙는다. 코어가 새 분류를 만들었을 때 화면에서
 * 조용히 빠지는 것이 순서가 틀리는 것보다 나쁘다.
 */
const GROUP_ORDER = ['권한', '요청 처리', '저장소']
const GROUP_DESC: Record<string, string> = {
  '권한': '누가 무엇을 할 수 있는가. 잘못 두면 보호가 조용히 사라집니다.',
  '요청 처리': '들어오는 요청과 나가는 요청의 한도.',
  '저장소': '어디에 저장하고 얼마나 보관하는가.',
}
/** 코어가 group 을 안 준 키가 갈 곳. 숨기지 않는다. */
const UNGROUPED = '기타'

const grouped = computed(() => {
  const bucket = new Map<string, ConfItem[]>()
  items.value.forEach((i) => {
    const g = (i.group || '').trim() || UNGROUPED
    if (!bucket.has(g)) bucket.set(g, [])
    bucket.get(g)!.push(i)
  })

  const names = [...bucket.keys()].sort((a, b) => {
    // 아는 순서 먼저, 모르는 것은 뒤에 이름순. 기타는 언제나 맨 끝.
    if (a === UNGROUPED) return 1
    if (b === UNGROUPED) return -1
    const ia = GROUP_ORDER.indexOf(a)
    const ib = GROUP_ORDER.indexOf(b)
    if (ia >= 0 && ib >= 0) return ia - ib
    if (ia >= 0) return -1
    if (ib >= 0) return 1
    return a.localeCompare(b, 'ko')
  })

  return names.map((name) => ({
    id: name,
    label: name,
    desc:
      GROUP_DESC[name] ??
      (name === UNGROUPED
        ? '코어가 분류를 주지 않은 설정입니다. 새로 생긴 것일 수 있습니다.'
        : ''),
    items: bucket.get(name)!,
  }))
})

/** 바꾼 것만 보낸다 — 안 만진 키를 파일에 새로 쓰지 않는다. */
const patch = computed(() => {
  const out: Record<string, unknown> = {}
  items.value.forEach((i) => {
    if (!(i.key in draft.value)) return
    if (draft.value[i.key] === i.effective) return
    out[i.key] = draft.value[i.key]
  })
  return out
})
const dirtyKeys = computed(() => Object.keys(patch.value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await confView()
    draft.value = {}
    problems.value = []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function valueOf(i: ConfItem): unknown {
  return i.key in draft.value ? draft.value[i.key] : i.effective
}
function setValue(i: ConfItem, v: unknown) {
  draft.value = { ...draft.value, [i.key]: v }
  savedKeys.value = []
}
function reset(i: ConfItem) {
  const d = { ...draft.value }
  delete d[i.key]
  draft.value = d
}

async function save() {
  if (!dirtyKeys.value.length) return
  saving.value = true
  problems.value = []
  error.value = ''
  try {
    const r = await confSave(patch.value)
    savedKeys.value = r.changed.map((c) => c.key)
    await load()
  } catch (e) {
    // 서버가 problems 를 실어 보내면 그대로 띄운다 — 어느 값이 왜 안 되는지.
    const anyE = e as { message?: string } & { problems?: string[] }
    problems.value = anyE.problems ?? []
    if (!problems.value.length) error.value = anyE.message ?? String(e)
  } finally {
    saving.value = false
  }
}

const APPLY_LABEL: Record<string, string> = {
  runtime: '즉시 반영',
  reload: '재기동 없이 반영 가능',
  restart: '재기동 후 반영',
}

/** 바이트로 저장하지만 사람은 MB 로 읽고 쓴다. */
const BYTE_KEYS = new Set(['maxBodyBytes'])
function toMB(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return String(Math.round((n / 1048576) * 100) / 100)
}
function fromMB(s: string): number {
  return Math.round(Number(s) * 1048576)
}

/**
 * 배포에서 실제로 본 가장 큰 본문.
 *
 * **표본값이다.** 5,740만 행 중 400만 행을 키 공간 양끝에서 뽑아 잰 것이고,
 * 풀스캔은 운영에 부담이라 하지 않았다. 그래서 "이보다 크게 잡으면 안전" 이
 * 아니라 "이보다 작게 잡으면 확실히 막힌다" 로 읽어야 한다.
 */
const OBSERVED_MAX_BODY = 4058640

/** 지금 값이 실측 표본 대비 얼마나 여유가 있는가. 숫자를 보고 고르게 한다. */
function headroom(v: unknown): { pct: number; tight: boolean; below: boolean } | null {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  const pct = Math.round(((n - OBSERVED_MAX_BODY) / OBSERVED_MAX_BODY) * 100)
  return { pct, tight: pct < 50, below: n < OBSERVED_MAX_BODY }
}

/** 저장하면 무엇이 필요한가 — dirty 한 키들의 적용 시점을 모은다. */
const needed = computed(() => {
  const set = new Set(
    items.value.filter((i) => dirtyKeys.value.includes(i.key)).map((i) => i.apply),
  )
  return { restart: set.has('restart'), reload: set.has('reload'), runtime: set.has('runtime') }
})

onMounted(load)
</script>

<template>
  <section>
    <h2>서버 설정</h2>
    <p class="lead">
      <code>conf.json</code> 의 값입니다. 여기 없는 키는 화면에서 고치지 않습니다 —
      비밀(<code>dbpass</code> 등)과 포트·주소는 잘못 넣으면 되돌릴 길이 없습니다.
    </p>

    <!-- 이 화면에서 가장 중요한 문장이다. 저장이 곧 적용이 아니다. -->
    <div class="banner warnbox">
      <strong>저장은 파일을 고치는 것이고, 곧바로 적용되는 것이 아닙니다.</strong>
      <p>
        Mobius 는 <code>conf.json</code> 을 <strong>기동할 때</strong> 읽습니다. 게다가
        워커가 죽고 되살아나면 <strong>그 워커만</strong> 새 파일을 읽으므로, 재기동 없이
        두면 워커마다 값이 달라질 수 있습니다.
      </p>
      <p v-if="data && !data.runtimeKnown" class="unknown">
        <strong>그래서 이 화면은 “지금 도는 서버의 값”을 말하지 않습니다.</strong>
        아래는 전부 <em>파일에 적힌 값</em>입니다. 워커별 실제 값을 조회하는 경로가
        준비되면 여기에 “25개 중 18개는 observe” 처럼 표시됩니다.
      </p>
    </div>

    <p v-if="!write.enabled" class="banner danger">
      조회 전용으로 떠 있습니다. 저장하려면 <code>conf.json</code> 에
      <code>csebaseport</code> 를 넣어 Mobius 주소를 알려 주세요.
    </p>

    <p v-if="loading" class="muted">불러오는 중…</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="problems.length" class="banner danger">
      <strong>저장하지 않았습니다.</strong>
      <div v-for="(p, i) in problems" :key="i" class="prob">{{ p }}</div>
      <p class="note">하나라도 올바르지 않으면 아무것도 쓰지 않습니다.</p>
    </div>

    <p v-if="savedKeys.length" class="banner ok">
      저장했습니다 — {{ savedKeys.join(', ') }}.
      <strong>반영은 위 설명대로입니다.</strong>
    </p>

    <div v-for="g in grouped" :key="g.id" class="group">
      <div class="ghead">
        <h3>{{ g.label }}</h3>
        <span class="gcount">{{ g.items.length }}</span>
        <span
          v-if="g.items.some((x) => x.danger)"
          class="gdanger"
          :title="'위험한 값으로 설정된 항목이 있습니다'"
        >주의</span>
        <span v-if="g.items.some((x) => dirtyKeys.includes(x.key))" class="gdirty">수정됨</span>
      </div>
      <p class="gdesc">{{ g.desc }}</p>

      <div class="items">
      <div
        v-for="i in g.items"
        :key="i.key"
        class="item"
        :class="{ danger: i.danger, dirty: dirtyKeys.includes(i.key) }"
      >
        <div class="head">
          <strong>{{ i.label }}</strong>
          <code class="k">{{ i.key }}</code>
          <span class="apply" :class="i.apply">{{ APPLY_LABEL[i.apply] ?? i.apply }}</span>
          <span v-if="i.apply === 'reload' && i.reloadWith" class="reloadwith">
            {{ i.reloadWith }} 재호출 필요
          </span>
          <span v-if="i.usingDefault" class="pill">파일에 없음 · 기본값 사용</span>
          <span v-if="i.readOnly" class="pill ro">읽기 전용</span>
        </div>

        <p class="help">{{ i.help }}</p>

        <div class="control">
          <!-- enum -->
          <select
            v-if="i.choices && !i.readOnly"
            :value="valueOf(i)"
            :disabled="!write.enabled"
            @change="setValue(i, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="c in i.choices" :key="c" :value="c">{{ c }}</option>
          </select>

          <!-- 바이트 값은 MB 로 받는다. 10485760 을 손으로 치게 하면 자릿수를 틀린다. -->
          <template v-else-if="BYTE_KEYS.has(i.key) && !i.readOnly">
            <input
              class="num"
              type="number"
              step="0.5"
              :value="toMB(valueOf(i))"
              :disabled="!write.enabled"
              @input="setValue(i, fromMB(($event.target as HTMLInputElement).value))"
            />
            <span class="unit">MB</span>
            <span class="bytes mono">= {{ Number(valueOf(i)).toLocaleString() }} B</span>
          </template>

          <!-- 값 자체보다 "실측에 비해 얼마나 여유가 있나" 가 판단 재료다.
               숫자를 보여 주고 관리자가 고르게 한다. -->
          <span
            v-if="BYTE_KEYS.has(i.key) && headroom(valueOf(i))"
            class="headroom"
            :class="{ below: headroom(valueOf(i))!.below, tight: headroom(valueOf(i))!.tight }"
          >
            <template v-if="headroom(valueOf(i))!.below">
              실측 표본 최대보다 작습니다 — 그 쓰기가 곧바로 413 이 됩니다
            </template>
            <template v-else>여유 {{ headroom(valueOf(i))!.pct }}%</template>
          </span>

          <!-- 그 밖의 수 -->
          <input
            v-else-if="i.type === 'number' && !i.readOnly"
            class="num"
            type="number"
            :step="i.integer ? 1 : 'any'"
            :value="valueOf(i)"
            :disabled="!write.enabled"
            @input="setValue(i, Number(($event.target as HTMLInputElement).value))"
          />

          <!-- readOnly 이거나 다룰 수 없는 형태 -->
          <code v-else class="ro-val">{{ JSON.stringify(valueOf(i)) }}</code>

          <button v-if="dirtyKeys.includes(i.key)" class="undo" @click="reset(i)">되돌리기</button>
        </div>

        <p v-if="i.validHint" class="hint">{{ i.validHint }}</p>
        <p v-if="BYTE_KEYS.has(i.key)" class="hint">
          기준이 되는 {{ OBSERVED_MAX_BODY.toLocaleString() }} B 는
          <strong>표본값</strong>입니다 — 5,740만 행 중 400만 행을 뽑아 잰 것이고
          풀스캔은 하지 않았습니다. 실제 최대는 이보다 클 수 있으니,
          “이보다 크면 안전”이 아니라 <strong>“이보다 작으면 확실히 막힌다”</strong>로
          읽으세요.
        </p>
        <p v-if="i.danger" class="dangernote">
          이 값은 켠 채로 두면 보호가 무력해집니다.
        </p>
      </div>
      </div>
    </div>

    <div v-if="data?.unknownKeys?.length" class="banner warnbox">
      <strong>이 화면이 모르는 키가 {{ data.unknownKeys.length }}개 있습니다.</strong>
      <code class="mono">{{ data.unknownKeys.join(', ') }}</code>
      <p class="note">
        건드리지 않고 그대로 둡니다. 다른 세션이나 사람이 넣은 것일 수 있습니다.
      </p>
    </div>

    <div v-if="data?.secrets?.length" class="secrets">
      <h3>화면에 값을 띄우지 않는 것</h3>
      <p class="note">
        여기 값이 새면 되돌릴 수 없습니다. <code>superUser</code> 는 아는 사람이 권한을
        전부 우회하고, <code>adminPassword</code> 는 이 콘솔 자신의 인증입니다.
      </p>
      <ul>
        <li v-for="s in data.secrets" :key="s.key">
          <code>{{ s.key }}</code>
          <span :class="s.present ? 'set' : 'unset'">
            {{ s.present ? '설정됨' : '없음' }}
          </span>
        </li>
      </ul>
    </div>

    <div class="actions">
      <button
        class="primary"
        :disabled="!write.enabled || !dirtyKeys.length || saving"
        @click="save"
      >
        {{ saving ? '저장 중…' : `저장 (${dirtyKeys.length}건)` }}
      </button>
      <span v-if="dirtyKeys.length" class="willneed">
        저장하면 —
        <template v-if="needed.restart"><strong>Mobius 재기동이 필요합니다.</strong></template>
        <template v-else-if="needed.reload">재기동 없이 반영할 수 있지만 해당 모듈을 다시 불러야 합니다.</template>
        <template v-else>다음 요청부터 반영됩니다.</template>
      </span>
      <span class="spacer" />
      <button :disabled="loading" @click="load">다시 읽기</button>
    </div>

    <p class="src muted">파일: <code class="mono">{{ data?.file }}</code></p>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h3 { margin: 0 0 0.4rem; font-size: 1rem; color: var(--text-strong); }
.lead { margin: 0 0 1.2rem; color: var(--muted); font-size: 1.02rem; max-width: 80ch; }
.err { color: var(--danger); }
.muted { color: var(--muted); }
.note { color: var(--muted); font-size: 0.9rem; margin: 0.4rem 0 0; }

.banner { padding: 0.9rem 1.15rem; border-radius: 0 10px 10px 0; margin: 0 0 1.2rem; max-width: 88ch; font-size: 0.95rem; }
.banner.warnbox { background: var(--accent-wash); border-left: 3px solid var(--warn); }
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.banner.ok { background: rgba(46, 160, 118, 0.12); border-left: 3px solid var(--ok); }
.banner p { margin: 0.5rem 0 0; }
.banner .unknown { color: var(--danger); }
.prob { margin-top: 0.3rem; color: var(--danger); }

.group { margin-bottom: 1.8rem; max-width: 92ch; }
.ghead { display: flex; align-items: baseline; gap: 0.5rem; }
.ghead h3 { margin: 0; font-size: 1.15rem; color: var(--text-strong); }
.gcount {
  font-size: 0.78rem; color: var(--muted);
  border: 1px solid var(--border); border-radius: 999px; padding: 0.02rem 0.45rem;
}
.gdanger {
  font-size: 0.75rem; font-weight: 700; color: #fff;
  background: var(--danger); border-radius: 4px; padding: 0.05rem 0.4rem;
}
.gdirty {
  font-size: 0.75rem; font-weight: 700; color: #fff;
  background: var(--accent); border-radius: 4px; padding: 0.05rem 0.4rem;
}
.gdesc { margin: 0.25rem 0 0.7rem; font-size: 0.92rem; color: var(--muted); }

.items { display: grid; gap: 0.8rem; max-width: 92ch; }
.item {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 11px;
  box-shadow: var(--shadow);
  padding: 0.9rem 1.1rem;
}
.item.danger { border-left: 3px solid var(--danger); }
.item.dirty { border-color: var(--accent); background: var(--accent-wash); }

.head { display: flex; align-items: baseline; gap: 0.55rem; flex-wrap: wrap; }
.head strong { color: var(--text-strong); }
.head .k { font-size: 0.85rem; color: var(--muted); }
.apply { font-size: 0.75rem; padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.apply.runtime { border-color: var(--ok); color: var(--ok); }
.apply.reload { border-color: var(--warn); color: var(--warn); }
.apply.restart { border-color: var(--danger); color: var(--danger); }
.reloadwith { font-size: 0.78rem; color: var(--muted); font-family: var(--mono); }
.pill { font-size: 0.75rem; padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px dashed var(--border); color: var(--muted); }
.pill.ro { border-style: solid; }

.help { margin: 0.45rem 0 0.6rem; font-size: 0.93rem; color: var(--text); max-width: 82ch; }
.control { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.control select, .control input {
  font: inherit; padding: 0.35rem 0.6rem;
  border: 1px solid var(--border); border-radius: 7px;
  background: var(--bg); color: var(--text);
}
.control .num { width: 9rem; }
.unit { color: var(--muted); font-size: 0.9rem; }
.bytes { color: var(--muted); font-size: 0.85rem; }
.headroom { font-size: 0.85rem; color: var(--ok); font-weight: 600; }
.headroom.tight { color: var(--warn); }
.headroom.below { color: var(--danger); }
.ro-val { font-size: 0.9rem; color: var(--muted); overflow-wrap: anywhere; }
.undo { font-size: 0.85rem; padding: 0.2rem 0.6rem; }
.hint { margin: 0.4rem 0 0; font-size: 0.85rem; color: var(--muted); }
.dangernote { margin: 0.35rem 0 0; font-size: 0.88rem; color: var(--danger); }

.secrets {
  margin-top: 1.4rem; padding: 0.9rem 1.15rem;
  background: var(--panel); border: 1px solid var(--border); border-radius: 11px;
  max-width: 88ch;
}
.secrets ul { margin: 0.6rem 0 0; padding-left: 1.1rem; }
.secrets li { margin-bottom: 0.2rem; font-size: 0.93rem; }
.secrets .set { color: var(--ok); margin-left: 0.5rem; font-weight: 600; }
.secrets .unset { color: var(--warn); margin-left: 0.5rem; }

.actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.4rem; flex-wrap: wrap; }
.actions .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.actions .primary:disabled { opacity: 0.5; }
.actions .spacer { flex: 1; }
.willneed { font-size: 0.93rem; color: var(--muted); }
.src { font-size: 0.85rem; margin-top: 1rem; }
</style>
