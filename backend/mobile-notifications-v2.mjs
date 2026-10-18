// First-party notification previews. No provider, outbox, DDL or shared read
// mutation: SQLite's existing durable inbox is the only stream authority.
import {createMobileNotificationReadService,MOBILE_NOTIFICATION_MAX_BYTES,MOBILE_NOTIFICATION_SCAN_LIMIT} from './mobile-notifications.mjs';
import {createMobileGroupActionView} from './mobile-group-action.mjs';

const validId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(value);
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const scalar=(column,path)=>`CASE WHEN json_valid(${column}) THEN substr(CAST(json_extract(${column},'${path}') AS TEXT),1,161) END`;
const capped=(column,path,max=32768)=>`CASE WHEN json_valid(${column}) AND length(CAST(json_extract(${column},'${path}') AS BLOB))<=${max} THEN json_extract(${column},'${path}') END`;
const text=(value,max)=>{
  // Keep ordinary text, URLs, line breaks and emoji. Native displays plain
  // text; discard actual markup tags and inline image bytes before truncation.
  const clean=String(value||'').replace(/data:image\/[^\s)"'<>]+/gi,'[图片]').replace(/<\/?[A-Za-z][^>]*>/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim();
  let output='',bytes=0;for(const character of clean){const size=Buffer.byteLength(character);if(bytes+size>max)break;output+=character;bytes+=size;}return output;
};

export function createMobileNotificationV2Service(repo,auth,realtime,{now=Date.now}={}){
  const db=repo.db,v1=createMobileNotificationReadService(repo),groups=createMobileGroupActionView(repo);
  const workspace=db.prepare('SELECT id,slug,kind FROM workspaces WHERE slug=?');
  const membership=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?');
  const session=db.prepare('SELECT 1 FROM local_sessions WHERE id=? AND user_id=? AND expires_at>?');
  const head=db.prepare('SELECT rowid AS sequence,id FROM notifications WHERE workspace_id=? ORDER BY rowid DESC LIMIT 1');
  const anchor=db.prepare('SELECT id FROM notifications WHERE workspace_id=? AND rowid=?');
  const auditHead=db.prepare('SELECT rowid AS sequence,id FROM audit_events WHERE workspace_id=? ORDER BY rowid DESC LIMIT 1');
  const auditAnchor=db.prepare('SELECT id FROM audit_events WHERE workspace_id=? AND rowid=?');
  const more=db.prepare('SELECT 1 FROM notifications WHERE workspace_id=? AND rowid>? LIMIT 1');
  const selection=`SELECT n.rowid AS sequence,n.id,n.archived_at,substr(n.event_id,1,161) AS event_id,substr(n.created_at,1,40) AS notice_at,e.rowid AS audit_sequence,e.action,substr(e.created_at,1,40) AS event_at,
    ${scalar('e.payload_json','$.conversationId')} AS conversation_id,${scalar('e.payload_json','$.messageId')} AS message_id,${scalar('e.payload_json','$.actionId')} AS action_id
    FROM notifications n LEFT JOIN audit_events e ON e.id=n.event_id AND e.workspace_id=n.workspace_id AND e.action=n.action`;
  const scan=db.prepare(`${selection} WHERE n.workspace_id=? AND n.rowid>? ORDER BY n.rowid LIMIT ?`);
  const recent=db.prepare(`${selection} WHERE n.workspace_id=? AND n.rowid<=? ORDER BY n.rowid DESC LIMIT ?`);
  const event=db.prepare(`${selection} WHERE n.workspace_id=? AND n.event_id=? AND n.archived_at IS NULL ORDER BY n.rowid DESC LIMIT 1`);
  const employee=db.prepare('SELECT status,target_device_id,substr(name,1,160) AS name FROM employees WHERE id=? AND workspace_id=?');
  const device=db.prepare('SELECT owner_user_id FROM devices WHERE id=? AND workspace_id=?');
  const message=db.prepare('SELECT id,conversation_id,role,sender_user_id,substr(content,1,4096) AS content,rowid AS sequence FROM conversation_messages WHERE id=? AND conversation_id=?');
  const watermark=db.prepare('SELECT last_message_rowid FROM conversation_reads WHERE user_id=? AND conversation_id=?');
  const latestTerminal=db.prepare("SELECT id FROM audit_events WHERE workspace_id=? AND action IN ('a2a.action.succeeded','a2a.action.failed','a2a.action.expired','a2a.action.cancelled','a2a.action.reconciled') AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.actionId')=? ELSE 0 END ORDER BY rowid DESC LIMIT 1");
  const linked=db.prepare(`SELECT e.id,${scalar('e.payload_json','$.conversationId')} AS conversation_id,${scalar('e.payload_json','$.messageId')} AS message_id
    FROM audit_events e JOIN conversation_messages m ON m.id=CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json,'$.messageId') END
    WHERE e.workspace_id=? AND e.action='conversation.message.created' AND m.role='assistant' AND (m.sender_user_id IS NULL OR m.sender_user_id='')
    AND CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json,'$.actionId')=? ELSE 0 END ORDER BY e.rowid DESC LIMIT 1`);
  const paths=Array.from({length:9},(_,depth)=>'$'+'.result'.repeat(depth)+'.nativeOperation');
  const rosterBudget=paths.flatMap(path=>[`${path}.data.room`,`${path}.data.items`]).map(path=>`COALESCE(length(CAST(json_extract(result_json,'${path}') AS BLOB)),0)`).join('+');
  const roster=path=>`CASE WHEN json_valid(result_json) AND (${rosterBudget})<=32768 THEN ${capped('result_json',path)} END`;
  const nativeColumns=paths.flatMap((path,index)=>[
    `${scalar('result_json',`${path}.resource`)} AS resource_${index}`,
    `${scalar('result_json',`${path}.operation`)} AS operation_${index}`,
    `${scalar('result_json',`${path}.schemaVersion`)} AS schema_${index}`,
    `${scalar('result_json',`${path}.employeeId`)} AS employee_${index}`,
    `${scalar('result_json',`${path}.revision`)} AS revision_${index}`,
    `${scalar('result_json',`${path}.status`)} AS status_${index}`,
    `${roster(`${path}.data.room`)} AS room_${index}`,
    `${roster(`${path}.data.items`)} AS items_${index}`
  ]);
  // Bound only original request and roster metadata. Never hydrate full action
  // result, group logs, images, planner prompts or a conversation transcript.
  const groupAction=db.prepare(`SELECT id,type,status,${scalar('payload_json','$.employeeId')} AS employee_id,${scalar('payload_json','$.userId')} AS user_id,${scalar('payload_json','$.deviceId')} AS device_id,
    ${scalar('payload_json','$.nativeOperation.resource')} AS request_resource,${scalar('payload_json','$.nativeOperation.operation')} AS request_operation,${scalar('payload_json','$.nativeOperation.input.mode')} AS request_mode,
    CASE WHEN json_valid(result_json) THEN json_type(result_json,'${'$'+'.result'.repeat(9)}') END AS deep_result,
    ${capped('payload_json','$.nativeOperation')} AS request_json,${capped('payload_json','$.hermesBot',4096)} AS binding_json,${nativeColumns.join(',')}
    FROM a2a_actions WHERE id=? AND workspace_id=?`);
  function transaction(read){db.exec('SAVEPOINT mobile_notification_v2_read');try{const result=read();db.exec('RELEASE mobile_notification_v2_read');return result;}catch(error){db.exec('ROLLBACK TO mobile_notification_v2_read; RELEASE mobile_notification_v2_read');throw error;}}
  function identity(req){const actor=auth.sessionReference?.(req);if(!actor||!session.get(actor.id,actor.userId,new Date(now()).toISOString()))fail(401,'MOBILE_NOTIFICATION_USER_REQUIRED','请先登录紫薇');return actor;}
  function scope(slug,who){const ws=workspace.get(slug);if(!ws)fail(404,'MOBILE_NOTIFICATION_WORKSPACE_NOT_FOUND','工作区不存在');const member=membership.get(ws.id,who.userId);if(!member||!['owner','admin','member'].includes(member.role))fail(403,'MOBILE_NOTIFICATION_FORBIDDEN','当前用户无权访问该工作区');return {...ws,role:member.role};}
  const context=who=>({actorUserId:who.userId});
  function chat(id,ws,who){
    if(!validId(id))return null;const row=repo.getConversationAccess(id,{actorUserId:who.userId,actorRole:ws.role,enforceEmployeeVisibility:true});if(!row||row.workspace_id!==ws.id||!row.employee_id)return null;
    const owner=employee.get(row.employee_id,ws.id);if(!owner||owner.status==='deleted')return null;
    for(const deviceId of new Set([row.device_id,owner.target_device_id].filter(Boolean))){const target=device.get(deviceId,ws.id);if(!target||ws.kind==='personal'&&!['owner','admin'].includes(ws.role)&&target.owner_user_id!==who.userId)return null;}
    return {...row,name:owner.name};
  }
  function groupAllowed(actionId,ws,who){
    const row=groupAction.get(actionId,ws.id);if(!row)return false;
    const request=parse(row.request_json),groupRequest=row.request_resource==='groups'||row.request_resource==='collaboration'&&(row.request_operation==='publish'||row.request_mode==='group');
    if(row.deep_result)return false;
    const native=[];for(let index=0;index<paths.length;index++)if(row[`resource_${index}`])native.push({schemaVersion:Number(row[`schema_${index}`]),resource:row[`resource_${index}`],operation:row[`operation_${index}`],employeeId:row[`employee_${index}`],revision:Number(row[`revision_${index}`]),status:row[`status_${index}`],data:{room:parse(row[`room_${index}`]),...(row[`items_${index}`]?{items:parse(row[`items_${index}`])}:{})}});
    if(!groupRequest&&!native.some(receipt=>receipt.resource==='groups'||receipt.resource==='collaboration'&&receipt.data.room))return true;
    // Failed/uncertain executions can legally have no room in the original
    // action view. Such a receipt cannot authorize a group message preview.
    if(!native.length||native.some(receipt=>!(request?.resource==='groups'&&request.operation==='list'?Array.isArray(receipt.data.items):receipt.data.room)))return false;
    let result={};for(const receipt of native.reverse())result={nativeOperation:receipt,result};
    try{groups.project(ws.slug,{id:row.id,type:row.type,status:row.status,payload:{employeeId:row.employee_id,userId:row.user_id,deviceId:row.device_id,nativeOperation:request,hermesBot:parse(row.binding_json)},result},context(who),{auxiliary:true,notificationScope:true});return true;}catch(error){if([401,403,404,409].includes(error.status))return false;throw error;}
  }
  function original(eventId,ws,who){try{return v1.resolve(ws.slug,eventId,context(who)).item;}catch(error){if([401,403,404].includes(error.status))return null;throw error;}}
  function sourceFresh(row,after=0){const times=[Date.parse(row.event_at),Date.parse(row.notice_at)];return times.every(value=>Number.isFinite(value)&&value>=after&&value<=now()&&value>now()-7*86400000);}
  function item(row,ws,who,{unread=false,after=0,afterAudit=0}={}){
    if(row.archived_at||!validId(row.event_id)||row.audit_sequence<=afterAudit||!sourceFresh(row,after))return null;
    if(row.action!=='conversation.message.created'){
      if(row.action_id){if(latestTerminal.get(ws.id,row.action_id)?.id!==row.event_id||!groupAllowed(row.action_id,ws,who))return null;
        const reply=linked.get(ws.id,row.action_id),replyEvent=reply?event.get(ws.id,reply.id):null;
        if(replyEvent&&item(replyEvent,ws,who,{unread:false}))return null;
      }
      return original(row.event_id,ws,who);
    }
    const value=message.get(row.message_id,row.conversation_id);if(!value||value.role!=='assistant'||value.sender_user_id)return null;
    const target=chat(row.conversation_id,ws,who);if(!target)return null;
    if(row.action_id){const terminal=latestTerminal.get(ws.id,row.action_id),run=terminal?original(terminal.id,ws,who):null;if(!run||run.target.kind!=='conversation'||run.target.id!==target.id||!groupAllowed(row.action_id,ws,who))return null;}
    const read=unread?watermark.get(who.userId,target.id):null;if(read&&read.last_message_rowid>=value.sequence)return null;
    return {id:row.event_id,kind:'message.received',title:text(target.name,160)||'数字员工',summary:text(value.content,1024)||'[消息]',createdAt:row.event_at,executionState:'not_applicable',target:{kind:'conversation',id:target.id,employeeId:target.employee_id,messageId:value.id,...(row.action_id?{actionId:row.action_id}:{})}};
  }
  function position(cursor,ws,who){
    if(typeof cursor!=='string'||cursor.length>2048||!/^[A-Za-z0-9_-]+$/.test(cursor))fail(400,'MOBILE_NOTIFICATION_CURSOR_INVALID','提醒游标无效，请重新同步');const value=parse(Buffer.from(cursor,'base64url').toString('utf8'));
    if(!value||Object.keys(value).sort().join(',')!=='a,b,h,i,j,p,v,w'||value.v!==2||!Number.isSafeInteger(value.b)||value.b<0||!Number.isSafeInteger(value.p)||value.p<0||!Number.isSafeInteger(value.h)||value.h<0||(value.p===0?value.i!==null:!validId(value.i))||(value.h===0?value.j!==null:!validId(value.j)))fail(400,'MOBILE_NOTIFICATION_CURSOR_INVALID','提醒游标无效，请重新同步');
    if(value.a!==who.userId||value.w!==ws.id)fail(409,'MOBILE_NOTIFICATION_CURSOR_SCOPE','提醒账号或工作区已变化，请重新同步');if(value.p&&anchor.get(ws.id,value.p)?.id!==value.i||value.h&&auditAnchor.get(ws.id,value.h)?.id!==value.j)fail(409,'MOBILE_NOTIFICATION_CURSOR_EXPIRED','提醒游标已失效，请重新同步');return {sequence:value.p,id:value.i,baselineAt:value.b,auditSnapshot:{sequence:value.h,id:value.j}};
  }
  const encode=(last,ws,who,baselineAt,auditSnapshot)=>Buffer.from(JSON.stringify({v:2,a:who.userId,w:ws.id,p:last.sequence,i:last.id,b:baselineAt,h:auditSnapshot.sequence,j:auditSnapshot.id})).toString('base64url');
  function list(req,slug,input={}){return transaction(()=>{
    const who=identity(req),ws=scope(slug,who),baseline=input.baseline,limit=input.limit===undefined?30:Number(input.limit);
    if(baseline!==undefined&&typeof baseline!=='boolean'||baseline&&Object.hasOwn(input,'cursor')||!Number.isInteger(limit)||limit<1||limit>50)fail(400,'MOBILE_NOTIFICATION_INPUT_INVALID','提醒读取参数无效');
    const incremental=Object.hasOwn(input,'cursor'),initial=incremental?position(input.cursor,ws,who):head.get(ws.id)||{sequence:0,id:null},baselineAt=incremental?initial.baselineAt:now(),auditSnapshot=incremental?initial.auditSnapshot:auditHead.get(ws.id)||{sequence:0,id:null};let last=initial;const items=[],seen=new Set();
    const result=()=>{const cursor=encode(last,ws,who,baselineAt,auditSnapshot);return {schemaVersion:2,accountId:who.userId,workspaceId:ws.id,workspaceSlug:ws.slug,nextCursor:cursor,cursor,hasMore:incremental&&Boolean(more.get(ws.id,last.sequence)),...(!incremental?{historyWindow:true}:{}),items};};
    for(const row of baseline?[]:incremental?scan.all(ws.id,initial.sequence,MOBILE_NOTIFICATION_SCAN_LIMIT):recent.all(ws.id,initial.sequence,MOBILE_NOTIFICATION_SCAN_LIMIT)){
      const value=item(row,ws,who,{unread:true,after:incremental?baselineAt:0,afterAudit:incremental?auditSnapshot.sequence:0});if(value&&!seen.has(value.id)){items.push(value);if(Buffer.byteLength(JSON.stringify(result()))>MOBILE_NOTIFICATION_MAX_BYTES-512){items.pop();break;}seen.add(value.id);}
      if(incremental)last={sequence:row.sequence,id:row.id};if(items.length>=limit)break;
    }
    if(!incremental)items.reverse();const output=result();if(Buffer.byteLength(JSON.stringify(output))>MOBILE_NOTIFICATION_MAX_BYTES)fail(500,'MOBILE_NOTIFICATION_SIZE_LIMIT','提醒内容超过读取限制');return output;
  });}
  function resolve(req,slug,id){return transaction(()=>{const who=identity(req),ws=scope(slug,who),row=validId(id)?event.get(ws.id,id):null,value=row?item(row,ws,who):null;if(!value)fail(404,'MOBILE_NOTIFICATION_NOT_FOUND','提醒不存在或已无权查看');return {schemaVersion:2,accountId:who.userId,workspaceId:ws.id,workspaceSlug:ws.slug,item:value};});}
  let active=0;const counts=new Map();
  function wait(req,res,slug,input={}){
    const who=identity(req);scope(slug,who);const seconds=input.timeout===undefined?25:Number(input.timeout);
    if(!Object.hasOwn(input,'cursor')||input.baseline!==undefined||!Number.isInteger(seconds)||seconds<1||seconds>25)fail(400,'MOBILE_NOTIFICATION_WAIT_INVALID','请携带当前游标等待提醒，最长25秒');
    if(active>=256||(counts.get(who.id)||0)>=3)fail(429,'MOBILE_NOTIFICATION_WAIT_LIMIT','提醒连接已达上限');active++;counts.set(who.id,(counts.get(who.id)||0)+1);
    return new Promise((resolvePromise,reject)=>{
      let done=false,timer,scheduled,unsubscribe;
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearImmediate(scheduled);unsubscribe?.();req.off('aborted',abort);res.off('close',abort);active--;const count=(counts.get(who.id)||1)-1;if(count)counts.set(who.id,count);else counts.delete(who.id);error?reject(error):resolvePromise(value);};
      const abort=()=>finish(null,null);
      const read=()=>{if(done)return;try{const page=list(req,slug,{cursor:input.cursor,...(input.limit!==undefined?{limit:input.limit}:{})});if(page.items.length||page.nextCursor!==input.cursor||page.hasMore)finish(null,page);return page;}catch(error){finish(error);}};
      // Subscribe before the first durable read; a hub event only wakes a new
      // authorization/query, and its payload is never a notification response.
      try{
        unsubscribe=realtime.subscribe(slug,()=>{if(!done&&!scheduled)scheduled=setImmediate(()=>{scheduled=null;read();});});
        req.once('aborted',abort);res.once('close',abort);if(req.aborted||res.destroyed)return abort();
        if(!read()||done)return;
        timer=setTimeout(()=>{const page=read();if(!done)finish(null,page);},seconds*1000);
      }catch(error){finish(error);}
    });
  }
  return {list,resolve,wait,activeWaits:()=>active};
}
