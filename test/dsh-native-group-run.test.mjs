import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/dsh-native-group-run.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return{};});
const subject={workspace:'test',workspaceId:'ws',employeeId:'ea',deviceId:'pc',runtime:'DSH',profile:'bot-a'};
const roster=[{employeeId:'ea',profile:'bot-a'},{employeeId:'eb',profile:'bot-b'},{employeeId:'ec',profile:'bot-c'}];
const action=(operation='send',input={groupId:'g-test',content:'Discuss'})=>({id:'parent',type:'employee.dsh.operation',payload:{workspace:'test',workspaceId:'ws',deviceId:'pc',timeoutMs:1200,dshOperation:{schemaVersion:1,subject,scope:{kind:'group',groupId:'g-test'},resource:'groups',operation,input,groupMembers:roster}}});
const copy=value=>structuredClone(value);
function fixture({members=['bot-a','bot-b'],duplicate=false}={}){
 const group={id:'g-test',title:'Native group',members,sessions:{},messages:[{id:'old',role:'user',text:'Earlier group text',status:'complete'}]},requests=[],posts=[],reads=[],stages=[];
 let clock=0,readCount=0,failWrite=false;
 const children=members.map(profile=>{const member=roster.find(row=>row.profile===profile);return{...member,conversationId:`conv-${member.employeeId}`,actionId:`child-${member.employeeId}`};});
 const records=new Map(children.map(member=>[member.actionId,completed(member)]));
 const request=async(method,path,body)=>{requests.push({method,path,body:copy(body)});assert.equal(path,'/api/groups/g-test');if(method==='PUT'){if(failWrite)throw new Error('synthetic socket failure');Object.assign(group,copy(body));}return{ok:true,item:copy(group)};};
 const devicePost=async(path,body)=>{posts.push({path,body:copy(body)});return path.endsWith('/cancel')?{cancelRequested:true,sourceActionId:'parent',members:children.map(row=>({actionId:row.actionId,cancellationRequested:true}))}:{sourceActionId:'parent',groupId:'g-test',members:copy(children),duplicate};};
 const readMemberAction=async id=>{reads.push(id);readCount++;return copy(records.get(id));};
 const options={request,devicePost,readMemberAction,now:()=>clock,wait:async ms=>{clock+=ms;},onStage:stage=>stages.push(stage)};
 return{group,requests,posts,reads,stages,children,records,options,setClock:value=>{clock=value;},get readCount(){return readCount;},failWrite:()=>{failWrite=true;}};
}
function completed(member,{status='succeeded',reason='completed',output=`Reply from ${member.profile}`}={}){
 const sessionId=`session-${member.employeeId}`,binding={actionId:member.actionId,employeeId:member.employeeId,conversationId:member.conversationId,botName:member.profile,sessionId,requestId:`request-${member.actionId}`};
 return{id:member.actionId,type:'conversation.execute',status,payload:{workspace:'test',deviceId:'pc',runtime:'DSH',employeeId:member.employeeId,conversationId:member.conversationId,profile:member.profile,dshSessionBinding:binding},result:{sessionId,output,sessionExit:{schemaVersion:1,source:'dsh-native-session',terminalConfirmed:true,turn:2,reason,...binding}},...(status==='failed'?{error:'Native member failed'}:{})};
}

test('group send dispatches existing member actions and persists only their confirmed group transcript',async()=>{
 const f=fixture(),result=await module.executeDshNativeGroupRun(action(),f.options);
 assert.equal(result.status,'applied');assert.equal(f.posts.length,1);assert.equal(f.posts[0].path,'/a2a/v1/actions/parent/dsh-group/dispatch');assert.deepEqual(f.posts[0].body.group,{id:'g-test',title:'Native group',members:['bot-a','bot-b'],sessions:{},messages:f.requests[0].body?.messages||[{id:'old',role:'user',text:'Earlier group text',status:'complete'}]});
 assert.equal(f.requests.filter(row=>row.method==='PUT').length,1);assert.deepEqual(f.group.sessions,{'bot-a':'session-ea','bot-b':'session-eb'});assert.equal(f.group.messages.length,4);assert.equal(f.group.messages.at(-1).text,'Reply from bot-b');
 assert.deepEqual(result.data.members.map(row=>row.actionId),['child-ea','child-eb']);assert.equal(result.data.members.every(row=>row.status==='succeeded'),true);assert.equal(result.observations.groups.data.item.id,'g-test');assert.ok(f.stages.length);
});

