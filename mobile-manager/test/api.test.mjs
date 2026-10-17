import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../web/api.js';
const response = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('API uses same-origin cookies and encodes explicit workspace and resource paths', async () => {
  const calls=[];const api=createApi({origin:'https://example.invalid/',fetchImpl:async(url,options)=>{calls.push({url,options});return response({});}});
  await api.login({username:'user@example.test',password:'secret'});await api.bot('workspace/a','employee/b');await api.sendMessage('conversation/c',{content:'hello',clientMessageId:'original-id',attachments:[]});await api.phone('workspace/a','phone/c','command/e');
  assert.deepEqual(JSON.parse(calls[0].options.body),{email:'user@example.test',password:'secret'});
  assert.equal(calls[1].url,'https://example.invalid/api/workspaces/workspace%2Fa/bots/employee%2Fb?view=mobile');
  assert.equal(calls[2].url,'https://example.invalid/api/conversations/conversation%2Fc/messages');assert.equal(JSON.parse(calls[2].options.body).clientMessageId,'original-id');
  assert.match(calls[3].url,/terminal\/android-devices\/phone%2Fc\/status\?commandId=command%2Fe$/);assert(calls.every(c=>c.options.credentials==='include'));
});

test('ordinary employee reuses the original conversation and never initializes Bot or Profile', async () => {
  const calls=[];const api=createApi({fetchImpl:async(url,options)=>{calls.push({url,options});return response(url.includes('?employeeId=')?{conversations:[{id:'old',employee_id:'ordinary',status:'active'}]}:{id:'old',employee_id:'ordinary',messages:[]});}});
  assert.equal((await api.getEmployeeConversation('workspace',{id:'ordinary',runtime:'Other'})).id,'old');
  assert.equal(calls.length,2);assert(calls.every(c=>c.options.method==='GET'));assert(calls.every(c=>!c.url.includes('/bots/')&&!c.url.includes('/profiles')));
});

test('main conversation is authoritative and read errors never create a replacement', async () => {
  const calls=[];const api=createApi({fetchImpl:async(url,options)=>{calls.push({url,options});return response({error:'temporary failure'},503);}});
  await assert.rejects(api.getEmployeeConversation('workspace',{id:'employee',runtime:'Hermes',bot:{configuration_state:'initialized',main_conversation_id:'original'}}),/temporary failure/);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/conversations/original?view=mobile');assert.equal(calls[0].options.method,'GET');
});

test('concurrent opening of a new ordinary conversation creates it only once', async () => {
  let created=0;const api=createApi({fetchImpl:async(url,options)=>{if(options.method==='POST'){created++;assert.deepEqual(JSON.parse(options.body),{employeeId:'ordinary',title:'甲 · 长期聊天'});return response({id:'new',messages:[]});}await Promise.resolve();return response({conversations:[]});}});
  const employee={id:'ordinary',name:'甲',runtime:'Other'};
  const results=await Promise.all([api.getEmployeeConversation('workspace',employee),api.getEmployeeConversation('workspace',employee)]);assert.equal(created,1);assert(results.every(result=>result.id==='new'));
});

test('401 and network failures preserve response classification without an automatic retry', async () => {
  let unauthorized=0, calls=0;
  const api=createApi({onUnauthorized:()=>unauthorized++,fetchImpl:async()=>{calls++;return response({error:'expired',code:'AUTH_REQUIRED'},401);}});
  await assert.rejects(api.authMe(),error=>error.status===401&&error.code==='AUTH_REQUIRED');assert.equal(unauthorized,1);assert.equal(calls,1);
  const broken=createApi({fetchImpl:async()=>{calls++;throw new TypeError('network');}});
  await assert.rejects(broken.sendMessage('original',{content:'message',clientMessageId:'same'}),error=>error.uncertain===true);assert.equal(calls,2);
});

test('a stalled history read times out and can retry the same conversation', async () => {
  const calls=[];
  const api=createApi({readTimeoutMs:10,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1) return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    return response({id:'original',messages:[{role:'assistant',content:'原聊天历史'}]});
  }});
  await assert.rejects(api.conversation('original'),error=>error.code==='READ_TIMEOUT'&&error.uncertain===false&&error.requestPath==='/api/conversations/original?view=mobile'&&error.method==='GET'&&error.elapsedMs>=0);
  assert.equal((await api.conversation('original')).messages[0].content,'原聊天历史');
  assert.deepEqual(calls.map(call=>call.url),['/api/conversations/original?view=mobile','/api/conversations/original?view=mobile']);
  assert(calls.every(call=>call.options.method==='GET'));
});

