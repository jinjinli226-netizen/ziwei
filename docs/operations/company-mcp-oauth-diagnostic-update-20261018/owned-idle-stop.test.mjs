// No listeners, native processes, control requests, real daemon or termination.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stopOwnedIdle,readStateSnapshot,runJsonChild,restoreOriginal,OLD_BUILD,WORKSPACE,DEVICE} from './owned-idle-stop.mjs';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
 const scope={root:'/installed/ziwei',configPath:'/user/ziwei_user.json',runtimeDir:'/user/runtime',ownerSid:'S-1-5-21-11',executable:'/node/node.exe',connections:[{workspace:WORKSPACE,deviceId:DEVICE,primary:true}]};
 const h={service:'ziwei_user',agentId:'ziwei_user',workspace:WORKSPACE,deviceId:DEVICE,clientBuild:OLD_BUILD,pid:123,connectionState:'connected',executionQuarantined:false,activeActionCount:0,pollingCount:0,quarantinedActionCount:0,lifecycle:{root:scope.root,configPath:scope.configPath,runtimeDir:scope.runtimeDir,configSha256:'a'.repeat(64),nonce:'b'.repeat(48),startedAt:'2026-10-18T00:00:00.000Z',managedAuxiliaryCount:0},maintenance:{safe:false,stopSafe:false,pendingDeliveryCount:0,blockedDeliveryCount:0,gatewaySafe:true,gatewayWorkers:[]},connectionErrors:[],connections:[{...scope.connections[0],configured:true,ready:true}]};
 const value={health:h,record:{pid:123,creationTime:'2026-10-18T00:00:00.0000000Z',commandHash:'c'.repeat(64),executable:scope.executable},ownerSid:scope.ownerSid,configSha256:'a'.repeat(64)};
 const data=Buffer.from('original opaque business bytes; never interpreted');
 const snapshot=()=>({files:[{path:'/user/runtime/action-state.json',exists:true,sha256:hash(data),bytes:data.length,data:Buffer.from(data)}],directories:[{path:'/user/runtime/action-delivery',exists:true,names:[]}]});
 let now=0,kill=0,pause=0,resume=0,snapReads=0,inspectReads=0,child=0,archived=null;
 const deps={now:()=>now,sleep:async()=>{now+=600001;},inspect:async()=>{inspectReads++;return structuredClone(value);},control:async op=>{if(op==='pause'){pause++;h.connectionState='draining';h.connections[0].ready=false;}else{resume++;h.connectionState='connected';}},children:async()=>child,snapshot:async()=>{snapReads++;return snapshot();},archive:async original=>{archived=original;return {digest:'d'.repeat(64)};},terminate:async()=>{kill++;return{scope:'owned-daemon-root-only',stopped:true,pid:123,creationTime:value.record.creationTime,exitedAt:'2026-10-18T00:01:00Z'};},absent:async()=>true};
 return {scope,value,h,deps,snapshot,setChild:n=>child=n,counters:()=>({kill,pause,resume,snapReads,inspectReads}),archive:()=>archived};
}
test('explicitly idle owned root stops once despite preserved historical file issue; no business/tree proof is invented',async()=>{
 const f=fixture(),original=Buffer.from(f.snapshot().files[0].data),result=await stopOwnedIdle(f.scope,f.deps);
 assert.equal(f.counters().kill,1);assert.equal(f.counters().pause,1);assert.equal(f.counters().resume,0);
 assert.deepEqual(f.archive().files[0].data,original);assert.equal(result.scope,'owned-daemon-root-only');assert.equal(result.historyRecordsUnchanged,true);
 for(const absent of ['processExit','treeConfirmed','launched','originalActionId','executionConfirmedStopped'])assert.equal(Object.hasOwn(result,absent),false);
});
for(const [label,change]of Object.entries({device:f=>f.h.deviceId='other',build:f=>f.h.clientBuild='0'.repeat(64),owner:f=>f.value.ownerSid='other',executable:f=>f.value.record.executable='/other/node.exe',config:f=>f.value.configSha256='e'.repeat(64),nonce:f=>f.h.lifecycle.nonce='invalid',connections:f=>f.h.connections.push({...f.h.connections[0]})}))test(`wrong ${label} never pauses or terminates`,async()=>{const f=fixture();change(f);await assert.rejects(stopOwnedIdle(f.scope,f.deps));assert.equal(f.counters().kill,0);assert.equal(f.counters().pause,0);});
test('an existing maintenance drain is not adopted or resumed',async()=>{const f=fixture();f.h.connectionState='draining';await assert.rejects(stopOwnedIdle(f.scope,f.deps),{code:'CLIENT_ALREADY_DRAINING'});assert.deepEqual({kill:f.counters().kill,pause:f.counters().pause,resume:f.counters().resume},{kill:0,pause:0,resume:0});});
for(const field of ['activeActionCount','pollingCount','quarantinedActionCount'])test(`nonzero ${field} cannot reach terminate`,async()=>{const f=fixture();f.h[field]=1;await assert.rejects(stopOwnedIdle(f.scope,f.deps),{code:'DRAIN_TIMEOUT'});assert.equal(f.counters().kill,0);assert.equal(f.counters().resume,1);});
for(const field of ['pendingDeliveryCount','blockedDeliveryCount','gatewayWorkers','gatewaySafe'])test(`unsafe ${field} cannot reach terminate`,async()=>{const f=fixture();f.h.maintenance[field]=field==='gatewayWorkers'?[{}]:field==='gatewaySafe'?false:1;await assert.rejects(stopOwnedIdle(f.scope,f.deps),{code:'DRAIN_TIMEOUT'});assert.equal(f.counters().kill,0);});
test('owned auxiliary process or child blocks root stop',async()=>{for(const kind of ['aux','child']){const f=fixture();if(kind==='aux')f.h.lifecycle.managedAuxiliaryCount=1;else f.setChild(1);await assert.rejects(stopOwnedIdle(f.scope,f.deps));assert.equal(f.counters().kill,0);assert.equal(f.counters().resume,1);}});
test('source bytes change after archive refuses before terminate and restores exact live connection',async()=>{const f=fixture();let reads=0;f.deps.snapshot=async()=>{const s=f.snapshot();if(++reads>1){s.files[0].data=Buffer.from('changed');s.files[0].sha256=hash(s.files[0].data);}return s;};await assert.rejects(stopOwnedIdle(f.scope,f.deps),{code:'SNAPSHOT_CHANGED'});assert.equal(f.counters().kill,0);assert.equal(f.counters().resume,1);});
test('boot changes after archive cannot terminate or resume the replacement',async()=>{const f=fixture();let reads=0;f.deps.inspect=async()=>{if(++reads>=3)f.h.lifecycle.nonce='e'.repeat(48);return structuredClone(f.value);};await assert.rejects(stopOwnedIdle(f.scope,f.deps),{code:'IDENTITY_CHANGED'});assert.equal(f.counters().kill,0);assert.equal(f.counters().resume,0);});
test('file change observed after actual stop fails closed and does not pretend old bytes are current',async()=>{const f=fixture();let reads=0;f.deps.snapshot=async()=>{const s=f.snapshot();if(++reads>=4)s.directories[0].names=['unexpected'];return s;};await assert.rejects(stopOwnedIdle(f.scope,f.deps),{code:'POST_EXIT_SNAPSHOT_CHANGED'});assert.equal(f.counters().kill,1);assert.equal(f.counters().resume,0);});
test('uncertain kill/exit persistence cannot be reported as a confirmed root stop',async()=>{const f=fixture();f.deps.terminate=async()=>({state:'failed',terminationRequested:true,exitObserved:true});await assert.rejects(stopOwnedIdle(f.scope,f.deps),{code:'ROOT_EXIT_UNCONFIRMED'});});
test('state/delivery filesystem snapshot covers primary and shared bytes without modifying any source',t=>{
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'owned-idle-files-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const files=[['action-state.json','primary-state'],['action-delivery/a.json','opaque journal'],['shared-workspaces/other/device/action-state.json','shared-state'],['shared-workspaces/other/device/action-delivery/b.result.json','opaque result']];
 for(const [relative,body]of files){const file=path.join(dir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
 const before=files.map(([relative])=>hash(fs.readFileSync(path.join(dir,relative)))),snapshot=readStateSnapshot(dir);
 assert.equal(snapshot.files.filter(x=>x.exists).length,4);assert.deepEqual(snapshot.files.filter(x=>x.exists).map(x=>x.data.toString()).sort(),files.map(x=>x[1]).sort());
 assert.deepEqual(files.map(([relative])=>hash(fs.readFileSync(path.join(dir,relative)))),before);
 fs.symlinkSync(path.join(dir,'action-state.json'),path.join(dir,'action-delivery/linked.json'));assert.throws(()=>readStateSnapshot(dir),{code:'PATH_UNSAFE'});
});
test('actual child receives the complete JSON descriptor and EOF through stdin',async()=>{
 const input={value:'opaque test value',rows:[1,2,3]};
 const result=await runJsonChild(process.execPath,['--input-type=module','-e',"let s='';for await(const b of process.stdin)s+=b;process.stdout.write(JSON.stringify({received:JSON.parse(s),eof:true}));"],input);
 assert.deepEqual(result,{received:input,eof:true});
});
test('failure recovery only normal-starts an absent original installation with durable root-only evidence',async()=>{
 let starts=0;
 const proof={exit:{scope:'owned-daemon-root-only',stopped:true,pid:123,creationTime:'2026-10-18T00:00:00Z',exitedAt:'2026-10-18T00:01:00Z'},record:{pid:123,creationTime:'2026-10-18T00:00:00Z'},build:OLD_BUILD,configUnchanged:true,archiveVerified:true};
 for(const change of [p=>p.exit=null,p=>p.exit.scope='business-tree',p=>p.record.pid=99,p=>p.build='other',p=>p.configUnchanged=false,p=>p.archiveVerified=false]){
  const copy=structuredClone(proof);change(copy);await assert.rejects(restoreOriginal({verify:async()=>copy,absent:async()=>true,start:async()=>starts++,ready:async()=>true}));assert.equal(starts,0);
 }
 await assert.rejects(restoreOriginal({verify:async()=>proof,absent:async()=>false,start:async()=>starts++,ready:async()=>true}));assert.equal(starts,0);
 const result=await restoreOriginal({verify:async()=>proof,absent:async()=>true,start:async()=>starts++,ready:async()=>true});assert.equal(starts,1);assert.equal(result.originalFailurePreserved,true);
});
