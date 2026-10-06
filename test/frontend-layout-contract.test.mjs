import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const shellSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'WorkspaceShell.vue'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'frontend', 'src', 'workspace-shell.css'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'frontend', 'src', 'styles.css'), 'utf8');

test('workspace shell closes popups on outside pointer interactions', () => {
  assert.match(shellSource, /onMounted/);
  assert.match(shellSource, /onUnmounted/);
  assert.match(shellSource, /addEventListener\(['"]pointerdown['"]/);
  assert.match(shellSource, /closest\(['"]\.shell-menu-anchor['"]\)/);
});

test('task board fits desktop columns without clipping important lanes', () => {
  assert.match(shellCss, /@media\s*\(min-width:\s*901px\)[\s\S]*?\.faithful-board\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)/);
  assert.match(shellCss, /\.task-card-title-link\s*\{[^}]*min-width:\s*0/);
});

test('member and employee role copy wraps instead of being visually truncated', () => {
  assert.match(shellCss, /\.members-panel \.org-employee-copy em\s*\{[^}]*white-space:\s*normal/);
  assert.match(shellCss, /\.members-panel \.employee-tree-row \.entity-main small\.employee-role-summary\s*\{[^}]*white-space:\s*normal/);
  assert.match(shellCss, /\.employee-profile-card > p\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('directory picker keeps its actions inside the modal at desktop and narrow widths', () => {
  assert.match(appCss, /\.ziwei-modal:has\(\.conversation-directory-picker\)\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*hidden/);
  assert.match(appCss, /\.conversation-directory-picker\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
  assert.match(appCss, /\.conversation-directory-picker \.form-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(appCss, /@media\s*\(max-width:760px\)[\s\S]*?\.conversation-directory-browser\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test('quick tray menus keep menu actions horizontal instead of inheriting icon sizing', () => {
  assert.match(shellCss, /\.issue-quick-tray\s*>\s*button\s*\{/);
  assert.doesNotMatch(shellCss, /\.issue-quick-tray\s+button\s*\{/);
  assert.match(shellCss, /\.quick-tray-menu button\s*\{[^}]*width:\s*100%[^}]*white-space:\s*nowrap[^}]*word-break:\s*keep-all/);
});
