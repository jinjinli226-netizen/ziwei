import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {bindCodexConversationToHost,prepareCodexConversationSession,CODEX_CONVERSATION_PENDING_TTL_MS} from '../src/codex-conversation-session.mjs';
import {runtimeInvocation,executeRuntime,resetRuntimeDiscovery,discoverInstalledRuntimes} from '../src/runtime-adapters.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {ActionDispatcher} from '../src/daemon.mjs';
import {consumeRuntimePrelaunchEvidence} from '../src/runtime-launch-evidence.mjs';

const rootExit={launched:true,rootPid:1234,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false,failureCode:null,signal:null};
function fixture(t){
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-codex-thread-'))),home=path.join(root,'codex'),cwd=path.join(root,'work'),runtimeDir=path.join(root,'runtime');
 for(const p of[home,cwd,runtimeDir])fs.mkdirSync(p,{mode:0o700});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const action=(changes={})=>({id:'action_'+randomUUID(),type:'conversation.execute',payload:{employeeId:'employee_alpha',conversationId:'conv_alpha',runtime:'Codex',workdir:cwd,...changes}});
 const host=(a=action(),changes={})=>bindCodexConversationToHost({action:a,workspace:'bigtron',deviceId:'device_alpha',apiBase:'https://example.test',runtimeDir,daemonBound:true,...changes});
 const start=(a=action(),changes={})=>prepareCodexConversationSession({binding:host(a),invocation:runtimeInvocation('Codex',{prompt:'new user prompt',model:'gpt-6.1-sol'}),codexHome:home,cwd,...changes});
 const rollout=(id,{at=Date.now(),directory=cwd}={})=>{const date=new Date(at),dir=path.join(home,'sessions',String(date.getUTCFullYear()),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0'));fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'rollout-fixture-'+id+'.jsonl');fs.writeFileSync(file,JSON.stringify({timestamp:new Date(at).toISOString(),type:'session_meta',payload:{id,cwd:directory,timestamp:new Date(at).toISOString()}})+'\n');return file;};
 const event=(s,id=randomUUID())=>{rollout(id);s.observeStdout(JSON.stringify({type:'thread.started',thread_id:id})+'\n');return id;};
 const record=()=>{const directory=path.join(runtimeDir,'codex-conversation-sessions'),name=fs.readdirSync(directory).find(n=>n.endsWith('.json'));return path.join(directory,name);};
 return{root,home,cwd,runtimeDir,action,host,start,rollout,event,record};
}
function finish(s,exit=rootExit){s.markSpawned();const receipt=s.complete({processExit:exit,code:exit.rootExitCode});s.close();return receipt;}

test('first conversation persists official thread and exactly resumes only new prompt with all flags',t=>{
 const f=fixture(t),a=f.action(),s=f.start(a,{invocation:{args:['exec','--profile','office','--json','--ephemeral','--skip-git-repo-check','--dangerously-bypass-approvals-and-sandbox','--model','gpt-6.1-sol','--image','photo.png','--config','mcp_servers.fixture.enabled=true','-'],stdin:'first',format:'json-lines'},profile:'office'});
 assert.equal(s.invocation.args.includes('--ephemeral'),false);const id=f.event(s);assert.equal(finish(s).threadId,id);
 const next=f.start(f.action(),{profile:'office',invocation:{args:['exec','--profile','office','--json','--ephemeral','--skip-git-repo-check','--config','mcp_servers.fixture.enabled=true','--image','photo2.png','-'],stdin:'ONLY_NEW_PROMPT',format:'json-lines'}});
 assert.deepEqual(next.invocation.args,['exec','--profile','office','resume','--json','--skip-git-repo-check','--config','mcp_servers.fixture.enabled=true','--image','photo2.png',id,'-']);assert.equal(next.invocation.stdin,'ONLY_NEW_PROMPT');assert.equal(next.invocation.args.includes('--last'),false);next.close();
 if(process.platform!=='win32')assert.equal(fs.statSync(f.record()).mode&0o777,0o600);
});

test('provider failure retains exact thread when its root has exited and native metadata matches',t=>{
 const f=fixture(t),s=f.start(),id=f.event(s);const r=finish(s,{...rootExit,rootExitCode:125});assert.equal(r.durable,true);const next=f.start();assert.equal(next.invocation.args.at(-2),id);next.close();
});

test('parallel employees and conversations share HOME without borrowing each other thread',t=>{
 const f=fixture(t),s=f.start(),b=f.start(f.action({employeeId:'employee_beta'})),c=f.start(f.action({conversationId:'conv_beta'}));const ids=[f.event(s),f.event(b),f.event(c)];assert.equal(new Set(ids).size,3);for(const x of[s,b,c])finish(x);
 const next=f.start();assert.equal(next.invocation.args.at(-2),ids[0]);next.close();
});

test('same conversation reservation refuses concurrent launch then releases even before spawn',t=>{
 const f=fixture(t),s=f.start();assert.throws(()=>f.start(),{code:'CODEX_CONVERSATION_BUSY'});s.close();const next=f.start();assert.equal(next.invocation.args.includes('resume'),false);next.close();assert.equal(fs.readdirSync(path.join(f.runtimeDir,'codex-conversation-sessions')).length,0);
});

test('an abandoned old pending map is archived as unknown and no longer blocks a fresh turn',t=>{
 const f=fixture(t),s=f.start(),file=f.record(),saved=JSON.parse(fs.readFileSync(file,'utf8'));s.close();
 saved.state='pending';saved.startedAt=Date.now()-CODEX_CONVERSATION_PENDING_TTL_MS-2;saved.updatedAt=Date.now()-CODEX_CONVERSATION_PENDING_TTL_MS-1;
 fs.writeFileSync(file,JSON.stringify(saved)+'\n',{mode:0o600});
 const next=f.start();assert.equal(next.invocation.args.includes('resume'),false);next.close();
 const names=fs.readdirSync(path.dirname(file));assert.ok(names.some(name=>name.startsWith(path.basename(file,'.json')+'.archived-')));
});

test('malformed map refuses only that scope and leaves evidence unchanged',t=>{
 const f=fixture(t),s=f.start();f.event(s);finish(s);const file=f.record();fs.writeFileSync(file,'{invalid');assert.throws(()=>f.start(),{code:'CODEX_CONVERSATION_STATE_INVALID'});assert.equal(fs.readFileSync(file,'utf8'),'{invalid');const other=f.start(f.action({employeeId:'employee_other'}));other.close();
});

test('native rollout missing, mismatched cwd and changed HOME/profile never silently start fresh',t=>{
 for(const variation of['missing','cwd','home','profile']){const f=fixture(t),s=f.start(),id=f.event(s);finish(s);if(variation==='missing')fs.unlinkSync(f.rollout(id));if(variation==='cwd'){const other=path.join(f.root,'other');fs.mkdirSync(other);f.rollout(id,{directory:other});}
 const changes={};if(variation==='home'){changes.codexHome=path.join(f.root,'other-home');fs.mkdirSync(changes.codexHome);}if(variation==='profile')changes.profile='other';assert.throws(()=>f.start(f.action(),changes),{code:['home','profile'].includes(variation)?'CODEX_CONVERSATION_SCOPE_CHANGED':'CODEX_CONVERSATION_NATIVE_SESSION_MISSING'});}
});

test('quoted thread.started, malformed ID and changed native thread cannot become trusted bindings',t=>{
 for(const kind of['quoted','invalid','different']){const f=fixture(t),s=f.start();s.markSpawned();if(kind==='quoted')s.observeStdout(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({type:'thread.started',thread_id:randomUUID()})}})+'\n');if(kind==='invalid')s.observeStdout(JSON.stringify({type:'thread.started',thread_id:'not-uuid'})+'\n');if(kind==='different'){f.event(s);f.event(s);}assert.throws(()=>s.complete({processExit:rootExit,code:0}),{code:{quoted:'CODEX_CONVERSATION_THREAD_UNCONFIRMED',invalid:'CODEX_CONVERSATION_THREAD_INVALID',different:'CODEX_CONVERSATION_THREAD_MISMATCH'}[kind]});s.close();assert.throws(()=>f.start(),{code:'CODEX_CONVERSATION_PREVIOUS_UNCONFIRMED'});}
});

