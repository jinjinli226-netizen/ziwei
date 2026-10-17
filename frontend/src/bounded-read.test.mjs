import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {boundedRead,READ_TIMEOUT_MS} from './bounded-read.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
const apiSource=(await readFile(new URL('./api.js',import.meta.url),'utf8'))
  .replace("'./api-base.js'",JSON.stringify(new URL('./api-base.js',import.meta.url).href))
  .replace("'./bounded-read.js'",JSON.stringify(new URL('./bounded-read.js',import.meta.url).href))
  .replaceAll('import.meta.env.','({VITE_API_URL:"",DEV:false}).');
async function apiFixture(t,fetch){
  const saved={window:globalThis.window,fetch:globalThis.fetch},events=[];
  globalThis.window={location:{origin:'https://read-fixture.invalid',pathname:'/qa/bots'},dispatchEvent:event=>events.push(event)};
  globalThis.fetch=fetch;t.after(()=>Object.assign(globalThis,saved));
  const {api}=await import(`data:text/javascript;base64,${Buffer.from(apiSource).toString('base64')}`);
  return{api,events};
}

test('whole-read deadline rejects a hung operation and aborts its signal',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  const operation=boundedRead(value=>{signal=value;return new Promise(()=>{});},{timeoutMs:50});
  const rejected=assert.rejects(operation,error=>error.code==='READ_TIMEOUT'&&error.timeoutMs===50);
  t.mock.timers.tick(49);assert.equal(signal.aborted,false);t.mock.timers.tick(1);await rejected;assert.equal(signal.aborted,true);
});

test('successful and failed reads clear their deadline and caller abort listener',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const clear=t.mock.method(globalThis,'clearTimeout');
  const controller=new AbortController(),remove=t.mock.method(controller.signal,'removeEventListener');let signal;
  assert.deepEqual(await boundedRead(value=>{signal=value;return {ready:true};},{signal:controller.signal}),{ready:true});
  assert.equal(clear.mock.callCount(),1);assert.equal(remove.mock.callCount(),1);
  const failure=new Error('read failed');await assert.rejects(boundedRead(()=>{throw failure;}),error=>error===failure);
  assert.equal(clear.mock.callCount(),2);t.mock.timers.tick(READ_TIMEOUT_MS);assert.equal(signal.aborted,false);
});

test('an already cancelled caller never starts the read',async()=>{
  const controller=new AbortController(),reason=new Error('left conversation');controller.abort(reason);let calls=0;
  await assert.rejects(boundedRead(()=>{calls++;},{signal:controller.signal}),error=>error===reason);assert.equal(calls,0);
});

test('caller cancellation settles even when transport ignores abort and rejects late results',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const controller=new AbortController(),gate=deferred(),reason=new Error('changed employee');let signal,delivered=false;
  const operation=boundedRead(value=>{signal=value;return gate.promise;},{signal:controller.signal}).then(()=>{delivered=true;});
  const rejected=assert.rejects(operation,error=>error===reason);controller.abort(reason);await rejected;
  assert.equal(signal.aborted,true);gate.resolve({id:'old-employee'});await settle();assert.equal(delivered,false);
});

test('invalid custom deadlines reject instead of silently disabling the bound',async()=>{
  for(const timeoutMs of [0,-1,Infinity,NaN])await assert.rejects(boundedRead(()=>({}),{timeoutMs}),RangeError);
});

test('api.bot times out hung fetch and ignores a late unauthorized response',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const gate=deferred();let signal,jsonReads=0;
  const {api,events}=await apiFixture(t,(_url,options)=>{signal=options.signal;return gate.promise;});
  const rejected=assert.rejects(api.bot('employee','qa',{timeoutMs:40}),error=>error.code==='READ_TIMEOUT');
  t.mock.timers.tick(40);await rejected;assert.equal(signal.aborted,true);
  gate.resolve({ok:false,status:401,json:async()=>{jsonReads++;return {error:'expired'};}});await settle();
  assert.equal(jsonReads,0);assert.deepEqual(events,[]);
});

test('api.conversation deadline includes a hung response body and ignores late auth errors',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const body=deferred();let signal,jsonReads=0;
  const {api,events}=await apiFixture(t,async(_url,options)=>{signal=options.signal;return {ok:false,status:401,json:()=>{jsonReads++;return body.promise;}};});
  const rejected=assert.rejects(api.conversation('chat',{timeoutMs:40}),error=>error.code==='READ_TIMEOUT');
  await settle();assert.equal(jsonReads,1);t.mock.timers.tick(40);await rejected;assert.equal(signal.aborted,true);
  body.resolve({error:'expired'});await settle();assert.deepEqual(events,[]);
});

test('bounded API reads preserve successful data and HTTP failure status/code',async t=>{
  const calls=[];const {api}=await apiFixture(t,async(url,options)=>{calls.push({url,options});return url.includes('/bots/')?{ok:true,status:200,json:async()=>({id:'employee',revision:7})}:{ok:false,status:403,json:async()=>({error:'private conversation',code:'FORBIDDEN'})};});
  assert.deepEqual(await api.bot('employee','qa'),{id:'employee',revision:7});
  await assert.rejects(api.conversation('chat'),error=>error.status===403&&error.code==='FORBIDDEN'&&error.message==='private conversation');
  assert.ok(calls.every(call=>call.options.signal instanceof AbortSignal));
});

test('api.conversation forwards caller cancellation into the transport',async t=>{
  const controller=new AbortController(),reason=new Error('cancelled by navigation');let signal;
  const {api}=await apiFixture(t,(_url,options)=>{signal=options.signal;return new Promise(()=>{});});
  const rejected=assert.rejects(api.conversation('chat',{signal:controller.signal}),error=>error===reason);
  controller.abort(reason);await rejected;assert.equal(signal.aborted,true);
});

test('execution POST keeps its existing unbounded request behavior',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const gate=deferred(),calls=[];
  const {api}=await apiFixture(t,(_url,options)=>{calls.push(options);return gate.promise;});
  let settled=false;const operation=api.controlBot('employee',{operation:'stop',expectedRevision:1,expectedControlEpoch:1},'qa').then(value=>{settled=true;return value;});
  t.mock.timers.tick(READ_TIMEOUT_MS*2);await settle();assert.equal(settled,false);assert.equal(calls[0].method,'POST');assert.equal(calls[0].signal,undefined);
  gate.resolve({ok:true,status:200,json:async()=>({accepted:true})});assert.deepEqual(await operation,{accepted:true});
});
