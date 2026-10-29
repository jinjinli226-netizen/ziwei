import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {ActionDispatcher} from '../src/daemon.mjs';

const action=id=>({id,type:'conversation.execute',payload:{runtime:'Hermes',employeeId:'employee',conversationId:'conversation',prompt:'fixture'}});
const retained={platform:'win32',supervisor:'windows-job',launched:true,rootPid:12345,rootConfirmed:true,rootExitCode:0,treeConfirmed:false,activeProcesses:1,backgroundProcessesRetained:true};
const stopped={...retained,treeConfirmed:true,activeProcesses:0,backgroundProcessesRetained:false,cancelled:true};

test('a structured runtime failure immediately stops its live owned tree before waiting for exit',async()=>{
  let calls=0,confirm;
  const completionEvidence=new Promise(resolve=>confirm=resolve);
  const dispatcher=new ActionDispatcher({stopGraceMs:500,execute:async(_action,context)=>{
    context.onSupervision({completionEvidence,stop:async()=>{calls++;confirm(stopped);return stopped;}});
    return {status:'failed',code:'provider_failed',error:'provider rejected',result:{output:'preserved diagnostic'}};
  }});
  const pending=dispatcher.dispatch(action('live-failure'));await setImmediate();assert.equal(calls,1);
  const result=await pending;assert.equal(result.status,'failed');assert.equal(result.code,'provider_failed');assert.equal(result.result.output,'preserved diagnostic');assert.equal(result.result.processExit.activeProcesses,0);
});

test('a failed business result also terminates descendants retained after a successful root exit',async()=>{
  let calls=0;
  const dispatcher=new ActionDispatcher({execute:async(_action,context)=>{
    context.onSupervision({completionEvidence:Promise.resolve(retained),stop:async()=>{calls++;return stopped;}});
    return {status:'failed',code:'native_receipt_failed',error:'receipt failed',result:{output:'original'}};
  }});
  const result=await dispatcher.dispatch(action('retained-failure'));assert.equal(calls,1);assert.equal(result.code,'native_receipt_failed');assert.equal(result.result.processExit.activeProcesses,0);
});

test('unconfirmed failure cleanup is attempted immediately and cannot manufacture an empty tree',async()=>{
  let calls=0;
  const dispatcher=new ActionDispatcher({stopGraceMs:20,execute:async(_action,context)=>{
    context.onSupervision({completionEvidence:Promise.resolve(retained),stop:async()=>{calls++;return retained;}});
    return {status:'failed',code:'runtime_failed',error:'failed'};
  }});
  const result=await dispatcher.dispatch(action('unconfirmed-failure'));assert.equal(calls,1);assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.processExit.activeProcesses,1);assert.equal(dispatcher.quarantined,true);
});

test('a successful CLI result continues to retain its intentional background service',async()=>{
  let calls=0;
  const dispatcher=new ActionDispatcher({execute:async(_action,context)=>{context.onSupervision({completionEvidence:Promise.resolve(retained),stop:async()=>{calls++;return stopped;}});return {status:'succeeded',result:{output:'service ready'}};}});
  const result=await dispatcher.dispatch(action('successful-service'));assert.equal(calls,0);assert.equal(result.status,'succeeded');assert.equal(result.result.processExit.backgroundProcessesRetained,true);
});