test('old timestamp and wrong official session_meta ID fail without choosing a recent unrelated session',t=>{
 for(const kind of['old','wrong']){const f=fixture(t),s=f.start(),id=randomUUID();s.markSpawned();const file=f.rollout(id,{at:kind==='old'?Date.now()-3600000:Date.now()});if(kind==='wrong'){const v=JSON.parse(fs.readFileSync(file,'utf8'));v.payload.id=randomUUID();fs.writeFileSync(file,JSON.stringify(v)+'\n');}f.rollout(randomUUID());s.observeStdout(JSON.stringify({type:'thread.started',thread_id:id})+'\n');assert.throws(()=>s.complete({processExit:rootExit,code:0}),{code:kind==='old'?'CODEX_CONVERSATION_THREAD_MISMATCH':'CODEX_CONVERSATION_NATIVE_SESSION_MISSING'});s.close();}
});

function saveHistory(f,record,exit=rootExit,modify=()=>{}){
 const identity={workspace:'bigtron',deviceId:'device_alpha',targetDeviceId:'device_alpha'},key='conversation:conv_alpha:convmsg_fixture';
 const start={key,actionId:record.actionId,identity,startedAt:record.startedAt-1,nativeRuntime:true,resourceBinding:{type:'conversation.execute',employeeId:'employee_alpha',revision:null,controlEpoch:null,resource:null,operation:null,platform:null}};
 const end={key,identity:{...identity},result:{actionId:record.actionId,status:'failed',completedAt:Date.now()+5,result:{processExit:exit}}};const state={version:2,started:[start],completed:[end]};modify(state);fs.writeFileSync(path.join(f.runtimeDir,'action-state.json'),JSON.stringify(state),{mode:0o600});
}

function legacyTransportRejection(f,modify=()=>{}){
 const action=f.action(),s=f.start(action);s.markSpawned();assert.throws(()=>s.complete({processExit:{...rootExit,rootExitCode:1},code:1}),{code:'CODEX_CONVERSATION_THREAD_UNCONFIRMED'});s.close();
 const record=JSON.parse(fs.readFileSync(f.record(),'utf8'));
 saveHistory(f,record,{...rootExit,rootExitCode:1,hostExitCode:0,backgroundProcessesRetained:false},state=>{
  const result=state.completed[0].result;result.code='CODEX_CONVERSATION_THREAD_UNCONFIRMED';result.error='Codex 原生会话或退出回执无法核对，未关联其他会话、未重跑旧任务';
  Object.assign(result.result,{runtime:'Codex',code:1,signal:null,truncated:false,output:'Error loading config.toml: invalid transport\nin `mcp_servers.ziwei-terminal`\n',diagnostics:null,
   codexConversation:{status:'unconfirmed',durable:false,reasonCode:'CODEX_CONVERSATION_THREAD_UNCONFIRMED'},
   managementMcp:{configured:true,injected:true,loaded:false,status:'not_loaded',runtime:'Codex',transport:'stdio',workspace:'bigtron',runtimeProfile:'default',toolCalls:[],tool_calls:[]}});
  modify(state);
 });return{action,record};
}
function currentMessage(f,prompt='ONLY THE NEW AUTHENTICATED MESSAGE'){
 const messageId='convmsg_'+randomUUID();return f.action({messageId,codexConversationInput:{schemaVersion:1,messageId,currentPrompt:prompt}});
}

