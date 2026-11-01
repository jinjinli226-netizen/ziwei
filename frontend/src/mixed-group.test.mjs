import test from 'node:test';
import assert from 'node:assert/strict';
import * as mixedGroup from './mixed-group.js';
const {mixedGroupMemberDescriptor,mixedGroupStatus}=mixedGroup;

test('mixed group descriptors retain runtime and isolated bindings',()=>{
  const value=mixedGroupMemberDescriptor({id:'e1',name:'DSH',runtime:'DSH',runtime_profile:'community-lead',target_device_id:'pc',main_conversation_id:'conv'});
  assert.deepEqual(value,{employeeId:'e1',name:'DSH',runtime:'DSH',profile:'community-lead',deviceId:'pc',conversationId:'conv'});
});

test('group members stream distinct bound answers and terminal messages replace their previews',()=>{
 const messages=[{id:'u',role:'user',text:'请协作'}],runs=['ceo','writer'].map(employeeId=>({employeeId,actionId:'action-'+employeeId,runtime:'Codex',status:'running',stream:{channel:'assistant',messageId:'stream:'+employeeId,sequence:1,text:employeeId+'的正文'}}));
 const group={messages,runs};
 const rows=mixedGroup.mixedGroupMessages?.(group)||[];
 assert.equal(rows.length,3);assert.equal(rows[1].text,'ceo的正文');assert.equal(rows[2].text,'writer的正文');assert.equal(rows[1].actionId,'action-ceo');
 runs[0].status='succeeded';messages.push({id:'final-ceo',role:'assistant',actionId:'action-ceo',employeeId:'ceo',text:'正式CEO结果'});
 const final=mixedGroup.mixedGroupMessages(group);assert.equal(final.filter(row=>row.employeeId==='ceo').length,1);assert.equal(final.find(row=>row.employeeId==='ceo').text,'正式CEO结果');
 assert.equal(final.find(row=>row.employeeId==='writer').streaming,true);
 assert.equal(messages.length,2);
});

test('mixed group status distinguishes running, partial, unknown and terminal runs',()=>{
  assert.equal(mixedGroupStatus({runs:[]}), 'planned');
  assert.equal(mixedGroupStatus({runs:[{status:'pending'}]}), 'running');
  assert.equal(mixedGroupStatus({runs:[{status:'succeeded'},{status:'pending'}]}), 'partial');
  assert.equal(mixedGroupStatus({runs:[{status:'expired'}]}), 'unknown');
  assert.equal(mixedGroupStatus({runs:[{status:'succeeded'},{status:'succeeded'}]}), 'succeeded');
});
