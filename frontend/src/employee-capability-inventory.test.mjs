import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmployeeCapabilityInventory,inventorySections,inventoryLayerRows,inventoryReason} from './employee-capability-inventory.js';
const subject=(id='employee_a',workspace='one')=>({workspace,employeeId:id,deviceId:'pc',runtime:'Hermes',profile:'bot-a',revision:2,controlEpoch:3});
const inventory=(s=subject(),patch={})=>({schemaVersion:1,subject:s,checkedAt:'2026-10-26T00:00:00Z',source:'device_inventory',sections:{skills:{status:'ready',items:[{id:'s',name:'Safe skill',configuration:'configured',visibility:'visible',assigned:'assigned',enabled:'enabled',onDemand:'available',loaded:'unknown'}]},mcp:{status:'unknown',reason:'DEVICE_OFFLINE',items:[]},cli:{status:'ready',items:[]}},pending:false,stale:false,...patch});
const deferred=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};

test('AI reports appear in the correct tool group without fabricating installation, authorization or loading',()=>{
 const value=inventory(subject(),{reported:[{kind:'cli',id:'new-cli',name:'New CLI',source:'agent_reported',status:'working',verified:false,stale:false,reportedAt:'2026-10-28T01:00:00Z'}]});
 const cli=inventorySections(value).find(section=>section.key==='cli'),item=cli.items[0];
 assert.equal(item.name,'New CLI');assert.equal(item.source,'agent_reported');assert.equal(item.reportedStatus,'working');
 for(const layer of inventoryLayerRows(item))assert.equal(layer.state,'unknown');
});
test('inventory is lazy and reads only the selected employee once per visit',async()=>{const calls=[];const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async(w,id)=>{calls.push([w,id]);return inventory(subject(id,w));}}});await ui.select(subject(),{active:false});assert.equal(calls.length,0);await ui.select(subject(),{active:true});await ui.select(subject(),{active:true});assert.deepEqual(calls,[['one','employee_a']]);});
test('late employee and workspace responses cannot replace current inventory',async()=>{const pending=deferred();const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async(w,id)=>id==='employee_a'?pending.promise:inventory(subject(id,w))}});const old=ui.select(subject(),{active:true});await ui.select(subject('employee_b','two'),{active:true});pending.resolve(inventory());await old;assert.equal(ui.state.value.subject.employeeId,'employee_b');assert.equal(ui.state.value.subject.workspace,'two');});
test('bound inventory rejects another device or profile without presenting an empty result',async()=>{const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>inventory({...subject(),deviceId:'other'})}});await ui.select(subject(),{active:true});assert.equal(ui.state.value,null);assert.equal(ui.state.errorCode,'CAPABILITY_INVENTORY_SCOPE_CHANGED');});
test('offline unknown and configured-only facts do not invent absence or authorization',()=>{const sections=inventorySections(inventory());assert.equal(sections[1].state,'unknown');assert.match(sections[1].empty,/尚未|未取得/);const layers=inventoryLayerRows(inventory().sections.skills.items[0]);assert.equal(layers.find(x=>x.key==='authorization').state,'unknown');assert.equal(layers.find(x=>x.key==='loaded').state,'unknown');assert.equal(layers.find(x=>x.key==='configured').state,'configured');assert(!JSON.stringify(layers).includes('已授权'));assert.equal(inventoryReason('raw secret arbitrary string'),'尚未取得可核验的明细，请检查员工配置或刷新。');});
test('refresh is read-only queued work with no model success claims and no duplicate submission',async()=>{let posts=0;const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>inventory(),refreshEmployeeCapabilityInventory:async()=>{posts++;return inventory(subject(),{pending:true});}},keyFactory:()=> 'stable'});await ui.select(subject(),{active:true});await ui.refresh();await ui.refresh();assert.equal(posts,1);assert.equal(ui.state.value.pending,true);assert.match(ui.state.notice,/已受理|等待/);});
test('unknown refresh outcome requires cached readback before another refresh',async()=>{let posts=0;const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>inventory(),refreshEmployeeCapabilityInventory:async()=>{posts++;throw Error('synthetic internal detail');}},keyFactory:()=> 'stable'});await ui.select(subject(),{active:true});await ui.refresh();await ui.refresh();assert.equal(posts,1);assert.equal(ui.state.writeUnknown,true);assert(!ui.state.error.includes('synthetic'));await ui.load();assert.equal(ui.state.writeUnknown,false);});
test('cached service shape retains explicitly historical rows without current state claims',()=>{
 const response={...inventory(),checkedAt:undefined,source:undefined,stale:true,pending:{actionId:'a',status:'pending'},snapshot:{...inventory(),source:'device_readonly',summary:{skills:1,mcp:null,cli:null}},sections:{skills:{status:'unknown',reason:'DEVICE_OFFLINE',items:[]},mcp:{status:'unknown',items:[]},cli:{status:'unknown',items:[]}},summary:{skills:0,mcp:0,cli:0}};
 const sections=inventorySections(response);assert.equal(sections[0].historical,true);assert.equal(sections[0].items.length,1);assert.equal(sections[0].count,1);assert.equal(sections[1].count,null);assert.match(inventoryLayerRows(sections[0].items[0],{historical:true})[1].text,/上次/);
});
test('unknown section summary does not turn into a zero capability claim',()=>{const sections=inventorySections({...inventory(),sections:{skills:{status:'unknown',items:[]}},summary:{skills:0,mcp:0,cli:0}});assert.equal(sections[0].count,null);assert.match(sections[0].empty,/不能据此判断/);});
test('explicit null profile binding rejects a different returned profile',async()=>{const expected={...subject(),profile:null};const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>inventory({...expected,profile:'someone-else'})}});await ui.select(expected,{active:true});assert.equal(ui.state.value,null);assert.equal(ui.state.errorCode,'CAPABILITY_INVENTORY_SCOPE_CHANGED');});
test('pending read-only refresh polls cached GET only and stops on selection or inactive view',async()=>{
 let ticks=[],reads=0,posts=0;const setTimer=fn=>{ticks.push(fn);return fn;},clearTimer=fn=>{ticks=ticks.filter(value=>value!==fn);};
 const ui=createEmployeeCapabilityInventory({setTimer,clearTimer,pollLimit:2,api:{employeeCapabilityInventory:async(w,id)=>{reads++;return inventory(subject(id,w),{pending:id==='employee_a'});},refreshEmployeeCapabilityInventory:async()=>{posts++;return inventory(subject(),{pending:true});}}});
 await ui.select(subject(),{active:true});assert.equal(ticks.length,1);await ticks.shift()();assert.equal(reads,2);assert.equal(posts,0);
 await ui.select(subject('employee_b','two'),{active:true});assert.equal(ticks.length,0);assert.equal(ui.state.value.subject.employeeId,'employee_b');
 await ui.select(subject(),{active:true});assert.equal(ticks.length,1);await ui.select(subject(),{active:false});assert.equal(ticks.length,0);ui.dispose();
});
test('pending cache polling has a finite request limit and never repeats POST',async()=>{
 const ticks=[];let gets=0;const ui=createEmployeeCapabilityInventory({pollLimit:2,setTimer:fn=>{ticks.push(fn);return fn;},clearTimer:()=>{},api:{employeeCapabilityInventory:async()=>{gets++;return inventory(subject(),{pending:true});}}});
 await ui.select(subject(),{active:true});for(let i=0;ticks.length&&i<5;i++)await ticks.shift()();assert.equal(gets,3);assert.equal(ticks.length,0);assert.match(ui.state.notice,/自动|稍后/);ui.dispose();
});
test('employee owner changes invalidate cached view and late previous-owner replies',async()=>{let reads=0;const old=deferred();const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>{reads++;return reads===1?old.promise:inventory({...subject(),ownerUserId:'owner-two'});}}});const first=ui.select({...subject(),ownerUserId:'owner-one'},{active:true});await ui.select({...subject(),ownerUserId:'owner-two'},{active:true});assert.equal(reads,2);assert.equal(ui.state.value.subject.ownerUserId,'owner-two');old.resolve(inventory({...subject(),ownerUserId:'owner-one'}));await first;assert.equal(ui.state.value.subject.ownerUserId,'owner-two');ui.dispose();});
test('historical rows from a previous owner are not displayed as current employee history',()=>{const current={...subject(),ownerUserId:'owner-two'},value={...inventory(current),stale:true,sections:{skills:{status:'unknown',items:[]}},snapshot:{...inventory({...subject(),ownerUserId:'owner-one'}),summary:{skills:1}}};const section=inventorySections(value)[0];assert.equal(section.historical,false);assert.equal(section.items.length,0);});
import {inventoryProfileLabel} from './employee-capability-inventory.js';
test('default native profile is distinct from missing runtime configuration',()=>{assert.equal(inventoryProfileLabel({runtime:'Codex',runtime_profile:null}),'默认 Profile（未显式指定）');assert.equal(inventoryProfileLabel({runtime:'Hermes',runtime_profile:'bot-original'}),'bot-original');assert.equal(inventoryProfileLabel({runtime:null,runtime_profile:null}),'运行时尚未指定');});
test('changed Vue panels compile and inventory instances are keyed by signed-in actor',async()=>{const fs=await import('node:fs');const {parse,compileScript,compileTemplate}=await import('@vue/compiler-sfc');for(const name of ['EmployeeCapabilityInventory','BotWorkbench','BotKnowledgePanel','BotMcpPanel']){const filename=new URL('./components/'+name+'.vue',import.meta.url),source=fs.readFileSync(filename,'utf8'),{descriptor,errors}=parse(source,{filename:filename.pathname});assert.deepEqual(errors,[]);const script=compileScript(descriptor,{id:'inventory-'+name}),template=compileTemplate({source:descriptor.template.content,filename:filename.pathname,id:'inventory-'+name,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);if(name==='BotWorkbench'){const instances=[...source.matchAll(/<EmployeeCapabilityInventory\b[^>]+/g)];assert.equal(instances.length,2);assert(instances.every(item=>/:key="[^"]*actorId/.test(item[0])));}}});
import {syncInventoryRosterSelection,inventoryEmployeeBindingChanged} from './employee-capability-inventory.js';
import {createBotWorkbench} from './bot-workbench.js';
test('actual roster replacement updates external owner metadata, clears cached inventory, and removes hidden selection',async()=>{
 let owner='one',visible=true,selection=null,read=0,reply=deferred();const row=()=>({id:'employee_c',workspace:'one',employee:{id:'employee_c',runtime:'Codex',runtime_profile:null,target_device_id:'pc',owner_user_id:owner}});
 const workbench=createBotWorkbench({api:{bots:async()=>({bots:visible?[row()]:[]})},onEmployeeSelect:value=>{selection=value;}});
 await workbench.setWorkspace('one','employee_c');const expected=employee=>({workspace:'one',employeeId:employee.id,ownerUserId:employee.owner_user_id,runtime:'Codex',profile:null,deviceId:'pc'});
 const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>++read===1?inventory(expected(selection.employee)):reply.promise}});await ui.select(expected(selection.employee),{active:true});assert.equal(ui.state.value.subject.ownerUserId,'one');
 owner='two';await workbench.list();selection=syncInventoryRosterSelection(selection,workbench.state.bots);assert.equal(selection.employee.owner_user_id,'two');const updating=ui.select(expected(selection.employee),{active:true});assert.equal(ui.state.value,null);reply.resolve(inventory(expected(selection.employee)));await updating;assert.equal(ui.state.value.subject.ownerUserId,'two');
 visible=false;await workbench.list();selection=syncInventoryRosterSelection(selection,workbench.state.bots);assert.equal(selection,null);await ui.select(null,{active:false});assert.equal(ui.state.value,null);ui.dispose();workbench.dispose();
});
test('Hermes binding changes are distinct from a harmless roster name refresh',()=>{const previous={id:'e',owner_user_id:'one',runtime:'Hermes',runtime_profile:'bot-e',target_device_id:'pc',visibility:'workspace',name:'old'};assert.equal(inventoryEmployeeBindingChanged(previous,{...previous,name:'new'}),false);assert.equal(inventoryEmployeeBindingChanged(previous,{...previous,owner_user_id:'two'}),true);assert.equal(inventoryEmployeeBindingChanged(previous,{...previous,runtime:'Codex'}),true);assert.equal(inventoryEmployeeBindingChanged(previous,null),true);});
test('a network read failure demotes a fresh cache to explicit historical evidence without losing rows',async()=>{let reads=0;const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>{if(++reads===1)return inventory(subject(),{summary:{skills:1,mcp:null,cli:0}});throw Error('synthetic transport detail');}}});await ui.select(subject(),{active:true});await ui.load();assert.equal(ui.state.value.status,'unknown');assert.equal(ui.state.value.stale,true);const section=inventorySections(ui.state.value)[0];assert.equal(section.historical,true);assert.equal(section.items[0].name,'Safe skill');assert.match(inventoryLayerRows(section.items[0],{historical:section.historical})[1].text,/上次/);assert(!ui.state.error.includes('synthetic'));ui.dispose();});

