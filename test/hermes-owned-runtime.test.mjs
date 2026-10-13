import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as runtime from '../src/hermes-bot-runtime.mjs';
import {hermesProfileReadiness} from '../src/runtime-adapters.mjs';
import {finalizeOwnedProfileProvision} from '../src/hermes-owned-profile.mjs';

test('owned profile preparation uses its named HOME, keeps state, and only references source auth',()=>{
  assert.equal(typeof runtime.ownedProfileMetadata,'function');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'owned-home-'));
  try{
    fs.writeFileSync(path.join(root,'config.yaml'),'model:\n  provider: openai-codex\n  default: source-model\n');
    fs.writeFileSync(path.join(root,'auth.json'),'SOURCE-AUTH');
    const home=path.join(root,'profiles','bot-fixture');fs.mkdirSync(home,{recursive:true});
    const context={employeeId:'employee_owned',workspace:'test-111',deviceId:'pc',revision:1,sourceProfile:'bot-fixture',name:'A',model:'owned-model',config:{},instance:{mode:'owned_profile',profile:'bot-fixture',templateProfile:'default',ownershipId:'fixture-owner',provisionActionId:'action_fixture'}};
    const metadata=runtime.ownedProfileMetadata({context,sourceHome:root,apiBase:'https://example.test'});
    fs.writeFileSync(path.join(home,'ziwei-instance.json'),JSON.stringify(metadata));
    fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openai-codex\n  default: owned-model\n');
    fs.writeFileSync(path.join(home,'.env'),'# native empty credential file\n');
    fs.mkdirSync(path.join(home,'memories'));fs.writeFileSync(path.join(home,'memories/MEMORY.md'),'OWNED MEMORY');
    const args={context,sourceHome:home,privateDirectory:path.join(root,'unused-private'),workspace:'test-111',apiBase:'https://example.test'};
    const first=runtime.prepareHermesBotHome(args),second=runtime.prepareHermesBotHome({...args,context:{...context,name:'Renamed'}});
    assert.equal(first.home,fs.realpathSync.native(home));assert.equal(second.home,first.home);
    assert.equal(first.receipt.profileHome,first.home);assert.equal(first.env.ZIWEI_CREATOR_SOURCE_HOME,fs.realpathSync.native(root));
    assert.equal(fs.readFileSync(path.join(home,'memories/MEMORY.md'),'utf8'),'OWNED MEMORY');
    assert.equal(fs.readFileSync(path.join(root,'auth.json'),'utf8'),'SOURCE-AUTH');
    assert.equal(fs.existsSync(path.join(home,'auth.json')),false);assert.equal(fs.existsSync(args.privateDirectory),false);
    assert.throws(()=>runtime.prepareHermesBotHome({...args,context:{...context,employeeId:'employee_other'}}),{code:'BOT_HOME_BINDING_CONFLICT'});
    assert.throws(()=>runtime.prepareHermesBotHome({...args,context:{...context,instance:{...context.instance,profile:'default'}}}),{code:'BOT_HOME_BINDING_CONFLICT'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('owned readiness follows only the verified source credential reference',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'owned-ready-'));
  try{
    const profile='bot-ready',home=path.join(root,'profiles',profile);fs.mkdirSync(home,{recursive:true});
    fs.writeFileSync(path.join(root,'.env'),'OWNED_FIXTURE_PROVIDER_KEY=fixture-key\n');
    fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: custom:fixture\nproviders:\n  fixture:\n    key_env: OWNED_FIXTURE_PROVIDER_KEY\n');
    const metadata={mode:'owned_profile',profile,sourceProfile:profile,templateProfile:'default',sourceHome:fs.realpathSync.native(root),key:'owner',employeeId:'employee_fixture',deviceId:'pc',provisionActionId:'action_fixture'};
    fs.writeFileSync(path.join(home,'ziwei-instance.json'),JSON.stringify(metadata));
    const ready=hermesProfileReadiness(profile,{baseHome:root});assert.equal(ready.ready,true);assert.equal(ready.authMode,'source-native-store');
    const context={workspace:'fixture',employeeId:metadata.employeeId,deviceId:metadata.deviceId,instance:{mode:'owned_profile',profile,templateProfile:'default',ownershipId:'owner',provisionActionId:'action_fixture'}};
    const receipt={status:'succeeded',botProvision:{schemaVersion:1,mode:'owned_profile',workspace:context.workspace,employeeId:context.employeeId,deviceId:context.deviceId,profile,templateProfile:'default',ownershipId:'owner',provisionActionId:'action_fixture',home,profileHome:home,nativeVersion:'0.21.3',authentication:'configured',authMode:'source-native-store'}};
    const processExit={launched:true,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
    const finalize=extra=>finalizeOwnedProfileProvision({context,baseHome:root,receipt,processExit,...extra});
    assert.equal(finalize().result.botProvision.authentication,'configured');
    for(const patch of [{launched:false},{rootConfirmed:false},{rootExitCode:3},{cancelled:true},{activeProcesses:1}])assert.equal(finalize({processExit:{...processExit,...patch}}).code,'EXECUTION_UNCERTAIN');
    assert.equal(finalize({receipt:{status:'succeeded',botProvision:{}}}).code,'EXECUTION_UNCERTAIN');
    fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: custom:missing\nproviders:\n  missing:\n    key_env: OWNED_FIXTURE_ABSENT_KEY\n');
    assert.equal(finalize().result.botProvision.authentication,'required','template credentials cannot authenticate a different requested provider');
    fs.writeFileSync(path.join(home,'ziwei-instance.json'),JSON.stringify({...metadata,sourceHome:path.resolve('other-source')}));
    assert.equal(hermesProfileReadiness(profile,{baseHome:root}).code,'profile_binding_invalid');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