test('exact legacy pre-model transport rejection permits only a new canonical message and preserves failed history',t=>{
 const f=fixture(t),legacy=legacyTransportRejection(f),historyFile=path.join(f.runtimeDir,'action-state.json'),history=fs.readFileSync(historyFile),oldMap=fs.readFileSync(f.record());
 const next=f.start(currentMessage(f),{invocation:{args:['exec','--json','--ephemeral','-'],stdin:'OLD FAILED PROMPT MUST NEVER BE REPLAYED'}});
 assert.equal(next.invocation.args.includes('resume'),false);assert.equal(next.invocation.stdin,'ONLY THE NEW AUTHENTICATED MESSAGE');
 assert.notEqual(JSON.parse(fs.readFileSync(f.record(),'utf8')).actionId,legacy.action.id);assert.deepEqual(fs.readFileSync(historyFile),history);
 next.close();assert.deepEqual(fs.readFileSync(f.record()),oldMap,'a failure before the new model starts restores the original empty mapping');
 const retry=f.start(currentMessage(f,'FRESH MODEL REQUEST'));const id=f.event(retry);const receipt=finish(retry);assert.equal(receipt.method,'codex.exec');assert.equal(receipt.durable,true);assert.deepEqual(fs.readFileSync(historyFile),history);
 const resume=f.start(currentMessage(f,'NEXT MESSAGE'));assert.equal(resume.invocation.args.at(-2),id);assert.equal(resume.invocation.stdin,'NEXT MESSAGE');resume.close();
});

test('legacy no-thread recovery refuses other errors, incomplete tree evidence, tool effects and ambiguous output',t=>{
 const mutations={
  'another diagnostic':s=>{s.completed[0].result.result.output='Connection error\n';},
  'quoted parser text':s=>{s.completed[0].result.result.output='assistant: '+s.completed[0].result.result.output;},
  'truncated output':s=>{s.completed[0].result.result.truncated=true;},
  'extra diagnostics':s=>{s.completed[0].result.result.diagnostics='additional model activity';},
  'other MCP name':s=>{s.completed[0].result.result.output='Error loading config.toml: invalid transport\nin `mcp_servers.unrelated`\n';},
  'missing outer failure':s=>{delete s.completed[0].result.code;},
  'successful outer status':s=>{s.completed[0].result.status='succeeded';},
  'different runtime':s=>{s.completed[0].result.result.runtime='Hermes';},
  'different exit code':s=>{s.completed[0].result.result.processExit.rootExitCode=125;},
  'unconfirmed tree':s=>{s.completed[0].result.result.processExit.treeConfirmed=false;},
  'remaining child':s=>{s.completed[0].result.result.processExit.activeProcesses=1;},
  'cancelled':s=>{s.completed[0].result.result.processExit.cancelled=true;},
  'background retained':s=>{s.completed[0].result.result.processExit.backgroundProcessesRetained=true;},
  'uncertain model effects':s=>{s.completed[0].result.result.executionState='uncertain';},
  'phone evidence':s=>{s.completed[0].result.result.terminalMcp={loaded:false};},
  'management loaded':s=>{s.completed[0].result.result.managementMcp.loaded=true;},
  'management tool':s=>{s.completed[0].result.result.managementMcp.toolCalls=[{toolName:'ziwei_create_employee',ok:true}];},
  'native session':s=>{s.completed[0].result.result.nativeSessionId=randomUUID();},
  'foreign completed identity':s=>{s.completed[0].identity.deviceId='device_foreign';},
 };
 for(const[name,change]of Object.entries(mutations)){const f=fixture(t);legacyTransportRejection(f,change);const before=fs.readFileSync(f.record());assert.throws(()=>f.start(currentMessage(f)),error=>['CODEX_CONVERSATION_PREVIOUS_UNCONFIRMED','CODEX_CONVERSATION_THREAD_UNCONFIRMED'].includes(error.code),name);assert.deepEqual(fs.readFileSync(f.record()),before,name);}
});

test('legacy pre-model rejection cannot replay its own action or unstructured historical prompt',t=>{
 for(const kind of['same action','no canonical input','pending mapping']){const f=fixture(t),legacy=legacyTransportRejection(f);let action=currentMessage(f);if(kind==='same action')action.id=legacy.action.id;if(kind==='no canonical input')action=f.action();if(kind==='pending mapping'){const value=JSON.parse(fs.readFileSync(f.record(),'utf8'));value.state='pending';fs.writeFileSync(f.record(),JSON.stringify(value),{mode:0o600});}
  const before=fs.readFileSync(f.record());assert.throws(()=>f.start(action),{code:'CODEX_CONVERSATION_THREAD_UNCONFIRMED'},kind);assert.deepEqual(fs.readFileSync(f.record()),before,kind);
 }
});

test('restart pending recovers from exact existing dispatcher action root evidence without replaying prompt',t=>{
 const f=fixture(t),s=f.start(),id=f.event(s);s.markSpawned();s.close();const r=JSON.parse(fs.readFileSync(f.record(),'utf8'));saveHistory(f,r,{...rootExit,rootExitCode:125});const next=f.start();assert.equal(next.invocation.args.at(-2),id);next.close();
});

test('actual dispatcher persists matching started and completed rows for scoped pending recovery',async t=>{
 const f=fixture(t),a=f.action();a.payload.deviceId='device_alpha';a.payload.workdir=f.cwd;a.dedupeKey='conversation:conv_alpha:convmsg_dispatcher';let nativeId;
 const dispatcher=new ActionDispatcher({workspace:'bigtron',deviceId:'device_alpha',workdir:f.cwd,stateFile:path.join(f.runtimeDir,'action-state.json'),execute:async(_action,context)=>{const s=f.start(a);nativeId=f.event(s);s.markSpawned();context.onSupervision({completionEvidence:Promise.resolve(rootExit),stop:async()=>rootExit});s.close();return{status:'succeeded',result:{output:'isolated native fixture'}};}});
 const result=await dispatcher.dispatch(a);assert.equal(result.status,'succeeded');const state=JSON.parse(fs.readFileSync(path.join(f.runtimeDir,'action-state.json'),'utf8'));assert.equal(state.started.length,1);assert.equal(state.completed.length,1);assert.equal(state.started[0].actionId,a.id);assert.equal(state.completed[0].result.result.processExit.rootConfirmed,true);
 const next=f.start();assert.equal(next.invocation.args.at(-2),nativeId);next.close();
});

