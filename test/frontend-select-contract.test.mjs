import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const selectSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'ZiSelect.vue'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'App.vue'), 'utf8');
const shellSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'WorkspaceShell.vue'), 'utf8');

test('workspace selects use the local accessible listbox component', () => {
  assert.doesNotMatch(selectSource, /<select\b/i);
  assert.match(selectSource, /role="combobox"/);
  assert.match(selectSource, /role="listbox"/);
  assert.match(selectSource, /@keydown="onTriggerKeydown"/);
  assert.match(selectSource, /Teleport to="body"/);
  assert.match(appSource, /import ZiSelect from ['"]\.\/components\/ZiSelect\.vue['"]/);
  assert.match(shellSource, /import ZiSelect from ['"]\.\/ZiSelect\.vue['"]/);
});
