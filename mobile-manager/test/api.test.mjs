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

test('the default read keeps waiting past twenty seconds and accepts a complete body within one minute', async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  let finishBody,signal,calls=0;
  const api=createApi({fetchImpl:async(_url,options)=>{
    calls++;signal=options.signal;
    return {status:200,ok:true,headers:{get:()=>null},json:()=>new Promise((resolve,reject)=>{
      finishBody=resolve;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
    })};
  }});
  const pending=api.conversation('original');await Promise.resolve();
  t.mock.timers.tick(20001);assert.equal(signal.aborted,false);
  t.mock.timers.tick(24999);assert.equal(signal.aborted,false);
  finishBody({id:'original',messages:[{role:'assistant',content:'完整原报告'}]});
  assert.equal((await pending).messages[0].content,'完整原报告');assert.equal(calls,1);
});

test('the default read reports a real timeout after one minute without retrying or stopping a task', async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const calls=[];let signal;
  const api=createApi({fetchImpl:async(url,options)=>{
    calls.push({url,method:options.method});signal=options.signal;
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  }});
  const rejected=assert.rejects(api.botRuns('ws','employee'),error=>error.code==='READ_TIMEOUT'&&error.elapsedMs===60000&&error.uncertain===false);
  t.mock.timers.tick(59999);assert.equal(signal.aborted,false);
  t.mock.timers.tick(1);await rejected;
  assert.deepEqual(calls,[{url:'/api/workspaces/ws/bots/employee/runs?view=mobile',method:'GET'}]);
});

for(const readTimeoutMs of [0,60000])test(`employee GET scopes propagate abort and classify cancellation with timeout ${readTimeoutMs}`, async()=>{
  const calls=[];
  const api=createApi({readTimeoutMs,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  }});
  const reads=[
    options=>api.bot('ws','employee',options),options=>api.botRuns('ws','employee',options),options=>api.botRoutines('ws','employee',options),
    options=>api.conversation('main',options),options=>api.conversations('ws','employee',options),
  ];
  const scopes=reads.map(()=>new AbortController());
  const pending=reads.map((read,index)=>read({signal:scopes[index].signal,method:'POST',body:{mustNotSend:true}}));
  assert.equal(calls.length,reads.length);assert(calls.every(call=>call.options.method==='GET'&&call.options.body===undefined));
  const rejected=pending.map((promise,index)=>assert.rejects(promise,error=>error.code==='READ_CANCELLED'&&error.uncertain===false&&error.method==='GET'&&error.requestPath===calls[index].url&&Number.isFinite(error.elapsedMs)));
  scopes.forEach(scope=>scope.abort());assert(calls.every(call=>call.options.signal.aborted));await Promise.all(rejected);
  assert.equal(calls.length,reads.length,'cancelling reads must not retry them');
});

test('an already cancelled GET scope starts no network request', async()=>{
  let calls=0;const scope=new AbortController();scope.abort();
  const api=createApi({fetchImpl:async()=>{calls++;return response({id:'main',messages:[]});}});
  await assert.rejects(api.conversation('main',{signal:scope.signal}),error=>error.code==='READ_CANCELLED'&&error.requestPath==='/api/conversations/main?view=mobile');
  assert.equal(calls,0);
});

test('opening an employee forwards its read scope through Bot, lookup and original history GETs', async()=>{
  for(const runtime of ['Hermes','Other']){
    const calls=[],scope=new AbortController();
    const api=createApi({readTimeoutMs:0,fetchImpl:async(url,options)=>{
      calls.push({url,options});
      if(url.includes('/bots/'))return response({configuration_state:'draft'});
      if(url.includes('/conversations?'))return response({conversations:[{id:'original',employee_id:'employee',status:'active'}]});
      return response({id:'original',employee_id:'employee',messages:[]});
    }});
    assert.equal((await api.getEmployeeConversation('ws',{id:'employee',runtime},{signal:scope.signal})).id,'original');
    assert.equal(calls.length,runtime==='Hermes'?3:2);assert(calls.every(call=>call.options.method==='GET'&&call.options.signal===scope.signal));
  }
});

test('a fresh scope reopens the same employee before the aborted read promise settles', async()=>{
  const calls=[];let rejectOld;
  const api=createApi({fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1)return new Promise((_resolve,reject)=>{rejectOld=reject;});
    return response({id:'main',messages:[{content:'fresh scope'}]});
  }});
  const employee={id:'employee',runtime:'Hermes',main_conversation_id:'main'},firstScope=new AbortController(),nextScope=new AbortController();
  const old=api.getEmployeeConversation('ws',employee,{signal:firstScope.signal});
  assert.equal(api.getEmployeeConversation('ws',employee,{signal:firstScope.signal}),old,'the same active scope remains single-flight');
  const rejected=assert.rejects(old,error=>error.code==='READ_CANCELLED');firstScope.abort();
  assert.equal(calls[0].options.signal.aborted,true);
  const next=api.getEmployeeConversation('ws',employee,{signal:nextScope.signal});assert.notEqual(next,old);
  assert.equal((await next).messages[0].content,'fresh scope');assert.equal(calls.length,2);assert.equal(calls[1].options.signal.aborted,false);
  rejectOld(new DOMException('Aborted','AbortError'));await rejected;
});

