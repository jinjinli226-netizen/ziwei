import crypto from 'node:crypto';
import {initializeMobilePushStore} from './mobile-push-store.mjs';
import {createTpnsSender} from './mobile-push-tpns.mjs';
import {createMobileNotificationReadService} from './mobile-notifications.mjs';

const id=()=>crypto.randomBytes(24).toString('base64url');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
const fail=(status,code,message='推送请求无法完成')=>{throw Object.assign(new Error(message),{status,code});};
const scalar=path=>`CASE WHEN json_valid(e.payload_json) THEN substr(CAST(json_extract(e.payload_json,'${path}') AS TEXT),1,161) END`;
const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));

export function createMobilePushService(repo,auth,options={}){
  const db=repo.db,clock=options.now||Date.now,env=options.env||process.env,sender=options.sender||createTpnsSender(options.tpns||{env}),mobile=createMobileNotificationReadService(repo);
  let key;try{if(/^[A-Za-z0-9_-]{43}$/.test(env.ZIWEI_MOBILE_PUSH_TOKEN_KEY||''))key=Buffer.from(env.ZIWEI_MOBILE_PUSH_TOKEN_KEY,'base64url');}catch{}
  const configured=()=>!options.disabled&&key?.length===32&&sender.status().configured===true;
  const config=()=>({schemaVersion:1,provider:'tpns',configured:Boolean(configured()),status:configured()?'ready':'notConfigured',accessId:configured()?sender.status().accessId:null,accessKey:configured()?sender.status().accessKey:null,packageName:'com.ziwei.manager',foregroundTtlSeconds:60});
  if(options.disabled)return {config,start(){},stop(){},wake(){},async drain(){return {accepted:0};},register(){fail(503,'PUSH_NOT_CONFIGURED');},subscription(){fail(503,'PUSH_NOT_CONFIGURED');},foreground(){fail(503,'PUSH_NOT_CONFIGURED');},logout(){fail(503,'PUSH_NOT_CONFIGURED');},resolve(){fail(404,'PUSH_DELIVERY_NOT_FOUND');}};
  initializeMobilePushStore(db);
  const session=db.prepare('SELECT id,user_id FROM local_sessions WHERE id=? AND user_id=? AND expires_at>?');
  const workspace=db.prepare('SELECT id,slug,kind FROM workspaces WHERE slug=?');
  const membership=db.prepare('SELECT role FROM members WHERE user_id=? AND workspace_id=?');
  const installation=db.prepare('SELECT * FROM mobile_push_installations WHERE id=?');
  const head=()=>db.prepare("SELECT seq FROM sqlite_sequence WHERE name='mobile_push_outbox'").get()?.seq||0;
  function tx(write){db.exec('SAVEPOINT mobile_push_write');try{const result=write();db.exec('RELEASE mobile_push_write');return result;}catch(error){db.exec('ROLLBACK TO mobile_push_write; RELEASE mobile_push_write');throw error;}}
  function seal(token){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');}
  function unseal(value){const bytes=Buffer.from(value,'base64url'),cipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
  function input(body){if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>8192)fail(400,'PUSH_INPUT_INVALID');return body;}
  function principal(req){const current=auth.sessionReference(req);if(!current||!session.get(current.id,current.userId,new Date(clock()).toISOString()))fail(401,'PUSH_LOGIN_REQUIRED','请先登录紫薇');return current;}
  function scope(slug,userId){if(typeof slug!=='string'||slug.length>63)fail(400,'PUSH_WORKSPACE_INVALID');const ws=workspace.get(slug),member=ws?membership.get(userId,ws.id):null;if(!ws||!member||!['owner','admin','member'].includes(member.role))fail(403,'PUSH_WORKSPACE_FORBIDDEN');return {...ws,role:member.role};}
  function proof(body){
    input(body);if(typeof body.installationId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(body.installationId)||typeof body.installationSecret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(body.installationSecret))fail(400,'PUSH_INSTALLATION_INVALID');
    if(!Number.isSafeInteger(body.clientEpoch)||body.clientEpoch<1)fail(400,'PUSH_EPOCH_REQUIRED');
  }
  function quota(userId){if(db.prepare('SELECT count(*) AS n FROM mobile_push_installations WHERE user_id=?').get(userId).n>=32)fail(429,'PUSH_INSTALLATION_LIMIT','该账号的推送安装数量已达上限');}
  function owned(body,who=null,{revoked=false}={}){
    proof(body);
    const row=installation.get(body.installationId);if(!row||!safeEqual(row.secret_hash,hash(body.installationSecret))||!revoked&&row.revoked_at!==null||who&&(row.user_id!==who.userId||row.session_id!==who.id))fail(404,'PUSH_INSTALLATION_NOT_FOUND');
    if(body.clientEpoch<row.client_epoch)fail(409,'PUSH_STALE_EPOCH');
    if(who&&body.generation!==row.generation)fail(409,'PUSH_STALE_GENERATION');return row;
  }
  function cancel(installationId){db.prepare("UPDATE mobile_push_deliveries SET state='cancelled',lease_owner=NULL,lease_until=NULL WHERE subscription_id IN (SELECT id FROM mobile_push_subscriptions WHERE installation_id=?) AND state IN ('pending','retry','leased')").run(installationId);db.prepare('DELETE FROM mobile_push_foreground WHERE installation_id=?').run(installationId);}
  function register(req,body){
    if(!configured())fail(503,'PUSH_NOT_CONFIGURED','服务器尚未配置系统推送');const who=principal(req);input(body);
    if(typeof body.installationId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(body.installationId)||typeof body.installationSecret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(body.installationSecret)||body.provider!=='tpns'||typeof body.token!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(body.token)||!Number.isSafeInteger(body.clientEpoch)||body.clientEpoch<1)fail(400,'PUSH_INSTALLATION_INVALID');
    return tx(()=>{
      const prior=installation.get(body.installationId),tokenHash=hash(body.token),other=db.prepare('SELECT id FROM mobile_push_installations WHERE token_hash=?').get(tokenHash);
      if(prior&&!safeEqual(prior.secret_hash,hash(body.installationSecret)))fail(409,'PUSH_INSTALLATION_CONFLICT');
      if(other&&other.id!==body.installationId)fail(409,'PUSH_TOKEN_CONFLICT');
      if(!prior||prior.user_id!==who.userId)quota(who.userId);
      const changed=prior&&(prior.user_id!==who.userId||prior.session_id!==who.id||prior.token_hash!==tokenHash||prior.revoked_at!==null),generation=prior?prior.generation+(changed?1:0):1;
      if(prior&&(body.clientEpoch<prior.client_epoch||changed&&body.clientEpoch===prior.client_epoch))fail(409,'PUSH_STALE_EPOCH');
      if(changed){cancel(prior.id);db.prepare('UPDATE mobile_push_subscriptions SET enabled=0,epoch=epoch+1 WHERE installation_id=?').run(prior.id);}
      db.prepare(`INSERT INTO mobile_push_installations(id,secret_hash,provider,token_hash,token_cipher,user_id,session_id,generation,revoked_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?)
        ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,token_cipher=excluded.token_cipher,user_id=excluded.user_id,session_id=excluded.session_id,generation=excluded.generation,revoked_at=NULL,updated_at=excluded.updated_at`).run(body.installationId,hash(body.installationSecret),'tpns',tokenHash,seal(body.token),who.userId,who.id,generation,clock(),clock());
      db.prepare('UPDATE mobile_push_installations SET client_epoch=? WHERE id=?').run(body.clientEpoch,body.installationId);
      return {schemaVersion:1,installationId:body.installationId,generation,accountId:who.userId};
    });
  }
  function subscription(req,body){
    const who=principal(req);input(body);const ws=scope(body.workspaceSlug,who.userId);if(typeof body.enabled!=='boolean')fail(400,'PUSH_INPUT_INVALID');if(body.enabled&&!configured())fail(503,'PUSH_NOT_CONFIGURED');
    return tx(()=>{
      const row=owned(body,who);
      const old=db.prepare('SELECT * FROM mobile_push_subscriptions WHERE installation_id=? AND workspace_id=?').get(row.id,ws.id),same=old&&Boolean(old.enabled)===body.enabled&&old.session_id===who.id&&old.user_id===who.userId;
      if(old&&!same&&body.clientEpoch<=old.client_epoch)fail(409,'PUSH_STALE_EPOCH');
      const subscriptionId=old?.id||id(),epoch=old?(same?old.epoch:old.epoch+1):1,baseline=same?old.baseline:head();
      db.prepare(`INSERT INTO mobile_push_subscriptions(id,installation_id,workspace_id,user_id,session_id,epoch,enabled,baseline,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(installation_id,workspace_id) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,epoch=excluded.epoch,enabled=excluded.enabled,baseline=excluded.baseline`).run(subscriptionId,row.id,ws.id,who.userId,who.id,epoch,body.enabled?1:0,baseline,clock());
      if(!same)db.prepare("UPDATE mobile_push_deliveries SET state='cancelled',lease_owner=NULL,lease_until=NULL WHERE subscription_id=? AND state IN ('pending','retry','leased')").run(subscriptionId);
      if(!body.enabled)db.prepare('DELETE FROM mobile_push_foreground WHERE installation_id=?').run(row.id);
      db.prepare('UPDATE mobile_push_installations SET client_epoch=? WHERE id=?').run(body.clientEpoch,row.id);
      db.prepare('UPDATE mobile_push_subscriptions SET client_epoch=? WHERE id=?').run(body.clientEpoch,subscriptionId);
      return {schemaVersion:1,subscriptionId,epoch,enabled:body.enabled,accountId:who.userId,workspaceId:ws.id,workspaceSlug:ws.slug,baselineSequence:baseline};
    });
  }
  function chatAccess(conversationId,ws,userId){
    if(!validId(conversationId))return null;const actor={actorUserId:userId,actorRole:ws.role,enforceEmployeeVisibility:true},chat=repo.getConversationAccess(conversationId,actor);
    if(!chat||chat.workspace_id!==ws.id||!chat.employee_id)return null;
    const employee=db.prepare('SELECT status,target_device_id FROM employees WHERE id=? AND workspace_id=?').get(chat.employee_id,ws.id);if(!employee||employee.status==='deleted')return null;
    for(const deviceId of new Set([chat.device_id,employee.target_device_id].filter(Boolean))){const device=db.prepare('SELECT workspace_id,owner_user_id FROM devices WHERE id=?').get(deviceId);if(!device||device.workspace_id!==ws.id||ws.kind==='personal'&&!['owner','admin'].includes(ws.role)&&device.owner_user_id!==userId)return null;}
    return chat;
  }
  function foreground(req,body){const who=principal(req);input(body);const ws=scope(body.workspaceSlug,who.userId);return tx(()=>{const row=owned(body,who);if(typeof body.active!=='boolean')fail(400,'PUSH_INPUT_INVALID');
    if(body.clientEpoch!==row.client_epoch||!Number.isSafeInteger(body.presenceSeq)||body.presenceSeq<1)fail(409,'PUSH_STALE_PRESENCE');
    const presenceHash=hash(JSON.stringify([ws.id,body.active,body.active?body.conversationId:null]));
    if(body.presenceSeq<row.presence_seq||body.presenceSeq===row.presence_seq&&row.presence_hash!==presenceHash)fail(409,'PUSH_STALE_PRESENCE');
    if(body.presenceSeq===row.presence_seq){const saved=db.prepare('SELECT expires_at FROM mobile_push_foreground WHERE installation_id=?').get(row.id);return {schemaVersion:1,expiresAt:saved?new Date(saved.expires_at).toISOString():null};}
    if(!body.active){db.prepare('DELETE FROM mobile_push_foreground WHERE installation_id=?').run(row.id);db.prepare('UPDATE mobile_push_installations SET presence_seq=?,presence_hash=? WHERE id=?').run(body.presenceSeq,presenceHash,row.id);return {schemaVersion:1,expiresAt:null};}
    if(!chatAccess(body.conversationId,ws,who.userId))fail(404,'PUSH_CHAT_NOT_FOUND');const expires=clock()+60000;
    db.prepare('UPDATE mobile_push_installations SET presence_seq=?,presence_hash=? WHERE id=?').run(body.presenceSeq,presenceHash,row.id);
    db.prepare('INSERT INTO mobile_push_foreground(installation_id,user_id,session_id,workspace_id,conversation_id,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,workspace_id=excluded.workspace_id,conversation_id=excluded.conversation_id,expires_at=excluded.expires_at').run(row.id,who.userId,who.id,ws.id,body.conversationId,expires);return {schemaVersion:1,expiresAt:new Date(expires).toISOString()};
  });}
  function logout(req,body){return tx(()=>{
    proof(body);
    if(!installation.get(body.installationId)){
      // A cancelled register request may still arrive later. Only an active
      // authenticated account can reserve a bounded, secret-owned revoke fence.
      const who=auth.sessionReference(req);if(!who||!session.get(who.id,who.userId,new Date(clock()).toISOString()))fail(404,'PUSH_INSTALLATION_NOT_FOUND');quota(who.userId);
      db.prepare('INSERT INTO mobile_push_installations(id,secret_hash,provider,user_id,session_id,generation,client_epoch,revoked_at,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?,?)').run(body.installationId,hash(body.installationSecret),'tpns',who.userId,who.id,body.clientEpoch,clock(),clock(),clock());
      return {schemaVersion:1,revoked:true};
    }
    const row=owned(body,null,{revoked:true});if(body.clientEpoch===row.client_epoch){if(row.revoked_at!==null)return {schemaVersion:1,revoked:true};fail(409,'PUSH_STALE_EPOCH');}cancel(row.id);db.prepare('UPDATE mobile_push_subscriptions SET enabled=0,epoch=epoch+1 WHERE installation_id=?').run(row.id);db.prepare('UPDATE mobile_push_installations SET revoked_at=?,generation=generation+1,client_epoch=?,token_cipher=NULL,token_hash=NULL WHERE id=?').run(clock(),body.clientEpoch,row.id);return {schemaVersion:1,revoked:true};
  });}
  const source=db.prepare(`SELECT e.id,e.action,substr(e.created_at,1,40) AS created_at,substr(n.created_at,1,40) AS notice_created_at,${scalar('$.conversationId')} AS conversation_id,${scalar('$.messageId')} AS message_id,${scalar('$.actionId')} AS action_id
    FROM notifications n JOIN audit_events e ON e.id=n.event_id AND e.workspace_id=n.workspace_id AND e.action=n.action WHERE n.id=? AND n.workspace_id=? AND n.archived_at IS NULL`);
  const latestTerminal=db.prepare("SELECT e.id FROM audit_events e WHERE e.workspace_id=? AND e.action IN ('a2a.action.succeeded','a2a.action.failed','a2a.action.expired','a2a.action.cancelled','a2a.action.reconciled') AND CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json,'$.actionId')=? ELSE 0 END ORDER BY e.rowid DESC LIMIT 1");
  const linkedMessage=db.prepare("SELECT 1 FROM audit_events e JOIN conversation_messages m ON m.id=CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json,'$.messageId') END WHERE e.workspace_id=? AND e.action='conversation.message.created' AND m.role='assistant' AND (m.sender_user_id IS NULL OR m.sender_user_id='') AND CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json,'$.actionId')=? ELSE 0 END LIMIT 1");
  function target(noticeId,ws,userId,{dispatch=false}={}){
    const event=source.get(noticeId,ws.id);if(!event)return null;
    const times=[Date.parse(event.created_at),Date.parse(event.notice_created_at)],eventAt=Math.min(...times);
    if(times.some(value=>!Number.isFinite(value)||value>clock())||eventAt+7*86400000<=clock()||dispatch&&eventAt+300000<=clock())return null;
    if(event.action!=='conversation.message.created'){
      if(event.action_id&&(latestTerminal.get(ws.id,event.action_id)?.id!==event.id||linkedMessage.get(ws.id,event.action_id)))return null;
      try{return mobile.resolve(ws.slug,event.id,{actorUserId:userId}).item;}catch(error){if([401,403,404].includes(error.status))return null;throw error;}
    }
    const message=db.prepare('SELECT id,conversation_id,role,sender_user_id,rowid AS sequence FROM conversation_messages WHERE id=? AND conversation_id=?').get(event.message_id,event.conversation_id);
    // Public chat APIs can retain a human-supplied assistant role. A known
    // human sender is never presented as a new employee reply by system push.
    if(!message||message.role!=='assistant'||message.sender_user_id)return null;
    const chat=chatAccess(event.conversation_id,ws,userId);if(!chat)return null;
    if(event.action_id){const terminal=latestTerminal.get(ws.id,event.action_id);if(!terminal)return null;try{const item=mobile.resolve(ws.slug,terminal.id,{actorUserId:userId}).item;if(item.target.kind!=='conversation'||item.target.id!==chat.id)return null;}catch(error){if([401,403,404].includes(error.status))return null;throw error;}}
    const read=dispatch?db.prepare('SELECT last_message_rowid FROM conversation_reads WHERE user_id=? AND conversation_id=?').get(userId,chat.id):null;if(read&&read.last_message_rowid>=message.sequence)return null;
    return {id:event.id,kind:'message.received',title:'员工发来新回复',summary:'打开原聊天查看新回复。',createdAt:event.created_at,executionState:'not_applicable',target:{kind:'conversation',id:chat.id,employeeId:chat.employee_id,messageId:message.id,...(event.action_id?{actionId:event.action_id}:{})}};
  }
  const deliveryRow=db.prepare(`SELECT d.*,s.installation_id,s.workspace_id,s.user_id AS current_user,s.session_id AS current_session,s.enabled,s.epoch AS current_epoch,i.generation AS current_generation,i.revoked_at,i.token_cipher,o.notice_id,o.event_id,w.slug,w.kind
    FROM mobile_push_deliveries d JOIN mobile_push_subscriptions s ON s.id=d.subscription_id JOIN mobile_push_installations i ON i.id=s.installation_id JOIN mobile_push_outbox o ON o.sequence=d.outbox_sequence JOIN workspaces w ON w.id=s.workspace_id WHERE d.id=?`);
  function live(row,dispatch=false){if(!row||row.expires_at<=clock()||dispatch&&row.created_at+300000<=clock()||row.revoked_at!==null||!row.enabled||row.epoch!==row.current_epoch||row.generation!==row.current_generation||row.user_id!==row.current_user||row.session_id!==row.current_session||!session.get(row.session_id,row.user_id,new Date(clock()).toISOString()))return null;
    const member=membership.get(row.user_id,row.workspace_id);if(!member||!['owner','admin','member'].includes(member.role))return null;return {id:row.workspace_id,slug:row.slug,kind:row.kind,role:member.role};}
  function resolve(req,deliveryId){const who=principal(req),row=typeof deliveryId==='string'&&/^[A-Za-z0-9_-]{32}$/.test(deliveryId)?deliveryRow.get(deliveryId):null,ws=live(row);
    if(!ws||row.user_id!==who.userId||row.session_id!==who.id||!['accepted','unknown','leased','retry','pending'].includes(row.state))fail(404,'PUSH_DELIVERY_NOT_FOUND');const item=target(row.notice_id,ws,who.userId);if(!item)fail(404,'PUSH_DELIVERY_NOT_FOUND');
    return {schemaVersion:1,accountId:who.userId,workspaceId:ws.id,workspaceSlug:ws.slug,item};
  }
  let busy=false,timer=null,scheduled=null;
  async function drain(){
    if(busy||db.isTransaction||!configured())return {accepted:0,skipped:0};busy=true;const stats={accepted:0,skipped:0,retry:0};
    try{
      tx(()=>{
        // A crashed sender may have reached the provider. Never blindly resend
        // an expired lease through a system channel that renders autonomously.
        db.prepare("UPDATE mobile_push_deliveries SET state='unknown',error_code='PUSH_LEASE_OUTCOME_UNKNOWN',lease_owner=NULL,lease_until=NULL WHERE state='leased' AND lease_until<=?").run(clock());
        db.prepare(`UPDATE mobile_push_subscriptions SET enabled=0,epoch=epoch+1 WHERE enabled=1 AND
          (NOT EXISTS(SELECT 1 FROM local_sessions s WHERE s.id=mobile_push_subscriptions.session_id AND s.user_id=mobile_push_subscriptions.user_id AND s.expires_at>?) OR
          NOT EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=mobile_push_subscriptions.workspace_id AND m.user_id=mobile_push_subscriptions.user_id AND m.role IN ('owner','admin','member')))` ).run(new Date(clock()).toISOString());
        db.prepare('DELETE FROM mobile_push_foreground WHERE expires_at<=?').run(clock());
        db.prepare('DELETE FROM mobile_push_deliveries WHERE expires_at<=?').run(clock());
        db.prepare('DELETE FROM mobile_push_outbox WHERE created_at<=?').run(clock()-7*86400000);
        const pending=db.prepare(`SELECT o.sequence,o.created_at AS source_at,s.id,s.epoch,s.user_id,s.session_id,i.generation FROM mobile_push_outbox o JOIN mobile_push_subscriptions s ON s.workspace_id=o.workspace_id AND s.enabled=1 JOIN mobile_push_installations i ON i.id=s.installation_id
          WHERE o.sequence>s.baseline AND o.created_at>? AND NOT EXISTS(SELECT 1 FROM mobile_push_deliveries d WHERE d.outbox_sequence=o.sequence AND d.subscription_id=s.id AND d.epoch=s.epoch) ORDER BY o.sequence LIMIT 100`).all(clock()-300000);
        const insert=db.prepare("INSERT OR IGNORE INTO mobile_push_deliveries(id,outbox_sequence,subscription_id,epoch,generation,user_id,session_id,state,next_at,created_at,expires_at) VALUES(?,?,?,?,?,?,?,'pending',?,?,?)");
        for(const row of pending)insert.run(id(),row.sequence,row.id,row.epoch,row.generation,row.user_id,row.session_id,clock(),row.source_at,row.source_at+7*86400000);
      });
      const due=db.prepare("SELECT id FROM mobile_push_deliveries WHERE state IN ('pending','retry') AND next_at<=? ORDER BY created_at,id LIMIT 25").all(clock());
      for(const entry of due){
        const owner=id(),claimed=db.prepare("UPDATE mobile_push_deliveries SET state='leased',lease_owner=?,lease_until=?,attempts=attempts+1 WHERE id=? AND state IN ('pending','retry') AND next_at<=?").run(owner,clock()+30000,entry.id,clock());if(!claimed.changes)continue;
        const row=deliveryRow.get(entry.id),ws=live(row,true),item=ws?target(row.notice_id,ws,row.user_id,{dispatch:true}):null,front=item?.target.kind==='conversation'?db.prepare('SELECT 1 FROM mobile_push_foreground WHERE installation_id=? AND user_id=? AND session_id=? AND workspace_id=? AND conversation_id=? AND expires_at>?').get(row.installation_id,row.user_id,row.session_id,row.workspace_id,item.target.id,clock()):null;
        if(!item||front){db.prepare("UPDATE mobile_push_deliveries SET state=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?").run(front?'suppressed':'cancelled',row.id,owner);stats.skipped++;continue;}
        let requestStarted=false,providerAccepted=false;
        try{
          const token=unseal(row.token_cipher);requestStarted=true;
          const receipt=await sender.send({token,deliveryId:row.id});
          if(receipt?.accepted!==true)throw Object.assign(new Error('PUSH_PROVIDER_RESPONSE_INVALID'),{code:'PUSH_PROVIDER_RESPONSE_INVALID',retryable:true});
          providerAccepted=true;
          const current=deliveryRow.get(row.id);if(!live(current)){db.prepare("UPDATE mobile_push_deliveries SET state='cancelled',lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?").run(row.id,owner);continue;}
          db.prepare("UPDATE mobile_push_deliveries SET state='accepted',provider_id=?,error_code=NULL,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?").run(String(receipt.providerId||'').slice(0,160),row.id,owner);stats.accepted++;
        }catch(error){
          if(error.invalidToken===true)tx(()=>{const invalid=db.prepare('UPDATE mobile_push_installations SET revoked_at=?,token_hash=NULL,token_cipher=NULL,generation=generation+1 WHERE id=? AND generation=?').run(clock(),row.installation_id,row.generation);if(invalid.changes){cancel(row.installation_id);db.prepare('UPDATE mobile_push_subscriptions SET enabled=0,epoch=epoch+1 WHERE installation_id=?').run(row.installation_id);}});
          const uncertain=providerAccepted||error.unknownOutcome===true||requestStarted&&error.code!=='PUSH_PROVIDER_REJECTED'&&error.invalidToken!==true;
          const retry=!uncertain&&error.code==='PUSH_PROVIDER_REJECTED'&&error.retryable===true&&row.attempts<5&&row.created_at+300000>clock();
          db.prepare("UPDATE mobile_push_deliveries SET state=?,next_at=?,error_code=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?").run(uncertain?'unknown':retry?'retry':'failed',clock()+Math.max(Math.min(60000,error.retryAfterMs||0),Math.min(60000,1000*2**Math.min(row.attempts,6))),/^PUSH_[A-Z_]{1,70}$/.test(error.code||'')?error.code:'PUSH_PROVIDER_UNAVAILABLE',row.id,owner);if(retry)stats.retry++;
        }
      }
      return stats;
    }finally{busy=false;}
  }
  const wake=()=>{if(timer&&!scheduled){scheduled=setTimeout(()=>{scheduled=null;drain().catch(()=>{});},0);scheduled.unref?.();}};
  const start=()=>{if(configured()&&!timer){timer=setInterval(()=>drain().catch(()=>{}),1000);timer.unref?.();wake();}};
  const stop=()=>{clearInterval(timer);clearTimeout(scheduled);timer=null;scheduled=null;};
  return {config,register,subscription,foreground,logout,resolve,drain,start,stop,wake};
}
