import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/dsh-native-groups.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const subject={workspace:'test',workspaceId:'ws',employeeId:'employee-a',deviceId:'pc',runtime:'DSH',profile:'alpha'};
const roster=[{employeeId:'employee-a',profile:'alpha'},{employeeId:'employee-b',profile:'beta'},{employeeId:'employee-c',profile:'gamma'}];
const action=(operation,input={})=>({id:'group-action',type:'employee.dsh.operation',payload:{workspace:'test',workspaceId:'ws',deviceId:'pc',dshOperation:{schemaVersion:1,subject,scope:['list','create'].includes(operation)?{kind:'bot'}:{kind:'group',groupId:input.groupId},resource:'groups',operation,input,groupMembers:roster}}});
const group=(extra={})=>({id:'g-one',title:'Native group',members:['alpha','beta'],sessions:{alpha:'alpha-group-session',beta:'beta-group-session'},messages:[],createdAt:1,updatedAt:2,...extra});
const run=(operation,input,request)=>{assert.equal(typeof module.executeDshNativeGroupMetadata,'function');return module.executeDshNativeGroupMetadata(action(operation,input),{request});};
test('group list exposes only complete authorized groups containing the current native Bot',async()=>{
 const result=await run('list',{},async(method,path,body)=>{
  assert.deepEqual([method,path,body],['GET','/api/groups',undefined]);
  return{ok:true,items:[group(),group({id:'g-private',members:['alpha','private-bot']}),group({id:'g-other',members:['beta','gamma']}),group({id:'g-duplicate',members:['alpha','alpha']})],warnings:['g-private: PRIVATE_ERROR']};
 });
 assert.equal(result.status,'observed');assert.deepEqual(result.data.items.map(item=>item.id),['g-one']);assert.doesNotMatch(JSON.stringify(result),/g-private|private-bot|g-other|PRIVATE_ERROR|g-duplicate/);
 assert.deepEqual(result.observations.groups.data,result.data);
});
test('group detail keeps real member sessions but never restores historical approval handles',async()=>{
 const result=await run('get',{groupId:'g-one'},async()=>({ok:true,item:group({messages:[{id:'message',role:'tool',text:'Native history',status:'approval',botName:'alpha',approval:{requestId:'PRIVATE_APPROVAL'},eventId:'PRIVATE_EVENT',clientId:'PRIVATE_CLIENT',toolName:'native-tool'}]})}));
 assert.equal(result.data.item.sessions.alpha,'alpha-group-session');assert.equal(result.data.item.messages[0].status,'interrupted');assert.equal(result.data.item.messages[0].text,'Native history');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_APPROVAL|PRIVATE_EVENT|PRIVATE_CLIENT/);
});
test('group creation maps exact authorized employee identities to native names and reads the created group back',async()=>{
 const calls=[];let item;
 const result=await run('create',{title:'Created',memberEmployeeIds:['employee-a','employee-c']},async(method,path,body)=>{
  calls.push({method,path,body});
  if(method==='POST'){assert.deepEqual(body,{title:'Created',members:['alpha','gamma']});item=group({id:'g-created',title:body.title,members:body.members});return{ok:true,item};}
  assert.equal(path,'/api/groups/g-created');return{ok:true,item};
 });
 assert.equal(result.status,'applied');assert.equal(result.data.item.id,'g-created');assert.deepEqual(calls.map(call=>call.method),['POST','GET']);
});
test('create rejects duplicate missing foreign and unanchored members before any native request',async()=>{
 for(const memberEmployeeIds of [['employee-a'],['employee-a','employee-a'],['employee-a','foreign'],['employee-b','employee-c']])await assert.rejects(run('create',{title:'Group',memberEmployeeIds},async()=>assert.fail('invalid membership')));
 const duplicate=action('create',{title:'Group',memberEmployeeIds:['employee-a','alias']});duplicate.payload.dshOperation.groupMembers=[...roster,{employeeId:'alias',profile:'alpha'}];
 await assert.rejects(module.executeDshNativeGroupMetadata(duplicate,{request:async()=>assert.fail('same Bot cannot be two members')}));
});
test('update performs a fresh membership read before a metadata-only write and verifies native readback',async()=>{
 const calls=[];let item=group();
 const result=await run('update',{groupId:'g-one',title:'Renamed',memberEmployeeIds:['employee-a','employee-c']},async(method,path,body)=>{
  calls.push({method,path,body});assert.equal(path,'/api/groups/g-one');
  if(method==='PUT'){assert.deepEqual(body,{title:'Renamed',members:['alpha','gamma']});item={...item,...body};}
  return{ok:true,item};
 });
 assert.equal(result.status,'applied');assert.deepEqual(calls.map(call=>call.method),['GET','PUT','GET']);assert.deepEqual(result.data.item.members,['alpha','gamma']);
});
test('a formerly observed group with a newly unauthorized member cannot be updated or deleted',async()=>{
 for(const operation of ['get','update','delete']){
  const calls=[];
  await assert.rejects(run(operation,{groupId:'g-one',...(operation==='update'?{title:'Changed'}:{})},async method=>{calls.push(method);return{ok:true,item:group({members:['alpha','private-bot']})};}),{code:'DSH_NATIVE_GROUP_FORBIDDEN'});
  assert.deepEqual(calls,['GET']);
 }
});
test('group deletion only deletes the native group and verifies absence in the native group list',async()=>{
 const calls=[];
 const result=await run('delete',{groupId:'g-one'},async(method,path)=>{
  calls.push({method,path});if(method==='DELETE')return{ok:true};return path==='/api/groups'?{ok:true,items:[]}:{ok:true,item:group()};
 });
 assert.equal(result.status,'applied');assert.equal(result.data.deletedId,'g-one');assert.deepEqual(calls,[{method:'GET',path:'/api/groups/g-one'},{method:'DELETE',path:'/api/groups/g-one'},{method:'GET',path:'/api/groups'}]);
});
test('caller cannot inject native sessions messages profiles transport addresses or another observed group scope',async()=>{
 for(const input of [{groupId:'g-one',sessions:{alpha:'private-session'}},{groupId:'g-one',messages:[]},{groupId:'g-one',members:['alpha','beta']},{groupId:'g-one',baseUrl:'https://elsewhere.invalid'}])await assert.rejects(run('update',input,async()=>assert.fail('unsafe metadata input')));
 const mismatch=action('get',{groupId:'g-one'});mismatch.payload.dshOperation.scope.groupId='g-other';
 await assert.rejects(module.executeDshNativeGroupMetadata(mismatch,{request:async()=>assert.fail('wrong scope')}));
});
test('ambiguous group writes are never retried and mismatched safe readback does not claim applied',async()=>{
 let writes=0;
 const lost=await run('update',{groupId:'g-one',title:'Wanted'},async method=>{if(method==='PUT'){writes++;throw Error('PRIVATE_DIAGNOSTIC');}return{ok:true,item:group()};});
 assert.equal(lost.status,'unknown');assert.equal(writes,1);assert.doesNotMatch(JSON.stringify(lost),/PRIVATE_DIAGNOSTIC/);
 const mismatch=await run('update',{groupId:'g-one',title:'Wanted'},async()=>({ok:true,item:group()}));assert.equal(mismatch.status,'unknown');assert.equal(mismatch.data.item.title,'Native group');
});
test('send and cancel remain unsupported and an unbound current employee receives no group data',async()=>{
 for(const operation of ['send','cancel'])await assert.rejects(run(operation,{groupId:'g-one'},async()=>assert.fail('no native send API')),{code:'DSH_NATIVE_OPERATION_UNSUPPORTED'});
 const unbound=action('list');unbound.payload.dshOperation.groupMembers=roster.filter(item=>item.employeeId!==subject.employeeId);
 await assert.rejects(module.executeDshNativeGroupMetadata(unbound,{request:async()=>assert.fail('unbound subject')}));
});
