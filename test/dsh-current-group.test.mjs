import test from 'node:test';
import assert from 'node:assert/strict';
import { executeDshGroupRuntime } from '../src/dsh-group-runtime.mjs';
import { dshFixture } from './fixtures/dsh-protocol.mjs';

async function fixture(t, { failing = [], hold = false } = {}) {
  const writes=[]; const group={id:'g-test',title:'验收群',members:['bot-a','bot-b'],sessions:{},messages:[]};
  const native=await dshFixture(t,{hold,failBots:failing,routes:(req,body,reply)=>{
    if(req.url!=='/api/groups/g-test')return false;
    if(req.method==='PUT'){writes.push({method:'group.put',body});Object.assign(group,body);}
    reply({ok:true,item:group});return true;
  }});
  return {...native,group,get calls(){return [...native.calls,...writes];}};
}

test('DSH group runtime fans out to real member sessions and persists transcript', async t => {
  const f=await fixture(t); const stages=[];
  const result=await executeDshGroupRuntime({baseUrl:f.baseUrl,...f.transport,groupId:'g-test',prompt:'请协作',onStage:stage=>stages.push(stage)});
  assert.equal(result.responses.length,2); assert.deepEqual(Object.keys(result.sessions).sort(),['bot-a','bot-b']);
  assert.ok(f.calls.some(call=>call.method==='session/prompt' && call.bot==='bot-a'));
  assert.ok(f.calls.some(call=>call.method==='session/prompt' && call.bot==='bot-b'));
  assert.equal(f.calls.at(-1).method,'group.put'); assert.equal(f.calls.at(-1).body.messages.length,3);
  assert.ok(stages.length >= 2);
});

test('DSH group runtime honors @ targeting and keeps other member idle', async t => {
  const f=await fixture(t);
  const result=await executeDshGroupRuntime({baseUrl:f.baseUrl,...f.transport,groupId:'g-test',prompt:'@bot-a 只检查这一项'});
  assert.equal(result.responses.length,1); assert.equal(result.responses[0].member,'bot-a');
  assert.equal(f.calls.some(call=>call.method==='session/prompt' && call.bot==='bot-b'),false);
});

test('DSH group resumes each member session without creating or sharing another Bot session', async t => {
  const f=await fixture(t);
  const first=await executeDshGroupRuntime({baseUrl:f.baseUrl,...f.transport,groupId:'g-test',prompt:'第一轮'});
  const second=await executeDshGroupRuntime({baseUrl:f.baseUrl,...f.transport,groupId:'g-test',prompt:'第二轮'});
  assert.notEqual(first.sessions['bot-a'],first.sessions['bot-b']);
  assert.deepEqual(second.sessions,first.sessions);
  assert.equal(f.calls.filter(call=>call.method==='session/create').length,2);
  for(const bot of ['bot-a','bot-b']) {
    const prompts=f.calls.filter(call=>call.method==='session/prompt' && call.bot===bot);
    assert.equal(prompts.length,2);
    assert.ok(prompts.every(call=>call.payload.args.request.sessionId===first.sessions[bot]));
  }
  assert.equal(f.group.messages.length,6);
});

test('DSH group runtime returns partial failure while persisting successful members', async t => {
  const f=await fixture(t,{failing:['bot-b']});
  const result=await executeDshGroupRuntime({baseUrl:f.baseUrl,...f.transport,groupId:'g-test',prompt:'部分失败也要回执'});
  assert.equal(result.responses.length,1); assert.equal(result.failures[0].member,'bot-b');
  const rows=f.calls.at(-1).body.messages; assert.equal(rows.some(row=>row.status==='error' && row.botName==='bot-b'),true);
});

test('DSH group runtime cancellation reaches every active member session', async t => {
  const f=await fixture(t,{hold:true}); const controller=new AbortController();
  const running=executeDshGroupRuntime({baseUrl:f.baseUrl,...f.transport,groupId:'g-test',prompt:'长任务',signal:controller.signal});
  await new Promise(resolve=>setTimeout(resolve,50)); controller.abort();
  await assert.rejects(running,/取消|cancel|AbortError/i);
  assert.ok(f.calls.some(call=>call.method==='session/cancel'));
});
