import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {openSecret} from '../../src/bot-secret-crypto.mjs';
import {createChatInteractions} from '../web/chat-interactions.js';
import {sealBrowserAnswer} from '../web/interaction-crypto.js';

const keys = generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const clone = value => structuredClone(value);
const settle = async () => { for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve)); };
function request(overrides={}) {
  const kind = overrides.kind || 'question', expiresAt = Math.floor(Date.now()/1000)+300;
  return {requestId:'request-original',workspace:'workspace-one',employeeId:'employee-one',actionId:'action-original',kind,secure:false,display:{question:'本次要整理哪个目录？'},choices:null,options:null,state:'waiting',expiresAt:expiresAt*1000,
    binding:{purpose:'hermes-interaction',requestId:'request-original',kind,expiresAt,workspaceId:'workspace-id',employeeId:'employee-one',actionId:'action-original',deviceId:'device-one',profile:'profile-one',revision:1,controlEpoch:1,keyId:'device-key'},devicePublicKey:keys.publicKey,...overrides};
}
function fixture(overrides={}) {
  const state = {page:'chat',user:{user_id:'user-one'},workspace:{slug:'workspace-one',workspace_id:'workspace-id'},selectedEmployee:{id:'employee-one',runtime:'Hermes'},conversation:{id:'conversation-original',employee_id:'employee-one',execution:{id:'action-original'}}};
  const posts = [], reads = [], failures = []; let requests = [request()];
  const api = {botInteractions:async (...args) => {reads.push(args); return {requests:clone(requests)};},answerBotInteraction:async (...args) => {posts.push(args);const row=requests.find(item=>item.requestId===args[2]);row.state='answered';return clone(row);},...overrides};
  const manager = createChatInteractions({state,api,current:()=>({account:'user-one'}),valid:()=>true,draw:()=>{},fail:(...args)=>failures.push(args)});
  return {state,api,manager,posts,reads,failures,getRequests:()=>requests,setRequests:value=>{requests=value;}};
}
function form(values={}) {
  const data = new FormData();data.set('interactionRequestId','request-original');
  for(const [name,value] of Object.entries(values))for(const item of Array.isArray(value)?value:[value])data.append(name,item);
  return data;
}
function decrypted(fixture) {return JSON.parse(openSecret(keys.privateKey,fixture.getRequests()[0].binding,fixture.posts[0][3].envelope));}

test('mobile encryption matches the existing device relay and is bound to the exact request',async()=>{
  const row = request(), envelope = await sealBrowserAnswer(keys.publicKey,row.binding,{answer:'待确认的真实答复'});
  assert.deepEqual(JSON.parse(openSecret(keys.privateKey,row.binding,envelope)),{answer:'待确认的真实答复'});
  assert.throws(()=>openSecret(keys.privateKey,{...row.binding,requestId:'another-request'},envelope));
  assert.doesNotMatch(JSON.stringify(envelope),/真实答复/);
});

test('reads only current Hermes action questions and approvals; never auto-answers or renders vault input',async()=>{
  const f=fixture();f.setRequests([request(),request({requestId:'old',actionId:'action-old'}),request({employeeId:'other'}),request({workspace:'other'}),request({kind:'vault_code',secure:true,display:{question:'secret input'}})]);
  await f.manager.refresh();
  assert.deepEqual(f.reads,[['workspace-one','employee-one']]);assert.equal(f.posts.length,0);assert.equal(f.state.chatInteractions.requests.length,1);
  assert.match(f.manager.render(),/员工需要补充信息/);assert.doesNotMatch(f.manager.render(),/secret input|type="password"/);
  f.state.selectedEmployee.runtime='DSH';await f.manager.refresh();assert.equal(f.manager.render(),'');assert.equal(f.reads.length,1);
});

test('text answer sends only an encrypted envelope and no plaintext enters state or another conversation',async()=>{
  const f=fixture();await f.manager.refresh();
  assert.equal(await f.manager.submit(form({interactionAnswer:'只读D盘项目目录'})),true);await settle();
  assert.equal(f.posts.length,1);assert.deepEqual(f.posts[0].slice(0,3),['workspace-one','employee-one','request-original']);
  assert.deepEqual(Object.keys(f.posts[0][3]),['envelope']);assert.deepEqual(decrypted(f),{answer:'只读D盘项目目录'});
  assert.doesNotMatch(JSON.stringify(f.state),/只读D盘项目目录/);assert.match(f.manager.render(),/已提交，等待员工接收/);assert.doesNotMatch(f.manager.render(),/<textarea/);
});

test('approval needs an explicit offered decision and uses neutral buttons without a default choice',async()=>{
  const f=fixture();f.setRequests([request({kind:'approval',choices:['once','deny'],display:{description:'修改当前文件',command:'write target.txt'}})]);await f.manager.refresh();
  const html=f.manager.render();assert.match(html,/仅本次允许/);assert.match(html,/拒绝/);assert.match(html,/class="button secondary"/);assert.doesNotMatch(html,/checked|selected|button primary/);assert.equal(f.posts.length,0);
  assert.equal(await f.manager.submit(form({interactionAnswer:'always'})),false);assert.equal(f.posts.length,0);
  assert.equal(await f.manager.submit(form({interactionAnswer:'deny'})),true);await settle();assert.deepEqual(decrypted(f),{answer:'deny'});
});

