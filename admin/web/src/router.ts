import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import ExpiredView from './views/ExpiredView.vue'
import OrphanView from './views/OrphanView.vue'
import AcpProblemsView from './views/AcpProblemsView.vue'
import AcpListView from './views/AcpListView.vue'
import AcpSimulateView from './views/AcpSimulateView.vue'
import AcpEditView from './views/AcpEditView.vue'
import AcpCreateView from './views/AcpCreateView.vue'
import AcpAttachView from './views/AcpAttachView.vue'
import SubsView from './views/SubsView.vue'
import StatsView from './views/StatsView.vue'
import JobsView from './views/JobsView.vue'
import SelfTestPlaceholderView from './views/SelfTestPlaceholderView.vue'

/** 왼쪽 내비의 묶음. 순서가 곧 화면 순서다. */
// 묶음 id 는 라우트 이름·경로의 접두(judge-*, observe-* …)와 같이 두고 **라벨만** 화면 말로
// 바꾼다(사용자 결정 2026-09-07: 현황 → 리소스 관리 → 접근권한 → 구독 → 검증). 경로를 바꾸면
// 문서와 북마크가 깨지므로 접근권한 묶음(acl)도 judge-acp-* 라우트를 그대로 쓴다.
export const GROUPS: { id: string; label: string }[] = [
  { id: 'observe', label: '현황' },
  { id: 'judge', label: '리소스 관리' },
  { id: 'acl', label: '접근권한' },
  { id: 'subs', label: '구독' },
  { id: 'verify', label: '검증' },
]

/** 내비에 보이는 화면. 편집·생성·연결처럼 목록에서 들어가는 화면은 여기 없다. */
export const NAV: { name: string; group: string; label: string }[] = [
  { name: 'observe-stats', group: 'observe', label: '통계' },
  { name: 'observe-jobs', group: 'observe', label: '작업' },
  { name: 'judge-expired', group: 'judge', label: '만료 리소스' },
  // 라우트 이름·경로의 orphan 은 그대로 두고 화면 말만 '미연결' 이다(사용자 결정 2026-09-07).
  { name: 'judge-orphans', group: 'judge', label: '미연결 리소스' },
  { name: 'judge-acp-problems', group: 'acl', label: 'ACP 문제' },
  { name: 'judge-acp-list', group: 'acl', label: 'ACP 목록' },
  { name: 'judge-acp-sim', group: 'acl', label: 'ACP 테스트' },
  { name: 'subs-endpoints', group: 'subs', label: '엔드포인트' },
  { name: 'verify-selftest', group: 'verify', label: '종합 테스트' },
]

const ri = (r: { params: { ri?: string | string[] } }) => {
  const v = Array.isArray(r.params.ri) ? r.params.ri[0] : r.params.ri
  return v ? decodeURIComponent(v) : null
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/judge/expired' },
  { path: '/judge/expired', name: 'judge-expired', component: ExpiredView },
  { path: '/judge/orphans', name: 'judge-orphans', component: OrphanView },
  { path: '/judge/acp/problems', name: 'judge-acp-problems', component: AcpProblemsView },
  { path: '/judge/acp', name: 'judge-acp-list', component: AcpListView, props: (r) => ({ selected: r.query.ri ? String(r.query.ri) : null }) },
  { path: '/judge/acp/edit/:ri', name: 'judge-acp-edit', component: AcpEditView, props: (r) => ({ ri: ri(r) }) },
  { path: '/judge/acp/create', name: 'judge-acp-create', component: AcpCreateView },
  { path: '/judge/acp/attach/:ri?', name: 'judge-acp-attach', component: AcpAttachView, props: (r) => ({ initialRi: ri(r) }) },
  { path: '/judge/acp/simulate/:ri?', name: 'judge-acp-sim', component: AcpSimulateView, props: (r) => ({ initialRi: ri(r) }) },
  { path: '/subs', name: 'subs-endpoints', component: SubsView },
  { path: '/observe/stats', name: 'observe-stats', component: StatsView },
  { path: '/observe/jobs', name: 'observe-jobs', component: JobsView },
  { path: '/verify/selftest', name: 'verify-selftest', component: SelfTestPlaceholderView },
  { path: '/:pathMatch(.*)*', redirect: '/judge/expired' },
]

export const router = createRouter({ history: createWebHashHistory(), routes })

/** ri 를 라우트 파라미터로. 슬래시가 들어 있으므로 반드시 인코딩한다. */
export function riParam(ri: string): string {
  return encodeURIComponent(ri)
}