for(const status of [401,403,404,410])test(`a definitive refresh HTTP ${status} removes prior employee details and does not claim an ambiguous write`,async()=>{
 const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>inventory(),refreshEmployeeCapabilityInventory:async()=>{throw Object.assign(Error('INTERNAL_TOKEN_NOT_FOR_UI'),{status});}}});
 await ui.select(subject(),{active:true});assert.equal(ui.state.value.sections.skills.items.length,1);
 await ui.refresh();assert.equal(ui.state.value,null,'a revoked/hidden subject must not keep displaying the old inventory');
 assert.equal(ui.state.writeUnknown,false,'the server definitively refused this request');assert.equal(ui.state.refreshing,false);
 assert(!ui.state.error.includes('INTERNAL_TOKEN_NOT_FOR_UI'));assert(!ui.state.error.includes('结果未确认'));
 if(status===401)assert.match(ui.state.error,/登录/);ui.dispose();
});

test('a refresh response for another owner cannot retain the prior owner inventory',async()=>{
 const expected={...subject(),ownerUserId:'owner-one'};
 const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>inventory(expected),refreshEmployeeCapabilityInventory:async()=>inventory({...expected,ownerUserId:'owner-two'})}});
 await ui.select(expected,{active:true});await ui.refresh();assert.equal(ui.state.errorCode,'CAPABILITY_INVENTORY_SCOPE_CHANGED');
 assert.equal(ui.state.value,null);assert.equal(ui.state.writeUnknown,false);ui.dispose();
});

