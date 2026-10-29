import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {IncomingMessage,ServerResponse} from 'node:http';
import {createApp} from './app.mjs';
import {fixture as identityFixture,token} from './identity/fixtures.mjs';
import {createRuntimeDiscovery} from '../src/dsh-runtime-discovery.mjs';
import {employeeReadiness} from '../frontend/src/management-mcp.js';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {createActionDelivery} from '../src/daemon-action-delivery.mjs';
import {executeDshRuntime} from '../src/dsh-runtime.mjs';
import {dshFixture} from '../test/fixtures/dsh-protocol.mjs';

function handle(app,url,{method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const data=body?JSON.stringify(body):null,req=new IncomingMessage(new PassThrough());if(data)req.push(data);req.push(null);req.complete=true;
    Object.assign(req,{method,url,headers:{host:'ziwei.test',...(data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{}),...headers}});
    const res=new ServerResponse(req);res.end=function(chunk){resolve({status:this.statusCode,body:JSON.parse(chunk?Buffer.from(chunk).toString('utf8'):'{}')});return this;};
    app.handle(req,res,error=>{if(error)return reject(error);res.statusCode=404;res.end('{}');});
  });
}

test('unified web identity can discover, bind and chat with DSH through the actual current delivery and native protocol',async t=>{
  const identity=await identityFixture();t.after(()=>identity.db.close());
  const app=createApp({memory:true,enableScheduler:false,identityOptions:{env:identity.env,fetch:identity.fetch}}),repo=app.locals.repo;t.after(()=>repo.db.close());
  const account=app.locals.auth.setup({email:'dsh-web@example.test',password:'isolated-test-password'}),{workspace}=app.locals.auth.createWorkspace(account.user_id,{name:'DSH Web',slug:'dsh-web-http',kind:'team'});
  app.locals.identity.bindings.bind({issuer:identity.env.ZIWEI_IDENTITY_ISSUER,subject:'person',nativeUserId:account.user_id,workspaceIds:[workspace.id]});
  const person=token(),headers={authorization:'Bearer '+person.raw};identity.setCurrent({active:true,...person.payload,client_id:person.payload.azp});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-web-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const discover=createRuntimeDiscovery({discoverCli:()=>({runtimes:{}}),fetchImpl:async()=>({ok:true,json:async()=>({bots:[{name:'alpha',running:true,ready:true}]})})});
  repo.heartbeatDevice(workspace.slug,{deviceId:'dsh-web-pc',ownerUserId:account.user_id,workdir:directory,runtimes:(await discover()).runtimes});
  const environment=await handle(app,`/api/workspaces/${workspace.slug}/mcp/discovery`,{headers});assert.equal(environment.status,200);
  assert.equal(employeeReadiness(environment.body,{deviceId:'dsh-web-pc',runtime:'DSH',profile:'alpha'}).ready,true);
  const created=await handle(app,`/api/workspaces/${workspace.slug}/employees`,{method:'POST',headers,body:{name:'DSH Web Partner',runtime:'DSH',runtimeProfile:'alpha',targetDeviceId:'dsh-web-pc',model:null,idempotencyKey:'employee'}});
  assert.equal(created.status,201);assert.equal(created.body.runtime_profile,'alpha');
  const conversation=await handle(app,`/api/workspaces/${workspace.slug}/conversations`,{method:'POST',headers,body:{employeeId:created.body.id}});assert.equal(conversation.status,201);
  const sent=await handle(app,`/api/conversations/${conversation.body.id}/messages`,{method:'POST',headers,body:{content:'check current native session',clientMessageId:'first'}});assert.equal(sent.status,201);
  const protocol=await dshFixture(t);let delivery;
  const execute=createLocalActionExecutor({runtimeDir:path.join(directory,'runtime'),defaultWorkdir:directory,dshBaseUrl:protocol.baseUrl,dshRuntime:options=>executeDshRuntime({...options,...protocol.transport})});t.after(()=>execute.close());
  const dispatcher=new ActionDispatcher({workdir:directory,workspace:workspace.slug,deviceId:'dsh-web-pc',stateFile:path.join(directory,'state.json'),execute,onEvent:(type,event)=>{if(['action.started','action.output','action.stage','action.progress'].includes(type))delivery?.recordEvent(event.actionId,type,event);}});
  delivery=createActionDelivery({directory:path.join(directory,'delivery'),identity:{apiBase:'https://web-fixture.invalid',workspace:workspace.slug,deviceId:'dsh-web-pc'},retryDelays:[],dispatch:action=>dispatcher.dispatch(action),post:async(url,body)=>{const id=decodeURIComponent(url.split('/')[4]),input={...body,deviceId:'dsh-web-pc'};return url.endsWith('/ack')?repo.ackA2AAction(id,input):url.endsWith('/events')?repo.recordA2AEvent(id,input):repo.resultA2AAction(id,input);}});
  assert.equal((await delivery.execute(repo.getA2AAction(sent.body.execution.id))).state,'confirmed');
  const detail=await handle(app,`/api/conversations/${conversation.body.id}?view=thread`,{headers});assert.equal(detail.status,200);assert.equal(detail.body.execution.status,'succeeded');assert.equal(detail.body.runtime_session_runtime,'DSH');assert.equal(detail.body.runtime_session_id,'alpha-session-1');assert.equal(detail.body.messages.at(-1).content,'DSH 完成');
  identity.setCurrent({active:false});assert.equal((await handle(app,`/api/conversations/${conversation.body.id}`,{headers})).status,401);
});
