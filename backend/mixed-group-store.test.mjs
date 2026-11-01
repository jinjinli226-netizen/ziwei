import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from './repository.mjs';
import { createMixedGroupStore } from './mixed-group-store.mjs';

const roster = [
  { employeeId: 'hermes-1', name: 'Hermes', runtime: 'Hermes', profile: 'bot-hermes', deviceId: 'pc-1', conversationId: 'conv-hermes' },
  { employeeId: 'dsh-1', name: 'DSH', runtime: 'DSH', profile: 'community-lead', deviceId: 'pc-1', conversationId: 'conv-dsh', sessionId: 'session-dsh' },
  { employeeId: 'codex-1', name: 'Codex', runtime: 'Codex', profile: 'default', deviceId: 'pc-1', conversationId: 'conv-codex' },
];

test('mixed group store persists one workspace roster and exposes deterministic send plan', () => {
  const repo = createRepository({ memory: true });
  try {
    repo.heartbeatDevice('test-111', { deviceId: 'pc-1', runtimes: { Hermes: { status: 'available' }, DSH: { status: 'available' }, Codex: { status: 'available' } } });
    const actualRoster = roster.map(member => {
      const employee = repo.createEmployee('test-111', { name: member.name, runtime: member.runtime, runtimeProfile: member.profile, targetDeviceId: 'pc-1', status: 'active' });
      const conversation = repo.createConversation('test-111', { employeeId: employee.id, title: `${member.name} · 混合群` });
      return { ...member, employeeId: employee.id, conversationId: conversation.id };
    });
    const store = createMixedGroupStore(repo);
    const created = store.create('test-111', { id: 'mix_store', title: '混合群', members: actualRoster });
    assert.equal(created.members.length, 3);
    assert.equal(created.state, 'planned', 'a new group has not completed a member turn');
    assert.equal(store.list('test-111')[0].id, 'mix_store');
    const planned = store.planSend('test-111', 'mix_store', { content: '@community-lead 请先回复' });
    assert.equal(planned.state, 'dispatched');
    assert.equal(planned.plan.members.length, 1);
    assert.equal(planned.execution, 'conversation_execute');
    assert.throws(() => store.create('test-111', { id: 'mix_store', title: '重复', members: actualRoster }), /已存在/);
  } finally { repo.db.close(); }
});

test('mixed group store keeps DSH native group storage separate', () => {
  const repo = createRepository({ memory: true });
  try {
    repo.heartbeatDevice('test-111', { deviceId: 'pc-1', runtimes: { Hermes: { status: 'available' }, DSH: { status: 'available' }, Codex: { status: 'available' } } });
    const actualRoster = roster.map(member => {
      const employee = repo.createEmployee('test-111', { name: member.name, runtime: member.runtime, runtimeProfile: member.profile, targetDeviceId: 'pc-1', status: 'active' });
      const conversation = repo.createConversation('test-111', { employeeId: employee.id, title: `${member.name} · 混合群` });
      return { ...member, employeeId: employee.id, conversationId: conversation.id };
    });
    const store = createMixedGroupStore(repo);
    store.create('test-111', { id: 'mix_separate', title: '独立混合群', members: actualRoster });
    assert.equal(repo.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mixed_groups'").get().name, 'mixed_groups');
    assert.equal(repo.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='management_requests'").get().name, 'management_requests');
  } finally { repo.db.close(); }
});
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';

test('mixed attachments clone metadata into isolated member scopes without copying bytes, retrying or losing output artifacts', async()=>{
 const base=process.platform==='win32'?'D:/tmp/ziwei-attachment-tests':os.tmpdir();fs.mkdirSync(base,{recursive:true});
 const dir=fs.mkdtempSync(path.join(base,'mixed-ref-')),repo=createRepository({memory:true,objectStoreDir:dir});
 try{
  repo.heartbeatDevice('test-111',{deviceId:'pc-1',runtimes:{Hermes:{status:'available'},DSH:{status:'available'},Codex:{status:'available'}}});
  const members=roster.map(member=>{const e=repo.createEmployee('test-111',{name:member.name,runtime:member.runtime,runtimeProfile:member.profile,targetDeviceId:'pc-1',status:'active'});const c=repo.createConversation('test-111',{employeeId:e.id,title:member.name});return {...member,employeeId:e.id,conversationId:c.id};});
  const store=createMixedGroupStore(repo),group=store.create('test-111',{id:'mix_refs',title:'Refs',members}),scope={workspaceId:repo.getWorkspace('test-111').id,conversationId:members[0].conversationId};
  const upload=repo.conversationAttachmentStore.create(scope,{name:'report.txt',mimeType:'text/plain',size:5});
  await repo.conversationAttachmentStore.append(scope,upload.uploadId,0,Readable.from(['hello']));
  const ref=await repo.conversationAttachmentStore.complete(scope,upload.uploadId),input={content:'',attachments:[ref],attachmentSourceConversationId:scope.conversationId,messageId:'one-message'};
  const sent=store.planSend('test-111',group.id,input);assert.equal(sent.runs.length,3);
  const original=repo.db.prepare('SELECT storage_key FROM conversation_attachments WHERE attachment_id=?').get(ref.attachmentId);
  for(const run of sent.runs){
   const action=repo.getA2AAction(run.actionId,{workspaceSlug:'test-111'}),attachment=action.payload.attachments[0];
   assert.notEqual(attachment.attachmentId,ref.attachmentId);
   assert.equal(repo.conversationAttachmentStore.resolve({...scope,conversationId:run.conversationId},[attachment])[0].size,5);
   assert.equal(repo.db.prepare('SELECT storage_key FROM conversation_attachments WHERE attachment_id=?').get(attachment.attachmentId).storage_key,original.storage_key);
  }
  const refs=repo.db.prepare('SELECT COUNT(*) AS n FROM conversation_attachments').get().n;
  assert.deepEqual(store.planSend('test-111',group.id,input).runs.map(run=>run.actionId),sent.runs.map(run=>run.actionId));
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM conversation_attachments').get().n,refs);
  assert.throws(()=>store.planSend('test-111',group.id,{...input,messageId:'wrong',attachmentSourceConversationId:'foreign'}),/附件来源/);
  assert.throws(()=>store.planSend('test-111',group.id,{...input,messageId:'wrong',attachments:[{...ref,attachmentId:'foreign'}]}),/not found/);
  const first=sent.runs[0],outScope={...scope,conversationId:first.conversationId,actionId:first.actionId};
  const out=repo.conversationAttachmentStore.create(outScope,{name:'result.txt',mimeType:'text/plain',size:2});await repo.conversationAttachmentStore.append(outScope,out.uploadId,0,Readable.from(['ok']));
  const artifact=await repo.conversationAttachmentStore.complete(outScope,out.uploadId);
  repo.resultA2AAction(first.actionId,{status:'succeeded',result:{output:'Done',outputArtifacts:[artifact]}});
  const view=store.get('test-111',group.id),reply=view.messages.find(message=>message.actionId===first.actionId);
  assert.equal(reply.attachments[0].attachmentId,artifact.attachmentId);
  assert.equal(reply.attachments[0].conversationId,first.conversationId);
  assert.match(reply.attachments[0].downloadUrl,/download=1$/);
  const persisted=repo.db.prepare('SELECT messages_json,runs_json FROM mixed_groups WHERE id=?').get(group.id);
  assert.equal(persisted.messages_json.includes('downloadUrl'),false);assert.equal(persisted.messages_json.includes('contentEncoding'),false);
  assert.equal(JSON.parse(persisted.messages_json).filter(message=>message.id==='one-message').length,1);
 }finally{repo.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