test('resumed run without new thread event keeps old binding recoverable after exact dispatcher exit evidence',t=>{
 const f=fixture(t),first=f.start(),id=f.event(first);finish(first);const resumed=f.start();resumed.markSpawned();assert.throws(()=>resumed.complete({processExit:{...rootExit,rootExitCode:125},code:125}),{code:'CODEX_CONVERSATION_THREAD_UNCONFIRMED'});resumed.close();const record=JSON.parse(fs.readFileSync(f.record(),'utf8'));assert.equal(record.threadId,id);assert.equal(record.state,'unconfirmed');saveHistory(f,record,{...rootExit,rootExitCode:125});const next=f.start();assert.equal(next.invocation.args.at(-2),id);next.close();
});

test('fragmented stdout identifies only exact top-level UUID; pre-spawn cleanup restores prior ready mapping',t=>{
 const f=fixture(t),s=f.start(),id=randomUUID();f.rollout(id);const line=JSON.stringify({type:'thread.started',thread_id:id})+'\r\n';s.observeStdout(line.slice(0,13));s.observeStdout(line.slice(13,34));s.observeStdout(line.slice(34));finish(s);const before=fs.readFileSync(f.record(),'utf8');const next=f.start();next.close();assert.equal(fs.readFileSync(f.record(),'utf8'),before);const again=f.start();assert.equal(again.invocation.args.at(-2),id);again.close();
});

test('beforeSpawn rejection and pre-aborted runtime leave no pending map or native CLI invocation',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),options={runtime:'Codex',prompt:'must not run',cwd:f.cwd,env:{CODEX_HOME:f.home},codexConversation:f.host()};await assert.rejects(()=>executeRuntime({...options,beforeSpawn:()=>{throw Object.assign(new Error('fixture admission rejected'),{code:'FIXTURE_DENIED'});}}),/fixture admission rejected/);assert.equal(fs.existsSync(path.join(f.home,'calls.jsonl')),false);assert.deepEqual(fs.readdirSync(path.join(f.runtimeDir,'codex-conversation-sessions')),[]);
 const controller=new AbortController();controller.abort();const result=await executeRuntime({...options,signal:controller.signal});assert.equal(result.code,'cancelled');assert.equal(fs.existsSync(path.join(f.home,'calls.jsonl')),false);
});

test('known native no-launch keeps previous exact ready binding, including a bootstrap failure code',t=>{
 const f=fixture(t),first=f.start(),id=f.event(first);finish(first);const before=fs.readFileSync(f.record(),'utf8'),next=f.start();next.markSpawned();const receipt=next.complete({processExit:{launched:false,rootPid:null,rootExitCode:null,rootConfirmed:false,treeConfirmed:true,activeProcesses:0,failureCode:'RUNTIME_SPAWN_FAILED'},code:1});next.close();assert.equal(receipt.threadId,id);assert.equal(receipt.status,'not_started');assert.equal(fs.readFileSync(f.record(),'utf8'),before);
});

test('cancellation only recovers a prior pending scope with confirmed complete owned tree',t=>{
 const f=fixture(t),s=f.start();const id=f.event(s);s.markSpawned();s.close();const record=JSON.parse(fs.readFileSync(f.record(),'utf8'));saveHistory(f,record,{...rootExit,cancelled:true,rootExitCode:1});const next=f.start();assert.equal(next.invocation.args.at(-2),id);next.close();
});

test('unknown/cross-scope/incorrect-conversation/cancelled-live prior action keeps only its scope blocked',t=>{
 for(const kind of['root','scope','conversation','cancelled','missing','unconfirmed']){const f=fixture(t),s=f.start();f.event(s);s.markSpawned();s.close();const r=JSON.parse(fs.readFileSync(f.record(),'utf8'));saveHistory(f,r,kind==='root'?{...rootExit,rootConfirmed:false}:kind==='cancelled'?{...rootExit,cancelled:true,treeConfirmed:false,activeProcesses:2}:rootExit,state=>{if(kind==='scope')state.completed[0].identity.deviceId='device_wrong';if(kind==='conversation'){state.started[0].key=state.completed[0].key='conversation:conv_wrong:convmsg_fixture';}if(kind==='missing')state.completed=[];if(kind==='unconfirmed')state.completed[0].result.status='duplicate';});assert.throws(()=>f.start(),{code:'CODEX_CONVERSATION_PREVIOUS_UNCONFIRMED'});const other=f.start(f.action({conversationId:'conv_other'}));other.close();}
});

test('untrusted capability and non-daemon complete binding refuse, incomplete one-shot remains ephemeral',t=>{
 const f=fixture(t);assert.throws(()=>prepareCodexConversationSession({binding:{},codexHome:f.home,cwd:f.cwd}),{code:'CODEX_CONVERSATION_HOST_REQUIRED'});assert.throws(()=>f.host(f.action(),{daemonBound:false}),{code:'CODEX_CONVERSATION_HOST_REQUIRED'});assert.equal(f.host({id:'task',type:'task.execute',payload:{}}),null);assert.equal(f.host(f.action({employeeId:null})),null);assert.equal(runtimeInvocation('Codex',{prompt:'one shot'}).args.includes('--ephemeral'),true);
});

test('unsupported invocation fails before pending mapping and symlinked private mapping refuses',t=>{
 const f=fixture(t);assert.throws(()=>f.start(f.action(),{invocation:{args:['exec','--last','-']}}),{code:'CODEX_CONVERSATION_INVOCATION_INVALID'});const s=f.start();s.close();if(process.platform==='win32')return;const dir=path.join(f.runtimeDir,'codex-conversation-sessions');fs.rmdirSync(dir);fs.symlinkSync(f.cwd,dir,'dir');assert.throws(()=>f.start(),{code:'CODEX_CONVERSATION_PATH_UNSAFE'});
});