test('cancelled ordinary lookup never starts creation and submitted creation remains uncancelled and single-flight', async()=>{
  const cancelled=new AbortController();let cancelledPosts=0;
  const cancelledApi=createApi({fetchImpl:async(_url,options)=>{
    if(options.method==='POST'){cancelledPosts++;return response({});}
    cancelled.abort();return response({conversations:[]});
  }});
  await assert.rejects(cancelledApi.getEmployeeConversation('ws',{id:'ordinary',runtime:'Other'},{signal:cancelled.signal}),error=>error.code==='READ_CANCELLED');
  assert.equal(cancelledPosts,0);
  const calls=[],firstScope=new AbortController(),nextScope=new AbortController();let finishCreation,creationStarted;
  const started=new Promise(resolve=>{creationStarted=resolve;});
  const api=createApi({fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(options.method==='GET')return response({conversations:[]});
    creationStarted();return new Promise(resolve=>{finishCreation=resolve;});
  }});
  const employee={id:'ordinary',name:'甲',runtime:'Other'};
  const first=api.getEmployeeConversation('ws',employee,{signal:firstScope.signal});await started;firstScope.abort();
  const next=api.getEmployeeConversation('ws',employee,{signal:nextScope.signal});
  await new Promise(resolve=>setImmediate(resolve));
  const writes=calls.filter(call=>call.options.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].options.signal,undefined);
  finishCreation(response({id:'new',messages:[]}));assert.deepEqual((await Promise.all([first,next])).map(value=>value.id),['new','new']);
  assert.equal(calls.filter(call=>call.options.method==='POST').length,1,'no cancellation or retry may duplicate the creation');
});

