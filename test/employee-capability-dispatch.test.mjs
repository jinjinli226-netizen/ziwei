import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {actionExecutionTimeoutMs,actionExecutionLeaseMs} from '../src/action-execution-budget.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';

test('inspection dispatch uses metadata collector without runtime execution, credentials or Bot initialization',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-inventory-dispatch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const subject={workspace:'test',workspaceId:'ws',employeeId:'employee-one',ownerUserId:null,deviceId:'pc-one',runtime:'Codex',profile:null,revision:null,controlEpoch:null,configFingerprint:'a'.repeat(64)};
  let calls=0;
  const execute=createLocalActionExecutor({runtimeDir:root,defaultWorkdir:root,workspace:'test',deviceId:'pc-one',machineCapabilityInventory:async()=>({items:[]}),capabilityCollector:async input=>{calls++;assert.deepEqual(input.subject,subject);assert.equal(input.runtimeContext.cwd,root);assert.equal(input.config.permissionMode,'read_only');return{schemaVersion:1,subject,source:'device_readonly',sections:{}};}});
  t.after(()=>execute.close());
  const action={id:'inspect-one',type:'employee.capabilities.inspect',payload:{workspace:'test',deviceId:'pc-one',runtime:'Codex',profile:null,capabilityInspection:{schemaVersion:1,subject,config:{permissionMode:'read_only'},runtimeContext:{homeCandidate:'private-ignore'}}}};
  const result=await execute(action);
  assert.equal(result.status,'succeeded');assert.equal(calls,1);assert.deepEqual(result.result.employeeCapabilities.subject,subject);
  await assert.rejects(execute({...action,payload:{...action.payload,deviceId:'pc-other'}}));
  await assert.rejects(execute({...action,payload:{...action.payload,hermesBot:{employeeId:'foreign'}}}));
  assert.equal(calls,1);
  assert.deepEqual(fs.readdirSync(root),[]);
  assert.equal(actionExecutionTimeoutMs({...action,payload:{timeoutMs:999999999}}),15000);
  assert.equal(actionExecutionLeaseMs(action),60000);
});

test('dispatcher inspects the configured employee directory instead of the daemon directory',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-inventory-cwd-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bridge=path.join(root,'bridge'),project=path.join(root,'employee-project');fs.mkdirSync(bridge);fs.mkdirSync(project);
  const subject={workspace:'test',employeeId:'employee-one',deviceId:'pc-one',runtime:'Codex',profile:null,revision:null,controlEpoch:null};
  let inspected;
  const execute=createLocalActionExecutor({runtimeDir:bridge,defaultWorkdir:bridge,workspace:'test',deviceId:'pc-one',machineCapabilityInventory:async()=>({items:[]}),capabilityCollector:async input=>{inspected=input.runtimeContext.cwd;return{schemaVersion:1,subject,source:'device_readonly',sections:{}};}});
  t.after(()=>execute.close());
  const dispatcher=new ActionDispatcher({execute,workdir:bridge,workspace:'test',deviceId:'pc-one'});
  const result=await dispatcher.dispatch({id:'inspect-project',type:'employee.capabilities.inspect',payload:{workspace:'test',deviceId:'pc-one',runtime:'Codex',profile:null,capabilityInspection:{schemaVersion:1,subject,config:{},runtimeContext:{cwd:project}}}});
  assert.equal(result.status,'succeeded');assert.equal(inspected,fs.realpathSync.native(project));
  assert.deepEqual(fs.readdirSync(project),[]);
});
