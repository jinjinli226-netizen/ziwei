// Actual installed Hermes, temporary owned Profiles, loopback model protocol only.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {stringify} from 'yaml';
import {createApp} from '../backend/app.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {hermesProfileReadiness,listHermesProfiles} from '../src/runtime-adapters.mjs';
import {spawnSupervisedRuntime} from '../src/runtime-process.mjs';
import {successfulProfileExit} from '../src/hermes-profile-proof.mjs';

const root=path.resolve('.local',`owned-profile-${Date.now()}`),source=path.join(root,'source'),managed=path.join(root,'managed'),guard=path.join(root,'guard');
for(const directory of [source,managed,guard])fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(guard,'sitecustomize.py'),`import socket,ipaddress
_connect=socket.socket.connect
_resolve=socket.getaddrinfo
def allowed(host):
 if host in ('localhost',None): return True
 try: return ipaddress.ip_address(host).is_loopback
 except ValueError: return False
def connect(self,address):
 if isinstance(address,tuple) and not allowed(address[0]): raise RuntimeError('external network forbidden in fixture')
 return _connect(self,address)
def resolve(host,*args,**kwargs):
 if not allowed(host): raise RuntimeError('external DNS forbidden in fixture')
 return _resolve(host,*args,**kwargs)
socket.socket.connect=connect
socket.getaddrinfo=resolve
`);
Object.assign(process.env,{HERMES_HOME:source,HERMES_MANAGED_DIR:managed,PYTHONPATH:guard,PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',HERMES_ALLOW_PRIVATE_URLS:'true'});
const installed=path.resolve(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const tracked=['hermes_cli/profiles.py','hermes_cli/main.py','hermes_cli/auth.py','hermes_cli/auth_codex.py','hermes_constants.py','hermes_state.py','tools/memory_tool.py'];
const installedSnapshot=()=>Object.fromEntries(tracked.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(installed,file))).digest('hex')]));
const installedBefore=installedSnapshot(),installedStatus=()=>execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:installed,encoding:'utf8',windowsHide:true}),statusBefore=installedStatus();
const installedHead=execFileSync('git',['rev-parse','HEAD'],{cwd:installed,encoding:'utf8',windowsHide:true}).trim();
fs.writeFileSync(path.join(managed,'config.yaml'),stringify({auxiliary:{title_generation:{enabled:false},background_review:{enabled:false}},updates:{check:false}}));
const app=createApp({memory:true,enableScheduler:false}),repo=app.locals.repo,calls=[];
const server=http.createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'){if(req.url==='/catalog'){res.end('{}');return;}return app(req,res);}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks)),wire=JSON.stringify(body.messages);
  const role=body.model==='fixture-a'?'a':'b',ownMemory=wire.includes('OWNED-A-PERSISTED');
  calls.push({role,ownMemory,authorizationCorrect:req.headers.authorization==='Bearer loopback-owned-only'});
  let message={role:'assistant',content:`OWNED-${role.toUpperCase()}-OK memory=${ownMemory}`},finish='stop';
  if(role==='a'&&wire.includes('WRITE-OWNED-MEMORY')&&!ownMemory&&body.tools?.some(tool=>tool.function.name==='memory')){
    message={role:'assistant',content:null,tool_calls:[{id:'owned-memory-call',type:'function',function:{name:'memory',arguments:JSON.stringify({action:'add',target:'memory',content:'OWNED-A-PERSISTED'})}}]};finish='tool_calls';
  }
  if(body.stream){res.setHeader('content-type','text/event-stream');const delta={role:'assistant',...(message.content?{content:message.content}:{}),...(message.tool_calls?{tool_calls:message.tool_calls.map((call,index)=>({...call,index}))}:{})};res.end('data: '+JSON.stringify({id:'owned-fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'owned-fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n');}
  else {res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'owned-fixture',object:'chat.completion',model:body.model,choices:[{index:0,message,finish_reason:finish}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
fs.writeFileSync(path.join(source,'config.yaml'),stringify({model:{provider:'custom:ziwei-owned',default:'fixture-a',base_url:base+'/v1',api_mode:'chat_completions'},providers:{'ziwei-owned':{key_env:'OPENAI_API_KEY',base_url:base+'/v1',api_mode:'chat_completions',context_length:131072}},models_dev:{url:base+'/catalog'},mcp_servers:{'ziwei-terminal':{command:'NEVER-RUN-GLOBAL-PHONE'}}}));
fs.writeFileSync(path.join(source,'.env'),'OPENAI_API_KEY=loopback-owned-only\nZIWEI_TERMINAL_TOKEN=must-not-inherit\n');fs.writeFileSync(path.join(source,'auth.json'),'{}');
const snapshot=()=>Object.fromEntries(['config.yaml','.env','auth.json'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')])),before=snapshot();
const device=repo.claimDevicePairing({code:repo.createDevicePairing('test-111',{name:'isolated-owned-pc'}).code});
repo.heartbeatDevice('test-111',{deviceId:device.deviceId,runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default',provider_configured:true,authentication_configured:true}]}}});
const management=createManagementService(repo),bots=management.bots,results=[];
let executor;
function makeExecutor(){return createLocalActionExecutor({runtimeDir:path.join(root,'runtime'),defaultWorkdir:root,hermesHomePath:source,workspace:'test-111',apiBase:base,deviceId:device.deviceId,deviceToken:device.deviceToken});}
async function execute(action){
  repo.ackA2AAction(action.id,{deviceId:device.deviceId});
  const result=await executor(action,{signal:AbortSignal.timeout(90000)});
  fs.writeFileSync(path.join(root,action.id+'.json'),JSON.stringify(result,null,2));
  assert.equal(result.status,'succeeded',JSON.stringify(result));
  if(result.result.processExit){assert.equal(result.result.processExit.treeConfirmed,true);assert.equal(result.result.processExit.activeProcesses,0);}
  repo.resultA2AAction(action.id,{deviceId:device.deviceId,...result});results.push({id:action.id,type:action.type,result:result.result});return result.result;
}
try{
  const native=spawnSupervisedRuntime({command:path.join(installed,'venv/Scripts/python.exe'),args:[path.resolve('test/fixtures/hermes-owned-profile.py')],cwd:root,env:process.env});
  let nativeOutput='';native.child.on('error',()=>{});for(const stream of [native.child.stdout,native.child.stderr])stream.on('data',data=>{nativeOutput+=String(data);});native.child.stdin.end();
  const timer=setTimeout(()=>void native.stop(),60000);let nativeExit;try{nativeExit=await native.completionEvidence;}finally{clearTimeout(timer);}
  fs.writeFileSync(path.join(root,'native-fixtures.log'),nativeOutput);assert.equal(successfulProfileExit(nativeExit),true,nativeOutput);const nativeTestCount=Number(nativeOutput.match(/Ran (\d+) tests?\b/)?.[1]);assert.ok(nativeTestCount>=9,'Expected at least 9 native owned-profile/auth fixtures; got '+nativeTestCount);assert.match(nativeOutput,/\nOK\s*$/);
  executor=makeExecutor();const created=[];
  for(const role of ['a','b']){
    let bot=bots.create('test-111',{name:'Owned '+role,sourceProfile:'default',targetDeviceId:device.deviceId,model:'fixture-'+role,idempotencyKey:'owned-'+role,config:{maxTurns:4,toolsets:['memory'],permissions:{mode:'execute',management:false}}});
    const provision=await execute(repo.getA2AAction(bot.instance.provisioning.actionId));
    bot=bots.get('test-111',bot.id);assert.equal(bot.instance.home,provision.botProvision.profileHome);
    assert.equal(hermesProfileReadiness(bot.instance.profile,{baseHome:source}).ready,true);
    assert.ok(listHermesProfiles({baseHome:source}).some(item=>item.name===bot.instance.profile));
    await execute(bots.validate('test-111',bot.id,{expectedRevision:1,idempotencyKey:'validate-'+role}).action);
    bot=bots.control('test-111',bot.id,{expectedRevision:1,expectedControlEpoch:1,operation:'activate'});created.push(bot);
  }
  assert.notEqual(created[0].instance.profile,created[1].instance.profile);assert.notEqual(created[0].instance.home,created[1].instance.home);
  for(const [index,prompt] of [[0,'WRITE-OWNED-MEMORY'],[1,'Report your own stored memory only'],[0,'Read your persistent memory after restart']]){
    executor=makeExecutor();const bot=created[index];
    const message=repo.addConversationMessage(bot.main_conversation_id,{content:prompt});
    const result=await execute(repo.getA2AAction(message.execution.id));
    assert.equal(result.botIsolation.home,bot.instance.home);assert.equal(result.botIsolation.profileHome,bot.instance.home);assert.ok(result.nativeSessionId);
  }
  const task=management.createTask('test-111',{title:'Read persistent Bot memory as an ordinary task',employeeId:created[0].id,execute:true,idempotencyKey:'owned-task'});
  const taskResult=await execute(repo.listA2AActions('test-111',{status:'pending'}).find(action=>action.task_id===task.id));
  assert.equal(taskResult.botIsolation.home,created[0].instance.home);assert.equal(taskResult.botIsolation.profileHome,created[0].instance.home);assert.ok(taskResult.nativeSessionId);
  const memory=await execute(bots.native('test-111',created[0].id,{expectedRevision:1,expectedControlEpoch:created[0].control_epoch,idempotencyKey:'native-owned-memory',resource:'memory',operation:'read',input:{}}).action);
  assert.ok(JSON.stringify(memory).includes('OWNED-A-PERSISTED'));
  assert.ok(fs.readFileSync(path.join(created[0].instance.home,'memories/MEMORY.md'),'utf8').includes('OWNED-A-PERSISTED'));
  assert.ok(!fs.existsSync(path.join(created[1].instance.home,'memories/MEMORY.md'))||!fs.readFileSync(path.join(created[1].instance.home,'memories/MEMORY.md'),'utf8').includes('OWNED-A-PERSISTED'));
  assert.ok(calls.filter(call=>call.role==='a').at(-1).ownMemory);assert.ok(calls.filter(call=>call.role==='b').every(call=>!call.ownMemory));assert.ok(calls.every(call=>call.authorizationCorrect));
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(installedSnapshot(),installedBefore);assert.equal(installedStatus(),statusBefore);
  const receipt={date:new Date().toISOString(),installedHead,installedSourceHashes:installedBefore,installedTrackedStatusUnchanged:true,nativeFixtures:{tests:6,processExit:nativeExit},bots:created.map(bot=>({employeeId:bot.id,mainConversationId:bot.main_conversation_id,instance:bot.instance})),taskId:task.id,calls,results,sourceHashesUnchanged:true,network:'Loopback model protocol only; external connect and DNS blocked; no real phone or external account',root};
  fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log('RECEIPT '+path.join(root,'receipt.json'));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repo.db.close();}
