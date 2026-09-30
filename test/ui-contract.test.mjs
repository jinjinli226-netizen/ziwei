import assert from 'node:assert/strict'
import test from 'node:test'

test('installed @ziwei/ui exposes the enterprise component layer', async () => {
  const ui = await import('@ziwei/ui')
  for (const name of [
    'ZiButton', 'ZiCard', 'ZiMetricCard', 'ZiStatusTag', 'ZiEmptyState', 'ZiModal', 'ZiInput', 'ZiSelect', 'ZiTextarea', 'ZiSwitch', 'ZiTabs',
    'ZiAlert', 'ZiBanner', 'ZiBreadcrumb', 'ZiCommandPalette', 'ZiConfigProvider', 'ZiConfirmDialog', 'ZiContainer', 'ZiDatePicker',
    'ZiDescriptionList', 'ZiDivider', 'ZiDrawer', 'ZiDropdown', 'ZiDropdownMenu', 'ZiErrorState', 'ZiGrid', 'ZiList', 'ZiLoading',
    'ZiNumberInput', 'ZiPopover', 'ZiRadio', 'ZiRadioGroup', 'ZiResult', 'ZiSearchInput', 'ZiSection', 'ZiStack', 'ZiSteps',
    'ZiTable', 'ZiThemeProvider', 'ZiTimeline', 'ZiToastProvider', 'ZiTooltip', 'ZiTree', 'ZiUpload', 'ZiVirtualList',
  ]) {
    assert.equal(typeof ui[name], 'object', name)
  }
  assert.match(import.meta.resolve('@ziwei/ui/style.css'), /dist[\\/]index\.css$/)
})


