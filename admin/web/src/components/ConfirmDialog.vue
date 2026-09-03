<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  /** 빨간 확인 버튼에 들어갈 글자. 무슨 일이 일어나는지 그대로 적는다. */
  confirmLabel: string
  paths: string[]
  /** 되돌릴 수 없는 작업인가. 그렇다면 버튼을 위험 색으로 칠한다. */
  destructive?: boolean
  busy?: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const SHOWN = 12
const shown = computed(() => props.paths.slice(0, SHOWN))
const rest = computed(() => props.paths.length - shown.value.length)
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h3>{{ title }}</h3>

      <slot />

      <div class="paths">
        <div v-for="p in shown" :key="p" class="p">{{ p }}</div>
        <div v-if="rest > 0" class="more">그 외 {{ rest.toLocaleString() }}건</div>
      </div>

      <div class="actions">
        <button :disabled="busy" @click="emit('cancel')">그만두기</button>
        <button
          class="go"
          :class="{ danger: destructive }"
          :disabled="busy || paths.length === 0"
          @click="emit('confirm')"
        >
          {{ busy ? '시작하는 중…' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(8, 30, 48, 0.45);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  padding: 1.5rem;
  z-index: 50;
}
.dialog {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(8, 30, 48, 0.28);
  padding: 1.6rem 1.8rem;
  width: min(680px, 100%);
  max-height: 85vh;
  overflow: auto;
}
h3 {
  margin: 0 0 0.8rem;
  font-size: 1.25rem;
  letter-spacing: -0.01em;
  color: var(--text-strong);
}
.paths {
  margin: 1rem 0;
  padding: 0.7rem 0.9rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 240px;
  overflow: auto;
  font-family: var(--mono);
  font-size: 0.9rem;
}
.paths .p { overflow-wrap: anywhere; padding: 0.1rem 0; }
.paths .more { color: var(--muted); padding-top: 0.35rem; font-family: inherit; }

.actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.2rem; }
.actions .go {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 600;
}
.actions .go.danger { background: var(--danger); border-color: var(--danger); }
.actions .go:disabled { opacity: 0.5; }
</style>
