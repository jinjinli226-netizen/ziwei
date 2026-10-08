<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
const paths: Record<string, string[]> = {
  overview: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  runtime: ['M4 5h16v14H4z', 'M8 9l3 3-3 3', 'M14 15h3'],
  device: ['M7 2h10v20H7z', 'M11 18h2'],
  business: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  shield: ['M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z', 'M8 12l3 3 5-6'],
  link: ['M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-2 2', 'M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l2-2'],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M20 7V3l-3 3a8 8 0 10 3 9', 'M20 3v5h-5'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  back: ['M19 12H5', 'M11 18l-6-6 6-6'],
  activity: ['M2 12h5l3-8 4 16 3-8h5'],
  clock: ['M12 8v5l3 2', 'M22 12a10 10 0 11-20 0 10 10 0 0120 0'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  chevron: ['M9 5l7 7-7 7'],
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(path, index) in paths[name] || paths.overview" :key="index" :d="path" /></svg></template>
