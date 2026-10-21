import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {WORLD_MEMORY_CATALOG_ID, syncWorldMemorySkill, worldMemoryEmployeeIdentity} from './skills/catalog.mjs';
import {validateSkillDocument} from './skills/validator.mjs';

const SLUG='test-111', actor={actorUserId:'memory-guide-owner',actorRole:'owner'};
function fixture(t) {
  const repo=createRepository({memory:true,envEncryptionKey:'world-memory-guide-fixture'});
  t.after(()=>repo.db.close());
  repo.heartbeatDevice(SLUG,{deviceId:'memory-pc',ownerUserId:actor.actorUserId,runtimes:{Codex:{status:'available'},Hermes:{status:'available',profiles:[{name:'default'}]}}});
  const employee=(runtime='Codex',extra={})=>repo.createEmployee(SLUG,{name:'Knowledge employee',runtime,targetDeviceId:'memory-pc',...(runtime==='Hermes'?{runtimeProfile:'default'}:{}),...extra},actor);
  const task=(worker,slug=SLUG)=>{
    const created=repo.createTask(slug,{title:'Read related guidance',employeeId:worker.id,execute:true});
    return repo.listTasks(slug).find(row=>row.id===created.id).execution;
  };
  return {repo,employee,task};
}
const guideCount=prompt=>prompt.split('技能：紫薇映界·共享知识库').length-1;
const assertGuide=(payload,employee)=>{
  assert.equal(guideCount(payload.prompt),1);
  assert.ok(payload.prompt.includes(worldMemoryEmployeeIdentity(employee.workspace_id,employee.id)));
  assert.equal(payload.employeeId,employee.id);
};

test('shared catalog is scoped, truthful and idempotent; no knowledge identity or MCP is created',t=>{
  const {repo}=fixture(t),ws=repo.getWorkspace(SLUG);
  const beforeActions=repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n;
  const first=repo.listSkills(SLUG).find(row=>row.catalog_id===WORLD_MEMORY_CATALOG_ID);
  assert.equal(first.installed,true);
  assert.equal(first.validation_status,'valid');
  assert.equal(first.integration.kind,'knowledge_guide');
  assert.equal(first.integration.setupRequired,true);
  assert.equal(first.integration.connectionStatus,'not_verified');
  assert.equal(repo.listSkills(SLUG).find(row=>row.catalog_id==='ziwei-phone-control').installed,false);
  const snapshot=repo.db.prepare('SELECT * FROM skills WHERE id=?').get(first.id);
  const versions=repo.db.prepare('SELECT COUNT(*) n FROM skill_versions WHERE skill_id=?').get(first.id).n;
  assert.equal(syncWorldMemorySkill(repo.db,ws.id),first.id);
  assert.deepEqual(repo.db.prepare('SELECT * FROM skills WHERE id=?').get(first.id),snapshot);
  assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM skill_versions WHERE skill_id=?').get(first.id).n,versions);
  assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM a2a_actions').get().n,beforeActions);
  const content=fs.readFileSync(new URL('../skills/ziwei-world-memory/SKILL.md',import.meta.url),'utf8');
  assert.equal(validateSkillDocument({content}).validationStatus,'valid');
  assert.ok(Buffer.byteLength(content)<7000,'keep the shared guide small; official detail stays on demand');
});

