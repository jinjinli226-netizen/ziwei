// A read-only, bounded feed. Existing workspace-wide notification read_at is
// deliberately neither returned as personal state nor changed by this service.
export const MOBILE_NOTIFICATION_MAX_BYTES=64*1024;
export const MOBILE_NOTIFICATION_SCAN_LIMIT=200;
const MAX_LIMIT=50,ID=/^[A-Za-z0-9._:-]{1,160}$/;
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const validId=value=>typeof value==='string'&&ID.test(value);
const json=value=>{try{return JSON.parse(value);}catch{return null;}};
const boundedText=(value,maxBytes)=>{
  const text=String(value||'').replace(/https?:\/\/\S+|data:\S+/gi,'').replace(/<[^>]*>|[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
  let output='';for(const character of text){if(Buffer.byteLength(output+character)>maxBytes)break;output+=character;}return output;
};
const scalar=(column,path)=>`CASE WHEN json_valid(${column}) THEN substr(CAST(json_extract(${column},'${path}') AS TEXT),1,161) END`;

/** Context must come from the authenticated HTTP principal, never query/body.
 * Cursor is an opaque scoped position, not an authorization capability. Every
 * page rechecks actual membership, visibility and original target ownership.
 * Without a cursor, return a bounded recent window and a snapshot-head cursor.
 * baseline:true only obtains that cursor, for enabling future OS alerts.
 * Incremental pages are ascending; empty items with hasMore=true still advance.
 */
export function createMobileNotificationReadService(repo){
  if(!repo?.db||typeof repo.getConversationAccess!=='function')throw new TypeError('Mobile notifications require the existing repository');
  const db=repo.db;
  const workspace=db.prepare('SELECT id,slug,kind FROM workspaces WHERE slug=?');
  const membership=db.prepare('SELECT role FROM members WHERE workspace_id=? AND user_id=?');
  const anchor=db.prepare('SELECT id FROM notifications WHERE workspace_id=? AND rowid=?');
  const head=db.prepare('SELECT rowid AS sequence,id FROM notifications WHERE workspace_id=? ORDER BY rowid DESC LIMIT 1');
  const more=db.prepare('SELECT 1 AS found FROM notifications WHERE workspace_id=? AND rowid>? LIMIT 1');
  // Only scalar IDs cross this boundary. No notification payload, prompt,
  // transcript, image, Bot config or full action result is hydrated.
  const scanSelect=`SELECT n.rowid AS sequence,n.id,n.archived_at,substr(n.event_id,1,161) AS event_id,
    e.action,substr(e.created_at,1,40) AS created_at,
    ${scalar('e.payload_json','$.actionId')} AS action_id,
    ${scalar('e.payload_json','$.taskId')} AS task_id,
    ${scalar('e.payload_json','$.to')} AS task_state
    FROM notifications n LEFT JOIN audit_events e ON e.id=n.event_id AND e.workspace_id=n.workspace_id AND e.action=n.action`;
  const scan=db.prepare(`${scanSelect} WHERE n.workspace_id=? AND n.rowid>? ORDER BY n.rowid LIMIT ?`);
  const recent=db.prepare(`${scanSelect} WHERE n.workspace_id=? AND n.rowid<=? ORDER BY n.rowid DESC LIMIT ?`);
  const byEvent=db.prepare(`${scanSelect} WHERE n.workspace_id=? AND n.event_id=? AND n.archived_at IS NULL ORDER BY n.rowid DESC LIMIT 1`);
  const actionSelect=`SELECT id,workspace_id,task_id,type,status,acked_at,
    ${scalar('payload_json','$.employeeId')} AS employee_id,
    ${scalar('payload_json','$.conversationId')} AS conversation_id,
    ${scalar('payload_json','$.messageId')} AS message_id,
    ${scalar('payload_json','$.userId')} AS user_id,
    ${scalar('payload_json','$.deviceId')} AS device_id,
    ${scalar('payload_json','$.nativeOperation.resource')} AS resource,
    ${scalar('payload_json','$.nativeOperation.operation')} AS operation,
    ${scalar('payload_json','$.runId')} AS run_id
    FROM a2a_actions`;
  const action=db.prepare(`${actionSelect} WHERE id=? AND workspace_id=?`);
  // Match the management task view's latest execution without loading its
  // payload, result or event history. A task's current binding may have become
  // private since its older notification was created.
  const taskAction=db.prepare(`${actionSelect} WHERE task_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 1`);
  const employee=db.prepare('SELECT id,workspace_id,status,visibility,owner_user_id,target_device_id,substr(name,1,160) AS name FROM employees WHERE id=? AND workspace_id=?');
  const device=db.prepare('SELECT workspace_id,owner_user_id FROM devices WHERE id=? AND workspace_id=?');
  const task=db.prepare('SELECT id,state,substr(title,1,160) AS title FROM tasks WHERE id=? AND workspace_id=?');
  const conversationOwner=db.prepare('SELECT employee_id FROM conversations WHERE id=? AND workspace_id=?');
  // Legacy tasks may store an employee name instead of its ID. Check every
  // matching employee in SQL, including duplicate names, without hydrating
  // arbitrary assignee text or a workspace-wide task/employee list.
  const hiddenTaskAssignee=db.prepare(`SELECT 1 AS found FROM tasks t
    JOIN employees e ON e.workspace_id=t.workspace_id AND (e.id=t.assignee OR e.name=t.assignee)
    LEFT JOIN devices d ON d.id=e.target_device_id AND d.workspace_id=e.workspace_id
    WHERE t.id=? AND t.workspace_id=? AND (e.status='deleted' OR
      (e.visibility='personal' AND ?=0 AND coalesce(e.owner_user_id,'')<>?) OR
      (e.target_device_id IS NOT NULL AND (d.id IS NULL OR (? IS NOT NULL AND e.target_device_id<>?) OR
        (?='personal' AND ?=0 AND coalesce(d.owner_user_id,'')<>?)))) LIMIT 1`);
  const automationRun=db.prepare('SELECT 1 AS found FROM automation_runs WHERE id=? AND action_id=? AND workspace_id=?');
  const message=db.prepare('SELECT id FROM conversation_messages WHERE id=? AND conversation_id=?');
  const proof=db.prepare(`SELECT json_valid(result_json) AS valid,
    ${scalar('result_json','$.code')} AS code,
    ${scalar('result_json','$.stopConfirmed')} AS stop_confirmed,
    ${scalar('result_json','$.result.stopConfirmed')} AS nested_stop_confirmed,
    CASE WHEN json_valid(result_json) THEN CASE
      WHEN json_type(result_json,'$.processExit')='object' AND length(CAST(json_extract(result_json,'$.processExit') AS BLOB))<=8192 THEN json_extract(result_json,'$.processExit')
      WHEN json_type(result_json,'$.processExit') IS NULL AND json_type(result_json,'$.result.processExit')='object' AND length(CAST(json_extract(result_json,'$.result.processExit') AS BLOB))<=8192 THEN json_extract(result_json,'$.result.processExit') END END AS exit_json
    FROM a2a_actions WHERE id=? AND workspace_id=?`);
  // Check at most 513 structural nodes. Truncated/fixture/uncertain receipts
  // are conservatively attention-required, never an asserted completed task.
  const receiptFlags=db.prepare(`WITH nodes AS MATERIALIZED (
    SELECT key,type,CASE WHEN type='text' THEN substr(atom,1,64) ELSE atom END AS atom
    FROM json_tree((SELECT CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END FROM a2a_actions WHERE id=? AND workspace_id=?)) LIMIT 513)
    SELECT count(*) AS count,
    max(CASE WHEN key IN ('code','executionState','status') AND atom IN ('EXECUTION_UNCERTAIN','uncertain') THEN 1 ELSE 0 END) AS uncertain,
    max(CASE WHEN key='fixture' AND type NOT IN ('null','false') AND NOT(type IN ('integer','real') AND atom=0) AND NOT(type='text' AND atom='') THEN 1 ELSE 0 END) AS fixture
    FROM nodes`);
  function actorFor(ws,context){
    const actorUserId=context?.actorUserId;
    if(!validId(actorUserId))fail(401,'MOBILE_NOTIFICATION_USER_REQUIRED','请先登录紫薇');
    const member=membership.get(ws.id,actorUserId);
    if(!member||!['owner','admin','member'].includes(member.role))fail(403,'MOBILE_NOTIFICATION_FORBIDDEN','当前用户无权访问该工作区');
    return {actorUserId,actorRole:member.role,enforceEmployeeVisibility:true,privileged:['owner','admin'].includes(member.role),deviceScope:context.deviceScope||null};
  }
  function position(value,ws,actor){
    if(value===undefined||value===null||value==='')return {sequence:0,id:null};
    if(typeof value!=='string'||value.length>2048||!/^[A-Za-z0-9_-]+$/.test(value))fail(400,'MOBILE_NOTIFICATION_CURSOR_INVALID','提醒游标无效，请重新同步');
    const decoded=json(Buffer.from(value,'base64url').toString('utf8'));
    if(!decoded||Object.keys(decoded).sort().join(',')!=='a,i,p,v,w'||decoded.v!==1||!Number.isSafeInteger(decoded.p)||decoded.p<0||(decoded.p===0?decoded.i!==null:!validId(decoded.i)))fail(400,'MOBILE_NOTIFICATION_CURSOR_INVALID','提醒游标无效，请重新同步');
    if(decoded.a!==actor.actorUserId||decoded.w!==ws.id)fail(409,'MOBILE_NOTIFICATION_CURSOR_SCOPE','提醒账号或工作区已变化，请重新同步');
    if(decoded.p&&anchor.get(ws.id,decoded.p)?.id!==decoded.i)fail(409,'MOBILE_NOTIFICATION_CURSOR_EXPIRED','提醒游标已失效，请重新同步');
    return {sequence:decoded.p,id:decoded.i};
  }
  const encode=(ws,actor,last)=>Buffer.from(JSON.stringify({v:1,a:actor.actorUserId,w:ws.id,p:last.sequence,i:last.id})).toString('base64url');
  function allowedDevice(id,ws,actor){
    if(!id)return !actor.deviceScope;
    if(!validId(id)||actor.deviceScope&&actor.deviceScope!==id)return false;
    const row=device.get(id,ws.id);if(!row)return false;
    return ws.kind!=='personal'||actor.privileged||row.owner_user_id===actor.actorUserId;
  }
  function visibleEmployee(id,ws,actor){
    if(!validId(id))return null;
    const row=employee.get(id,ws.id);
    if(!row||row.status==='deleted'||row.visibility==='personal'&&!actor.privileged&&row.owner_user_id!==actor.actorUserId)return null;
    if(row.target_device_id&&!allowedDevice(row.target_device_id,ws,actor))return null;
    return row;
  }
  function visibleTask(id,ws,actor){
    const row=validId(id)?task.get(id,ws.id):null;if(!row)return null;
    if(hiddenTaskAssignee.get(id,ws.id,Number(actor.privileged),actor.actorUserId,actor.deviceScope,actor.deviceScope,ws.kind,Number(actor.privileged),actor.actorUserId))return null;
    const latest=taskAction.get(id,ws.id);
    if(latest){
      if(latest.user_id&&!actor.privileged&&latest.user_id!==actor.actorUserId)return null;
      const employeeId=latest.employee_id||(latest.conversation_id?conversationOwner.get(latest.conversation_id,ws.id)?.employee_id:null);
      const owner=employeeId?visibleEmployee(employeeId,ws,actor):null;
      if(employeeId&&!owner)return null;
      const deviceId=latest.device_id||owner?.target_device_id;
      if(deviceId&&!allowedDevice(deviceId,ws,actor))return null;
    }
    return row;
  }
  function executionItem(row,ws,actor){
    if(!validId(row.action_id))return null;
    const run=action.get(row.action_id,ws.id);
    if(!run||!['conversation.execute','task.execute','automation.execute','hermes.bot.native'].includes(run.type))return null;
    // Native configuration, stop, inspection and validation are not work.
    if(run.type==='hermes.bot.native'&&(!validId(run.run_id)||!['goals.step','heartbeat.step','kanban.dispatch','groups.step'].includes(`${run.resource}.${run.operation}`)||!automationRun.get(run.run_id,run.id,ws.id)))return null;
    if(!['succeeded','failed','expired','cancelled'].includes(run.status))return null;
    // A superseded audit must not announce the old state as today's state.
    if(row.action!==`a2a.action.${run.status}`&&row.action!=='a2a.action.reconciled')return null;
    if(run.user_id&&run.user_id!==actor.actorUserId)return null;
    if(run.device_id&&!allowedDevice(run.device_id,ws,actor))return null;
    const owner=visibleEmployee(run.employee_id,ws,actor);if(!owner)return null;
    let target;
    if(run.conversation_id){
      if(!validId(run.conversation_id))return null;
      const chat=repo.getConversationAccess(run.conversation_id,actor);
      if(!chat||chat.workspace_id!==ws.id||chat.employee_id!==owner.id||chat.device_id&&!allowedDevice(chat.device_id,ws,actor))return null;
      target={kind:'conversation',id:chat.id,employeeId:owner.id,actionId:run.id};
      if(validId(run.message_id)&&message.get(run.message_id,chat.id))target.messageId=run.message_id;
    }else if(visibleTask(run.task_id,ws,actor))target={kind:'task',id:run.task_id,employeeId:owner.id,actionId:run.id};
    else return null;
    const receipt=proof.get(run.id,ws.id),flags=receiptFlags.get(run.id,ws.id),exit=json(receipt?.exit_json);
    const trustedProof=receipt?.valid===1&&flags.count<=512&&!flags.uncertain&&!flags.fixture;
    // The paired dispatcher also records a sealed runtime-prelaunch failure:
    // no root was spawned and its owned tree is empty. Keep that definitive
    // failed result distinct from missing or uncertain exit evidence.
    const notLaunched=trustedProof&&run.status==='failed'&&exit?.supervisor==='runtime-prelaunch'&&exit.launched===false&&exit.rootPid===null&&exit.rootExitCode===null&&exit.rootConfirmed===false&&exit.treeConfirmed===true&&exit.activeProcesses===0&&exit.cancelled===false&&!exit.failureCode&&!exit.signal&&exit.hostExitCode==null;
    let confirmed=trustedProof&&exit?.launched===true&&Number.isSafeInteger(exit.rootPid)&&exit.rootPid>0&&exit.rootConfirmed===true&&exit.treeConfirmed===true&&exit.activeProcesses===0;
    if(run.status==='succeeded')confirmed=confirmed&&exit.rootExitCode===0&&exit.cancelled!==true&&!exit.failureCode&&!exit.signal&&(exit.hostExitCode==null||exit.hostExitCode===0);
    else if(run.status==='failed')confirmed=notLaunched||confirmed&&(Number.isSafeInteger(exit?.rootExitCode)||exit?.rootExitCode===null&&(exit.cancelled===true||typeof exit.signal==='string'&&Boolean(exit.signal)));
    else confirmed=false;
    if(!run.acked_at&&receipt?.code==='BOT_CANCELLED_BEFORE_START'||confirmed&&(exit.cancelled===true||receipt.stop_confirmed==='1'||receipt.nested_stop_confirmed==='1'))return null;
    const kind=confirmed?(run.status==='succeeded'?'execution.completed':'execution.failed'):'attention.required';
    const name=boundedText(owner.name,80)||'数字员工';
    return {id:row.event_id,kind,createdAt:row.created_at,title:boundedText(`${name} · ${kind==='execution.completed'?'执行完成':kind==='execution.failed'?'执行失败':'执行待核实'}`,120),
      summary:boundedText(kind==='execution.completed'?'执行已结束，可查看原聊天中的结果。':kind==='execution.failed'?(notLaunched?'执行在启动前未能开始，请查看原记录。':'执行已结束并返回失败，请查看原记录。'):'原执行的结束状态尚未完整确认，请查看原回执；不会自动重试。',240),target,executionState:confirmed?'confirmed':'uncertain'};
  }
  function itemFor(row,ws,actor){
    if(row.archived_at||!validId(row.event_id)||!row.created_at)return null;
    if(/^a2a\.action\.(succeeded|failed|expired|cancelled|reconciled)$/.test(row.action||''))return executionItem(row,ws,actor);
    if(row.action!=='task.state_changed'||!['review','blocked','todo'].includes(row.task_state)||!validId(row.task_id))return null;
    const current=visibleTask(row.task_id,ws,actor);if(!current||current.state!==row.task_state||actor.deviceScope)return null;
    return {id:row.event_id,kind:'attention.required',createdAt:row.created_at,title:boundedText(current.title,120)||'待处理工作',summary:boundedText(row.task_state==='review'?'工作已提交，等待检查。':row.task_state==='blocked'?'工作遇到阻碍，需要处理。':'有一项待处理工作。',240),target:{kind:'task',id:current.id},executionState:'not_applicable'};
  }
  function list(slug,input={},context={}){
    if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'MOBILE_NOTIFICATION_INPUT_INVALID','提醒读取参数无效');
    if(input.baseline!==undefined&&typeof input.baseline!=='boolean'||input.baseline&&Object.hasOwn(input,'cursor'))fail(400,'MOBILE_NOTIFICATION_INPUT_INVALID','建立提醒基线时不能携带旧游标');
    const limit=input.limit===undefined?20:Number(input.limit);
    if(!Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)fail(400,'MOBILE_NOTIFICATION_LIMIT_INVALID','提醒每次最多读取50条');
    db.exec('SAVEPOINT mobile_notification_read');
    try{
      const ws=workspace.get(slug);if(!ws)fail(404,'MOBILE_NOTIFICATION_WORKSPACE_NOT_FOUND','工作区不存在');
      const actor=actorFor(ws,context),initial=position(input.cursor,ws,actor),incremental=Boolean(input.cursor),items=[],seen=new Set();
      let last=incremental?initial:head.get(ws.id)||{sequence:0,id:null};
      const result=()=>({schemaVersion:1,accountId:actor.actorUserId,workspaceId:ws.id,workspaceSlug:ws.slug,nextCursor:encode(ws,actor,last),hasMore:incremental&&Boolean(more.get(ws.id,last.sequence)),...(!incremental?{historyWindow:true}:{}),items});
      const rows=input.baseline?[]:incremental?scan.all(ws.id,initial.sequence,MOBILE_NOTIFICATION_SCAN_LIMIT):recent.all(ws.id,last.sequence,MOBILE_NOTIFICATION_SCAN_LIMIT);
      for(const row of rows){
        const item=itemFor(row,ws,actor);
        if(item&&!seen.has(item.id)){
          items.push(item);
          if(Buffer.byteLength(JSON.stringify(result()))>MOBILE_NOTIFICATION_MAX_BYTES-512){items.pop();break;}
          seen.add(item.id);
        }
        if(incremental)last={sequence:row.sequence,id:row.id};
        if(items.length>=limit)break;
      }
      if(!incremental)items.reverse();
      const output=result();
      if(Buffer.byteLength(JSON.stringify(output))>MOBILE_NOTIFICATION_MAX_BYTES)fail(500,'MOBILE_NOTIFICATION_SIZE_LIMIT','提醒内容超过读取限制');
      db.exec('RELEASE mobile_notification_read');return output;
    }catch(error){db.exec('ROLLBACK TO mobile_notification_read; RELEASE mobile_notification_read');throw error;}
  }
  function resolve(slug,eventId,context={}){
    db.exec('SAVEPOINT mobile_notification_resolve');
    try{
      const ws=workspace.get(slug);if(!ws)fail(404,'MOBILE_NOTIFICATION_WORKSPACE_NOT_FOUND','工作区不存在');
      const actor=actorFor(ws,context),row=validId(eventId)?byEvent.get(ws.id,eventId):null,item=row?itemFor(row,ws,actor):null;
      if(!item)fail(404,'MOBILE_NOTIFICATION_NOT_FOUND','提醒不存在或已无权查看');
      const output={schemaVersion:1,accountId:actor.actorUserId,workspaceId:ws.id,workspaceSlug:ws.slug,item};
      if(Buffer.byteLength(JSON.stringify(output))>MOBILE_NOTIFICATION_MAX_BYTES)fail(500,'MOBILE_NOTIFICATION_SIZE_LIMIT','提醒内容超过读取限制');
      db.exec('RELEASE mobile_notification_resolve');return output;
    }catch(error){db.exec('ROLLBACK TO mobile_notification_resolve; RELEASE mobile_notification_resolve');throw error;}
  }
  return {list,resolve};
}
