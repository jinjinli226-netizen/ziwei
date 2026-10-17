import test from 'node:test';
import assert from 'node:assert/strict';
import {createBotSettings,renderBotSettings} from '../web/bot-settings.js';
import {initialState,scopeKey} from '../web/model.js';
import {createDefaultBotConfig} from '../../src/hermes-bot-config.mjs';
import {createRepository} from '../../backend/repository.mjs';
import {createManagementService} from '../../backend/management.mjs';
import {createPhoneMcpService} from '../../backend/phone-mcp.mjs';
import {completeOwnedProfile} from '../../test-support/owned-profile.mjs';

const copy=value=>structuredClone(value),deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({role='owner',workspace='workspace-one',employee:providedEmployee,bot:providedBot,api:overrides={}}={}) {
  const employee=providedEmployee || {id:'one',name:'员工甲',runtime:'Hermes',model_id:'original-model',target_device_id:'pc-one',runtime_profile:'owned-original',skills:['existing-skill'],visibility:'personal',persona:'原人格',instructions:'原职责'};
  let bot=providedBot===null?null:providedBot || {id:employee.id,employee_id:employee.id,workspace:'workspace-one',employee:copy(employee),configuration_state:'initialized',revision:4,control_epoch:2,control_state:'draft',config:createDefaultBotConfig({gateway:{platforms:{},profileRoutes:[]}}),validation:{status:'not_checked',revision:null}};
  const state={...initialState(),phase:'ready',page:'bot-settings',user:{user_id:'user-one'},workspace:{slug:providedBot?.workspace || workspace,role},selectedEmployee:copy(employee),employees:[copy(employee)],bots:bot?[copy(bot)]:[],bot:bot?copy(bot):null};
  let generation=0,draws=0;const calls=[],failures=[];
  const api={bot:async()=>copy(bot),employees:async()=>({employees:[copy(employee)]}),models:async()=>({models:[{id:'original-model',label:'原模型'}]}),skills:async()=>({skills:[{id:'existing-skill',name:'原技能',installed:true}]}),devices:async()=>({devices:[{id:'pc-one',name:'原电脑',status:'online'},{id:'pc-two',name:'另一电脑',status:'online'}]}),runtimes:async()=>({runtimes:[]}),hermesProfiles:async()=>({profiles:[{name:'owned-original'}]}),botCapabilities:async()=>({capabilities:[]}),employeeMcpStatus:async()=>({employee_id:employee.id,receipt:{status:'never_run'}}),
    updateBot:async(workspace,employeeId,body)=>{calls.push({kind:'save',workspace,employeeId,body:copy(body)});bot={...bot,employee:{...bot.employee,...body.employee,model_id:body.employee.model},config:copy(body.config),revision:bot.revision+1,control_epoch:bot.control_epoch+1};delete bot.employee.model;return copy(bot);},
    validateBot:async(workspace,employeeId,body)=>{calls.push({kind:'validate',workspace,employeeId,body});return {action:{id:'check-one'}};},controlBot:async(workspace,employeeId,body)=>{calls.push({kind:'control',workspace,employeeId,body});bot={...bot,control_state:body.operation==='pause'?'paused':'active',control_epoch:bot.control_epoch+1};return copy(bot);},
    updateEmployee:async(workspace,employeeId,body)=>{calls.push({kind:'employee',workspace,employeeId,body:copy(body)});return {...employee,...body,model_id:body.model,target_device_id:body.targetDeviceId || employee.target_device_id,runtime_profile:body.runtimeProfile ?? employee.runtime_profile};},
    ...overrides};
  const current=()=>({generation,scope:scopeKey(state),employeeId:state.selectedEmployee?.id});
  const valid=token=>token.generation===generation&&token.scope===scopeKey(state)&&token.employeeId===state.selectedEmployee?.id;
  const settings=createBotSettings({state,api,current,valid,draw:()=>draws++,fail:error=>{failures.push(error);if(error.status===401){state.phase='login';state.botSettings=null;state.bot=null;state.selectedEmployee=null;}},acceptBot:value=>{state.bot=copy(value);state.selectedEmployee={...state.selectedEmployee,...value.employee};}});
  return {state,api,settings,calls,failures,get draws(){return draws;},get bot(){return bot;},leave(){generation++;state.page='home';state.selectedEmployee=null;},enter(){generation++;state.page='bot-settings';state.selectedEmployee=copy(employee);},setBot(value){bot=copy(value);}};
}
const edit=(f,name,value,checked,type)=>f.settings.change({name:`bot.${name}`,value,checked,type});

