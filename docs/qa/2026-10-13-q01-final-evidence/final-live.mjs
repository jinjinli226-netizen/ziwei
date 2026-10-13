import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { botInstanceStatus, botCreateAdmission } from '../../frontend/src/bot-owned-profile.js';
const base='http://127.0.0.1:4283',slug='preview-bots',id='employee_6ae5ac62-2574-4abb-aa45-7c8cfe0532f9',root=path.join(import.meta.dirname,'final-live');
fs.mkdirSync(root,{recursive:true});
const hash=v=>createHash('sha256').update(v).digest('hex');
async function request(p,body,method=body?'POST':'GET'){
 const response=await fetch(base+p,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 return {status:response.status,value:await response.json()};
}
async function api(p,body,method){const r=await request(p,body,method);assert.ok(r.status>=200&&r.status<300,`${r.status} ${r.value.error}`);return r.value;}
const botPath=`/api/workspaces/${slug}/bots/${id}`;
const label=process.argv[2];
if(label==='preserve'){
 const priorRoot='C:/Users/25941/.codex/worktrees/v2-e03-bot-reasoning/灵光爸爸拆解';
 const before=JSON.parse(fs.readFileSync(path.join(priorRoot,'.local/e03-native-preview-evidence/before-reasoning-update.json')));
 const changed=[];let verified=0;
 for(const [relative,expected] of Object.entries(before.files)){
  const p=path.join(before.home,relative);try{const s=fs.lstatSync(p);const actual=s.isSymbolicLink()?{link:fs.readlinkSync(p)}:{bytes:s.size,hash:hash(fs.readFileSync(p))};if(JSON.stringify(actual)!==JSON.stringify(expected))changed.push({relative,expected,actual});else verified++;}catch(error){changed.push({relative,error:error.code});}
 }
 const db=new DatabaseSync(path.join(before.stateRoot,'data/preview.sqlite'),{readOnly:true}),old=new DatabaseSync(before.backup,{readOnly:true});
 let accounts;try{const query='SELECT * FROM local_users ORDER BY id';const sanitize=r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='last_login_at'));const first=old.prepare(query).all().map(sanitize),current=db.prepare(query).all().map(sanitize);accounts={count:current.length,baselineCount:first.length,preserved:hash(JSON.stringify(first))===hash(JSON.stringify(current)),baselineDigest:hash(JSON.stringify(first)),currentDigest:hash(JSON.stringify(current)),excludedFields:['last_login_at']};}finally{db.close();old.close();}
 const result={at:new Date().toISOString(),beforeUpdate:before.at,originalHomeFiles:Object.keys(before.files).length,verified,changed,accounts,health:await api('/__preview/health')};fs.writeFileSync(path.join(root,'preservation.json'),JSON.stringify(result,null,2));assert.deepEqual(changed,[]);assert.equal(accounts.preserved,true);console.log(JSON.stringify({originalHomeFiles:result.originalHomeFiles,verified,changed:changed.length,accounts:{count:accounts.count,preserved:accounts.preserved}}));
}else{
 const bot=await api(botPath);assert.equal(bot.id,id);assert.match(bot.employee.name,/^Q01 Final reasoning/);
 const runs=(await api(botPath+'/runs')).runs;
 if(label.startsWith('stale-negative')){
  assert.equal(bot.validation.status,'stale');assert.notEqual(bot.validation.revision,bot.revision);
  const rejected=await request(botPath+'/control',{operation:'activate',expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch});assert.equal(rejected.status,409);assert.equal(rejected.value.code,'BOT_NOT_VALIDATED');
  fs.writeFileSync(path.join(root,label+'.json'),JSON.stringify({at:new Date().toISOString(),revision:bot.revision,validation:bot.validation,rejected},null,2));console.log(JSON.stringify({staleRevision:bot.revision,activationStatus:rejected.status,code:rejected.value.code}));
 }else if(label==='cleanup'){
  assert.ok(runs.every(r=>!['pending','acked'].includes(r.status)));assert.ok(runs.every(r=>r.result?.executionState!=='uncertain'));
  const identities=JSON.parse(fs.readFileSync(path.join(root,'created.json'))).bot;assert.equal(bot.instance.profile,identities.instance.profile);assert.equal(bot.instance.home,identities.instance.home);assert.equal(bot.main_conversation_id,identities.main_conversation_id);
  let paused=bot;if(bot.control_state!=='paused')paused=await api(botPath+'/control',{operation:'pause',expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch});assert.equal(paused.control_state,'paused');
  const removed=await api(`/api/workspaces/${slug}/employees/${id}`,null,'DELETE');assert.equal(removed.deleted,true);assert.equal((await fetch(base+botPath)).status,404);
  const remaining=(await api(`/api/workspaces/${slug}/employees`)).employees.map(r=>r.id).sort();assert.deepEqual(remaining,['employee_2cf91534-604d-4373-a095-741d38c8e2f6','employee_841788a1-5c86-44cb-b0cd-80171826d221'].sort());
  const result={at:new Date().toISOString(),deletedId:id,profile:bot.instance.profile,home:bot.instance.home,mainConversationId:bot.main_conversation_id,paused:true,pendingOrAcked:0,runs,deleted:true,getAfterDelete:404,remaining,health:await api('/__preview/health'),qaHomeRetainedAsEvidence:true};fs.writeFileSync(path.join(root,'cleanup.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({at:result.at,deletedId:id,paused:true,pendingOrAcked:0,remaining,apiPid:result.health.pid}));
 }else{
  const discovery=await api(`/api/workspaces/${slug}/mcp/discovery`),state=botInstanceStatus(bot,discovery),device=discovery.devices.find(d=>d.id===bot.employee.target_device_id),profile=device?.runtimes?.find(r=>r.name==='Hermes')?.profiles.find(p=>p.name===bot.instance.profile),team=(await api(`/api/workspaces/${slug}/employees`)).employees.find(e=>e.id===id),chat=await api(`/api/conversations/${bot.main_conversation_id}`);
  const template=botCreateAdmission(discovery,{workspace:slug,deviceId:bot.employee.target_device_id,sourceProfile:bot.instance.profile});
  const result={at:new Date().toISOString(),label,bot,state,discoveredProfile:profile,ownedAsTemplate:template.ready,templateIssues:template.issues,team,chat,runs,health:await api('/__preview/health')};fs.writeFileSync(path.join(root,label+'.json'),JSON.stringify(result,null,2));
  assert.equal(bot.employee.id,team.id);assert.equal(chat.employee_id,id);if(profile){assert.equal(profile.owned_profile,true);assert.equal(profile.initialization_source,false);assert.equal(state.stage,'provisioned');assert.equal(template.ready,false);}
  console.log(JSON.stringify({label,id,revision:bot.revision,configEffort:bot.config.reasoningEffort??null,hasEffort:Object.hasOwn(bot.config,'reasoningEffort'),validation:bot.validation,control:bot.control_state,stage:state.stage,discoveredProfile:profile?.name,ownedAsTemplate:template.ready,main:bot.main_conversation_id,runs:runs.map(r=>({id:r.id,status:r.status,type:r.type}))}));
 }
}
