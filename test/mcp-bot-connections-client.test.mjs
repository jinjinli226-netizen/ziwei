import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createMcpClient,createMcpHandler} from '../scripts/ziwei-mcp.mjs';

const TOKEN='fixture-token';
const data=Object.freeze({server:'viral_library',expectedRevision:7,expectedControlEpoch:3,idempotencyKey:'stable-connect-key'});
const receipt=status=>({connection:{id:'connection/one',workspace:'test-111',employeeId:'bot-1',server:'viral_library',idempotencyKey:data.idempotencyKey,status,...(status==='authorization_required'?{authorizationUrl:'https://auth.example.test/authorize?state=public-fixture'}:{})}});
function fixture(payload={connections:[]},status=200){
  const requests=[];
  const client=createMcpClient({baseUrl:'https://example.test',workspace:'test-111',token:TOKEN,fetchImpl:async(url,init)=>{requests.push({url:String(url),init});return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});}});
  const handler=createMcpHandler(client);
  const call=arguments_=>handler({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'ziwei_bot',arguments:arguments_}});
  return {client,handler,call,requests};
}

test('ziwei_bot advertises all three MCP connection operations and the authorization workflow',async()=>{
  const f=fixture(),response=await f.handler({jsonrpc:'2.0',id:1,method:'tools/list'});
  const bot=response.result.tools.find(tool=>tool.name==='ziwei_bot');assert.ok(bot);
  for(const operation of ['mcpConnections','connectMcp','cancelMcpConnection'])assert.ok(bot.inputSchema.properties.operation.enum.includes(operation));
  assert.equal(bot.inputSchema.properties.connectionId.type,'string');
  const description=bot.description+' '+bot.inputSchema.properties.data.description;
  for(const term of ['mcpConnections','connectMcp','cancelMcpConnection','authorizationUrl','connected','idempotencyKey','deferUntilIdle','connectMcpServers','expectedControlEpoch','deferredConfig'])assert.ok(description.includes(term),`missing connection workflow keyword: ${term}`);
  assert.equal(f.requests.length,0);
});

test('connection GET preserves authenticated workspace routing, encodes Bot ID and keeps deviceId in the query',async()=>{
  const payload={connections:[receipt('connecting').connection]},f=fixture(payload);
  assert.deepEqual(await f.client.bot({operation:'mcpConnections',id:'bot/中?x#y',workspace:'another-team',deviceId:'pc 1&other=x'}),payload);
  assert.equal(f.requests.length,1);const {url,init}=f.requests[0];
  assert.equal(url,'https://example.test/mcp/v1/workspaces/another-team/bots/'+encodeURIComponent('bot/中?x#y')+'/mcp/connections?deviceId=pc+1%26other%3Dx');
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.headers.authorization,'Bearer '+TOKEN);assert.equal(init.redirect,'error');
});

test('connection POST sends only data fields and explicit retries retain the exact idempotency key',async()=>{
  const f=fixture(receipt('connecting'),202),input={operation:'connectMcp',id:'bot/one',workspace:'another-team',deviceId:'pc-1',data};
  await f.client.bot(input);await f.client.bot(input);assert.equal(f.requests.length,2);
  for(const {url,init} of f.requests){
    assert.equal(url,'https://example.test/mcp/v1/workspaces/another-team/bots/bot%2Fone/mcp/connections?deviceId=pc-1');assert.equal(init.method,'POST');
    assert.equal(init.headers.authorization,'Bearer '+TOKEN);assert.equal(init.headers['content-type'],'application/json');assert.deepEqual(JSON.parse(init.body),data);
    assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(),['expectedControlEpoch','expectedRevision','idempotencyKey','server']);
  }
  assert.equal(f.requests[0].init.body,f.requests[1].init.body);assert.equal(data.idempotencyKey,'stable-connect-key');
});

test('deferred configuration uses the existing update operation and preserves the exact queued request body',async()=>{
  const queued={id:'bot-1',deferredConfig:{id:'deferred-one',phase:'queued',connections:[]}},f=fixture(queued,202);
  const input={operation:'update',id:'bot-1',data:{expectedRevision:7,expectedControlEpoch:3,idempotencyKey:'same-config-intent',deferUntilIdle:true,connectMcpServers:['viral_library'],config:{mcpServers:{viral_library:{transport:'http',url:'https://library.example.test/mcp',auth:'oauth',oauth:{cimd:false,scope:'read'},enabled:true}}}}};
  assert.deepEqual(await f.client.bot(input),queued);assert.deepEqual(await f.client.bot(input),queued);
  assert.equal(f.requests.length,2);
  for(const {url,init}of f.requests){assert.equal(url,'https://example.test/mcp/v1/workspaces/test-111/bots/bot-1');assert.equal(init.method,'PATCH');assert.deepEqual(JSON.parse(init.body),input.data);}
  assert.equal(f.requests[0].init.body,f.requests[1].init.body);
});