test('cached form remains usable while model and capability discovery are pending', async()=>{
  const slow=deferred(),f=fixture({api:{models:()=>slow.promise,botCapabilities:()=>slow.promise}});
  await f.settings.load();assert.equal(f.state.botSettings.loading,false);
  const html=renderBotSettings(f.state);assert.match(html,/name="bot.model" value="original-model"/);assert.match(html,/data-state-fields/);assert.match(html,/暂不支持更换/);
  edit(f,'model','new-model');assert.equal(f.state.botSettings.draft.employee.model,'new-model');assert.equal(f.state.botSettings.dirty,true);
  slow.resolve({models:[],capabilities:[]});await tick();assert.equal(f.state.botSettings.draft.employee.model,'new-model');
});

test('same-employee refresh keeps dirty fields and detects a concurrent revision', async()=>{
  const f=fixture();await f.settings.load();edit(f,'instructions','手机草稿');
  f.setBot({...f.bot,revision:5,employee:{...f.bot.employee,instructions:'电脑端已修改'}});await f.settings.load();
  assert.equal(f.state.botSettings.draft.employee.instructions,'手机草稿');assert.equal(f.state.botSettings.conflict,true);
  assert.equal(await f.settings.submit(),false);assert.equal(f.calls.length,0);
  await f.settings.actions['bot-settings-reload']();assert.equal(f.state.botSettings.draft.employee.instructions,'电脑端已修改');assert.equal(f.state.botSettings.dirty,false);assert.equal(f.state.botSettings.conflict,false);
});

test('saving sends current CAS revision and preserves opaque config fields without enabling anything', async()=>{
  const f=fixture();f.bot.config.opaqueFutureField={retained:true};f.bot.config.memory.opaqueMemoryField='keep';await f.settings.load();
  edit(f,'model','real-model');edit(f,'reasoningEffort','ultra');edit(f,'memory.charLimit','6000');
  assert.equal(await f.settings.submit(),true);
  assert.equal(f.calls.length,1);const body=f.calls[0].body;
  assert.equal(body.expectedRevision,4);assert.equal(body.employee.model,'real-model');assert.equal(body.config.reasoningEffort,'ultra');assert.equal(body.config.memory.charLimit,6000);assert.equal(body.config.memory.opaqueMemoryField,'keep');assert.deepEqual(body.config.opaqueFutureField,{retained:true});assert.deepEqual(body.config.gateway,{platforms:{},profileRoutes:[]});
  assert(!Object.hasOwn(body.employee,'targetDeviceId'));assert(!Object.hasOwn(body.employee,'runtimeProfile'));
});

test('read-only permission conflicts and malformed MCP edits fail without a server write', async()=>{
  const f=fixture();await f.settings.load();edit(f,'permission','read_only');
  assert.equal(await f.settings.submit(),false);assert.match(f.state.botSettings.errors.operation,/使用工具或 MCP/);assert.equal(f.calls.length,0);
  edit(f,'permission','execute');edit(f,'newMcpName','external-tools');f.settings.actions['bot-settings-mcp-add']();
  edit(f,'mcp.external-tools.command','node');edit(f,'mcp.external-tools.env','{"API_KEY":"plaintext-secret"}');
  assert.equal(await f.settings.submit(),false);assert.match(f.state.botSettings.errors.operation,/不能保存密钥正文/);assert.equal(f.calls.length,0);
  edit(f,'mcp.external-tools.env','not json');assert.equal(await f.settings.submit(),false);assert.equal(f.calls.length,0);
});

