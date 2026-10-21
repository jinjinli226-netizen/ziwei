import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateSkillDocument } from './validator.mjs';

export const WORLD_MEMORY_CATALOG_ID = 'ziwei-world-memory';

function syncCatalogSkill(db, workspaceId, { catalogId, kind, defaultInstalled = false }) {
  const directory = new URL(`../../skills/${catalogId}/`, import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', directory), 'utf8'));
  const content = fs.readFileSync(new URL('SKILL.md', directory), 'utf8');
  const document = validateSkillDocument({ content });
  if (document.errors?.length) throw new Error(`平台技能 ${catalogId} 校验失败：${document.errors.join('；')}`);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const at = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM skills WHERE workspace_id=? AND catalog_id=?').get(workspaceId, catalogId);
  const metadata = { name:manifest.name || '紫薇手机操控', description:manifest.description || '通过员工 MCP 操控明确绑定的手机', category:manifest.category || 'productivity' };
  const integration = { ...manifest.integration, kind };
  const version = manifest.version;
  const releaseHash=crypto.createHash('sha256').update(JSON.stringify(manifest)).update(content).digest('hex');
  if (!/^\d+\.\d+\.\d+/.test(String(version || ''))) throw new Error(`平台技能 ${catalogId} 缺少有效版本`);
  const skillId = existing?.id || `skill_${crypto.randomUUID()}`;
  if (!existing) db.prepare(`INSERT INTO skills(id,workspace_id,name,description,category,installed,source,scope,recommended,install_count,icon,author,tags_json,created_at,updated_at,source_type,content,content_hash,version,validation_status,catalog_id,integration_json,catalog_release_hash) VALUES(?,?,?,?,?,?,'platform','platform',1,0,?,?,?, ?,?,'catalog',?,?,?,'valid',?,?,?)`).run(skillId,workspaceId,metadata.name,metadata.description,metadata.category,defaultInstalled ? 1 : 0,manifest.icon || '▣',manifest.author || '紫薇映界',JSON.stringify(manifest.tags || ['phone','mcp']),at,at,content,hash,version,catalogId,JSON.stringify(integration),releaseHash);
  else if (existing.catalog_release_hash !== releaseHash) {
    db.prepare('INSERT INTO skill_versions(id,skill_id,version,content,content_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run(`skillver_${crypto.randomUUID()}`,skillId,existing.version,existing.content,existing.content_hash,JSON.stringify({name:existing.name,description:existing.description,category:existing.category,integration:JSON.parse(existing.integration_json || '{}')}),at);
    db.prepare("UPDATE skills SET name=?,description=?,category=?,content=?,content_hash=?,version=?,validation_status='valid',integration_json=?,updated_at=?,catalog_release_hash=? WHERE id=?").run(metadata.name,metadata.description,metadata.category,content,hash,version,JSON.stringify(integration),at,releaseHash,skillId);
    if(existing.installed) db.prepare('INSERT INTO skill_versions(id,skill_id,version,content,content_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run(`skillver_${crypto.randomUUID()}`,skillId,version,content,hash,JSON.stringify({...metadata,integration}),at);
  }
  return skillId;
}

export function syncPhoneSkill(db, workspaceId) {
  return syncCatalogSkill(db, workspaceId, { catalogId:'ziwei-phone-control', kind:'phone_mcp' });
}

export function syncWorldMemorySkill(db, workspaceId) {
  // Installed describes this short guide only, never a verified connection.
  return syncCatalogSkill(db, workspaceId, { catalogId:WORLD_MEMORY_CATALOG_ID, kind:'knowledge_guide', defaultInstalled:true });
}

export function defaultEmployeeSkillIds(db, workspaceId) {
  // Only this reviewed builtin is global-by-default. Imported skills cannot
  // opt themselves into every employee by declaring defaultEnabled metadata.
  const skillId = syncWorldMemorySkill(db, workspaceId);
  return db.prepare('SELECT id FROM skills WHERE id=? AND workspace_id=? AND installed=1').all(skillId,workspaceId).map(row => row.id);
}

export function worldMemoryEmployeeIdentity(workspaceId, employeeId) {
  if (!workspaceId || !employeeId) throw new Error('知识库身份需要真实工作区与员工绑定');
  const digest = crypto.createHash('sha256').update(JSON.stringify([String(workspaceId),String(employeeId)])).digest('hex').slice(0,32);
  const profile = `zw-${digest}`;
  return `知识库独立档案：${profile}（本工作区、当前员工专用；更名不改变档案）。已有当前员工的受信档案先核对并复用，否则使用此固定 --profile。\n身份核对：ziwei-memory whoami --profile ${profile}\n首次授权：ziwei-memory --login --no-browser --profile ${profile}\nMCP 配置：ziwei-memory mcp-config --profile ${profile}`;
}
