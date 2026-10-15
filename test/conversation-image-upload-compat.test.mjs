import assert from 'node:assert/strict';
import test from 'node:test';
import {createApp} from '../backend/app.mjs';
import {readConversationImages,createConversationComposerStore} from '../frontend/src/conversation-compose.js';
import {rasterFixtures} from './fixtures/raster-images.mjs';

test('three browser image files survive authenticated send, retry, device dispatch and history byte for byte',async t=>{
  const app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,enableScheduler:false});
  const repo=app.locals.repo;
  const owner=app.locals.auth.setup({name:'Upload owner',email:'image-upload@example.test',password:'fixture-password'});
  const ws=app.locals.auth.createWorkspace(owner.user_id,{name:'Image upload',slug:'image-upload',kind:'team'}).workspace;
  const device=repo.claimDevicePairing({code:repo.createDevicePairing(ws.slug,{ownerUserId:owner.user_id,createdBy:owner.user_id,name:'Upload PC',os:'Windows'}).code});
  const employee=repo.createEmployee(ws.slug,{name:'Upload employee',runtime:'Codex',targetDeviceId:device.deviceId,visibility:'personal',ownerUserId:owner.user_id});
  const conversation=repo.createConversation(ws.slug,{employeeId:employee.id});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(()=>{repo.db.close();resolve();})));
  const base=`http://127.0.0.1:${server.address().port}`;
  const originals=[Buffer.concat([rasterFixtures.png,Buffer.from('\r\nsource=fixture')]),Buffer.concat([rasterFixtures.jpeg,Buffer.from('\0\r\n')]),rasterFixtures.progressiveJpeg];
  const files=originals.map((bytes,i)=>new File([bytes],['微信图片一.png','照片二.JPG','照片三.jpeg'][i],{type:['image/png','','image/pjpeg'][i]}));
  const store=createConversationComposerStore({makeId:()=> 'three-real-images'});
  store.updateDraft(conversation.id,'比较这三张图片');
  store.setAttachments(conversation.id,await readConversationImages(files));
  const request=store.beginSubmission(conversation.id);
  const body={content:request.draft,attachments:request.attachments,clientMessageId:request.clientMessageId};
  const send=value=>fetch(`${base}/api/conversations/${conversation.id}/messages`,{method:'POST',headers:{'content-type':'application/json',cookie:`ziwei_session=${owner.session.token}`},body:JSON.stringify(value)});
  const response=await send(body);assert.equal(response.status,201);
  const sent=await response.json();
  const retry=await send(body);assert.equal(retry.status,200);assert.equal((await retry.json()).id,sent.id);
  store.completeSubmission(request);assert.equal(store.get(conversation.id).attachments.length,0);
  const pending=repo.listA2AActions(ws.slug,{deviceId:device.deviceId}).find(action=>action.id===sent.execution.id);
  const saved=repo.getConversation(conversation.id).messages[0];
  for(const attachments of [saved.attachments,pending.payload.attachments]) {
    assert.equal(attachments.length,3);
    attachments.forEach((attachment,i)=>{assert.equal(attachment.name,files[i].name);assert.deepEqual(Buffer.from(attachment.content,'base64'),originals[i]);});
  }
  const result=await fetch(`${base}/a2a/v1/actions/${sent.execution.id}/result`,{method:'POST',headers:{'content-type':'application/json','x-ziwei-device-token':device.deviceToken},body:JSON.stringify({result:{output:'Fixture image transport complete',outputArtifacts:body.attachments}})});
  assert.equal(result.status,200);
  const history=await fetch(`${base}/api/conversations/${conversation.id}`,{headers:{cookie:`ziwei_session=${owner.session.token}`}}).then(response=>response.json());
  assert.equal(history.messages.length,2);
  history.messages[1].attachments.forEach((attachment,i)=>assert.deepEqual(Buffer.from(attachment.content,'base64'),originals[i]));
  const invalid={...body,clientMessageId:'invalid-image',attachments:[body.attachments[0],{...body.attachments[1],name:'损坏照片.JPG',content:rasterFixtures.jpeg.subarray(0,40).toString('base64')},body.attachments[2]]};
  const rejected=await send(invalid);assert.equal(rejected.status,400);assert.match(await rejected.text(),/损坏照片\.JPG/);
  assert.equal(repo.getConversation(conversation.id).messages.length,2);
  assert.equal(repo.listA2AActions(ws.slug,{status:'all'}).length,1);
});
