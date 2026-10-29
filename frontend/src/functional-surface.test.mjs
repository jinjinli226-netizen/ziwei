import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('./App.vue', import.meta.url), 'utf8');

test('workspace data failures stay visible and can be retried', () => {
  assert.match(app, /workspaceLoadError/);
  assert.match(app, /class="workspace-load-error"[^>]*role="alert"/);
  assert.match(app, /class="workspace-load-error"[\s\S]*@click="load"/);
});

test('non Bot pages expose an async read state', () => {
  for (const page of ['home', 'automations', 'calendar', 'docs', 'members', 'skills', 'runtimes']) {
    assert.match(app, new RegExp(`page==='${page}'`));
  }
  assert.ok((app.match(/class="page-inline-loading"/g) || []).length >= 7);
});

test('empty calendar and document states offer a concrete next action', () => {
  assert.match(app, /class="calendar-empty-banner"[\s\S]*@click="openCalendarEvent/);
  assert.match(app, /没有匹配的文档/);
  assert.match(app, /清除搜索/);
});

test('runtime metadata is presented as metadata instead of inert buttons', () => {
  assert.doesNotMatch(app, /<div class="entity-tags"><button>版本 \{\{ runtimePresentation/);
  assert.doesNotMatch(app, /<div class="entity-tags"><button>启动头/);
});

test('home help opens an actionable in-product guide', () => {
  assert.match(app, /function openHelp\(\) \{ showHelp\.value=true; \}/);
  assert.match(app, /title="帮助中心"/);
  assert.match(app, /openHelpRoute\('compose'\)/);
  assert.match(app, /openHelpRoute\('skills'\)/);
});
