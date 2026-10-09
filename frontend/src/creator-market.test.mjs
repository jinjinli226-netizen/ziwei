import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorSelection, creatorInstancePayload } from './creator-market.js';

const ready = { ready:true, authentication:'configured', provider:'configured' };
const profile = name => ({name,readiness:ready,provider_configured:true,authentication_configured:true});
const discovery = profiles => ({workspace:'qa',devices:[{id:'pc',status:'online',management_mcp:{workspace:'qa',state:'pending'},runtimes:[{name:'Codex',cli_status:'available',available:true,readiness:ready},{name:'Hermes',cli_status:'available',available:true,profiles}]}]});

test('Creator Codex creation uses only target/runtime and personal visibility, without user-authored prompts', () => {
  const data=discovery([profile('default')]);
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Codex'}).ready,true);
  assert.deepEqual(creatorInstancePayload(data,{deviceId:'pc',runtime:'Codex'}),{targetDeviceId:'pc',runtime:'Codex',visibility:'personal'});
});
test('Hermes chooses actual ready default or a sole ready profile, never an unready default', () => {
  assert.equal(creatorSelection(discovery([profile('default'),profile('other')]),{deviceId:'pc',runtime:'Hermes'}).profile,'default');
  assert.equal(creatorSelection(discovery([profile('sole')]),{deviceId:'pc',runtime:'Hermes'}).profile,'sole');
  const data=discovery([{name:'default',readiness:{ready:false}},profile('sole')]);
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Hermes'}).profile,'sole');
  assert.deepEqual(creatorInstancePayload(data,{deviceId:'pc',runtime:'Hermes'}),{targetDeviceId:'pc',runtime:'Hermes',runtimeProfile:'sole',visibility:'personal'});
});
test('Hermes ambiguity requires selection; explicit unavailable profiles do not silently fall back', () => {
  const data=discovery([profile('a'),profile('b')]);
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Hermes'}).ready,false);
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Hermes'}).requiresProfile,true);
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Hermes',profile:'a'}).ready,true);
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Hermes',profile:'a'}).requiresProfile,true,'keep required selector mounted after choosing, to preserve keyboard focus');
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Hermes',profile:'missing'}).ready,false);
});
test('Creator preserves device/workspace/CLI readiness and accepts pending management preparation', () => {
  const data=discovery([profile('default')]);
  data.devices[0].status='offline';
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Codex'}).ready,false);
  data.devices[0].status='online'; data.devices[0].management_mcp.workspace='other';
  assert.equal(creatorSelection(data,{deviceId:'pc',runtime:'Codex'}).ready,false);
  assert.equal(creatorSelection(discovery([]),{deviceId:'pc',runtime:'Claude'}).ready,false);
});
test('Creator never describes unknown Hermes auth/provider discovery as ready',()=>{
  assert.equal(creatorSelection(discovery([{name:'default'}]),{deviceId:'pc',runtime:'Hermes'}).ready,false);
  assert.equal(creatorSelection(discovery([{name:'default'}]),{deviceId:'pc',runtime:'Hermes',profile:'default'}).ready,false);
});
