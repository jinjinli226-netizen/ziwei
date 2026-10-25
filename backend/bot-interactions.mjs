import {canonicalSecretBinding,validateSecretEnvelope,validateSecretPublicKey} from '../src/bot-secret-crypto.mjs';
import {botFailure} from '../src/hermes-bot-config.mjs';

export const BOT_INTERACTION_FEATURE='bot_interaction_v1';
const fail=(code,status=409)=>{throw botFailure(code,'本次交互已失效或与当前员工不匹配，请刷新员工聊天。',status);};
const same=(a,b)=>canonicalSecretBinding(a)===canonicalSecretBinding(b);
const kinds=new Set(['vault_unlock','vault_save_login','vault_code','question','approval']);
const secureKinds=new Set(['vault_unlock','vault_save_login','vault_code']);
const terminal=new Set(['cancelled','expired','delivered']);
const text=(v,max=200)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\0\r\n]/.test(v);

// Bounded ephemeral relay: only encrypted answers are retained, no conversation
// rows/tasks/events carry an answer. Restart expires all unfinished requests.
export function createBotInteractions(repo,bots,{now=Date.now,maxRequests=500}={}){
 const requests=new Map();
 function retire(r,state){r.state=state;r.envelope=null;}
 function prune(){for(const[id,r]of requests){if(now()>=r.expiresAt&&!terminal.has(r.state))retire(r,'expired');if(now()>=r.expiresAt+300000)requests.delete(id);}}
 function actionFor(actionId,credential){
  if(!text(credential?.deviceId)||!text(credential?.credentialId)||!text(credential?.workspaceId)||!text(credential?.workspace))fail('BOT_INTERACTION_DEVICE_REQUIRED',401);
  const action=repo.deviceAction(actionId,{deviceId:credential.deviceId}),b=action?.payload?.hermesBot;
  const actionWorkspace=repo.db.prepare('SELECT workspace_id FROM a2a_actions WHERE id=?').get(actionId)?.workspace_id;
  if(!b||b.workspace!==credential.workspace||b.deviceId!==credential.deviceId||actionWorkspace!==credential.workspaceId||action.status!=='acked'||action.type!=='conversation.execute')fail('BOT_INTERACTION_ACTION_INVALID',403);
  repo.authorizeBotStart(actionId,{deviceId:credential.deviceId});
  if(b.config?.permissions?.mode==='read_only')fail('BOT_INTERACTION_READ_ONLY',403);
  return{action,b,binding:{workspaceId:credential.workspaceId,employeeId:b.employeeId,profile:b.instance?.profile||b.sourceProfile,deviceId:b.deviceId,actionId,revision:b.revision,controlEpoch:b.controlEpoch}};
 }
 function current(r){
  const credential=repo.db.prepare('SELECT c.id,c.revoked_at,d.status FROM device_credentials c JOIN devices d ON d.id=c.device_id WHERE c.id=? AND c.device_id=? AND c.workspace_id=?').get(r.credentialId,r.binding.deviceId,r.binding.workspaceId);
  if(!credential||credential.revoked_at||credential.status==='disabled')fail('BOT_INTERACTION_AUTHORITY_CHANGED',403);
  const owner=repo.db.prepare('SELECT owner_user_id FROM employees WHERE id=? AND workspace_id=?').get(r.binding.employeeId,r.binding.workspaceId);
  const key=repo.db.prepare('SELECT key_id FROM bot_secret_devices WHERE workspace_id=? AND device_id=?').get(r.binding.workspaceId,r.binding.deviceId);
  if(owner?.owner_user_id!==r.ownerUserId||key?.key_id!==r.binding.keyId)fail('BOT_INTERACTION_AUTHORITY_CHANGED',403);
  const {binding}=actionFor(r.binding.actionId,{credentialId:r.credentialId,deviceId:r.binding.deviceId,workspaceId:r.binding.workspaceId,workspace:r.workspace});
  if(!same(binding,r.baseBinding))fail('BOT_INTERACTION_BINDING_CHANGED');
 }
 function view(r){return{requestId:r.requestId,workspace:r.workspace,employeeId:r.binding.employeeId,actionId:r.binding.actionId,kind:r.kind,secure:secureKinds.has(r.kind),display:r.display,choices:r.choices,options:r.options,state:r.state,expiresAt:r.expiresAt,binding:r.binding,devicePublicKey:r.publicKey};}
 function browser(slug,id,requestId,context){
  prune();const bot=bots.get(slug,id,context,{view:'management'}),r=requests.get(requestId);
  if(!r||r.workspace!==slug||r.binding.employeeId!==id)fail('BOT_INTERACTION_NOT_FOUND',404);
  // Sharing an employee does not share the right to input credentials.
  if(!context?.actorUserId||context.actorUserId!==r.ownerUserId)fail('BOT_INTERACTION_USER_REQUIRED',403);
  if(bot.revision!==r.binding.revision||bot.control_epoch!==r.binding.controlEpoch){retire(r,'cancelled');fail('BOT_INTERACTION_BINDING_CHANGED');}
  try{current(r);}catch(error){retire(r,'cancelled');throw error;}return r;
 }
 function publish(actionId,credential,input){
  prune();const{binding,b}=actionFor(actionId,credential);
  if(!input||Object.keys(input).some(k=>!['purpose','requestId','kind','expiresAt','secure','display','choices','options',...Object.keys(binding)].includes(k))||!text(input.requestId,100)||!kinds.has(input.kind)||input.purpose!=='hermes-interaction'||secureKinds.has(input.kind)!==input.secure||!same(binding,Object.fromEntries(Object.keys(binding).map(k=>[k,input[k]])))||!Number.isSafeInteger(input.expiresAt)||input.expiresAt*1000<=now()||input.expiresAt*1000>now()+301000)fail('BOT_INTERACTION_INPUT_INVALID',400);
  const display=input.display;if(!display||typeof display!=='object'||Array.isArray(display)||JSON.stringify(display).length>16000||JSON.stringify(input.choices||null).length>12000||JSON.stringify(input.options||null).length>4000)fail('BOT_INTERACTION_INPUT_INVALID',400);
  const existing=requests.get(input.requestId);if(existing){if(existing.credentialId!==credential.credentialId||!same(existing.original,input))fail('BOT_INTERACTION_REQUEST_CONFLICT');return view(existing);}
  if(requests.size>=maxRequests)fail('BOT_INTERACTION_BUSY',503);
  const e=repo.db.prepare('SELECT owner_user_id FROM employees WHERE id=? AND workspace_id=?').get(b.employeeId,credential.workspaceId);
  const key=repo.db.prepare('SELECT public_key,key_id FROM bot_secret_devices WHERE workspace_id=? AND device_id=?').get(credential.workspaceId,credential.deviceId);
  if(!e?.owner_user_id||!key?.public_key)fail('BOT_INTERACTION_DEVICE_KEY_REQUIRED');
  try{validateSecretPublicKey(key.public_key);}catch{fail('BOT_INTERACTION_DEVICE_KEY_REQUIRED');}
  const fullBinding={...binding,purpose:'hermes-interaction',requestId:input.requestId,kind:input.kind,expiresAt:input.expiresAt,keyId:key.key_id};
  const r={requestId:input.requestId,original:structuredClone(input),baseBinding:binding,binding:fullBinding,workspace:credential.workspace,ownerUserId:e.owner_user_id,credentialId:credential.credentialId,publicKey:key.public_key,kind:input.kind,display:structuredClone(display),choices:input.choices||null,options:input.options||null,state:'waiting',envelope:null,expiresAt:input.expiresAt*1000};requests.set(r.requestId,r);return view(r);
 }
 function list(slug,id,context){prune();const bot=bots.get(slug,id,context,{view:'management'});const result=[];for(const r of requests.values())if(r.workspace===slug&&r.binding.employeeId===bot.id&&r.ownerUserId===context?.actorUserId){try{browser(slug,id,r.requestId,context);result.push(view(r));}catch{}}return{requests:result};}
 function answer(slug,id,requestId,input,context){const r=browser(slug,id,requestId,context);if(r.state!=='waiting')fail('BOT_INTERACTION_ALREADY_RESOLVED');if(!input||Object.keys(input).join(',')!=='envelope')fail('BOT_INTERACTION_ENCRYPTED_ANSWER_REQUIRED',400);try{validateSecretEnvelope(input.envelope);}catch{fail('BOT_INTERACTION_ENCRYPTED_ANSWER_REQUIRED',400);}r.envelope=structuredClone(input.envelope);r.state='answered';return view(r);}
 function cancel(slug,id,requestId,context){const r=browser(slug,id,requestId,context);if(!terminal.has(r.state))retire(r,'cancelled');return view(r);}
 function claim(actionId,requestId,credential){prune();actionFor(actionId,credential);const r=requests.get(requestId);if(!r||r.binding.actionId!==actionId||r.credentialId!==credential.credentialId)fail('BOT_INTERACTION_NOT_FOUND',404);try{current(r);}catch(error){retire(r,'cancelled');throw error;}if(r.state!=='answered')return{requestId,state:r.state};const envelope=r.envelope;retire(r,'delivered');return{requestId,state:'answered',binding:r.binding,envelope};}
 function begin(actionId,credential){const{binding}=actionFor(actionId,credential);return{binding};}
 return{begin,publish,list,answer,cancel,claim};
}