test('shared catalog synchronization preserves an installed phone skill and its explicit rollback',t=>{
  const {repo}=fixture(t);
  const phone=repo.listSkills(SLUG).find(row=>row.catalog_id==='ziwei-phone-control');
  repo.setSkillInstalled(phone.id,true);
  repo.db.prepare('INSERT INTO skill_versions(id,skill_id,version,content,content_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run('phone-before-world-guide',phone.id,'0.9.0','# Historical phone guide','f'.repeat(64),JSON.stringify({name:phone.name,description:phone.description,category:phone.category}),new Date().toISOString());
  repo.rollbackSkill(phone.id,'phone-before-world-guide');
  for(let pass=0;pass<2;pass++) {
    const skills=repo.listSkills(SLUG),listed=skills.find(row=>row.id===phone.id);
    assert.equal(listed.version,'0.9.0');assert.equal(listed.content,'# Historical phone guide');
    assert.equal(listed.installed,true);assert.equal(listed.integration.kind,'phone_mcp');
    assert.equal(skills.filter(row=>row.catalog_id===WORLD_MEMORY_CATALOG_ID).length,1);
  }
});

test('existing and new employees receive the default guide without rewriting chosen skills or persona',async t=>{
  const {repo,employee,task}=fixture(t);
  const selected=await repo.importSkill(SLUG,{content:'---\nname: Existing domain method\nversion: 1.0.0\n---\n# Existing method\n\nUse the established domain method.'});
  const worker=employee('Codex',{persona:'Keep original personality',instructions:'Keep original instructions',description:'Keep original position',skills:[selected.id]});
  const before=repo.db.prepare('SELECT * FROM employees WHERE id=?').get(worker.id);
  assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM skills WHERE catalog_id=?').get(WORLD_MEMORY_CATALOG_ID).n,0);
  const action=task(worker);assertGuide(action.payload,worker);
  for(const expected of ['Keep original personality','Keep original instructions','Keep original position','Use the established domain method.'])assert.ok(action.payload.prompt.includes(expected));
  assert.deepEqual(repo.db.prepare('SELECT * FROM employees WHERE id=?').get(worker.id),before);
  const guide=repo.listSkills(SLUG).find(row=>row.catalog_id===WORLD_MEMORY_CATALOG_ID);
  const later=employee('Hermes',{skills:[guide.id,guide.name]});assertGuide(task(later).payload,later);
  assert.equal(repo.db.prepare('SELECT COUNT(*) n FROM skills WHERE catalog_id=?').get(WORLD_MEMORY_CATALOG_ID).n,1);
});

test('independent profile remains stable across employee rename and differs for every employee and workspace',t=>{
  const {repo,employee,task}=fixture(t),one=employee(),two=employee();
  const identity=worldMemoryEmployeeIdentity(one.workspace_id,one.id);
  assert.notEqual(identity,worldMemoryEmployeeIdentity(two.workspace_id,two.id));
  assert.notEqual(identity,worldMemoryEmployeeIdentity('another-workspace',one.id));
  repo.updateEmployee(one.id,{name:'Renamed employee'},actor);
  assert.ok(task(repo.getEmployee(one.id)).payload.prompt.includes(identity));
  assert.throws(()=>worldMemoryEmployeeIdentity(null,one.id));
});

test('separate workspaces receive their own catalog and cannot inherit another workspace custom skills',async t=>{
  const {repo,employee,task}=fixture(t),one=employee();
  const privateSkill=await repo.importSkill(SLUG,{content:'---\nname: Workspace private method\n---\n# Private method\n\nPRIVATE_WORKSPACE_METHOD'});
  const foreign='world-memory-other';
  repo.db.prepare('INSERT INTO workspaces(id,slug,name,plan,timezone,created_at) VALUES(?,?,?,?,?,?)').run(foreign,foreign,'Other','free','Asia/Shanghai',new Date().toISOString());
  const two=repo.createEmployee(foreign,{name:'Other worker',runtime:'Codex',skills:[privateSkill.id]});
  assertGuide(task(one).payload,one);
  const other=task(two,foreign).payload;assertGuide(other,two);
  assert.equal(other.prompt.includes('PRIVATE_WORKSPACE_METHOD'),false);
  const skills=repo.db.prepare('SELECT id,workspace_id FROM skills WHERE catalog_id=?').all(WORLD_MEMORY_CATALOG_ID);
  assert.equal(skills.length,2);assert.notEqual(skills[0].id,skills[1].id);
});

test('uninstall also suppresses name-selected world guides until reinstalled; imported metadata cannot enable other defaults',async t=>{
  const {repo,employee,task}=fixture(t),worker=employee();
  const imported=await repo.importSkill(SLUG,{content:'---\nname: Unselected method\n---\n# Method\n\nUNSELECTED_PRIVATE_METHOD'});
  repo.db.prepare('UPDATE skills SET installed=1,integration_json=? WHERE id=?').run(JSON.stringify({defaultEnabled:true}),imported.id);
  const guide=repo.listSkills(SLUG).find(row=>row.catalog_id===WORLD_MEMORY_CATALOG_ID);
  repo.updateEmployee(worker.id,{skills:[guide.id,guide.name]},actor);
  repo.uninstallSkill(guide.id);
  assert.deepEqual(repo.getEmployee(worker.id).skills,[guide.name],'legacy name selections can remain after uninstall removes the ID');
  repo.db.prepare('UPDATE skills SET catalog_release_hash=? WHERE id=?').run('old-release-fixture',guide.id);
  const refreshed=repo.listSkills(SLUG).find(row=>row.id===guide.id);
  assert.equal(refreshed.installed,false);
  const prompt=task(worker).payload.prompt;
  assert.equal(guideCount(prompt),0);assert.equal(prompt.includes('UNSELECTED_PRIVATE_METHOD'),false);
  repo.setSkillInstalled(guide.id,true);
  const restored=task(repo.getEmployee(worker.id)).payload;assertGuide(restored,worker);
  assert.equal(restored.prompt.includes('UNSELECTED_PRIVATE_METHOD'),false);
});

for(const runtime of ['Codex','Hermes'])test(`${runtime} chat and task use the same shared guide without adding MCP or changing execution bindings`,t=>{
  const {repo,employee,task}=fixture(t),worker=employee(runtime,{model:'existing-model'});
  const taskPayload=task(worker).payload;assertGuide(taskPayload,worker);
  const conversation=repo.createConversation(SLUG,{employeeId:worker.id});
  const sent=repo.addConversationMessage(conversation.id,{content:'Search related knowledge',clientMessageId:'guide-chat-'+runtime});
  const chat=repo.getA2AAction(sent.execution.id).payload;assertGuide(chat,worker);
  for(const payload of [taskPayload,chat]) {
    assert.equal(payload.runtime,runtime);assert.equal(payload.model,'existing-model');assert.equal(payload.deviceId,'memory-pc');
    assert.equal(payload.profile,runtime==='Hermes'?'default':null);
    assert.equal(Object.hasOwn(payload,'mcpServers'),false);
    assert.equal(Object.hasOwn(payload,'worldMemoryCredential'),false);
  }
});

function activeBot(repo,bots,key) {
  let bot=bots.create(SLUG,{name:key,targetDeviceId:'memory-pc',sourceProfile:'default',idempotencyKey:key});
  completeOwnedProfile(repo,bot);
  bot=bots.get(SLUG,bot.id);
  const {action}=bots.validate(SLUG,bot.id,{expectedRevision:bot.revision,idempotencyKey:'validate-'+key});
  repo.ackA2AAction(action.id,{deviceId:'memory-pc'});
  repo.resultA2AAction(action.id,{deviceId:'memory-pc',status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision}}});
  return bots.control(SLUG,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'});
}

