<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { acpList, acpDetail, acpAudit, fmtTime } from '../api'
import AcpPolicyNote from '../components/AcpPolicyNote.vue'
import type { AcpListRow, AcpDetailResponse, AcpAuditRow, AcpRule, WriteInfo } from '../types'

const props = defineProps<{ selected?: string | null; write: WriteInfo }>()
const emit = defineEmits<{ simulate: [ri: string]; edit: [ri: string] }>()

const rows = ref<AcpListRow[]>([])
const more = ref(false)
const nextRi = ref<string | null>(null)
const loading = ref(false)
const error = ref('')

const openRi = ref<string | null>(null)
const detail = ref<AcpDetailResponse | null>(null)
const audit = ref<AcpAuditRow[]>([])
const auditError = ref('')
const detailLoading = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const p = await acpList({ limit: 100 })
    rows.value = p.rows
    more.value = p.more
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
    const p = await acpList({ limit: 100, afterRi: nextRi.value })
    rows.value = rows.value.concat(p.rows)
    more.value = p.more
    nextRi.value = p.nextRi
  } finally {
    loading.value = false
  }
}

async function open(ri: string) {
  openRi.value = ri
  detail.value = null
  audit.value = []
  auditError.value = ''
  detailLoading.value = true
  try {
    detail.value = await acpDetail(ri)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    detailLoading.value = false
  }
  try {
    audit.value = (await acpAudit({ ri, limit: 20 })).rows
  } catch (e) {
    // 이력이 없다고 상세를 못 보게 하지 않는다. 마이그레이션 전일 수 있다.
    auditError.value = e instanceof Error ? e.message : String(e)
  }
}

function close() {
  openRi.value = null
  detail.value = null
}

/** acop 비트를 사람이 읽을 이름으로. 이게 없으면 63 이 무슨 뜻인지 알 수 없다. */
const OPS: [number, string][] = [
  [1, 'CREATE'],
  [2, 'RETRIEVE'],
  [4, 'UPDATE'],
  [8, 'DELETE'],
  [16, 'NOTIFY'],
  [32, 'DISCOVERY'],
]
function acopNames(acop: number | string | undefined): string[] {
  const n = Number(acop)
  if (!Number.isFinite(n)) return []
  return OPS.filter(([bit]) => (n & bit) === bit).map(([, name]) => name)
}

function acorText(r: AcpRule): string {
  if (!r.acor) return '(제한 없음 — 누구나)'
  if (!r.acor.length) return '(빈 목록 — 아무도)'
  return r.acor.join(', ')
}

watch(
  () => props.selected,
  (ri) => {
    if (ri) open(ri)
  },
)

onMounted(async () => {
  await load()
  if (props.selected) open(props.selected)
})
</script>

