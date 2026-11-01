import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, MAX_ATTACHMENTS, ATTACHMENT_CHUNK_BYTES, INLINE_ATTACHMENT_BYTES } from './conversation-attachment-policy.js';

const raster = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export function createDraftAttachments(files, existing = []) {
  if (existing.length + files.length > MAX_ATTACHMENTS) throw new Error('每条消息最多附加 20 个文件');
  for (const file of files) if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES || typeof file.slice !== 'function') throw new Error('每个附件须大于 0，且不能超过 500 MiB');
  if ([...existing, ...files].reduce((sum, item) => sum + item.size, 0) > MAX_ATTACHMENT_TOTAL_BYTES) throw new Error('附件合计不能超过 500 MiB');
  return files.map(file => ({ localId: crypto.randomUUID(), name: file.name || '附件', mimeType: file.type || 'application/octet-stream', size: file.size, file,
    ...(raster.has(file.type) && file.size <= INLINE_ATTACHMENT_BYTES && file instanceof Blob && globalThis.URL?.createObjectURL ? { previewUrl: URL.createObjectURL(file) } : {}),
    upload: { phase: 'idle', offset: 0, total: file.size, error: '' } }));
}
export function releaseDraftAttachments(attachments) {
  for (const attachment of attachments) if (attachment.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(attachment.previewUrl);
}
function checkedReference(value, file) {
  if (typeof value?.attachmentId !== 'string' || !value.attachmentId || value.size !== file.size || typeof value.name !== 'string' || typeof value.mimeType !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256 || '')) throw new Error('附件完成回执不匹配，请重试继续核对');
  return { attachmentId: value.attachmentId, name: value.name, mimeType: value.mimeType, size: value.size, sha256: value.sha256 };
}
export function createAttachmentUploader({ api, makeKey = () => crypto.randomUUID() }) {
  const sessions = new WeakMap();
  return async function upload(conversationId, file, { onProgress = () => {}, active = () => true } = {}) {
    let byConversation = sessions.get(file);
    if (!byConversation) { byConversation = new Map(); sessions.set(file, byConversation); }
    let state = byConversation.get(conversationId);
    if (!state) { state = { key: makeKey() }; byConversation.set(conversationId, state); }
    if (state.ref) return state.ref;
    const checkActive = () => { if (!active()) throw Object.assign(new Error('已离开原聊天，附件上传已暂停，可返回后重试继续'), { code: 'ATTACHMENT_UPLOAD_LEFT' }); };
    checkActive();
    const status = state.uploadId ? await api.attachmentUploadStatus(conversationId, state.uploadId) : await api.createAttachmentUpload(conversationId, { name: file.name || '附件', mimeType: file.type || 'application/octet-stream', size: file.size }, state.key);
    if (typeof status?.uploadId !== 'string' || !status.uploadId || !Number.isSafeInteger(status.offset) || status.offset < 0 || status.offset > file.size || state.uploadId && state.uploadId !== status.uploadId) throw new Error('附件上传进度回执无效，请重试核对');
    state.uploadId = status.uploadId;
    if (status.attachment) return state.ref = checkedReference(status.attachment, file);
    const chunkSize = Math.min(status.chunkSize || ATTACHMENT_CHUNK_BYTES, ATTACHMENT_CHUNK_BYTES);
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error('附件分块大小无效');
    let offset = status.offset; onProgress({ offset, total: file.size });
    while (offset < file.size) {
      checkActive();
      const end = Math.min(offset + chunkSize, file.size), blob = file.slice(offset, end);
      const receipt = await api.putAttachmentChunk(conversationId, state.uploadId, offset, blob);
      if (receipt?.offset !== end || receipt.uploadId && receipt.uploadId !== state.uploadId) throw new Error('附件分块回执不匹配，请重试继续核对');
      offset = end; onProgress({ offset, total: file.size });
    }
    checkActive();
    state.ref = checkedReference(await api.completeAttachmentUpload(conversationId, state.uploadId), file);
    return state.ref;
  };
}
