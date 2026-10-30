import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/dsh-native-operations.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const subject={workspace:'test',workspaceId:'ws',employeeId:'employee',deviceId:'pc',runtime:'DSH',profile:'alpha'};
const action=(resource,operation,input={})=>({id:'native-action',type:'employee.dsh.operation',payload:{workspace:'test',workspaceId:'ws',deviceId:'pc',dshOperation:{schemaVersion:1,subject,scope:{kind:'bot'},resource,operation,input}}});
const copy=value=>structuredClone(value);
function fixture(extra={}){
 const calls=[],namespaces=[
  {ns:'agent-loop',revision:3,applies:'live',schema:{uid:1,refs:{1:{type:'object',dict:{count:2,password:3}},2:{type:'number'},3:{type:'string',meta:{role:'secret'}}}},value:{count:2},base:{count:1},user:{count:2},secrets:[{path:['password'],set:true}]},
  {ns:'llm-pi-ai',revision:5,schema:{uid:1,refs:{1:{type:'object',dict:{providers:2}},2:{type:'dict',inner:3},3:{type:'object',dict:{api:4,baseURL:4,models:5,apiKeyEnv:4,headers:6}},4:{type:'string'},5:{type:'array',inner:4},6:{type:'dict',inner:4,meta:{role:'secret'}}}},value:{providers:{custom:{api:'openai-completions',baseURL:'https://old.invalid/v1',models:[{id:'old-model'}],apiKeyEnv:'CUSTOM_API_KEY',compat:{keep:true}}}},base:{},user:{providers:{custom:{}}},secrets:[{path:['providers','custom','headers'],set:true}]},
  {ns:'agent-default-model',revision:7,schema:{uid:1,refs:{1:{type:'object',dict:{provider:2,model:2,reasoningEffort:2}},2:{type:'string'}}},value:{provider:'custom',model:'old-model',reasoningEffort:'high'},secrets:[]},
 ];
 const catalog=()=>({default:copy(namespaces[2].value),routableProviders:['custom'],groups:[{id:'custom',name:'Custom',models:[{id:'old-model',name:'Old'},{id:'new-model',name:'New'}]}],failures:[]});
 const handlers={
  'settings/describe':()=>({writable:true,hasDocument:true,namespaces:copy(namespaces)}),
  'settings/mutate':args=>{const ns=namespaces.find(n=>n.ns===args.ns);assert.equal(args.expectedRevision,ns.revision);for(const op of args.ops)for(const layer of [ns.value,ns.user??={}]){let parent=layer;for(const key of op.path.slice(0,-1))parent=parent[key]??={};if(op.op==='set')parent[op.path.at(-1)]=copy(op.value);else delete parent[op.path.at(-1)];}ns.revision++;return copy(ns);},
  'llm/listProviders':()=>[{id:'custom',name:'Custom'}],
  'llm/listConfigurableProviders':()=>[{provider:'custom',displayName:'Custom',settingsNs:'llm-pi-ai',settingsPath:['providers','custom'],declared:true}],
  'session/modelCatalog':catalog,
  'credentials/describe':()=>({CUSTOM_API_KEY:{configured:true,source:'file',writable:true}}),
  'pluginManager/listBundles':()=>[{name:'@deepseek-ai/dsh-experimental-badge-skill-bundle',enabled:true,readOnlyReason:undefined,rows:[{entryId:'entry',moduleName:'mod',rowId:'patch'}]}],
  'pluginManager/listPlugins':()=>[{entryId:'entry',moduleName:'mod',enabled:true,patchId:'patch',fiberPhase:'active'}],
  'pluginInventory/list':()=>({entries:[],agentPresets:[],managementAvailable:true}),
  'agentPresets/list':()=>({presets:[{id:'native-custom',name:'Custom'}]}),
  'pluginMarket/listIndexes':()=>[{url:'https://index.invalid/plugins.json'}],
  ...extra,
 };
 const options={workspace:'test',deviceId:'pc',baseUrl:'http://local-hub',fetchImpl:async(url,init)=>{
  calls.push({url,init});
  const rpc=init.body&&JSON.parse(init.body);
  if(rpc?.type==='client-request'){
   const handler=handlers[rpc.method];assert.ok(handler,'unexpected RPC '+rpc.method);
   const value=await handler(rpc.payload.args);
   return Response.json({type:'server-response',rpcId:rpc.rpcId,result:{ok:true,value}});
  }
  if(extra.hub)return Response.json(await extra.hub(url,init));
  assert.equal(url,'http://local-hub/api/state');return Response.json({root:'PRIVATE_ROOT',bots:[{name:'alpha',running:true,ready:true,persona:'current persona',url:'http://private/?token=PRIVATE_TOKEN',folder:'PRIVATE_HOME',metadata:{displayName:'Alpha'}}]});
 }};
 const run=(resource,operation,input)=>{assert.equal(typeof module.executeDshNativeOperation,'function');return module.executeDshNativeOperation(action(resource,operation,input),options);};
 return{run,options,calls,namespaces,handlers};
}
test('settings mutate uses the fresh native namespace and exact revision, then verifies safe values',async()=>{
 const f=fixture(),result=await f.run('settings','mutate',{ns:'agent-loop',expectedRevision:3,ops:[{op:'set',path:['count'],value:8}]});
 assert.equal(result.status,'applied');assert.equal(result.data.namespaces.find(ns=>ns.ns==='agent-loop').value.count,8);
 assert.equal(result.subject.profile,'alpha');assert.equal(result.source,'dsh-native');
 assert.deepEqual(f.calls.map(c=>JSON.parse(c.init.body).method),['settings/describe','settings/mutate','settings/describe']);
});
test('fresh descriptors reject ordinary secret paths, unknown fields and structured secret injection before writes',async()=>{
 for(const ops of [[{op:'set',path:['password'],value:'hidden'}],[{op:'unset',path:['password']}],[{op:'set',path:[],value:{password:'hidden'}}],[{op:'set',path:['unknown'],value:4}]]){
  const f=fixture();await assert.rejects(f.run('settings','mutate',{ns:'agent-loop',expectedRevision:3,ops}));
  assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].init.body).method,'settings/describe');
 }
});
test('provider upsert edits only native represented fields and retains advanced configuration',async()=>{
 const f=fixture(),result=await f.run('providers','upsert',{provider:'custom',expectedRevision:5,api:'openai-responses',baseURL:'https://new.invalid/v1',models:[{id:'new-model'}]});
 assert.equal(result.status,'applied');assert.deepEqual(f.namespaces[1].value.providers.custom.compat,{keep:true});
 assert.equal(f.namespaces[1].value.providers.custom.apiKeyEnv,'CUSTOM_API_KEY');
 const mutation=f.calls.map(c=>c.init.body&&JSON.parse(c.init.body)).find(c=>c?.method==='settings/mutate');
 assert.deepEqual(mutation.payload.args.ops.map(op=>op.path),[['providers','custom','api'],['providers','custom','baseURL'],['providers','custom','models']]);
 assert.equal(result.data.directory[0].provider,'custom');assert.equal(result.data.credentials.CUSTOM_API_KEY.configured,true);
});
test('provider nested header values never reach ordinary mutate',async()=>{
 const f=fixture();await assert.rejects(f.run('providers','upsert',{provider:'custom',expectedRevision:5,api:'openai-responses',baseURL:'https://new.invalid',models:[{id:'new-model',headers:{Authorization:'hidden'}}]}));
 assert.equal(f.calls.some(c=>c.init.body&&JSON.parse(c.init.body).method==='settings/mutate'),false);
});
test('default model updates its real namespace and verifies the actual catalog',async()=>{
 const f=fixture(),result=await f.run('models','setDefault',{provider:'custom',model:'new-model',expectedRevision:7});
 assert.equal(result.status,'applied');assert.deepEqual(result.data.default,{provider:'custom',model:'new-model'});
 assert.equal(f.namespaces[2].value.reasoningEffort,undefined);
});
test('native ChangeResult restart, overridden and failure are preserved without reporting applied',async()=>{
 for(const application of ['restart-required','overridden','failed']){
  let enabled=true;
  const f=fixture({'pluginManager/listBundles':()=>[{name:'@deepseek-ai/dsh-experimental-badge-skill-bundle',enabled,rows:[]}],'pluginManager/setBundleEnabled':()=>{if(application!=='failed')enabled=false;return{changed:true,application,stage:'enable',target:'@deepseek-ai/dsh-experimental-badge-skill-bundle',enabled:false,...(application==='failed'?{error:{code:'operation-error',diagnostic:'token=hidden'}}:{restartReason:'host-module'})};}});
  const result=await f.run('plugins','setBundleEnabled',{name:'@deepseek-ai/dsh-experimental-badge-skill-bundle',enabled:false});
  assert.equal(result.status,application);assert.equal(result.data.receipt.application,application);assert.doesNotMatch(JSON.stringify(result),/token=hidden/);
 }
});
test('state refresh reports partial resources and never publishes Bot tokens or private paths',async()=>{
 const f=fixture({'agentPresets/list':()=>{throw Error('private diagnostic');}}),result=await f.run('state','refresh');
 assert.equal(result.data.resources.settings.status,'observed');assert.equal(result.data.resources.presets.status,'unavailable');
 assert.equal(result.data.resources.bot.data.name,'alpha');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TOKEN|PRIVATE_HOME|PRIVATE_ROOT|private diagnostic/);
});
test('unsupported operations and mismatched subjects are refused without network access',async()=>{
 const f=fixture();await assert.rejects(f.run('commands','execute',{}),{code:'DSH_NATIVE_OPERATION_UNSUPPORTED'});
 await assert.rejects(module.executeDshNativeOperation({...action('settings','describe'),payload:{...action('settings','describe').payload,deviceId:'other'}},f.options));
 assert.equal(f.calls.length,0);
});
test('auxiliary results never replace canonical observations and market snapshots keep indexes context',async()=>{
 const f=fixture({'pluginManager/registries':()=>({registry:null,fallbackRegistries:[],resolved:'https://registry.invalid'}),'pluginManager/inspect':()=>({status:'accepted',name:'package',kind:'registry',bundle:true,registry:null}),'pluginMarket/search':args=>({...args,entries:[],total:0,nextOffset:null,fetchedAt:1}),'agentPresets/read':args=>({agentPreset:args.agentPreset,content:'native preset'})});
 for(const [resource,operation,input]of [['plugins','registries',{}],['plugins','inspectSource',{spec:'package'}],['market','search',{url:'https://index.invalid',query:{sort:{kind:'index'},offset:0,limit:20}}],['presets','read',{agentPreset:'native-custom'}]]){
  const result=await f.run(resource,operation,input);assert.equal(result.observations,undefined);
 }
 const list=await f.run('plugins','list');assert.equal(list.observations.plugins.data.plugins[0].patchId,'patch');
 const market=await f.run('market','listIndexes');assert.equal(market.observations.market.data.indexes[0].url,'https://index.invalid/plugins.json');
 const refresh=await f.run('state','refresh',{resources:['market']});assert.equal(refresh.data.resources.market.data.indexes.length,1);
});
test('provider removal uses its native directory, preserves credentials and removes only user-owned configuration',async()=>{
 const f=fixture(),result=await f.run('providers','remove',{provider:'custom',expectedRevision:5});
 assert.equal(result.status,'applied');assert.equal(f.namespaces[1].value.providers.custom,undefined);
 assert.equal(f.calls.some(c=>c.init.body&&JSON.parse(c.init.body).method.startsWith('credentials/')&&JSON.parse(c.init.body).method!=='credentials/describe'),false);
 const base=fixture();base.namespaces[1].base.providers={custom:{api:'native'}};
 const refused=await base.run('providers','remove',{provider:'custom',expectedRevision:5});
 assert.equal(refused.status,'failed');assert.equal(refused.data.error.code,'DSH_NATIVE_PROVIDER_NOT_REMOVABLE');
});
test('new providers use field-level native writes without replacing secret-bearing configuration containers',async()=>{
 const f=fixture(),result=await f.run('providers','upsert',{provider:'new-provider',expectedRevision:5,api:'openai-completions',baseURL:'https://new.invalid/v1',models:[{id:'new-model'}]});
 assert.equal(result.status,'applied');assert.equal(f.namespaces[1].value.providers['new-provider'].models[0].id,'new-model');
 assert.deepEqual(f.namespaces[1].value.providers.custom.compat,{keep:true});
 const mutation=f.calls.map(c=>c.init.body&&JSON.parse(c.init.body)).find(c=>c?.method==='settings/mutate');
 assert(mutation.payload.args.ops.every(op=>op.path.length===3));
});
test('stale settings revisions, schema-only secrets and missing model selections stop before mutation',async()=>{
 const f=fixture();await assert.rejects(f.run('settings','mutate',{ns:'agent-loop',expectedRevision:2,ops:[{op:'set',path:['count'],value:8}]}),{code:'settings/conflict'});
 f.namespaces[0].secrets=[];await assert.rejects(f.run('settings','mutate',{ns:'agent-loop',expectedRevision:3,ops:[{op:'set',path:['password'],value:'hidden'}]}),{code:'DSH_SECURE_INPUT_REQUIRED'});
 await assert.rejects(f.run('models','setDefault',{provider:'custom',model:'invented',expectedRevision:7}),{code:'DSH_NATIVE_MODEL_NOT_FOUND'});
 assert.equal(f.calls.some(c=>c.init.body&&JSON.parse(c.init.body).method==='settings/mutate'),false);
});
test('a lost mutation response remains unknown without replaying it',async()=>{
 const f=fixture(),transport=f.options.fetchImpl;let writes=0;
 f.options.fetchImpl=async(url,init)=>{if(init.body&&JSON.parse(init.body).method==='settings/mutate'){writes++;throw Error('token=hidden');}return transport(url,init);};
 const result=await f.run('settings','mutate',{ns:'agent-loop',expectedRevision:3,ops:[{op:'set',path:['count'],value:8}]});
 assert.equal(result.status,'unknown');assert.equal(writes,1);assert.equal(result.observations,undefined);assert.doesNotMatch(JSON.stringify(result),/token=hidden/);
});
test('explicit native rejection keeps its code and revision details without raw diagnostic text',async()=>{
 const f=fixture(),transport=f.options.fetchImpl;
 f.options.fetchImpl=async(url,init)=>{const rpc=init.body&&JSON.parse(init.body);return rpc?.method==='settings/mutate'?Response.json({type:'server-response',rpcId:rpc.rpcId,result:{ok:false,error:{code:'settings/conflict',message:'token=hidden',details:{ns:'agent-loop',expected:3,actual:4,secret:'hidden'}}}}):transport(url,init);};
 const result=await f.run('settings','mutate',{ns:'agent-loop',expectedRevision:3,ops:[{op:'set',path:['count'],value:8}]});
 assert.equal(result.status,'failed');assert.deepEqual(result.data.error,{code:'settings/conflict',details:{ns:'agent-loop',expected:3,actual:4}});assert.doesNotMatch(JSON.stringify(result),/hidden/);
});
test('Bot edits, bounded files and logs use only the bound Hub routes with real readback',async()=>{
 const bot={name:'alpha',persona:'old',metadata:{displayName:'Alpha'},running:true,ready:true};
 const f=fixture({hub:(url,init)=>{
  if(url.endsWith('/api/state'))return{bots:[bot]};
  if(url.endsWith('/persona')){assert.equal(init.method,'PUT');bot.persona=JSON.parse(init.body).persona;return{ok:true};}
  if(url.endsWith('/metadata')){Object.assign(bot.metadata,JSON.parse(init.body));return{ok:true};}
  if(url.includes('/files?'))return{ok:true,path:'reports',files:[{name:'one.md',path:'reports/one.md',size:3,isDir:false}]};
  if(url.includes('/file?'))return{ok:true,path:'reports/one.md',content:'one',size:3};
  if(url.endsWith('/log?n=30'))return{ok:true,lines:['module @deepseek-ai/dsh-experimental-badge-skill-bundle','token=hidden']};
  assert.fail(url);
 }});
 assert.equal((await f.run('bot','persona',{persona:'new'})).status,'applied');assert.equal((await f.run('bot','metadata',{displayName:'New'})).status,'applied');
 assert.equal((await f.run('files','list',{path:'reports'})).observations.files.data.path,'reports');
 assert.equal((await f.run('files','preview',{path:'reports/one.md'})).data.content,'one');
 const logs=await f.run('logs','read',{lines:30});assert.match(logs.data.lines[0],/@deepseek-ai\/dsh-experimental-badge-skill-bundle/);assert.doesNotMatch(logs.data.lines[1],/hidden/);
});
test('Routine CRUD verifies native persistence and run acceptance remains distinct from model completion',async()=>{
 const items=new Map();
 const f=fixture({hub:(url,init)=>{
  const suffix=url.split('/routines')[1];assert.notEqual(suffix,undefined);
  if(!suffix&&init.method==='GET')return{ok:true,onlineOnly:true,items:[...items.values()],warnings:[]};
  if(!suffix&&init.method==='POST'){const item={id:'r-one',...JSON.parse(init.body),history:[],lastSessionId:null,running:false};items.set(item.id,item);return{ok:true,item};}
  const id=suffix.split('/')[1],item=items.get(id);assert.ok(item);
  if(suffix.endsWith('/run')){item.running=true;return{ok:true,item};}
  if(init.method==='DELETE'){items.delete(id);return{ok:true};}
  if(init.method==='PUT')Object.assign(item,JSON.parse(init.body));return{ok:true,item};
 }});
 assert.equal((await f.run('routines','create',{title:'Routine',prompt:'requested prompt',intervalMinutes:60,enabled:true})).status,'applied');
 assert.equal((await f.run('routines','update',{id:'r-one',enabled:false})).data.item.enabled,false);
 assert.equal((await f.run('routines','get',{id:'r-one'})).data.item.id,'r-one');
 const run=await f.run('routines','run',{id:'r-one'});assert.equal(run.status,'observed');assert.equal(run.data.accepted,true);assert.equal(run.data.executionCompleted,false);assert.equal(run.data.item.lastSessionId,null);
 assert.equal((await f.run('routines','list')).data.items.length,1);assert.equal((await f.run('routines','delete',{id:'r-one'})).status,'applied');
});
test('entry toggles and bundle removal use native addresses and verify desired state from fresh runtime lists',async()=>{
 let enabled=true,installed=true;
 const f=fixture({
  'pluginManager/listBundles':()=>[{name:'bundle-a',enabled:true,installed,removable:true,rows:[{entryId:'entry',moduleName:'mod',rowId:'patch'}]}],
  'pluginManager/listPlugins':()=>[{entryId:'entry',moduleName:'mod',enabled,patchId:'patch',fiberPhase:enabled?'active':null}],
  'pluginManager/setPluginEnabled':args=>{assert.deepEqual(args,{id:'entry',enabled:false});enabled=false;return{changed:true,application:'applied',target:'entry',stage:'enable',enabled:false};},
  'pluginManager/removeBundle':args=>{assert.deepEqual(args,{name:'bundle-a'});installed=false;return{changed:true,application:'applied',target:'bundle-a',stage:'remove'};},
 });
 const toggled=await f.run('plugins','setPluginEnabled',{id:'entry',enabled:false});assert.equal(toggled.status,'applied');assert.equal(toggled.observations.plugins.data.plugins[0].fiberPhase,null);
 const removed=await f.run('plugins','removeBundle',{name:'bundle-a'});assert.equal(removed.status,'applied');assert.equal(removed.observations.plugins.data.bundles[0].installed,false);
 const blocked=fixture();await assert.rejects(blocked.run('plugins','setPluginEnabled',{id:'invented',enabled:true}),{code:'DSH_NATIVE_PLUGIN_NOT_WRITABLE'});
});
test('market index changes read back native order and model discovery uses only its registered request fields',async()=>{
 let indexes=[{url:'https://index.invalid/plugins.json'}];
 const f=fixture({
  'pluginMarket/setIndexes':args=>{assert.deepEqual(args,{urls:['https://new-index.invalid/plugins.json']});indexes=args.urls.map(url=>({url}));},
  'pluginMarket/listIndexes':()=>indexes,
  'llm/discoverModels':args=>{assert.deepEqual(args,{settingsNs:'llm-pi-ai',request:{provider:'custom',api:'openai-responses',baseURL:'https://provider.invalid/v1'}});return[{id:'discovered',name:'Discovered'}];},
 });
 const market=await f.run('market','setIndexes',{urls:['https://new-index.invalid/plugins.json']});assert.equal(market.status,'applied');assert.equal(market.observations.market.data.indexes[0].url,indexes[0].url);
 const discovered=await f.run('providers','discoverModels',{provider:'custom',api:'openai-responses',baseURL:'https://provider.invalid/v1'});assert.equal(discovered.data[0].id,'discovered');assert.equal(discovered.observations,undefined);
});
test('native restart receipts with inconsistent manifest readback remain unknown and retain both facts',async()=>{
 const f=fixture({'pluginManager/setBundleEnabled':()=>({changed:true,application:'restart-required',restartReason:'host-module',stage:'enable',target:'@deepseek-ai/dsh-experimental-badge-skill-bundle',enabled:false})});
 const result=await f.run('plugins','setBundleEnabled',{name:'@deepseek-ai/dsh-experimental-badge-skill-bundle',enabled:false});
 assert.equal(result.status,'unknown');assert.equal(result.data.receipt.application,'restart-required');assert.equal(result.data.observed.bundles[0].enabled,true);assert.equal(result.data.error.code,'DSH_NATIVE_READBACK_MISMATCH');
});
test('explicit workspace refresh reads routines files logs groups and bot session lists from native sources',async()=>{
 const f=fixture({'session/list':()=>({items:[]}),hub:(url)=>url.includes('/routines')?{ok:true,items:[],onlineOnly:true,warnings:[]}:url.includes('/files')?{path:'',files:[]}:url.includes('/log?')?{lines:['native line']}:url.endsWith('/api/groups')?{items:[{id:'g',title:'Native',members:['alpha','beta'],sessions:{},messages:[]}]}:assert.fail(url)});
 const a=action('state','refresh',{resources:['routines','files','logs','groups','sessions']});a.payload.dshOperation.groupMembers=[{employeeId:'employee',profile:'alpha'},{employeeId:'eb',profile:'beta'}];
 const result=await module.executeDshNativeOperation(a,f.options);
 assert.equal(Object.values(result.data.resources).every(row=>row.status==='observed'),true);
 assert.equal(result.data.resources.groups.data.items[0].id,'g');assert.equal(result.data.resources.logs.data.lines[0],'native line');
});
test('secure credential writes accept only native provider references and return credential status fields',async()=>{
 const f=fixture({'credentials/set':args=>{assert.deepEqual(args,{ref:'CUSTOM_API_KEY',value:'only-in-memory'});},'credentials/describe':()=>({CUSTOM_API_KEY:{configured:true,writable:true,source:'file',value:'never-return-this'}})});
 const options={...f.options,claimSecret:async()=>({value:'only-in-memory'})};
 const result=await module.executeDshNativeOperation(action('credentials','set',{ref:'CUSTOM_API_KEY',secretRequestId:'encrypted'}),options);
 assert.equal(result.status,'applied');assert.deepEqual(result.data.credentials.CUSTOM_API_KEY,{configured:true,writable:true,source:'file'});assert.doesNotMatch(JSON.stringify(result),/never-return-this|only-in-memory/);
 await assert.rejects(module.executeDshNativeOperation(action('credentials','set',{ref:'ANOTHER_UNBOUND_KEY',secretRequestId:'encrypted'}),options),{code:'DSH_NATIVE_CREDENTIAL_REF_UNKNOWN'});
});
test('finished native installs refresh the canonical plugin snapshot and retain readback failure',async()=>{
 const f=fixture(),installManager={execute:async()=>({status:'applied',data:{receipt:{application:'applied',changed:true}}})};
 const result=await module.executeDshNativeOperation(action('plugins','installBundle',{sourceActionId:'inspected',enabled:true}),{...f.options,installManager});
 assert.equal(result.status,'applied');assert.equal(result.observations.plugins.data.plugins[0].entryId,'entry');
 f.handlers['pluginInventory/list']=()=>{throw Error('raw private diagnostic');};
 const unavailable=await module.executeDshNativeOperation(action('plugins','installBundle',{sourceActionId:'inspected',enabled:true}),{...f.options,installManager});
 assert.equal(unavailable.status,'unknown');assert.equal(unavailable.data.receipt.application,'applied');assert.equal(unavailable.reasonCode,'DSH_NATIVE_INSTALL_READBACK_UNAVAILABLE');assert.equal(unavailable.observations,undefined);
});
