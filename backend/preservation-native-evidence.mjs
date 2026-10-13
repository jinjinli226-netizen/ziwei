import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {inspectClientMaintenance,inspectNativeClientProcess,inspectNativeHealthListener} from '../scripts/client-lifecycle.mjs';
import {digest,uncertain,exitedTree,executionExit,gatewayResultMatches} from './version-preservation.mjs';
import {scanOwnedNativeDatabases,nativeActionDigest,attestNativeVersion} from './preservation-native-databases.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=value=>{try{return JSON.parse(value);}catch{return null;}};
const equal=(a,b)=>digest(a)===digest(b);
const deliveryBinding=(action,identity)=>{const p=action.payload||{};return hash(JSON.stringify({id:action.id,type:action.type,agent:action.agent_id||action.agentId||'ziwei_user',workspace:action.workspace_id||identity.workspace,device:identity.deviceId,employee:p.employeeId||p.employee_id||p.assignee||null,conversation:p.conversationId||p.conversation_id||null,message:p.messageId||p.message_id||null,dedupe:action.dedupe_key||action.dedupeKey||null}));};
function normalizedAction(row){return {...row,payload:row.payload||json(row.payload_json)||{},result:row.result||json(row.result_json)};}
function legacyHistoryUncertain(value,checkTree=true){
  if(!value||typeof value!=='object')return false;
  if(['executionState','execution_state'].some(key=>['unknown','uncertain','unconfirmed','blocked',...(checkTree?['pending','running','started']:[])].includes(value[key])))return true;
  if(uncertain(value)||['executionUncertain','execution_uncertain','outcome_uncertain','retainEvidence'].some(key=>value[key]===true)||checkTree&&(value.treeConfirmed===false||Number(value.activeProcesses)>0))return true;
  return Object.values(value).some(item=>Array.isArray(item)?item.some(child=>legacyHistoryUncertain(child,checkTree)):legacyHistoryUncertain(item,checkTree));
}
function actionDevice(action,request){
  const payload=action?.payload||{},devices=['deviceId','device_id','targetDeviceId','target_device_id'].map(key=>payload[key]).filter(value=>value!==undefined&&value!==null&&value!=='');
  if(devices.some(value=>typeof value!=='string')||new Set(devices).size>1)return null;
  if(devices.length)return devices[0];
  const employeeId=payload.employeeId||payload.employee_id||payload.assignee,employee=request?.actionProjection?.tables?.employees?.rows?.find(row=>row.id===employeeId&&row.workspace_id===action?.workspace_id);
  return typeof employee?.target_device_id==='string'?employee.target_device_id:null;
}
// Exact reviewed V1 protocol bytes, normalized only for Windows CRLF. This
// identifies history format and result binding, not worker/tree completion.
const legacyProtocolFiles={
  'src/management-bootstrap.mjs':'bddce314efe7bc836d6b67f19d64aa98b8801527f2a64a173eac9982e086fb74',
  'daemon/ziwei_user.mjs':'7225a515885af09317d2f23976bb74f562ac3d6579eec1bd88ae0855cce35a2f',
  'src/daemon.mjs':'1e5ab24e166466e5036d74b4a46b44485f61e9c8fcecc6ce69f125f8a6a3ff41',
  'src/daemon-action-scheduler.mjs':'a2e2181e029d7e09b1b4ed82b26115013c792aaa1dfc1f19610e135e24c70a6e',
  'src/local-action.mjs':'88cf1bd4b32411c47eb6e277209ff453f858948ae24fc75611db2c599104fa3c',
  'src/runtime-adapters.mjs':'3295b1eabf47c58d47e7e3d80148909f1bf854d1f7043d68b0b4866b43c14b39'
};
function legacyConnectionProof(connection,request,read,directoryProof){
  if(request?.schemaVersion!==1||request.domain!=='ziwei-production-request-v1'||!['collect','recheck'].includes(request.kind)||!request.operationId||!request.challenge||! /^[a-f0-9]{64}$/.test(request.specHash||''))throw Error('request');
  const workspace=request.actionProjection?.tables?.workspaces?.rows?.find(row=>row.slug===connection.workspace);
  if(!workspace||!request.binding?.workspaceIds?.includes(workspace.id)||!request.binding?.deviceIds?.includes(connection.deviceId)||!request.targetOrigins?.includes(new URL(connection.apiBase).origin))throw Error('scope');
  const clients=(request.binding.clients||[]).filter(client=>client.installedRole==='v1'&&(client.runtimeDir===connection.runtimeDir||path.join(client.runtimeDir,'shared-workspaces',connection.workspace,connection.deviceId)===connection.runtimeDir));
  if(clients.length!==1)throw Error('client');const client=clients[0],configuration=read(client.configPath);
  if(hash(configuration)!==client.configSha256)throw Error('config');const config=json(configuration);
  const entries=[config,...(config?.sharedWorkspaces||[]).filter(row=>row.enabled!==false)];
  if(entries.filter(entry=>entry?.workspace===connection.workspace&&entry.deviceId===connection.deviceId&&new URL(entry.apiBase||config.apiBase).origin===new URL(connection.apiBase).origin).length!==1)throw Error('connection');
  const sources=[];directoryProof(client.root);directoryProof(path.join(client.root,'src'));directoryProof(path.join(client.root,'daemon'));
  for(const [relative,expected] of Object.entries(legacyProtocolFiles)){
    const file=path.join(client.root,relative);if(fs.realpathSync.native(file)!==path.resolve(file))throw Error('source');
    const text=read(file);if(hash(text.replace(/\r\n/g,'\n'))!==expected)throw Error('protocol');sources.push({path:path.resolve(file),sha256:hash(text)});
  }
  return {client,workspaceId:workspace.id,policyDigest:digest(legacyProtocolFiles),sourceDigest:digest(sources)};
}

