import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=(await readFile(new URL('./api.js',import.meta.url),'utf8'))
  .replace("'./api-base.js'",JSON.stringify(new URL('./api-base.js',import.meta.url).href))
  .replace("'./bounded-read.js'",JSON.stringify(new URL('./bounded-read.js',import.meta.url).href))
  .replaceAll('import.meta.env.','({VITE_API_URL:"",DEV:false}).');
async function fixture(t,fetch){
  const saved={fetch:globalThis.fetch,window:globalThis.window};
  globalThis.window={location:{origin:'https://mcp.test',pathname:'/other/bots'},dispatchEvent(){}};
  globalThis.fetch=fetch;t.after(()=>Object.assign(globalThis,saved));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).api;
}
test('MCP connection API uses explicit workspace, exact request identity and authenticated requests',async t=>{
  const calls=[];const api=await fixture(t,async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({connections:[],connection:{id:'action'}})};});
  const body={server:'viral_library',expectedRevision:4,expectedControlEpoch:2,idempotencyKey:'request-1'};
  await api.botMcpConnections('bot/id','work/space');
  await api.connectBotMcp('bot/id',body,'work/space');
  await api.cancelBotMcpConnection('bot/id','action/id','work/space');
  const base='https://mcp.test/api/workspaces/work%2Fspace/bots/bot%2Fid/mcp/connections';
  assert.deepEqual(calls.map(row=>row.url),[base,base,base+'/action%2Fid']);
  assert.equal(calls[0].options.method,undefined);assert.equal(calls[1].options.method,'POST');assert.equal(calls[2].options.method,'DELETE');
  assert.deepEqual(JSON.parse(calls[1].options.body),body);assert.equal(calls[2].options.body,undefined);
  assert.ok(calls.every(row=>row.options.credentials==='include'));
});
test('MCP connection API preserves typed rejections and forwards cancellation for writes',async t=>{
  let status=409;let seenSignal;const api=await fixture(t,async(url,options)=>{seenSignal=options.signal;return {ok:false,status,json:async()=>({code:'MCP_CONNECTION_BUSY',error:'连接仍在处理中'})};});
  const controller=new AbortController();
  for(status of [403,404,409])await assert.rejects(api.connectBotMcp('bot',{},'ws',{signal:controller.signal}),error=>error.status===status&&error.code==='MCP_CONNECTION_BUSY');
  assert.equal(seenSignal,controller.signal);
  controller.abort();await assert.rejects(api.cancelBotMcpConnection('bot','action','ws',{signal:controller.signal}),error=>error.name==='AbortError');
});
test('MCP list read bounds a stalled fetch and aborts its signal',async t=>{
  let signal;const api=await fixture(t,async(url,options)=>{signal=options.signal;return new Promise(()=>{});});
  await assert.rejects(api.botMcpConnections('bot','ws',{timeoutMs:5}),error=>error.code==='READ_TIMEOUT');assert.equal(signal.aborted,true);
});
