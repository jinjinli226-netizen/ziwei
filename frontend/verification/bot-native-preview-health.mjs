// Fresh endpoint + native-read proof after restoring the one owned preview.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),base='http://127.0.0.1:4283',front='http://127.0.0.1:5283',workspace='preview-bots';
async function api(route,body){const response=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const value=await response.json();assert.ok(response.ok,value.error);return value;}
const before=await api('/__preview/health');assert.equal(before.preview,true);assert.equal(before.schedulerEnabled,false);
const bot=(await api(`/api/workspaces/${workspace}/bots`)).bots.find(row=>row.employee.name==='Hermes 原生伙伴'&&row.employee.runtime_profile==='default');assert.ok(bot,'Read only the owned native seed Bot');
const prefix=`/api/workspaces/${workspace}/bots/${bot.id}`,accepted=await api(prefix+'/native/actions',{resource:'memory',operation:'read',input:{scope:'memory'},expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,idempotencyKey:crypto.randomUUID()});let original;
for(let i=0;i<300;i++){original=(await api(prefix+'/runs')).runs.find(row=>row.id===accepted.action.id);if(!['pending','acked'].includes(original.status))break;await new Promise(resolve=>setTimeout(resolve,100));}
assert.equal(original.status,'succeeded',original.error);assert.equal(original.result.nativeOperation.nativeVersion,'0.21.3');assert.equal(original.result.processExit.rootConfirmed,true);assert.equal(original.result.processExit.treeConfirmed,true);
const health=await api('/__preview/health'),frontend=await fetch(front,{signal:AbortSignal.timeout(15000)});assert.equal(frontend.status,200);assert.equal(health.nativeExecutionVerified,true);
const proof={verifiedAt:new Date().toISOString(),frontendStatus:frontend.status,health,action:{id:original.id,status:original.status,employeeId:original.result.nativeOperation.employeeId,revision:original.result.nativeOperation.revision,nativeVersion:original.result.nativeOperation.nativeVersion,executionSource:original.result.executionSource,processExit:original.result.processExit}};
const file=path.join(root,'.local/e03-native-preview-evidence/current-health.json');fs.writeFileSync(file,JSON.stringify(proof,null,2));console.log(JSON.stringify({passed:true,frontendStatus:200,apiPid:health.pid,nativeVersion:proof.action.nativeVersion,rootConfirmed:true,treeConfirmed:true,evidence:file}));