test('invalid history responses never masquerade as an empty conversation', async () => {
  for(const value of [{},{id:'original'},{id:'another',messages:[]}]) {
    const api=createApi({fetchImpl:async()=>response(value)});
    await assert.rejects(api.conversation('original'),/聊天记录返回异常/);
  }
  const api=createApi({fetchImpl:async()=>new Response('<html>unavailable</html>',{status:200})});
  await assert.rejects(api.conversation('original'),/返回内容无法读取/);
});

test('unchanged large reads use server ETags and return independent, original snapshots', async () => {
  const calls=[];let version=1;
  const api=createApi({fetchImpl:async(url,options)=>{
    calls.push(options.headers);
    const etag=`W/"revision-${version}"`;
    if(options.headers['If-None-Match']===etag)return new Response(null,{status:304,headers:{etag}});
    return new Response(JSON.stringify({employees:[{id:'original',name:`员工${version}`,avatar:'x'.repeat(100000)}]}),{headers:{etag}});
  }});
  const first=await api.employees('original');first.employees[0].name='local edit';
  const unchanged=await api.employees('original');assert.equal(unchanged.employees[0].name,'员工1');assert.equal(unchanged.employees[0].avatar.length,100000);
  assert.equal(calls[1]['If-None-Match'],'W/"revision-1"');version=2;
  assert.equal((await api.employees('original')).employees[0].name,'员工2');
  assert.equal((await api.employees('original')).employees[0].name,'员工2');assert.equal(calls[3]['If-None-Match'],'W/"revision-2"');
});

test('authentication boundaries and accepted writes invalidate conditional read snapshots', async () => {
  const seen=[];let nextStatus=200;
  const api=createApi({fetchImpl:async(url,options)=>{
    seen.push({url,method:options.method,etag:options.headers['If-None-Match']});
    if(options.method!=='GET')return response({ok:true});
    const status=nextStatus;nextStatus=200;
    if(status===401)return response({error:'expired'},401);
    if(status===304)return new Response(null,{status:304});
    return new Response(JSON.stringify({employees:[]}),{headers:{etag:'"original"'}});
  }});
  await api.employees('ws');nextStatus=401;await assert.rejects(api.employees('ws'),e=>e.status===401);
  await api.employees('ws');assert.equal(seen.at(-1).etag,undefined);
  await api.login({email:'account@example.test',password:'provided-by-test'});await api.employees('ws');assert.equal(seen.at(-1).etag,undefined);
  await api.updateEmployee('ws','original',{name:'saved'});await api.employees('ws');assert.equal(seen.at(-1).etag,undefined);
  await api.logout();nextStatus=304;await assert.rejects(api.employees('ws'),/返回内容无法读取/);
});

test('a read started before login cannot seed the next account conditional cache', async () => {
  let resolveOld;const seen=[];
  const api=createApi({fetchImpl:async(url,options)=>{
    seen.push({url,etag:options.headers['If-None-Match']});
    if(new URL(url,'https://test.invalid').pathname.endsWith('/employees')&&seen.filter(x=>x.url===url).length===1)return new Promise(resolve=>{resolveOld=resolve;});
    return response(new URL(url,'https://test.invalid').pathname.endsWith('/employees')?{employees:[]}:{ok:true});
  }});
  const old=api.employees('same-ws');await api.login({email:'new@example.test',password:'test'});
  resolveOld(new Response(JSON.stringify({employees:[{id:'old-account'}]}),{headers:{etag:'"old"'}}));await old;
  await api.employees('same-ws');assert.equal(seen.at(-1).etag,undefined);
});

test('opening a main conversation after login never reuses the previous account pending read', async () => {
  let oldResolve,reads=0;
  const api=createApi({fetchImpl:async(url,options)=>{
    if(options.method==='POST')return response({ok:true});
    reads++;
    if(reads===1)return new Promise(resolve=>{oldResolve=resolve;});
    return response({id:'main',messages:[{content:'new account response'}]});
  }});
  const employee={id:'same-employee',runtime:'Hermes',main_conversation_id:'main'};
  const old=api.getEmployeeConversation('ws',employee);const oldRejected=assert.rejects(old,/登录状态已变化/);
  await api.login({email:'next@example.test',password:'test'});
  const next=api.getEmployeeConversation('ws',employee);assert.notEqual(next,old);
  oldResolve(response({id:'main',messages:[{content:'old account history'}]}));await oldRejected;
  assert.equal((await next).messages[0].content,'new account response');assert.equal(reads,2);
});

test('an old ordinary conversation lookup cannot create a conversation after logout', async () => {
  let resolveLookup;const posts=[];
  const api=createApi({fetchImpl:async(url,options)=>{
    if(options.method==='POST'){posts.push(url);return response({ok:true});}
    return new Promise(resolve=>{resolveLookup=resolve;});
  }});
  const old=api.getEmployeeConversation('ws',{id:'ordinary',runtime:'Other'});const rejected=assert.rejects(old,/登录状态已变化/);
  await api.logout();resolveLookup(response({conversations:[]}));await rejected;
  assert.deepEqual(posts,['/api/auth/logout']);
});


