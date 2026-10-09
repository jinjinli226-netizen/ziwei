import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
const bridge=await import('../scripts/ziwei-terminal-mcp.mjs').catch(()=>({}));
function fixture(t,overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-terminal-bridge-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const token='employee-fixture-capability-only';
  const config={token,workspace:'phone_ai',employeeId:'employee-fixture',deviceId:'android-fixture',actionId:'action-fixture',expiresAt:new Date(Date.now()+60000).toISOString(),baseUrl:'https://qzelynth.top/terminal-mcp/v1/workspaces/phone_ai/employees/employee-fixture',...overrides};
  const tokenFile=path.join(dir,'private.json');fs.writeFileSync(tokenFile,JSON.stringify(config),{mode:0o600});
  return {dir,tokenFile,config,token};
}
test('terminal bridge exposes the existing ten tools without administrator credentials',()=>{
  assert.ok(Array.isArray(bridge.toolDefinitions),'missing real terminal bridge tool catalog');
  assert.deepEqual(bridge.toolDefinitions.map(t=>t.name).sort(),['ziwei_phone_list','ziwei_phone_status','ziwei_phone_receipt','ziwei_phone_action','ziwei_phone_screenshot','ziwei_phone_control','ziwei_phone_upgrade','ziwei_phone_wait','ziwei_enrollment_pending','ziwei_enrollment_approve'].sort());
});
test('terminal client calls only the employee scoped HTTPS capability endpoint',async t=>{
  const f=fixture(t);const calls=[];
  const client=bridge.createTerminalMcpClient({tokenFile:f.tokenFile,fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({device:{id:'android-fixture'}}),{status:200});}});
  const result=await client.call('ziwei_phone_status',{deviceId:'android-fixture'});
  assert.equal(result.device.id,'android-fixture');assert.equal(calls.length,1);
  assert.equal(calls[0].url,f.config.baseUrl+'/call');assert.equal(calls[0].init.redirect,'error');
  assert.equal(calls[0].init.headers.authorization,'Bearer '+f.token);
  assert.deepEqual(JSON.parse(calls[0].init.body),{name:'ziwei_phone_status',arguments:{deviceId:'android-fixture'}});
});
test('terminal client rejects a different phone, employee, insecure origin or expired capability',async t=>{
  const f=fixture(t);let calls=0;const fetchImpl=async()=>{calls++;throw new Error('must not call');};
  const client=bridge.createTerminalMcpClient({tokenFile:f.tokenFile,fetchImpl});
  await assert.rejects(client.call('ziwei_phone_action',{deviceId:'another-phone',action:'tap',args:{}}),/手机|目标|scope/i);
  assert.throws(()=>bridge.createTerminalMcpClient({tokenFile:f.tokenFile,employeeId:'another-employee',fetchImpl}),/员工|scope/i);
  assert.throws(()=>bridge.createTerminalMcpClient({tokenFile:fixture(t,{baseUrl:'http://public.test/terminal-mcp/v1/workspaces/phone_ai/employees/employee-fixture'}).tokenFile,fetchImpl}),/HTTPS/);
  assert.throws(()=>bridge.createTerminalMcpClient({tokenFile:fixture(t,{expiresAt:'2000-01-01T00:00:00Z'}).tokenFile,fetchImpl}),/过期/);
  assert.equal(calls,0);
});
test('uncertain transport and authentication failures never replay a phone action or reveal capability',async t=>{
  const f=fixture(t);let calls=0;
  const client=bridge.createTerminalMcpClient({tokenFile:f.tokenFile,fetchImpl:async()=>{calls++;throw new Error(f.token);}});
  await assert.rejects(client.call('ziwei_phone_action',{deviceId:'android-fixture',action:'global',args:{key:'back'}}),error=>!error.message.includes(f.token)&&/回执|重放|连接/.test(error.message));
  assert.equal(calls,1);
  const unauthorized=bridge.createTerminalMcpClient({tokenFile:f.tokenFile,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:f.token}),{status:401});}});
  await assert.rejects(unauthorized.call('ziwei_phone_status',{deviceId:'android-fixture'}),error=>!error.message.includes(f.token));assert.equal(calls,2);
});
test('screenshot JSON-RPC returns image pixels with metadata and preserves command ID',async()=>{
  const response=await bridge.handleTerminalJsonRpc({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ziwei_phone_screenshot',arguments:{deviceId:'android-fixture'}}},{call:async()=>({command:{id:'command-fixture',status:'succeeded'},device:{id:'android-fixture',snapshot:{data:'aW1hZ2U=',mime:'image/jpeg',width:720,height:1612,capturedAt:'2026-10-09T00:00:00Z'}}})});
  assert.equal(response.result.isError,false);assert.equal(response.result.content[1].type,'image');assert.equal(response.result.content[1].data,'aW1hZ2U=');
  const metadata=JSON.parse(response.result.content[0].text);assert.equal(metadata.command.id,'command-fixture');assert.equal(metadata.width,720);assert.equal(metadata.height,1612);assert.ok(!response.result.content[0].text.includes('aW1hZ2U='));
});
test('stdio audit records actual handshake, discovery and receipt IDs without arguments or image bytes',async t=>{
  const f=fixture(t);const auditFile=path.join(f.dir,'audit.ndjson');const input=new PassThrough();const output=new PassThrough();let stdout='';output.on('data',chunk=>stdout+=chunk);
  input.end([{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'ziwei_phone_action',arguments:{deviceId:'android-fixture',action:'text',args:{text:'private-business-text'}}}}].map(x=>JSON.stringify(x)).join('\n')+'\n');
  await bridge.runTerminalStdio({client:{call:async()=>({command:{id:'command-fixture',status:'succeeded'},update:{id:'update-fixture',state:'awaiting_health'},device:{id:'android-fixture'}})},input,output,auditFile,workspace:'phone_ai'});
  const log=fs.readFileSync(auditFile,'utf8');const rows=log.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(x=>x.method),['initialize','tools/list','tools/call']);assert.equal(rows[2].commandId,'command-fixture');assert.equal(rows[2].status,'succeeded');assert.equal(rows[2].deviceId,'android-fixture');
  assert.equal(rows[2].commandStatus,'succeeded');assert.equal(rows[2].updateStatus,'awaiting_health');
  assert.ok(!log.includes('private-business-text'));assert.ok(!log.includes(f.token));assert.equal(stdout.trim().split('\n').length,3);
});
test('wait and status audit retain only receipt IDs and terminal states for already submitted work',async t=>{
  const f=fixture(t);const auditFile=path.join(f.dir,'receipts.ndjson');const input=new PassThrough();const output=new PassThrough();output.resume();
  input.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ziwei_phone_wait',arguments:{deviceId:'android-fixture',commandId:'command-fixture'}}})+'\n');
  await bridge.runTerminalStdio({client:{call:async()=>({id:'android-fixture',commands:[{id:'command-fixture',status:'succeeded',result:{data:'must-not-audit-image'}}],updates:[{id:'update-fixture',state:'committed',error:'private-detail'}]})},input,output,auditFile,workspace:'phone_ai'});
  const event=JSON.parse(fs.readFileSync(auditFile,'utf8').trim());
  assert.deepEqual(event.receipts,[{commandId:'command-fixture',status:'succeeded'},{updateId:'update-fixture',status:'committed'}]);
  assert.ok(!JSON.stringify(event).includes('must-not-audit-image'));assert.ok(!JSON.stringify(event).includes('private-detail'));
});