test('409 preserves the draft and lost-save retries keep the original CAS body', async()=>{
  const attempts=[];let failOnce=true;
  const f=fixture({api:{updateBot:async(_ws,_id,body)=>{attempts.push(copy(body));if(failOnce){failOnce=false;throw new TypeError('lost response');}return {...f.bot,revision:5,config:copy(body.config),employee:{...f.bot.employee,model_id:body.employee.model}};}}});
  await f.settings.load();edit(f,'model','new-model');assert.equal(await f.settings.submit(),false);assert.equal(f.state.botSettings.writeUnknown,true);
  await f.settings.load();assert.equal(f.state.botSettings.writeUnknown,true);assert.equal(attempts.length,1);
  await f.settings.actions['bot-settings-retry']();assert.deepEqual(attempts[1],attempts[0]);assert.equal(f.state.botSettings.writeUnknown,false);
  const conflict=fixture({api:{updateBot:async()=>{throw Object.assign(new Error('配置版本已变化'),{status:409,code:'BOT_REVISION_CONFLICT'});}}});await conflict.settings.load();edit(conflict,'model','keep-draft');await conflict.settings.submit();assert.equal(conflict.state.botSettings.draft.employee.model,'keep-draft');assert.equal(conflict.state.botSettings.conflict,true);
});

test('late reads and save results ignore a departed employee and 401 is delegated to login cleanup', async()=>{
  const slow=deferred(),f=fixture({api:{bot:()=>slow.promise}});const loading=f.settings.load();f.leave();slow.resolve({...f.bot,employee:{...f.bot.employee,model_id:'late-model'}});await loading;
  assert.equal(f.state.selectedEmployee,null);assert.equal(f.state.botSettings.draft.employee.model,'original-model');
  const expired=fixture({api:{skills:async()=>{throw Object.assign(new Error('expired'),{status:401});}}});await expired.settings.load();await tick();assert.equal(expired.state.phase,'login');assert.equal(expired.state.botSettings,null);
});

test('ordinary employees save their original runtime with existing device and profile choices', async()=>{
  const employee={id:'codex-one',name:'普通 Codex 员工',runtime:'Codex',model_id:'old-codex',target_device_id:'pc-one',runtime_profile:null,skills:[],visibility:'workspace'};
  const f=fixture({employee,bot:null,api:{bot:async()=>{throw new Error('ordinary must not call bots');}}});await f.settings.load();edit(f,'model','gpt-6.1-sol');edit(f,'targetDeviceId','pc-two');
  assert.equal(await f.settings.submit(),true);assert.deepEqual(f.calls.map(call=>call.kind),['employee']);assert.equal(f.calls[0].body.model,'gpt-6.1-sol');assert.equal(f.calls[0].body.targetDeviceId,'pc-two');assert(!Object.hasOwn(f.calls[0].body,'runtime'));assert(!Object.hasOwn(f.calls[0].body,'config'));
});

test('viewer cannot save or validate and only explicit validation may create a validation request', async()=>{
  const viewer=fixture({role:'viewer'});await viewer.settings.load();edit(viewer,'model','new');await viewer.settings.submit();await viewer.settings.actions['bot-settings-validate']();assert.equal(viewer.calls.length,0);
  const f=fixture();await f.settings.load();assert.equal(f.calls.length,0);await f.settings.actions['bot-settings-activate']();assert.equal(f.calls.length,0);
  await f.settings.actions['bot-settings-validate']();assert.equal(f.calls.filter(call=>call.kind==='validate').length,1);assert.equal(f.calls.filter(call=>call.kind==='control').length,0);
});

test('phone control saves only on explicit owner action and retains the employee binding and business account', async()=>{
  const configuration={employee_id:'one',workspace:'workspace-one',enabled:false,target_device_id:'pc-one',runtime:'Hermes',runtime_profile:'owned-original',phone_device_id:'phone-one',binding:{accountId:'account-existing',accountLabel:'原业务账号'}};
  const writes=[],f=fixture({api:{phoneMcpSetup:async()=>({workspace:'workspace-one',phones:[{id:'phone-one',alias:'原手机'}],employees:[]}),phoneMcpStatus:async()=>({configuration:copy(configuration),receipt:{status:'never_run'}}),savePhoneMcp:async(_ws,_id,body)=>{writes.push(copy(body));return {configuration:{...configuration,enabled:body.enabled,binding:{accountId:body.accountId,accountLabel:body.accountLabel}}};}}});
  await f.settings.load();await tick();assert.equal(writes.length,0);edit(f,'phone.enabled','',true);await f.settings.submitPhone();
  assert.equal(writes.length,1);assert.deepEqual(writes[0],{enabled:true,targetDeviceId:'pc-one',runtime:'Hermes',runtimeProfile:'owned-original',phoneDeviceId:'phone-one',accountId:'account-existing',accountLabel:'原业务账号'});
  const member=fixture({role:'member',api:{phoneMcpSetup:async()=>({phones:[{id:'phone-one'}]}),savePhoneMcp:async()=>{throw new Error('must not reach server');}}});await member.settings.load();await tick();edit(member,'phone.phoneDeviceId','phone-one');edit(member,'phone.enabled','',true);assert.equal(await member.settings.submitPhone(),false);assert.match(member.state.botSettings.errors.phoneSave,/管理员权限/);
});

