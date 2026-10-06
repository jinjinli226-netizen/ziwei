<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useAttrs, watch } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  id: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择' },
  disabled: { type: Boolean, default: false },
  invalid: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue']);
const attrs = useAttrs();
const root = ref(null);
const trigger = ref(null);
const listbox = ref(null);
const open = ref(false);
const activeIndex = ref(-1);
const menuStyle = ref({});
let idCounter = 0;
const generatedId = `ziwei-select-${++idCounter}`;

const triggerId = computed(() => props.id || generatedId);
const listboxId = computed(() => `${triggerId.value}-listbox`);
const forwardedAttrs = computed(() => Object.fromEntries(
  Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style')
));
const rootClass = computed(() => [
  'ziwei-select',
  attrs.class,
  { 'ziwei-select--open': open.value, 'ziwei-select--invalid': props.invalid, 'ziwei-select--disabled': props.disabled }
]);
const selectedIndex = computed(() => props.options.findIndex(option => String(option?.value ?? '') === String(props.modelValue ?? '')));
const selectedOption = computed(() => selectedIndex.value >= 0 ? props.options[selectedIndex.value] : null);
const displayLabel = computed(() => selectedOption.value?.label ?? props.placeholder);
const activeOptionId = computed(() => activeIndex.value >= 0 ? `${listboxId.value}-option-${activeIndex.value}` : undefined);

function optionId(index) { return `${listboxId.value}-option-${index}`; }
function setActive(index) {
  const count = props.options.length;
  if (!count) { activeIndex.value = -1; return; }
  activeIndex.value = Math.max(0, Math.min(count - 1, index));
  nextTick(() => document.getElementById(optionId(activeIndex.value))?.scrollIntoView({ block: 'nearest' }));
}
function updateMenuPosition() {
  if (!open.value || !trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(120, viewportWidth - 24);
  const width = Math.min(Math.max(rect.width, 160), maxWidth);
  const estimatedHeight = Math.min(320, Math.max(44, props.options.length * 38 + 8));
  const below = viewportHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const placeAbove = below < Math.min(estimatedHeight, 320) && above > below;
  const maxHeight = Math.max(96, Math.min(320, placeAbove ? above : below));
  const left = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - width - 12));
  const top = placeAbove ? Math.max(12, rect.top - maxHeight - 6) : Math.min(viewportHeight - maxHeight - 12, rect.bottom + 6);
  menuStyle.value = { top: `${top}px`, left: `${left}px`, width: `${width}px`, maxHeight: `${maxHeight}px` };
}
function onOutsidePointerDown(event) {
  const target = event.target;
  if (!root.value?.contains(target) && !listbox.value?.contains(target)) closeMenu({ restore: false });
}
function addOpenListeners() {
  document.addEventListener('pointerdown', onOutsidePointerDown, true);
  window.addEventListener('resize', updateMenuPosition);
  window.addEventListener('scroll', updateMenuPosition, true);
}
function removeOpenListeners() {
  document.removeEventListener('pointerdown', onOutsidePointerDown, true);
  window.removeEventListener('resize', updateMenuPosition);
  window.removeEventListener('scroll', updateMenuPosition, true);
}
async function openMenu({ focusListbox = true } = {}) {
  if (props.disabled || open.value) return;
  activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : (props.options.length ? 0 : -1);
  open.value = true;
  addOpenListeners();
  await nextTick();
  updateMenuPosition();
  if (focusListbox) listbox.value?.focus({ preventScroll: true });
}
function closeMenu({ restore = true } = {}) {
  if (!open.value) return;
  open.value = false;
  removeOpenListeners();
  if (restore) nextTick(() => trigger.value?.focus({ preventScroll: true }));
}
function toggleMenu() { if (open.value) closeMenu(); else void openMenu(); }
function selectOption(option) {
  if (!option || option.disabled) return;
  emit('update:modelValue', option.value);
  closeMenu();
}
function onOptionMouseDown(event) { event.preventDefault(); }
function onTriggerKeydown(event) {
  if (props.disabled) return;
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleMenu(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) { void openMenu({ focusListbox: false }); setActive(selectedIndex.value + (event.key === 'ArrowDown' ? 1 : -1)); }
    else setActive(activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Escape') closeMenu();
}
function onListboxKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1)); }
  else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
  else if (event.key === 'End') { event.preventDefault(); setActive(props.options.length - 1); }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (activeIndex.value >= 0) selectOption(props.options[activeIndex.value]); }
  else if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
  else if (event.key === 'Tab') closeMenu({ restore: false });
}
watch(() => props.modelValue, () => { if (!open.value) activeIndex.value = selectedIndex.value; });
onBeforeUnmount(removeOpenListeners);
</script>

