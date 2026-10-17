import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMcpServer,mcpServerForm,viralMcpPreset} from './bot-native-data.js';
import {normalizeBotConfig} from '../../src/hermes-bot-config.mjs';

const remote={transport:'http',url:'https://mcp.example.invalid/mcp',auth:'oauth',headersText:'X-Workspace=LOCAL_WORKSPACE',envText:'',oauthCimd:false,oauthScope:'library:read library:collect'};
const normalize=server=>normalizeBotConfig({permissions:{mode:'execute'},mcpServers:{test:server}}).mcpServers.test;

test('viral library preset builds valid OAuth config without credentials or runtime defaults',()=>{
  const form=viralMcpPreset(),server=buildMcpServer(form);
  assert.equal(form.name,'viral_library');assert.equal(server.url,'https://viral.qzelynth.top/mcp');assert.equal(server.transport,'http');assert.equal(server.auth,'oauth');
  assert.deepEqual(server.oauth,{cimd:false,scope:'library:read library:collect'});assert.equal(server.enabled,true);assert.deepEqual(server.headers,{});assert.deepEqual(normalize(server).oauth,server.oauth);
  assert.equal('supportsParallelToolCalls' in server,false);assert.equal('resources' in server.tools,false);assert.equal('prompts' in server.tools,false);
});

test('OAuth edit preserves public client settings and drops stale headers and unknown OAuth state',()=>{
  const oauth={cimd:true,scope:'old',client_id:'client-id',client_name:'Ziwei',client_metadata_url:'https://mcp.example.invalid/client.json',redirect_uri:'http://127.0.0.1:4567/callback',redirect_host:'127.0.0.1',redirect_port:4567,flow:'browser',timeout:60,user_agent:'Ziwei',application_type:'native',token_endpoint_auth_method:'none',access_token:'not-public'};
  const existing={auth:'header',headers:{Authorization:'${OLD_AUTH}',Ignored:'${IGNORED}'},oauth};
  const server=buildMcpServer(remote,existing);
  assert.deepEqual(server.headers,{'X-Workspace':'${LOCAL_WORKSPACE}'});assert.equal(server.oauth.cimd,false);assert.equal(server.oauth.scope,remote.oauthScope);assert.equal(server.oauth.client_id,'client-id');assert.equal('access_token' in server.oauth,false);
  for(const field of Object.keys(oauth).filter(key=>!['cimd','scope','access_token'].includes(key)))assert.equal(server.oauth[field],oauth[field]);
  assert.equal(oauth.cimd,true);assert.equal(oauth.scope,'old');assert.deepEqual(normalize(server).oauth,server.oauth);
});

test('OAuth rejects Authorization from the submitted headers regardless of case',()=>{
  for(const name of ['Authorization','authorization','AUTHORIZATION'])assert.throws(()=>buildMcpServer({...remote,headersText:name+'=LOCAL_AUTH'}),/OAuth.*Authorization/);
  assert.equal(buildMcpServer({...remote,auth:'header',headersText:'Authorization=LOCAL_AUTH'}).headers.Authorization,'${LOCAL_AUTH}');
});

test('clearing OAuth scope removes its old value while invalid scope and CIMD are rejected',()=>{
  assert.equal('scope' in buildMcpServer({...remote,oauthScope:'  '},{oauth:{scope:'old',client_name:'Ziwei'}}).oauth,false);
  for(const scope of ['a'.repeat(4001),'bad\nline','bad\tline','bad\u007f',null,1])assert.throws(()=>buildMcpServer({...remote,oauthScope:scope}),/scope/);
  for(const cimd of ['false',0,null])assert.throws(()=>buildMcpServer({...remote,oauthCimd:cimd}),/CIMD/);
  assert.equal(buildMcpServer({...remote,oauthScope:'a'.repeat(4000)}).oauth.scope.length,4000);
});