/** Formal source evidence always requires original history/protocol binding. */
export function scanNativeFiles(options={}) {return scanFileEvidence(options,false);}

/** Current daemon admission only; this cannot attest a production namespace. */
export function inspectLocalDaemonMaintenanceFiles({connections=[]}={}) {
  const {safe,issues,files,directories}=scanFileEvidence({connections},true);
  return {safe,issues,files,directories};
}

function explicitExitUnknown(value){
  if(!value||typeof value!=='object')return false;
  if(Object.hasOwn(value,'processExit')&&!exitedTree(value.processExit))return true;
  return Object.values(value).some(item=>Array.isArray(item)?item.some(explicitExitUnknown):explicitExitUnknown(item));
}

/** Read-only evidence. Zero in-memory counters cannot replace these files.
 * localMaintenance is lexical code state, never selected by input JSON. */
function scanFileEvidence({connections=[],actions=[],homes=[],productionRequest}={},localMaintenance) {
  const issues=[],files=[],directories=[],gatewayExits=[],legacyHistoryProofs=[],originals=new Map(actions.map(row=>[row.id,normalizedAction(row)]));
  const issue=(code,detail={})=>issues.push({code,...detail});
  const read=file=>{try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('not regular file');const bytes=fs.readFileSync(file);files.push({path:path.resolve(file),exists:true,sha256:hash(bytes),bytes:bytes.length,identity:{dev:String(stat.dev),ino:String(stat.ino)}});return bytes.toString('utf8');}catch(error){if(error.code==='ENOENT')files.push({path:path.resolve(file),exists:false});throw error;}};
  const directoryProof=directory=>{try{const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('identity');const names=fs.readdirSync(directory).sort();directories.push({path:path.resolve(directory),exists:true,names,identity:{dev:String(stat.dev),ino:String(stat.ino)}});}catch(error){if(error.code==='ENOENT')directories.push({path:path.resolve(directory),exists:false,names:[]});else issue('DIRECTORY_UNREADABLE',{path:directory});}};
  for(const connection of connections){
    const {runtimeDir,workspace,deviceId}=connection,scope={workspace,deviceId};
    directoryProof(runtimeDir);directoryProof(path.join(runtimeDir,'action-delivery'));directoryProof(path.join(runtimeDir,'shared-workspaces'));
    const relevant=[...originals.values()].filter(action=>!action.payload.deviceId||action.payload.deviceId===deviceId);
    const stateFile=path.join(runtimeDir,'action-state.json');let state;
    try{
      state=json(read(stateFile));
      const legacyShape=state?.version===1&&Array.isArray(state.completed)&&(localMaintenance&&state.updatedAt===undefined||Number.isFinite(Date.parse(state.updatedAt||'')))&&Object.keys(state).every(key=>['version','updatedAt','completed'].includes(key));
      const modernShape=state?.version===2&&Array.isArray(state.completed)&&Array.isArray(state.started);
      if(!modernShape&&!(legacyShape&&(localMaintenance||productionRequest)))throw Error('invalid version/shape');
      const validIdentity=value=>value===undefined||(value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(item=>typeof item==='string'));
      const startedKeys=new Set();
      for(const started of state.started||[]){
        if(!started||typeof started.key!=='string'||!started.key||startedKeys.has(started.key)||!['string','number'].includes(typeof started.actionId)&&started.actionId!==null||!started.identity||!validIdentity(started.identity)||!Number.isFinite(started.startedAt)||started.nativeRuntime!==undefined&&typeof started.nativeRuntime!=='boolean'||started.quarantine!==undefined&&(!started.quarantine||typeof started.quarantine.stopConfirmed!=='boolean'))throw Error('invalid started record');
        startedKeys.add(started.key);
      }
      const completedKeys=new Set();
      for(const completed of state.completed){
        if(!completed||typeof completed.key!=='string'||!completed.key||completedKeys.has(completed.key)||!completed.result||!['succeeded','failed'].includes(completed.result.status)||typeof completed.result.actionId!=='string'||!completed.result.actionId||!validIdentity(completed.identity)||legacyHistoryUncertain(completed,localMaintenance||state.version===1||completed.legacy===true)||localMaintenance&&explicitExitUnknown(completed))throw Error('invalid completed record');
        if((state.version===1||completed.legacy===true)&&Object.keys(completed).some(key=>!(state.version===1?['key','result']:['key','result','legacy']).includes(key)))throw Error('unknown legacy wrapper');
        completedKeys.add(completed.key);
        if(state.version===2&&completed.legacy!==true&&(!completed.identity||!(state.started||[]).some(started=>started?.key===completed.key&&started.actionId===completed.result.actionId)))throw Error('unpaired completed record');
      }
    }
    catch(error){state=null;if(error.code!=='ENOENT')issue('ACTION_STATE_CORRUPT',{path:stateFile});else if(relevant.some(action=>action.acked_at))issue('ACTION_STATE_MISSING',{path:stateFile});}
    if(state){
      const legacyActions=new Set(),legacyKeys=new Set();let legacySource;
      const legacy=state.completed.filter(row=>state.version===1||row?.legacy===true);
      if(legacy.length&&!localMaintenance)try{legacySource=legacyConnectionProof(connection,productionRequest,read,directoryProof);}catch{issue('LEGACY_PROTOCOL_UNPROVEN',{path:stateFile});}
      for(const completed of legacy){
        const original=originals.get(completed?.result?.actionId),result=completed?.result,exit=executionExit(result);
        const expectedKey=String(original?.dedupe_key??original?.dedupeKey??original?.id??''),device=actionDevice(original,productionRequest);
        if(localMaintenance){
          const worker=result?.result?.nativeOperation?.data?.residentWorker;
          if(!Number.isFinite(result?.completedAt)||legacyKeys.has(completed.key)||legacyActions.has(result.actionId)||completed.identity||legacyHistoryUncertain(result)||explicitExitUnknown(result)||(exit||worker)&&!exitedTree(exit))issue('LEGACY_HISTORY_UNPROVEN',{path:stateFile,actionId:result?.actionId||null});
          legacyKeys.add(completed.key);legacyActions.add(result.actionId);continue;
        }
        // A legacy completion is immutable terminal history. Missing fields
        // that did not exist in V1 are never fabricated as process evidence.
        if(!legacySource||!original||!result||typeof completed.key!=='string'||!completed.key||legacyKeys.has(completed.key)||legacyActions.has(original.id)||completed.identity||completed.key!==expectedKey||!['succeeded','failed'].includes(original.status)||original.status!==result.status||legacyHistoryUncertain(result)||!Number.isFinite(result.completedAt)||exit&&!exitedTree(exit)||original.workspace_id!==legacySource.workspaceId||device!==deviceId||!equal(original.result,result.result??result)||original.error&&original.error!==result.error){issue('LEGACY_HISTORY_UNPROVEN',{path:stateFile,actionId:result?.actionId||null});continue;}
        legacyKeys.add(completed.key);legacyActions.add(original.id);
        legacyHistoryProofs.push({schemaVersion:1,kind:'legacy-terminal-history-v1',actionId:original.id,actionDigest:nativeActionDigest(original),operationId:productionRequest.operationId,specHash:productionRequest.specHash,challenge:productionRequest.challenge,hostId:productionRequest.binding.hostId,workspaceId:legacySource.workspaceId,deviceId,origin:connection.apiBase.replace(/\/$/,''),originalInstanceDigest:digest(legacySource.client.originalInstance),policyDigest:legacySource.policyDigest,sourceDigest:legacySource.sourceDigest,cacheRecordDigest:digest(completed),conclusion:'terminal-history-retained'});
      }
      const keys=new Set();
      for(const started of state.started||[]){
        if(!started?.key||keys.has(started.key)||!started.identity||!Number.isFinite(started.startedAt)){issue('ACTION_STATE_CORRUPT',{path:stateFile});continue;}keys.add(started.key);
        const completed=state.completed.find(row=>row.key===started.key);
        if(!completed){issue('STARTED_WITHOUT_RESULT',{actionId:started.actionId,path:stateFile});continue;}
        if(!equal(started.identity,completed.identity)||completed.result?.actionId!==started.actionId||!['succeeded','failed'].includes(completed.result?.status)||uncertain(completed.result))issue('ACTION_RESULT_UNCERTAIN',{actionId:started.actionId,path:stateFile});
        if(started.identity.workspace!==workspace||started.identity.deviceId!==deviceId)issue('ACTION_IDENTITY_MISMATCH',{actionId:started.actionId,path:stateFile});
        const gateway=completed.result?.result?.nativeOperation,worker=gateway?.data?.residentWorker;
        if(localMaintenance&&worker&&!exitedTree(executionExit(completed.result)))issue('GATEWAY_TREE_UNKNOWN',{actionId:started.actionId,path:stateFile});
        if(gateway?.resource==='gateway'){const binding=started.resourceBinding;if(!binding||binding.type!=='hermes.bot.native'||binding.resource!=='gateway'||binding.operation!==gateway.operation||binding.employeeId!==gateway.employeeId||binding.revision!==gateway.revision||worker&&(binding.platform!==worker.platform||binding.controlEpoch!==worker.controlEpoch)||originals.has(started.actionId)&&!gatewayResultMatches(originals.get(started.actionId),completed.result.result))issue('GATEWAY_CACHE_IDENTITY_MISMATCH',{actionId:started.actionId,path:stateFile});}
        if(gateway?.resource==='gateway'&&worker){const originalConnection=state.completed.find(row=>row.result?.actionId===worker.sourceActionId),originalWorker=originalConnection?.result?.result?.nativeOperation?.data?.residentWorker;
          if(worker.workspace!==workspace||!worker.workerNonce||!Number.isInteger(worker.rootPid)||gateway.operation==='connect'&&worker.sourceActionId!==started.actionId||gateway.operation!=='connect'&&!equal(worker,originalWorker))issue('GATEWAY_CACHE_IDENTITY_MISMATCH',{actionId:started.actionId,path:stateFile});
        }
        if(!originals.has(started.actionId)){const exit=executionExit(completed.result);if((started.nativeRuntime||exit)&&!exitedTree(exit))issue('UNMAPPED_NATIVE_EXECUTION',{actionId:started.actionId,path:stateFile});continue;}
        const persisted=originals.get(started.actionId),expected=Object.fromEntries(Object.entries({...scope,workspaceId:persisted.workspace_id||persisted.workspaceId,actionWorkspace:persisted.workspace||persisted.workspace_slug,targetDeviceId:persisted.payload.deviceId||persisted.payload.device_id||persisted.payload.targetDeviceId||persisted.payload.target_device_id}).filter(([,value])=>value!==undefined&&value!==null&&String(value)!=='').map(([key,value])=>[key,String(value)]));
        if(!equal(started.identity,completed.identity)||!equal(started.identity,expected)||completed.result?.actionId!==started.actionId)issue('ACTION_IDENTITY_MISMATCH',{actionId:started.actionId,path:stateFile});
        if(!['succeeded','failed'].includes(completed.result?.status)||uncertain(completed.result))issue('ACTION_RESULT_UNCERTAIN',{actionId:started.actionId,path:stateFile});
        const result=completed.result?.result||completed.result;
        const original=originals.get(started.actionId),resident=original?.type==='hermes.bot.native'&&original.payload.nativeOperation?.resource==='gateway'&&original.payload.nativeOperation.operation==='connect';
        if(!resident&&!exitedTree(executionExit(result)))issue('ACTION_TREE_UNKNOWN',{actionId:started.actionId,path:stateFile});
      }
      for(const action of relevant.filter(row=>row.acked_at))if(!(state.started||[]).some(row=>row.actionId===action.id)&&!legacyActions.has(action.id))issue('ACTION_STATE_BINDING_MISSING',{actionId:action.id,path:stateFile});
    }
    const directory=path.join(runtimeDir,'action-delivery');let names=[];
    try{names=fs.readdirSync(directory);}catch(error){if(error.code!=='ENOENT')issue('DELIVERY_DIRECTORY_UNREADABLE',{path:directory});}
    const consumed=new Set();
    for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){
      const file=path.join(directory,name);let record;
      try{record=json(read(file));if(record?.version!==2||!record.action?.id||!Array.isArray(record.events)||!['awaiting_ack','acked','result_pending','confirmed','blocked'].includes(record.state)||name!==`${hash(JSON.stringify(String(record.action.id)))}.json`)throw new Error('invalid record');consumed.add(name);
        const identity={apiBase:connection.apiBase.replace(/\/$/,''),workspace,deviceId};
        if(!equal(record.identity,identity)||record.binding!==deliveryBinding(record.action,identity))throw new Error('identity mismatch');
        if(record.state!=='confirmed'||record.retainEvidence){
          for(const kind of ['action','result']){if(kind==='result'&&!record.resultDigest&&record.state!=='result_pending')continue;const blobName=name.replace(/\.json$/,`.${kind}.json`),blobFile=path.join(directory,blobName),bytes=read(blobFile),blob=json(bytes);consumed.add(blobName);if(hash(bytes)!==record[`${kind}Digest`])throw new Error('blob digest mismatch');
            if(kind==='action'&&(!equal(blob?.identity,identity)||blob?.binding!==record.binding||deliveryBinding(blob?.action||{},identity)!==record.binding))throw new Error('original identity mismatch');
            if(kind==='result'&&(!['succeeded','failed'].includes(blob?.status)||!Object.hasOwn(blob,'result')||blob.receiptOnly!==true))throw new Error('result shape mismatch');
          }
        }
        // Unmapped/removed connections and queues are not guessed to be legacy.
        if(record.state!=='confirmed'||record.retainEvidence||record.events.length)issue('DELIVERY_NOT_DRAINED',{actionId:record.action.id,state:record.state,path:file});
        else if(!['succeeded','failed','expired'].includes(record.serverStatus)||!Number.isFinite(Date.parse(record.confirmedAt)))throw new Error('invalid terminal receipt');
        const original=originals.get(record.action.id);if(original&&original.status!==record.serverStatus)issue('DELIVERY_SERVER_MISMATCH',{actionId:record.action.id,path:file});
      }catch{issue('DELIVERY_CORRUPT',{path:file,actionId:record?.action?.id||null});}
    }
    for(const name of names)if(!consumed.has(name))issue('DELIVERY_ORPHAN_OR_TEMP',{path:path.join(directory,name)});
    const shared=path.join(runtimeDir,'shared-workspaces');if(fs.existsSync(shared))for(const workspaceName of fs.readdirSync(shared))for(const deviceName of fs.readdirSync(path.join(shared,workspaceName)))if(!connections.some(row=>row.runtimeDir===path.join(shared,workspaceName,deviceName)))issue('UNMAPPED_CONNECTION_JOURNAL',{path:path.join(shared,workspaceName,deviceName)});
  }
  for(const item of homes){
    directoryProof(path.join(item.home,'logs'));
    const file=path.join(item.home,'logs','ziwei-native-lifecycle.jsonl'),entries=[];
    for(const suffix of ['.5','.4','.3','.2','.1',''])try{for(const line of read(file+suffix).split(/\r?\n/).filter(Boolean)){const entry=json(line);if(!entry)throw new Error('bad line');entries.push(entry);}}catch(error){if(error.code!=='ENOENT')issue('GATEWAY_LIFECYCLE_CORRUPT',{path:file+suffix});}
    const starts=entries.filter(entry=>entry.event==='gateway.starting');
    for(const start of starts){
      if(!start.sourceActionId||!start.platform||!start.workerNonce||start.employeeId!==item.employeeId||start.workspace!==item.workspace){issue('GATEWAY_IDENTITY_UNKNOWN',{path:file,sourceActionId:start.sourceActionId||null});continue;}
      const original=originals.get(start.sourceActionId),operation=original?.payload.nativeOperation,context=original?.payload.hermesBot;
      if(!original||original.type!=='hermes.bot.native'||operation?.resource!=='gateway'||operation.operation!=='connect'||operation.input?.platform!==start.platform||context?.revision!==start.revision||context?.controlEpoch!==start.controlEpoch){issue('GATEWAY_ORIGINAL_MISMATCH',{path:file,sourceActionId:start.sourceActionId});continue;}
      const matches=entry=>entry.workerNonce===start.workerNonce&&entry.platform===start.platform&&entry.sourceActionId===start.sourceActionId&&entry.employeeId===start.employeeId&&entry.workspace===start.workspace&&entry.revision===start.revision&&entry.controlEpoch===start.controlEpoch;
      const startIndex=entries.indexOf(start),exitIndex=entries.findIndex((entry,index)=>index>startIndex&&entry.event==='gateway.exit'&&matches(entry)),exit=entries[exitIndex];
      const receipt=original.result?.nativeOperation?.data||original.result?.result?.nativeOperation?.data,connectedIndex=entries.findIndex((entry,index)=>index>startIndex&&index<exitIndex&&entry.event==='gateway.connected'&&matches(entry));
      if(starts.filter(entry=>entry.workerNonce===start.workerNonce).length!==1||!exit||exit.processAlive!==false||!exitedTree(exit.processExit)||receipt?.connected===true&&(connectedIndex<0||entries[connectedIndex].pid!==receipt.pid||exit.processExit.rootPid!==receipt.pid))issue('GATEWAY_TREE_UNKNOWN',{path:file,sourceActionId:start.sourceActionId,platform:start.platform});
      else if(receipt?.connected===true)gatewayExits.push({home:item.home,ownershipId:item.ownershipId,workspaceId:item.workspaceId,deviceId:item.deviceId,sourceActionId:start.sourceActionId,connectActionDigest:nativeActionDigest(original),employeeId:start.employeeId,workspace:start.workspace,platform:start.platform,revision:start.revision,controlEpoch:start.controlEpoch,workerNonce:start.workerNonce,connectedPid:receipt.pid,processAlive:false,processExit:exit.processExit,lifecycleDigest:digest([start,entries[connectedIndex],exit])});
    }
    for(const action of [...originals.values()].filter(row=>row.type==='hermes.bot.native'&&row.payload.employeeId===item.employeeId&&row.payload.nativeOperation?.resource==='gateway'&&row.payload.nativeOperation.operation==='connect'&&row.acked_at))if(!starts.some(entry=>entry.sourceActionId===action.id))issue('GATEWAY_LIFECYCLE_MISSING',{actionId:action.id,path:file});
  }
  return {safe:issues.length===0,issues,files,directories,gatewayExits,legacyHistoryProofs,originalActionProofs:legacyHistoryProofs};
}

