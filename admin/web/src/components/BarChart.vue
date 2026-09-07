<script setup lang="ts">
import { computed } from 'vue'

/**
 * 인라인 SVG 세로 막대. 라이브러리를 들이지 않는다 — 통계 화면과 종합 테스트의
 * p50/p95 막대가 전부다. 마지막 막대(오늘·최신)를 강조하고, 값 0 도 자리를 지킨다.
 */
const props = withDefaults(
  defineProps<{ values: { label: string; value: number }[]; height?: number; unit?: string }>(),
  { height: 160, unit: '' },
)

const W = 640
const PAD = { l: 44, r: 8, t: 10, b: 26 }
const max = computed(() => Math.max(1, ...props.values.map((v) => v.value)))
const innerW = computed(() => W - PAD.l - PAD.r)
const innerH = computed(() => props.height - PAD.t - PAD.b)
const slot = computed(() => innerW.value / Math.max(1, props.values.length))
const bars = computed(() =>
  props.values.map((v, i) => {
    const h = (v.value / max.value) * innerH.value
    return {
      x: PAD.l + i * slot.value + slot.value * 0.15,
      w: slot.value * 0.7,
      y: PAD.t + innerH.value - h,
      h,
      label: v.label,
      value: v.value,
      last: i === props.values.length - 1,
    }
  }),
)
const ticks = computed(() => [0, 0.5, 1].map((f) => ({ y: PAD.t + innerH.value * (1 - f), v: Math.round(max.value * f) })))
const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))
</script>

<template>
  <svg class="chart" :viewBox="`0 0 ${W} ${height}`" role="img" :aria-label="`막대 ${values.length}개`">
    <g v-for="t in ticks" :key="t.v">
      <line :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y" class="grid" />
      <text :x="PAD.l - 6" :y="t.y + 4" class="tick" text-anchor="end">{{ fmt(t.v) }}{{ unit }}</text>
    </g>
    <g v-for="b in bars" :key="b.label">
      <rect :x="b.x" :y="b.y" :width="b.w" :height="Math.max(b.h, 1)" :class="['bar', { last: b.last }]">
        <title>{{ b.label }}: {{ b.value.toLocaleString() }}{{ unit }}</title>
      </rect>
      <text v-if="values.length <= 16 || b.last" :x="b.x + b.w / 2" :y="height - 8" class="lbl" text-anchor="middle">
        {{ b.label }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.chart { width: 100%; height: auto; display: block; }
.grid { stroke: var(--border-soft); stroke-width: 1; }
.tick, .lbl { fill: var(--muted); font-size: 11px; font-family: var(--mono); }
.bar { fill: var(--accent); opacity: 0.75; }
.bar.last { opacity: 1; fill: var(--accent-strong); }
</style>