function fakeCli(f,t){
 const bin=path.join(f.root,'bin');fs.mkdirSync(bin);const script=`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
if(process.argv[2]==='--version'){console.log('codex-cli 0.162.0-alpha.17.2');process.exit(0);}
if(process.argv.includes('mcp')&&process.argv.includes('list')){if(process.env.FAKE_MCP_FAILURE){console.error('private-native-config');process.exit(1);}console.log(process.env.FAKE_MCP_CONFIG||'[]');process.exit(0);}
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const args=process.argv.slice(2),resumed=args.includes('resume'),id=resumed?args.at(-2):crypto.randomUUID(),now=new Date(),home=process.env.CODEX_HOME;
fs.appendFileSync(path.join(home,'calls.jsonl'),JSON.stringify({args,input,id})+'\\n');
if(process.env.FAKE_PARSE_REJECTION==='1'){console.error('Error loading config.toml: invalid transport\\nin '+String.fromCharCode(96)+'mcp_servers.ziwei-terminal'+String.fromCharCode(96));process.exitCode=1;return;}
if(process.env.FAKE_PHONE_UNCERTAIN==='1'&&process.env.ZIWEI_TERMINAL_AUDIT_FILE)fs.writeFileSync(process.env.ZIWEI_TERMINAL_AUDIT_FILE,[{method:'initialize',ok:true},{method:'tools/call',toolName:'ziwei_phone_action',ok:false,error:'isolated response lost'}].map(JSON.stringify).join('\\n')+'\\n');
if(!resumed){const directory=path.join(home,'sessions',String(now.getUTCFullYear()),String(now.getUTCMonth()+1).padStart(2,'0'),String(now.getUTCDate()).padStart(2,'0'));fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'rollout-fixture-'+id+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id,cwd:process.cwd(),timestamp:now.toISOString()}})+'\\n');}
const event=JSON.stringify({type:'thread.started',thread_id:id});if(process.env.FAKE_STDERR_ID)console.error(event);else console.log(event);
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture '+(resumed?'resumed':'created')}}));process.exitCode=process.env.FAKE_FAIL==='1'?125:0;});`;
 const binary=path.join(bin,process.platform==='win32'?'codex.cmd':'codex');if(process.platform==='win32'){const entry=path.join(bin,'node_modules','@openai','codex','bin','codex.js');fs.mkdirSync(path.dirname(entry),{recursive:true});fs.writeFileSync(entry,script);fs.writeFileSync(binary,'@echo off\r\nexit /b 99\r\n');}else{const entry=path.join(bin,'fixture.cjs');fs.writeFileSync(entry,script);const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";fs.writeFileSync(binary,'#!/bin/sh\nif [ "$1" = "--version" ]; then printf "codex-cli 0.162.0-alpha.17.2\\n"; exit 0; fi\nexec '+quote(process.execPath)+' '+quote(entry)+' "$@"\n',{mode:0o700});}
 fs.writeFileSync(path.join(f.home,'auth.json'),JSON.stringify({OPENAI_API_KEY:'ISOLATED_FIXTURE_NO_PROVIDER'}),{mode:0o600});
 const isolated={PATH:bin+path.delimiter+(process.platform==='win32'?path.join(process.env.SystemRoot,'System32')+path.delimiter+path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0'):'/usr/bin:/bin'),CODEX_HOME:f.home,HERMES_HOME:path.join(f.root,'empty-hermes'),APPDATA:f.root,npm_config_prefix:bin,NPM_CONFIG_USERCONFIG:path.join(f.root,'empty.npmrc')};fs.writeFileSync(isolated.NPM_CONFIG_USERCONFIG,'');const previous=new Map(Object.keys(isolated).map(k=>[k,process.env[k]]));Object.assign(process.env,isolated);t.mock.method(os,'homedir',()=>f.root);
 // Discovery has its own tests. Supply only this fixture's public version;
 // actual exec/resume still spawns its isolated process through supervision.
 const originalSpawnSync=childProcess.spawnSync,entry=path.join(bin,'node_modules','@openai','codex','bin','codex.js');t.mock.method(childProcess,'spawnSync',(command,args,options)=>command===binary&&args?.length===1&&args[0]==='--version'||command===process.execPath&&args?.length===2&&args[0]===entry&&args[1]==='--version'?{status:0,stdout:'codex-cli 0.162.0-alpha.17.2\n',stderr:''}:originalSpawnSync(command,args,options));syncBuiltinESMExports();resetRuntimeDiscovery();t.after(()=>{for(const[k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}t.mock.restoreAll();syncBuiltinESMExports();resetRuntimeDiscovery();});const found=discoverInstalledRuntimes({force:true}).runtimes.Codex;assert.equal(found.binary,binary);assert.equal(found.status,'available',found.detection.reasonCode||'fixture version unavailable');
 return{binary,calls:()=>fs.readFileSync(path.join(f.home,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse)};
}

test('real local runtime adapter persists then resumes fake native session and excludes stderr identities',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),run=(a,env={})=>executeRuntime({runtime:'Codex',prompt:a.payload.prompt||'new prompt',cwd:f.cwd,env:{CODEX_HOME:f.home,...env},codexConversation:f.host(a)});
 const first=await run(f.action({prompt:'first unique prompt'}));assert.equal(first.status,'succeeded');assert.equal(first.result.codexConversation.durable,true);assert.equal(first.result.codexConversation.method,'codex.exec');
 const second=await run(f.action({prompt:'second unique prompt'}),{FAKE_FAIL:'1'});assert.equal(second.status,'failed');assert.equal(second.code,'runtime_failed');assert.equal(second.result.codexConversation.durable,true);assert.equal(second.result.nativeSessionId,first.result.nativeSessionId);assert.equal(second.result.codexConversation.method,'codex.exec.resume');
 const calls=fake.calls();assert.equal(calls.length,2);assert.equal(calls[0].args.includes('--ephemeral'),false);assert.equal(calls[1].args.includes('resume'),true);assert.equal(calls[1].input,'second unique prompt');assert.equal(calls[1].args.at(-2),calls[0].id);
 const other=await run(f.action({employeeId:'employee_stderr'}),{FAKE_STDERR_ID:'1'});assert.equal(other.status,'failed');assert.equal(other.code,'CODEX_CONVERSATION_THREAD_UNCONFIRMED');
});

test('trusted Codex disable policy touches only existing native transports and keeps literal server keys',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),servers=[{name:'key.with.dot',transport:{type:'stdio',command:'never-run-fixture'}},{name:'ziwei-terminal',transport:{type:'streamable_http',url:'https://example.test/mcp'}}];
 const result=await executeRuntime({runtime:'Codex',prompt:'isolated native policy fixture',cwd:f.cwd,env:{CODEX_HOME:f.home,FAKE_MCP_CONFIG:JSON.stringify(servers)},codexMcpDisabledServers:['key.with.dot','missing-server'],codexConversation:f.host(f.action())});
 assert.equal(result.status,'succeeded');const args=fake.calls()[0].args;
 assert.ok(args.includes('mcp_servers={"key.with.dot"={enabled=false}}'));assert.ok(args.includes('mcp_servers.ziwei-terminal.enabled=false'));
 assert.equal(args.some(value=>value.includes('missing-server')),false);
 const absent=await executeRuntime({runtime:'Codex',prompt:'isolated no-server policy fixture',cwd:f.cwd,env:{CODEX_HOME:f.home},codexMcpDisabledServers:['missing-server']});
 assert.equal(absent.status,'succeeded');const noServers=fake.calls()[1].args;
 assert.equal(noServers.some(value=>value.startsWith('mcp_servers=')),false);assert.equal(noServers.includes('mcp_servers.ziwei-terminal.enabled=false'),false);
});

test('failed native inventory does not launch a model or reserve a persistent conversation',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),a=f.action();let error;
 try{await executeRuntime({runtime:'Codex',prompt:'never start a model',cwd:f.cwd,env:{CODEX_HOME:f.home,FAKE_MCP_FAILURE:'1'},codexConversation:f.host(a)});}catch(caught){error=caught;}
 assert.equal(error?.code,'CODEX_MCP_CONFIG_DISCOVERY_FAILED');assert.equal(consumeRuntimePrelaunchEvidence(error)?.processExit.launched,false);
 assert.equal(fs.existsSync(path.join(f.home,'calls.jsonl')),false);assert.equal(fs.existsSync(path.join(f.runtimeDir,'codex-conversation-sessions')),false);
 const valid=await executeRuntime({runtime:'Codex',prompt:'new valid read-only fixture',cwd:f.cwd,env:{CODEX_HOME:f.home},codexConversation:f.host(f.action())});assert.equal(valid.status,'succeeded');assert.equal(fake.calls().length,1);
});

