import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.mjs';
import { createMcpClient } from '../scripts/ziwei-mcp.mjs';
import { createAuthService } from '../backend/auth.mjs';

test('manual API and Creator MCP use one Bot record, native validation, controls and Routine backend',async()=>{
  const token='isolated-bot-mcp-test-token',app=createApp({memory:true,mcpToken:token,mcpWorkspace:'test-111',mcpRole:'admin'}),repo=app.locals.repo;
  repo.heartbeatDevice('test-111',{deviceId:'api-bot-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,client=createMcpClient({baseUrl:base,workspace:'test-111',token});
  const request=async(method,path,body)=>{const response=await fetch(base+path,{method,headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  try {
    const created=await request('POST','/api/workspaces/test-111/bots',{name:'API Bot',targetDeviceId:'api-bot-pc',runtimeProfile:'default',model:'model-a',persona:'fixture role',idempotencyKey:'create'});
    assert.equal(created.status,201);const bot=created.body;
    const read=await client.bot({operation:'get',id:bot.id});assert.equal(read.id,bot.id);assert.equal(read.main_conversation_id,bot.main_conversation_id);
    const validation=await client.bot({operation:'validate',id:bot.id,data:{expectedRevision:1,idempotencyKey:'validate'}});
    repo.ackA2AAction(validation.action.id,{deviceId:'api-bot-pc'});
    repo.resultA2AAction(validation.action.id,{status:'succeeded',result:{botValidation:{valid:true,schemaVersion:1,employeeId:bot.id,revision:1,nativeVersion:'0.21.3'}}});
    const enabled=await client.bot({operation:'control',id:bot.id,data:{expectedRevision:1,expectedControlEpoch:1,operation:'activate'}});assert.equal(enabled.control_state,'active');
    const chat=await request('POST',`/api/conversations/${bot.main_conversation_id}/messages`,{content:'test work',clientMessageId:'one'});assert.equal(chat.status,201);
    const action=repo.getA2AAction(chat.body.execution.id);assert.equal(action.payload.hermesBot.config.permissions.mode,'read_only');
    repo.resultA2AAction(action.id,{status:'succeeded',result:{output:'fixture result'}});
    const routine=await client.bot({operation:'createRoutine',id:bot.id,data:{name:'daily',prompt:'test report',schedule:'每天 9:00',timezone:'Asia/Shanghai',idempotencyKey:'routine'}});
    assert.equal(routine.authority,'ziwei');assert.equal(routine.employee_id,bot.id);
    const deleted=await request('DELETE',`/api/workspaces/test-111/bots/${bot.id}/routines/${routine.id}`);assert.equal(deleted.body.deleted,true);
    const paused=await request('POST',`/api/workspaces/test-111/bots/${bot.id}/control`,{expectedRevision:1,expectedControlEpoch:2,operation:'pause'});assert.equal(paused.body.control_state,'paused');
    const blocked=await request('POST',`/api/conversations/${bot.main_conversation_id}/messages`,{content:'bypass'});assert.equal(blocked.status,409);assert.equal(blocked.body.code,'BOT_NOT_ACTIVE');
    const other=await request('GET',`/api/workspaces/foreign/bots/${bot.id}`);assert.equal(other.status,404);
    const mcpOther=await fetch(base+`/mcp/v1/workspaces/foreign/bots/${bot.id}`,{headers:{authorization:`Bearer ${token}`}});assert.equal(mcpOther.status,403);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repo.db.close();}
});

test('preview authentication can use a separate cookie without reading the ordinary session cookie',()=>{
  const app=createApp({memory:true}),db=app.locals.repo.db;
  try {
    const auth=createAuthService(db,{cookieName:'ziwei_preview_e03_session'});let cookie;
    auth.setCookie({setHeader(_name,value){cookie=value;}},{token:'isolated-fixture-session'});
    assert.match(cookie,/^ziwei_preview_e03_session=/);
    assert.equal(auth.cookieName,'ziwei_preview_e03_session');
    assert.equal(auth.status({headers:{cookie:'ziwei_session=ordinary-fixture-token'}}).authenticated,false);
  } finally {db.close();}
});
