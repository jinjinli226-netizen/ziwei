import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepository} from './repository.mjs';
import {createManagementService} from './management.mjs';
import {createConversationReadService} from './conversation-read-state.mjs';
import {createDshNativeService} from './dsh-native-operations.mjs';
import {createDshNativeGroupDispatch,assertDshNativeGroupChild,assertDshNativeGroupConversationVisible} from './dsh-native-group-dispatch.mjs';
import {DSH_NATIVE_FEATURE} from '../src/dsh-native-contract.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

const SLUG='test-111';
function fixture(t,{content='Discuss the current group task',targets,attachments}={}){
 const repo=createRepository({memory:true}),db=repo.db,ws=repo.getWorkspace(SLUG),context={actorUserId:'group-owner',actorRole:'owner'};t.after(()=>db.close());
 db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('group-owner-member',ws.id,context.actorUserId,'Owner','group@fixture.invalid','owner',new Date().toISOString());
 const pair=repo.claimDevicePairing({code:repo.createDevicePairing(SLUG,{createdBy:context.actorUserId,name:'Group fixture computer'}).code}),credential=repo.authenticateDeviceToken(pair.deviceToken);
 repo.heartbeatDevice(SLUG,{deviceId:pair.deviceId,runtimeDiscovery:{features:[DSH_NATIVE_FEATURE]},runtimes:{DSH:{status:'available',profiles:[{name:'alpha'},{name:'beta'}]}}});
 const alpha=repo.createEmployee(SLUG,{name:'Alpha member',runtime:'DSH',runtimeProfile:'alpha',targetDeviceId:pair.deviceId,ownerUserId:context.actorUserId}),beta=repo.createEmployee(SLUG,{name:'Beta member',runtime:'DSH',runtimeProfile:'beta',targetDeviceId:pair.deviceId,ownerUserId:'beta-owner'}),management=createManagementService(repo),nativeService=createDshNativeService(repo,{management}),service=createDshNativeGroupDispatch(repo,{management});
 const act=(operation,input,key)=>nativeService.action(SLUG,alpha.id,{resource:'groups',operation,input,idempotencyKey:key,expectedSubjectHash:nativeService.state(SLUG,alpha.id,{},context).subjectHash},context);
 const group={id:'native-group-1',title:'Native group',members:['alpha','beta'],sessions:{alpha:'group-session-alpha',beta:'group-session-beta'},messages:[{id:'history-one',role:'assistant',botName:'beta',text:'Actual native discussion already recorded',status:'complete'}]},listed=act('list',{},'list-group'),op=repo.getA2AAction(listed.action.id).payload.dshOperation;
 repo.ackA2AAction(listed.action.id,{deviceId:pair.deviceId});repo.resultA2AAction(listed.action.id,{deviceId:pair.deviceId,status:'succeeded',result:{dshNative:{schemaVersion:1,source:'dsh-native',subject:op.subject,scope:op.scope,resource:'groups',operation:'list',checkedAt:new Date().toISOString(),status:'observed',data:{items:[group]},observations:{groups:{status:'observed',data:{items:[group]}}}}}});
 const sent=act('send',{groupId:group.id,content,...(targets?{targetEmployeeIds:targets(alpha,beta)}:{}),...(attachments?{attachments}:{})},'send-group'),source=repo.getA2AAction(sent.action.id);repo.ackA2AAction(source.id,{deviceId:pair.deviceId});
 const counts=()=>Object.fromEntries(['a2a_actions','conversations','conversation_messages'].map(table=>[table,db.prepare(`SELECT count(*) n FROM ${table}`).get().n]));
 return{repo,db,ws,context,pair,credential,alpha,beta,management,nativeService,service,group,source,act,counts,dispatch:(body={workspace:SLUG,group})=>service.dispatch(source.id,body,credential)};
}