test('native MCP discovery refusal finishes a real dispatched action without quarantining the device',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),tokenFile=path.join(f.root,'management.json');fs.writeFileSync(tokenFile,JSON.stringify({token:'ISOLATED_FIXTURE',workspaces:['bigtron']}),{mode:0o600});
 const execute=createLocalActionExecutor({runtimeDir:f.runtimeDir,defaultWorkdir:f.cwd,workspace:'bigtron',deviceId:'device_alpha',apiBase:'https://example.test',admissionHandledByDispatcher:true,managementMcpConfig:{enabled:true,tokenFile,baseUrl:'https://example.test'}});
 const dispatcher=new ActionDispatcher({execute,workspace:'bigtron',deviceId:'device_alpha',workdir:f.cwd,stateFile:path.join(f.runtimeDir,'action-state.json')});
 const action=f.action({deviceId:'device_alpha',prompt:'never launch the model',env:{CODEX_HOME:f.home,FAKE_MCP_FAILURE:'1'}});action.dedupeKey='conversation:conv_alpha:convmsg_inventory';
 const result=await dispatcher.dispatch(action);assert.equal(result.status,'failed');assert.equal(result.code,'CODEX_MCP_CONFIG_DISCOVERY_FAILED');assert.equal(result.result.prelaunch.source,'codex-mcp-config-discovery');assert.equal(result.result.processExit.launched,false);assert.equal(result.result.processExit.treeConfirmed,true);assert.equal(dispatcher.quarantined,false);assert.equal(fs.existsSync(path.join(f.home,'calls.jsonl')),false);
});

test('actual dispatcher preserves the exact legacy parser failure code used for empty-thread recovery',async t=>{
 const f=fixture(t);fakeCli(f,t);const tokenFile=path.join(f.root,'management.json');fs.writeFileSync(tokenFile,JSON.stringify({token:'ISOLATED_FIXTURE',workspaces:['bigtron']}),{mode:0o600});
 const execute=createLocalActionExecutor({runtimeDir:f.runtimeDir,defaultWorkdir:f.cwd,workspace:'bigtron',deviceId:'device_alpha',apiBase:'https://example.test',admissionHandledByDispatcher:true,managementMcpConfig:{enabled:true,tokenFile,baseUrl:'https://example.test'}});
 const stateFile=path.join(f.runtimeDir,'action-state.json'),dispatcher=new ActionDispatcher({execute,workspace:'bigtron',deviceId:'device_alpha',workdir:f.cwd,stateFile});
 const old=currentMessage(f,'FAILED OLD MESSAGE');Object.assign(old.payload,{deviceId:'device_alpha',prompt:'FAILED OLD MESSAGE',env:{CODEX_HOME:f.home,FAKE_PARSE_REJECTION:'1'}});old.dedupeKey='conversation:conv_alpha:'+old.payload.messageId;
 const failed=await dispatcher.dispatch(old);assert.equal(failed.status,'failed');assert.equal(failed.code,'CODEX_CONVERSATION_THREAD_UNCONFIRMED');assert.equal(dispatcher.quarantined,false);
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));assert.equal(state.completed[0].result.code,'CODEX_CONVERSATION_THREAD_UNCONFIRMED');assert.equal(state.completed[0].result.result.code,1);assert.equal(state.completed[0].result.result.truncated,false);
 const history=fs.readFileSync(stateFile),start=()=>f.start(currentMessage(f,'NEW CANONICAL MESSAGE'),{invocation:{args:['exec','--json','-'],stdin:'OLD HISTORY MUST NOT BE USED'}});
 if(state.completed[0].result.result.processExit.treeConfirmed!==true){
  // A direct macOS fixture has no complete Windows Job tree receipt. It must
  // retain that uncertainty; the exact Windows evidence is tested above.
  assert.throws(start,{code:'CODEX_CONVERSATION_THREAD_UNCONFIRMED'});
 }else{const next=start();assert.equal(next.invocation.args.includes('resume'),false);assert.equal(next.invocation.stdin,'NEW CANONICAL MESSAGE');next.close();}
 assert.deepEqual(fs.readFileSync(stateFile),history);
});