<template>
  <section>
    <h2>ACP 목록</h2>
    <p class="lead">
      접근제어정책(<code>accessControlPolicy</code>) 리소스입니다. 리소스의
      <code>acpi</code> 가 이것을 가리켜야 효력이 있습니다.
    </p>

    <AcpPolicyNote />

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="rows.length" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>경로 (ri)</th>
            <th>이름</th>
            <th>생성 (ct)</th>
            <th>수정 (lt)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.ri" :class="{ picked: openRi === r.ri }">
            <td class="mono path">
              <button class="linkish" @click="open(r.ri)">{{ r.ri }}</button>
            </td>
            <td class="mono">{{ r.rn }}</td>
            <td class="mono muted">{{ fmtTime(r.ct) }}</td>
            <td class="mono muted">{{ fmtTime(r.lt) }}</td>
            <td>
              <button class="small" @click="emit('simulate', r.ri)">시뮬레이터</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" class="empty">ACP 리소스가 없습니다.</p>

    <div class="footer">
      <button v-if="more" :disabled="loading" @click="loadMore">다음 100건</button>
      <span class="muted">{{ rows.length }}건</span>
    </div>

    <!-- 상세 -->
    <div v-if="openRi" class="drawer">
      <div class="dhead">
        <strong class="mono">{{ openRi }}</strong>
        <span class="spacer" />
        <button
          v-if="detail?.detail.is_acp !== false"
          :disabled="!write.enabled"
          :title="write.enabled ? '' : '조회 전용으로 떠 있습니다'"
          @click="emit('edit', openRi)"
        >
          편집
        </button>
        <button @click="emit('simulate', openRi)">시뮬레이터로</button>
        <button @click="close">닫기</button>
      </div>

      <p v-if="detailLoading" class="muted">불러오는 중…</p>

      <template v-if="detail">
        <p v-if="detail.detail.is_acp === false" class="banner danger">
          <strong>이 경로는 ACP 가 아닙니다.</strong> 접근제어정책(<code>ty=1</code>)이
          아닌 리소스라 권한 규칙이 없습니다. 이 리소스에 <em>걸린</em> 권한을 보려면
          시뮬레이터를 쓰세요.
        </p>
        <p v-else-if="detail.detail.body_missing" class="banner danger">
          <strong>본문이 없습니다.</strong> <code>lookup</code> 에는 있는데
          <code>acp</code> 테이블에 행이 없는 반쪽입니다. 이 ACP 를 참조하는 리소스는
          평가에서 “참조한 ACP 를 못 찾음”이 되어 <strong>잠금이 조용히 풀립니다.</strong>
        </p>

        <div v-if="detail.problems.length" class="banner warnbox">
          <div v-for="(p, i) in detail.problems" :key="i" class="prob">
            <span class="sev" :class="p.severity">{{ p.severity === 'error' ? '오류' : '경고' }}</span>
            <code class="rule">{{ p.rule }}</code>
            <span>{{ p.message }}</span>
            <code v-if="p.path" class="at">{{ p.path }}</code>
          </div>
        </div>

        <div class="cols">
          <div class="col">
            <h4>pv — 이 ACP 가 지키는 리소스의 권한</h4>
            <div v-if="!detail.detail.pv_parsed?.acr?.length" class="none">
              규칙이 없습니다 — 생성자만 통과합니다.
            </div>
            <div v-for="(r, i) in detail.detail.pv_parsed?.acr ?? []" :key="i" class="rule-card">
              <div class="who">{{ acorText(r) }}</div>
              <div class="ops">
                <span v-for="o in acopNames(r.acop)" :key="o" class="op">{{ o }}</span>
                <span v-if="!acopNames(r.acop).length" class="op none">
                  {{ r.acop === undefined ? 'acop 없음 (평가 시 HTTP 500)' : '권한 없음' }}
                </span>
              </div>
              <div v-if="r.acco?.length" class="acco">컨텍스트 제약 {{ r.acco.length }}건</div>
            </div>
          </div>

          <div class="col">
            <h4>pvs — 이 ACP 자신을 고칠 수 있는 권한</h4>
            <div v-if="!detail.detail.pvs_parsed?.acr?.length" class="none">
              규칙이 없습니다 — 수퍼유저 말고는 이 ACP 를 못 고칩니다.
            </div>
            <div v-for="(r, i) in detail.detail.pvs_parsed?.acr ?? []" :key="i" class="rule-card">
              <div class="who">{{ acorText(r) }}</div>
              <div class="ops">
                <span v-for="o in acopNames(r.acop)" :key="o" class="op">{{ o }}</span>
              </div>
            </div>
          </div>
        </div>

        <h4>이 ACP 를 쓰는 리소스</h4>
        <p v-if="detail.refsError" class="banner danger">
          <strong>확인하지 못했습니다.</strong> 참조가 없다는 뜻이 아닙니다 —
          이 상태로 ACP 를 지우면 무엇이 영향받는지 알 수 없습니다.
          <code>{{ detail.refsError }}</code>
        </p>
        <template v-else-if="detail.refs">
          <p class="muted small">
            {{ detail.refs.scanned.toLocaleString() }}행을 훑어
            {{ detail.refs.refs.length }}건.
            <span v-if="detail.refs.capped" class="warntext">훑기 상한에 걸림 — 더 있을 수 있음</span>
          </p>
          <ul v-if="detail.refs.refs.length" class="reflist">
            <li v-for="r in detail.refs.refs" :key="r.ri" class="mono">{{ r.ri }}</li>
          </ul>
          <p v-else class="none">
            아무도 이 ACP 를 쓰지 않습니다 — 걸어 두었지만 효력이 없는 상태입니다.
          </p>
        </template>

        <h4>그룹 팬아웃 참조 (grp.macp)</h4>
        <p v-if="detail.macpError" class="banner danger">
          <strong>확인하지 못했습니다 — “0건”이 아닙니다.</strong>
          fanOutPoint 는 <code>acpi</code> 가 아니라 <code>grp.macp</code> 로 판정합니다.
          이걸 모르는 채로 ACP 를 지우면 그룹 팬아웃이 조용히 잠깁니다.
          <code>{{ detail.macpError }}</code>
        </p>
        <template v-else-if="detail.macpRefs">
          <ul v-if="detail.macpRefs.refs.length" class="reflist">
            <li v-for="r in detail.macpRefs.refs" :key="r.ri" class="mono">{{ r.ri }}</li>
          </ul>
          <p v-else class="none">이 ACP 를 macp 로 쓰는 그룹이 없습니다.</p>
        </template>

        <h4>변경 이력</h4>
        <p v-if="auditError" class="muted small">{{ auditError }}</p>
        <table v-else-if="audit.length" class="audit">
          <thead>
            <tr><th>id</th><th>언제</th><th>무엇</th><th>누가</th><th>바뀐 값</th></tr>
          </thead>
          <tbody>
            <tr v-for="a in audit" :key="a.id">
              <td class="mono muted">{{ a.id }}</td>
              <td class="mono muted">{{ a.ts }}</td>
              <td><code>{{ a.op }}</code></td>
              <td class="mono">{{ a.origin }}</td>
              <td class="mono small diff">
                <template v-if="a.before || a.after">
                  <span class="before">{{ a.before ?? '—' }}</span> →
                  <span class="after">{{ a.after ?? '—' }}</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="none">이력이 없습니다.</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