test('an authenticated group source fans out only standard supervised member conversations and retries do not replay',t=>{
 const f=fixture(t),result=f.dispatch();assert.equal(result.members.length,2);assert.equal(result.sourceActionId,f.source.id);assert.equal(new Set(result.members.map(member=>member.conversationId)).size,2);
 for(const member of result.members){const action=f.repo.getA2AAction(member.actionId);assert.equal(action.type,'conversation.execute');assert.equal(action.payload.runtime,'DSH');assert.equal(action.payload.employeeId,member.employeeId);assert.equal(action.payload.profile,member.profile);assert.equal(action.payload.runtimeSessionId,f.group.sessions[member.profile]);assert.deepEqual(action.payload.dshGroup,{schemaVersion:1,sourceActionId:f.source.id,groupId:f.group.id,memberProfile:member.profile});assert.equal(assertDshNativeGroupChild(f.db,action).employeeId,member.employeeId);assert.match(action.payload.prompt,/Actual native discussion already recorded/);assert.match(action.payload.prompt,/Discuss the current group task/);}
 const before=f.counts(),again=f.dispatch();assert.deepEqual(again.members,result.members);assert.equal(again.duplicate,true);assert.deepEqual(f.counts(),before);assert.equal(f.repo.getA2AAction(f.source.id).status,'acked');
});

test('group targets come from the original authorized input and use group-specific native sessions',t=>{
 const f=fixture(t,{content:'@beta Please respond to this question'}),result=f.dispatch();assert.equal(result.members.length,1);assert.equal(result.members[0].employeeId,f.beta.id);assert.equal(result.members[0].profile,'beta');
 const explicit=fixture(t,{targets:(_alpha,beta)=>[beta.id]}),targeted=explicit.dispatch();assert.equal(targeted.members.length,1);assert.equal(targeted.members[0].employeeId,explicit.beta.id);
});

test('a private native session collision rolls back all group conversations and child work',t=>{
 const f=fixture(t),privateConversation=f.repo.createConversation(SLUG,{employeeId:f.alpha.id});f.db.prepare('INSERT INTO conversation_dsh_sessions VALUES(?,?,?,?,?,?,?)').run(privateConversation.id,f.ws.id,f.alpha.id,f.pair.deviceId,'alpha',f.group.sessions.alpha,new Date().toISOString());const before=f.counts();assert.throws(()=>f.dispatch(),{code:'DSH_NATIVE_GROUP_SESSION_CONFLICT'});assert.deepEqual(f.counts(),before);
});

test('group dispatch refuses foreign device, changed native members and revoked original roster authority',t=>{
 const f=fixture(t),before=f.counts();assert.throws(()=>f.service.dispatch(f.source.id,{workspace:SLUG,group:f.group},{...f.credential,deviceId:'foreign-device'}),{code:'DSH_NATIVE_GROUP_DEVICE_MISMATCH'});assert.throws(()=>f.dispatch({workspace:SLUG,group:{...f.group,members:['alpha','unapproved-bot'],sessions:{alpha:f.group.sessions.alpha}}}),{code:'DSH_NATIVE_GROUP_SOURCE_CHANGED'});assert.deepEqual(f.counts(),before);
 const dispatched=f.dispatch();f.db.prepare("UPDATE members SET role='member' WHERE id='group-owner-member'").run();f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.beta.id);for(const member of dispatched.members)assert.throws(()=>assertDshNativeGroupChild(f.db,f.repo.getA2AAction(member.actionId)));
});

