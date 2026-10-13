// Explicit isolated acceptance. Real installed Hermes and Windows Jobs; all HTTP is loopback.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {stringify} from 'yaml';
import {executeRuntime} from '../src/runtime-adapters.mjs';
import {executeBotGroup} from '../src/hermes-group-runtime.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {spawnSupervisedRuntime} from '../src/runtime-process.mjs';

const root=path.resolve('.local',`native-followup-${Date.now()}`),source=path.join(root,'source'),guard=path.join(root,'guard'),managed=path.join(root,'managed');
for(const directory of [source,guard,managed])fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(guard,'sitecustomize.py'),`import socket,ipaddress\n_orig=socket.socket.connect\ndef local_connect(self,address):\n if isinstance(address,tuple):\n  host=str(address[0])\n  try: allowed=host=='localhost' or ipaddress.ip_address(host).is_loopback\n  except ValueError: allowed=False\n  if not allowed: raise RuntimeError('external network blocked in acceptance')\n return _orig(self,address)\nsocket.socket.connect=local_connect\n`);
const requests=[],children=new Map(),counts=new Map();let scenario,base,resolveSecond;
const server=http.createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
    if(req.url==='/v1/chat/completions'){
      const role=body.model.includes('peer')?'peer':'source',key=`${scenario}:${role}`,count=(counts.get(key)||0)+1;counts.set(key,count);requests.push({scenario,kind:'model',role,count});
      if(scenario==='stop'&&role==='source'&&count===2){resolveSecond();return;}
      const text=role==='peer'?'@employee_native_source Please confirm the local result.':count===1?'@employee_peer Please review the local result.':'NATIVE-SOURCE-SECOND-CONFIRMED';
      if(body.stream){res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
      else {res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}return;
    }
    if(req.url.endsWith('/bot-collaboration')&&req.method==='POST'){
      assert.deepEqual(body.targetEmployeeIds,['employee_peer']);const id=body.nativeTask.identity.task_id;requests.push({scenario,kind:'peer-admission',id});
      const child={id,status:'pending'};children.set(id,child);
      child.done=runTurn(bot('peer'),body.content).then(result=>{Object.assign(child,result);return result;});
      res.setHeader('content-type','application/json');res.end(JSON.stringify({actions:[{id,status:'pending'}]}));return;
    }
    if(req.url.includes('/bot-collaboration/')&&req.method==='GET'){
      const child=children.get(req.url.split('?')[0].split('/').at(-1));res.setHeader('content-type','application/json');res.end(JSON.stringify({id:child.id,status:child.status,result:child.result,error:child.error}));return;
    }
    if(req.url.endsWith('/bot-settle')){requests.push({scenario,kind:'settlement',allowEvaluation:scenario!=='pause'});res.setHeader('content-type','application/json');res.end(JSON.stringify({allowed:true,allowEvaluation:scenario!=='pause'}));return;}
    res.setHeader('content-type','application/json');res.end('{}');
  }catch(error){res.statusCode=500;res.end(JSON.stringify({code:'FIXTURE_FAILURE'}));requests.push({scenario,kind:'fixture-error',error:String(error)});}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
