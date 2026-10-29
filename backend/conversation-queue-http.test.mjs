import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {IncomingMessage,ServerResponse} from 'node:http';
import {createApp} from './app.mjs';
import {fixture as identityFixture,token} from './identity/fixtures.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

function handle(app,url,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const data=body?JSON.stringify(body):null,req=new IncomingMessage(new PassThrough());if(data)req.push(data);req.push(null);req.complete=true;
  Object.assign(req,{method,url,headers:{host:'ziwei.test',...(data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{}),...headers}});
  const res=new ServerResponse(req);res.end=function(chunk){const text=chunk?Buffer.from(chunk).toString('utf8'):'';let body;try{body=JSON.parse(text);}catch{body=text;}resolve({status:this.statusCode,body});return this;};
  app.handle(req,res,error=>{if(error)return reject(error);res.statusCode=404;res.end('{}');});
 });
}

test('queue HTTP uses unified human identity, write roles, membership and the exact conversation binding',async t=>{
 const identity=await identityFixture();t.after(()=>identity.db.close());
 const app=createApp({memory:true,enableScheduler:false,identityOptions:{env:identity.env,fetch:identity.fetch}}),repo=app.locals.repo;t.after(()=>repo.db.close());
 const account=app.locals.auth.setup({email:'queue@example.test',password:'queue-fixture-only-password'}),{workspace}=app.locals.auth.createWorkspace(account.user_id,{name:'Queue',slug:'queue-http',kind:'team'});
 app.locals.identity.bindings.bind({issuer:identity.env.ZIWEI_IDENTITY_ISSUER,subject:'person',nativeUserId:account.user_id,workspaceIds:[workspace.id]});
 const person=token(),headers={authorization:'Bearer '+person.raw};identity.setCurrent({active:true,...person.payload,client_id:person.payload.azp});
 const employee=repo.createEmployee(workspace.slug,{name:'HTTP queue',runtime:'Codex',ownerUserId:account.user_id}),conversation=repo.createConversation(workspace.slug,{employeeId:employee.id}),base=`/api/conversations/${conversation.id}`;
 const first=await handle(app,base+'/messages',{method:'POST',headers,body:{content:'FIRST',clientMessageId:'first'}});assert.equal(first.status,201);assert.equal(first.body.queue_status,'queued');
 const image=rasterFixtures.png.toString('base64');
 const second=await handle(app,base+'/messages',{method:'POST',headers,body:{content:'SECOND',clientMessageId:'second',attachments:[{name:'queue.png',mimeType:'image/png',contentEncoding:'base64',content:image}]}});assert.equal(second.status,201);assert.equal(second.body.queue.count,2);assert.notEqual(first.body.execution.id,second.body.execution.id);
 const thread=await handle(app,base+'?view=thread',{headers});assert.equal(thread.status,200);assert.equal(thread.body.queue.items[1].attachments[0].name,'queue.png');assert.equal(JSON.stringify(thread.body).includes(image),false,'paged reads never repeat pending inline image bytes');
 assert.equal((await handle(app,base+'/queue/pause',{method:'POST',headers})).body.queue.paused,true);
 assert.equal((await handle(app,base+'/queue/'+second.body.execution.id,{method:'DELETE',headers})).body.queue.count,1);
 const detail=await handle(app,base,{headers});assert.equal(detail.body.messages[1].queue_status,'cancelled');
 assert.equal((await handle(app,base+'/queue/resume',{method:'POST',headers})).body.queue.paused,false);
 const other=repo.createConversation(workspace.slug,{employeeId:employee.id});
 assert.equal((await handle(app,`/api/conversations/${other.id}/queue/${first.body.execution.id}`,{method:'DELETE',headers})).status,404);
 assert.equal((await handle(app,base+'/queue/pause',{method:'POST'})).status,403);
 identity.setCurrent({active:true,...person.payload,client_id:person.payload.azp,resource_access:{'ziwei-workspace-api':{roles:['access','read']}}});
 assert.equal((await handle(app,base+'/queue/pause',{method:'POST',headers})).status,403);
 identity.setCurrent({active:true,...person.payload,client_id:person.payload.azp});
 app.locals.identity.bindings.bind({issuer:identity.env.ZIWEI_IDENTITY_ISSUER,subject:'queue-employee',nativeUserId:account.user_id,workspaceIds:[workspace.id],kind:'employee',employeeId:employee.id});
 const worker=token({sub:'queue-employee'}),workerHeaders={authorization:'Bearer '+worker.raw};identity.setCurrent({active:true,...worker.payload,client_id:worker.payload.azp});
 assert.equal((await handle(app,`/api/workspaces/${workspace.slug}/employees/${employee.id}/capability-inventory`,{headers:workerHeaders})).status,200);
 for(const [url,method] of [[base,'GET'],[base+'/queue/pause','POST'],[base+'/queue/'+first.body.execution.id,'DELETE']])assert.equal((await handle(app,url,{method,headers:workerHeaders})).status,403,'queue must not expand an employee identity beyond its native resource scope');
 identity.setCurrent({active:true,...person.payload,client_id:person.payload.azp});
 repo.db.prepare('DELETE FROM members WHERE user_id=?').run(account.user_id);
 assert.equal((await handle(app,base+'/queue/pause',{method:'POST',headers})).status,403);
 assert.equal(repo.getConversation(conversation.id).queue.count,1);
});
