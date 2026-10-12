// Actual owned preview check: generic fixture execution must never fake native success.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4283',workspace='preview-bots',root=path.resolve(import.meta.dirname,'../..');
const health=await(await fetch(base+'/__preview/health')).json();assert.equal(health.preview,true);assert.equal(health.schedulerEnabled,false);assert.equal(health.fixtureDevices,true);
async function api(route,body,method=body?'POST':'GET'){const response=await fetch(base+route,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();assert.ok(response.ok,result.error);return result;}
const source=(await api(`/api/workspaces/${workspace}/bots`)).bots.find(row=>row.employee.runtime_profile==='preview-fixture');assert.ok(source);let bot;
try{bot=await api(`/api/workspaces/${workspace}/bots`,{name:'E03 fixture native rejection '+Date.now(),targetDeviceId:source.employee.target_device_id,runtimeProfile:'preview-fixture',model:'fixture-model',idempotencyKey:crypto.randomUUID()});const basePath=`/api/workspaces/${workspace}/bots/${bot.id}`;
  const accepted=await api(basePath+'/native/actions',{resource:'memory',operation:'read',input:{scope:'memory'},expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,idempotencyKey:crypto.randomUUID()});let original;
  for(let i=0;i<200;i++){original=(await api(basePath+'/runs')).runs.find(row=>row.id===accepted.action.id);if(!['pending','acked'].includes(original.status))break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(original.status,'failed');assert.equal(original.result.code,'PREVIEW_NATIVE_REQUIRES_NATIVE_DEVICE');assert.equal(original.result.fixture,true);assert.equal(original.result.nativeOperation,undefined);
  const proof={passed:true,realHttp:true,fixtureNativeSuccessRejected:true,actionId:original.id,status:original.status,code:original.result.code};fs.writeFileSync(path.join(root,'.local/e03-native-preview-evidence/fixture-rejection.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{if(bot?.id)await api(`/api/workspaces/${workspace}/employees/${bot.id}`,null,'DELETE');}