test('unknown group members and scope changes are rejected before dispatch',async()=>{
 for(const mutate of [f=>{f.group.members.push('private-bot');},(_f,a)=>{a.payload.dshOperation.scope.groupId='g-other';}]){
  const f=fixture(),a=action();mutate(f,a);await assert.rejects(module.executeDshNativeGroupRun(a,f.options),error=>/^DSH_NATIVE_GROUP_/.test(error.code));assert.equal(f.posts.length,0);assert.equal(f.requests.some(row=>row.method==='PUT'),false);
 }
});

test('targeted dispatch receipt cannot introduce an untargeted or duplicate member action',async()=>{
 const f=fixture(),a=action('send',{groupId:'g-test',content:'Only A',targetEmployeeIds:['ea']});
 const result=await module.executeDshNativeGroupRun(a,f.options);assert.equal(result.status,'unknown');assert.equal(f.requests.some(row=>row.method==='PUT'),false);assert.equal(f.reads.length,0);
});

test('an explicit target only follows that scheduler action and keeps other native sessions untouched',async()=>{
 const f=fixture(),a=action('send',{groupId:'g-test',content:'Only A',targetEmployeeIds:['ea']});f.group.sessions['bot-b']='existing-group-b';
 f.options.devicePost=async(path,body)=>{f.posts.push({path,body:copy(body)});return{sourceActionId:'parent',groupId:'g-test',members:[f.children[0]],duplicate:false};};
 const result=await module.executeDshNativeGroupRun(a,f.options);assert.equal(result.status,'applied');assert.deepEqual(f.reads,['child-ea']);assert.equal(f.group.sessions['bot-b'],'existing-group-b');assert.equal(f.group.messages.some(row=>row.botName==='bot-b'),false);
});

test('polling uses existing action results and merges messages added while members run',async()=>{
 const f=fixture(),read=f.options.readMemberAction;
 f.options.readMemberAction=async id=>{if(!f.readCount){f.records.get('child-ea').status='acked';}const value=await read(id);if(f.readCount===2){f.group.messages.push({id:'concurrent',role:'user',text:'New native message',status:'complete'});f.records.set('child-ea',completed(f.children[0]));}return value;};
 const result=await module.executeDshNativeGroupRun(action(),f.options);assert.equal(result.status,'applied');assert.equal(f.posts.length,1);assert.ok(f.reads.length>=3);assert.equal(f.group.messages.some(row=>row.id==='concurrent'),true);
});

test('a succeeded action without exact native session exit stays partial and never fabricates a response',async()=>{
 for(const corrupt of [row=>{delete row.result.sessionExit;},row=>{row.result.sessionExit.conversationId='private-conversation';},row=>{row.result.sessionExit.requestId='wrong-request';},row=>{row.result.executionState='uncertain';}]){
  const f=fixture();corrupt(f.records.get('child-eb'));const result=await module.executeDshNativeGroupRun(action(),f.options);
  assert.equal(result.status,'partial');assert.equal(result.data.members[1].status,'unknown');assert.equal(f.group.sessions['bot-b'],undefined);assert.equal(f.group.messages.some(row=>row.role==='assistant'&&row.botName==='bot-b'),false);assert.equal(result.data.members[1].actionId,'child-eb');
 }
});

test('confirmed member failure is kept alongside successful replies without claiming group success',async()=>{
 const f=fixture();f.records.set('child-eb',completed(f.children[1],{status:'failed',reason:'error',output:''}));const result=await module.executeDshNativeGroupRun(action(),f.options);
 assert.equal(result.status,'partial');assert.equal(result.data.members[1].status,'failed');assert.equal(f.group.messages.at(-1).role,'tool');assert.equal(f.group.messages.at(-1).status,'error');assert.equal(f.group.sessions['bot-b'],'session-eb');
});

test('duplicate dispatch follows original actions and stable transcript ids avoid reappending old turns',async()=>{
 const f=fixture({duplicate:true}),first=await module.executeDshNativeGroupRun(action(),f.options),count=f.group.messages.length;
 const second=await module.executeDshNativeGroupRun(action(),f.options);assert.equal(first.status,'applied');assert.equal(second.status,'applied');assert.equal(second.data.duplicate,true);assert.equal(f.group.messages.length,count);assert.equal(f.posts.length,2);assert.deepEqual(f.reads,['child-ea','child-eb','child-ea','child-eb']);
});

