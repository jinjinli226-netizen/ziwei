import { randomUUID } from 'node:crypto';
import { employeeCapabilitySubject, assertEmployeeCapabilityAuthority } from './employee-capability-inventory.mjs';
import { DSH_PLUGIN_UI_RELAY_FEATURE } from '../src/dsh-native-contract.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const text=(value,max=240)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const nowIso=now=>new Date(now()).toISOString();
const exact=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const allowedHeaders=new Set(['accept','cache-control','content-type','last-event-id','x-requested-with']);

function normalizeView(row){
 return{schemaVersion:1,relayId:row.relayId,workspace:row.workspace,employeeId:row.employeeId,deviceId:row.deviceId,profile:row.profile,viewKey:row.viewKey,originPath:`/runtime/${encodeURIComponent(row.profile)}/ui/`,expiresAt:row.expiresAt,status:row.status,capability:DSH_PLUGIN_UI_RELAY_FEATURE};
}
function validateViewKey(value){if(!text(value,200)||!/^[A-Za-z0-9._:-]{16,200}$/.test(value))fail('DSH_PLUGIN_UI_VIEW_KEY_INVALID',400);return value;}
function validateInput(input){
 if(!exact(input,['prepareActionId','viewKey','idempotencyKey'])||!text(input.prepareActionId,200)||!text(input.idempotencyKey,200))fail('DSH_PLUGIN_UI_RELAY_INPUT_INVALID',400);
 validateViewKey(input.viewKey);return input;
}
function validatePath(profile,value){
 if(!text(value,2048)||value.includes('\\')||value.includes('#')||value.startsWith('http:')||value.startsWith('https:'))fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID',400);
 const [pathname,query='']=value.split('?',2);let decoded;try{decoded=decodeURIComponent(pathname);}catch{fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID',400);}if(decoded.includes('..')||query.length>1000||/[\u0000-\u001f\u007f]/.test(query))fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID',400);
 const base=`/runtime/${encodeURIComponent(profile)}/ui/`;
 if(!pathname.startsWith(base))fail('DSH_PLUGIN_UI_RELAY_PATH_INVALID',400);
 return value;
}
function validateHeaders(headers){
 if(headers===undefined)return{};
 if(!object(headers)||Object.keys(headers).length>16)fail('DSH_PLUGIN_UI_RELAY_HEADERS_INVALID',400);
 const result={};for(const [key,value] of Object.entries(headers)){const normalized=key.toLowerCase();if(!allowedHeaders.has(normalized)||!text(value,2000))fail('DSH_PLUGIN_UI_RELAY_HEADERS_INVALID',400);result[normalized]=value;}
 return result;
}

