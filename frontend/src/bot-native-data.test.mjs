import test from 'node:test';import assert from 'node:assert/strict';
const mod=await import('./bot-native-data.js').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const action=data=>({status:'succeeded',result:{nativeOperation:{status:'succeeded',nativeVersion:'0.21.3',data}}});
test('memory staged and unverified skill installation are not presented as committed changes',()=>{
  assert.equal(mod.nativeActionPresentation(action({staged:true,pending_id:'x'})).tone,'warning');
  assert.match(mod.nativeActionPresentation(action({installed:true,verified:false})).label,/待核实/);
  assert.doesNotMatch(mod.nativeActionPresentation(action({installed:true})).label,/安装成功/);
});
test('native dependency and authorization differ from a missing API or fixture execution',()=>{
  const blocked=action({reason:'SDK missing'});blocked.result.nativeOperation.status='requires_dependency';assert.match(mod.nativeActionPresentation(blocked).label,/依赖/);
  const fixture=action({});fixture.result.fixture=true;assert.match(mod.nativeActionPresentation(fixture).source,/合成/);
  assert.match(mod.nativeActionPresentation(action({})).source,/来源.*未说明/);
});
test('MCP environment and HTTP header editing accepts only names referring to local variables',()=>{
  const server=mod.buildMcpServer({transport:'http',url:'https://mcp.example.invalid/api',headersText:'Authorization=MY_AUTH_HEADER',envText:'API_KEY=LOCAL_API_KEY',includeText:'read_*',excludeText:'write_*'});
  assert.equal(server.headers.Authorization,'${MY_AUTH_HEADER}');assert.equal(server.env.API_KEY,'${LOCAL_API_KEY}');assert.deepEqual(server.tools,{include:['read_*'],exclude:['write_*']});
  assert.throws(()=>mod.buildMcpServer({transport:'http',url:'https://mcp.example.invalid/api',headersText:'Authorization=Bearer demo'}),/变量名/);
  assert.throws(()=>mod.buildMcpServer({transport:'http',url:'https://user:secret@mcp.example.invalid/api'}),/凭据/);
});
test('MCP edits preserve timeouts and filters already present while keeping HTTP and stdio fields separate',()=>{
  const server=mod.buildMcpServer({transport:'stdio',command:'node',argsText:'worker.mjs',envText:''},{timeout:60,connectTimeout:20,tools:{include:['lookup']},url:'https://old.invalid/api',transport:'http'});
  assert.equal(server.command,'node');assert.deepEqual(server.args,['worker.mjs']);assert.equal(server.timeout,60);assert.deepEqual(server.tools.include,['lookup']);assert.equal('url' in server,false);
});
test('audio input validates MIME and byte limit before conversion without accepting a renamed image',async()=>{
  const valid={type:'audio/wav',size:48,arrayBuffer:async()=>new Uint8Array([82,73,70,70,0,0,0,0,87,65,86,69,...new Uint8Array(36)]).buffer};
  const value=await mod.audioInput(valid);assert.equal(value.mimeType,'audio/wav');assert.ok(value.audioBase64);
  await assert.rejects(mod.audioInput({...valid,size:6*1024*1024}),/大小/);
  await assert.rejects(mod.audioInput({...valid,type:'image/png'}),/音频/);
});

test('MCP tool schemas retain the registered calling ID and native parameter definitions',()=>{
  assert.deepEqual(mod.nativeMcpTools({tools:[{name:'mcp_lookup',schema:{type:'function',function:{name:'lookup',description:'Search notes',parameters:{type:'object',required:['query']}}}}]}),[{name:'mcp_lookup',description:'Search notes',parameters:{type:'object',required:['query']}}]);
});
test('Gateway status distinguishes configuration, a running process and a connected channel',()=>{
  const value=mod.gatewayStages({configuredPlatforms:['telegram'],runtime:{status:'connected',platform:'telegram',pid:123,sourceActionId:'original'}},{stt:{enabled:true,configured:false},tts:{enabled:true,configured:true}});
  assert.match(value.process,/123/);assert.match(value.connection,/telegram.*connected/);assert.match(value.media,/STT.*缺少.*TTS.*已配置/);
  assert.doesNotMatch(mod.gatewayStages({configuredPlatforms:['telegram'],configuredIsConnected:false}).connection,/已连接/);
});
test('Gateway reports the latest disconnected, failed or unconfirmed platform independently of its live PID',()=>{
  for(const status of ['failed','disconnected','unconfirmed']){
    const value=mod.gatewayStages({runtime:[{platform:'telegram',status,pid:123,lastHeartbeat:Math.floor(Date.now()/1000),fatalCode:'fixture-token-revoked'},{platform:'slack',status:'connected',pid:456,lastHeartbeat:Math.floor(Date.now()/1000)}]});
    assert.equal(value.connection,`telegram · ${status}（原生最近报告）、slack · connected（原生最近报告）`);
    assert.match(value.process,new RegExp('原生报告 '+status+' · PID 123'));
  }
});
test('Gateway advanced credentials require environment references recursively',()=>{
  assert.deepEqual(mod.gatewayExtra({nested:{token:'${LOCAL_TOKEN}'},timeout:10}),{nested:{token:'${LOCAL_TOKEN}'},timeout:10});
  assert.throws(()=>mod.gatewayExtra({nested:{api_key:'demo-value'}}),/环境变量引用/);
  assert.throws(()=>mod.safeProviderUrl('https://user:demo@provider.invalid/api'),/凭据/);
});
test('native skill catalog includes disabled names and verified installation provenance',()=>{
  const value=mod.nativeSkillCatalog({items:[{name:'notes',enabled:true}],disabled:['paused'],installed:{notes:{source:'hub',hash:'verified-hash'}}});
  assert.equal(value.find(row=>row.name==='paused').enabled,false);assert.equal(value.find(row=>row.name==='notes').hash,'verified-hash');
});
test('native Routine drivers preserve a finite typed operation instead of creating another scheduler',()=>{
  assert.deepEqual(mod.nativeRoutineDriver('heartbeat'),{resource:'heartbeat',operation:'step',input:{}});
  assert.deepEqual(mod.nativeRoutineDriver('kanban','task-1'),{resource:'kanban',operation:'dispatch',input:{taskId:'task-1'}});
  assert.throws(()=>mod.nativeRoutineDriver('kanban'),/标识/);assert.throws(()=>mod.nativeRoutineDriver('unknown'),/支持/);
  assert.equal(mod.routineDriver({native_driver_json:'{"resource":"goals","operation":"step","input":{}}'}).resource,'goals');
});