test('multiple questions preserve single-choice, multi-choice and free-text structures',async()=>{
  const f=fixture();f.setRequests([request({display:{questions:[{qid:'format',question:'输出格式',choices:['CSV','JSON']},{qid:'targets',question:'选择目录',choices:['A','B'],multi_select:true},{qid:'notes',question:'补充说明'}]}})]);await f.manager.refresh();
  const html=f.manager.render();assert.match(html,/type="radio" name="interactionAnswer:format"/);assert.match(html,/type="checkbox" name="interactionAnswer:targets"/);assert.match(html,/textarea name="interactionAnswer:notes"/);
  assert.equal(await f.manager.submit(form({'interactionAnswer:format':'CSV','interactionAnswer:targets':['A','B'],'interactionAnswer:notes':'保留原文件'})),true);await settle();
  assert.deepEqual(decrypted(f),{answer:{answers:{format:'CSV',targets:['A','B'],notes:'保留原文件'}}});
});

test('blank, expired, missing-option approvals and invalid bindings cannot be submitted',async()=>{
  const f=fixture();await f.manager.refresh();assert.equal(await f.manager.submit(form({interactionAnswer:''})),false);assert.equal(f.posts.length,0);
  const expired=request();expired.binding.expiresAt=Math.floor(Date.now()/1000)-1;expired.expiresAt=expired.binding.expiresAt*1000;f.setRequests([expired]);await f.manager.refresh();assert.equal(await f.manager.submit(form({interactionAnswer:'late'})),false);assert.equal(f.posts.length,0);
  f.setRequests([request({kind:'approval'})]);await f.manager.refresh();assert.equal(await f.manager.submit(form({interactionAnswer:'approve'})),false);assert.equal(f.posts.length,0);
  f.setRequests([request({binding:{...request().binding,actionId:'other'}})]);await f.manager.refresh();assert.equal(f.state.chatInteractions.phase,'error');assert.match(f.manager.render(),/同步失败/);
});

test('a lost POST acknowledgement locks the original request through polling and navigation',async()=>{
  let posts=0;const f=fixture({answerBotInteraction:async()=>{posts++;throw Object.assign(new Error('synthetic transport'),{uncertain:true});}});await f.manager.refresh();
  assert.equal(await f.manager.submit(form({interactionAnswer:'volatile-answer'})),false);await settle();assert.deepEqual(f.state.chatInteractions.unknownRequestIds,['request-original']);assert.match(f.manager.render(),/仅查询原请求/);
  assert.equal(await f.manager.submit(form({interactionAnswer:'another-answer'})),false);assert.equal(posts,1);
  f.manager.reset();await f.manager.refresh();assert.equal(await f.manager.submit(form({interactionAnswer:'again'})),false);assert.equal(posts,1);
  assert.doesNotMatch(JSON.stringify(f.state),/volatile-answer|another-answer/);
  f.setRequests([request({state:'delivered'})]);await f.manager.refresh();assert.deepEqual(f.state.chatInteractions.unknownRequestIds,[]);assert.match(f.manager.render(),/员工已接收/);
});

test('pending POST remains locked after leaving and reopening, and late read results cannot replace the current scope',async()=>{
  let finishPost, finishRead, posted;const atPost=new Promise(resolve=>{posted=resolve;});
  const f=fixture({answerBotInteraction:async()=>{posted();return new Promise(resolve=>{finishPost=resolve;});}});await f.manager.refresh();
  const sending=f.manager.submit(form({interactionAnswer:'pending answer'}));await atPost;
  f.manager.reset();await f.manager.refresh();assert.equal(await f.manager.submit(form({interactionAnswer:'duplicate'})),false);
  finishPost(request({state:'answered'}));await sending;assert.doesNotMatch(JSON.stringify(f.state),/pending answer|duplicate/);
  assert.equal(await f.manager.submit(form({interactionAnswer:'duplicate after original success'})),false,'reopened stale waiting state stays locked until server readback');
  f.api.botInteractions=()=>new Promise(resolve=>{finishRead=resolve;});const previous=f.manager.refresh();
  f.state.conversation={id:'another-conversation',employee_id:'employee-one',execution:{id:'another-action'}};f.manager.reset();finishRead({requests:[request()]});await previous;
  assert.equal(f.state.chatInteractions.requests.length,0);assert.equal(f.manager.render(),'');
});

test('unsupported or failed reads are explicit and escape display content',async()=>{
  const f=fixture();f.setRequests([request({display:{question:'<script>question</script>'},choices:['<img>']})]);await f.manager.refresh();
  assert.match(f.manager.render(),/&lt;script&gt;question/);assert.match(f.manager.render(),/&lt;img&gt;/);assert.doesNotMatch(f.manager.render(),/<script>|<img>/);
  f.api.botInteractions=async()=>{throw Object.assign(new Error('404'),{status:404});};await f.manager.refresh();assert.match(f.manager.render(),/服务器尚未提供/);assert.equal(f.state.chatInteractions.requests.length,1);
});