test('Routine, collaboration and Gateway model deliveries share employee guide injection',t=>{
  const {repo}=fixture(t),bots=createManagementService(repo).bots;
  const bot=activeBot(repo,bots,'memory-source'),worker=repo.getEmployee(bot.id);
  const routine=bots.createRoutine(SLUG,bot.id,{name:'Read memory',prompt:'Read relevant existing knowledge',schedule:'手动',idempotencyKey:'memory-routine'});
  const run=bots.runRoutine(SLUG,bot.id,routine.id,{idempotencyKey:'memory-routine-run'});
  const routineAction=repo.getA2AAction(run.action_id);assertGuide(routineAction.payload,worker);
  repo.resultA2AAction(routineAction.id,{status:'succeeded',result:{output:'fixture'}});
  const target=activeBot(repo,bots,'memory-target');
  const [collaboration]=repo.dispatchBotCollaboration(SLUG,{sourceEmployeeId:bot.id,sourceActionId:null,mode:'message',content:'Read related knowledge',targets:[{id:target.id,revision:target.revision,controlEpoch:target.control_epoch,conversationId:target.main_conversation_id}]},'memory-collaboration');
  assertGuide(collaboration.payload,repo.getEmployee(target.id));
  const changed=bots.update(SLUG,bot.id,{expectedRevision:bot.revision,config:{permissions:{mode:'execute'},gateway:{platforms:{webhook:{enabled:true}}}}});
  const {action:validation}=bots.validate(SLUG,bot.id,{expectedRevision:changed.revision,idempotencyKey:'memory-gateway-validation'});
  repo.ackA2AAction(validation.id,{deviceId:'memory-pc'});repo.resultA2AAction(validation.id,{status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:changed.revision}}});
  const current=bots.control(SLUG,bot.id,{expectedRevision:changed.revision,expectedControlEpoch:changed.control_epoch,operation:'activate'});
  const connect=bots.native(SLUG,bot.id,{expectedRevision:current.revision,expectedControlEpoch:current.control_epoch,idempotencyKey:'memory-gateway-lease',resource:'gateway',operation:'connect',input:{platform:'webhook',durationSeconds:60}}).action;
  repo.ackA2AAction(connect.id,{deviceId:'memory-pc'});repo.resultA2AAction(connect.id,{status:'succeeded',result:{connected:true}});
  const delivery=repo.receiveBotGateway(connect.id,{deviceId:'memory-pc',platform:'webhook',chatId:'fixture-memory-chat',messageId:'fixture-memory-message',content:'Read related knowledge'}).delivery;
  assertGuide(delivery.action.payload,worker);
});
