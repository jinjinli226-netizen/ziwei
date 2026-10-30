import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/dsh-native-provider.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const copy=value=>structuredClone(value);
const at=(value,parts)=>parts.reduce((parent,key)=>parent?.[key],value);
function merge(base,user){if(!base||typeof base!=='object'||Array.isArray(base)||!user||typeof user!=='object'||Array.isArray(user))return copy(user===undefined?base:user);const value=copy(base);for(const[key,item]of Object.entries(user))value[key]=merge(base[key],item);return value;}
function fixture(){
 const base={openai:{api:'openai-completions',baseURL:'https://native.invalid/v1',models:[{id:'builtin-model'}],compat:{keep:true}}};
 const user={openai:{api:'openai-responses',baseURL:'https://override.invalid/v1',models:[{id:'override-model'}]},providers:{custom:{api:'openai-completions',baseURL:'https://custom.invalid/v1',models:[{id:'custom-model'}],apiKeyEnv:'CUSTOM_API_KEY',compat:{supportsStore:false}}}};
 const namespace={ns:'llm-pi-ai',revision:4,base,user,value:merge(base,user),schema:{uid:1,refs:{1:{type:'object'}}},secrets:[]};
 const state={settings:{writable:true,namespaces:[namespace]},providers:[{id:'openai',name:'OpenAI'},{id:'custom',name:'Custom'}],directory:[{provider:'openai',settingsNs:'llm-pi-ai',settingsPath:['openai'],declared:false},{provider:'custom',settingsNs:'llm-pi-ai',settingsPath:['providers','custom'],declared:true}],modelCatalog:{default:{provider:'openai',model:'override-model'},groups:[],failures:[]},credentials:{CUSTOM_API_KEY:{configured:true,writable:true,source:'file'}}};
 const calls=[];
 const rpc=async(method,args)=>{
  calls.push({method,args:copy(args)});assert.equal(method,'settings/mutate');assert.equal(args.ns,namespace.ns);assert.equal(args.expectedRevision,namespace.revision);
  for(const op of args.ops){let parent=namespace.user;for(const part of op.path.slice(0,-1))parent=parent[part]??={};if(op.op==='set')parent[op.path.at(-1)]=copy(op.value);else delete parent[op.path.at(-1)];}
  namespace.revision++;namespace.value=merge(namespace.base,namespace.user);return copy(namespace);
 };
 const refreshProviders=async()=>copy(state);
 const run=(operation,input,extra={})=>{assert.equal(typeof module.updateDshNativeProvider,'function');return module.updateDshNativeProvider({operation,input,before:copy(state),rpc,refreshProviders,...extra});};
 return{run,state,namespace,calls,rpc,refreshProviders};
}
test('empty api baseURL and model overrides unset native user fields while keeping inherited effective values',async()=>{
 const f=fixture(),result=await f.run('upsert',{provider:'openai',expectedRevision:4,api:'',baseURL:null,models:null});
 assert.equal(result.status,'applied');assert.deepEqual(f.calls[0].args.ops,[{op:'unset',path:['openai','api']},{op:'unset',path:['openai','baseURL']},{op:'unset',path:['openai','models']}]);
 const ns=result.data.settings.namespaces[0];assert.equal(ns.value.openai.api,'openai-completions');assert.equal(ns.value.openai.baseURL,'https://native.invalid/v1');assert.deepEqual(ns.value.openai.models,[{id:'builtin-model'}]);
 assert.equal(at(ns.user,['openai','api']),undefined);assert.equal(at(ns.user,['openai','models']),undefined);assert.deepEqual(result.observations.providers.data,result.data);
});
test('an explicit empty model array restores native model inheritance for a nondeclared Provider',async()=>{
 const f=fixture(),result=await f.run('upsert',{provider:'openai',expectedRevision:4,models:[]});
 assert.equal(result.status,'applied');assert.deepEqual(f.calls[0].args.ops,[{op:'unset',path:['openai','models']}]);assert.equal(result.data.settings.namespaces[0].value.openai.models[0].id,'builtin-model');
});
test('omitted fields keep existing api models credential references and advanced fields',async()=>{
 const f=fixture(),result=await f.run('upsert',{provider:'custom',expectedRevision:4,baseURL:'https://new.invalid/v1'});
 assert.equal(result.status,'applied');assert.deepEqual(f.calls[0].args.ops,[{op:'set',path:['providers','custom','baseURL'],value:'https://new.invalid/v1'}]);
 const saved=result.data.settings.namespaces[0].value.providers.custom;assert.equal(saved.api,'openai-completions');assert.deepEqual(saved.models,[{id:'custom-model'}]);assert.equal(saved.apiKeyEnv,'CUSTOM_API_KEY');assert.deepEqual(saved.compat,{supportsStore:false});
 const unchanged=fixture();assert.equal((await unchanged.run('upsert',{provider:'custom',expectedRevision:4})).status,'observed');assert.equal(unchanged.calls.length,0);
});
test('declared custom Providers cannot clear models but can omit them while editing another field',async()=>{
 for(const models of [null,[]]){const f=fixture(),result=await f.run('upsert',{provider:'custom',expectedRevision:4,models});assert.equal(result.status,'failed');assert.equal(f.calls.length,0);}
 const f=fixture();assert.equal((await f.run('upsert',{provider:'custom',expectedRevision:4,baseURL:'https://new.invalid'})).status,'applied');
});
test('new custom Providers require nonempty api baseURL and model definitions',async()=>{
 for(const fields of [{},{api:'openai-completions'},{api:'openai-completions',baseURL:'https://new.invalid'},{api:'openai-completions',baseURL:'https://new.invalid',models:[]}]){
  const f=fixture(),result=await f.run('upsert',{provider:'new-custom',expectedRevision:4,...fields});assert.equal(result.status,'failed');assert.equal(f.calls.length,0);
 }
 const f=fixture(),result=await f.run('upsert',{provider:'new-custom',expectedRevision:4,api:'openai-responses',baseURL:'https://new.invalid/v1',models:[{id:'new-model'}]});
 assert.equal(result.status,'applied');assert.equal(result.data.settings.namespaces[0].value.providers['new-custom'].models[0].id,'new-model');assert.equal(f.calls[0].args.ops.every(op=>op.path.length===3),true);
});
test('remove only unsets a user-owned custom Provider and preserves credential state',async()=>{
 const f=fixture(),result=await f.run('remove',{provider:'custom',expectedRevision:4});assert.equal(result.status,'applied');assert.deepEqual(f.calls[0].args.ops,[{op:'unset',path:['providers','custom']}]);assert.equal(result.data.settings.namespaces[0].value.providers?.custom,undefined);assert.equal(result.data.credentials.CUSTOM_API_KEY.configured,true);
 const native=fixture(),refused=await native.run('remove',{provider:'openai',expectedRevision:4});assert.equal(refused.status,'failed');assert.equal(native.calls.length,0);
});
test('native revision conflict remains unknown with exact code and details and no retry',async()=>{
 const f=fixture();let calls=0;const result=await f.run('upsert',{provider:'custom',expectedRevision:4,baseURL:'https://new.invalid'},{rpc:async()=>{calls++;throw Object.assign(Error('PRIVATE_DIAGNOSTIC'),{code:'settings/conflict',details:{ns:'llm-pi-ai',expected:4,actual:5}});}});
 assert.equal(result.status,'unknown');assert.equal(result.data.error.code,'settings/conflict');assert.deepEqual(result.data.error.details,{ns:'llm-pi-ai',expected:4,actual:5});assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DIAGNOSTIC/);
 const stale=fixture(),early=await stale.run('upsert',{provider:'custom',expectedRevision:3,baseURL:'https://new.invalid'});assert.equal(early.status,'unknown');assert.equal(early.data.error.code,'settings/conflict');assert.equal(stale.calls.length,0);
});
test('an accepted write followed by failed readback reports partial unknown without undoing or replaying it',async()=>{
 const f=fixture(),result=await f.run('upsert',{provider:'custom',expectedRevision:4,baseURL:'https://new.invalid'},{refreshProviders:async()=>{throw Error('PRIVATE_DIAGNOSTIC');}});
 assert.equal(result.status,'unknown');assert.equal(result.data.writeAccepted,true);assert.equal(f.calls.length,1);assert.equal(f.namespace.value.providers.custom.baseURL,'https://new.invalid');assert.equal(result.observations,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DIAGNOSTIC/);
});
test('unset confirmation checks the native user layer and cannot be faked by an inherited effective value',async()=>{
 const f=fixture(),result=await f.run('upsert',{provider:'openai',expectedRevision:4,models:null},{refreshProviders:async()=>{const state=copy(f.state);state.settings.namespaces[0].user.openai.models=[{id:'still-overridden'}];return state;}});
 assert.equal(result.status,'unknown');assert.equal(result.data.settings.namespaces[0].value.openai.models[0].id,'builtin-model');
});
test('built-in key-only namespaces and nested secret values never use ordinary Provider mutation',async()=>{
 const f=fixture();f.state.directory.push({provider:'native-account',settingsNs:'llm-deepseek-account',settingsPath:[],declared:false});
 const builtin=await f.run('upsert',{provider:'native-account',expectedRevision:4,baseURL:'https://new.invalid'});assert.equal(builtin.status,'failed');assert.equal(f.calls.length,0);
 const secret=await f.run('upsert',{provider:'custom',expectedRevision:4,models:[{id:'model',headers:{Authorization:'hidden'}}]});assert.equal(secret.status,'failed');assert.equal(secret.data.error.code,'DSH_SECURE_INPUT_REQUIRED');assert.equal(f.calls.length,0);
});
