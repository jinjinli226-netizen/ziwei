import path from 'node:path';
import {rasterImageMimeType,canonicalRasterMimeType} from '../src/raster-image.mjs';

export const MAX_CONVERSATION_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CONVERSATION_ATTACHMENTS = 20;
const imageExtensions = /\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif)$/i;
const supportedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function decodeBase64(content) {
  const standard = String(content).trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(standard) || standard.length % 4 !== 0) throw new Error('会话附件内容无效：必须是标准 base64');
  if (standard.length > Math.ceil(MAX_CONVERSATION_ATTACHMENT_BYTES / 3) * 4) throw new Error('会话附件总大小不能超过 10 MiB');
  const bytes = Buffer.from(standard, 'base64');
  if (bytes.toString('base64') !== standard) throw new Error('会话附件内容无效：base64 校验失败');
  return bytes;
}

export function normalizeConversationAttachments(value, { imagesOnly = false } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('会话附件格式无效');
  if (value.length > MAX_CONVERSATION_ATTACHMENTS) throw new Error('每条消息最多附加 20 个附件');
  let total = 0;
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('会话附件格式无效');
    const name = path.posix.basename(String(item.name || item.filename || `attachment-${index + 1}`).replace(/\\/g, '/')).slice(0, 255) || `attachment-${index + 1}`;
    const declaredMime = canonicalRasterMimeType(item.mimeType || item.mime_type || 'application/octet-stream').slice(0,255);
    const invalid = message => new Error(`${name}：${message}`);
    const imageHint = imagesOnly || declaredMime.startsWith('image/') || imageExtensions.test(name);
    const supplied = item.content ?? item.data ?? item.contentBase64;
    if (supplied === undefined || supplied === null || supplied === '') {
      if (imageHint) throw invalid('图片附件必须包含实际图片内容，不能只提供文件名或本机路径');
      // Existing non-image metadata records remain compatible. These are not
      // interpreted as images or returned employee artifacts.
      return { ...item, name };
    }
    const encoding = String(item.contentEncoding ?? item.content_encoding ?? 'base64').toLowerCase();
    if (!['base64', 'utf8', 'utf-8', 'text'].includes(encoding)) throw invalid('会话附件编码只支持 utf8 或 base64');
    let bytes;
    try {bytes=encoding==='base64'?decodeBase64(supplied):Buffer.from(String(supplied),'utf8');} catch(error) {throw invalid(error.message);}
    total += bytes.length;
    if (bytes.length > MAX_CONVERSATION_ATTACHMENT_BYTES || total > MAX_CONVERSATION_ATTACHMENT_BYTES) throw invalid('会话附件总大小不能超过 10 MiB');
    const detectedMime = rasterImageMimeType(bytes);
    if (imageHint && !detectedMime) throw invalid('图片内容无效或格式不支持；支持 PNG、JPEG、GIF、WebP');
    if (declaredMime.startsWith('image/') && (!supportedMimeTypes.has(declaredMime) || declaredMime !== detectedMime)) throw invalid('图片类型与实际内容不一致；支持 PNG、JPEG、GIF、WebP');
    return { name, content: bytes.toString('base64'), contentEncoding: 'base64', size: bytes.length, mimeType: detectedMime || declaredMime };
  });
}
