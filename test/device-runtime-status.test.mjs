import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from '../backend/repository.mjs';

const runtime=(repo,deviceId,name)=>repo.listDevices('test-111').find(row=>row.id===deviceId)?.runtimes?.find(row=>row.name===name);
const fixture=()=>createRepository({memory:true,discoverLocalVersions:()=>({agents:{Codex:{status:'available',version:'SERVER-ONLY',binary:'/server/codex'},Hermes:{status:'available',version:'SERVER-HERMES'}}})});

test('device runtime rows use only that device heartbeat, not another computer or server discovery',()=>{
  const repo=fixture();
  repo.heartbeatDevice('test-111',{deviceId:'first-pc',name:'第一台Windows电脑',os:'Windows',runtimes:{Codex:{status:'unavailable',version:null},Hermes:{status:'unavailable',binary:'C:/first-pc/hermes.cmd',detection:{state:'failed',reasonCode:'VERSION_PROBE_FAILED',reason:'版本检测失败'}}}});
  repo.heartbeatDevice('test-111',{deviceId:'windows',name:'全公司最强电脑',runtimes:{Codex:{status:'available',version:'WINDOWS-1',binary:'C:/codex.exe'}}});
  assert.ok(runtime(repo,'first-pc','Hermes'),'Each device must expose its own runtime rows');
  assert.equal(runtime(repo,'first-pc','Codex').cli_version,null);
  assert.equal(runtime(repo,'first-pc','Codex').cli_status,'unavailable');
  assert.equal(runtime(repo,'first-pc','Hermes').detection.state,'failed');
  assert.equal(runtime(repo,'windows','Codex').cli_version,'WINDOWS-1');
  const summary=repo.listRuntimes('test-111').find(row=>row.name==='Codex');
  assert.equal(summary.cli_version,'WINDOWS-1');
  assert.deepEqual(summary.available_device_ids,['windows']);
  repo.db.close();
});

test('missing or empty legacy runtime payload is explicitly not reported and never inferred available',()=>{
  const repo=fixture();
  repo.heartbeatDevice('test-111',{deviceId:'legacy',bridgeVersion:'0.1.0'});
  repo.heartbeatDevice('test-111',{deviceId:'empty',runtimes:{}});
  for(const deviceId of ['legacy','empty']){
    assert.equal(runtime(repo,deviceId,'Codex')?.discovery_state,'not_reported');
    assert.equal(runtime(repo,deviceId,'Codex').cli_status,'not_reported');
    assert.equal(runtime(repo,deviceId,'Codex').available,false);
  }
  assert.equal(repo.listRuntimes('test-111').find(row=>row.name==='Codex').cli_version,null);
  repo.db.close();
});

test('fresh failed, not-found and available detection states persist independently of auth readiness',()=>{
  const repo=fixture();
  repo.heartbeatDevice('test-111',{deviceId:'detected',runtime_metadata:[
    {runtime:'codex',status:'unavailable',readiness:{ready:true,authentication:'configured',provider:'configured'},detection:{state:'not_found',reasonCode:'CLI_NOT_FOUND',source:'path-search',checkedAt:new Date().toISOString(),token:'must-not-persist'}},
    {runtime:'hermes',status:'unavailable',binary:'C:/first-pc/hermes.cmd',detection:{state:'failed',reason:'版本探测超时',reasonCode:'VERSION_PROBE_TIMEOUT'}},
    {runtime:'Claude',status:'available',version:'1.2.3',detection:{state:'available'}}
  ]});
  assert.equal(runtime(repo,'detected','Codex')?.detection.state,'not_found');
  assert.equal(runtime(repo,'detected','Codex').available,false);
  assert.equal(runtime(repo,'detected','Codex').detection.token,undefined);
  assert.equal(runtime(repo,'detected','Hermes').detection.reasonCode,'VERSION_PROBE_TIMEOUT');
  assert.equal(runtime(repo,'detected','Claude').available,true);
  repo.db.close();
});

test('an online bridge with expired runtime evidence is stale; an offline bridge cannot inherit another CLI',()=>{
  const repo=fixture();
  repo.heartbeatDevice('test-111',{deviceId:'stale',runtimes:{Codex:{status:'available',version:'old'}}});
  const old=new Date(Date.now()-90_000).toISOString();
  repo.db.prepare('UPDATE runtime_device_metadata SET last_seen=? WHERE device_id=?').run(old,'stale');
  assert.equal(runtime(repo,'stale','Codex')?.discovery_state,'stale');
  assert.equal(runtime(repo,'stale','Codex').available,false);
  repo.db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(old,'stale');
  repo.heartbeatDevice('test-111',{deviceId:'fresh',runtimes:{Codex:{status:'available',version:'new'}}});
  assert.equal(runtime(repo,'stale','Codex').discovery_state,'device_offline');
  assert.equal(runtime(repo,'stale','Codex').cli_status,'offline');
  assert.equal(runtime(repo,'stale','Codex').cli_version,'old');
  assert.equal(runtime(repo,'fresh','Codex').cli_version,'new');
  repo.db.close();
});
test('heartbeat exposes safe client build and structured detection without arbitrary diagnostics',()=>{
  const repo=fixture();const build='a'.repeat(64);
  const device=repo.heartbeatDevice('test-111',{deviceId:'build-pc',clientBuild:build,arch:'x64',runtimeDiscovery:{checkedAt:new Date().toISOString(),platform:'win32',arch:'x64',clientBuild:build,token:'private'},runtimes:{Hermes:{status:'unavailable',version:'metadata-1',detection:{state:'failed',installed:true,versionSource:'installed_metadata',errorCode:'ETIMEDOUT',exitCode:1,stderr:'private'}}}});
  assert.equal(device.client_build,build);
  assert.equal(device.arch,'x64');
  assert.equal(JSON.parse(device.runtime_discovery_json).token,undefined);
  const result=runtime(repo,'build-pc','Hermes');
  assert.equal(result.detection.installed,true);assert.equal(result.detection.versionSource,'installed_metadata');assert.equal(result.detection.exitCode,1);
  assert.equal(result.detection.stderr,undefined);assert.equal(result.available,false);
  repo.heartbeatDevice('test-111',{deviceId:'build-pc',clientBuild:'not-a-build-token-secret'});
  assert.equal(repo.listDevices('test-111').find(row=>row.id==='build-pc').client_build,build);
  repo.db.close();
});
test('device views preserve the actual catalog ID for runtime references',()=>{
  const repo=fixture();repo.heartbeatDevice('test-111',{deviceId:'identity-pc',runtimes:{Codex:{status:'available',version:'1'}}});
  const catalog=repo.listRuntimes('test-111').find(row=>row.name==='Codex');
  assert.equal(runtime(repo,'identity-pc','Codex').id,catalog.id);
  repo.db.close();
});
test('contradictory availability or a metadata-only version cannot produce a green CLI state',()=>{
  const repo=fixture();
  repo.heartbeatDevice('test-111',{deviceId:'contradictory',runtimes:{Codex:{status:'unavailable',detection:{state:'available'}},Hermes:{status:'available',version:'metadata-hint',detection:{state:'available',versionSource:'installed_metadata'}}}});
  for(const name of ['Codex','Hermes']){const row=runtime(repo,'contradictory',name);assert.notEqual(row.discovery_state,'available');assert.equal(row.available,false);assert.notEqual(row.cli_status,'available');}
  repo.db.close();
});
