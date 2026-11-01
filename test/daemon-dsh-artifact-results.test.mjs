import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRepository} from '../backend/repository.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';

test('DSH dispatcher persists attachment descriptors and input paths with the real native session receipt',async t=>{
 const protocol=await dshFixture(t),repo=createRepository({memory:true}),root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-artifacts-'));
 t.after(()=>{repo.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const deviceId='device-dsh-artifact',workspace='test-111',stateFile=path.join(root,'action-state.json');
 repo.heartbeatDevice(workspace,{deviceId,runtimes:{DSH:{status:'available',version:'0.2.1'}}});
 const employee=repo.createEmployee(workspace,{name:'DSH artifact fixture',runtime:'DSH',runtimeProfile:'bot-real',targetDeviceId:deviceId});
 const conversation=repo.createConversation(workspace,{employeeId:employee.id}),message=repo.addConversationMessage(conversation.id,{content:'Synthetic fixture turn'}),action=repo.getA2AAction(message.execution.id);
 const artifacts=[{path:path.join(root,'output.bin'),name:'output.bin',mimeType:'application/octet-stream',size:500*1024*1024,sha256:'a'.repeat(64)}],inputs=[{path:path.join(root,'input.bin'),bytes:500*1024*1024,nativeVision:false}];
 const dispatcher=new ActionDispatcher({workdir:root,stateFile,workspace,deviceId,execute:async(original,context)=>{
  const native=await executeDshRuntime({baseUrl:protocol.baseUrl,...protocol.transport,botName:'bot-real',prompt:original.payload.prompt,signal:context.signal,sessionAuthority:{actionId:original.id,employeeId:employee.id,conversationId:conversation.id},onSessionSupervision:context.onDshSessionSupervision});
  return{status:native.status,result:{...native,outputArtifacts:artifacts,inputAttachments:inputs}};
 }});
 const result=await dispatcher.dispatch(action);
 assert.equal(result.status,'succeeded');assert.deepEqual(result.result.outputArtifacts,artifacts);assert.deepEqual(result.result.inputAttachments,inputs);
 assert.equal(result.result.sessionExit.terminalConfirmed,true);assert.equal(result.result.processExit,undefined);
 assert.deepEqual(JSON.parse(fs.readFileSync(stateFile)).completed[0].result.result.outputArtifacts,artifacts);
 assert.equal(protocol.calls.filter(x=>x.method==='session/prompt').length,1);
});
