import zlib from 'node:zlib';

// Keep archive handling dependency-free. The browser sends a base64 ZIP in the
// JSON request and the server extracts only SKILL.md; no archive files are
// written to disk.
export const MAX_SKILL_ARCHIVE_BYTES = 8 * 1024 * 1024;
export const MAX_SKILL_ARCHIVE_OUTPUT_BYTES = 8 * 1024 * 1024;

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  const text = String(value || '').trim();
  if (!text) return Buffer.alloc(0);
  const encoded = text.replace(/^data:.*?;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('技能 ZIP 的 Base64 编码无效');
  return Buffer.from(encoded, 'base64');
}

function u16(buffer, offset) { return buffer.readUInt16LE(offset); }
function u32(buffer, offset) { return buffer.readUInt32LE(offset); }

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function safeEntryName(name) {
  const normalized = String(name || '').replaceAll('\\', '/');
  if (!normalized || normalized.endsWith('/') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  return parts.join('/');
}

/** Extract the first SKILL.md from a ZIP archive. Supports stored and deflate entries. */
export function extractSkillMarkdownArchive(input) {
  const buffer = asBuffer(input);
  if (!buffer.length) throw new Error('请上传 ZIP 技能包');
  if (buffer.length > MAX_SKILL_ARCHIVE_BYTES) throw new Error('技能 ZIP 不能超过 8 MiB');
  if (buffer.length < 22) throw new Error('技能 ZIP 文件不完整');
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error('技能 ZIP 格式无效（缺少目录）');
  const entries = u16(buffer, eocd + 10);
  const centralSize = u32(buffer, eocd + 12);
  const centralOffset = u32(buffer, eocd + 16);
  if (entries === 0 || centralOffset + centralSize > buffer.length) throw new Error('技能 ZIP 目录无效');
  let offset = centralOffset;
  let outputBytes = 0;
  let found = null;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || u32(buffer, offset) !== 0x02014b50) throw new Error('技能 ZIP 目录条目无效');
    const flags = u16(buffer, offset + 8);
    const method = u16(buffer, offset + 10);
    const compressedSize = u32(buffer, offset + 20);
    const uncompressedSize = u32(buffer, offset + 24);
    const nameLength = u16(buffer, offset + 28);
    const extraLength = u16(buffer, offset + 30);
    const commentLength = u16(buffer, offset + 32);
    const localOffset = u32(buffer, offset + 42);
    const nameStart = offset + 46;
    const name = safeEntryName(buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'));
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > buffer.length) throw new Error('技能 ZIP 目录越界');
    offset = next;
    if (!name || !/skill\.md$/i.test(name)) continue;
    if (flags & 0x1) throw new Error('技能 ZIP 中的 SKILL.md 受密码保护，无法校验');
    if (uncompressedSize > MAX_SKILL_ARCHIVE_OUTPUT_BYTES || compressedSize > buffer.length) throw new Error('技能 ZIP 中的 SKILL.md 过大');
    if (localOffset + 30 > buffer.length || u32(buffer, localOffset) !== 0x04034b50) throw new Error('技能 ZIP 本地条目无效');
    const localNameLength = u16(buffer, localOffset + 26);
    const localExtraLength = u16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart < 0 || dataEnd > buffer.length) throw new Error('技能 ZIP 数据越界');
    const compressed = buffer.subarray(dataStart, dataEnd);
    let content;
    try {
      if (method === 0) content = compressed;
      else if (method === 8) content = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_SKILL_ARCHIVE_OUTPUT_BYTES });
      else throw new Error(`不支持的 ZIP 压缩方式 ${method}`);
    } catch (error) {
      if (error?.message?.startsWith('不支持的 ZIP')) throw error;
      throw new Error('技能 ZIP 中的 SKILL.md 解压失败');
    }
    outputBytes += content.length;
    if (outputBytes > MAX_SKILL_ARCHIVE_OUTPUT_BYTES) throw new Error('技能 ZIP 解压后内容过大');
    if (uncompressedSize !== 0xffffffff && content.length !== uncompressedSize) throw new Error('技能 ZIP 中的 SKILL.md 大小校验失败');
    found = { content: content.toString('utf8'), path: name, entryCount: entries };
    break;
  }
  if (!found) throw new Error('技能 ZIP 必须包含 SKILL.md');
  return found;
}