test('group cancellation requires an ACKed typed control action and queues only existing action.cancel requests',t=>{
 const f=fixture(t),sent=f.dispatch(),unrelated=f.act('get',{groupId:f.group.id},'unrelated-control');for(const member of sent.members)f.repo.ackA2AAction(member.actionId,{deviceId:f.pair.deviceId});f.repo.ackA2AAction(unrelated.action.id,{deviceId:f.pair.deviceId});const before=f.counts();assert.throws(()=>f.service.cancel(f.source.id,{workspace:SLUG,controlActionId:unrelated.action.id},f.credential),{code:'DSH_NATIVE_GROUP_CONTROL_INVALID'});assert.deepEqual(f.counts(),before);
 const control=f.act('cancel',{sourceActionId:f.source.id},'cancel-group');f.repo.ackA2AAction(control.action.id,{deviceId:f.pair.deviceId});const cancelled=f.service.cancel(f.source.id,{workspace:SLUG,controlActionId:control.action.id},f.credential);assert.equal(cancelled.cancelRequested,true);assert.equal(cancelled.stopConfirmed,false);assert.equal(cancelled.members.length,2);
 for(const member of cancelled.members){const action=f.repo.getA2AAction(member.cancelActionId);assert.equal(action.type,'action.cancel');assert.equal(action.payload.actionId,member.targetActionId);assert.ok(sent.members.some(target=>target.actionId===member.targetActionId));assert.equal(member.cancellationRequested,true);assert.equal(assertDshNativeGroupChild(f.db,action).employeeId,member.employeeId);}
 const queued=f.counts();assert.deepEqual(f.service.cancel(f.source.id,{workspace:SLUG,controlActionId:control.action.id},f.credential).members,cancelled.members);assert.deepEqual(f.counts(),queued);assert.equal(f.repo.getA2AAction(f.source.id).status,'acked');
});

test('group children retain bounded execution and their real IDs after an unknown parent outcome',t=>{
 const f=fixture(t),dispatched=f.dispatch(),op=f.source.payload.dshOperation;
 for(const member of dispatched.members){const action=f.repo.getA2AAction(member.actionId);assert.ok(action.payload.timeoutMs>=100&&action.payload.timeoutMs<=900000);}
 f.repo.resultA2AAction(f.source.id,{deviceId:f.pair.deviceId,status:'succeeded',result:{dshNative:{schemaVersion:1,source:'dsh-native',subject:op.subject,scope:op.scope,resource:'groups',operation:'send',checkedAt:new Date().toISOString(),status:'unknown',data:{groupId:f.group.id,members:dispatched.members}}}});
 const again=f.dispatch();assert.deepEqual(again.members,dispatched.members);assert.equal(again.duplicate,true);
 for(const member of dispatched.members){const action=f.repo.getA2AAction(member.actionId);assert.equal(assertDshNativeGroupChild(f.db,action).employeeId,member.employeeId);assert.equal(f.repo.ackA2AAction(action.id,{deviceId:f.pair.deviceId}).status,'acked');assert.equal(f.repo.ackA2AAction(action.id,{deviceId:f.pair.deviceId,renewLease:true}).leaseRenewed,true);}
 const control=f.act('cancel',{sourceActionId:f.source.id},'cancel-unknown-source');f.repo.ackA2AAction(control.action.id,{deviceId:f.pair.deviceId});const cancelled=f.service.cancel(f.source.id,{workspace:SLUG,controlActionId:control.action.id},f.credential);assert.equal(cancelled.members.length,2);assert.ok(cancelled.members.every(member=>member.cancellationRequested));assert.equal(f.repo.getA2AAction(f.source.id).result.dshNative.status,'unknown');
 const unissued=fixture(t),before=unissued.counts();unissued.db.prepare('UPDATE a2a_actions SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),unissued.source.id);assert.throws(()=>unissued.dispatch(),{code:'DSH_NATIVE_GROUP_SOURCE_NOT_ACTIVE'});assert.deepEqual(unissued.counts(),before);
});

test('a group child uses its own employee directory and never the parent or heartbeat directory',t=>{
 const f=fixture(t);f.db.prepare('UPDATE devices SET workdir=? WHERE id=?').run('D:\\heartbeat-directory',f.pair.deviceId);f.db.prepare('UPDATE employees SET default_working_directory=?,default_working_directory_device_id=? WHERE id=?').run('D:\\beta-directory',f.pair.deviceId,f.beta.id);
 const dispatched=f.dispatch();assert.equal(f.repo.getA2AAction(dispatched.members.find(member=>member.employeeId===f.alpha.id).actionId).payload.cwd,undefined);assert.equal(f.repo.getA2AAction(dispatched.members.find(member=>member.employeeId===f.beta.id).actionId).payload.cwd,'D:\\beta-directory');
});

test('a group child and its owner-created parent remain hidden from a viewer lacking a private peer',t=>{
 const f=fixture(t),dispatched=f.dispatch(),viewer={actorUserId:'group-viewer',actorRole:'member'};f.db.prepare("UPDATE workspaces SET kind='team' WHERE id=?").run(f.ws.id);f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.beta.id);f.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('group-viewer-member',f.ws.id,viewer.actorUserId,'Viewer','viewer@fixture.invalid','member',new Date().toISOString());
 assert.throws(()=>f.management.action(SLUG,f.source.id,viewer),{code:'ACTION_NOT_FOUND'});for(const member of dispatched.members){const action=f.repo.getA2AAction(member.actionId);assert.throws(()=>assertDshNativeGroupChild(f.db,action,{userId:viewer.actorUserId,role:'member'}));assert.throws(()=>f.management.action(SLUG,member.actionId,viewer),{code:'ACTION_NOT_FOUND'});}
});

