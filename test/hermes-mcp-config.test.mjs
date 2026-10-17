import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse as yaml} from 'yaml';
import {normalizeBotConfig} from '../src/hermes-bot-config.mjs';
import {prepareHermesBotHome} from '../src/hermes-bot-runtime.mjs';
import {hermesMcpServerName,enabledHermesMcpServerNames,hermesBotToolsets,nativeHermesMcpServers} from '../src/hermes-mcp-config.mjs';

const remote=()=>({transport:'http',url:'https://mcp.fixture.invalid/mcp',auth:'oauth',oauth:{cimd:false,scope:'library:read planner:read'},supportsParallelToolCalls:false,tools:{resources:false,prompts:false}});
const configured=(servers)=>normalizeBotConfig({permissions:{mode:'execute'},toolsets:['web'],mcpServers:servers});

test('OAuth configuration retains public native fields, resource switches and explicit parallel-call preference',()=>{
  const oauth={cimd:false,scope:'library:read planner:read',client_id:'public-fixture-client',client_name:'Ziwei fixture',client_metadata_url:'https://public.fixture.invalid/client.json',redirect_uri:'https://ziwei.fixture.invalid/oauth/callback',redirect_host:'localhost',redirect_port:4789,flow:'browser',timeout:300,user_agent:'Ziwei Fixture',application_type:'web',token_endpoint_auth_method:'none'};
  const input={...remote(),oauth,headers:{'X-Client':'${PUBLIC_CLIENT_HEADER}'},env:{API_KEY:'${LOCAL_API_KEY}'},connectTimeout:30};
  const normalized=configured({viral_library:input}),server=normalized.mcpServers.viral_library;
  assert.deepEqual(server.oauth,oauth);assert.equal(server.auth,'oauth');assert.equal(server.supportsParallelToolCalls,false);
  assert.deepEqual(server.tools,{resources:false,prompts:false});assert.deepEqual(server.headers,input.headers);assert.deepEqual(server.env,input.env);
  assert.deepEqual(normalizeBotConfig(normalized),normalized);assert.deepEqual(input.oauth,oauth);
  const native=nativeHermesMcpServers(normalized).viral_library;
  assert.equal(native.supports_parallel_tool_calls,false);assert.equal(native.supportsParallelToolCalls,undefined);assert.equal(native.connect_timeout,30);
  assert.deepEqual(native.oauth,oauth);assert.deepEqual(native.tools,server.tools);
});

test('OAuth public config refuses token stores, confidential clients, arbitrary extensions and embedded credential references',()=>{
  const marker='synthetic-sensitive-value';
  for(const key of ['client_secret','access_token','refresh_token','tokens','authorization_code','code_verifier','_cimd_url','_resolved_port']) {
    assert.throws(()=>configured({sample:{...remote(),oauth:{[key]:marker}}}),error=>error.code==='BOT_CONFIG_UNSUPPORTED'&&!error.message.includes(marker),key);
  }
  for(const patch of [
    {auth:'basic'}, {transport:'stdio',command:'fixture'}, {auth:'header',oauth:{}},
    {oauth:{cimd:'false'}}, {oauth:{scope:['read']}}, {oauth:{redirect_port:80}}, {oauth:{timeout:0}},
    {oauth:{token_endpoint_auth_method:'client_secret_post'}}, {oauth:{redirect_host:'0.0.0.0'}}, {oauth:{flow:'implicit'}},
    {oauth:{client_metadata_url:'https://user:password@fixture.invalid/client.json'}},
    {oauth:{redirect_uri:'https://fixture.invalid/callback?code=synthetic-code'}},
    {oauth:{client_id:'${LOCAL_API_KEY}'}}, {oauth:{scope:'read\nwrite'}},
    {supportsParallelToolCalls:'false'}, {tools:{resources:'false'}}, {tools:{prompts:0}},
  ])assert.throws(()=>configured({sample:{...remote(),...patch}}),patch.oauth?undefined:{status:400});
});

