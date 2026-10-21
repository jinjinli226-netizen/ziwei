import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {finalizationDigest} from '../../src/bot-failure-finalization-contract.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function fixture(t){
 const runtimeDir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-finalization-test-')));t.after(()=>fs.rmSync(runtimeDir,{recursive:true,force:true}));
 const identity={apiBase:'https://test.example',workspace:'bigtron',deviceId:'device_one'},actionId='action_old',key='conversation:old:message';
 const nativeIdentity={workspace:'bigtron',workspaceId:'ws_one',deviceId:'device_one',targetDeviceId:'device_one'};
 const instance={ownershipId:'owned',profile:'bot-one',mode:'owned_profile'};
 const action={id:actionId,type:'conversation.execute',workspace_id:'ws_one',dedupe_key:key,payload:{deviceId:'device_one',employeeId:'employee_one',conversationId:'conv_one',messageId:'msg_one',runtime:'Hermes',profile:'bot-one',hermesBot:{revision:7,controlEpoch:25,instance,sourceProfile:'bot-one'}}};
 const base=hash(JSON.stringify(actionId)),deliveryDir=path.join(runtimeDir,'action-delivery');fs.mkdirSync(deliveryDir);
 const binding=hash(JSON.stringify({id:action.id,type:action.type,agent:'ziwei_user',workspace:action.workspace_id,device:identity.deviceId,employee:action.payload.employeeId,conversation:action.payload.conversationId,message:action.payload.messageId,dedupe:action.dedupe_key}));
 const actionBytes=Buffer.from(JSON.stringify({identity,binding,action}));
 const resultBytes=Buffer.from(JSON.stringify({status:'failed',receiptOnly:true,result:{processExit:null,partialEffectsPossible:true,code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE'},error:'missing exit evidence'}));
 const started={key,actionId,identity:nativeIdentity,startedAt:Date.now()-10000,nativeRuntime:true,resourceBinding:{type:'conversation.execute',employeeId:'employee_one',revision:7,controlEpoch:25,resource:null,operation:null,platform:null},quarantine:{reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE',recordedAt:Date.now()-5000,stopConfirmed:false}};
 const state={version:2,started:[started],completed:[]},stateBytes=Buffer.from(JSON.stringify(state));
 const journal={version:2,identity,binding,action:{...action,payload:{deviceId:'device_one',employeeId:'employee_one',conversationId:'conv_one',messageId:'msg_one'}},state:'confirmed',serverStatus:'failed',confirmedAt:new Date().toISOString(),events:[],retainEvidence:true,actionDigest:hash(actionBytes),resultDigest:hash(resultBytes)};
 const body={schemaVersion:1,kind:'bot.failed_execution_finalization',subject:{actionId,actionType:action.type,workspace:'bigtron',workspaceId:'ws_one',deviceId:'device_one',employeeId:'employee_one',profile:'bot-one',dedupeKey:key,originalRevision:7,originalControlEpoch:25,profileBindingDigest:finalizationDigest(instance),originalPayloadDigest:finalizationDigest(action.payload),originalResultDigest:finalizationDigest(JSON.parse(resultBytes).result),originalActionSha256:finalizationDigest(action),failedEvent:null},actorUserId:null,actorRole:'system',expectedRevision:7,expectedControlEpoch:25,resultingControlEpoch:26,disposition:'failed_automatically',status:'failed',executionState:'uncertain',executionConfirmedStopped:false,partialEffectsPossible:true,recordedAt:new Date().toISOString()};
 const receipt={...body,id:finalizationDigest(body)},receiptDigest=finalizationDigest(receipt);
 const write=(suffix,data)=>fs.writeFileSync(path.join(deliveryDir,base+suffix),data);
 fs.writeFileSync(path.join(runtimeDir,'action-state.json'),stateBytes);write('.json',JSON.stringify(journal));write('.action.json',actionBytes);write('.result.json',resultBytes);
 return {runtimeDir,identity,receipt,receiptDigest,state,started,base,stateBytes,actionBytes,resultBytes,journal,action,deliveryDir};
}
