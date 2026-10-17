// Additive push-only schema. Existing notification/audit payloads, business
// execution, shared read flags and original tables are never rewritten.
export function initializeMobilePushStore(db){
  db.exec('SAVEPOINT mobile_push_schema');
  try{
  db.exec(`CREATE TABLE IF NOT EXISTS mobile_push_installations(
    id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,provider TEXT NOT NULL,token_hash TEXT UNIQUE,token_cipher TEXT,
    user_id TEXT NOT NULL,session_id TEXT NOT NULL,generation INTEGER NOT NULL,client_epoch INTEGER NOT NULL DEFAULT 0,presence_seq INTEGER NOT NULL DEFAULT 0,presence_hash TEXT,
    revoked_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mobile_push_subscriptions(
    id TEXT PRIMARY KEY,installation_id TEXT NOT NULL,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,session_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,enabled INTEGER NOT NULL,baseline INTEGER NOT NULL,client_epoch INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,
    UNIQUE(installation_id,workspace_id));
    CREATE INDEX IF NOT EXISTS mobile_push_subscription_scope ON mobile_push_subscriptions(workspace_id,enabled);
    CREATE TABLE IF NOT EXISTS mobile_push_outbox(
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,notice_id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL,workspace_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(event_id,workspace_id));
    CREATE INDEX IF NOT EXISTS mobile_push_outbox_scope ON mobile_push_outbox(workspace_id,sequence,created_at);
    CREATE TABLE IF NOT EXISTS mobile_push_deliveries(
    id TEXT PRIMARY KEY,outbox_sequence INTEGER NOT NULL,subscription_id TEXT NOT NULL,epoch INTEGER NOT NULL,generation INTEGER NOT NULL,
    user_id TEXT NOT NULL,session_id TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,
    lease_owner TEXT,lease_until INTEGER,provider_id TEXT,error_code TEXT,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
    UNIQUE(outbox_sequence,subscription_id,epoch));
    CREATE INDEX IF NOT EXISTS mobile_push_delivery_due ON mobile_push_deliveries(state,next_at,lease_until);
    CREATE TABLE IF NOT EXISTS mobile_push_foreground(
    installation_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,workspace_id TEXT NOT NULL,conversation_id TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  const enqueue=`CREATE TRIGGER mobile_push_enqueue AFTER INSERT ON notifications
    WHEN NEW.action IN ('conversation.message.created','task.state_changed','a2a.action.succeeded','a2a.action.failed','a2a.action.expired','a2a.action.cancelled','a2a.action.reconciled')
    AND EXISTS(SELECT 1 FROM mobile_push_subscriptions WHERE workspace_id=NEW.workspace_id AND enabled=1)
    BEGIN INSERT OR IGNORE INTO mobile_push_outbox(notice_id,event_id,workspace_id,created_at)
      VALUES(NEW.id,NEW.event_id,NEW.workspace_id,COALESCE((SELECT min(CAST(strftime('%s',NEW.created_at) AS INTEGER),CAST(strftime('%s',e.created_at) AS INTEGER))*1000
        FROM audit_events e WHERE e.id=NEW.event_id AND e.workspace_id=NEW.workspace_id AND e.action=NEW.action),0)); END`;
  // Backfills retain their original event/notice age, never become new alerts.
  // Upgrade a previous push-only trigger without touching authoritative rows.
  if(db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='mobile_push_enqueue'").get()?.sql!==enqueue){db.exec('DROP TRIGGER IF EXISTS mobile_push_enqueue');db.exec(enqueue);}
  const columns=new Set(db.prepare('PRAGMA table_info(mobile_push_installations)').all().map(row=>row.name));
  for(const [name,type] of [['client_epoch','INTEGER NOT NULL DEFAULT 0'],['presence_seq','INTEGER NOT NULL DEFAULT 0'],['presence_hash','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE mobile_push_installations ADD COLUMN ${name} ${type}`);
  if(!db.prepare('PRAGMA table_info(mobile_push_subscriptions)').all().some(row=>row.name==='client_epoch'))db.exec('ALTER TABLE mobile_push_subscriptions ADD COLUMN client_epoch INTEGER NOT NULL DEFAULT 0');
  db.exec('RELEASE mobile_push_schema');
  }catch(error){db.exec('ROLLBACK TO mobile_push_schema; RELEASE mobile_push_schema');throw error;}
}
