import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {actionExecutionTimeoutMs,actionExecutionLeaseMs} from '../src/action-execution-budget.mjs';
import {executeDshPlugins} from '../src/dsh-plugins.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';

const subject={workspace:'test',workspaceId:'ws',employeeId:'employee',deviceId:'pc',runtime:'DSH',profile:'alpha'};
const action=(operation='inspect',extra={})=>({id:'plugins-one',type:`employee.plugins.${operation==='inspect'?'inspect':'apply'}`,payload:{workspace:'test',workspaceId:'ws',deviceId:'pc',pluginOperation:{schemaVersion:1,subject,operation,...extra}}});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-plugins-dispatch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[];
  const execute=createLocalActionExecutor({runtimeDir:root,defaultWorkdir:root,workspace:'test',deviceId:'pc',dshBaseUrl:'http://local-hub:7878',dshPluginFetch:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/plugins'))return{ok:true,json:async()=>({ok:true,plugins:[{id:'native-bundle',name:'Native',enabled:true,required:false,secret:'hidden'}],restartRequired:true,notice:'next start'})};
    if(url.endsWith('/api/state'))return{ok:true,json:async()=>({bots:[{name:'alpha',running:false,ready:false,url:'token-hidden'}]})};
    throw Error('Unexpected request');
  }});t.after(()=>execute.close());return{execute,calls,root};
}
test('plugin action uses only the local Hub and bound Bot, with no session or business launch',async t=>{
  const {execute,calls,root}=fixture(t),result=await execute(action());
  assert.equal(result.status,'succeeded');assert.deepEqual(result.result.dshPlugins.subject,subject);
  assert.equal(result.result.dshPlugins.source,'dsh-native');assert.equal(result.result.dshPlugins.runtime.status,'unavailable');
  assert.deepEqual(calls.map(c=>c.url),['http://local-hub:7878/api/bots/alpha/plugins','http://local-hub:7878/api/state']);
  assert.doesNotMatch(JSON.stringify(result),/hidden/);assert.deepEqual(fs.readdirSync(root),[]);
  assert.equal(actionExecutionTimeoutMs(action()),15000);assert.equal(actionExecutionLeaseMs(action()),960000);
});
test('apply writes native enabled IDs then reads back the same Bot; no restart or prompt',async t=>{
  const {execute,calls}=fixture(t),result=await execute(action('apply',{enabled:['native-bundle']}));
  assert.equal(result.result.dshPlugins.restartRequired,true);
  assert.equal(calls[0].options.method,'PUT');assert.deepEqual(JSON.parse(calls[0].options.body),{enabled:['native-bundle']});
  assert.equal(calls[1].options.method,'GET');assert(calls[1].url.endsWith('/alpha/plugins'));
});
test('malformed or mismatched plugin action fails before any network request',async t=>{
  const {execute,calls}=fixture(t);
  for(const altered of [
    {...action(),payload:{...action().payload,deviceId:'foreign'}},
    action('inspect',{subject:{...subject,profile:'../beta'}}),
    action('inspect',{subject:{...subject,runtime:'Hermes'}}),
    action('inspect',{subject:{...subject,workspace:'foreign'}}),
    action('inspect',{baseUrl:'http://foreign.invalid'}),
    action('apply',{enabled:['native-bundle','native-bundle']}),
  ])await assert.rejects(execute(altered));
  assert.equal(calls.length,0);
});
test('running Bot returns actual Loader phases and native schema reference graph without configuration values',async()=>{
  const result=await executeDshPlugins(action(),{workspace:'test',deviceId:'pc',baseUrl:'http://local-hub:7878',fetchImpl:async(url,options)=>{
    let value;
    if(url.endsWith('/plugins'))value={plugins:[{id:'native-bundle',enabled:false,required:false}]};
    else if(url.endsWith('/state'))value={bots:[{name:'alpha',running:true,ready:true}]};
    else{
      const rpc=JSON.parse(options.body);
      const values={
        'pluginManager/listBundles':[{name:'native-bundle',enabled:true,installed:true,rows:[]}],
        'pluginInventory/list':{entries:[{entryId:'tool-one',moduleName:'native-tool',enabled:true,fiberPhase:'active',config:{token:'secret-hidden'}}],agentPresets:[]},
        'settings/describe':{writable:true,namespaces:[{ns:'agent-loop',revision:'native-revision',schema:{uid:2,refs:{1:{type:'number',meta:{min:1,default:'secret-hidden'}},2:{type:'object',dict:{maxParallelToolCalls:1},meta:{default:{}}}}},value:{token:'secret-hidden'},user:{secret:'secret-hidden'}}]},
      };value={type:'server-response',rpcId:rpc.rpcId,result:{ok:true,value:values[rpc.method]}};
    }
    return{ok:true,json:async()=>value};
  }});
  assert.equal(result.plugins[0].enabled,false);assert.equal(result.runtime.bundles[0].enabled,true);
  assert.equal(result.runtime.entries[0].fiberPhase,'active');
  assert.equal(result.configuration.namespaces[0].schema.refs['2'].dict.maxParallelToolCalls,1);
  assert.equal(result.configuration.namespaces[0].schema.refs['1'].meta.min,1);
  assert.doesNotMatch(JSON.stringify(result),/secret-hidden/);
});
test('apply requires native readback to confirm the saved selection',async()=>{
  await assert.rejects(executeDshPlugins(action('apply',{enabled:['wanted']}),{workspace:'test',deviceId:'pc',baseUrl:'http://local-hub',fetchImpl:async()=>({ok:true,json:async()=>({plugins:[{id:'wanted',enabled:false,required:false}]})})}),{code:'DSH_PLUGINS_SAVE_NOT_CONFIRMED'});
});
test('dispatcher completes plugin inspection without entering DSH session supervision',async t=>{
  const {execute,root}=fixture(t),dispatcher=new ActionDispatcher({execute,workdir:root,runtimeDir:root,workspace:'test',deviceId:'pc'});
  const result=await dispatcher.dispatch(action());
  assert.equal(result.status,'succeeded');assert.equal(result.result.dshPlugins.subject.profile,'alpha');
  assert.equal(result.result.sessionId,undefined);assert.equal(result.result.sessionExit,undefined);
  assert.equal(result.result.dshPlugins.plugins[0].enabled,true);
});
test('a saved catalog remains readable when runtime state cannot be observed',async()=>{
  const result=await executeDshPlugins(action(),{workspace:'test',deviceId:'pc',baseUrl:'http://local-hub',fetchImpl:async url=>{
    if(url.endsWith('/state'))throw Error('unavailable');
    return{ok:true,json:async()=>({plugins:[{id:'native-bundle',name:'Native',enabled:true,required:false}]})};
  }});
  assert.equal(result.plugins.length,1);assert.equal(result.runtime.reasonCode,'DSH_RUNTIME_STATE_UNAVAILABLE');
  assert.equal(result.running,undefined);
});
