import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {digest,uncertain,exitedTree,executionExit} from './version-preservation.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const normalized=row=>({...row,payload:row.payload||parse(row.payload_json)||{},result:row.result||parse(row.result_json)});
export const nativeActionDigest=row=>digest(normalized(row));
const resultOf=action=>action?.result?.result||action?.result;
const terminal=action=>Boolean(action&&['succeeded','failed'].includes(action.status)&&action.acked_at&&!uncertain(action.result)&&exitedTree(executionExit(action.result))&&(!resultOf(action)?.turn?.processExit||exitedTree(executionExit(resultOf(action).turn))));
export function attestNativeVersion(scope,actions){
  if(scope.nativeVersion)return{nativeVersion:scope.nativeVersion,attestations:[]};
  const attestations=[];
  for(const raw of actions){const action=normalized(raw),validation=resultOf(action)?.botValidation,iso=validation?.isolation,context=action.payload.hermesBot;
    if(action.type!=='hermes.bot.validate'||action.status!=='succeeded'||!terminal(action)||action.workspace_id!==scope.workspaceId||action.payload.employeeId!==scope.employeeId||action.payload.deviceId!==scope.deviceId||context?.workspace!==scope.workspace||context.employeeId!==scope.employeeId||context.sourceProfile!==scope.sourceProfile||validation?.valid!==true||validation.schemaVersion!==1||validation.employeeId!==scope.employeeId||validation.revision!==context.revision||validation.sourceProfile!==scope.sourceProfile||typeof validation.nativeFingerprint!=='string'||!validation.nativeFingerprint||iso?.enabled!==true||iso.kind!=='hermes-bot'||iso.key!==scope.ownershipId||iso.workspace!==scope.workspace||iso.employeeId!==scope.employeeId||iso.sourceProfile!==scope.sourceProfile||iso.revision!==context.revision||typeof validation.nativeVersion!=='string'||!validation.nativeVersion)continue;
    attestations.push({actionId:action.id,actionDigest:nativeActionDigest(action),nativeVersion:validation.nativeVersion,nativeFingerprint:validation.nativeFingerprint});
  }
  const versions=[...new Set(attestations.map(row=>row.nativeVersion))];
  return{nativeVersion:versions.length===1?versions[0]:undefined,attestations};
}
const columns=(db,table)=>db.prepare(`PRAGMA table_info(${table})`).all().map(row=>({name:row.name,type:row.type,pk:row.pk}));
const signatures={state_meta:{key:['TEXT',1],value:['TEXT',0]},schema_version:{version:['INTEGER',0]},sessions:{id:['TEXT',1],source:['TEXT',0],started_at:['REAL',0]},messages:{id:['INTEGER',1],session_id:['TEXT',0],role:['TEXT',0],timestamp:['REAL',0]},tasks:{id:['TEXT',1],tenant:['TEXT',0],created_by:['TEXT',0],status:['TEXT',0],current_run_id:['INTEGER',0],claim_lock:['TEXT',0],claim_expires:['INTEGER',0],worker_pid:['INTEGER',0],worker_started_at:['INTEGER',0]},task_runs:{id:['INTEGER',1],task_id:['TEXT',0],status:['TEXT',0],claim_lock:['TEXT',0],claim_expires:['INTEGER',0],worker_pid:['INTEGER',0],worker_started_at:['INTEGER',0],ended_at:['INTEGER',0],outcome:['TEXT',0]},hosted_rooms:{room_id:['TEXT',1],members_json:['TEXT',0],authority_gateway_id:['TEXT',0],authority_epoch:['INTEGER',0],next_seq:['INTEGER',0],revision:['INTEGER',0]},hosted_room_events:{room_id:['TEXT',1],seq:['INTEGER',2],event_id:['TEXT',0],kind:['TEXT',0],actor_json:['TEXT',0],authority_epoch:['INTEGER',0],payload_json:['TEXT',0]}};
function table(db,name,required){const schema=columns(db,name);if(!required.every(column=>{const expected=signatures[name]?.[column];return expected&&schema.some(row=>row.name===column&&row.type.toUpperCase()===expected[0]&&row.pk===expected[1]);}))throw Error('NATIVE_DATABASE_SCHEMA_UNKNOWN');return schema;}
const hasTable=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

