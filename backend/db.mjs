import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

export function openDatabase({ memory = false, filename = path.join(ROOT, 'data', 'ziwei.sqlite') } = {}) {
  if (!memory) fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(memory ? ':memory:' : filename);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free', timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT, name TEXT NOT NULL,
      email TEXT NOT NULL, role TEXT NOT NULL, avatar TEXT, joined_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'pending',
      code_hash TEXT NOT NULL UNIQUE, code_prefix TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_sent_at TEXT NOT NULL,
      resend_count INTEGER NOT NULL DEFAULT 0, accepted_at TEXT, revoked_at TEXT,
      member_id TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invitations_workspace_status ON invitations(workspace_id,status,created_at);
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      os TEXT NOT NULL, status TEXT NOT NULL, last_seen TEXT, ip_hint TEXT,
      version TEXT, pid INTEGER, bridge_name TEXT, bridge_version TEXT,
      bridge_status TEXT, heartbeat_at TEXT, heartbeat_interval_ms INTEGER,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS device_pairing_codes (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE,
      code_prefix TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
      created_by TEXT, consumed_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_device_pairing_codes_workspace ON device_pairing_codes(workspace_id, expires_at, consumed_at);
    CREATE TABLE IF NOT EXISTS device_credentials (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL, created_at TEXT NOT NULL,
      last_seen_at TEXT, revoked_at TEXT,
      FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_device_credentials_workspace ON device_credentials(workspace_id, revoked_at);
    CREATE TABLE IF NOT EXISTS runtimes (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      provider TEXT NOT NULL, version TEXT, status TEXT NOT NULL, capabilities_json TEXT NOT NULL,
      last_seen TEXT, FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS runtime_metadata (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, runtime_name TEXT NOT NULL,
      version TEXT, binary TEXT, status TEXT, models_json TEXT NOT NULL DEFAULT '[]', profiles_json TEXT NOT NULL DEFAULT '[]',
      last_seen TEXT NOT NULL, UNIQUE(workspace_id,runtime_name),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', description_format TEXT NOT NULL DEFAULT 'plain', state TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium',
      created_by TEXT NOT NULL DEFAULT 'user', assignee TEXT, labels_json TEXT NOT NULL DEFAULT '[]', due_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS task_messages (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS task_attachments (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '', content_encoding TEXT NOT NULL DEFAULT 'base64',
      storage_key TEXT, checksum TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id, created_at);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL,
      type TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'text/markdown', storage_key TEXT, checksum TEXT,
      content_encoding TEXT NOT NULL DEFAULT 'utf8', deleted_at TEXT, deleted_by TEXT,
      updated_at TEXT NOT NULL, FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'text/markdown', storage_key TEXT,
      checksum TEXT, content_encoding TEXT NOT NULL DEFAULT 'utf8',
      created_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
      category TEXT NOT NULL, installed INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'platform',
      scope TEXT NOT NULL DEFAULT 'platform', recommended INTEGER NOT NULL DEFAULT 0,
      install_count INTEGER NOT NULL DEFAULT 0, icon TEXT NOT NULL DEFAULT '✦',
      author TEXT NOT NULL DEFAULT '紫薇团队', tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT, updated_at TEXT,
      source_type TEXT NOT NULL DEFAULT 'catalog', source_url TEXT,
      source_device_id TEXT, source_path TEXT,
      content TEXT NOT NULL DEFAULT '', content_hash TEXT, version TEXT,
      validation_status TEXT NOT NULL DEFAULT 'unvalidated', validation_error TEXT,
      imported_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, schedule TEXT NOT NULL,
      prompt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', last_run TEXT, next_run TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', webhook_url TEXT, webhook_secret TEXT,
      output_mode TEXT NOT NULL DEFAULT 'notification',
      max_retries INTEGER NOT NULL DEFAULT 3, retry_backoff_ms INTEGER NOT NULL DEFAULT 1000, executor TEXT NOT NULL DEFAULT 'ziwei_user',
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', mode TEXT NOT NULL DEFAULT 'manual',
      message TEXT NOT NULL DEFAULT '', result_json TEXT, error TEXT, attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3, next_retry_at TEXT, action_id TEXT,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      FOREIGN KEY(automation_id) REFERENCES automations(id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, run_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, url TEXT NOT NULL, event TEXT NOT NULL,
      payload_json TEXT NOT NULL, signature TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      next_retry_at TEXT, response_status INTEGER, response_body TEXT, error TEXT,
      created_at TEXT NOT NULL, sent_at TEXT,
      UNIQUE(run_id, event),
      FOREIGN KEY(automation_id) REFERENCES automations(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES automation_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_delivery_due ON webhook_deliveries(status,next_retry_at);
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      runtime TEXT NOT NULL, model_id TEXT, description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'workspace',
      skills_json TEXT NOT NULL DEFAULT '[]', instructions TEXT NOT NULL DEFAULT '', runtime_profile TEXT, avatar TEXT, status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS employee_environment_variables (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, key TEXT NOT NULL,
      value_ciphertext TEXT NOT NULL, sensitive INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(employee_id,key),
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_employee_environment_employee ON employee_environment_variables(employee_id,key);
    CREATE TABLE IF NOT EXISTS employee_custom_params (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, key TEXT NOT NULL,
      value_json TEXT NOT NULL, value_type TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(employee_id,key),
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_employee_custom_params_employee ON employee_custom_params(employee_id,key);
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', start_at TEXT NOT NULL, end_at TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', status TEXT NOT NULL DEFAULT 'planned',
      assignee TEXT, all_day INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_workspace_start ON calendar_events(workspace_id,start_at);
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS a2a_actions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL, task_id TEXT,
      type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT, created_at TEXT NOT NULL,
      acked_at TEXT, completed_at TEXT, result_json TEXT, error TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS a2a_action_events (
      id TEXT PRIMARY KEY, action_id TEXT NOT NULL, type TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL DEFAULT 'null', created_at TEXT NOT NULL,
      FOREIGN KEY(action_id) REFERENCES a2a_actions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_a2a_action_events_action ON a2a_action_events(action_id, created_at);
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      prefix TEXT NOT NULL, token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT,
      role TEXT NOT NULL DEFAULT 'member', rotated_from TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, event_id TEXT,
      actor TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, read_at TEXT, archived_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_workspace_state ON notifications(workspace_id, archived_at, read_at, created_at);
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, employee_id TEXT, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, attachment_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, version TEXT, content TEXT NOT NULL DEFAULT '',
      content_hash TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workspace_preferences (
      workspace_id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'workspace', prefix TEXT NOT NULL DEFAULT '', quota_json TEXT NOT NULL DEFAULT '{}',
      profile_json TEXT NOT NULL DEFAULT '{}', preferences_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );`);
  for (const statement of [
    "ALTER TABLE tasks ADD COLUMN description_format TEXT NOT NULL DEFAULT 'plain'",
    "ALTER TABLE tasks ADD COLUMN created_by TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE devices ADD COLUMN version TEXT",
    "ALTER TABLE devices ADD COLUMN pid INTEGER",
    "ALTER TABLE devices ADD COLUMN bridge_name TEXT",
    "ALTER TABLE devices ADD COLUMN bridge_version TEXT",
    "ALTER TABLE devices ADD COLUMN bridge_status TEXT",
    "ALTER TABLE devices ADD COLUMN heartbeat_at TEXT",
    "ALTER TABLE devices ADD COLUMN heartbeat_interval_ms INTEGER",
    "ALTER TABLE employees ADD COLUMN model_id TEXT",
    "ALTER TABLE employees ADD COLUMN description TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace'",
    "ALTER TABLE employees ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE employees ADD COLUMN runtime_profile TEXT",
    "ALTER TABLE employees ADD COLUMN avatar TEXT",
    "ALTER TABLE runtime_metadata ADD COLUMN profiles_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE skills ADD COLUMN scope TEXT NOT NULL DEFAULT 'platform'",
    "ALTER TABLE skills ADD COLUMN recommended INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE skills ADD COLUMN install_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE skills ADD COLUMN icon TEXT NOT NULL DEFAULT '✦'",
    "ALTER TABLE skills ADD COLUMN author TEXT NOT NULL DEFAULT '紫薇团队'",
    "ALTER TABLE skills ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE skills ADD COLUMN created_at TEXT",
    "ALTER TABLE skills ADD COLUMN updated_at TEXT",
    "ALTER TABLE skills ADD COLUMN source_type TEXT NOT NULL DEFAULT 'catalog'",
    "ALTER TABLE skills ADD COLUMN source_url TEXT",
    "ALTER TABLE skills ADD COLUMN source_device_id TEXT",
    "ALTER TABLE skills ADD COLUMN source_path TEXT",
    "ALTER TABLE skills ADD COLUMN content TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE skills ADD COLUMN content_hash TEXT",
    "ALTER TABLE skills ADD COLUMN version TEXT",
    "ALTER TABLE skills ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'unvalidated'",
    "ALTER TABLE skills ADD COLUMN validation_error TEXT",
    "ALTER TABLE skills ADD COLUMN imported_at TEXT"
    ,"ALTER TABLE documents ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'text/markdown'"
    ,"ALTER TABLE documents ADD COLUMN storage_key TEXT"
    ,"ALTER TABLE documents ADD COLUMN checksum TEXT"
    ,"ALTER TABLE documents ADD COLUMN content_encoding TEXT NOT NULL DEFAULT 'utf8'"
    ,"ALTER TABLE documents ADD COLUMN deleted_at TEXT"
    ,"ALTER TABLE documents ADD COLUMN deleted_by TEXT"
    ,"ALTER TABLE document_versions ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'text/markdown'"
    ,"ALTER TABLE document_versions ADD COLUMN storage_key TEXT"
    ,"ALTER TABLE document_versions ADD COLUMN checksum TEXT"
    ,"ALTER TABLE document_versions ADD COLUMN content_encoding TEXT NOT NULL DEFAULT 'utf8'"
    ,"ALTER TABLE automation_runs ADD COLUMN result_json TEXT"
    ,"ALTER TABLE automation_runs ADD COLUMN error TEXT"
    ,"ALTER TABLE automation_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0"
    ,"ALTER TABLE automation_runs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3"
    ,"ALTER TABLE automation_runs ADD COLUMN next_retry_at TEXT"
    ,"ALTER TABLE automation_runs ADD COLUMN action_id TEXT"
    ,"ALTER TABLE automation_runs ADD COLUMN started_at TEXT"
    ,"ALTER TABLE api_keys ADD COLUMN role TEXT NOT NULL DEFAULT 'member'"
    ,"ALTER TABLE api_keys ADD COLUMN rotated_from TEXT"
    ,"ALTER TABLE automations ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai'"
    ,"ALTER TABLE automations ADD COLUMN webhook_url TEXT"
    ,"ALTER TABLE automations ADD COLUMN output_mode TEXT NOT NULL DEFAULT 'notification'"
    ,"ALTER TABLE automations ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3"
    ,"ALTER TABLE automations ADD COLUMN retry_backoff_ms INTEGER NOT NULL DEFAULT 1000"
    ,"ALTER TABLE automations ADD COLUMN executor TEXT NOT NULL DEFAULT 'ziwei_user'"
    ,"ALTER TABLE automations ADD COLUMN webhook_secret TEXT"
  ]) { try { db.exec(statement); } catch {} }
  seed(db);
  return db;
}

function seed(db) {
  const now = new Date().toISOString();
  // Preserve audit history in the durable inbox when upgrading a workspace
  // that predates the notifications table.
  db.exec(`INSERT OR IGNORE INTO notifications(id,workspace_id,event_id,actor,action,payload_json,created_at,read_at,archived_at)
    SELECT 'notice_' || id,workspace_id,id,actor,action,payload_json,created_at,NULL,NULL FROM audit_events`);
  db.prepare(`INSERT OR IGNORE INTO workspaces(id,slug,name,plan,timezone,created_at) VALUES(?,?,?,?,?,?)`)
    .run('ws-test-111', 'test-111', '紫薇', 'free', 'Asia/Shanghai', now);
  db.prepare(`INSERT OR IGNORE INTO members(id,workspace_id,name,email,role,avatar,joined_at) VALUES(?,?,?,?,?,?,?)`)
    .run('member-owner', 'ws-test-111', '紫薇用户', 'owner@example.com', 'owner', '25', now);
  // A database seed is a registration record, not proof that the local bridge
  // is running.  The daemon must send the first heartbeat before this device
  // becomes online.  Keeping last_seen NULL also lets a fresh installation
  // render the honest "未连接" state instead of a fabricated current time.
  db.prepare(`INSERT OR IGNORE INTO devices(id,workspace_id,name,os,status,last_seen,ip_hint,version,pid,bridge_name,bridge_version,bridge_status,heartbeat_at,heartbeat_interval_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('device-ziwei-user', 'ws-test-111', 'ziwei_user', 'Windows', 'offline', null, '127.0.0.1', process.env.ZIWEI_USER_VERSION || '0.1.0', null, 'ziwei_user', process.env.ZIWEI_USER_VERSION || '0.1.0', 'offline', null, 15000);
  db.prepare(`UPDATE devices SET bridge_name=COALESCE(bridge_name,'ziwei_user'), bridge_version=COALESCE(bridge_version,?), bridge_status=COALESCE(bridge_status,'seeded'), heartbeat_at=COALESCE(heartbeat_at,last_seen), version=COALESCE(version,?) WHERE id='device-ziwei-user'`)
    .run(process.env.ZIWEI_USER_VERSION || '0.1.0', process.env.ZIWEI_USER_VERSION || '0.1.0');
  // Databases created by an earlier build used bridge_status=seeded and a
  // current timestamp.  Migrate only that marker; never overwrite a real
  // heartbeat from a running ziwei_user process.
  db.prepare("UPDATE devices SET status='offline',last_seen=NULL,heartbeat_at=NULL,bridge_status='offline' WHERE id='device-ziwei-user' AND bridge_status='seeded'").run();
  const runtimes = [
    ['runtime-claude','Claude','Anthropic','4.5','offline',['chat','code','browser']],
    ['runtime-codex','Codex','OpenAI','GPT-6','offline',['code','review','terminal']],
    ['runtime-gemini','Gemini','Google','2.5','offline',['research','vision','chat']],
    ['runtime-hermes','Hermes','Hermes','0.3.71','offline',['orchestration','a2a','automation']]
  ];
  const stmt = db.prepare(`INSERT OR IGNORE INTO runtimes(id,workspace_id,name,provider,version,status,capabilities_json,last_seen) VALUES(?,?,?,?,?,?,?,?)`);
  for (const [id,name,provider,version,status,caps] of runtimes) stmt.run(id,'ws-test-111',name,provider,version,status,JSON.stringify(caps),null);
  db.prepare("UPDATE runtimes SET provider='Hermes' WHERE provider='AuraBaba'").run();
  // Older seeds also stamped the catalog rows with the installation time.
  // Clear those timestamps while the own bridge has not reported a heartbeat;
  // the runtime catalog version is metadata, not a liveness signal.
  db.prepare("UPDATE runtimes SET status='offline',last_seen=NULL WHERE workspace_id='ws-test-111' AND NOT EXISTS (SELECT 1 FROM devices WHERE workspace_id='ws-test-111' AND bridge_name='ziwei_user' AND status='online' AND last_seen IS NOT NULL)").run();
  const skills = [
    ['skill-browser','浏览器自动化','打开页面、读取内容并执行可审计操作','automation',1,'platform'],
    ['skill-code','代码工程','分析、修改、测试和构建代码仓库','engineering',1,'platform'],
    ['skill-docs','文档工作流','创建、编辑和导出结构化文档','productivity',1,'platform'],
    ['skill-research','深度研究','检索资料、提炼证据并生成报告','research',0,'platform'],
    ['skill-a2a','A2A 协调','在智能体之间分派任务并同步状态','orchestration',1,'platform']
  ];
  const s = db.prepare(`INSERT OR IGNORE INTO skills(id,workspace_id,name,description,category,installed,source,scope,recommended,install_count,icon,author,tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const skill of skills) s.run(skill[0],'ws-test-111',...skill.slice(1),'platform',skill[4] ? 1 : 0,skill[4] ? 18 : 0,'✦','紫薇平台团队','[]',now,now);
  s.run('skill-team-brief','ws-test-111','团队日报模板','把团队任务和进展整理成可审阅的日报草稿','productivity',0,'team','team',0,0,'☰','紫薇团队','["团队","日报"]',now,now);
  db.prepare("UPDATE skills SET scope=CASE WHEN source='team' THEN 'team' ELSE COALESCE(scope,'platform') END, created_at=COALESCE(created_at,?), updated_at=COALESCE(updated_at,?), icon=COALESCE(icon,'✦'), author=COALESCE(author,'紫薇团队'), tags_json=COALESCE(tags_json,'[]')").run(now,now);
}
