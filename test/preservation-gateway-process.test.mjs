import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBotGatewayManager} from '../src/hermes-gateway-runtime.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {scanNativeFiles} from '../backend/preservation-native-evidence.mjs';
test('real resident Job exit is durably bound to original connect and command caches after restart',{timeout:30000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-resident-proof-')),home=path.join(root,'home'),runtime=path.join(root,'runtime');fs.mkdirSync(home);fs.mkdirSync(runtime);
 const worker=path.join(root,'worker.mjs');fs.writeFileSync(worker,`import readline from 'node:readline';const lines=readline.createInterface({input:process.stdin});const emit=x=>console.log('ZIWEI_GATEWAY_EVENT:'+JSON.stringify(x));lines.on('line',line=>{const x=JSON.parse(line);if(x.operation==='connect')emit({event:'connected',status:'connected',pid:process.pid});else if(x.operation==='disconnect'){lines.close();process.exit(0);}else emit({event:'command_result',commandId:x.commandId,success:true});});`);
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({allowed:true})});
 const manager=createBotGatewayManager({apiBase:'http://127.0.0.1:1',workspace:'test-111',deviceToken:'fixture'},{nativeSpawn:()=>({command:process.execPath,args:[worker],cwd:root,env:process.env,prepared:{home},cleanup(){}})});
 t.after(async()=>{globalThis.fetch=originalFetch;await manager.close();fs.rmSync(root,{recursive:true,force:true});});
 const context={employeeId:'employee_resident',revision:1,controlEpoch:2},actions=[],stateFile=path.join(runtime,'action-state.json');
 const execute=async(action,c)=>({status:'succeeded',result:{nativeOperation:{resource:'gateway',operation:action.payload.nativeOperation.operation,employeeId:context.employeeId,revision:1,data:await manager.operate(action,{context,operation:action.payload.nativeOperation,onResidentExit:c.onResidentExit})}}});
 const dispatcher=new ActionDispatcher({execute,workdir:root,stateFile,workspace:'test-111',deviceId:'fixture-pc'});
 const action=(id,operation)=>({id,type:'hermes.bot.native',workspace:'test-111',payload:{deviceId:'fixture-pc',employeeId:context.employeeId,hermesBot:context,nativeOperation:{resource:'gateway',operation,input:{platform:'fixture',content:'synthetic command'}}}});
 for(const [id,operation] of [['connect-original','connect'],['command-original','outbound']]){const a=action(id,operation),result=await dispatcher.dispatch(a);assert.equal(result.status,'succeeded');actions.push({...a,status:'succeeded',acked_at:'2026-10-13',result:result.result});}
 const connection={workspace:'test-111',deviceId:'fixture-pc',apiBase:'http://127.0.0.1:1',runtimeDir:runtime};assert.equal(scanNativeFiles({connections:[connection]}).safe,false);
 const a=action('disconnect-original','disconnect'),result=await dispatcher.dispatch(a);assert.equal(result.status,'succeeded');actions.push({...a,status:'succeeded',acked_at:'2026-10-13',result:result.result});
 assert.equal(manager.maintenanceStatus().safe,true);const drained=scanNativeFiles({connections:[connection]});assert.equal(drained.safe,true,JSON.stringify({issues:drained.issues,state:JSON.parse(fs.readFileSync(stateFile))}));
 const restarted=new ActionDispatcher({execute:()=>{throw new Error('must never replay');},stateFile,workspace:'test-111',deviceId:'fixture-pc'});assert.equal((await restarted.dispatch(actions[0])).status,'duplicate');
 assert.equal(scanNativeFiles({connections:[connection],actions,homes:[{home,employeeId:context.employeeId,workspace:'test-111'}]}).safe,true);
 const good=fs.readFileSync(stateFile,'utf8');for(const field of ['workerNonce','sourceActionId','platform','revision','controlEpoch']){const changed=JSON.parse(good);changed.completed[0].result.result.residentExit.worker[field]='forged';fs.writeFileSync(stateFile,JSON.stringify(changed));assert.equal(scanNativeFiles({connections:[connection]}).safe,false,field);}fs.writeFileSync(stateFile,good);
});