test('a late refresh success cannot restore employee details after a cached read denies authorization',async()=>{
 const late=deferred();let reads=0;
 const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>{if(++reads===1)return inventory();throw Object.assign(Error('private auth details'),{status:401});},refreshEmployeeCapabilityInventory:async()=>late.promise}});
 await ui.select(subject(),{active:true});const refreshing=ui.refresh();assert.equal(ui.state.refreshing,true);
 await ui.load();assert.equal(ui.state.value,null);assert.equal(ui.state.refreshing,false);assert.equal(ui.state.writeUnknown,false);
 late.resolve(inventory());await refreshing;assert.equal(ui.state.value,null);assert.match(ui.state.error,/登录/);ui.dispose();
});

test('a late refresh success cannot replace the next employee or new device/profile binding',async()=>{
 const late=deferred(),next={...subject('employee_b'),ownerUserId:'owner-two',deviceId:'pc-two',profile:'bot-b'};
 const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async(_workspace,id)=>inventory(id==='employee_b'?next:subject()),refreshEmployeeCapabilityInventory:async()=>late.promise}});
 await ui.select(subject(),{active:true});const refreshing=ui.refresh();await ui.select(next,{active:true});
 late.resolve(inventory());await refreshing;assert.deepEqual(ui.state.value.subject,next);assert.equal(ui.state.refreshing,false);ui.dispose();
});