test('an attachment-only native group send archives a real PNG and delivers only its authorized standard attachment to each child',t=>{
 const contentBase64=rasterFixtures.png.toString('base64'),attachments=[{name:'../tiny.png',mimeType:'image/png',contentBase64}],f=fixture(t,{content:'',attachments}),expected=[{name:'tiny.png',mimeType:'image/png',content:contentBase64,contentEncoding:'base64',size:rasterFixtures.png.length}],op=f.repo.getA2AAction(f.source.id).payload.dshOperation;
 assert.deepEqual(op.input.attachments,expected);assert.deepEqual(op.groupTargets.map(id=>f.repo.getEmployee(id).runtime_profile).sort(),['alpha','beta']);
 const result=f.dispatch();assert.equal(result.members.length,2);
 for(const member of result.members){const child=f.repo.getA2AAction(member.actionId);assert.deepEqual(child.payload.attachments,expected);const archived=f.db.prepare('SELECT attachment_json,content FROM conversation_messages WHERE id=?').get(child.payload.messageId);assert.deepEqual(JSON.parse(archived.attachment_json),expected);assert.equal(archived.content.includes(contentBase64),false);assert.equal(child.payload.prompt.includes(contentBase64),false);}
 const before=f.counts(),again=f.act('send',{groupId:f.group.id,content:'',attachments:[{name:'tiny.png',mimeType:'image/png',contentBase64}]},'send-group');assert.equal(again.action.id,f.source.id);assert.deepEqual(f.counts(),before);
});

test('a fake group image is rejected before a source action or member message is stored',t=>{
 const f=fixture(t),before=f.counts();assert.throws(()=>f.act('send',{groupId:f.group.id,content:'',attachments:[{name:'fake.png',mimeType:'image/png',contentBase64:Buffer.from('not an actual PNG').toString('base64')}]},'fake-group-image'),{code:'DSH_NATIVE_GROUP_ATTACHMENT_INVALID',status:400});assert.deepEqual(f.counts(),before);
});