test('real fake CLI permits separate employee concurrency while same conversation launches once',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),run=a=>executeRuntime({runtime:'Codex',prompt:'isolated parallel new user turn',cwd:f.cwd,env:{CODEX_HOME:f.home},codexConversation:f.host(a)});
 const separate=await Promise.all([run(f.action()),run(f.action({employeeId:'employee_parallel'}))]);assert.ok(separate.every(r=>r.status==='succeeded'));assert.notEqual(separate[0].result.nativeSessionId,separate[1].result.nativeSessionId);
 const same=await Promise.allSettled([run(f.action({conversationId:'conv_same'})),run(f.action({conversationId:'conv_same'}))]);assert.equal(same.filter(r=>r.status==='fulfilled').length,1);assert.equal(same.find(r=>r.status==='rejected').reason.code,'CODEX_CONVERSATION_BUSY');assert.equal(fake.calls().length,3);
});

test('native session receipt failure preserves independent phone write uncertainty and MCP invocation settings',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),a=f.action(),tokenFile=path.join(f.root,'phone.json'),baseUrl='https://example.test/terminal-mcp/v1/workspaces/bigtron/employees/employee_alpha';fs.writeFileSync(tokenFile,JSON.stringify({token:'ISOLATED_PHONE_FIXTURE',workspace:'bigtron',employeeId:'employee_alpha',deviceId:'phone_fixture',actionId:a.id,expiresAt:new Date(Date.now()+60000).toISOString(),baseUrl}),{mode:0o600});
 const result=await executeRuntime({runtime:'Codex',prompt:'isolated receipt fixture only',cwd:f.cwd,env:{CODEX_HOME:f.home,FAKE_PHONE_UNCERTAIN:'1',FAKE_STDERR_ID:'1'},codexConversation:f.host(a),terminalMcp:{workspace:'bigtron',actionId:a.id,auditDirectory:path.join(f.root,'phone-audit'),request:{enabled:true,workspace:'bigtron',employeeId:'employee_alpha',deviceId:'phone_fixture'},config:{enabled:true,tokenFile,baseUrl}}});
 assert.equal(result.code,'CODEX_CONVERSATION_THREAD_UNCONFIRMED');assert.equal(result.result.terminalMcp.executionState,'uncertain');assert.equal(result.result.executionState,'uncertain');assert.equal(result.result.terminalMcp.failure.retryAllowed,false);assert.ok(fake.calls()[0].args.includes('mcp_servers.ziwei-terminal.enabled=true'));
});

test('authenticated local-action binding survives executor recreation; unscoped task stays ephemeral',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),tokenFile=path.join(f.root,'mcp.json');fs.writeFileSync(tokenFile,JSON.stringify({token:'ISOLATED_FIXTURE_MCP',workspaces:['bigtron']}),{mode:0o600});
 const options={runtimeDir:f.runtimeDir,defaultWorkdir:f.cwd,workspace:'bigtron',deviceId:'device_alpha',apiBase:'https://example.test',admissionHandledByDispatcher:true,managementMcpConfig:{enabled:true,tokenFile,baseUrl:'https://example.test'}};
 const run=(changes={})=>createLocalActionExecutor(options)(f.action({prompt:'FULL_HISTORY_BOOTSTRAP original current user',messageId:'convmsg_first',codexConversationInput:{schemaVersion:1,messageId:'convmsg_first',currentPrompt:'ROLE plus original current user'},env:{CODEX_HOME:f.home},...changes}));
 const first=await run();assert.equal(first.result.codexConversation.durable,true);const second=await run({prompt:'OLD_QUOTED_HISTORY plus second user',messageId:'convmsg_second',codexConversationInput:{schemaVersion:1,messageId:'convmsg_second',currentPrompt:'ROLE plus ONLY_SECOND_USER'},attachments:[{name:'input.txt',mimeType:'text/plain',contentEncoding:'base64',content:Buffer.from('isolated attachment').toString('base64')}]});assert.equal(second.result.codexConversation.threadId,first.result.codexConversation.threadId);const calls=fake.calls();assert.equal(calls[1].args.includes('resume'),true);assert.match(calls[0].input,/FULL_HISTORY_BOOTSTRAP/);assert.match(calls[1].input,/ROLE plus ONLY_SECOND_USER/);assert.doesNotMatch(calls[1].input,/OLD_QUOTED_HISTORY|original current user/);assert.match(calls[1].input,/\[本机附件\].*\n- input.txt:/);assert.match(calls[1].input,/\[本次执行的图片输出通道\]/);assert.doesNotMatch(fs.readFileSync(f.record(),'utf8'),/ONLY_SECOND_USER|FULL_HISTORY_BOOTSTRAP/);
 const oneShot=await createLocalActionExecutor({runtimeDir:f.runtimeDir,defaultWorkdir:f.cwd,admissionHandledByDispatcher:true})({id:'one-shot',type:'task.execute',payload:{runtime:'Codex',prompt:'once only',env:{CODEX_HOME:f.home}}});assert.equal(oneShot.status,'succeeded');assert.equal(fake.calls().at(-1).args.includes('--ephemeral'),true);assert.equal(oneShot.result.codexConversation,undefined);
});