test('a denied pending-cache read clears its polling timer without dispatching work',async()=>{
 const timers=new Set();let reads=0,posts=0;
 const ui=createEmployeeCapabilityInventory({setTimer:fn=>{timers.add(fn);return fn;},clearTimer:fn=>timers.delete(fn),api:{employeeCapabilityInventory:async()=>{if(++reads===1)return inventory(subject(),{pending:true});throw Object.assign(Error('revoked'),{status:410});},refreshEmployeeCapabilityInventory:async()=>posts++}});
 await ui.select(subject(),{active:true});assert.equal(timers.size,1);await ui.load();
 assert.equal(timers.size,0);assert.equal(ui.state.value,null);assert.equal(posts,0);ui.dispose();
});

for(const status of [409,422])test(`refresh HTTP ${status} still requires readback before another POST`,async()=>{
 let posts=0;const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>inventory(),refreshEmployeeCapabilityInventory:async()=>{posts++;throw Object.assign(Error('unconfirmed'),{status});}}});
 await ui.select(subject(),{active:true});await ui.refresh();await ui.refresh();assert.equal(posts,1);assert.equal(ui.state.writeUnknown,true);
 await ui.load();assert.equal(ui.state.writeUnknown,false);ui.dispose();
});

test('a known non-Hermes configuration change reloads a previously loaded identical identity',async()=>{
 const selected={...subject('employee_codex'),runtime:'Codex',profile:null};let reads=0;
 const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>inventory(selected,{source:'device_readonly',checkedAt:`read-${++reads}`})}});
 await ui.select(selected,{active:true,configurationKey:'known-config-one'});await ui.select(selected,{active:true,configurationKey:'known-config-two'});
 assert.equal(reads,2);assert.equal(ui.state.value.checkedAt,'read-2');ui.dispose();
});

