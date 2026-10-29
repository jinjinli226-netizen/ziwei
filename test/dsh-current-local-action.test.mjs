import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';

test('local DSH branch uses the real profile and local endpoint before any Hermes or Codex preparation',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-local-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let selected;
  const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshBaseUrl:'http://local-config.invalid',managementBootstrap:{prepare(){throw Error('must not prepare another runtime MCP');}},dshRuntime:async options=>{selected=options;return {status:'succeeded',output:'done',sessionId:'session-1'};}});
  t.after(()=>execute.close());
  const result=await execute({id:'dsh-local-1',type:'conversation.execute',payload:{runtime:'DSH',profile:'real-bot',employeeName:'display alias',prompt:'check',dshBaseUrl:'http://payload.invalid',runtimeSessionId:'session-existing',employeeId:'employee-one',conversationId:'conv-one',workdir:directory}});
  assert.equal(result.status,'succeeded');assert.equal(selected.botName,'real-bot');assert.equal(selected.baseUrl,'http://local-config.invalid');assert.equal(selected.sessionId,'session-existing');
  assert.deepEqual(selected.sessionAuthority,{actionId:'dsh-local-1',employeeId:'employee-one',conversationId:'conv-one'});
});

test('local DSH refuses a display name without a native Bot binding',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-missing-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshRuntime:()=>{throw Error('must not call runtime');}});t.after(()=>execute.close());
  await assert.rejects(execute({id:'dsh-missing',type:'conversation.execute',payload:{runtime:'DSH',employeeName:'alias',prompt:'check'}}),/真实 Bot|绑定/);
});

test('local DSH executor and dispatcher use the native session evidence end to end',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-end-to-end-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const f=await dshFixture(t);
  const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshBaseUrl:f.baseUrl,dshRuntime:options=>executeDshRuntime({...options,...f.transport})});t.after(()=>execute.close());
  const dispatcher=new ActionDispatcher({execute,workdir:directory});
  const result=await dispatcher.dispatch({id:'dsh-local-end-to-end',type:'conversation.execute',payload:{runtime:'DSH',runtime_profile:'real-bot',employeeId:'employee-one',conversationId:'conv-one',prompt:'check'}});
  assert.equal(result.status,'succeeded');assert.equal(result.result.output,'DSH 完成');assert.equal(result.result.sessionExit.botName,'real-bot');
  assert.equal(result.result.processExit,undefined);
});