const provider='custom:ziwei-followup';
fs.writeFileSync(path.join(source,'config.yaml'),stringify({model:{provider,default:'fixture',base_url:base+'/v1',api_mode:'chat_completions'},providers:{'ziwei-followup':{key_env:'OPENAI_API_KEY',base_url:base+'/v1',api_mode:'chat_completions',context_length:131072}},models_dev:{url:base+'/catalog'}}));
fs.writeFileSync(path.join(source,'.env'),'OPENAI_API_KEY=loopback-only\n');fs.writeFileSync(path.join(source,'auth.json'),'{}');
fs.writeFileSync(path.join(managed,'config.yaml'),stringify({auxiliary:{title_generation:{enabled:false},background_review:{enabled:false}},updates:{check:false}}));
const env={PYTHONPATH:guard,HERMES_MANAGED_DIR:managed,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',HERMES_ALLOW_PRIVATE_URLS:'true'};
function bot(role){return{employeeId:role==='source'?'employee_native_source':'employee_peer',workspace:'isolated-followup',revision:1,controlEpoch:1,sourceProfile:'default',model:`fixture-${role}`,conversationId:`conv_${scenario}_${role}`,name:role,config:{maxTurns:2,permissions:{mode:'read_only',management:false},mcpServers:{},drivers:{maxTotalTurns:scenario==='budget'?1:3}}};}
async function runTurn(context,prompt,supervision={}){
  const result=await executeRuntime({runtime:'Hermes',profile:'default',model:context.model,prompt,cwd:root,hermesBot:context,botInstanceDirectory:path.join(root,'bots'),env:{...env,HERMES_HOME:source},managementMcp:{workspace:context.workspace,apiBase:base,request:{enabled:false},config:{enabled:false}},signal:AbortSignal.timeout(90000),...supervision});
  fs.appendFileSync(path.join(root,'turns.jsonl'),JSON.stringify({scenario,employeeId:context.employeeId,result})+'\n');return result;
}
const receipts=[];
try {
  for(scenario of process.argv.includes('--adapters-only')?[]:['success','budget','pause','stop']){
    const parent={id:`parent-${scenario}`,type:'hermes.bot.native',idempotencyKey:`followup-${scenario}`,payload:{workdir:root}},context=bot('source');
    const options={context,baseHome:source,privateDirectory:path.join(root,'bots'),workspace:context.workspace,apiBase:base,env,cwd:root,operation:{resource:'collaboration',operation:'message',requestId:`source-${scenario}`,input:{targets:[{id:'employee_peer',name:'peer'}],content:'@employee_native_source Please start this discussion.',mode:'group',groupId:`room_${scenario}`}}};
    let registrations=0,authorized=0;
    const dispatcher=new ActionDispatcher({workdir:root,stopGraceMs:20000,execute:(action,execution)=>executeBotGroup(action,{...options,onSupervision:value=>{registrations++;execution.onSupervision(value);}},{deviceToken:'loopback-only',authorize:async()=>{authorized++;},signal:execution.signal,runSource:(plan,supervision)=>runTurn(context,plan.payload.prompt,supervision)})});
    const second=new Promise(resolve=>{resolveSecond=resolve;}),pending=dispatcher.dispatch(parent);
    if(scenario==='stop'){
      let timer;try{await Promise.race([second,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('second source never started')),90000);})]);}finally{clearTimeout(timer);}
      assert.equal(dispatcher.cancel(parent.id),true);
    }
    const result=await pending;assert.equal(registrations,1);assert.equal(result.result.processExit.treeConfirmed,true);assert.equal(result.result.processExit.activeProcesses,0);
    if(scenario==='success'){assert.equal(result.status,'succeeded',result.error);assert.deepEqual(result.result.nativeGroup.runs.map(run=>run.employeeId),['employee_native_source','employee_peer','employee_native_source']);assert.equal(counts.get('success:source'),2);assert.equal(counts.get('success:peer'),1);}
    else if(scenario==='stop'){assert.equal(result.code,'cancelled',result.error);assert.equal(counts.get('stop:source'),2);const replay=await dispatcher.dispatch(parent);assert.equal(replay.code,'cancelled');assert.equal(counts.get('stop:source'),2);}
    else {assert.equal(result.status,'succeeded',result.error);assert.equal(result.result.nativeGroup.runs.length,1);assert.equal(counts.get(`${scenario}:source`),1);assert.equal(counts.get(`${scenario}:peer`),undefined);assert.equal(result.result.nativeGroup.bounded,true);}
    fs.writeFileSync(path.join(root,`${scenario}.json`),JSON.stringify(result,null,2));receipts.push({scenario,status:result.status,code:result.code||null,registrations,authorized,sourceTurns:counts.get(`${scenario}:source`),peerTurns:counts.get(`${scenario}:peer`)||0,treeConfirmed:result.result.processExit.treeConfirmed});console.log(JSON.stringify(receipts.at(-1)));
  }
  const native=spawnSupervisedRuntime({command:'C:/Users/25941/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe',args:[path.resolve('test/fixtures/hermes-native-followup.py')],cwd:root,env:{...process.env,...env}});native.child.on('error',()=>{});native.child.stdout.on('data',data=>fs.appendFileSync(path.join(root,'adapter-tests.log'),data));native.child.stderr.on('data',data=>fs.appendFileSync(path.join(root,'adapter-tests.log'),data));native.child.stdin.end();
  const processExit=await native.completionEvidence;assert.equal(processExit.rootExitCode,0);assert.equal(processExit.treeConfirmed,true);
  const cases=Number(fs.readFileSync(path.join(root,'adapter-tests.log'),'utf8').match(/Ran (\d+) tests/)?.[1]);assert.ok(cases>=7);
  fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify({nativeVersion:'0.21.3',group:receipts,adapterRegression:{cases,processExit},sourceEnvUnchanged:fs.readFileSync(path.join(source,'.env'),'utf8')==='OPENAI_API_KEY=loopback-only\n'},null,2));console.log('RECEIPT '+path.join(root,'receipt.json'));
}finally{for(const child of children.values())await child.done;fs.writeFileSync(path.join(root,'requests.json'),JSON.stringify(requests,null,2));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