test('ordinary conversation reads cannot expose a private native peer through a group member transcript',t=>{
 const f=fixture(t),dispatched=f.dispatch(),alphaConversation=dispatched.members.find(member=>member.employeeId===f.alpha.id).conversationId,viewer={actorUserId:'transcript-viewer',actorRole:'member',enforceEmployeeVisibility:true};
 f.db.prepare("UPDATE workspaces SET kind='team' WHERE id=?").run(f.ws.id);f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.beta.id);f.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('transcript-viewer-member',f.ws.id,viewer.actorUserId,'Viewer','transcript-viewer@fixture.invalid','member',new Date().toISOString());
 const access=f.repo.getConversationAccess(alphaConversation,viewer),listed=f.repo.listConversations(SLUG,viewer),full=f.repo.getConversation(alphaConversation,viewer),thread=f.repo.getConversation(alphaConversation,viewer,{view:'thread',limit:10});assert.deepEqual({access:Boolean(access),listed:listed.some(item=>item.id===alphaConversation),full:Boolean(full),thread:Boolean(thread),peerHistoryVisible:JSON.stringify(full).includes('Actual native discussion already recorded')},{access:false,listed:false,full:false,thread:false,peerHistoryVisible:false});
 assert.equal(createConversationReadService(f.repo).list(SLUG,viewer).chats.some(chat=>chat.conversationId===alphaConversation),false);
 const before=f.counts(),originalMessageId=f.repo.getA2AAction(dispatched.members.find(member=>member.employeeId===f.alpha.id).actionId).payload.messageId;
 assert.throws(()=>f.repo.addConversationMessage(alphaConversation,{content:'Must not enter the native group session',...viewer}),{code:'CONVERSATION_NOT_FOUND',status:404});assert.throws(()=>f.repo.forwardConversationMessages(alphaConversation,{messageIds:[originalMessageId],targetEmployeeId:f.alpha.id,clientRequestId:'forbidden-group-forward'},viewer),{code:'FORWARD_SOURCE_NOT_FOUND',status:404});assert.deepEqual(f.counts(),before);
 const owner={...f.context,enforceEmployeeVisibility:true};assert.ok(f.repo.getConversation(alphaConversation,owner).messages.some(message=>message.content.includes('Actual native discussion already recorded')));
 const privateChat=f.repo.createConversation(SLUG,{employeeId:f.alpha.id,...viewer});f.repo.addConversationMessage(privateChat.id,{content:'Independent private alpha chat',dispatch:false,...viewer});assert.equal(f.repo.getConversationAccess(privateChat.id,viewer).id,privateChat.id);assert.ok(f.repo.listConversations(SLUG,viewer).some(item=>item.id===privateChat.id));assert.equal(f.repo.getConversation(privateChat.id,viewer).messages[0].content,'Independent private alpha chat');
});

test('group conversation history requires every historical grant after legitimate member and configuration changes',t=>{
 const f=fixture(t),original=f.dispatch(),conversationId=original.members.find(member=>member.employeeId===f.alpha.id).conversationId,viewer={actorUserId:'later-group-viewer',actorRole:'member',enforceEmployeeVisibility:true},requester={userId:viewer.actorUserId,role:'member'};
 f.db.prepare("UPDATE workspaces SET kind='team' WHERE id=?").run(f.ws.id);f.db.prepare("UPDATE employees SET visibility='personal' WHERE id=?").run(f.beta.id);f.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('later-group-viewer-member',f.ws.id,viewer.actorUserId,'Viewer','later-group-viewer@fixture.invalid','member',new Date().toISOString());
 f.repo.heartbeatDevice(SLUG,{deviceId:f.pair.deviceId,runtimes:{DSH:{status:'available',profiles:[{name:'alpha'},{name:'beta'},{name:'gamma'}]}}});const gamma=f.repo.createEmployee(SLUG,{name:'Gamma member',runtime:'DSH',runtimeProfile:'gamma',targetDeviceId:f.pair.deviceId,ownerUserId:viewer.actorUserId}),group={...f.group,members:['alpha','gamma'],sessions:{alpha:f.group.sessions.alpha,gamma:'group-session-gamma'},messages:[{role:'user',text:'Current visible membership'}]},act=(operation,input,key)=>f.nativeService.action(SLUG,f.alpha.id,{resource:'groups',operation,input,idempotencyKey:key,expectedSubjectHash:f.nativeService.state(SLUG,f.alpha.id,{},viewer).subjectHash},viewer),list=act('list',{},'later-visible-list'),listOp=f.repo.getA2AAction(list.action.id).payload.dshOperation;
 f.repo.ackA2AAction(list.action.id,{deviceId:f.pair.deviceId});f.repo.resultA2AAction(list.action.id,{deviceId:f.pair.deviceId,status:'succeeded',result:{dshNative:{schemaVersion:1,source:'dsh-native',subject:listOp.subject,scope:listOp.scope,resource:'groups',operation:'list',checkedAt:new Date().toISOString(),status:'observed',data:{items:[group]},observations:{groups:{status:'observed',data:{items:[group]}}}}}});
 const next=act('send',{groupId:group.id,content:'A new authorized group message'},'later-visible-send'),nextOp=f.repo.getA2AAction(next.action.id).payload.dshOperation;assert.ok(nextOp.groupMembers.some(member=>member.employeeId===gamma.id));assert.equal(nextOp.groupMembers.some(member=>member.employeeId===f.beta.id),false);f.repo.ackA2AAction(next.action.id,{deviceId:f.pair.deviceId});const second=f.service.dispatch(next.action.id,{workspace:SLUG,group},f.credential);assert.equal(second.members.find(member=>member.employeeId===f.alpha.id).conversationId,conversationId);
 assert.throws(()=>assertDshNativeGroupConversationVisible(f.db,f.ws.id,conversationId,requester),{code:'EMPLOYEE_CAPABILITIES_AUTHORITY_REVOKED'});assert.equal(f.repo.getConversation(conversationId,viewer),null);
 f.db.prepare("UPDATE employees SET model_id='later-authorized-model' WHERE id=?").run(f.alpha.id);assert.equal(assertDshNativeGroupConversationVisible(f.db,f.ws.id,conversationId,{userId:f.context.actorUserId,role:'owner'}),true);assert.ok(f.repo.getConversation(conversationId,{...f.context,enforceEmployeeVisibility:true}));assert.equal(assertDshNativeGroupConversationVisible(f.db,f.ws.id,conversationId),null);
});

