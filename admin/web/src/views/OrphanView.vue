<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { orphanSummary, orphanPage, fmtTime } from '../api'
import type { OrphanRow, OrphanSummary } from '../types'

const summary = ref<OrphanSummary | null>(null)
const rows = ref<OrphanRow[]>([])
const more = ref(false)
const nextRi = ref<string | null>(null)
const scanned = ref(0)
const scanCapped = ref(false)
const typeNames = ref<Record<string, string>>({})
const loading = ref(false)
const counting = ref(false)
const error = ref('')

const PAGE = 50

function typeLabel(ty: number): string {
  const raw = typeNames.value?.[String(ty)] ?? ''
  if (!raw) return `ty${ty}`
  const bare = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
  return bare.toUpperCase()
}

/** 고아의 부모 경로에서 "어느 서브트리의 잔해인가" 를 읽어낸다. */
function rootOf(pi: string): string {
  const parts = pi.split('/').filter(Boolean)
  return parts.length >= 2 ? '/' + parts.slice(0, 2).join('/') : pi
}

async function loadSummary() {
  counting.value = true
  error.value = ''
  try {
    summary.value = await orphanSummary(5000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    counting.value = false
  }
}

async function loadFirst() {
  loading.value = true
  error.value = ''
  try {
    const p = await orphanPage({ limit: PAGE })
    rows.value = p.rows
    more.value = p.more
    nextRi.value = p.nextRi
    scanned.value = p.scanned
    scanCapped.value = p.scanCapped
    typeNames.value = p.typeNames
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
    const p = await orphanPage({ limit: PAGE, afterRi: nextRi.value })
    rows.value = rows.value.concat(p.rows)
    more.value = p.more
    nextRi.value = p.nextRi
    scanned.value += p.scanned
    scanCapped.value = p.scanCapped
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadFirst()
  await loadSummary()
})
</script>

<template>
  <section>
    <h2>고아 리소스</h2>
    <p class="lead">
      부모(<code>pi</code>)가 <code>lookup</code> 에 없는 행입니다. 트리에서 도달할 수 없지만
      DB 에는 남아 공간을 차지하고, 컨테이너 카운터를 어긋나게 합니다.
    </p>

    <div class="why">
      <strong>왜 생기는가</strong>
      <p>
        <code>DELETE</code> 는 루트 행만 지우고 <code>200</code> 을 돌려준 뒤 자손을 배경에서
        지웁니다. 그 도중 프로세스가 죽거나, 커넥션을 못 빌리거나(1분간 12회 실패하면 포기),
        대형 서브트리가 쿼리 타임아웃에 걸리면 남은 자손이 통째로 고아가 됩니다.
        이 서버의 정상 실패 모드이지 이상 현상이 아닙니다.
      </p>
      <p>
        정리는 자동으로 돌지 않습니다. 5,740만 행에서 한 패스가 배치 11,000회이고
        그동안 DB 커넥션 하나를 계속 붙잡기 때문에, 실행 시점을 관리자가 정하도록 남겨 두었습니다.
      </p>
    </div>

    <div class="caution">
      <strong>아래 숫자는 “끊긴 지점”의 개수입니다 — 도달 불가 데이터의 총량이 아닙니다.</strong>
      <p>
        고아 판정은 <em>직계 부모가 없는 행</em>입니다. 끊긴 지점 아래에 있는 행들은 자기
        부모가 멀쩡히 있으므로 고아로 세지지 않지만, 위가 끊겼으니 <strong>똑같이 트리에서
        도달할 수 없습니다.</strong> 끊긴 컨테이너 하나 아래에 CIN 수백만 건이 있을 수 있습니다.
      </p>
      <p>
        정리가 여러 패스를 도는 이유가 이것입니다 — 한 패스가 끊긴 지점을 지우면 그 자식들이
        다음 패스에서 새로 고아가 됩니다.
      </p>
    </div>

    <div class="tiles">
      <div class="tile">
        <div class="k">끊긴 지점</div>
        <div class="v">
          <template v-if="counting">…</template>
          <template v-else-if="summary">
            {{ summary.count.toLocaleString() }}<span v-if="summary.capped">+</span>
          </template>
          <template v-else>—</template>
        </div>
        <div class="s" v-if="summary?.capped">
          {{ summary.cap.toLocaleString() }}건에서 세기를 멈췄습니다
        </div>
        <div class="s" v-else-if="summary">전수 확인</div>
        <div class="s" v-else>세는 중…</div>
      </div>
      <div class="tile">
        <div class="k">훑은 행</div>
        <div class="v">{{ scanned.toLocaleString() }}</div>
        <div class="s" :class="{ warn: scanCapped }">
          {{ scanCapped ? '훑기 상한에 걸림 — 뒤에 더 있을 수 있음' : '테이블 끝까지 확인' }}
        </div>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="rows.length" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>고아 경로 (ri)</th>
            <th>타입</th>
            <th>사라진 부모 (pi)</th>
            <th>어느 서브트리</th>
            <th>생성 (ct)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.ri">
            <td class="mono path">{{ r.ri }}</td>
            <td><span class="ty">{{ typeLabel(r.ty) }}</span></td>
            <td class="mono path missing">{{ r.pi }}</td>
            <td class="mono root">{{ rootOf(r.pi) }}</td>
            <td class="mono muted">{{ fmtTime(r.ct) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else-if="!loading" class="empty">
      고아 리소스가 없습니다.
      <span v-if="scanCapped">(훑기 상한까지는 — 뒤에 더 있을 수 있습니다)</span>
    </p>

    <div class="footer">
      <button v-if="more" :disabled="loading" @click="loadMore">
        {{ loading ? '훑는 중…' : `더 찾기 (${PAGE}건)` }}
      </button>
      <button :disabled="counting" @click="loadSummary">
        {{ counting ? '세는 중…' : '다시 세기' }}
      </button>
      <span class="muted">{{ rows.length }}건 표시 중<template v-if="more"> · 더 있음</template></span>
    </div>

    <p class="next">
      정리 실행은 다음 단계에서 붙입니다. 전부 지우는 단일 연산이고 수십 초가 걸려,
      요청-응답 안에서 끝낼 수 없습니다 — 진행률을 보여 주는 비동기 작업으로 만들어야 합니다.
      만료 리소스 삭제도 같은 작업 엔진을 씁니다.
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
.lead { margin: 0 0 1.2rem; color: var(--muted); font-size: 1.02rem; max-width: 72ch; }
.err { color: var(--danger); font-size: 1rem; }
.empty { color: var(--muted); padding: 3rem 0; text-align: center; font-size: 1.05rem; }

.why {
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--warn);
  border-radius: 0 10px 10px 0;
  padding: 1rem 1.2rem;
  margin-bottom: 1.4rem;
  max-width: 82ch;
}
.why strong { display: block; margin-bottom: 0.4rem; color: var(--text-strong); }
.why p { margin: 0 0 0.6rem; font-size: 0.95rem; }
.why p:last-child { margin-bottom: 0; }

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
.next {
  margin-top: 1rem;
  padding: 1rem 1.2rem;
  border-left: 3px solid var(--accent);
  background: var(--accent-wash);
  border-radius: 0 8px 8px 0;
  color: var(--text);
  font-size: 0.95rem;
  max-width: 78ch;
}
</style>
