import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateSkillDocument } from './validator.mjs';

const directory = new URL('../../skills/ziwei-phone-control/', import.meta.url);
export function syncPhoneSkill(db, workspaceId) {
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', directory), 'utf8'));
  const content = fs.readFileSync(new URL('SKILL.md', directory), 'utf8');
  const document = validateSkillDocument({ content });
  if (document.errors?.length) throw new Error(`平台手机技能校验失败：${document.errors.join('；')}`);
  const catalogId = 'ziwei-phone-control'; const hash = crypto.createHash('sha256').update(content).digest('hex');
  const at = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM skills WHERE workspace_id=? AND catalog_id=?').get(workspaceId, catalogId);
  const metadata = { name:manifest.name || '紫薇手机操控', description:manifest.description || '通过员工 MCP 操控明确绑定的手机', category:manifest.category || 'productivity' };
  const integration = { ...manifest.integration, kind:'phone_mcp' };
  const version = manifest.version;
  const releaseHash=crypto.createHash('sha256').update(JSON.stringify(manifest)).update(content).digest('hex');
  if (!/^\d+\.\d+\.\d+/.test(String(version || ''))) throw new Error('平台手机技能缺少有效版本');
  const skillId = existing?.id || `skill_${crypto.randomUUID()}`;
  if (!existing) db.prepare(`INSERT INTO skills(id,workspace_id,name,description,category,installed,source,scope,recommended,install_count,icon,author,tags_json,created_at,updated_at,source_type,content,content_hash,version,validation_status,catalog_id,integration_json) VALUES(?,?,?,?,?,0,'platform','platform',1,0,?,?,?, ?,?,'catalog',?,?,?,'valid',?,?)`).run(skillId,workspaceId,metadata.name,metadata.description,metadata.category,manifest.icon || '▣',manifest.author || '紫薇映界',JSON.stringify(manifest.tags || ['phone','mcp']),at,at,content,hash,version,catalogId,JSON.stringify(integration));
  else if (existing.catalog_release_hash !== releaseHash) {
    db.prepare('INSERT INTO skill_versions(id,skill_id,version,content,content_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run(`skillver_${crypto.randomUUID()}`,skillId,existing.version,existing.content,existing.content_hash,JSON.stringify({name:existing.name,description:existing.description,category:existing.category,integration:JSON.parse(existing.integration_json || '{}')}),at);
    db.prepare("UPDATE skills SET name=?,description=?,category=?,content=?,content_hash=?,version=?,validation_status='valid',integration_json=?,updated_at=? WHERE id=?").run(metadata.name,metadata.description,metadata.category,content,hash,version,JSON.stringify(integration),at,skillId);
    if(existing.installed) db.prepare('INSERT INTO skill_versions(id,skill_id,version,content,content_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run(`skillver_${crypto.randomUUID()}`,skillId,version,content,hash,JSON.stringify({...metadata,integration}),at);
  }
  db.prepare('UPDATE skills SET catalog_release_hash=? WHERE id=?').run(releaseHash,skillId);
  return skillId;
}