test('read diagnostics identify the failed auxiliary route without saving request or response bodies', async () => {
  const api=createApi({fetchImpl:async()=>response({error:'server unavailable',code:'UPSTREAM_FAILED'},502)});
  await assert.rejects(api.botRuns('workspace','employee'),error=>{
    assert.equal(error.requestPath,'/api/workspaces/workspace/bots/employee/runs?view=mobile');
    assert.equal(error.method,'GET');assert.equal(error.status,502);assert.equal(error.code,'UPSTREAM_FAILED');
    assert(Number.isFinite(error.elapsedMs)&&error.elapsedMs>=0);
    assert.equal(error.requestBody,undefined);assert.equal(error.responseBody,undefined);
    return true;
  });
});

test('read watermarks preserve authenticated history ETags while forwards invalidate them', async () => {
  const seen=[];
  const body={messageIds:['source-message'],targetEmployeeId:'target',note:'参考',mode:'reference',clientRequestId:'same-request'};
  const receipt={forward:{id:'forward-id',sourceConversationId:'source',targetConversationId:'target-main',targetEmployeeId:'target',mode:'reference'},message:{id:'saved',forward:{schemaVersion:1,id:'forward-id',source:{conversationId:'source',employeeId:'original',employeeName:'甲'},messages:[{sourceMessageId:'source-message',role:'assistant',senderName:'甲',createdAt:'2026-10-17T00:00:00Z',content:'保留原文',attachments:[]}],mode:'reference',note:'参考'}}};
  const api=createApi({fetchImpl:async(url,options)=>{
    seen.push({url,options});
    if(url.endsWith('/read'))return response({conversationId:'source',lastReadMessageId:'source-message',unreadCount:0});
    if(url.endsWith('/forwards'))return response(receipt);
    if(url.endsWith('/chats'))return response({chats:[],unreadCount:0});
    if(options.headers['If-None-Match'])return new Response(null,{status:304});
    return new Response(JSON.stringify({id:'source',messages:[]}),{headers:{etag:'"original"'}});
  }});
  await api.conversation('source');await api.markConversationRead('source',{messageId:'source-message'});await api.conversation('source');
  assert.equal(seen.at(-1).options.headers['If-None-Match'],'"original"');
  assert.deepEqual(JSON.parse(seen[1].options.body),{messageId:'source-message'});
  await api.forwardMessages('source',body);await api.conversation('source');
  assert.equal(seen.at(-1).options.headers['If-None-Match'],undefined);
  await api.chats('workspace/a');assert.equal(seen.at(-1).url,'/api/workspaces/workspace%2Fa/chats');
});

test('unverifiable accepted forwarding receipts stay uncertain and never trigger another business call', async () => {
  const body={messageIds:['a'],targetEmployeeId:'target',note:'',mode:'execute',clientRequestId:'same'};
  for(const value of [{},{forward:{id:'x'},message:{id:'y'}},{forward:{id:'f',sourceConversationId:'other',targetConversationId:'target-main',targetEmployeeId:'target',mode:'execute'},message:{id:'saved'}}]){
    let calls=0;const api=createApi({fetchImpl:async()=>{calls++;return response(value);}});
    await assert.rejects(api.forwardMessages('source',body),e=>e.uncertain===true&&e.code==='FORWARD_RECEIPT_INVALID');
    assert.equal(calls,1);
  }
});

test('forward receipt accepts server chat ordering, legacy null source and an omitted empty note',async()=>{
  const receipt={forward:{id:'f',sourceConversationId:'legacy',targetConversationId:'canonical',targetEmployeeId:'target',mode:'execute'},execution:{id:'run',type:'conversation.execute',status:'pending'},message:{id:'saved',forward:{schemaVersion:1,id:'f',source:{conversationId:'legacy',employeeId:null,employeeName:'旧聊天'},mode:'execute',messages:['earlier','later'].map(sourceMessageId=>({sourceMessageId,role:'assistant',senderName:'原发送者',createdAt:'2026-10-17T00:00:00Z',content:'原文',attachments:[]}))}}};
  const api=createApi({fetchImpl:async()=>response(receipt)});
  const value=await api.forwardMessages('legacy',{messageIds:['later','earlier'],targetEmployeeId:'target',note:'',mode:'execute',clientRequestId:'request'});
  assert.deepEqual(value.message.forward.messages.map(message=>message.sourceMessageId),['earlier','later']);
  assert.equal(value.execution.id,'run');
});