export function createDshPluginUiRelayService(repo,{management,nativeService,now=Date.now,ttlMs=120000,randomId=randomUUID}={}){
 const db=repo.db,sessions=new Map(),idempotency=new Map();
 function workspace(slug){const row=db.prepare('SELECT * FROM workspaces WHERE slug=?').get(slug);if(!row)fail('WORKSPACE_NOT_FOUND',404);return row;}
 function current(slug,employeeId,context){
  const ws=workspace(slug),subject=employeeCapabilitySubject(db,ws.id,employeeId);if(subject.runtime!=='DSH'||!subject.deviceId||!subject.profile)fail('DSH_PLUGIN_UI_RELAY_RUNTIME_UNSUPPORTED',400);
  assertEmployeeCapabilityAuthority(db,ws.id,subject,{userId:context?.actorUserId||null,role:context?.actorRole||'member',deviceScope:context?.deviceScope||null});
  const device=db.prepare('SELECT status,runtime_discovery_json FROM devices WHERE id=? AND workspace_id=?').get(subject.deviceId,ws.id),features=parse(device?.runtime_discovery_json)?.features;
  if(!device||device.status==='disabled')fail('DSH_PLUGIN_UI_RELAY_DEVICE_REVOKED',403);
  if(!Array.isArray(features)||!features.includes(DSH_PLUGIN_UI_RELAY_FEATURE))fail('DSH_PLUGIN_UI_RELAY_UNAVAILABLE',409);
  return{ws,subject,device};
 }
 function proof(slug,employeeId,prepareActionId,context,subject){
  const visible=management.action(slug,prepareActionId,context),raw=db.prepare('SELECT * FROM a2a_actions WHERE id=? AND workspace_id=?').get(prepareActionId,subject.workspaceId),payload=raw?parse(raw.payload_json):null,op=payload?.dshOperation,result=raw?parse(raw.result_json):null,value=result?.dshNative||result?.result?.dshNative,data=value?.data;
  if(visible?.type!=='employee.dsh.operation'||raw?.type!=='employee.dsh.operation'||raw.status!=='succeeded'||op?.resource!=='plugins'||op.operation!=='prepareUiHost'||!op.subject||op.subject.employeeId!==employeeId||op.subject.deviceId!==subject.deviceId||op.subject.profile!==subject.profile||value?.status!=='applied'||data?.application!=='applied'||data.bridgePackage!=='@dshbot/plugin-ui-host'||data.mountBase!==`/runtime/${subject.profile}/ui/`)fail('DSH_PLUGIN_UI_PREPARE_REQUIRED',409);
  return visible;
 }
 function live(row,context){
  if(!row||row.status!=='open'||Date.parse(row.expiresAt)<=now())fail('DSH_PLUGIN_UI_RELAY_EXPIRED',410);
  const checked=current(row.workspace,row.employeeId,context);
  if(checked.subject.deviceId!==row.deviceId||checked.subject.profile!==row.profile)fail('DSH_PLUGIN_UI_RELAY_BINDING_CHANGED',409);
  return{row,checked};
 }
 function find(relayId){const row=sessions.get(relayId);if(!row)fail('DSH_PLUGIN_UI_RELAY_NOT_FOUND',404);return row;}
 function open(slug,employeeId,input,context={}){
  const value=validateInput(input),checked=current(slug,employeeId,context),key=`${slug}:${employeeId}:${context.actorUserId||''}:${value.idempotencyKey}`;
  const previous=sessions.get(idempotency.get(key));if(previous){if(previous.viewKey!==value.viewKey||previous.prepareActionId!==value.prepareActionId)fail('IDEMPOTENCY_CONFLICT');live(previous,context);return{...normalizeView(previous),duplicate:true,prepareAction:previous.prepareAction};}
  const prepareAction=proof(slug,employeeId,value.prepareActionId,context,checked.subject),relayId=randomId(),row={relayId,workspace:slug,workspaceId:checked.ws.id,employeeId,deviceId:checked.subject.deviceId,profile:checked.subject.profile,actorUserId:context.actorUserId||null,actorRole:context.actorRole||'member',viewKey:value.viewKey,prepareActionId:value.prepareActionId,prepareAction,createdAt:nowIso(now),expiresAt:new Date(now()+ttlMs).toISOString(),status:'open'};
  sessions.set(relayId,row);idempotency.set(key,relayId);return{...normalizeView(row),prepareAction};
 }
 function status(relayId,context={}){const row=find(relayId);if(row.status==='closed')return normalizeView(row);const liveRow=live(row,context);return{...normalizeView(liveRow.row),prepareAction:liveRow.row.prepareAction};}
 function close(relayId,context={}){const row=find(relayId);if(row.status==='closed')return normalizeView(row);live(row,context);row.status='closed';row.closedAt=nowIso(now);return normalizeView(row);}
 function assertRequest(relayId,input,context={}){const {row,checked}=live(find(relayId),context);if(!exact(input,['method','path','headers','bodyBase64','requestId'])||!text(input.method,10)||!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(input.method.toUpperCase())||!text(input.requestId,200))fail('DSH_PLUGIN_UI_RELAY_INPUT_INVALID',400);validatePath(row.profile,input.path);validateHeaders(input.headers);if(input.bodyBase64!==undefined&&(!text(input.bodyBase64,700000)||!/^[-A-Za-z0-9+/=]*$/.test(input.bodyBase64)))fail('DSH_PLUGIN_UI_RELAY_BODY_INVALID',400);return{relay:normalizeView(row),subject:checked.subject,method:input.method.toUpperCase(),path:input.path,headers:validateHeaders(input.headers),bodyBase64:input.bodyBase64||'',requestId:input.requestId};}
 function dispose(){sessions.clear();idempotency.clear();}
 return{open,status,close,assertRequest,dispose,feature:DSH_PLUGIN_UI_RELAY_FEATURE};
}