// SQLite fileformat2 WAL header/frame checksums. Unknown reset tails refuse;
// quick_check alone can silently read the old main DB after an invalid WAL.
function validateWal(bytes,main){
  if(!bytes.length)return;
  const fail=()=>{throw Error('NATIVE_WAL_UNPROVEN');};
  if(bytes.length<32||main.length<100)fail();
  const magic=bytes.readUInt32BE(0),size=bytes.readUInt32BE(8),mainSize=main.readUInt16BE(16)===1?65536:main.readUInt16BE(16);
  if(![0x377f0682,0x377f0683].includes(magic)||bytes.readUInt32BE(4)!==3007000||size!==mainSize||size<512||size>65536||(size&(size-1))||(bytes.length-32)%(size+24))fail();
  let s0=0,s1=0;const word=offset=>magic===0x377f0682?bytes.readUInt32LE(offset):bytes.readUInt32BE(offset);
  const checksum=(start,end)=>{for(let i=start;i<end;i+=8){s0=(s0+word(i)+s1)>>>0;s1=(s1+word(i+4)+s0)>>>0;}};
  checksum(0,24);if(s0!==bytes.readUInt32BE(24)||s1!==bytes.readUInt32BE(28))fail();
  const salt=bytes.subarray(16,24);let committed=bytes.length===32;
  for(let offset=32;offset<bytes.length;offset+=size+24){
    if(!bytes.subarray(offset+8,offset+16).equals(salt)||!bytes.readUInt32BE(offset))fail();
    checksum(offset,offset+8);checksum(offset+24,offset+24+size);
    if(s0!==bytes.readUInt32BE(offset+16)||s1!==bytes.readUInt32BE(offset+20))fail();
    committed=bytes.readUInt32BE(offset+4)>0;
  }
  if(!committed)fail();
}

/** Source bytes are never opened by SQLite: WAL is copied with the DB to a private reader. */
function snapshot(file,files,read){
  const source=[];
  for(const suffix of ['', '-wal', '-journal']){
    const target=file+suffix;
    if(!fs.existsSync(target)){const proof={path:target,exists:false};source.push({proof});files.push(proof);continue;}
    const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('NATIVE_DATABASE_IDENTITY_UNKNOWN');
    const bytes=fs.readFileSync(target),proof={path:target,exists:true,bytes:bytes.length,sha256:hash(bytes),identity:{dev:String(stat.dev),ino:String(stat.ino)}};
    files.push(proof);source.push({proof,bytes});if(suffix==='-journal'&&bytes.length)throw Error('NATIVE_DATABASE_RECOVERY_REQUIRED');
  }
  if(!source[0].proof.exists){if(source[1].proof.exists)throw Error('NATIVE_DATABASE_ORPHAN_WAL');return null;}
  if(source[1].proof.exists)validateWal(source[1].bytes,source[0].bytes);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-native-read-')),copy=path.join(directory,path.basename(file));let db;
  try{
    for(const item of source.filter(row=>row.proof.exists&&!row.proof.path.endsWith('-journal')))fs.writeFileSync(path.join(directory,path.basename(item.proof.path)),item.bytes,{mode:0o600});
    db=new DatabaseSync(copy,{readOnly:true});db.function('ziwei_private_sha256',{deterministic:true},value=>typeof value==='string'?hash(value):null);db.exec('PRAGMA query_only=ON; BEGIN');
    if(db.prepare('PRAGMA quick_check').all().some(row=>Object.values(row)[0]!=='ok'))throw Error('NATIVE_DATABASE_CORRUPT');
    const result=read(db);db.exec('COMMIT');return result;
  }finally{
    db?.close();
    for(const name of fs.readdirSync(directory)){const target=path.join(directory,name);if(fs.lstatSync(target).isSymbolicLink()||!fs.lstatSync(target).isFile())throw Error('NATIVE_SNAPSHOT_CLEANUP_UNKNOWN');fs.unlinkSync(target);}fs.rmdirSync(directory);
    for(const {proof} of source){if(proof.exists){const stat=fs.lstatSync(proof.path);if(stat.isSymbolicLink()||String(stat.dev)!==proof.identity.dev||String(stat.ino)!==proof.identity.ino||hash(fs.readFileSync(proof.path))!==proof.sha256)throw Error('NATIVE_DATABASE_CHANGED');}else if(fs.existsSync(proof.path))throw Error('NATIVE_DATABASE_CHANGED');}
  }
}

export function readDatabaseSnapshot(file,reader){const proofs=[];return snapshot(path.resolve(file),proofs,reader);}