test('existing stdio and header identities remain unchanged while OAuth keeps its exact logical name',()=>{
  const config=configured({
    planner:remote(),
    local:{command:'node',args:['fixture.mjs'],env:{API_KEY:'${LOCAL_API_KEY}'}},
    header:{transport:'sse',url:'https://sse.fixture.invalid/mcp',auth:'header',headers:{Authorization:'${AUTH_HEADER}'}},
    disabled:{...remote(),enabled:false}
  });
  assert.deepEqual(config.mcpServers.local,{command:'node',args:['fixture.mjs'],env:{API_KEY:'${LOCAL_API_KEY}'},enabled:true});
  assert.equal(hermesMcpServerName('planner',config.mcpServers.planner),'planner');
  assert.equal(hermesMcpServerName('local',config.mcpServers.local),'ziwei_external_local');
  assert.deepEqual(enabledHermesMcpServerNames(config),['planner','ziwei_external_local','ziwei_external_header']);
  assert.deepEqual(Object.keys(nativeHermesMcpServers(config)),['planner','ziwei_external_local','ziwei_external_header','disabled']);
  assert.deepEqual(hermesBotToolsets(config),['web','planner','ziwei_external_local','ziwei_external_header']);
  assert.deepEqual(hermesBotToolsets(config,{management:true}),['web','ziwei_management','planner','ziwei_external_local','ziwei_external_header']);
  for(const name of ['ziwei_management','ziwei_external_sample','ziwei-terminal','BadName','../sample'])assert.throws(()=>hermesMcpServerName(name,remote()));
  for(const name of ['all','browser','terminal','delegation','hermes-cli']) {
    assert.throws(()=>configured({[name]:remote()}),{code:'BOT_MCP_NAME_CONFLICT'});
    assert.throws(()=>hermesMcpServerName(name,remote()),{code:'BOT_MCP_NAME_CONFLICT'});
    assert.equal(hermesMcpServerName(name,{command:'fixture-only'}),'ziwei_external_'+name);
    assert.ok(configured({[name]:{command:'fixture-only'}}).mcpServers[name]);
  }
  assert.throws(()=>normalizeBotConfig({mcpServers:{sample:remote()}}),{code:'BOT_PERMISSION_CONFLICT'});
  const readOnly=normalizeBotConfig({mcpServers:{sample:{...remote(),enabled:false}}});
  assert.deepEqual(enabledHermesMcpServerNames(readOnly),[]);assert.deepEqual(hermesBotToolsets(readOnly,{management:true}),[]);assert.deepEqual(nativeHermesMcpServers(readOnly),{});
});

test('the Bot HOME receives the same enabled MCP toolsets and stable OAuth identities without inheriting host services or copying caches',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-mcp-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source');fs.mkdirSync(source);
  const sourceText='model:\n  provider: openai-codex\n  default: synthetic-no-model\nmcp_servers:\n  host_only:\n    url: https://host.fixture.invalid/mcp\n    auth: oauth\n';
  fs.writeFileSync(path.join(source,'config.yaml'),sourceText);
  const config=configured({viral_library:remote(),legacy:{command:'fixture-command'},disabled:{...remote(),enabled:false}});
  const args={sourceHome:source,privateDirectory:path.join(root,'bots'),workspace:'fixture-workspace',apiBase:'https://ziwei.fixture.invalid',context:{employeeId:'employee_mcp_fixture',workspace:'fixture-workspace',revision:1,sourceProfile:'default',name:'MCP fixture',config}};
  const first=prepareHermesBotHome(args),native=yaml(fs.readFileSync(path.join(first.home,'config.yaml'),'utf8'));
  assert.deepEqual(native.platform_toolsets.cli,hermesBotToolsets(config));
  assert.deepEqual(native.platform_toolsets.cli,['web','viral_library','ziwei_external_legacy']);
  assert.deepEqual(native.mcp_servers,nativeHermesMcpServers(config));assert.equal(native.mcp_servers.host_only,undefined);
  assert.equal(fs.readFileSync(path.join(source,'config.yaml'),'utf8'),sourceText);
  const cache=path.join(first.home,'mcp_tokens');fs.mkdirSync(cache);fs.writeFileSync(path.join(cache,'viral_library.json'),'synthetic-cache-fixture-not-a-token');
  const second=prepareHermesBotHome({...args,context:{...args.context,revision:2}});
  assert.equal(second.home,first.home);assert.equal(fs.readFileSync(path.join(cache,'viral_library.json'),'utf8'),'synthetic-cache-fixture-not-a-token');
  assert.equal(fs.existsSync(path.join(source,'mcp_tokens')),false);
});

test('offline Python checks exact configured toolsets and inspect/call/authorize name resolution without any socket or third-party process',t=>{
  let python;
  for(const command of ['python3','python']) {
    const result=spawnSync(command,['-I','-B','-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true,timeout:5000});
    if(result.status===0){python=result.stdout.trim();break;}
  }
  if(!python){t.skip('Python unavailable for the isolated native bridge fixture');return;}
  const config=configured({oauth_server:remote(),legacy:{command:'fixture-only'},disabled:{...remote(),enabled:false}});
  const result=spawnSync(python,['-I','-B',path.join(import.meta.dirname,'fixtures/hermes-mcp-config.py'),path.resolve(import.meta.dirname,'..'),JSON.stringify(nativeHermesMcpServers(config))],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stderr,/Ran 10 tests/);assert.match(result.stderr,/\bOK\b/);
});

test('the complete bootstrap run preserves relay scope only for mcp.authorize and checks identity before delegation',t=>{
  let python;
  for(const command of ['python3','python']) {
    const result=spawnSync(command,['-I','-B','-c','import sys;print(sys.executable)'],{encoding:'utf8',windowsHide:true,timeout:5000});
    if(result.status===0){python=result.stdout.trim();break;}
  }
  if(!python){t.skip('Python unavailable for the isolated bootstrap fixture');return;}
  const result=spawnSync(python,['-I','-B',path.join(import.meta.dirname,'fixtures/hermes-mcp-bootstrap-oauth.py'),path.resolve(import.meta.dirname,'..')],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stderr,/Ran 5 tests/);assert.match(result.stderr,/\bOK\b/);
});
