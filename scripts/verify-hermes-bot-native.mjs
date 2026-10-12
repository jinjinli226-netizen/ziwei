// Explicit isolated acceptance harness. Real installed Hermes, fake loopback model,
// no personal credentials, no real business/device operations or public networking.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { stringify } from 'yaml';
import { executeRuntime, validateHermesBotRuntime } from '../src/runtime-adapters.mjs';

const root=path.resolve('.local',`native-bot-acceptance-${Date.now()}`);
fs.mkdirSync(root,{recursive:true});
const source=path.join(root,'source'),managed=path.join(root,'managed'),guard=path.join(root,'guard');
for(const dir of [source,managed,guard])fs.mkdirSync(dir);
fs.writeFileSync(path.join(guard,'sitecustomize.py'),`import socket, ipaddress\n_original_connect = socket.socket.connect\ndef local_connect(self, address):\n    if isinstance(address, tuple):\n        host = str(address[0])\n        if host != 'localhost':\n            try: local = ipaddress.ip_address(host).is_loopback\n            except ValueError: local = False\n            if not local: raise RuntimeError('isolated acceptance refuses non-loopback network')\n    return _original_connect(self, address)\nsocket.socket.connect = local_connect\n`);
const requests=[];
const server=http.createServer(async(req,res)=>{
  if(!req.url.startsWith('/v1/chat/completions')){res.writeHead(200,{'content-type':'application/json'});res.end('{}');return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
  const text=JSON.stringify(body.messages);requests.push({model:body.model,hasTools:Boolean(body.tools?.length),containsFirstMarker:text.includes('NATIVE-BOT-AZURE-42'),messageCount:body.messages?.length});
  const answer=requests.length===1?'Recorded NATIVE-BOT-AZURE-42':'Recovered NATIVE-BOT-AZURE-42';
  if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:answer},finish_reason:null}]})+'\n\n');res.end('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
  else {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'test',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25}}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const base=`http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(source,'config.yaml'),stringify({model:{provider:'custom:ziwei-loopback',default:'ziwei-loopback-test',base_url:base+'/v1',api_mode:'chat_completions'},providers:{'ziwei-loopback':{base_url:base+'/v1',api_mode:'chat_completions',key_env:'OPENAI_API_KEY',context_length:131072}},models_dev:{url:base+'/catalog'}}));
  fs.writeFileSync(path.join(source,'.env'),'OPENAI_API_KEY=ziwei-loopback-test-key\n');
  fs.writeFileSync(path.join(managed,'config.yaml'),stringify({auxiliary:{title_generation:{enabled:false},background_review:{enabled:false}},updates:{check:false}}));
  const bot={schemaVersion:1,workspace:'isolated-native',employeeId:'employee_native_acceptance',revision:1,sourceProfile:'default',name:'Isolated native Bot',persona:'Test persona only',model:'ziwei-loopback-test',conversationId:'conv_native_acceptance',config:{maxTurns:2,memory:{enabled:false,userProfile:false}}};
  const directory=path.join(root,'bots');
  const binary=process.env.ZIWEI_TEST_NATIVE_HERMES_BINARY;
  const validation=validateHermesBotRuntime({context:bot,baseHome:source,privateDirectory:directory,workspace:bot.workspace,apiBase:'https://isolated.example.test',...(binary?{binary}:{})});
  assert.equal(validation.result.botValidation.valid,true);
  const results=[];
  for(const prompt of ['Remember the test marker NATIVE-BOT-AZURE-42.','What marker did I give you in our previous turn?']) {
    const result=await executeRuntime({runtime:'Hermes',profile:'default',model:bot.model,prompt,cwd:root,hermesBot:bot,botInstanceDirectory:directory,env:{HERMES_HOME:source,HERMES_MANAGED_DIR:managed,PYTHONPATH:guard,OPENAI_API_KEY:'ziwei-loopback-test-key',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'},managementMcp:{workspace:bot.workspace,apiBase:'https://isolated.example.test'},signal:AbortSignal.timeout(90000)});
    results.push(result);
    fs.writeFileSync(path.join(root,'last-result.json'),JSON.stringify(result,null,2));
    assert.equal(result.status,'succeeded',result.error);
    assert.equal(result.result.botIsolation.enabled,true);
  }
  assert.ok(requests.length>=2);assert.ok(requests.every(item=>!item.hasTools));
  assert.equal(requests.at(-1).containsFirstMarker,true);
  assert.ok(results[0].result.nativeSessionId);assert.equal(results[0].result.nativeSessionId,results[1].result.nativeSessionId);
  const receipt={status:'passed',kind:'real-native-cli-with-fake-loopback-model',externalModelCalls:0,personalCredentialsCopied:false,validation:validation.result.botValidation,requests,sameNativeSession:true,results:results.map(item=>({status:item.status,sessionId:item.result.nativeSessionId,revision:item.result.configurationRevision,output:item.result.output,processExit:item.result.processExit}))};
  fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({receipt:path.join(root,'receipt.json'),...receipt}));
} finally {fs.writeFileSync(path.join(root,'requests.json'),JSON.stringify(requests,null,2));await new Promise(resolve=>server.close(resolve));}
