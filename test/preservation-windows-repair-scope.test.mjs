import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {defaultNativeSourceIO} from '../backend/preservation-source-namespace.mjs';
import {digestProduction} from '../backend/production-preservation.mjs';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t,intermediate=false){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-repair-scope-')),root=path.join(base,'original'),home=path.join(base,'home'),external=path.join(base,'external'),hermes=path.join(home,'hermes'),runtime=path.join(home,'runtime');for(const directory of [root,home,external,hermes,runtime])fs.mkdirSync(directory,{recursive:true});
 const entry=path.join(root,'original.mjs'),writer=path.join(external,'writer.mjs'),middle=path.join(external,'installer.mjs'),stop=path.join(external,'stop'),trigger=path.join(external,'write'),receipt=path.join(external,'exiting');
 fs.writeFileSync(writer,"import fs from 'node:fs';import path from 'node:path';process.send({pid:process.pid,parentPid:process.ppid});setInterval(()=>{if(fs.existsSync(process.env.TEST_STOP)){fs.writeFileSync(process.env.TEST_EXIT_RECEIPT,'exiting');process.exit(0)}if(fs.existsSync(process.env.TEST_WRITE))fs.writeFileSync(path.join(process.env.HERMES_HOME,'.update-incomplete'),'isolated-fixture-only')},25);");
 fs.writeFileSync(middle,"import {spawn} from 'node:child_process';const child=spawn(process.execPath,[process.env.TEST_WRITER],{cwd:process.env.TEST_EXTERNAL,env:process.env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,detached:true});child.once('message',value=>process.send(value,()=>process.exit(0)));");
 fs.writeFileSync(entry,"import {spawn} from 'node:child_process';const child=spawn(process.execPath,[process.env.TEST_ENTRY],{cwd:process.env.TEST_EXTERNAL,env:process.env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,detached:true});child.once('message',value=>{"+(intermediate?"child.once('exit',()=>process.send(value));":"process.send(value);")+"});process.on('message',()=>process.exit(0));setInterval(()=>{},1000);");
 const env={...process.env,ZIWEI_USER_HOME:home,ZIWEI_CONFIG:path.join(home,'config.json'),HERMES_HOME:hermes,TEST_ENTRY:intermediate?middle:writer,TEST_WRITER:writer,TEST_EXTERNAL:external,TEST_STOP:stop,TEST_WRITE:trigger,TEST_EXIT_RECEIPT:receipt};delete env.NODE_OPTIONS;
 const parent=spawn(process.execPath,[entry],{cwd:root,env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const diagnosticDirectory=path.resolve('.local/preservation-native-qualification/diagnostics');fs.mkdirSync(diagnosticDirectory,{recursive:true});const diagnostic=path.join(diagnosticDirectory,crypto.randomUUID()+'.jsonl'),write=(event,value={})=>fs.appendFileSync(diagnostic,JSON.stringify({at:new Date().toISOString(),supervisorPid:process.pid,event,...value})+'\n');write('parent-start',{pid:parent.pid});parent.once('exit',(exitCode,signal)=>write('parent-exit',{pid:parent.pid,exitCode,signal}));let worker;
 const timer=setInterval(()=>write('heartbeat',{parentPid:parent.pid,workerPid:worker?.pid??null}),1000);
 t.after(async()=>{try{if(parent.exitCode===null){const done=once(parent,'exit');parent.send('exit');await done;}if(worker){fs.writeFileSync(stop,'exit');for(let n=0;n<200&&!fs.existsSync(receipt);n++)await delay(25);assert.ok(fs.existsSync(receipt));assert.equal(await defaultNativeSourceIO.readProcess(worker.pid,{createdAt:worker.createdAt}),null);write('worker-native-absent',{pid:worker.pid,nativeBirth:worker.nativeBirth});}assert.ok(base.startsWith(path.join(os.tmpdir(),'ziwei-repair-scope-')));fs.rmSync(base,{recursive:true,force:true});}finally{clearInterval(timer);}});
 const [ready]=await once(parent,'message');worker=await defaultNativeSourceIO.readProcess(ready.pid);assert.equal(worker.entryPath,writer);assert.equal(worker.paths.HERMES_HOME,hermes);assert.equal(worker.parentPid,ready.parentPid);write('worker-native-birth',{pid:worker.pid,parentPid:worker.parentPid,nativeBirth:worker.nativeBirth});
 const before=await defaultNativeSourceIO.readProcess(parent.pid),original={root,entryPath:entry,userHome:home,runtimeDir:runtime,baseHome:hermes,configPath:path.join(home,'config.json'),clientBuild:'a'.repeat(64),originalInstance:{pid:parent.pid,createdAt:before.createdAt,nativeBirth:before.nativeBirth}},bindingDigest=digestProduction(original),audit={schemaVersion:1,kind:'windows-source-audit-v1',bindingDigest,originalInstance:original.originalInstance,clientBuild:original.clientBuild,entrySource:entry,entrySha256:sha(fs.readFileSync(entry)),protocol:'standalone-no-worker-v1',spawnSites:[],loggerPaths:[],maintenanceRoot:null},auditFile=path.join(root,'audit.json');fs.writeFileSync(auditFile,JSON.stringify(audit));
 const nativeRefs=[{kind:'legacy-source-code',canonicalPath:entry,sha256:audit.entrySha256,bindingDigest},{kind:'windows-source-audit-v1',canonicalPath:auditFile,sha256:sha(fs.readFileSync(auditFile)),bindingDigest}],done=once(parent,'exit');parent.send('exit');await done;assert.equal(await defaultNativeSourceIO.readProcess(parent.pid,{createdAt:before.createdAt}),null);
 const context={original,binding:{clients:[],apiInstances:[]},nativeRefs,before:{process:before},after:{namespace:{}}};
 return {base,hermes,worker,trigger,context,write};
}
test('fresh Windows scope retains a visible direct child after its original parent exited even when only environment binds HOME',{skip:process.platform!=='win32',timeout:45000},async t=>{
 const f=await fixture(t),namespace=await defaultNativeSourceIO.readNamespace({kind:'windows-source'},f.context);
 assert.ok(namespace.members.includes(f.worker.pid),'an exited original must remain an ancestry anchor');assert.ok(namespace.unresolved.some(row=>row.code==='SOURCE_WINDOWS_SOURCE_AUDIT_INVALID'));
});
test('absent root and markers cannot close a lost installer ancestor whose surviving child can still write the protected fixture HOME',{skip:process.platform!=='win32',timeout:45000},async t=>{
 const f=await fixture(t,true);assert.equal(fs.existsSync(path.join(f.hermes,'.update-incomplete')),false);const namespace=await defaultNativeSourceIO.readNamespace({kind:'windows-source'},f.context);
 assert.deepEqual(namespace.members,[]);assert.ok(namespace.unresolved.some(row=>row.code==='SOURCE_WINDOWS_SOURCE_AUDIT_INVALID'));
 fs.writeFileSync(f.trigger,'write');for(let n=0;n<200&&!fs.existsSync(path.join(f.hermes,'.update-incomplete'));n++)await delay(25);assert.equal(fs.readFileSync(path.join(f.hermes,'.update-incomplete'),'utf8'),'isolated-fixture-only');assert.equal((await defaultNativeSourceIO.readProcess(f.worker.pid)).creationFileTime,f.worker.creationFileTime);
 f.write('lost-ancestor-home-effect',{pid:f.worker.pid,parentPid:f.worker.parentPid,nativeBirth:f.worker.nativeBirth,emptyMatchedInventory:true,closureRefused:true});
 fs.writeFileSync(path.resolve('.local/preservation-native-qualification/repair-lost-ancestor.json'),JSON.stringify({kind:'isolated-native-scope-counterexample',actualSdkExecution:false,fixtureUsesDetachedChildren:true,worker:{pid:f.worker.pid,parentPid:f.worker.parentPid,nativeBirth:f.worker.nativeBirth,creationFileTime:f.worker.creationFileTime},original:f.context.original.originalInstance,originalNativeAbsent:true,markerAbsentAtSample:true,matchedMembers:namespace.members,unresolved:namespace.unresolved,laterProtectedFixtureWriteObserved:true},null,2));
});
