import crypto from 'node:crypto';

export const MAX_SKILL_BYTES = 1024 * 1024;

function parseScalar(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  if (raw.startsWith('[') && raw.endsWith(']')) return raw.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return raw;
}

/** Parse the small YAML front matter subset used by SKILL.md files. */
export function parseSkillMarkdown(content) {
  const text = String(content || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const metadata = {};
  let bodyStart = 0;
  let hasFrontmatter = false;
  const errors = [];
  if (lines[0]?.trim() === '---') {
    hasFrontmatter = true;
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end === -1) errors.push('SKILL.md 的 front matter 没有结束标记 ---');
    else {
      let listKey = null;
      for (const line of lines.slice(1, end)) {
        const listItem = line.match(/^\s*-\s+(.+)$/);
        if (listItem && listKey) {
          if (!Array.isArray(metadata[listKey])) metadata[listKey] = [];
          metadata[listKey].push(parseScalar(listItem[1]));
          continue;
        }
        const pair = line.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/);
        if (!pair) continue;
        const key = pair[1].toLowerCase();
        const value = parseScalar(pair[2]);
        metadata[key] = value;
        listKey = pair[2].trim() ? null : key;
      }
      bodyStart = end + 1;
    }
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  const heading = body.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim() || '';
  const firstParagraph = body.split(/\n\s*\n/).map(item => item.trim()).find(item => item && !item.startsWith('#')) || '';
  const tags = Array.isArray(metadata.tags) ? metadata.tags : String(metadata.tags || '').split(/[,，\s]+/).filter(Boolean);
  return { metadata: { ...metadata, tags }, body, heading, firstParagraph, hasFrontmatter, errors };
}

export function hashSkillContent(content) {
  return crypto.createHash('sha256').update(String(content), 'utf8').digest('hex');
}

export function validateSkillDocument({ content, name = '', version = '', metadata = {}, parsed = null } = {}) {
  const source = parsed || parseSkillMarkdown(content);
  const errors = [...(source.errors || [])];
  const resolvedName = String(name || source.metadata.name || source.heading || '').trim();
  const resolvedVersion = String(version || source.metadata.version || '0.1.0').trim();
  if (!resolvedName) errors.push('缺少技能名称（metadata.name 或一级标题）');
  if (!source.body) errors.push('SKILL.md 正文不能为空');
  if ((version || source.metadata.version) && !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(resolvedVersion)) errors.push('version 必须使用语义化版本，例如 1.0.0');
  return { ...source, name: resolvedName, version: resolvedVersion, errors, validationStatus: errors.length ? 'invalid' : 'valid' };
}