test('connection cancellation encodes the exact original ID without changing workspace or device routing',async()=>{
  const payload=receipt('cancelled'),f=fixture(payload);
  assert.deepEqual(await f.client.bot({operation:'cancelMcpConnection',id:'bot/中',connectionId:'connection/a?b#中',workspace:'another-team',deviceId:'pc-1'}),payload);
  const {url,init}=f.requests[0];assert.equal(url,'https://example.test/mcp/v1/workspaces/another-team/bots/'+encodeURIComponent('bot/中')+'/mcp/connections/'+encodeURIComponent('connection/a?b#中')+'?deviceId=pc-1');
  assert.equal(init.method,'DELETE');assert.equal(init.headers.authorization,'Bearer '+TOKEN);assert.deepEqual(JSON.parse(init.body),{});
});

test('tools/call keeps connecting and authorization-required receipts unchanged instead of reporting connected',async()=>{
  for(const status of ['connecting','authorization_required']){
    const payload=receipt(status),f=fixture(payload,202),response=await f.call({operation:'connectMcp',id:'bot-1',data});
    assert.equal(response.error,undefined);const value=JSON.parse(response.result.content[0].text);assert.deepEqual(value,payload);assert.notEqual(value.connection.status,'connected');assert.equal('connected' in value.connection,false);
    if(status==='authorization_required')assert.equal(value.connection.authorizationUrl,payload.connection.authorizationUrl);assert.equal(f.requests.length,1);
  }
});

test('missing Bot IDs and missing cancellation connection IDs fail before any fetch',async()=>{
  const f=fixture();
  for(const operation of ['mcpConnections','connectMcp','cancelMcpConnection']){
    await assert.rejects(f.client.bot({operation,connectionId:'connection-1',data}),/id/i);
    const response=await f.call({operation,data});assert.ok(response.error);assert.match(response.error.message,/id/i);
  }
  await assert.rejects(f.client.bot({operation:'cancelMcpConnection',id:'bot-1'}),/connectionId/);assert.equal(f.requests.length,0);
});

test('HTTP 403 stays the original API error in both client and JSON-RPC responses',async()=>{
  const f=fixture({error:'fixture workspace permission denied'},403);
  await assert.rejects(f.client.bot({operation:'mcpConnections',id:'bot-1'}),error=>error.message==='fixture workspace permission denied');
  const response=await f.call({operation:'connectMcp',id:'bot-1',data});assert.equal(response.result,undefined);assert.equal(response.error.message,'fixture workspace permission denied');assert.equal(f.requests.length,2);
});

test('managed credentials cannot use any connection operation across workspaces',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-mcp-connection-scope-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const tokenFile=path.join(directory,'mcp.json');fs.writeFileSync(tokenFile,JSON.stringify({token:TOKEN,managed:true,workspace:'test-111',audience:'ziwei-management',apiBase:'https://example.test',deviceId:'pc-1',expiresAt:new Date(Date.now()+60_000).toISOString()}),{mode:0o600});
  let calls=0;const client=createMcpClient({baseUrl:'https://example.test',workspace:'test-111',tokenFile,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({connections:[]}));}});
  for(const operation of ['mcpConnections','connectMcp','cancelMcpConnection'])await assert.rejects(client.bot({operation,id:'bot-1',connectionId:'connection-1',workspace:'other-team',data}),/只能访问当前已连接工作区/);
  assert.equal(calls,0);assert.deepEqual(await client.bot({operation:'mcpConnections',id:'bot-1'}),{connections:[]});assert.equal(calls,1);
});

test('connection tools keep the existing workspace syntax rejection without a network request',async()=>{
  const f=fixture();for(const workspace of ['../another','team/a','中文'])await assert.rejects(f.client.bot({operation:'connectMcp',id:'bot-1',workspace,data}),/工作区标识无效/);
  assert.equal(f.requests.length,0);
});