test('group cancel atomically removes pending members from the standard queue and controls only active native members',t=>{
 const f=fixture(t),sent=f.dispatch(),active=sent.members.find(member=>member.employeeId===f.alpha.id),pending=sent.members.find(member=>member.employeeId===f.beta.id);f.repo.ackA2AAction(active.actionId,{deviceId:f.pair.deviceId});const control=f.act('cancel',{sourceActionId:f.source.id},'cancel-active-and-pending');f.repo.ackA2AAction(control.action.id,{deviceId:f.pair.deviceId});const before=f.counts(),result=f.service.cancel(f.source.id,{workspace:SLUG,controlActionId:control.action.id},f.credential),removed=result.members.find(member=>member.actionId===pending.actionId),running=result.members.find(member=>member.actionId===active.actionId);
 assert.equal(result.cancelRequested,true);assert.equal(result.stopConfirmed,false);assert.equal(removed.queuedCancelled,true);assert.equal(removed.cancellationRequested,true);assert.equal(removed.targetResultAvailable,true);assert.equal(removed.cancelActionId,undefined);assert.ok(running.cancelActionId);assert.equal(running.cancellationRequested,true);assert.equal(running.targetResultAvailable,false);assert.equal(f.counts().a2a_actions,before.a2a_actions+1);
 const target=f.repo.getA2AAction(pending.actionId);assert.equal(target.status,'failed');assert.equal(target.error,'CONVERSATION_QUEUE_REMOVED');assert.equal(target.acked_at,null);assert.deepEqual(target.result,{queueRemoved:true});assert.equal(f.repo.ackA2AAction(pending.actionId,{deviceId:f.pair.deviceId}).status,'failed');assert.equal(f.repo.listA2AActions(SLUG,{deviceId:f.pair.deviceId,status:'pending',includeAcked:true,executionDelivery:true}).some(action=>action.id===pending.actionId),false);
 const counts=f.counts(),again=f.service.cancel(f.source.id,{workspace:SLUG,controlActionId:control.action.id},f.credential);assert.deepEqual(again.members,result.members);assert.deepEqual(f.counts(),counts);assert.deepEqual(f.dispatch().members,sent.members);assert.deepEqual(f.counts(),counts);assert.equal(f.repo.getA2AAction(f.source.id).status,'acked');
});
