import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {REMOTE_CLIENT_UPDATE_SOURCE,createRemoteClientUpdates} from '../src/client-remote-update.mjs';
import {inspectRemoteClientUpdateWorker, launchRemoteClientUpdate, REMOTE_UPDATE_HELPER_FILES} from '../scripts/client-remote-update-worker.mjs';
import {EventEmitter} from 'node:events';

let inspectNativeUpdateReceipt;
try { ({inspectNativeUpdateReceipt} = await import('../src/client-remote-update-receipt.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value)); };
function fixture(t, state='complete', {legacy=false, laterInstall=false}={}) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-native-receipt-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root=path.join(base,'node_modules','ziwei'),home=path.join(base,'data'),configPath=path.join(home,'ziwei_user.json');
  write(path.join(root,'package.json'),{name:'ziwei',version:laterInstall?'0.1.2':'0.1.1'});
  write(path.join(root,'daemon','ziwei_user.mjs'),{fixture:'native entry'});
  const installedBuild=clientBuildIdentity(root),sourceBuild=state==='failed'&&!laterInstall?installedBuild:'1'.repeat(64),targetBuild=state==='complete'?installedBuild:'2'.repeat(64);
  write(configPath,{workspace:'fixture',deviceId:'device_fixture',deviceToken:'PRIVATE_FIXTURE_TOKEN',apiBase:'https://fixture.invalid'});
  fs.writeFileSync(path.join(home,'maintenance-host-id'),'a'.repeat(64));
  const configSha256=sha(fs.readFileSync(configPath)),remote=path.join(home,'maintenance','remote-update-'+randomUUID()),directory=path.join(home,'maintenance','update-'+randomUUID());
  const request={id:'client-update_'+randomUUID(),workspace:'fixture',deviceId:'device_fixture',hostId:'a'.repeat(64),targetBuild,sha256:sha('isolated archive'),source:REMOTE_CLIENT_UPDATE_SOURCE,state:'updating'};
  const worker={directory:remote,workerPid:200,startedAt:Date.parse('2026-10-27T00:00:00Z')},claimToken='PRIVATE_CLAIM_'+'e'.repeat(32);
  write(path.join(remote,'remote-job.json'),{schemaVersion:1,root,home,configPath,directory:remote,request,claimToken,...(!legacy?{sourceBuild,configSha256}:{})});
  write(path.join(remote,'supervisor-identity.json'),worker);
  const artifactFile=path.join(remote,'remote-pinned-update.tgz');fs.writeFileSync(artifactFile,'isolated archive');
  const jobFile=path.join(directory,'job.json');
  write(jobFile,{root,parentPid:200,directory,npmCli:'isolated',expectedBuild:targetBuild,artifactFile,sha256:request.sha256});
  const workerCommand=`"${process.execPath}" "${path.join(directory,'helper','scripts','client-update-worker.mjs')}" "${jobFile}"`;
  const identity={version:2,pid:201,operation:'update',jobFile,creationTime:'2026-10-27T00:00:01.000Z',executable:process.execPath,commandHash:sha(workerCommand),nonce:randomUUID()};
  write(path.join(directory,'worker.json'),identity);
  const terminal={state,operation:'update',finishedAt:'2026-10-27T00:00:05.000Z',...(state==='complete'?{oldBuild:sourceBuild,clientBuild:targetBuild,sha256:request.sha256,restoredRunning:true,configurationPreserved:true}:{originalInstallationRestored:true,runningStateRestored:true,reasonCode:'PROCESS_EXIT_NONZERO',failureStage:'restart_client',exitCode:1})};
  write(path.join(directory,'terminal.json'),terminal);write(path.join(directory,'result.json'),terminal);
  const status={state:'queued',workerPid:201,resultFile:path.join(directory,'result.json')};write(path.join(remote,'supervisor-result.json'),status);
  const current={pid:300,creationTime:'2026-10-27T00:00:10.000Z',executable:process.execPath,command:`"${process.execPath}" "${path.join(root,'daemon','ziwei_user.mjs')}"`};
  const health={service:'ziwei_user',agentId:'ziwei_user',pid:300,clientBuild:installedBuild,lifecycle:{root,configPath,configSha256,nonce:'native_fixture_nonce_123',startedAt:current.creationTime,managedAuxiliaryCount:0}};
  const options={worker,status,home,root,configPath,request,claimToken,sourceBuild,pid:300,inspectProcess:async pid=>pid===201?{state:'exited'}:pid===300?{state:'present',record:current}:{state:'unknown'},inspectListener:async()=>({listenerPid:300}),fetchImpl:async()=>({ok:true,json:async()=>health})};
  return {options,root,home,configPath,remote,directory,request,sourceBuild,terminal,identity,current,health,worker,status,configSha256};
}
async function inspect(f) { assert.equal(typeof inspectNativeUpdateReceipt,'function','native terminal receipt inspector must exist');return inspectNativeUpdateReceipt(f.options); }

test('complete proof is derived from exact terminal/worker bytes and a verified native startup',async t=>{
  const f=fixture(t),value=await inspect(f),p=value.workerReceipt;
  assert.equal(p?.state,'complete');assert.equal(p.installedBuild,f.request.targetBuild);assert.equal(p.binding.sourceBuild,f.sourceBuild);
  assert.equal(p.daemonPid,300);assert.equal(p.supervisorPid,200);assert.equal(p.workerPid,201);
  assert.equal(p.configSha256,f.configSha256);assert.equal(p.terminalSha256,sha(fs.readFileSync(path.join(f.directory,'terminal.json'))));
  assert.equal(p.workerIdentitySha256,sha(fs.readFileSync(path.join(f.directory,'worker.json'))));
  for(const key of ['workerExited','maintenanceLockAbsent','configurationPreserved','nativeStartupVerified','restoredRunning'])assert.equal(p[key],true);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_|deviceToken|claimToken|commandHash|executable/);
});
test('a verified failed worker may prove that the original installation and native runtime were restored',async t=>{
  const f=fixture(t,'failed'),value=await inspect(f),p=value.rollbackEvidence;
  assert.equal(p?.state,'failed');assert.equal(p.installedBuild,f.sourceBuild);assert.equal(p.binding.sourceBuild,f.sourceBuild);
  assert.equal(p.originalInstallationRestored,true);assert.equal(p.runningStateRestored,true);assert.equal(p.finishedAt,f.terminal.finishedAt);
});
test('legacy failure after a later install supplements historical facts without inventing native PID/config proof',async t=>{
  const f=fixture(t,'failed',{legacy:true,laterInstall:true}),value=await inspect(f),p=value.observedFailure;
  assert.equal(p?.state,'failed');assert.equal(p.sourceBuild,f.sourceBuild);assert.equal(p.finishedAt,f.terminal.finishedAt);
  for(const key of ['daemonPid','configSha256','installedBuild','nativeStartupVerified','configurationPreserved'])assert.equal(Object.hasOwn(p,key),false,key);
  assert.equal(p.workerExited,true);assert.equal(p.maintenanceLockAbsent,true);assert.equal(value.rollbackEvidence,undefined);
});
test('missing authenticated source build cannot become any receipt',async t=>{
  const f=fixture(t);delete f.options.sourceBuild;const value=await inspect(f);assert.equal(value.proofUnavailable,'CLIENT_UPDATE_RECEIPT_BINDING_INVALID');assert.equal(value.workerReceipt,undefined);
});
test('request, claim, root, configuration and official parent/artifact pins are checked independently',async t=>{
  for(const mutate of [f=>f.options.request={...f.request,id:'client-update_other'},f=>f.options.claimToken='OTHER_PRIVATE_CLAIM',f=>f.options.root=f.home,f=>fs.appendFileSync(f.configPath,' '),f=>{const file=path.join(f.directory,'job.json'),job=JSON.parse(fs.readFileSync(file));write(file,{...job,parentPid:999});},f=>fs.appendFileSync(path.join(f.remote,'remote-pinned-update.tgz'),'changed')]){
    const f=fixture(t);mutate(f);const value=await inspect(f);assert.equal(value.workerReceipt,undefined);assert.match(value.proofUnavailable,/^CLIENT_UPDATE_RECEIPT_/);
  }
});
test('alive, unknown and generationless workers cannot produce strong or historical accepted proof',async t=>{
  for(const variant of ['alive','unknown','generationless']){
    const f=fixture(t,'failed',{legacy:true,laterInstall:true});
    if(variant==='generationless')write(path.join(f.directory,'worker.json'),{pid:201,operation:'update',jobFile:path.join(f.directory,'job.json')});
    else f.options.inspectProcess=async()=>({state:variant==='alive'?'present':'unknown',record:variant==='alive'?{pid:201,creationTime:f.identity.creationTime,executable:process.execPath,command:`"${process.execPath}" "${path.join(f.directory,'helper','scripts','client-update-worker.mjs')}" "${path.join(f.directory,'job.json')}"`}:undefined});
    const value=await inspect(f);assert.equal(value.observedFailure,undefined);assert.equal(value.rollbackEvidence,undefined);
  }
});
test('a held maintenance lock never produces completion or historical proof',async t=>{
  const f=fixture(t,'failed',{legacy:true,laterInstall:true});write(path.join(f.home,'maintenance','operation.lock'),{});
  assert.equal((await inspect(f)).proofUnavailable,'CLIENT_UPDATE_RECEIPT_LOCK_PRESENT');
});
test('completion refuses weak health identity or a foreign listener',async t=>{
  for(const kind of ['root','pid','build','listener']){
    const f=fixture(t);
    if(kind==='root')f.health.lifecycle.root=f.home;if(kind==='pid')f.health.pid=999;if(kind==='build')f.health.clientBuild='f'.repeat(64);
    if(kind==='listener')f.options.inspectListener=async()=>{throw new Error('foreign');};
    assert.equal((await inspect(f)).workerReceipt,undefined);
  }
});
test('a failed terminal does not borrow restoration flags from readUpdateResult or a changed result file',async t=>{
  const f=fixture(t,'failed');write(path.join(f.directory,'terminal.json'),{...f.terminal,runningStateRestored:null});
  const value=await inspect(f);assert.equal(value.rollbackEvidence,undefined);assert.equal(value.observedFailure,undefined);
});
test('unsafe links and hard-linked terminal files are refused without reading external contents',async t=>{
  const f=fixture(t),terminal=path.join(f.directory,'terminal.json'),outside=path.join(f.home,'other-terminal.json');
  fs.renameSync(terminal,outside);fs.linkSync(outside,terminal);assert.equal((await inspect(f)).workerReceipt,undefined);
});
test('the actual remote worker inspector forwards the authenticated context and exposes only verified evidence',async t=>{
  const f=fixture(t,'failed',{legacy:true,laterInstall:true});
  const value=await inspectRemoteClientUpdateWorker(f.worker,{...f.options,readStatus:async()=>f.terminal});
  assert.equal(value.state,'failed');assert.equal(value.observedFailure?.terminalSha256,sha(fs.readFileSync(path.join(f.directory,'terminal.json'))));
  assert.equal(value.rollbackEvidence,undefined);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_|claimToken|deviceToken/);
});
test('new remote launch persists authenticated source and the original config digest before spawning',async t=>{
  const f=fixture(t),repository=path.resolve(import.meta.dirname,'..'),codeRoot=f.root;
  for(const relative of REMOTE_UPDATE_HELPER_FILES){const target=path.join(codeRoot,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repository,relative),target);}
  const sourceBuild=clientBuildIdentity(codeRoot);let observed;
  const launched=await launchRemoteClientUpdate({root:codeRoot,home:f.home,configPath:f.configPath,request:f.request,claimToken:f.options.claimToken,sourceBuild,spawnProcess:(_exe,args)=>{
    observed=JSON.parse(fs.readFileSync(args[1],'utf8'));
    const child=new EventEmitter();child.pid=401;child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;
  }});
  assert.equal(launched.workerPid,401);assert.equal(observed.sourceBuild,sourceBuild);assert.equal(observed.configSha256,f.configSha256);
});
test('historical proof refuses terminal bytes changed during the process-exit probe',async t=>{
  const f=fixture(t,'failed',{legacy:true,laterInstall:true});
  f.options.inspectProcess=async()=>{write(path.join(f.directory,'terminal.json'),{...f.terminal,finishedAt:'2026-10-27T00:00:06.000Z'});return {state:'exited'};};
  assert.equal((await inspect(f)).observedFailure,undefined);
});
test('a replaced installation junction cannot inherit the native startup proof',async t=>{
  const f=fixture(t),backing=f.root+'.backing';fs.renameSync(f.root,backing);fs.symlinkSync(backing,f.root,'junction');
  assert.equal((await inspect(f)).workerReceipt,undefined);
});
test('native daemon PID generation is rechecked after health and listener probes',async t=>{
  const f=fixture(t);f.options.inspectListener=async()=>{f.current.creationTime='2026-10-27T00:00:11.000Z';return {listenerPid:300};};
  assert.equal((await inspect(f)).workerReceipt,undefined);
});
test('actual native terminal evidence passes the real coordinator strict receipt contract',async t=>{
  for(const kind of [{state:'complete'},{state:'failed'},{state:'failed',legacy:true,laterInstall:true}]){
    const {state}=kind,f=fixture(t,state,kind),reports=[];
    write(path.join(f.home,'maintenance','remote-client-update.json'),{request:f.request,claimToken:f.options.claimToken,sourceBuild:f.sourceBuild,state:'succeeded',stage:'worker_launch',worker:f.worker});
    const client=createRemoteClientUpdates({home:f.home,hostId:f.request.hostId,clientBuild:clientBuildIdentity(f.root),enabled:true,pid:300,connections:()=>[{workspace:f.request.workspace,deviceId:f.request.deviceId}],idle:()=>false,hasPendingResumes:()=>true,
      inspectWorker:(worker,context)=>inspectRemoteClientUpdateWorker(worker,{...f.options,...context,readStatus:async()=>f.terminal}),
      request:async(_connection,_route,body)=>{if(body)reports.push(body);return {request:{...f.request,currentBuild:f.sourceBuild,state:body?.state==='failed'?'failed':'succeeded'}};}});
    await client.tick();assert.equal(reports.length,1);
    if(kind.laterInstall){assert.equal(reports[0].observedFailure?.requestId,f.request.id);assert.equal(reports[0].observedFailure.sourceBuild,f.sourceBuild);assert.equal(Object.hasOwn(reports[0].observedFailure,'installedBuild'),false);}
    else assert.equal(reports[0][state==='complete'?'workerReceipt':'rollbackEvidence']?.binding?.requestId,f.request.id);
  }
});
test('authenticated legacy completion uses original terminal preservation and actual target startup without inventing a config-before hash',async t=>{
  const f=fixture(t,'complete',{legacy:true});f.options.request={...f.request,completionProtocol:'legacy_heartbeat'};
  const value=await inspect(f),p=value.legacyCompletion;
  assert.equal(p?.binding?.requestId,f.request.id);assert.equal(p.nativeStartupVerified,true);assert.equal(p.configurationPreserved,true);
  assert.equal(p.installedBuild,f.request.targetBuild);assert.equal(Object.hasOwn(p,'configSha256'),false);assert.equal(value.workerReceipt,undefined);
});
test('missing legacy snapshots cannot downgrade a native receipt requirement or an unknown protocol',async t=>{
  for(const protocol of ['native_worker_v1',undefined]){
    const f=fixture(t,'complete',{legacy:true});f.options.request={...f.request,...(protocol?{completionProtocol:protocol}:{})};
    const value=await inspect(f);assert.equal(value.legacyCompletion,undefined);assert.equal(value.workerReceipt,undefined);
  }
});
test('the real coordinator accepts actual legacy completion only after authenticating the frozen original protocol',async t=>{
  const f=fixture(t,'complete',{legacy:true});
  write(path.join(f.home,'maintenance','remote-client-update.json'),{request:f.request,claimToken:f.options.claimToken,sourceBuild:f.sourceBuild,state:'succeeded',stage:'worker_launch',worker:f.worker});
  const client=createRemoteClientUpdates({home:f.home,hostId:f.request.hostId,clientBuild:clientBuildIdentity(f.root),enabled:true,pid:300,connections:()=>[{workspace:f.request.workspace,deviceId:f.request.deviceId}],idle:()=>false,hasPendingResumes:()=>true,
    inspectWorker:(worker,context)=>inspectRemoteClientUpdateWorker(worker,{...f.options,...context,readStatus:async()=>f.terminal}),
    request:async()=>({request:{...f.request,currentBuild:f.sourceBuild,completionProtocol:'legacy_heartbeat',state:'succeeded'}})});
  await client.tick();assert.equal(client.blocksNewActions,false);
  const saved=JSON.parse(fs.readFileSync(path.join(f.home,'maintenance','remote-client-update.json'),'utf8'));
  assert.equal(saved.request.completionProtocol,'legacy_heartbeat');assert.equal(saved.legacyCompletion?.binding?.requestId,f.request.id);
  assert.equal(saved.workerReceipt,undefined);
});
