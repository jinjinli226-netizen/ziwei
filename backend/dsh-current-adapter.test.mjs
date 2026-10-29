import test from 'node:test';
import assert from 'node:assert/strict';
import {createDshAdapter} from './dsh-adapter.mjs';
import {dshFixture} from '../test/fixtures/dsh-protocol.mjs';

test('DSH backend adapter uses the real routine session id and native request envelope',async t=>{
  const f=await dshFixture(t,{routes:(req,_body,reply)=>{if(req.url!=='/api/bots/real-bot/routines/routine-1')return false;reply({item:{id:'routine-1',lastSessionId:'real-session'}});return true;}});
  const adapter=createDshAdapter({baseUrl:f.baseUrl,fetchImpl:f.transport.fetchImpl});
  const result=await adapter.routineCancel('real-bot','routine-1');
  assert.equal(result.result.ok,true);const call=f.calls.at(-1);
  assert.equal(call.path,'/runtime/real-bot/api/session/cancel');assert.equal(call.payload.args.request.sessionId,'real-session');
});

test('DSH backend adapter rejects native errors in a successful HTTP response',async t=>{
  const f=await dshFixture(t,{failBots:['real-bot']}),adapter=createDshAdapter({baseUrl:f.baseUrl,fetchImpl:f.transport.fetchImpl});
  await assert.rejects(adapter.sessions('real-bot'),{message:'real-bot unavailable',status:502});
});

test('DSH backend adapter rejects a mismatched native RPC correlation id',async()=>{
  const adapter=createDshAdapter({fetchImpl:async()=>({ok:true,status:200,json:async()=>({type:'server-response',rpcId:'wrong-id',result:{ok:true,value:{}}})})});
  await assert.rejects(adapter.sessions('real-bot'),/invalid RPC response/);
});

test('DSH group adapter rejects duplicate or invalid member lists before requesting a mutation',async()=>{
  let calls=0;const adapter=createDshAdapter({fetchImpl:async()=>{calls++;throw Error('must not mutate');}});
  for(const members of [['a'],['a','a'],['a','']])await assert.rejects(async()=>adapter.groups({method:'POST',body:{members}}),/真实 Bot/);
  assert.equal(calls,0);
});
