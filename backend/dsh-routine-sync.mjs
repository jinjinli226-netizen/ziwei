import {createHash} from 'node:crypto';
import {dshRoutineResultKey} from './dsh-routine-results.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createDshRoutineSync(repo,{nativeService,now=Date.now,pollIntervalMs=30000}={}){
 const db=repo.db;
 const previous=(workspaceId,key)=>{const value=db.prepare("SELECT resource_id FROM management_requests WHERE workspace_id=? AND kind='dsh-routine-sync-v1' AND request_key=?").get(workspaceId,key);return value?repo.getA2AAction(value.resource_id):null;};
 function read(employee,state,context,resource,operation,input,key,prior){
  const value=nativeService.action(employee.slug,employee.id,{resource,operation,input,expectedSubjectHash:state.subjectHash,idempotencyKey:`routine-read:${digest([key,prior?.id||null])}`},context);
  if(value.action?.id)db.prepare(`INSERT INTO management_requests(workspace_id,kind,request_key,fingerprint,resource_id,created_at) VALUES(?,?,?,?,?,?)
   ON CONFLICT(workspace_id,kind,request_key) DO UPDATE SET resource_id=excluded.resource_id,created_at=excluded.created_at`).run(employee.workspace_id,'dsh-routine-sync-v1',key,state.subjectHash,value.action.id,new Date(now()).toISOString());
 }
 function collect(employee){
  const context={actorUserId:employee.owner_user_id,actorRole:employee.role};
  const capabilities=nativeService.capabilities(employee.slug,employee.id,context);
  if(capabilities.reasonCode||!capabilities.operations.some(item=>item.resource==='routines'&&item.operation==='list'&&item.supported)||!capabilities.operations.some(item=>item.resource==='sessions'&&item.operation==='history'&&item.supported))return;
  const state=nativeService.state(employee.slug,employee.id,{},context);
  if(state.pending.length)return;
  const listKey=`list:${digest([employee.id,state.subjectHash])}`,list=previous(employee.workspace_id,listKey);
  if(!list||list.status!=='succeeded'||now()-Date.parse(list.completed_at)>=pollIntervalMs){
   read(employee,state,context,'routines','list',{},listKey,list);return;
  }
  const receipt=list.result?.dshNative||list.result?.result?.dshNative;
  if(receipt?.status!=='observed'||!Array.isArray(receipt.data?.items))return;
  const candidates=routineAttempts(receipt.data.items).flatMap(input=>{
   const resultKey=dshRoutineResultKey({employeeId:employee.id,...input});
   if(db.prepare("SELECT 1 FROM management_requests WHERE workspace_id=? AND kind='dsh-routine-result-v1' AND request_key=?").get(employee.workspace_id,resultKey))return[];
   const key=`history:${digest([employee.id,state.subjectHash,resultKey])}`,prior=previous(employee.workspace_id,key);
   if(prior&&now()-Date.parse(prior.completed_at||prior.created_at)<pollIntervalMs)return[];
   return[{input,key,prior}];
  }).sort((a,b)=>Date.parse(a.prior?.created_at||'1970-01-01')-Date.parse(b.prior?.created_at||'1970-01-01'));
  const next=candidates[0];
  if(next)read(employee,state,context,'sessions','history',{...next.input,maxMessages:1000},next.key,next.prior);
 }
 return{tick(){
  const employees=db.prepare("SELECT e.id,e.workspace_id,e.owner_user_id,w.slug,m.role FROM employees e JOIN workspaces w ON w.id=e.workspace_id JOIN members m ON m.workspace_id=e.workspace_id AND m.user_id=e.owner_user_id WHERE e.runtime='DSH' AND e.status<>'deleted'").all();
  for(const employee of employees)try{collect(employee);}catch(error){
   if(![400,403,404,409].includes(error.status))throw error;
  }
 }};
}

function routineAttempts(items){
 const attempts=new Map();
 for(const item of items){
  const history=[...(item.history||[])];
  if(item.lastSessionId)history.push({sessionId:item.lastSessionId,attemptId:item.lastAttemptId,status:item.lastStatus});
  for(const attempt of history){
   if(!attempt.sessionId)continue;
   const input={routineId:item.id,sessionId:attempt.sessionId,attemptId:attempt.attemptId||attempt.sessionId};
   attempts.set(JSON.stringify(input),input);
  }
 }
 return[...attempts.values()];
}
