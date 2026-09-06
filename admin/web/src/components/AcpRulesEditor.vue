<script setup lang="ts">
import type { EditRule } from '../types'

const props = defineProps<{ modelValue: EditRule[]; title: string; placeholder: string; emptyNote: string }>()
const emit = defineEmits<{ 'update:modelValue': [rules: EditRule[]] }>()

/** acop 비트. 63 이 무슨 뜻인지 화면에서 알 수 있어야 한다. */
const OP_BITS: { bit: number; name: string; hint: string }[] = [
  { bit: 1, name: 'CREATE', hint: '자식 리소스 만들기' },
  { bit: 2, name: 'RETRIEVE', hint: '읽기' },
  { bit: 4, name: 'UPDATE', hint: '수정' },
  { bit: 8, name: 'DELETE', hint: '삭제' },
  { bit: 16, name: 'NOTIFY', hint: '알림 받기' },
  { bit: 32, name: 'DISCOVERY', hint: '검색 결과에 나오기' },
]

function set(rules: EditRule[]) { emit('update:modelValue', rules) }
function toggleBit(i: number, bit: number) {
  const rules = props.modelValue.map((r) => ({ ...r }))
  const r = rules[i]
  r.acop = (r.acop & bit) === bit ? r.acop & ~bit : r.acop | bit
  set(rules)
}
function setAcor(i: number, v: string) {
  const rules = props.modelValue.map((r) => ({ ...r }))
  rules[i].acor = v
  set(rules)
}
function add() { set(props.modelValue.concat([{ acor: '', acop: 2 }])) }
function remove(i: number) { set(props.modelValue.filter((_, j) => j !== i)) }
</script>

<template>
  <div class="col">
    <h3>{{ title }}</h3>
    <div v-for="(r, i) in modelValue" :key="i" class="rule">
      <div class="rowline">
        <input :value="r.acor" class="mono" :placeholder="placeholder" @input="setAcor(i, ($event.target as HTMLInputElement).value)" />
        <button class="del" title="이 규칙 지우기" @click="remove(i)">×</button>
      </div>
      <div class="bits">
        <button v-for="o in OP_BITS" :key="o.bit" class="bit" :class="{ on: (r.acop & o.bit) === o.bit }" :title="o.hint" @click="toggleBit(i, o.bit)">{{ o.name }}</button>
        <span class="acopval">acop = {{ r.acop }}</span>
      </div>
    </div>
    <button class="add" @click="add">＋ 규칙 추가</button>
    <p v-if="!modelValue.length" class="none">{{ emptyNote }}</p>
  </div>
</template>

<style scoped>
h3 { margin: 0 0 0.6rem; font-size: 1.05rem; color: var(--text-strong); }
.col { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 1.1rem 1.2rem; }
.rule { border: 1px solid var(--border); border-radius: 9px; padding: 0.7rem 0.8rem; margin-bottom: 0.6rem; background: var(--bg); }
.rowline { display: flex; gap: 0.5rem; align-items: center; }
.rowline input { font: inherit; flex: 1; padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); color: var(--text); }
.del { border: none; background: none; color: var(--muted); font-size: 1.3rem; line-height: 1; padding: 0 0.3rem; cursor: pointer; }
.del:hover { color: var(--danger); }
.bits { display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center; margin-top: 0.5rem; }
.bit { font-size: 0.78rem; padding: 0.2rem 0.5rem; border-radius: 5px; border: 1px solid var(--border); background: var(--panel); color: var(--muted); }
.bit.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent-strong); font-weight: 600; }
.acopval { font-size: 0.8rem; color: var(--muted); font-family: var(--mono); margin-left: 0.3rem; }
.add { margin-top: 0.3rem; font-size: 0.9rem; }
.none { color: var(--muted); font-size: 0.93rem; }
</style>