test('real in-memory Bot saves model and config then validates and activates only on explicit clicks', async t=>{
  const repo=createRepository({memory:true,envEncryptionKey:'mobile-settings-fixture'});t.after(()=>repo.db.close());
  const management=createManagementService(repo),bots=management.bots,slug='test-111',deviceId='settings-pc';
  const heartbeat=profiles=>repo.heartbeatDevice(slug,{deviceId,runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:profiles.map(name=>({name,provider_configured:true,authentication_configured:true}))}}});
  heartbeat(['default']);let bot=bots.create(slug,{name:'设置回归员工',sourceProfile:'default',targetDeviceId:deviceId,idempotencyKey:'settings-real-bot',config:{permissions:{mode:'execute'},toolsets:['web'],gateway:{platforms:{},profileRoutes:[]}}});
  completeOwnedProfile(repo,bot);heartbeat(['default',bot.instance.profile]);bot=bots.get(slug,bot.id);
  const f=fixture({employee:bot.employee,bot,api:{bot:async()=>bots.get(slug,bot.id),models:async()=>({models:repo.listModels(slug,{runtime:'Hermes'})}),skills:async()=>({skills:repo.listSkills(slug)}),devices:async()=>({devices:repo.listDevices(slug)}),runtimes:async()=>({runtimes:repo.listRuntimes(slug)}),hermesProfiles:async(_ws,id)=>repo.listHermesProfiles(slug,{deviceId:id}),botCapabilities:async(_ws,id)=>bots.capabilities(slug,{deviceId:id}),employeeMcpStatus:async()=>management.employeeStatus(slug,bot.id),updateBot:async(_ws,id,body)=>bots.update(slug,id,body),validateBot:async(_ws,id,body)=>bots.validate(slug,id,body),controlBot:async(_ws,id,body)=>bots.control(slug,id,body)}});
  const employeeId=bot.id,conversationId=bot.main_conversation_id,provisionCount=repo.db.prepare("SELECT count(*) n FROM a2a_actions WHERE type='hermes.bot.provision'").get().n;
  await f.settings.load();edit(f,'model','gpt-6.1-sol');edit(f,'reasoningEffort','ultra');edit(f,'memory.charLimit','7000');
  assert.equal(await f.settings.submit(),true);let saved=bots.get(slug,employeeId);assert.equal(saved.employee.model_id,'gpt-6.1-sol');assert.equal(saved.config.reasoningEffort,'ultra');assert.equal(saved.config.memory.charLimit,7000);assert.deepEqual(saved.config.gateway,{platforms:{},profileRoutes:[]});assert.equal(saved.id,employeeId);assert.equal(saved.main_conversation_id,conversationId);assert.equal(saved.control_state,'draft');
  assert.equal(repo.db.prepare("SELECT count(*) n FROM a2a_actions WHERE type='conversation.execute'").get().n,0);
  await f.settings.actions['bot-settings-validate']();await tick();saved=bots.get(slug,employeeId);assert.equal(saved.validation.status,'pending');
  const check=saved.validation.action_id;repo.ackA2AAction(check,{deviceId});repo.resultA2AAction(check,{deviceId,status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId,revision:saved.revision,effective:{reasoning:{schemaVersion:1,employeeId,revision:saved.revision,provider:'openai-codex',model:'gpt-6.1-sol',requested:'ultra',effective:'ultra',actual:'ultra',status:'matched',phase:'preflight',evidence:'native_codex_transport'}}}}});
  await f.settings.load();await f.settings.actions['bot-settings-activate']();saved=bots.get(slug,employeeId);assert.equal(saved.control_state,'active');assert.equal(repo.db.prepare("SELECT count(*) n FROM a2a_actions WHERE type='conversation.execute'").get().n,0);assert.equal(repo.db.prepare("SELECT count(*) n FROM a2a_actions WHERE type='hermes.bot.provision'").get().n,provisionCount);
});

