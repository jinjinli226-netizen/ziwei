import test from 'node:test';
import assert from 'node:assert/strict';
const contract=await import('../src/dsh-native-contract.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});

test('DSH native registry exposes fixed typed operations and honest implementation boundaries',()=>{
 assert.equal(typeof contract.getDshNativeOperation,'function');
 assert.equal(contract.getDshNativeOperation('settings','mutate').implemented,true);
 assert.equal(contract.getDshNativeOperation('groups','send').implemented,true);
 assert.equal(contract.getDshNativeOperation('plugins','prepareUiHost').implemented,true);
 assert.deepEqual(contract.normalizeDshNativeInput('plugins','prepareUiHost',{}),{});
 assert.equal(contract.getDshNativeOperation('commands','execute'),null);
 assert.equal(contract.getDshNativeOperation('settings','describe').readOnly,true);
 assert.equal(contract.getDshNativeOperation('settings','mutate').readOnly,false);
});
test('DSH native inputs preserve public identifiers and reject arbitrary transport and RPC fields',()=>{
 const id='@deepseek-ai/dsh-experimental-badge-skill-bundle';
 assert.deepEqual(contract.normalizeDshNativeInput('plugins','setBundleEnabled',{name:id,enabled:true}),{name:id,enabled:true});
 for(const input of [{name:id,enabled:true,baseUrl:'http://other.invalid'},{name:id,enabled:'true'},{method:'credentials/set'}])assert.throws(()=>contract.normalizeDshNativeInput('plugins','setBundleEnabled',input),{code:'DSH_NATIVE_INPUT_INVALID'});
 assert.throws(()=>contract.normalizeDshNativeInput('files','preview',{path:'../home/.credentials.yaml'}),{code:'DSH_NATIVE_INPUT_INVALID'});
 assert.throws(()=>contract.normalizeDshNativeInput('providers','discoverModels',{apiKey:'never-in-action'}),{code:'DSH_NATIVE_INPUT_INVALID'});
});
test('settings accept exact revision and dirty set/unset operations, while direct credential RPC remains unsupported',()=>{
 const input={ns:'agent-loop',expectedRevision:7,ops:[{op:'set',path:['maxParallelToolCalls'],value:4},{op:'unset',path:['optional']} ]};
 assert.deepEqual(contract.normalizeDshNativeInput('settings','mutate',input),input);
 assert.throws(()=>contract.normalizeDshNativeInput('settings','mutate',{...input,ops:[{op:'remove',path:['field']}]}),{code:'DSH_NATIVE_INPUT_INVALID'});
 assert.throws(()=>contract.normalizeDshNativeInput('settings','mutate',{...input,expectedRevision:'7'}),{code:'DSH_NATIVE_INPUT_INVALID'});
 assert.throws(()=>contract.normalizeDshNativeInput('credentials','set',{ref:'API_KEY',value:'not-in-action'}),{code:'DSH_NATIVE_INPUT_INVALID'});
});
test('provider editing preserves omitted fields and accepts explicit native inheritance',()=>{
 for(const values of [{},{api:'',baseURL:null,models:[]},{api:null,baseURL:'',models:null}]){
  const input={provider:'custom',expectedRevision:7,...values};
  assert.deepEqual(contract.normalizeDshNativeInput('providers','upsert',input),input);
 }
});
test('long native install waits retain their full execution and result-upload budgets',async()=>{
 const {actionExecutionTimeoutMs,actionExecutionLeaseMs}=await import('../src/action-execution-budget.mjs');
 for(const operation of ['installBundle','waitForInstall']){
  const action={type:contract.DSH_NATIVE_TYPE,payload:{dshOperation:{resource:'plugins',operation}}};
  assert.equal(actionExecutionTimeoutMs(action),900000);assert.equal(actionExecutionLeaseMs(action),960000);
 }
});
test('native market filters refresh and declared sorting retain their strict request shapes',()=>{
 for(const sort of [{kind:'index'},{kind:'relevance'},{kind:'published',direction:'desc'},{kind:'key',id:'downloads',direction:'asc'}]){
  const input={url:'https://market.invalid/index.json',query:{text:'',category:'tools',labels:['local'],sort,offset:0,limit:20,refresh:true,fetchedAt:1}};
  assert.deepEqual(contract.normalizeDshNativeInput('market','search',input),input);
 }
 for(const sort of [{kind:'published'},{kind:'key',id:'downloads',direction:'sideways'},{kind:'index',direction:'asc'}])assert.throws(()=>contract.normalizeDshNativeInput('market','search',{url:'https://market.invalid',query:{sort,offset:0,limit:20}}),{code:'DSH_NATIVE_INPUT_INVALID'});
});
test('source credentials are rejected before ordinary actions or installation journals can store them',()=>{
 for(const spec of ['https://user:PRIVATE@github.com/team/repo.git','git+https://PRIVATE@github.com/team/repo.git','ssh://git:PRIVATE@host.invalid/project','https://host.invalid/repo.git?token=PRIVATE'])assert.throws(()=>contract.normalizeDshNativeInput('plugins','inspectSource',{spec}),{code:'DSH_SECURE_INPUT_REQUIRED'});
 for(const input of [{spec:'safe-package',registry:'https://PRIVATE@registry.invalid'},{spec:'safe-package',registry:'https://registry.invalid?apiKey=PRIVATE'}])assert.throws(()=>contract.normalizeDshNativeInput('plugins','inspectSource',input),{code:'DSH_SECURE_INPUT_REQUIRED'});
 const spec='ssh://git@github.com/team/repo.git';assert.equal(contract.normalizeDshNativeInput('plugins','inspectSource',{spec}).spec,spec);
 assert.throws(()=>contract.normalizeDshNativeInput('providers','discoverModelsSecure',{secretRequestId:'encrypted',baseURL:'https://provider.invalid?api_key=PRIVATE'}),{code:'DSH_SECURE_INPUT_REQUIRED'});
});
test('group attachments use typed inline data and cannot select native paths or remote URLs',()=>{
 const input={groupId:'group',content:'',attachments:[{name:'picture.png',mimeType:'image/png',contentBase64:'fixture-data'}]};
 assert.deepEqual(contract.normalizeDshNativeInput('groups','send',input),input);
 for(const attachment of [{name:'picture.png',mimeType:'image/png',path:'D:/other/file.png'},{name:'picture.png',mimeType:'image/png',url:'https://elsewhere.invalid/image.png'},{...input.attachments[0],mimeType:'application/exe'}])assert.throws(()=>contract.normalizeDshNativeInput('groups','send',{...input,attachments:[attachment]}),{code:'DSH_NATIVE_INPUT_INVALID'});
});
