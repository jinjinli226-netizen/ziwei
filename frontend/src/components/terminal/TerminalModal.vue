<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './TerminalIcon.vue'
const props = defineProps<{ title: string; wide?: boolean; busy?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
let previousFocus: HTMLElement | null = null
let previousOverflow = ''
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.busy) emit('close')
  if (event.key !== 'Tab') return
  const elements = panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, a[href]')
  if (!elements?.length) return
  const first = elements[0]!
  const last = elements[elements.length - 1]!
  if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault() }
  if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault() }
}
onMounted(async () => {
  previousFocus = document.activeElement as HTMLElement
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', keydown)
  await nextTick()
  ;(panel.value?.querySelector('input, select, button') as HTMLElement)?.focus()
})
onUnmounted(() => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus() })
</script>
<template><Teleport to="body"><div class="terminal-modal-backdrop" @click.self="!busy && emit('close')"><section ref="panel" class="terminal-modal" :class="{ 'wide-modal': wide }" role="dialog" aria-modal="true" :aria-label="title"><div class="modal-heading"><h2>{{ title }}</h2><button class="icon-button" aria-label="关闭" :disabled="busy" @click="emit('close')"><AppIcon name="close" /></button></div><slot /></section></div></Teleport></template>

<style scoped>
.terminal-modal-backdrop { --ink: var(--ziwei-ink); --ink-soft: var(--ziwei-ink-soft); --muted: var(--ziwei-muted); --violet: var(--ziwei-violet); --violet-soft: var(--ziwei-violet-soft); --line: var(--ziwei-line); --line-strong: var(--ziwei-line-strong); position:fixed; inset:0; z-index:1000; display:grid; place-items:center; padding:24px; background:rgba(28,43,64,.3); }
.terminal-modal { box-sizing:border-box; width:min(480px,100%); max-height:calc(100dvh - 48px); overflow-y:auto; padding:24px; border:1px solid var(--line); border-radius:12px; background:var(--ziwei-surface); color:var(--ink); box-shadow:0 18px 60px #172f4b29; }
.wide-modal { width:min(680px,100%); }
.modal-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; }
.modal-heading h2 { margin:0; font-size:18px; font-weight:600; }
.icon-button { flex-shrink:0; width:30px; height:30px; display:grid; place-items:center; border:0; border-radius:6px; background:var(--ziwei-canvas); color:var(--muted); cursor:pointer; }
.icon-button:disabled { opacity:.5; cursor:wait; }
@media(max-width:600px) { .terminal-modal-backdrop { padding:12px; } .terminal-modal { padding:18px; max-height:calc(100dvh - 24px); } }
</style>