const nativeInboundKey=row=>'ziwei.gateway.inbound:'+hash('['+[row.platform,String(row.chatId),row.messageId].map(value=>JSON.stringify(value).replace(/[^\x20-\x7e]/g,character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'))).join(', ')+']');
export function scanOwnedNativeDatabases({homes=[],actions=[],gatewayInbox=[],gatewayExits=[],operationId}={}){
  const originals=actions.map(normalized),issues=[],files=[],nativeDatabases=[],nativeStateProofs=[],gatewayInboxProofs=[],directories=[];
  const issue=(code,scope,extra={})=>issues.push({code,home:scope.home,employeeId:scope.employeeId,...extra});
  for(const scope of homes){
    for(const relative of ['collaboration','collaboration/bot_relay','collaboration/bot_relay/outbox','collaboration/bot_relay/claimed','collaboration/bot_relay/replies','collaboration/bot_relay/locks']){
      const directory=path.join(scope.home,relative);
      try{
      if(!fs.existsSync(directory)){directories.push({path:directory,exists:false,names:[]});continue;}
      const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()){issue('NATIVE_COLLABORATION_SCOPE_UNKNOWN',scope,{path:directory});continue;}
      const names=fs.readdirSync(directory).sort();directories.push({path:directory,exists:true,names,identity:{dev:String(stat.dev),ino:String(stat.ino)}});
      if(relative==='collaboration/bot_relay'&&names.includes('roster.json')){const file=path.join(directory,'roster.json'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())issue('NATIVE_COLLABORATION_SCOPE_UNKNOWN',scope,{path:file});else{const bytes=fs.readFileSync(file);files.push({path:file,exists:true,sha256:hash(bytes),bytes:bytes.length,identity:{dev:String(stat.dev),ino:String(stat.ino)}});}}
      if(['outbox','claimed','replies','locks'].includes(path.basename(relative))&&names.length)issue('NATIVE_COLLABORATION_QUEUE_UNPROVEN',scope,{path:directory,entries:names.length});
      if(relative==='collaboration'&&names.some(name=>name!=='bot_relay')||relative==='collaboration/bot_relay'&&names.some(name=>!['outbox','claimed','replies','locks','roster.json'].includes(name)))issue('NATIVE_COLLABORATION_SCOPE_UNKNOWN',scope,{path:directory});
      }catch{issue('NATIVE_COLLABORATION_UNREADABLE',scope,{path:directory});}
    }
    const relevant=originals.filter(action=>action.payload.employeeId===scope.employeeId&&(!scope.workspaceId||action.workspace_id===scope.workspaceId));
    const sameAction=action=>action?.workspace_id===scope.workspaceId&&action.payload.deviceId===scope.deviceId&&action.payload.hermesBot?.employeeId===scope.employeeId&&action.payload.hermesBot?.workspace===scope.workspace;
    for(const action of relevant){const receipt=resultOf(action),versions=[receipt?.nativeOperation?.nativeVersion,receipt?.botValidation?.nativeVersion].filter(value=>typeof value==='string'&&value);if(versions.some(value=>value!=='0.21.3'||scope.nativeVersion&&value!==scope.nativeVersion))issue('NATIVE_VERSION_CONFLICT',scope,{actionId:action.id});}
    const proof=(kind,action,extra)=>{const value={kind,home:scope.home,employeeId:scope.employeeId,workspace:scope.workspace,workspaceId:scope.workspaceId,origin:scope.origin,deviceId:scope.deviceId,ownershipId:scope.ownershipId,operationId,sourceActionId:action.id,actionDigest:digest(action),resultDigest:digest(action.result),treeDigest:digest(executionExit(action.result)),...extra};nativeStateProofs.push(value);return value;};
    const readDb=(name,reader)=>{const file=path.join(scope.home,name);try{if(fs.existsSync(file)&&scope.nativeVersion!=='0.21.3')throw Error('NATIVE_VERSION_UNKNOWN');const data=snapshot(file,files,reader);nativeDatabases.push({home:scope.home,employeeId:scope.employeeId,deviceId:scope.deviceId,operationId,path:file,exists:data!==null,...(data?{schemaDigest:digest(data.schema),rowsDigest:digest(data.rows)}:{})});return data;}catch(error){issue(/^NATIVE_[A-Z_]+$/.test(error.message)?error.message:'NATIVE_DATABASE_UNREADABLE',scope,{path:file});return undefined;}};
    const state=readDb('state.db',db=>{
      const schema=[table(db,'state_meta',['key','value']),table(db,'schema_version',['version']),table(db,'sessions',['id','source','started_at']),table(db,'messages',['id','session_id','role','timestamp'])];
      const versions=db.prepare('SELECT version FROM schema_version').all();if(versions.length!==1||versions[0].version!==30)throw Error('NATIVE_DATABASE_SCHEMA_UNKNOWN');
      const rows=db.prepare("SELECT key,value FROM state_meta WHERE key GLOB 'ziwei.driver.*' ORDER BY key").all();
      const invalid=db.prepare("SELECT key FROM state_meta WHERE key GLOB 'ziwei.gateway.inbound:*' AND json_valid(value)=0 ORDER BY key").all();if(invalid.length)throw Error('NATIVE_GATEWAY_RECORD_UNKNOWN');
      const inbound=db.prepare("SELECT key,json_type(value) value_type,json_type(value,'$.content') contentType,ziwei_private_sha256(json_extract(value,'$.content')) contentDigest,json_type(value,'$.revision') revisionType,json_type(value,'$.controlEpoch') epochType,json_extract(value,'$.platform') platform,json_extract(value,'$.sourceActionId') sourceActionId,json_extract(value,'$.messageId') messageId,json_extract(value,'$.chatId') chatId,json_extract(value,'$.revision') revision,json_extract(value,'$.controlEpoch') controlEpoch,json_extract(value,'$.state') state FROM state_meta WHERE key GLOB 'ziwei.gateway.inbound:*' ORDER BY key").all();
      return{schema,rows:[...rows.map(row=>({key:row.key,valueDigest:hash(String(row.value))})),...inbound],driver:rows,inbound};
    });
    const kanban=readDb('kanban.db',db=>{
      const schema=[table(db,'tasks',['id','tenant','created_by','status','current_run_id','claim_lock','claim_expires','worker_pid','worker_started_at']),table(db,'task_runs',['id','task_id','status','claim_lock','claim_expires','worker_pid','worker_started_at','ended_at','outcome'])];
      const tasks=db.prepare('SELECT id,tenant,created_by,status,current_run_id,claim_lock,claim_expires,worker_pid,worker_started_at FROM tasks ORDER BY id').all(),runs=db.prepare('SELECT id,task_id,status,claim_lock,claim_expires,worker_pid,worker_started_at,ended_at,outcome FROM task_runs ORDER BY id').all();return{schema,rows:[...tasks,...runs],tasks,runs};
    });
    const needsState=action=>{const receipt=resultOf(action)?.nativeOperation;return Boolean(resultOf(action)?.nativeSessionId||['goals','heartbeat'].includes(receipt?.resource)&&receipt.data?.sessionId||['goals','heartbeat','kanban'].includes(receipt?.resource)&&receipt.data?.sourceActionId||action.status==='succeeded'&&action.payload.nativeOperation?.resource==='gateway'&&action.payload.nativeOperation.operation==='connect');};
    const needsKanban=action=>{const receipt=resultOf(action)?.nativeOperation;return receipt?.resource==='kanban'&&Boolean(receipt.data?.task||receipt.data?.items?.length||receipt.data?.runs?.length);};
    if(state===null&&relevant.some(needsState))issue('NATIVE_DATABASE_REQUIRED',scope,{resource:'state'});
    if(kanban===null&&relevant.some(needsKanban))issue('NATIVE_DATABASE_REQUIRED',scope,{resource:'kanban'});
    for(const action of relevant.filter(action=>needsState(action)||needsKanban(action))){const receipt=resultOf(action)?.nativeOperation;if(receipt&&(!sameAction(action)||receipt.employeeId!==scope.employeeId||receipt.revision!==action.payload.hermesBot?.revision))issue('NATIVE_RESOURCE_HISTORY_IDENTITY_UNKNOWN',scope,{actionId:action.id});}
    const pending=new Map(),settled=new Map();
    for(const row of state?.driver||[]){const value=parse(row.value);if(!value||typeof value!=='object'||Array.isArray(value)){issue('NATIVE_DRIVER_RECORD_UNKNOWN',scope,{key:row.key});continue;}
      if(row.key.startsWith('ziwei.driver.pending:'))pending.set(row.key,value);else if(row.key.startsWith('ziwei.driver.settled:'))settled.set(row.key,value);else issue('NATIVE_DRIVER_RECORD_UNKNOWN',scope,{key:row.key});}
    const matchedRuns=new Set(),matchedSettled=new Set();
    for(const [key,value] of pending){
      const matches=relevant.filter(action=>key===`ziwei.driver.pending:${action.payload.nativeOperation?.requestId}:${action.payload.nativeOperation?.resource}`),action=matches.length===1?matches[0]:null,op=action?.payload.nativeOperation,receipt=resultOf(action)?.nativeOperation;
      if(!action||!sameAction(action)||!terminal(action)||value.run!==true||!['_settle','_fail'].includes(receipt?.operation)||receipt.resource!==op.resource||receipt.employeeId!==scope.employeeId||receipt.revision!==action.payload.hermesBot.revision||receipt.data?.sourceActionId!==action.id){issue('NATIVE_DRIVER_UNSETTLED',scope,{key});continue;}
      if(['goals','heartbeat'].includes(op.resource)){
        const settledKey=`ziwei.driver.settled:${op.requestId}:${op.resource}`,data=settled.get(settledKey);
        if(!value.sessionId||data?.sessionId!==value.sessionId||data.sourceActionId!==action.id||digest(data)!==digest(receipt.data)){issue('NATIVE_DRIVER_UNSETTLED',scope,{key});continue;}
        matchedSettled.add(settledKey);proof('driver',action,{resource:op.resource,requestId:op.requestId,pendingKey:key,settledKey,sessionId:value.sessionId,nativeRowDigest:digest([value,data])});
      }else if(op.resource==='kanban'){
        const taskId=value.task?.id,runId=value.task?.current_run_id,run=kanban?.runs.find(row=>row.id===runId&&row.task_id===taskId),task=kanban?.tasks.find(row=>row.id===taskId),done=run?.status==='done'&&run.outcome==='completed',blocked=run?.status==='blocked'&&run.outcome==='blocked';
        if(!taskId||taskId!==op.input?.taskId||receipt.data.task?.id!==taskId||!task||!run||!run.ended_at||!(done||blocked)||run.claim_expires!==null||run.claim_lock!==scope.employeeId||run.worker_pid&&run.worker_pid!==executionExit(action.result)?.rootPid||receipt.data.settled===false||done&&receipt.data.verdict!=='done'||blocked&&receipt.data.verdict==='done'){issue('NATIVE_KANBAN_UNSETTLED',scope,{key,taskId,runId});continue;}
        matchedRuns.add(run.id);proof('driver',action,{resource:'kanban',requestId:op.requestId,pendingKey:key,taskId,runId,nativeRowDigest:digest([value,run])});
      }else issue('NATIVE_DRIVER_RECORD_UNKNOWN',scope,{key});
    }
    for(const key of settled.keys())if(!matchedSettled.has(key))issue('NATIVE_DRIVER_ORPHAN_SETTLEMENT',scope,{key});
    for(const action of relevant){const op=action.payload.nativeOperation,receipt=resultOf(action)?.nativeOperation;if(['goals','heartbeat','kanban'].includes(op?.resource)&&['_settle','_fail'].includes(receipt?.operation)&&!nativeStateProofs.some(row=>row.home===scope.home&&row.sourceActionId===action.id&&row.pendingKey===`ziwei.driver.pending:${op.requestId}:${op.resource}`))issue('NATIVE_DRIVER_HISTORY_MISSING',scope,{actionId:action.id});}
    const runFields=Object.keys(signatures.task_runs).filter(key=>key!=='worker_started_at');
    for(const run of kanban?.runs||[]){if(matchedRuns.has(run.id))continue;
      const claims=relevant.filter(action=>{const op=action.payload.nativeOperation,r=resultOf(action)?.nativeOperation,task=r?.data?.task;return op?.resource==='kanban'&&op.operation==='claim'&&op.input?.taskId===run.task_id&&sameAction(action)&&action.status==='succeeded'&&terminal(action)&&r.operation==='claim'&&r.employeeId===scope.employeeId&&r.revision===action.payload.hermesBot.revision&&r.data.run===true&&task?.id===run.task_id&&task.current_run_id===run.id&&task.tenant===scope.employeeId&&task.created_by===scope.employeeId&&task.claim_lock===scope.employeeId;});
      const finishes=relevant.filter(action=>{const op=action.payload.nativeOperation,r=resultOf(action)?.nativeOperation,task=r?.data?.task,record=r?.data?.runs?.find(row=>row.id===run.id);return op?.resource==='kanban'&&['complete','block'].includes(op.operation)&&op.input?.taskId===run.task_id&&op.input.runId===run.id&&sameAction(action)&&action.status==='succeeded'&&terminal(action)&&r.operation===op.operation&&r.employeeId===scope.employeeId&&r.revision===action.payload.hermesBot.revision&&task?.id===run.task_id&&task.status===run.status&&task.current_run_id===null&&!task.claim_lock&&task.claim_expires===null&&!task.worker_pid&&record&&runFields.every(key=>record[key]===run[key])&&run.ended_at&&run.claim_lock===scope.employeeId&&run.claim_expires===null&&!run.worker_pid&&(op.operation==='complete'?run.status==='done'&&run.outcome==='completed':run.status==='blocked'&&run.outcome==='blocked');});
      if(claims.length===1&&finishes.length===1){matchedRuns.add(run.id);proof('kanban-direct',finishes[0],{resource:'kanban',taskId:run.task_id,runId:run.id,claimActionId:claims[0].id,claimActionDigest:nativeActionDigest(claims[0]),nativeRowDigest:digest(run)});}
    }
    for(const action of relevant){const op=action.payload.nativeOperation,r=resultOf(action)?.nativeOperation;if(op?.resource==='kanban'&&op.operation==='claim'&&action.status==='succeeded'&&!matchedRuns.has(r?.data?.task?.current_run_id))issue('NATIVE_KANBAN_CLAIM_HISTORY_MISSING',scope,{actionId:action.id});}
    for(const task of kanban?.tasks||[])if(task.tenant!==scope.employeeId||task.created_by!==scope.employeeId||!['triage','todo','scheduled','ready','running','blocked','review','done','archived'].includes(task.status)||task.status==='running'||task.current_run_id!==null||task.claim_lock||task.claim_expires!==null||task.worker_pid)issue('NATIVE_KANBAN_CLAIM_ACTIVE',scope,{taskId:task.id});
    for(const run of kanban?.runs||[])if(!matchedRuns.has(run.id))issue('NATIVE_KANBAN_RUN_UNKNOWN',scope,{taskId:run.task_id,runId:run.id});
    const inboxes=gatewayInbox.filter(row=>row.employee_id===scope.employeeId&&(!scope.workspaceId||row.workspace_id===scope.workspaceId));
    for(const row of state?.inbound||[]){
      if(row.value_type!=='object'||row.contentType!=='text'||typeof row.contentDigest!=='string'||!['delivered','delivery_failed'].includes(row.state)||!row.sourceActionId||!row.platform||typeof row.chatId!=='string'||typeof row.messageId!=='string'||row.revisionType!=='integer'||row.epochType!=='integer'||!Number.isInteger(row.revision)||row.revision<1||!Number.isInteger(row.controlEpoch)||row.controlEpoch<1||row.key!==nativeInboundKey(row)){issue('NATIVE_GATEWAY_INBOUND_UNSETTLED',scope,{key:row.key,state:row.state});continue;}
      const matches=inboxes.filter(inbox=>inbox.platform===row.platform&&inbox.chat_id===row.chatId&&inbox.message_id===row.messageId&&inbox.source_action_id===row.sourceActionId&&inbox.revision===row.revision&&inbox.control_epoch===row.controlEpoch),inbox=matches.length===1?matches[0]:null,connect=originals.find(action=>action.id===row.sourceActionId),reply=originals.find(action=>action.id===inbox?.action_id),op=connect?.payload.nativeOperation,route=reply?.payload.gateway,connectContext=connect?.payload.hermesBot;
      const connectProof=connect&&['succeeded','failed'].includes(connect.status)&&connect.acked_at&&!uncertain(connect.result)&&connect.type==='hermes.bot.native'&&op?.resource==='gateway'&&op.operation==='connect'&&op.input?.platform===row.platform&&sameAction(connect)&&connectContext.revision===row.revision&&connectContext.controlEpoch===row.controlEpoch;
      const exits=gatewayExits.filter(proof=>proof.home===scope.home&&proof.ownershipId===scope.ownershipId&&proof.workspaceId===scope.workspaceId&&proof.deviceId===scope.deviceId&&proof.sourceActionId===row.sourceActionId&&proof.connectActionDigest===nativeActionDigest(connect||{})&&proof.platform===row.platform&&proof.employeeId===scope.employeeId&&proof.workspace===scope.workspace&&proof.revision===row.revision&&proof.controlEpoch===row.controlEpoch&&proof.processAlive===false&&proof.connectedPid===resultOf(connect)?.nativeOperation?.data?.pid&&proof.connectedPid===proof.processExit?.rootPid&&exitedTree(proof.processExit)&&typeof proof.lifecycleDigest==='string');
      // Gateway's original worker exit is independently checked by the lifecycle collector.
      const output=reply?.result?.output||reply?.result?.result?.output||reply?.result?.text;
      if(!inbox||typeof inbox.content!=='string'||hash(inbox.content)!==row.contentDigest||typeof reply?.payload.prompt!=='string'||hash(reply.payload.prompt)!==row.contentDigest||reply.status!=='succeeded'||typeof output!=='string'||!output||!['dispatched','completed','failed','cancelled'].includes(inbox.status)||!connectProof||exits.length!==1||!terminal(reply)||!sameAction(reply)||reply.type!=='conversation.execute'||route?.connectionActionId!==connect.id||route.platform!==row.platform||route.chatId!==row.chatId||route.messageId!==row.messageId){issue('NATIVE_GATEWAY_INBOUND_IDENTITY_UNKNOWN',scope,{key:row.key,inboxId:inbox?.id});continue;}
      const value=proof('gateway',reply,{resource:'gateway',nativeKey:row.key,nativeState:row.state,nativeRowDigest:digest(row),nativeContentDigest:row.contentDigest,connectTreeDigest:digest(exits[0])});gatewayInboxProofs.push({...value,nativeProofDigest:digest(value),connectExitProof:exits[0],inboxId:inbox.id,inboxRowDigest:digest(inbox),connectActionId:connect.id,replyActionId:reply.id,connectActionDigest:digest(connect),replyActionDigest:digest(reply),platform:row.platform,chatId:row.chatId,messageId:row.messageId,revision:row.revision,controlEpoch:row.controlEpoch});
    }
    for(const inbox of inboxes)if(!gatewayInboxProofs.some(proof=>proof.inboxId===inbox.id))issue('NATIVE_GATEWAY_INBOX_UNPROVEN',scope,{inboxId:inbox.id});
    readDb('hosted_rooms.db',db=>scanRooms(db,{scope,relevant,originals,terminal,sameAction,proof,issue}));
    if(!nativeDatabases.some(row=>row.path===path.join(scope.home,'hosted_rooms.db')&&row.exists)&&relevant.some(action=>resultOf(action)?.nativeGroup||(action.payload.nativeOperation?.resource==='groups'&&action.payload.nativeOperation.operation!=='list'||action.payload.nativeOperation?.resource==='collaboration'&&action.payload.nativeOperation.operation==='publish')&&action.status==='succeeded'))issue('NATIVE_GROUP_DATABASE_REQUIRED',scope);
  }
  return{safe:issues.length===0,issues,files,directories,nativeDatabases,nativeStateProofs,gatewayInboxProofs};
}

function scanRooms(db,{scope,issue}) {
  const schema=[table(db,'hosted_rooms',['room_id','members_json','authority_gateway_id','authority_epoch','next_seq','revision']),table(db,'hosted_room_events',['room_id','seq','event_id','kind','actor_json','authority_epoch','payload_json'])];
  const rooms=db.prepare('SELECT room_id,authority_gateway_id,authority_epoch,next_seq,revision,json_valid(members_json) validMembers FROM hosted_rooms ORDER BY room_id').all();
  const events=db.prepare('SELECT room_id,seq,event_id,kind,authority_epoch,json_valid(actor_json) validActor,json_valid(payload_json) validPayload FROM hosted_room_events ORDER BY room_id,seq').all();
  const extra=[];
  for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('hosted_rooms','hosted_room_events','sqlite_sequence')").all()){
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw Error('NATIVE_DATABASE_SCHEMA_UNKNOWN');
    extra.push({table:name,count:db.prepare('SELECT COUNT(*) n FROM '+name).get().n});
  }
  // Core release does not support replaying arbitrary Group Discussion policy.
  // Any nonempty state is explicitly unknown; absence of a driver table is not zero.
  if(rooms.length||events.length||extra.some(row=>row.count))issue('NATIVE_GROUP_STATE_UNSUPPORTED',scope);
  return{schema,rows:[...rooms,...events,...extra]};
}
