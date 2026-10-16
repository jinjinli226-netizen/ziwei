import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../web/api.js';
const response = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('API uses same-origin cookies and encodes explicit workspace and resource paths', async () => {
  const calls=[];const api=createApi({origin:'https://example.invalid/',fetchImpl:async(url,options)=>{calls.push({url,options});return response({});}});
  await api.login({username:'user@example.test',password:'secret'});await api.bot('workspace/a','employee/b');await api.sendMessage('conversation/c',{content:'hello',clientMessageId:'original-id',attachments:[]});await api.phone('workspace/a','phone/c','command/e');
  assert.deepEqual(JSON.parse(calls[0].options.body),{email:'user@example.test',password:'secret'});
  assert.equal(calls[1].url,'https://example.invalid/api/workspaces/workspace%2Fa/bots/employee%2Fb');
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
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/conversations/original');assert.equal(calls[0].options.method,'GET');
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