test('a delayed empty lookup cannot create again after another scope creation has completed', async()=>{
  let reads=0,posted=0,finishCreation,finishLateLookup,creationStarted,lateLookupStarted;
  const started=new Promise(resolve=>{creationStarted=resolve;}),lookupStarted=new Promise(resolve=>{lateLookupStarted=resolve;});
  const api=createApi({fetchImpl:async(_url,options)=>{
    if(options.method==='GET'){
      if(++reads!==2)return response({conversations:[]});
      lateLookupStarted();return new Promise(resolve=>{finishLateLookup=resolve;});
    }
    if(++posted===1){creationStarted();return new Promise(resolve=>{finishCreation=resolve;});}
    return response({id:'new-after-archive',messages:[]});
  }});
  const employee={id:'ordinary',runtime:'Other'},firstScope=new AbortController(),nextScope=new AbortController();
  const first=api.getEmployeeConversation('ws',employee,{signal:firstScope.signal});await started;firstScope.abort();
  const next=api.getEmployeeConversation('ws',employee,{signal:nextScope.signal});await lookupStarted;
  finishCreation(response({id:'original',messages:[]}));assert.equal((await first).id,'original');
  finishLateLookup(response({conversations:[]}));assert.equal((await next).id,'original');
  assert.equal(posted,1,'the lookup captured before commit must share that completed creation');
  const later=await api.getEmployeeConversation('ws',employee,{signal:new AbortController().signal});
  assert.equal(later.id,'new-after-archive');assert.equal(posted,2,'the completed creation is released once concurrent opening scopes finish');
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

test('revalidated history stays recent across different routes while cold reads leave the eight-entry cache', async () => {
  const seen=[];
  const api=createApi({fetchImpl:async(url,options)=>{
    seen.push({url,etag:options.headers['If-None-Match']});
    if(options.headers['If-None-Match'])return new Response(null,{status:304});
    return new Response(JSON.stringify(url.startsWith('/api/conversations/')?{id:'main',messages:[]}:{items:[]}),{headers:{etag:'"original"'}});
  }});
  await api.conversation('main');await api.employees('ws');await api.chats('ws');await api.bot('ws','employee');
  await api.botRuns('ws','employee');await api.botRoutines('ws','employee');await api.models('ws');await api.skills('ws');
  await api.conversation('main');assert.equal(seen.at(-1).etag,'"original"');
  await api.devices('ws');
  await api.conversation('main');assert.equal(seen.at(-1).etag,'"original"','recently revalidated history must survive visiting another resource');
  await api.employees('ws');assert.equal(seen.at(-1).etag,undefined,'the oldest unused resource must be evicted');
  await api.chats('ws');assert.equal(seen.at(-1).etag,undefined,'inserting the ninth resource must keep evicting cold entries');
});

test('an updated 200 response refreshes recency without keeping more than eight snapshots', async () => {
  const seen=[];let updateHistory=false;
  const api=createApi({fetchImpl:async(url,options)=>{
    seen.push({url,etag:options.headers['If-None-Match']});
    if(options.headers['If-None-Match']&&!updateHistory)return new Response(null,{status:304});
    const isHistory=url.startsWith('/api/conversations/');
    return new Response(JSON.stringify(isHistory?{id:'main',messages:[{content:updateHistory?'updated':'original'}]}:{}),{headers:{etag:updateHistory?'"updated"':'"original"'}});
  }});
  await api.conversation('main');await api.employees('ws');await api.chats('ws');await api.bot('ws','employee');
  await api.botRuns('ws','employee');await api.botRoutines('ws','employee');await api.models('ws');await api.skills('ws');
  updateHistory=true;assert.equal((await api.conversation('main')).messages[0].content,'updated');updateHistory=false;
  await api.devices('ws');await api.conversation('main');assert.equal(seen.at(-1).etag,'"updated"');
  await api.employees('ws');assert.equal(seen.at(-1).etag,undefined);
});

test('a late 304 cannot replace a newer snapshot when refreshing cache recency', async () => {
  const seen=[];let releaseOld;
  const api=createApi({fetchImpl:async(_url,options)=>{
    seen.push(options.headers['If-None-Match']);
    if(seen.length===2)return new Promise(resolve=>{releaseOld=resolve;});
    if(seen.length===4)return new Response(null,{status:304});
    const updated=seen.length===3;
    return new Response(JSON.stringify({id:'main',messages:[{content:updated?'updated':'original'}]}),{headers:{etag:updated?'"updated"':'"original"'}});
  }});
  await api.conversation('main');const old=api.conversation('main');
  assert.equal((await api.conversation('main')).messages[0].content,'updated');
  releaseOld(new Response(null,{status:304}));assert.equal((await old).messages[0].content,'original');
  assert.equal((await api.conversation('main')).messages[0].content,'updated');assert.equal(seen.at(-1),'"updated"');
});

test('LRU reads remain bounded by the 32 MiB response-text budget and skip oversized snapshots', async () => {
  const seen=[],padding='x'.repeat(6*1024*1024),oversized='x'.repeat(17*1024*1024);
  const api=createApi({fetchImpl:async(url,options)=>{
    seen.push({url,etag:options.headers['If-None-Match']});
    if(options.headers['If-None-Match'])return new Response(null,{status:304});
    const value=url.startsWith('/api/conversations/')?{id:'main',messages:[],padding}:url.endsWith('/models')?{padding:oversized}:{padding};
    return new Response(JSON.stringify(value),{headers:{etag:'"original"'}});
  }});
  await api.conversation('main');await api.employees('ws');
  await api.conversation('main');assert.equal(seen.at(-1).etag,'"original"');
  await api.chats('ws');
  await api.conversation('main');assert.equal(seen.at(-1).etag,'"original"','the recent history should survive byte-budget eviction');
  await api.employees('ws');assert.equal(seen.at(-1).etag,undefined,'three six-MiB texts exceed the 32 MiB string budget');
  await api.models('ws');await api.models('ws');assert.equal(seen.at(-1).etag,undefined,'a seventeen-MiB text must never enter the cache');
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
  const old=api.employees('same-ws'),rejected=assert.rejects(old,e=>e.code==='AUTH_CHANGED');await api.login({email:'new@example.test',password:'test'});
  resolveOld(new Response(JSON.stringify({employees:[{id:'old-account'}]}),{headers:{etag:'"old"'}}));await rejected;
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

test('first-party clicks use the encoded workspace and event with a cancellable authenticated GET', async () => {
  const calls = [], api = createApi({ fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ schemaVersion: 1 }); } });
  const controller = new AbortController();
  await api.mobileNotification('work/one', 'event/identifier', { signal: controller.signal, method: 'POST', body: { target: 'forged-chat' } });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/workspaces/work%2Fone/mobile/notifications-v2/items/event%2Fidentifier');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.credentials, 'include'); assert.equal(calls[0].options.body, undefined);
});

test('a native identity transport replaces browser cookies and never submits legacy credentials', async () => {
  const calls=[];
  const identity={fetch:async(url,options)=>{calls.push({url,options});return response({user_id:'server-principal'});},getStatus:async()=>({available:true,mode:'oidc',configured:true,authenticated:true}),subscribe:()=>()=>{},login:async()=>{calls.push('native-login');},logout:async()=>{calls.push('native-logout');}};
  const api=createApi({identity,fetchImpl:async()=>{throw new Error('cookie fallback forbidden');}});
  assert.equal(api.identityMode,'oidc');
  assert.equal((await api.authMe()).user_id,'server-principal');
  await api.login({email:'must-not-send@example.test',password:'must-not-send'});await api.logout();
  assert.equal(calls.length,3);assert.equal(calls[1],'native-login');assert.equal(calls[2],'native-logout');
  assert.equal(calls[0].url,'/api/auth/me');assert.equal(calls[0].options.credentials,'omit');
  api.dispose();
});
