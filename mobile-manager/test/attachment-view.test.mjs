import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../web/model.js';
import { render } from '../web/view.js';

const employee = { id: 'employee-original', name: '原员工' };
const state = overrides => ({ ...initialState(), phase: 'ready', page: 'chat', user: { user_id: 'account-original' }, workspace: { slug: 'workspace-original' }, selectedEmployee: employee, conversation: { id: 'conversation-original', employee_id: employee.id, messages: [] }, ...overrides });

test('ordinary chat file picker accepts files while employee avatars retain their raster-only picker', () => {
  const picker = render(state()).match(/<input type="file" name="images"[^>]*>/)[0];
  assert.doesNotMatch(picker, /accept=/);
  assert.match(render(state()), /aria-label="添加附件"/);
  const avatar = render(state({ page: 'detail' })).match(/<input type="file" name="avatar"[^>]*>/)[0];
  assert.match(avatar, /accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
});

test('500 MiB drafts render metadata and bounded upload progress without reading a File or encoding its bytes', () => {
  const file = new Proxy({}, { get() { throw new Error('render must not read file bytes'); } });
  const name = '真实交付文件与很长的名称-20261101-final-archive.zip';
  const html = render(state({ attachments: [{ localId: 'local-file', name, mimeType: 'application/zip', size: 500 * 1024 * 1024, file, upload: { phase: 'uploading', offset: 125 * 1024 * 1024, total: 500 * 1024 * 1024 } }] }));
  assert.match(html, /500 MiB/); assert.match(html, /25%/);
  assert.match(html, /<progress[^>]+value="131072000"[^>]+max="524288000"/);
  assert.match(html, new RegExp(`title="${name}"`));
  assert.match(html, /data-action="remove-attachment" data-id="local-file"/);
  assert.doesNotMatch(html, /data:application\/zip|undefined|NaN|\[object Object\]/);
});

test('failed upload chips show the actual escaped error and explicit retry while completed refs show uploaded state', () => {
  const html = render(state({ attachments: [
    { localId: 'failed-file', name: '<原文件>.pdf', mimeType: 'application/pdf', size: 4096, upload: { phase: 'failed', offset: 2048, total: 4096, error: '<连接中断>' } },
    { localId: 'complete-file', name: '已上传.csv', mimeType: 'text/csv', size: 8, upload: { phase: 'complete', offset: 8, total: 8 }, ref: { attachmentId: 'attachment-complete', size: 8 } },
  ] }));
  assert.match(html, /上传失败/); assert.match(html, /&lt;连接中断&gt;/);
  assert.match(html, /data-action="attachment-retry" data-id="failed-file"/); assert.match(html, /已上传/);
  assert.doesNotMatch(html, /<连接中断>|data-action="attachment-retry" data-id="complete-file"/);
});

test('image File drafts use a blob preview and file drafts do not become broken images', () => {
  const html = render(state({ attachments: [
    { localId: 'photo-file', name: '原图片.png', mimeType: 'image/png', size: 2048, previewUrl: 'blob:https://ziwei.qzelynth.top/local-photo', upload: { phase: 'idle', offset: 0, total: 2048 } },
    { localId: 'doc-file', name: '原文档.pdf', mimeType: 'application/pdf', size: 2048, previewUrl: 'blob:https://ziwei.qzelynth.top/not-an-image', upload: { phase: 'idle', offset: 0, total: 2048 } },
  ] }));
  assert.match(html, /<img[^>]+src="blob:https:\/\/ziwei.qzelynth.top\/local-photo"/);
  assert.doesNotMatch(html, /<img[^>]+src="blob:https:\/\/ziwei.qzelynth.top\/not-an-image"/);
  assert.match(html, /等待上传/);
});

test('ordinary send waits for completed File refs and upload failures require the explicit retry action', () => {
  for (const phase of ['idle', 'uploading', 'failed']) {
    const html = render(state({ attachments: [{ localId: 'local-file', name: '原附件.pdf', mimeType: 'application/pdf', size: 4096, file: {}, upload: { phase, offset: 0, total: 4096 } }] }));
    assert.match(html, /aria-label="发送消息" disabled/, phase);
    if (phase === 'failed') assert.match(html, /data-action="attachment-retry" data-id="local-file"/);
  }
  const complete = render(state({ attachments: [{ localId: 'local-file', name: '原附件.pdf', mimeType: 'application/pdf', size: 4096, file: {}, ref: { attachmentId: 'ref-file', size: 4096 }, upload: { phase: 'complete', offset: 4096, total: 4096 } }] }));
  assert.doesNotMatch(complete, /aria-label="发送消息" disabled/);
});

test('history attachment refs use the current authorized conversation route and display download metadata', () => {
  const html = render(state({ messages: [{ id: 'original-message', role: 'assistant', content: '', attachments: [
    { attachmentId: 'attachment-file', name: '验收资料.pdf', mimeType: 'application/pdf', size: 500 * 1024 * 1024, sha256: 'a'.repeat(64), url: 'https://untrusted.invalid/ignored' },
    { attachmentId: 'attachment-image', name: '真实图片.png', mimeType: 'image/png', size: 2048, sha256: 'b'.repeat(64) },
  ] }] }));
  assert.match(html, /验收资料.pdf/); assert.match(html, /500 MiB/);
  assert.match(html, /data-action="attachment-download" data-id="attachment-file" data-conversation-id="conversation-original"/);
  assert.match(html, /data-action="attachment-download" data-id="attachment-image"/);
  assert.match(html, /<img[^>]+src="https:\/\/qzelynth.top\/api\/conversations\/conversation-original\/attachments\/attachment-image"/);
  assert.doesNotMatch(html, /untrusted.invalid|<img[^>]+attachment-file|data:image\/png;base64/);
});

test('legacy small inline images still render alongside file refs and retain image-preview behavior', () => {
  const html = render(state({ attachments: [{ name: '旧小图.png', mimeType: 'image/png', contentEncoding: 'base64', content: 'aGVsbG8=', size: 5 }], messages: [{ id: 'legacy-image', role: 'assistant', attachments: [{ name: '旧历史图.png', mimeType: 'image/png', contentEncoding: 'base64', content: 'aGVsbG8=', size: 5 }] }] }));
  assert.match(html, /data:image\/png;base64,aGVsbG8=/); assert.match(html, /data-action="image"/);
  assert.match(html, /data-action="remove-attachment" data-id="0"/);
});

test('large image references expose download metadata without an automatic image request', () => {
  const html = render(state({ messages: [{ id: 'large-image', role: 'assistant', attachments: [{ attachmentId: 'large-image-ref', name: '大幅原图.png', mimeType: 'image/png', size: 500 * 1024 * 1024, sha256: 'c'.repeat(64) }] }] }));
  assert.match(html, /大幅原图.png/); assert.match(html, /500 MiB/);
  assert.match(html, /data-action="attachment-download" data-id="large-image-ref"/);
  assert.doesNotMatch(html, /<img[^>]+large-image-ref|data-action="image"[^>]+large-image-ref/);
});
