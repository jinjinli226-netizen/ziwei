import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createApp} from '../backend/app.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
import {MCP_OAUTH_RELAY_FEATURE} from '../backend/bot-mcp-connections.mjs';
import {createMcpClient} from '../scripts/ziwei-mcp.mjs';

// The Mac port registry allocates this port before this integration test runs.
// Pure contract tests do not require a listening service.
const port=Number(process.env.ZIWEI_MCP_OAUTH_TEST_PORT);
test('authenticated browser -> exact paired device -> public OAuth callback -> native result', {skip:!port?'Set ZIWEI_MCP_OAUTH_TEST_PORT to a registered isolated test port':false},async t=>{
  assert.ok(Number.isInteger(port)&&port>1024&&port<=65535);
  const app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,publicApiBase:'https://ziwei.example.invalid',enableScheduler:false}),repo=app.locals.repo;
  const owner=app.locals.auth.setup({name:'MCP fixture',email:'mcp-http@example.test',password:crypto.randomUUID()});
  const ws=app.locals.auth.createWorkspace(owner.user_id,{name:'MCP fixture',slug:'mcp-http',kind:'team'}).workspace;
  const device=repo.claimDevicePairing({code:repo.createDevicePairing(ws.slug,{ownerUserId:owner.user_id,createdBy:owner.user_id,name:'Isolated PC'}).code});
  repo.heartbeatDevice(ws.slug,{deviceId:device.deviceId,runtimeDiscovery:{features:[MCP_OAUTH_RELAY_FEATURE]},runtimes:{Hermes:{status:'available',version:'0.22.0',profiles:[{name:'default',provider_configured:true,authentication_configured:true}],models:[{id:'fixture'}]}}});
  assert.ok(app.locals.botMcpConnections);
  const management=(await import('../backend/management.mjs')).createManagementService(repo);
  const employee=management.bots.create(ws.slug,{name:'MCP fixture bot',targetDeviceId:device.deviceId,runtimeProfile:'default',model:'fixture',idempotencyKey:'create',config:{permissions:{mode:'execute'},mcpServers:{example:{transport:'http',url:'https://mcp.example.invalid/mcp',auth:'oauth',oauth:{cimd:false},enabled:true}}}},{actorUserId:owner.user_id});
  completeOwnedProfile(repo,employee);
  const server=app.listen(port,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repo.db.close();});
  const base=`http://127.0.0.1:${port}`,path=`/api/workspaces/${ws.slug}/bots/${employee.id}/mcp/connections`;
  const browser={cookie:`ziwei_session=${owner.session.token}`},deviceHeaders={'x-ziwei-device-token':device.deviceToken};
  async function request(path,{method='GET',body,headers={}}={}) {const r=await fetch(base+path,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,cache:r.headers.get('cache-control'),body:await r.json()};}
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path,{headers:deviceHeaders})).status,401);
  const accepted=await request(path,{method:'POST',headers:browser,body:{server:'example',expectedRevision:employee.revision,expectedControlEpoch:employee.control_epoch,idempotencyKey:'connect'}});
  assert.equal(accepted.status,202);assert.equal(accepted.cache,'no-store');const id=accepted.body.connection.id;
  const bootstrap=app.locals.managementBootstrap.bootstrap(ws.slug,repo.authenticateDeviceToken(device.deviceToken));
  const manager=createMcpClient({baseUrl:base,workspace:ws.slug,token:bootstrap.token});
  const duplicate=await manager.bot({operation:'connectMcp',id:employee.id,data:{server:'example',expectedRevision:employee.revision,expectedControlEpoch:employee.control_epoch,idempotencyKey:'connect'}});
  assert.equal(duplicate.connection.id,id);
  const devicePath=`/a2a/v1/actions/${id}/mcp-oauth`;
  assert.equal((await request(devicePath+'/start',{method:'POST',headers:browser,body:{}})).status,401);
  repo.ackA2AAction(id,{deviceId:device.deviceId});
  const begin=await request(devicePath+'/start',{method:'POST',headers:deviceHeaders,body:{}});assert.equal(begin.status,200);assert.equal(begin.body.redirectUri,'https://ziwei.example.invalid/api/mcp-oauth/callback');
  const authorizationUrl='https://login.example.invalid/authorize?'+new URLSearchParams({state:'http-fixture-state',redirect_uri:begin.body.redirectUri,response_type:'code',code_challenge:'fixture',code_challenge_method:'S256'});
  assert.equal((await request(devicePath+'/authorization',{method:'POST',headers:deviceHeaders,body:{authorizationUrl}})).status,200);
  assert.equal((await request(path,{headers:browser})).body.connections[0].status,'authorization_required');
  assert.equal((await manager.bot({operation:'mcpConnections',id:employee.id})).connections[0].authorizationUrl,authorizationUrl);
  const callback=await fetch(base+'/api/mcp-oauth/callback?'+new URLSearchParams({state:'http-fixture-state',code:'fixture-authorization-code'}));
  assert.equal(callback.status,200);assert.equal(callback.headers.get('cache-control'),'no-store');assert.equal(callback.headers.get('referrer-policy'),'no-referrer');assert.equal((await callback.text()).includes('fixture-authorization-code'),false);
  const pending=await request(path,{headers:browser});assert.equal(pending.body.connections[0].status,'connecting');assert.equal(JSON.stringify(pending).includes('fixture-authorization-code'),false);
  const handoff=await request(devicePath+'/callback',{headers:deviceHeaders});assert.equal(handoff.status,200);assert.equal(handoff.body.callback.code,'fixture-authorization-code');
  assert.equal((await fetch(base+'/api/mcp-oauth/callback?state=http-fixture-state&code=replay')).status,410);
  repo.resultA2AAction(id,{deviceId:device.deviceId,status:'succeeded',result:{nativeOperation:{schemaVersion:2,resource:'mcp',operation:'authorize',employeeId:employee.id,revision:employee.revision,status:'succeeded',data:{connected:true,tools:[{name:'lookup',description:'Read'}],credentialLocation:'target_profile'}}}});
  const ready=await request(path,{headers:browser});assert.equal(ready.body.connections[0].status,'connected');assert.equal(ready.body.connections[0].toolsCount,1);
  assert.notEqual((await request(devicePath+'/callback',{headers:deviceHeaders})).status,200);
});