<template>
  <div ref="root" :class="rootClass" :style="attrs.style">
    <button
      ref="trigger"
      v-bind="forwardedAttrs"
      class="ziwei-select__trigger"
      type="button"
      :id="triggerId"
      :disabled="props.disabled"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listboxId : undefined"
      :aria-activedescendant="open ? activeOptionId : undefined"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="ziwei-select__value" :class="{ 'is-placeholder': !selectedOption }">{{ displayLabel }}</span>
      <span class="ziwei-select__chevron" aria-hidden="true">⌄</span>
    </button>
    <Teleport to="body">
      <div v-if="open" ref="listbox" class="ziwei-select__menu" :style="menuStyle" :id="listboxId" role="listbox" :aria-labelledby="triggerId" tabindex="-1" @keydown="onListboxKeydown">
        <div v-if="!props.options.length" class="ziwei-select__empty">暂无选项</div>
        <div
          v-for="(option, index) in props.options"
          :id="optionId(index)"
          :key="String(option?.value ?? index)"
          class="ziwei-select__option"
          :class="{ 'is-active': index === activeIndex, 'is-disabled': option.disabled }"
          role="option"
          tabindex="-1"
          :aria-selected="index === selectedIndex"
          :aria-disabled="option.disabled || undefined"
          @mousedown="onOptionMouseDown"
          @mouseenter="setActive(index)"
          @click="selectOption(option)"
        >{{ option.label }}</div>
      </div>
    </Teleport>
  </div>
</template>

<style>
.ziwei-select { position: relative; display: block; width: 100%; min-width: 0; }
.ziwei-select__trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 38px; box-sizing: border-box; padding: 0 11px; border: 1px solid var(--ziwei-line-strong, #cdd8e4); border-radius: var(--ziwei-radius-sm, 8px); color: var(--ziwei-ink-soft, #526173); background: var(--ziwei-surface, #fff); text-align: left; font: inherit; }
.ziwei-select__trigger:hover:not(:disabled), .ziwei-select--open .ziwei-select__trigger { border-color: var(--ziwei-accent-line, #a9c7e8); box-shadow: 0 0 0 3px var(--ziwei-focus-ring, rgba(47,111,202,.12)); }
.ziwei-select__trigger:disabled { cursor: not-allowed; opacity: .58; }
.ziwei-select__value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ziwei-select__value.is-placeholder { color: var(--ziwei-muted, #8895a5); }
.ziwei-select__chevron { flex: none; color: #647788; font-size: 16px; line-height: 1; transform: translateY(-2px); }
.ziwei-select__menu { position: fixed; z-index: 1000; overflow-y: auto; box-sizing: border-box; padding: 4px; border: 1px solid #d6e0eb; border-radius: 9px; background: #fff; box-shadow: 0 14px 34px rgba(30,50,75,.18); }
.ziwei-select__option { min-height: 34px; display: flex; align-items: center; box-sizing: border-box; padding: 6px 9px; border-radius: 6px; color: #4c5d71; cursor: pointer; line-height: 1.35; overflow-wrap: anywhere; }
.ziwei-select__option:hover, .ziwei-select__option.is-active, .ziwei-select__option[aria-selected="true"] { color: var(--ziwei-violet, #2f6fca); background: var(--ziwei-violet-soft, #edf4fb); }
.ziwei-select__option.is-disabled { cursor: not-allowed; opacity: .48; }
.ziwei-select__empty { padding: 10px 9px; color: #8793a2; font-size: 12px; }
</style>