test('budget expiry and parent abort retain child actions without claiming they stopped',async()=>{
 for(const mode of ['budget','abort']){
  const f=fixture(),controller=new AbortController();f.options.signal=controller.signal;for(const row of f.records.values()){row.status='acked';delete row.result;}
  if(mode==='abort')f.options.wait=async()=>controller.abort();const result=await module.executeDshNativeGroupRun(action(),f.options);
  assert.equal(result.status,'unknown');assert.equal(result.data.members.every(row=>row.status==='unknown'),true);assert.equal(result.data.stopConfirmed,undefined);assert.equal(f.posts.length,1);assert.equal(f.group.messages.filter(row=>row.role==='assistant').length,0);
 }
});

test('cancel only requests backend child controls and does not write native transcript or report stopped',async()=>{
 const f=fixture(),a=action('cancel',{sourceActionId:'parent'});a.id='cancel-parent';const result=await module.executeDshNativeGroupRun(a,f.options);
 assert.equal(result.status,'observed');assert.equal(result.data.cancelRequested,true);assert.equal(result.data.stopConfirmed,false);assert.deepEqual(f.posts,[{path:'/a2a/v1/actions/parent/dsh-group/cancel',body:{controlActionId:'cancel-parent'}}]);assert.equal(f.reads.length,0);assert.equal(f.requests.length,0);
});
test('an attachment-only group send persists attachment names without image content in native history',async()=>{
 const f=fixture(),a=action('send',{groupId:'g-test',content:'',attachments:[{name:'picture.png',mimeType:'image/png',content:'PRIVATE_IMAGE_BASE64',contentEncoding:'base64',size:12}]});
 const result=await module.executeDshNativeGroupRun(a,f.options);
 assert.equal(result.status,'applied');const saved=f.requests.find(row=>row.method==='PUT');assert.match(saved.body.messages.find(row=>row.id==='dsh-group:parent:user').text,/picture\.png/);assert.doesNotMatch(JSON.stringify(saved.body),/PRIVATE_IMAGE_BASE64/);
});

test('native write failure preserves finished member facts and missing write proof remains unknown',async()=>{
 const f=fixture();f.failWrite();const result=await module.executeDshNativeGroupRun(action(),f.options);
 assert.equal(result.status,'partial');assert.equal(result.data.historyPersisted,false);assert.equal(result.data.members.every(row=>row.status==='succeeded'),true);assert.equal(result.observations,undefined);assert.equal(f.posts.length,1);
});

test('a changed native membership after dispatch retains child facts without writing into another group composition',async()=>{
 const f=fixture(),read=f.options.readMemberAction;f.options.readMemberAction=async id=>{const value=await read(id);f.group.members=['bot-a','bot-c'];return value;};
 const result=await module.executeDshNativeGroupRun(action(),f.options);assert.equal(result.status,'partial');assert.equal(result.data.historyPersisted,false);assert.equal(f.requests.some(row=>row.method==='PUT'),false);assert.equal(result.observations,undefined);
});

test('native write acceptance without the transcript readback does not claim it was persisted',async()=>{
 const f=fixture(),request=f.options.request;f.options.request=async(method,path,body)=>method==='PUT'?{ok:true}:request(method,path,body);
 const result=await module.executeDshNativeGroupRun(action(),f.options);assert.equal(result.status,'partial');assert.equal(result.data.historyPersisted,false);assert.equal(result.data.members.every(row=>row.status==='succeeded'),true);assert.equal(result.observations.groups.data.item.messages.length,1);
});

test('history projection strips replayable handles and truncates native messages to the last 300',async()=>{
 const f=fixture();f.group.messages=Array.from({length:300},(_,i)=>({id:`old-${i}`,role:'user',text:`Message ${i}`,status:'complete'}));f.group.messages.push({id:'approval',role:'tool',text:'Historical approval',botName:'bot-a',status:'approval',approvalId:'old-approval',callId:'old-call',eventId:'old-event'});
 const result=await module.executeDshNativeGroupRun(action(),f.options);assert.equal(result.status,'applied');assert.equal(f.group.messages.length,300);const old=f.group.messages.find(row=>row.id==='approval');assert.equal(old.status,'interrupted');assert.equal(old.approvalId,undefined);assert.equal(old.callId,undefined);assert.equal(JSON.stringify(f.posts[0].body).includes('old-approval'),false);
});
