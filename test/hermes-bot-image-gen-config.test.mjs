import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse, stringify} from 'yaml';
import {prepareHermesBotHome,ownedProfileMetadata} from '../src/hermes-bot-runtime.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-native-image-config-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'config.yaml'),stringify({model:{provider:'openai-codex',default:'template-chat'},image_gen:{provider:'template-image'}}));
  fs.writeFileSync(path.join(root,'auth.json'),'TEMPLATE_PRIVATE_AUTH');
  return {root,profile(name,image_gen){
    const home=path.join(root,'profiles',name);fs.mkdirSync(home,{recursive:true});
    const context={workspace:'image-test',employeeId:'employee_'+name,deviceId:'pc',revision:1,sourceProfile:name,name,model:'gpt-6.1-sol',
      config:{toolsets:['image_gen'],permissions:{mode:'execute'}},
      instance:{mode:'owned_profile',profile:name,templateProfile:'default',ownershipId:name+'-owner',provisionActionId:'action_'+name}};
    fs.writeFileSync(path.join(home,'ziwei-instance.json'),JSON.stringify(ownedProfileMetadata({context,sourceHome:root,apiBase:'https://fixture.invalid'})));
    fs.writeFileSync(path.join(home,'config.yaml'),stringify({model:{provider:'openai-codex',default:'gpt-6.1-sol'},...(image_gen?{image_gen}:{})}));
    fs.writeFileSync(path.join(home,'auth.json'),'PROFILE_PRIVATE_AUTH_'+name);
    fs.writeFileSync(path.join(home,'state.db'),'OWNED_HISTORY_'+name);
    return {context,sourceHome:home,privateDirectory:path.join(root,'unused'),workspace:'image-test',apiBase:'https://fixture.invalid'};
  }};
}

test('owned native image provider and model survive two real prepares without copying private settings or changing chat route',t=>{
  const f=fixture(t),settings={provider:'openai-codex',model:'gpt-image-2-medium','openai-codex':{model:'gpt-image-2-high',api_key:'SECRET_NESTED'},api_key:'SECRET_IMAGE',headers:{authorization:'SECRET_HEADER'}};
  const options=f.profile('bot-growth',settings);
  const first=prepareHermesBotHome(options);
  const second=prepareHermesBotHome({...options,context:{...options.context,revision:2}});
  const saved=parse(fs.readFileSync(path.join(second.home,'config.yaml'),'utf8'));
  assert.deepEqual(first.config.image_gen,{provider:settings.provider,model:settings.model,'openai-codex':{model:'gpt-image-2-high'}});
  assert.deepEqual(saved.image_gen,first.config.image_gen);
  assert.deepEqual(saved.model,first.config.model);
  assert.equal(saved.model.provider,'openai-codex');assert.equal(saved.model.default,'gpt-6.1-sol');
  assert.doesNotMatch(JSON.stringify(saved),/SECRET/);
  assert.equal(fs.readFileSync(path.join(second.home,'auth.json'),'utf8'),'PROFILE_PRIVATE_AUTH_bot-growth');
  assert.equal(fs.readFileSync(path.join(second.home,'state.db'),'utf8'),'OWNED_HISTORY_bot-growth');
  assert.equal(fs.readFileSync(path.join(f.root,'auth.json'),'utf8'),'TEMPLATE_PRIVATE_AUTH');
});

test('native image selection made between prepares is read next round and stays within its own Profile',t=>{
  const f=fixture(t),a=f.profile('bot-growth'),b=f.profile('bot-other',{provider:'openai',openai:{model:'gpt-image-2-low'}});
  const first=prepareHermesBotHome(a);prepareHermesBotHome(b);
  assert.equal(first.config.image_gen,undefined,'template image provider must not be borrowed');
  const configPath=path.join(first.home,'config.yaml'),native=parse(fs.readFileSync(configPath,'utf8'));
  native.image_gen={provider:'openai-codex','openai-codex':{model:'gpt-image-2-medium'}};
  fs.writeFileSync(configPath,stringify(native));
  const second=prepareHermesBotHome(a),other=prepareHermesBotHome(b);
  assert.deepEqual(second.config.image_gen,native.image_gen);
  assert.deepEqual(other.config.image_gen,{provider:'openai',openai:{model:'gpt-image-2-low'}});
});