test('header and stdio transitions remove OAuth; stdio also removes remote authentication',()=>{
  const existing={url:remote.url,transport:'sse',auth:'oauth',oauth:{scope:'old',cimd:false},headers:{Authorization:'${OLD_AUTH}'}};
  const header=buildMcpServer({...remote,auth:'header',headersText:'Authorization=NEW_AUTH'},existing);
  assert.equal(header.auth,'header');assert.equal('oauth' in header,false);assert.equal(header.headers.Authorization,'${NEW_AUTH}');
  const local=buildMcpServer({transport:'stdio',command:'node',argsText:'mcp.mjs'},existing);
  for(const field of ['url','transport','headers','auth','oauth'])assert.equal(field in local,false);
  assert.equal(local.command,'node');assert.deepEqual(local.args,['mcp.mjs']);
});

test('explicit parallel/resources/prompts choices coexist with existing include/exclude filters',()=>{
  const existing={supportsParallelToolCalls:true,tools:{include:['lookup'],exclude:['write'],resources:true,prompts:true}};
  const server=buildMcpServer({...remote,supportsParallelToolCalls:false,resources:false,prompts:false,includeText:'search_*, lookup',excludeText:'delete_*'},existing);
  assert.equal(server.supportsParallelToolCalls,false);assert.deepEqual(server.tools,{include:['search_*','lookup'],exclude:['delete_*'],resources:false,prompts:false});assert.deepEqual(normalize(server).tools,server.tools);
  assert.equal(existing.supportsParallelToolCalls,true);assert.equal(existing.tools.resources,true);
});

test('undefined new flags retain existing values without inventing defaults',()=>{
  const untouched=buildMcpServer(remote);assert.equal('supportsParallelToolCalls' in untouched,false);assert.equal('tools' in untouched,false);
  const existing={supportsParallelToolCalls:true,tools:{include:['lookup'],resources:false,prompts:true},oauth:{cimd:false,scope:'keep'}};
  const server=buildMcpServer({...remote,oauthCimd:undefined,oauthScope:undefined},existing);
  assert.equal(server.supportsParallelToolCalls,true);assert.deepEqual(server.tools,existing.tools);assert.deepEqual(server.oauth,existing.oauth);
  for(const field of ['supportsParallelToolCalls','resources','prompts'])for(const bad of ['false',0,null])assert.throws(()=>buildMcpServer({...remote,[field]:bad}),/布尔/);
});

test('the shared editing form round trips both transports and retains reference names and options',()=>{
  const server={transport:'sse',url:remote.url,auth:'oauth',oauth:{cimd:false,scope:'lookup',client_id:'public-id'},headers:{'X-Workspace':'${LOCAL_WORKSPACE}'},env:{API_KEY:'${LOCAL_API_KEY}'},enabled:false,timeout:60,connectTimeout:30,supportsParallelToolCalls:false,tools:{include:['read_*'],exclude:['write_*'],resources:false,prompts:true}};
  const form=mcpServerForm('library',server);assert.equal(form.name,'library');assert.equal(form.headersText,'X-Workspace=LOCAL_WORKSPACE');assert.equal(form.envText,'API_KEY=LOCAL_API_KEY');assert.equal(form.resources,false);
  assert.deepEqual(buildMcpServer(form,server),server);
  const local={command:'node',args:['worker.mjs','--local'],env:{},enabled:true};const localForm=mcpServerForm('local',local);
  assert.equal(localForm.transport,'stdio');assert.equal(localForm.supportsParallelToolCalls,undefined);assert.equal(localForm.resources,undefined);assert.equal(localForm.prompts,undefined);
  const rebuilt=buildMcpServer(localForm,local);assert.equal(rebuilt.command,local.command);assert.deepEqual(rebuilt.args,local.args);assert.equal('auth' in rebuilt,false);assert.equal('oauth' in rebuilt,false);
  assert.throws(()=>buildMcpServer({...remote,transport:'unknown'}),/传输/);assert.throws(()=>buildMcpServer({...remote,auth:'password'}),/认证/);
});