test('structured current input is exact scoped data, malformed message/version/shape never launches',t=>{
 const f=fixture(t),valid={schemaVersion:1,messageId:'convmsg_exact',currentPrompt:'current user only'};
 for(const input of[{...valid,schemaVersion:2},{...valid,messageId:'convmsg_other'},{...valid,extra:'forbidden'},{...valid,currentPrompt:''},{...valid,currentPrompt:'x'.repeat(1024*1024+1)}])assert.throws(()=>f.host(f.action({messageId:'convmsg_exact',codexConversationInput:input})),{code:'CODEX_CONVERSATION_INPUT_INVALID'});
 assert.equal(fs.existsSync(path.join(f.runtimeDir,'codex-conversation-sessions')),false);
});

test('real dispatcher plus local executor keeps malformed map and changed scope local to that conversation',async t=>{
 const f=fixture(t),fake=fakeCli(f,t),tokenFile=path.join(f.root,'management.json');fs.writeFileSync(tokenFile,JSON.stringify({token:'ISOLATED_FIXTURE',workspaces:['bigtron']}),{mode:0o600});const execute=createLocalActionExecutor({runtimeDir:f.runtimeDir,defaultWorkdir:f.cwd,workspace:'bigtron',deviceId:'device_alpha',apiBase:'https://example.test',admissionHandledByDispatcher:true,managementMcpConfig:{enabled:true,tokenFile,baseUrl:'https://example.test'}});
 const dispatcher=new ActionDispatcher({execute,workspace:'bigtron',deviceId:'device_alpha',workdir:f.cwd,stateFile:path.join(f.runtimeDir,'action-state.json')});const action=(changes={})=>{const a=f.action({prompt:'isolated user turn',deviceId:'device_alpha',env:{CODEX_HOME:f.home},...changes});a.dedupeKey='conversation:'+a.payload.conversationId+':convmsg_'+randomUUID();return a;};
 const first=await dispatcher.dispatch(action());assert.equal(first.result.codexConversation.durable,true);const recordFile=f.record(),ready=fs.readFileSync(recordFile,'utf8');fs.writeFileSync(recordFile,'{broken');const bad=await dispatcher.dispatch(action());assert.equal(bad.code,'CODEX_CONVERSATION_STATE_INVALID');assert.equal(bad.result.prelaunch.source,'codex-conversation-preflight');assert.equal(bad.result.processExit.launched,false);assert.equal(dispatcher.quarantined,false);assert.equal(fs.readFileSync(recordFile,'utf8'),'{broken');fs.writeFileSync(recordFile,ready);
 const otherDir=path.join(f.cwd,'changed');fs.mkdirSync(otherDir);const changed=await dispatcher.dispatch(action({workdir:otherDir,cwd:otherDir}));assert.equal(changed.code,'CODEX_CONVERSATION_SCOPE_CHANGED');assert.equal(changed.result.processExit.launched,false);assert.equal(dispatcher.quarantined,false);assert.equal(fs.readFileSync(recordFile,'utf8'),ready);
 const malformedInput=await dispatcher.dispatch(action({messageId:'convmsg_real',codexConversationInput:{schemaVersion:1,messageId:'convmsg_wrong',currentPrompt:'not allowed'}}));assert.equal(malformedInput.code,'CODEX_CONVERSATION_INPUT_INVALID');assert.equal(malformedInput.result.prelaunch.actionId,malformedInput.actionId);assert.equal(dispatcher.quarantined,false);
 const before=fake.calls().length,other=await dispatcher.dispatch(action({employeeId:'employee_other',conversationId:'conv_other'}));assert.equal(other.result.codexConversation.durable,true);assert.equal(fake.calls().length,before+1);assert.equal(dispatcher.quarantined,false);
});

test('owned raw filesystem preflight errors carry no-launch proof while forged codes and postspawn errors do not',t=>{
 const f=fixture(t);let raw;try{f.start(f.action(),{codexHome:path.join(f.root,'missing')});}catch(error){raw=error;}const proof=consumeRuntimePrelaunchEvidence(raw);assert.equal(proof.processExit.launched,false);assert.equal(proof.prelaunch.employeeId,'employee_alpha');assert.equal(proof.prelaunch.conversationId,'conv_alpha');assert.equal(consumeRuntimePrelaunchEvidence(raw),null);
 const forged=Object.assign(new Error('external error'),{code:'CODEX_CONVERSATION_STATE_INVALID',definitelyNotStarted:true});assert.equal(consumeRuntimePrelaunchEvidence(forged),null);
 const s=f.start();s.markSpawned();let post;try{s.complete({processExit:rootExit,code:0});}catch(error){post=error;}s.close();assert.equal(post.code,'CODEX_CONVERSATION_THREAD_UNCONFIRMED');assert.equal(consumeRuntimePrelaunchEvidence(post),null);
});

test('a fabricated Codex error code cannot suppress native dispatcher quarantine',async t=>{
 const f=fixture(t),dispatcher=new ActionDispatcher({execute:async()=>{throw Object.assign(new Error('untrusted serialized error'),{code:'CODEX_CONVERSATION_STATE_INVALID',definitelyNotStarted:true});},workspace:'bigtron',deviceId:'device_alpha',workdir:f.cwd,stateFile:path.join(f.runtimeDir,'action-state.json')});const a=f.action({deviceId:'device_alpha'});a.dedupeKey='conversation:conv_alpha:convmsg_spoof';const result=await dispatcher.dispatch(a);assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(dispatcher.quarantined,true);
});