test('real phone MCP service enables and disables the original Codex employee without dispatch or rebinding its computer', async t=>{
  const repo=createRepository({memory:true,envEncryptionKey:'mobile-phone-settings'});t.after(()=>repo.db.close());
  const management=createManagementService(repo),slug='test-111',deviceId='phone-settings-pc',bindings=[];
  repo.heartbeatDevice(slug,{deviceId,terminalMcp:{configured:true,workspace:slug,supportedRuntimes:['Codex']},runtimes:{Codex:{status:'available',version:'1',readiness:{ready:true,authentication:'configured',provider:'configured'},profiles:[]}}});
  const employee=repo.createEmployee(slug,{name:'手机设置员工',runtime:'Codex',targetDeviceId:deviceId,skills:[],status:'active'});
  const phones=[{id:'phone-real',alias:'真实目录结构手机',nodes:[]}];
  const connect={listBindings:()=>bindings,listDevices:async()=>phones,listRuns:()=>[],bindVerified:(_workspace,input)=>{let binding=bindings.find(item=>item.employeeId===input.employeeId);if(!binding){binding={id:'binding-existing'};bindings.push(binding);}Object.assign(binding,input);return binding;}};
  const phone=createPhoneMcpService(repo,connect,management,{memory:true});const skill=repo.listSkills(slug).find(item=>item.catalog_id==='ziwei-phone-control');repo.setSkillInstalled(skill.id,true);
  const f=fixture({workspace:slug,employee,bot:null,api:{employees:async()=>({employees:repo.listEmployees(slug)}),phoneMcpSetup:()=>phone.setup(slug),phoneMcpStatus:()=>phone.status(slug,employee.id),savePhoneMcp:(_ws,_id,body)=>phone.save(slug,employee.id,body),devices:async()=>({devices:repo.listDevices(slug)})}});
  await f.settings.load();await tick();edit(f,'phone.phoneDeviceId','phone-real');edit(f,'phone.enabled','',true);assert.equal(await f.settings.submitPhone(),true);
  assert.equal(phone.configuration(slug,employee.id).enabled,true);assert.equal(management.employee(slug,employee.id).target_device_id,deviceId);assert.equal(repo.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,0);
  edit(f,'phone.enabled','',false);assert.equal(await f.settings.submitPhone(),true);assert.equal(phone.configuration(slug,employee.id).enabled,false);assert.equal(repo.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,0);
});

test('same-employee polling cannot roll a successful model save back to an old Bot snapshot', async()=>{
  const stale=deferred(),post=deferred(),posted=deferred();let reads=0,hold=false;
  const f=fixture({api:{bot:async()=>{reads++;return hold?stale.promise:copy(f.bot);},updateBot:async(_ws,_id,body)=>{posted.resolve(copy(body));await post.promise;return {...f.bot,revision:5,config:copy(body.config),employee:{...f.bot.employee,model_id:body.employee.model}};}}});
  await f.settings.load();hold=true;const reading=f.settings.load();await tick();const old=copy(f.bot);edit(f,'model','newer-model');
  const saving=f.settings.submit();await posted.promise;const before=reads;await f.settings.load();assert.equal(reads,before,'polling during a write must not request another mutable snapshot');
  post.resolve();await saving;assert.equal(f.state.botSettings.bot.revision,5);assert.equal(f.state.botSettings.draft.employee.model,'newer-model');
  stale.resolve(old);await reading;assert.equal(f.state.botSettings.bot.revision,5);assert.equal(f.state.botSettings.draft.employee.model,'newer-model');assert.equal(f.state.botSettings.dirty,false);
});

