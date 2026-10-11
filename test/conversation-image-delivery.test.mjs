import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import {crc32,deflateSync} from 'node:zlib';
import {createApp} from '../backend/app.mjs';
import {imageArtifactDeliveryBody} from '../src/conversation-image-artifacts.mjs';

test('maximum raster image plus large diagnostics returns through actual authenticated 16 MiB API and persists unchanged',async t=>{
  const app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,enableScheduler:false});
  const repo=app.locals.repo;
  const owner=app.locals.auth.setup({name:'Delivery fixture',email:'delivery-fixture@example.test',password:crypto.randomUUID()});
  const ws=app.locals.auth.createWorkspace(owner.user_id,{name:'Image delivery fixture',slug:'image-delivery-fixture',kind:'team'}).workspace;
  const device=repo.claimDevicePairing({code:repo.createDevicePairing(ws.slug,{ownerUserId:owner.user_id,createdBy:owner.user_id,name:'Isolated fake PC',os:'Windows'}).code});
  const employee=repo.createEmployee(ws.slug,{name:'Delivery fixture',runtime:'Codex',targetDeviceId:device.deviceId});
  const conversation=repo.createConversation(ws.slug,{employeeId:employee.id});
  const sent=repo.addConversationMessage(conversation.id,{content:'Isolated delivery fixture',clientMessageId:'delivery-fixture',actorUserId:owner.user_id});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(()=>{repo.db.close();resolve();})));
  // A decodable 1x1 PNG, padded to exactly 10 MiB using a valid ancillary
  // tEXt chunk (length and CRC included), not arbitrary bytes after IEND.
  const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([length,body,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  const prefix=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,18,52,86])))]);
  const text=Buffer.alloc(10*1024*1024-prefix.length-24,120);text.write('fixture\0');
  const image=Buffer.concat([prefix,chunk('tEXt',text),chunk('IEND',Buffer.alloc(0))]);
  const output={name:'maximum.png',mimeType:'image/png',size:image.length,contentEncoding:'base64',content:image.toString('base64')};
  const body={status:'succeeded',result:{runtime:'Codex',output:'最大图片内容完整保留',diagnostics:'d'.repeat(3*1024*1024),outputArtifacts:[output]},error:null};
  assert.ok(Buffer.byteLength(JSON.stringify(body))>16*1024*1024);
  const delivery=imageArtifactDeliveryBody(body);const json=JSON.stringify(delivery);
  assert.ok(Buffer.byteLength(json)<=15*1024*1024);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/a2a/v1/actions/${sent.execution.id}/result`,{method:'POST',headers:{'content-type':'application/json','x-ziwei-device-token':device.deviceToken},body:json});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'succeeded');
  const reply=repo.getConversation(conversation.id).messages.at(-1);
  assert.equal(reply.role,'assistant');assert.equal(reply.attachments[0].size,image.length);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(reply.attachments[0].content,'base64')).digest('hex'),crypto.createHash('sha256').update(image).digest('hex'));
  assert.equal(repo.getA2AAction(sent.execution.id).result.truncated,true);
  assert.equal(repo.getA2AAction(sent.execution.id).result.truncationReason,'action_result_json_budget');
});
