import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneConfigurationMatches, phoneOnline, phoneRuntimeReadiness, phoneSetupPhase } from './phone-skill.js';
const form = { enabled:true, targetDeviceId:'pc', runtime:'Codex', runtimeProfile:'named', phoneDeviceId:'phone' };
const setup = { workspace:'phone_ai',computers:[{id:'pc',status:'online',terminal_mcp:{configured:true,workspace:'phone_ai',supportedRuntimes:['Codex','Hermes']},runtimes:[{name:'Codex',cli_status:'available',profiles:[{name:'named',readiness:{ready:true}}]}]}],phones:[{id:'phone',control:{role:'agent'},nodes:[{role:'agent',status:'online'}]}] };
const status = () => ({ configuration:{saved:true,enabled:true,revision:'rev-1',target_device_id:'pc',runtime:'Codex',runtime_profile:'named',phone_device_id:'phone'},api:{status:'healthy'},receipt:{status:'never_run'},verification:{status:'never_run'} });
test('saved configuration, API health and injection never prove MCP loading or real-device success', () => {
  const value=status(); assert.equal(phoneSetupPhase(value,setup,form).code,'saved'); value.receipt={injected:true}; assert.equal(phoneSetupPhase(value,setup,form).code,'pending'); value.receipt.loaded=true; assert.equal(phoneSetupPhase(value,setup,form).code,'loaded');
});
test('actual command success must match exact phone and configuration revision', () => {
  const value=status(); value.receipt.loaded=true; value.verification={status:'succeeded',command_id:'command',device_id:'phone',configuration_revision:'old'}; assert.equal(phoneSetupPhase(value,setup,form).code,'loaded'); value.verification.configuration_revision='rev-1'; value.verification.device_id='other'; assert.equal(phoneSetupPhase(value,setup,form).code,'loaded'); value.verification.device_id='phone'; assert.equal(phoneSetupPhase(value,setup,form).code,'verified'); value.verification.command_id=''; assert.equal(phoneSetupPhase(value,setup,form).code,'loaded');
});
test('edited runtime/profile, computer, phone and account mapping invalidate earlier evidence', () => {
  for (const change of [{runtime:'Hermes'},{runtimeProfile:'other'},{targetDeviceId:'other'},{phoneDeviceId:'other'},{accountId:'other'},{accountLabel:'other'}]) assert.equal(phoneConfigurationMatches(status().configuration,{...form,...change}),false);
  assert.equal(phoneSetupPhase(status(),setup,{...form,runtimeProfile:'other'}).code,'dirty');
});
test('unconfigured, offline computer, offline phone and authentication failure remain distinct', () => {
  const value=status(); assert.equal(phoneSetupPhase({...value,configuration:{saved:false}},setup,form).code,'unconfigured'); assert.equal(phoneSetupPhase(value,{...setup,computers:[]},form).code,'waiting_computer'); assert.equal(phoneSetupPhase(value,{...setup,phones:[]},form).code,'waiting_phone'); value.receipt.error={code:'authentication_failed',message:'认证失败'}; assert.equal(phoneSetupPhase(value,setup,form).code,'authentication_failed');
});
test('paused or draining phone control is unavailable even if cached online flag remains true', () => {
  assert.equal(phoneOnline({...setup.phones[0],online:true,control:{role:null}}),false); assert.equal(phoneOnline({...setup.phones[0],control:{role:'agent',draining:true}}),false); assert.equal(phoneOnline(setup.phones[0]),true);
});

test('phone MCP adapter must report the exact workspace and selected runtime before detection', () => {
  for (const terminal_mcp of [{configured:false},{configured:true,workspace:'other',supportedRuntimes:['Codex']},{configured:true,workspace:'phone_ai',supportedRuntimes:['Hermes']}]) {
    const discovery={...setup,computers:[{...setup.computers[0],terminal_mcp}]};
    assert.equal(phoneRuntimeReadiness(discovery,form).ready,false);
    assert.equal(phoneSetupPhase(status(),discovery,form).code,'waiting_computer');
  }
  assert.equal(phoneRuntimeReadiness(setup,form).ready,true);
});

test('automatic management default does not remove phone MCP independent Hermes profile requirement', () => {
  const discovery={...setup,computers:[{...setup.computers[0],runtimes:[{name:'Hermes',cli_status:'available',profiles:[{name:'default',readiness:{ready:true}},{name:'phone-independent',readiness:{ready:true}}]}]}]};
  assert.equal(phoneRuntimeReadiness(discovery,{...form,runtime:'Hermes',runtimeProfile:'default'}).ready,false);
  assert.equal(phoneRuntimeReadiness(discovery,{...form,runtime:'Hermes',runtimeProfile:'phone-independent'}).ready,true);
});
