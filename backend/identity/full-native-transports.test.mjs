import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createApp,attachRealtimeWebSocket} from '../app.mjs';
import {fixture,token} from './fixtures.mjs';
async function setup(t){
 const f=await fixture(),app=createApp({memory:true,enableScheduler:false,identityOptions:{env:f.env,fetch:f.fetch}}),auth=app.locals.auth;
 const user=auth.setup({email:'owner@fixture.test',name:'Owner',password:'isolated-test-password'}),{workspace}=auth.createWorkspace(user.user_id,{name:'Stream',slug:'stream-fixture',kind:'team'});
 app.locals.identity.bindings.bind({issuer:f.env.ZIWEI_IDENTITY_ISSUER,subject:'person',nativeUserId:user.user_id,workspaceIds:[workspace.id]});
 const at=token();const activate=()=>f.setCurrent({active:true,...at.payload,client_id:at.payload.azp});activate();
 const server=app.listen(0,'127.0.0.1'),wss=attachRealtimeWebSocket(server,app);await new Promise(r=>server.once('listening',r));
 const origin=`http://127.0.0.1:${server.address().port}`,headers={authorization:`Bearer ${at.raw}`};
 t.after(async()=>{for(const ws of wss.clients)ws.terminate();server.closeAllConnections();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));app.locals.botDeferredConfig.stop();app.locals.repo.db.close();f.db.close();});
 return {f,app,origin,headers,activate,deny:()=>f.setCurrent({active:false}),user};
}
test('original workspace creation stays atomic with creator binding and mobile-v2 accepts verified unified principal',async t=>{
 const f=await setup(t);
 const created=await fetch(f.origin+'/api/workspaces',{method:'POST',headers:{...f.headers,'content-type':'application/json'},body:JSON.stringify({name:'Created by unified owner',slug:'created-unified',kind:'team'})});
 assert.equal(created.status,201,await created.clone().text());const body=await created.json();
 const access=await fetch(f.origin+'/api/workspaces/created-unified/tasks',{headers:f.headers});assert.equal(access.status,200);assert.equal(body.membership.role,'owner');
 const mobile=await fetch(f.origin+'/api/workspaces/stream-fixture/mobile/notifications-v2?baseline=1',{headers:f.headers});assert.equal(mobile.status,200);assert.equal((await mobile.json()).accountId,f.user.user_id);
});
test('native WebSocket sends authorized notifications and closes after online token revocation',async t=>{
 const f=await setup(t),ws=new WebSocket(f.origin.replace('http:','ws:')+'/api/workspaces/stream-fixture/notifications/ws',{headers:{...f.headers,origin:'https://ziwei.test'}}),messages=[];
 ws.on('message',x=>messages.push(JSON.parse(String(x))));
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('ready timeout')),3000);ws.on('message',x=>{if(JSON.parse(String(x)).type==='ready'){clearTimeout(timer);resolve();}});ws.on('error',reject);});
 const good=new Promise(r=>ws.on('message',x=>{if(JSON.parse(String(x)).event?.id==='allowed')r();}));f.app.locals.realtime.publish({workspaceSlug:'stream-fixture',id:'allowed'});await good;
 const ended=new Promise(r=>ws.once('close',code=>r(code)));f.deny();f.app.locals.realtime.publish({workspaceSlug:'stream-fixture',id:'must-not-leak'});assert.equal(await ended,1008);assert.equal(messages.some(x=>x.event?.id==='must-not-leak'),false);
});
test('native SSE closes before revoked event delivery and mobile long poll rechecks current OP',async t=>{
 const f=await setup(t),controller=new AbortController(),response=await fetch(f.origin+'/api/workspaces/stream-fixture/notifications/stream',{headers:f.headers,signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/ready/);
 f.deny();f.app.locals.realtime.publish({workspaceSlug:'stream-fixture',id:'must-not-leak'});const next=await reader.read();assert.equal(next.done,true);controller.abort();
 f.activate();const baseline=await fetch(f.origin+'/api/workspaces/stream-fixture/mobile/notifications-v2?baseline=1',{headers:f.headers}),cursor=(await baseline.json()).cursor;
 const waiting=fetch(f.origin+'/api/workspaces/stream-fixture/mobile/notifications-v2/wait?'+new URLSearchParams({cursor,timeout:'1'}),{headers:f.headers});
 await new Promise(r=>setTimeout(r,60));f.deny();f.app.locals.realtime.publish({workspaceSlug:'stream-fixture',id:'wake'});assert.equal((await waiting).status,401);
});
