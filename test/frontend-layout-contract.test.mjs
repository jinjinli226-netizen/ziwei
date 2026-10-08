import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const shellSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'WorkspaceShell.vue'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'frontend', 'src', 'workspace-shell.css'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'frontend', 'src', 'styles.css'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'App.vue'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'api.js'), 'utf8');

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

test('team employee previews use summaries while details and editing retain full instructions', () => {
  const orgCardCopy = appSource.match(/class="org-employee-copy">([\s\S]*?)<\/span>/)?.[1];
  assert.ok(orgCardCopy, 'the organization card exposes employee copy');
  assert.match(orgCardCopy, /employeeRoleSummary\(employee\)/);
  assert.doesNotMatch(orgCardCopy, /employee\.instructions/);
  assert.match(appSource, /class="employee-role-summary"[^>]*>岗位摘要：\s*\{\{\s*employeeRoleSummary\(employee\)\s*\}\}/);

  const roleDetails = appSource.match(/v-else-if="employeeProfileTab==='role'"([\s\S]*?)v-else-if="employeeProfileTab==='skills'"/)?.[1];
  assert.ok(roleDetails, 'the employee profile has a role detail view');
  assert.match(roleDetails, /\{\{\s*employeeProfile\.instructions\s*\|\|\s*employeeProfile\.description/);
  assert.match(appSource, /employeeRole\.value\s*=\s*employee\?\.instructions\s*\|\|\s*''/);
  assert.match(appSource, /employeeRoleDraft\.value\s*=\s*employee\.instructions\s*\|\|\s*employee\.description/);
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

test('team quick tray reserves its own row and does not cover the title or org chart', () => {
  assert.match(shellCss, /\.members-panel \.team-quick-tray\s*\{[^}]*position:\s*relative[^}]*top:\s*auto[^}]*left:\s*auto[^}]*margin:\s*8px auto 0/);
});

test('conversation messages render safe image previews and attachment metadata', () => {
  assert.match(appSource, /conversationAttachmentPreviewSrc\(attachment\)/);
  assert.match(appSource, /class="conversation-message-attachments"/);
  assert.match(appSource, /\['image\/png','image\/jpeg','image\/gif','image\/webp'\]/);
  assert.match(appCss, /\.conversation-message-attachment img\s*\{/);
});

test('oversized conversation requests expose a readable 413 error', () => {
  assert.match(apiSource, /response\.status === 413/);
  assert.match(appSource, /error\.status === 413 \? '附件太大，请选择 10 MB 以内的图片后重试'/);
});

test('conversation changes clear a pending attachment before it can leak across threads', () => {
  assert.match(appSource, /conversationRouteId\.value=''; clearConversationAttachment\(\); stopConversationPolling\(\)/);
  assert.match(appSource, /async function openConversation\(item, \{ push=true \} = \{\}\) \{[\s\S]*?clearConversationAttachment\(\);/);
  assert.match(appSource, /conversationDraft\.value=''; clearConversationAttachment\(\); stopConversationPolling\(\)/);
});