test('same-employee phone status and setup snapshots cannot undo a newly accepted phone setting', async()=>{
  const stale=deferred(),post=deferred(),posted=deferred();let hold=false,held=false,reads=0;
  let cfg={employee_id:'one',workspace:'workspace-one',enabled:false,phone_device_id:'phone-one',binding:{accountId:'keep-account',accountLabel:'保留账号'}};
  const f=fixture({api:{phoneMcpSetup:async()=>({workspace:'workspace-one',phones:[{id:'phone-one'}],employees:[]}),phoneMcpStatus:async()=>{reads++;if(hold&&!held){held=true;return stale.promise;}return {configuration:copy(cfg),receipt:{status:'never_run'}};},savePhoneMcp:async(_ws,_id,body)=>{posted.resolve();await post.promise;cfg={...cfg,enabled:body.enabled};return {configuration:copy(cfg)};}}});
  await f.settings.load();await tick();hold=true;await f.settings.load();await tick();const old=copy(cfg);edit(f,'phone.enabled','',true);
  const saving=f.settings.submitPhone();await posted.promise;const before=reads;await f.settings.load();assert.equal(reads,before);
  post.resolve();await saving;await tick();assert.equal(f.state.botSettings.phoneStatus.configuration.enabled,true);
  stale.resolve({configuration:old,receipt:{status:'never_run'}});await tick();assert.equal(f.state.botSettings.phoneStatus.configuration.enabled,true);assert.equal(f.state.botSettings.phoneDraft.enabled,true);
});

test('leaving a model save and returning retains its intent as unknown until readback, without resending', async()=>{
  const post=deferred(),posted=deferred();let writes=0;
  const f=fixture({api:{updateBot:async(_ws,_id,body)=>{writes++;posted.resolve();await post.promise;const next={...f.bot,revision:5,config:copy(body.config),employee:{...f.bot.employee,...body.employee,model_id:body.employee.model}};delete next.employee.model;f.setBot(next);return copy(next);}}});
  await f.settings.load();edit(f,'model','pending-model');const saving=f.settings.submit();await posted.promise;const pending=copy(f.state.botSettings.pending);
  f.leave();f.enter();await f.settings.load();assert.equal(f.state.botSettings.saving,false);assert.equal(f.state.botSettings.writeUnknown,true);assert.deepEqual(f.state.botSettings.pending,pending);assert.equal(f.state.botSettings.draft.employee.model,'pending-model');assert.equal(writes,1);
  post.resolve();await saving;assert.equal(f.state.botSettings.writeUnknown,true,'a response from the departed visit cannot unlock this visit');
  await f.settings.load();assert.equal(f.state.botSettings.writeUnknown,false);assert.equal(f.state.botSettings.draft.employee.model,'pending-model');assert.equal(writes,1);
});

test('leaving a phone save and returning clears the spinner but keeps unknown phone intent until readback', async()=>{
  const post=deferred(),posted=deferred();let writes=0;
  let cfg={employee_id:'one',workspace:'workspace-one',enabled:false,phone_device_id:'phone-one',binding:{accountId:'account',accountLabel:'账号'}};
  const f=fixture({api:{phoneMcpSetup:async()=>({phones:[{id:'phone-one'}]}),phoneMcpStatus:async()=>({configuration:copy(cfg),receipt:{status:'never_run'}}),savePhoneMcp:async(_ws,_id,body)=>{writes++;posted.resolve();await post.promise;cfg={...cfg,enabled:body.enabled};return {configuration:copy(cfg)};}}});
  await f.settings.load();await tick();edit(f,'phone.enabled','',true);const saving=f.settings.submitPhone();await posted.promise;const pending=copy(f.state.botSettings.phonePending);
  f.leave();f.enter();await f.settings.load();await tick();assert.equal(f.state.botSettings.phoneSaving,false);assert.equal(f.state.botSettings.phoneUnknown,true);assert.deepEqual(f.state.botSettings.phonePending,pending);assert.equal(writes,1);
  post.resolve();await saving;assert.equal(f.state.botSettings.phoneUnknown,true);await f.settings.load();await tick();assert.equal(f.state.botSettings.phoneUnknown,false);assert.equal(f.state.botSettings.phoneDraft.enabled,true);assert.equal(writes,1);
});

