import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedGroupMemberDescriptor,mixedGroupStatus} from './mixed-group.js';

test('mixed group descriptors retain runtime and isolated bindings',()=>{
  const value=mixedGroupMemberDescriptor({id:'e1',name:'DSH',runtime:'DSH',runtime_profile:'community-lead',target_device_id:'pc',main_conversation_id:'conv'});
  assert.deepEqual(value,{employeeId:'e1',name:'DSH',runtime:'DSH',profile:'community-lead',deviceId:'pc',conversationId:'conv'});
});

test('mixed group status distinguishes running, partial, unknown and terminal runs',()=>{
  assert.equal(mixedGroupStatus({runs:[]}), 'planned');
  assert.equal(mixedGroupStatus({runs:[{status:'pending'}]}), 'running');
  assert.equal(mixedGroupStatus({runs:[{status:'succeeded'},{status:'pending'}]}), 'partial');
  assert.equal(mixedGroupStatus({runs:[{status:'expired'}]}), 'unknown');
  assert.equal(mixedGroupStatus({runs:[{status:'succeeded'},{status:'succeeded'}]}), 'succeeded');
});
