import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createMobileReadView,mobileRunView} from './mobile-read-view.mjs';
import {createMixedGroupStore} from './mixed-group-store.mjs';
import {mobileMixedGroup} from './mixed-group-mobile.mjs';

function fixture(t) {
  const audits=[],repo=createRepository({memory:true,onEvent:event=>audits.push(event)}),slug='test-111';
  t.after(()=>repo.db.close());
  repo.heartbeatDevice(slug,{deviceId:'response-pc',runtimes:{Codex:{status:'available'}}});
  function member(name) {
    const employee=repo.createEmployee(slug,{name,runtime:'Codex',runtimeProfile:name.toLowerCase(),targetDeviceId:'response-pc',status:'active'});
    const conversation=repo.createConversation(slug,{employeeId:employee.id});
    return {employee,conversation};
  }
  const first=member('First');
  function start(conversation=first.conversation) {
    const message=repo.addConversationMessage(conversation.id,{content:'Answer incrementally'}),actionId=message.execution.id;
    repo.ackA2AAction(actionId,{deviceId:'response-pc'});
    return actionId;
  }
  const body=(actionId,sequence=1,text='Public answer')=>({schemaVersion:1,responseId:`${actionId}:assistant`,sequence,phase:'streaming',text,format:'markdown'});
  const send=(actionId,data=body(actionId),eventId=`response-${data.sequence}`)=>repo.recordA2AEvent(actionId,{deviceId:'response-pc',eventId,type:'action.response',message:'THIS MUST NOT ENTER AUDIT',data});
  return {repo,slug,first,member,start,body,send,audits};
}

test('public response snapshots appear before completion in full/thread/mobile reads and survive other activity and reconnect reads',t=>{
  const f=fixture(t),id=f.start(),text='Visible while the task is still running '.repeat(100),data=f.body(id,2,text);
  f.send(id,data);
  f.repo.recordA2AEvent(id,{type:'action.stage',message:'Tool running',data:{stage:'tool'}});
  const stream={...data,channel:'assistant'};
  for(let read=0;read<2;read++) {
    const full=f.repo.getConversation(f.first.conversation.id),thread=f.repo.getConversation(f.first.conversation.id,{}, {view:'thread'}),mobile=createMobileReadView(f.repo).conversation(full);
    for(const conversation of [full,thread,mobile]) {
      assert.deepEqual(conversation.execution.stream,stream);
      assert.equal(conversation.messages.some(message=>message.role==='assistant'),false);
      assert.equal(JSON.stringify(conversation.execution.events).includes(text),false);
    }
  }
  assert.deepEqual(mobileRunView(f.repo.getA2AAction(id)).stream,stream);
  assert.equal(JSON.stringify(f.audits.filter(event=>event.action==='a2a.action.event')).includes('THIS MUST NOT ENTER AUDIT'),false);
  assert.equal(JSON.stringify(f.audits).includes(text),false);
  assert.equal(JSON.stringify(f.repo.listA2AEvents(id)).includes(text),false);
});

test('response sequence handles late snapshots and duplicate delivery without rolling the preview backwards',t=>{
  const f=fixture(t),id=f.start(),latest=f.body(id,10,'Latest public answer');
  const event=f.send(id,latest,'stable-response');
  assert.equal(f.send(id,latest,'stable-response').duplicate,true);
  assert.throws(()=>f.send(id,{...latest,text:'Changed'},'stable-response'),/eventId/);
  f.send(id,f.body(id,2,'Older response'),'older-response');
  assert.deepEqual(f.repo.getA2AAction(id).stream,{...latest,channel:'assistant'});
  assert.equal(f.repo.listA2AEvents(id).filter(item=>item.id===event.id).length,1);
  assert.equal(event.data.text,undefined);
});

test('terminal results replace the preview with one canonical assistant message and a new action cannot inherit an old response',t=>{
  const f=fixture(t),id=f.start();f.send(id);
  f.repo.resultA2AAction(id,{deviceId:'response-pc',status:'succeeded',result:{output:'Final authoritative answer'}});
  f.repo.resultA2AAction(id,{deviceId:'response-pc',status:'succeeded',result:{output:'Duplicate result'}});
  const conversation=f.repo.getConversation(f.first.conversation.id);
  assert.equal(conversation.execution.stream,undefined);
  assert.deepEqual(conversation.messages.filter(message=>message.role==='assistant').map(message=>message.content),['Final authoritative answer']);
  const next=f.start();assert.notEqual(next,id);assert.equal(f.repo.getConversation(f.first.conversation.id).execution.stream,undefined);
});

test('response ingress rejects another action, invalid fields and UTF-8 bodies over one MiB without storing them',t=>{
  const f=fixture(t),id=f.start(),good=f.body(id),bad=[{...good,responseId:'other-action:assistant'},{...good,sequence:0},{...good,sequence:Number.MAX_SAFE_INTEGER+1},{...good,phase:'completed'},{...good,format:'html'},{...good,stdout:'private diagnostic'}, {...good,text:null}];
  for(const data of bad)assert.throws(()=>f.send(id,data),error=>error.code==='ACTION_RESPONSE_INVALID');
  assert.throws(()=>f.send(id,{...good,text:'你'.repeat(350000)}),error=>error.status===413&&error.code==='ACTION_RESPONSE_TOO_LARGE');
  assert.equal(f.repo.listA2AEvents(id).length,0);
  f.send(id,{...good,text:'a'.repeat(1024*1024)});
  assert.equal(f.repo.getA2AAction(id).stream.text.length,1024*1024);
});

test('mixed group web and mobile runs use the same live response as their bound main conversation',t=>{
  const f=fixture(t),second=f.member('Second'),members=[f.first,second].map(({employee,conversation})=>({employeeId:employee.id,name:employee.name,runtime:'Codex',profile:employee.runtime_profile,deviceId:'response-pc',conversationId:conversation.id}));
  const store=createMixedGroupStore(f.repo),group=store.create(f.slug,{id:'mix_response',title:'Response group',members});
  const sent=store.planSend(f.slug,group.id,{content:'Please answer',messageId:'group-response-request'}),run=sent.runs[0];
  f.repo.ackA2AAction(run.actionId,{deviceId:'response-pc'});
  const data=f.body(run.actionId,3,'Group public answer '.repeat(100));f.send(run.actionId,data);
  const web=store.get(f.slug,group.id),mobile=mobileMixedGroup(web),stream=f.repo.getConversation(run.conversationId).execution.stream;
  assert.equal(stream?.text,data.text);
  assert.deepEqual(web.runs[0].stream,stream);assert.deepEqual(mobile.runs[0].stream,stream);
  assert.equal(f.repo.db.prepare('SELECT runs_json FROM mixed_groups WHERE id=?').get(group.id).runs_json.includes(data.text),false);
  assert.equal(web.messages.some(message=>message.actionId===run.actionId),false);
  f.repo.resultA2AAction(run.actionId,{deviceId:'response-pc',status:'succeeded',result:{output:'Group final'}});
  const final=store.get(f.slug,group.id);
  assert.equal(final.runs[0].stream,undefined);assert.equal(final.messages.filter(message=>message.actionId===run.actionId).length,1);
});