h2 { margin: 0 0 0.4rem; font-size: 1.6rem; letter-spacing: -0.02em; color: var(--text-strong); }
h4 { margin: 1.4rem 0 0.5rem; font-size: 1rem; color: var(--text-strong); }
.lead { margin: 0 0 1.4rem; color: var(--muted); font-size: 1.02rem; max-width: 74ch; }
.err { color: var(--danger); }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; }
.none { color: var(--muted); font-size: 0.95rem; padding: 0.3rem 0; }
.muted { color: var(--muted); }
.small { font-size: 0.88rem; }
.warntext { color: var(--warn); font-weight: 600; }

.table-wrap {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: auto;
  max-height: 40vh;
}
.path { max-width: 460px; overflow-wrap: anywhere; font-size: 0.95rem; }
tr.picked td { background: var(--accent-wash); }
.linkish {
  border: none; background: none; padding: 0; font: inherit;
  color: var(--accent-strong); text-decoration: underline; cursor: pointer; text-align: left;
}
button.small { padding: 0.2rem 0.6rem; font-size: 0.85rem; }
.footer { display: flex; align-items: center; gap: 1rem; padding: 1rem 0; }

.drawer {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 1.2rem 1.4rem;
  margin-top: 1rem;
}
.dhead { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.8rem; }
.dhead .spacer { flex: 1; }

.banner {
  padding: 0.8rem 1rem;
  border-radius: 0 8px 8px 0;
  margin: 0.8rem 0;
  font-size: 0.95rem;
  max-width: 88ch;
}
.banner.danger { background: var(--danger-wash); border-left: 3px solid var(--danger); }
.banner.warnbox { background: var(--accent-wash); border-left: 3px solid var(--warn); }
.banner code { font-size: 0.88rem; overflow-wrap: anywhere; }

.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.2rem; }
.rule-card {
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0.7rem 0.9rem;
  margin-bottom: 0.6rem;
  background: var(--bg);
}
.rule-card .who { font-family: var(--mono); font-size: 0.95rem; margin-bottom: 0.4rem; }
.ops { display: flex; gap: 0.3rem; flex-wrap: wrap; }
.op {
  font-size: 0.78rem;
  font-weight: 600;
  border: 1px solid var(--accent);
  color: var(--accent-strong);
  background: var(--accent-wash);
  border-radius: 5px;
  padding: 0.08rem 0.4rem;
}
.op.none { border-color: var(--danger); color: var(--danger); background: var(--danger-wash); }
.acco { font-size: 0.85rem; color: var(--muted); margin-top: 0.35rem; }

.reflist { margin: 0.3rem 0; padding-left: 1.1rem; max-height: 180px; overflow: auto; }
.reflist li { font-size: 0.92rem; overflow-wrap: anywhere; }

.prob { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; padding: 0.12rem 0; }
.sev { font-size: 0.75rem; font-weight: 700; border-radius: 4px; padding: 0.05rem 0.4rem; }
.sev.error { background: var(--danger); color: #fff; }
.sev.warn { background: var(--warn); color: #fff; }
.rule { font-size: 0.85rem; color: var(--muted); }
.at { font-size: 0.85rem; color: var(--accent-strong); }

table.audit { font-size: 0.92rem; }
.diff { max-width: 380px; overflow-wrap: anywhere; }
.before { color: var(--muted); }
.after { color: var(--accent-strong); }
</style>