test('unknown phone configuration stays disabled until the original enabled state and account are read', async()=>{
  const status=deferred(),setup=deferred(),writes=[];let ready=false;
  let remote={employee_id:'one',workspace:'workspace-one',enabled:true,phone_device_id:'phone-one',binding:{accountId:'original-account',accountLabel:'原账号'}};
  const directory=()=>({workspace:'workspace-one',phones:[{id:'phone-one'}],employees:[]});
  const f=fixture({api:{phoneMcpSetup:()=>ready?directory():setup.promise,phoneMcpStatus:()=>ready?{configuration:copy(remote),receipt:{status:'never_run'}}:status.promise,savePhoneMcp:async(_ws,_id,body)=>{writes.push(copy(body));remote={...remote,enabled:body.enabled};return {configuration:copy(remote)};}}});
  await f.settings.load();await tick();
  const phoneForm=renderBotSettings(f.state).split('data-form="bot-phone-mcp"')[1].split('</form>')[0];assert.match(phoneForm,/<fieldset disabled/);
  assert.equal(f.state.botSettings.phoneConfigurationRead,false);
  edit(f,'phone.accountId','');edit(f,'phone.enabled','',false);
  const unchecked=new FormData();unchecked.set('bot.phone.form','1');
  assert.equal(await f.settings.submitPhone(unchecked),false);assert.equal(writes.length,0);assert.equal(remote.enabled,true);assert.match(f.state.botSettings.errors.phoneSave,/原手机控制配置尚未读取成功/);
  ready=true;setup.resolve(directory());status.resolve({configuration:copy(remote),receipt:{status:'never_run'}});await tick();
  assert.equal(f.state.botSettings.phoneConfigurationRead,true);assert.equal(f.state.botSettings.phoneDraft.enabled,true);assert.equal(f.state.botSettings.phoneDraft.accountId,'original-account');
  assert.equal(await f.settings.submitPhone(unchecked),true);assert.equal(writes.length,1);assert.equal(writes[0].enabled,false);assert.equal(writes[0].accountId,'original-account');assert.equal(writes[0].accountLabel,'原账号');
});

test('failed phone status plus a directory without original configuration cannot disable an enabled employee', async()=>{
  let writes=0;const original={enabled:true,accountId:'keep-account'};
  const f=fixture({api:{phoneMcpSetup:async()=>({workspace:'workspace-one',phones:[{id:'phone-one'}],employees:[]}),phoneMcpStatus:async()=>{throw Object.assign(new Error('手机控制状态服务暂时不可用'),{status:503});},savePhoneMcp:async()=>{writes++;original.enabled=false;return {};}}});
  await f.settings.load();await tick();
  const data=new FormData();data.set('bot.phone.form','1');data.set('bot.phone.accountId','');
  assert.equal(await f.settings.submitPhone(data),false);assert.equal(writes,0);assert.equal(original.enabled,true);assert.equal(original.accountId,'keep-account');assert.equal(f.state.botSettings.phoneConfigurationRead,false);
  assert.match(f.state.botSettings.errors.phoneStatus,/服务暂时不可用/);const html=renderBotSettings(f.state).split('data-form="bot-phone-mcp"')[1].split('</form>')[0];assert.match(html,/<fieldset disabled/);
});

test('a successful setup configuration is sufficient knowledge even if the separate status read fails', async()=>{
  const cfg={employee_id:'one',workspace:'workspace-one',enabled:true,phone_device_id:'phone-one',binding:{accountId:'from-setup',accountLabel:'已有账号'}};const writes=[];
  const f=fixture({api:{phoneMcpSetup:async()=>({workspace:'workspace-one',phones:[{id:'phone-one'}],employees:[{id:'one',phone_mcp:cfg}]}),phoneMcpStatus:async()=>{throw Object.assign(new Error('状态503'),{status:503});},savePhoneMcp:async(_ws,_id,body)=>{writes.push(copy(body));return {configuration:{...cfg,enabled:body.enabled}};}}});
  await f.settings.load();await tick();assert.equal(f.state.botSettings.phoneConfigurationRead,true);assert.equal(f.state.botSettings.phoneDraft.enabled,true);
  edit(f,'phone.enabled','',false);assert.equal(await f.settings.submitPhone(),true);assert.equal(writes.length,1);assert.equal(writes[0].accountId,'from-setup');
});