/** Only actual native maintenance inspection + loopback health is accepted. */
export async function collectNativeEvidence(db,{clients=[],operationId}={}) {
  const issues=[],connections=[],clientProofs=[],homes=[],files=[];
  const freeze=()=>db.prepare('SELECT operation_id,state,versions_json,intent_json FROM version_preservation WHERE singleton=1').get();
  const initial=freeze();if(!operationId||initial?.operation_id!==operationId||initial.state!=='preparing')return{safe:false,issues:[{code:'NATIVE_FREEZE_IDENTITY_INVALID'}],files:[]};
  const bots=db.prepare('SELECT b.*,e.target_device_id,e.runtime_profile FROM hermes_bots b JOIN employees e ON e.id=b.employee_id').all();
  const actions=db.prepare('SELECT * FROM a2a_actions').all().filter(row=>db.prepare('SELECT ziwei_v2_admitted(?) value').get(row.id).value===0);
  for(const specification of clients){
    try{
      const root=path.resolve(specification.root),configPath=path.resolve(specification.configPath),configBytes=fs.readFileSync(configPath),config=JSON.parse(configBytes);
      const env={...process.env,ZIWEI_CONFIG:configPath,...(specification.userHome?{ZIWEI_USER_HOME:path.resolve(specification.userHome)}:{})};
      const inspected=await inspectClientMaintenance({root,env,configPath});
      const url=new URL(`http://${config.healthHost||'127.0.0.1'}:${config.healthPort||20242}/healthz`);
      if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('HEALTH_NOT_LOOPBACK');
      if(!inspected.wasRunning)throw new Error('NATIVE_DRAIN_INSTANCE_REQUIRED');
      const response=await fetch(url,{signal:AbortSignal.timeout(3000),redirect:'error'}),body=await response.json();
      const runtime=specification.userHome?path.join(path.resolve(specification.userHome),'runtime'):path.join(root,'.local','runtime');
      if(!response.ok||body.pid!==inspected.pid||body.clientBuild!==clientBuildIdentity(root)||body.lifecycle?.configSha256!==hash(configBytes)||body.lifecycle?.runtimeDir!==runtime||body.connectionState!=='draining'||body.activeActionCount!==0||body.pollingCount!==0||body.quarantinedActionCount!==0||body.maintenance?.safe!==true)throw new Error('NATIVE_NOT_DRAINED');
      const listener=await inspectNativeHealthListener(url.origin,body.pid),processRecord=await inspectNativeClientProcess(body.pid,root);if(!processRecord)throw new Error('NATIVE_PROCESS_CHANGED');
      clientProofs.push({root,configPath,runtimeDir:runtime,pid:body.pid,clientBuild:body.clientBuild,lifecycle:body.lifecycle,processRecord,listener,health:body.maintenance});files.push({path:configPath,sha256:hash(configBytes),bytes:configBytes.length});
      if(body.connectionErrors?.length)throw new Error('CONNECTION_CONFIGURATION_INVALID');
      for(const entry of [config,...(config.sharedWorkspaces||[]).filter(row=>row.enabled!==false)]){if(!entry.workspace||!entry.deviceId||!body.connections?.some(row=>row.workspace===entry.workspace&&row.deviceId===entry.deviceId&&row.configured===true))throw new Error('CONNECTION_IDENTITY_UNKNOWN');connections.push({workspace:entry.workspace,deviceId:entry.deviceId,apiBase:String(entry.apiBase||config.apiBase).replace(/\/$/,''),hermesHome:entry.hermesHome||config.hermesHome,runtimeDir:entry===config?runtime:path.join(runtime,'shared-workspaces',entry.workspace,entry.deviceId)});}
    }catch(error){issues.push({code:'NATIVE_CLIENT_EVIDENCE_INVALID',root:specification.root,reason:String(error.code||error.message).slice(0,120)});}
  }
  for(const bot of bots){
    const ws=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(bot.workspace_id),connection=connections.find(row=>row.workspace===ws.slug&&row.deviceId===bot.target_device_id);
    if(!connection){issues.push({code:'BOT_DEVICE_EVIDENCE_MISSING',employeeId:bot.employee_id,deviceId:bot.target_device_id});continue;}
    const binding=json(bot.profile_binding_json);
    let home,nativeVersion,ownershipId=binding?.ownershipId;
    if(binding?.mode==='owned_profile'){
      const provision=db.prepare('SELECT status,result_json FROM a2a_actions WHERE id=?').get(bot.provision_action_id),result=json(provision?.result_json),receipt=result?.botProvision||result?.result?.botProvision;home=receipt?.home;nativeVersion=receipt?.nativeVersion;
      if(provision?.status!=='succeeded'||!home||receipt.ownershipId!==binding.ownershipId){issues.push({code:'BOT_HOME_UNKNOWN',employeeId:bot.employee_id});continue;}
      try{const markerFile=path.join(home,'ziwei-instance.json'),bytes=fs.readFileSync(markerFile),marker=JSON.parse(bytes),sourceRoot=path.dirname(path.dirname(home)),templateHome=binding.templateProfile==='default'?sourceRoot:path.join(sourceRoot,'profiles',binding.templateProfile);files.push({path:markerFile,sha256:hash(bytes),bytes:bytes.length});if(!path.isAbsolute(home)||path.basename(home)!==binding.profile||path.basename(path.dirname(home))!=='profiles'||[home,path.dirname(home),markerFile].some(file=>fs.lstatSync(file).isSymbolicLink())||marker.version!==1||marker.templateId!=='ziwei-hermes-bot'||marker.mode!=='owned_profile'||marker.sourceProfile!==binding.profile||marker.templateProfile!==binding.templateProfile||marker.sourceHome!==fs.realpathSync.native(templateHome)||receipt.profileHome!==home||marker.employeeId!==bot.employee_id||marker.workspace!==ws.slug||marker.deviceId!==bot.target_device_id||marker.profile!==binding.profile||marker.key!==binding.ownershipId||marker.provisionActionId!==binding.provisionActionId||marker.origin!==new URL(connection.apiBase).origin)throw new Error('identity');}catch{issues.push({code:'BOT_HOME_IDENTITY_INVALID',employeeId:bot.employee_id});continue;}
    }else {
      ownershipId=hash(JSON.stringify([new URL(connection.apiBase).origin,ws.slug,bot.employee_id]));home=path.join(connection.runtimeDir,'bot-instances',ownershipId);
      try{const sourceProfile=bot.runtime_profile||'default';if(!path.isAbsolute(connection.hermesHome||''))throw Error('source');const source=sourceProfile==='default'?connection.hermesHome:path.join(connection.hermesHome,'profiles',sourceProfile),markerFile=path.join(home,'ziwei-instance.json'),stat=fs.lstatSync(markerFile),bytes=fs.readFileSync(markerFile),marker=JSON.parse(bytes);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||[home,path.dirname(home),source,connection.hermesHome].some(file=>fs.lstatSync(file).isSymbolicLink())||fs.realpathSync.native(home)===fs.realpathSync.native(source)||marker.version!==1||marker.templateId!=='ziwei-hermes-bot'||marker.mode||marker.origin!==new URL(connection.apiBase).origin||marker.workspace!==ws.slug||marker.employeeId!==bot.employee_id||marker.key!==ownershipId||marker.sourceProfile!==sourceProfile||marker.sourceHome!==fs.realpathSync.native(source))throw Error('identity');files.push({path:markerFile,exists:true,sha256:hash(bytes),bytes:bytes.length,identity:{dev:String(stat.dev),ino:String(stat.ino)}});}
      catch{issues.push({code:'BOT_HOME_IDENTITY_INVALID',employeeId:bot.employee_id});continue;}
    }
    const scope={home,origin:new URL(connection.apiBase).origin,employeeId:bot.employee_id,workspace:ws.slug,workspaceId:bot.workspace_id,deviceId:bot.target_device_id,ownershipId,sourceProfile:bot.runtime_profile||'default',nativeVersion};
    const attestation=attestNativeVersion(scope,actions);homes.push({...scope,...attestation});
  }
  const scanned=scanNativeFiles({connections,actions,homes});issues.push(...scanned.issues);files.push(...scanned.files);
  const nativeState=scanOwnedNativeDatabases({homes,actions,gatewayInbox:db.prepare('SELECT * FROM bot_gateway_inbox').all(),gatewayExits:scanned.gatewayExits,operationId});issues.push(...nativeState.issues);files.push(...nativeState.files);scanned.directories.push(...nativeState.directories);
  for(const action of actions.filter(row=>row.acked_at)){const payload=json(action.payload_json)||{},workspace=db.prepare('SELECT slug FROM workspaces WHERE id=?').get(action.workspace_id)?.slug;if(!connections.some(row=>row.workspace===workspace&&row.deviceId===payload.deviceId))issues.push({code:'ACTION_DEVICE_EVIDENCE_MISSING',actionId:action.id});if(!bots.some(bot=>bot.employee_id===payload.employeeId)&&action.type==='hermes.bot.native')issues.push({code:'ACTION_BOT_EVIDENCE_MISSING',actionId:action.id});}
  // Recheck actual files and processes after scanning, before the DB seal.
  for(const file of files)try{if(file.exists===false?fs.existsSync(file.path):hash(fs.readFileSync(file.path))!==file.sha256)issues.push({code:'NATIVE_FILE_CHANGED',path:file.path});}catch{issues.push({code:'NATIVE_FILE_CHANGED',path:file.path});}
  for(const directory of scanned.directories)try{if(directory.exists? !equal(fs.readdirSync(directory.path).sort(),directory.names):fs.existsSync(directory.path))issues.push({code:'NATIVE_DIRECTORY_CHANGED',path:directory.path});}catch{issues.push({code:'NATIVE_DIRECTORY_CHANGED',path:directory.path});}
  for(const proof of clientProofs){const actual=await inspectNativeClientProcess(proof.pid,proof.root);if(!equal(actual,proof.processRecord))issues.push({code:'NATIVE_PROCESS_CHANGED',pid:proof.pid});try{const config=JSON.parse(fs.readFileSync(proof.configPath));await inspectNativeHealthListener(`http://${config.healthHost||'127.0.0.1'}:${config.healthPort}`,proof.pid);const body=await(await fetch(`http://${config.healthHost||'127.0.0.1'}:${config.healthPort}/healthz`,{signal:AbortSignal.timeout(3000),redirect:'error'})).json();if(body.pid!==proof.pid||!equal(body.lifecycle,proof.lifecycle)||body.clientBuild!==proof.clientBuild||body.connectionState!=='draining'||body.activeActionCount!==0||body.pollingCount!==0||body.maintenance?.safe!==true)throw new Error('changed');}catch{issues.push({code:'NATIVE_DRAIN_CHANGED',pid:proof.pid});}}
  if(!equal(freeze(),initial))issues.push({code:'NATIVE_FREEZE_IDENTITY_CHANGED'});
  return {safe:issues.length===0,issues,files,directories:scanned.directories,clients:clientProofs,operationId,intentDigest:digest(initial.intent_json),versionsDigest:digest(initial.versions_json),actionBindings:actions.map(action=>({id:action.id,digest:nativeActionDigest(action)})),nativeDatabases:nativeState.nativeDatabases,nativeStateProofs:nativeState.nativeStateProofs,gatewayInboxProofs:nativeState.gatewayInboxProofs,checkedAt:new Date().toISOString()};
}