test('a deferred inventory reply cannot cross a known non-Hermes configuration change',async()=>{
 const selected={...subject('employee_codex'),runtime:'Codex',profile:null},old=deferred();let reads=0;
 const ui=createEmployeeCapabilityInventory({api:{employeeCapabilityInventory:async()=>++reads===1?old.promise:inventory(selected,{checkedAt:'current-config'})}});
 const pending=ui.select(selected,{active:true,configurationKey:'actual-loaded-old-config'});
 await ui.select(selected,{active:true,configurationKey:'actual-loaded-new-config'});
 old.resolve(inventory(selected,{checkedAt:'late-old-config',configFingerprint:'cannot-self-assert-current'}));await pending;
 assert.equal(reads,2);assert.equal(ui.state.value.checkedAt,'current-config');ui.dispose();
});

test('known public employee configuration has a stable key without using response snapshot claims',async()=>{
 const {inventoryEmployeeConfigurationKey:key}=await import('./employee-capability-inventory.js');assert.equal(typeof key,'function');
 const current={id:'employee_codex',runtime:'Codex',skills:['b','a'],management_mcp_enabled:true,model_id:'model-one',status:'active',default_working_directory:'D:/private/work',default_working_directory_device_id:'pc'};
 const initial=key(current);assert.equal(key({...current,name:'harmless renamed',skills:['a','b']}),initial);
 for(const change of [{skills:['a']},{management_mcp_enabled:false},{model_id:'model-two'},{status:'paused'},{default_working_directory:'D:/other'},{default_working_directory_device_id:'pc-two'}])assert.notEqual(key({...current,...change}),initial,JSON.stringify(change));
});

test('the actual inventory component watches loaded non-Hermes configuration and reloads its cache',async()=>{
 const fs=await import('node:fs/promises'),vue=await import('vue'),compiler=await import('@vue/compiler-sfc');
 const file=new URL('./components/EmployeeCapabilityInventory.vue',import.meta.url),{descriptor}=compiler.parse(await fs.readFile(file,'utf8'));
 const compiled=compiler.compileScript(descriptor,{id:'inventory-config-watch'});let reads=0;const cleanup=[];
 const props=vue.reactive({workspace:'one',active:true,employee:{id:'employee_codex',runtime:'Codex',runtime_profile:null,target_device_id:'pc',owner_user_id:'owner',skills:['one'],model_id:'old',status:'active'}});
 const fakeApi={employeeCapabilityInventory:async()=>{reads++;return inventory({workspace:'one',employeeId:props.employee.id,ownerUserId:'owner',deviceId:'pc',runtime:'Codex',profile:null});}};
 const bindings={};let code=compiled.content;
 for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
  const spec=match[2];let value;
  if(spec==='vue')value={...vue,onBeforeUnmount:fn=>cleanup.push(fn)};
  else if(spec==='lucide-vue-next')value=new Proxy({},{get:()=>({})});
  else if(spec==='../api.js')value={api:fakeApi};
  else value=await import(new URL(spec,file).href);
  for(const token of match[1].slice(1,-1).split(',')){const [name,alias]=token.trim().split(/\s+as\s+/);bindings[alias||name]=value[name];}
  code=code.replace(match[0],'');
 }
 const component=new Function(...Object.keys(bindings),code.replace('export default','return'))(...Object.values(bindings));
 const instance=component.setup(props,{expose(){},emit(){}});
 try{await new Promise(setImmediate);assert.equal(reads,1);props.employee={...props.employee,skills:['two'],model_id:'new'};
  await vue.nextTick();await new Promise(setImmediate);assert.equal(reads,2);assert.equal(instance.s.value.subject.employeeId,'employee_codex');
 }finally{cleanup.forEach(fn=>fn());}
});
