import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {markCodexConversationPrelaunchFailure} from './runtime-launch-evidence.mjs';

const bindings=new WeakMap(),activeScopes=new Set();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id=(value,prefix)=>typeof value==='string'&&new RegExp('^'+prefix+'[A-Za-z0-9_-]{1,120}$').test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=(code,message)=>Object.assign(new Error(message),{code});
const scopeKeys=['origin','workspace','deviceId','employeeId','conversationId','profile','home','cwd'];
const recordKeys=['schemaVersion','key','scope','state','threadId','rollout','actionId','attemptId','startedAt','updatedAt'];
function noLinks(file){for(let current=path.resolve(file);;current=path.dirname(current)){let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}if(stat?.isSymbolicLink())throw fail('CODEX_CONVERSATION_PATH_UNSAFE','Codex 会话目录包含链接，未启动会话');if(current===path.dirname(current))break;}}
function privateDirectory(directory){if(!path.isAbsolute(directory))throw fail('CODEX_CONVERSATION_PATH_UNSAFE','Codex 会话缺少宿主私有目录');noLinks(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});if(process.platform!=='win32')fs.chmodSync(directory,0o700);return fs.realpathSync.native(directory);}
function readJson(file,max=64*1024){noLinks(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>max)throw fail('CODEX_CONVERSATION_STATE_INVALID','Codex 会话映射不是有效的私有普通文件');if(process.platform!=='win32'&&(stat.mode&0o077))throw fail('CODEX_CONVERSATION_PERMISSIONS','Codex 会话映射权限过宽，未读取会话');return JSON.parse(fs.readFileSync(file,'utf8'));}
function writeJson(file,value){noLinks(file);const temporary=file+'.'+randomUUID()+'.tmp';let fd;try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,file);if(process.platform!=='win32'){fs.chmodSync(file,0o600);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}}
function realDirectory(directory){if(typeof directory!=='string'||!path.isAbsolute(directory))throw fail('CODEX_CONVERSATION_SCOPE_INVALID','Codex 会话需要明确的 HOME 和工作目录');const real=fs.realpathSync.native(directory);if(!fs.statSync(real).isDirectory())throw fail('CODEX_CONVERSATION_SCOPE_INVALID','Codex 会话工作目录或 HOME 不存在');return real;}
function equalPath(a,b){return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function sameScope(a,b){return scopeKeys.every(key=>['home','cwd'].includes(key)?equalPath(a[key],b[key]):a[key]===b[key]);}

/** Only the authenticated single-daemon local-action adapter creates this
 * in-process capability. A JSON action cannot select a native thread or path.
 * Other multi-process callers have no supported persistent-session entry. */
function bindHost({action,workspace,deviceId,apiBase,runtimeDir,daemonBound=false,currentPromptSuffix=''}={}){
 const p=action?.payload||{};
 if(action?.type!=='conversation.execute'||!workspace||!deviceId||!p.employeeId||!p.conversationId)return null;
 if(daemonBound!==true)throw fail('CODEX_CONVERSATION_HOST_REQUIRED','Codex 持久会话仅支持已认证的单实例紫薇宿主，当前入口不能保证同会话进程隔离');
 if(!/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(workspace)||!id(deviceId,'device_')||!id(p.employeeId,'employee_')||!id(p.conversationId,'conv_')||!id(action.id,'action_')||!path.isAbsolute(runtimeDir||''))throw fail('CODEX_CONVERSATION_SCOPE_INVALID','Codex 会话缺少完整的员工、设备及聊天绑定');
 let currentPrompt=null;
 if(p.codexConversationInput!==undefined){const input=p.codexConversationInput;if(!exact(input,['schemaVersion','messageId','currentPrompt'])||input.schemaVersion!==1||typeof p.messageId!=='string'||input.messageId!==p.messageId||!id(input.messageId,'convmsg_')||typeof input.currentPrompt!=='string'||!input.currentPrompt.trim()||input.currentPrompt.length>1024*1024||typeof currentPromptSuffix!=='string'||currentPromptSuffix.length>1024*1024)throw fail('CODEX_CONVERSATION_INPUT_INVALID','Codex 当前用户输入与受信会话消息不匹配，未启动会话');currentPrompt=input.currentPrompt+currentPromptSuffix;}
 let origin;try{const url=new URL(apiBase);if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error();origin=url.origin;}catch{throw fail('CODEX_CONVERSATION_SCOPE_INVALID','Codex 会话服务地址无效');}
 const capability=Object.freeze({});bindings.set(capability,Object.freeze({origin,workspace,deviceId,employeeId:p.employeeId,conversationId:p.conversationId,actionId:action.id,currentPrompt,privateDirectory:path.join(runtimeDir,'codex-conversation-sessions'),stateFile:path.join(runtimeDir,'action-state.json')}));return capability;
}
export function bindCodexConversationToHost(options={}){
 try{return bindHost(options);}catch(error){const{action,workspace,deviceId,daemonBound}=options;if(daemonBound===true&&action?.type==='conversation.execute')throw markCodexConversationPrelaunchFailure(error,{workspace,deviceId,actionId:action.id,employeeId:action.payload?.employeeId,conversationId:action.payload?.conversationId});throw error;}
}

function validateRecord(value,key,scope){
 if(!exact(value,recordKeys)||value.schemaVersion!==1||value.key!==key||!exact(value.scope,scopeKeys)||!scopeKeys.every(k=>typeof value.scope[k]==='string')||!['pending','ready','unconfirmed'].includes(value.state)||value.threadId!==null&&(typeof value.threadId!=='string'||!UUID.test(value.threadId))||value.rollout!==null&&typeof value.rollout!=='string'||!id(value.actionId,'action_')||typeof value.attemptId!=='string'||!UUID.test(value.attemptId)||!Number.isFinite(value.startedAt)||!Number.isFinite(value.updatedAt)||value.updatedAt<value.startedAt)throw fail('CODEX_CONVERSATION_STATE_INVALID','此聊天的 Codex 会话映射损坏；未改动原生会话或启动新任务');
 if(!sameScope(value.scope,scope))throw fail('CODEX_CONVERSATION_SCOPE_CHANGED','此聊天的 Codex profile、HOME 或工作目录已变化；未连接其他会话，请先明确迁移会话');
 if(value.state==='ready'&&(!value.threadId||!value.rollout))throw fail('CODEX_CONVERSATION_STATE_INVALID','此聊天的 Codex 会话缺少原生会话记录');
 return value;
}
function ownedRootExited(exit){
 if(!exit||typeof exit!=='object'||exit.failureCode||exit.signal)return false;
 if(exit.launched===false)return exit.treeConfirmed===true&&exit.activeProcesses===0&&exit.rootPid===null&&exit.rootExitCode===null;
 return exit.launched===true&&exit.rootConfirmed===true&&Number.isSafeInteger(exit.rootPid)&&exit.rootPid>0&&Number.isSafeInteger(exit.rootExitCode)&&(exit.cancelled!==true||exit.treeConfirmed===true&&exit.activeProcesses===0);
}
function ownedNeverLaunched(exit){return exit?.launched===false&&exit.treeConfirmed===true&&exit.activeProcesses===0&&exit.rootPid===null&&exit.rootExitCode===null;}
function priorActionExited(file,record){
 let state;try{state=readJson(file,32*1024*1024);}catch{return false;}
 if(state?.version!==2||!Array.isArray(state.started)||!Array.isArray(state.completed))return false;
 const starts=state.started.filter(row=>row?.actionId===record.actionId),ends=state.completed.filter(row=>row?.result?.actionId===record.actionId);if(starts.length!==1||ends.length!==1)return false;
 const start=starts[0],end=ends[0],identity=start.identity,binding=start.resourceBinding,scope=record.scope;
 if(!identity||identity.workspace!==scope.workspace||identity.deviceId!==scope.deviceId||identity.targetDeviceId!==undefined&&identity.targetDeviceId!==scope.deviceId||!exact(end.identity,Object.keys(identity))||Object.keys(identity).some(k=>end.identity[k]!==identity[k])||start.key!==end.key||typeof start.key!=='string'||!start.key.startsWith('conversation:'+scope.conversationId+':')||binding?.type!=='conversation.execute'||binding.employeeId!==scope.employeeId||!['failed','succeeded'].includes(end.result.status)||!Number.isFinite(start.startedAt)||start.startedAt>record.startedAt||!Number.isFinite(end.result.completedAt)||end.result.completedAt<record.startedAt)return false;
 return ownedRootExited(end.result.result?.processExit);
}
function rolloutMetadata(home,relative,threadId,cwd){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\0'))throw fail('CODEX_CONVERSATION_NATIVE_SESSION_MISSING','Codex 原生会话路径无效，未重新执行旧任务');
 const file=path.resolve(home,relative),sessions=path.join(home,'sessions');if(!file.startsWith(sessions+path.sep)||!path.basename(file).endsWith('-'+threadId+'.jsonl'))throw fail('CODEX_CONVERSATION_NATIVE_SESSION_MISSING','Codex 原生会话路径与绑定不一致，未启动新会话');
 noLinks(file);let fd;try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1)throw Error();fd=fs.openSync(file,'r');const buffer=Buffer.alloc(Math.min(1024*1024,stat.size));fs.readSync(fd,buffer,0,buffer.length,0);const line=buffer.toString('utf8').split(/\r?\n/,1)[0],meta=JSON.parse(line);if(meta?.type!=='session_meta'||meta.payload?.id?.toLowerCase()!==threadId||typeof meta.payload.cwd!=='string'||!equalPath(realDirectory(meta.payload.cwd),cwd))throw Error();const created=Date.parse(meta.payload.timestamp||meta.timestamp||'');if(!Number.isFinite(created))throw Error();return{relative,created};}catch(error){if(error.code?.startsWith('CODEX_CONVERSATION_'))throw error;throw fail('CODEX_CONVERSATION_NATIVE_SESSION_MISSING','此聊天绑定的 Codex 原生会话缺失或无法核对；未另建会话、未重跑旧任务');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function findRollout(home,threadId,cwd,startedAt,now){
 const dates=new Set();for(const offset of [-36,-24,-12,0,12,24,36]){const date=new Date(startedAt+offset*3600000);dates.add([date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0')].join(path.sep));}
 const matches=[];for(const date of dates){const directory=path.join(home,'sessions',date);noLinks(directory);let entries;try{entries=fs.readdirSync(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}if(entries.length>10000)throw fail('CODEX_CONVERSATION_LOOKUP_LIMIT','Codex 会话目录超过精确查找上限，未选择其他会话');for(const entry of entries)if(entry.isFile()&&entry.name.endsWith('-'+threadId+'.jsonl'))matches.push(path.relative(home,path.join(directory,entry.name)));}
 if(matches.length!==1)throw fail('CODEX_CONVERSATION_NATIVE_SESSION_MISSING','未找到本次唯一的 Codex 原生会话文件；已保留绑定记录，未重跑旧任务');
 const meta=rolloutMetadata(home,matches[0],threadId,cwd);if(meta.created<startedAt-5000||meta.created>now+5000)throw fail('CODEX_CONVERSATION_THREAD_MISMATCH','Codex 返回的会话不属于本次创建时间，未关联其他员工会话');return meta.relative;
}
function conversationInvocation(invocation,threadId){
 if(!Array.isArray(invocation?.args)||invocation.args[0]!=='exec'||invocation.args.at(-1)!=='-')throw fail('CODEX_CONVERSATION_INVOCATION_INVALID','Codex 会话启动参数不符合非交互协议');
 const profile=[],other=[],args=invocation.args;for(let i=1;i<args.length-1;i++){const arg=args[i];if(arg==='--ephemeral')continue;if(['--profile','-p','--config','-c','--model','-m','--image','-i'].includes(arg)){if(i+1>=args.length-1)throw fail('CODEX_CONVERSATION_INVOCATION_INVALID','Codex 会话参数缺少取值');const pair=[arg,args[++i]];(arg==='--profile'||arg==='-p'?profile:other).push(...pair);}else{if(!['--json','--skip-git-repo-check','--dangerously-bypass-approvals-and-sandbox'].includes(arg))throw fail('CODEX_CONVERSATION_INVOCATION_INVALID','Codex 会话含不支持的启动参数');other.push(arg);}}
 return{...invocation,args:threadId?['exec',...profile,'resume',...other,threadId,'-']:['exec',...profile,...other,'-']};
}

/** Scope concurrency is process-local because the authenticated daemon already
 * owns cross-process execution admission. JSON pending rows are recoverable
 * history, never a daemon/update/stop lock and never an execution authorization. */
function prepareSession({binding,invocation,codexHome,profile='default',cwd,now=Date.now,resumePromptSuffix=''}={}){
 if(binding==null)return null;const host=bindings.get(binding);if(!host)throw fail('CODEX_CONVERSATION_HOST_REQUIRED','持久 Codex 会话缺少受信宿主绑定，未连接原生会话');
 const scope={origin:host.origin,workspace:host.workspace,deviceId:host.deviceId,employeeId:host.employeeId,conversationId:host.conversationId,profile:profile||'default',home:realDirectory(codexHome),cwd:realDirectory(cwd)};
 const key=digest([scope.origin,scope.workspace,scope.deviceId,scope.employeeId,scope.conversationId]),directory=privateDirectory(host.privateDirectory),file=path.join(directory,key+'.json'),reservation=directory+'\0'+key;
 if(activeScopes.has(reservation))throw fail('CODEX_CONVERSATION_BUSY','此员工的这条聊天仍在执行，尚未启动并行的同会话调用');activeScopes.add(reservation);
 let previous=null,current=null,observed=null,streamError=null,buffer='',closed=false,settled=false,spawned=false;
 const release=()=>{if(!closed){closed=true;activeScopes.delete(reservation);}};
 try{
  try{previous=validateRecord(readJson(file),key,scope);}catch(error){if(error.code!=='ENOENT'){if(error.code?.startsWith('CODEX_CONVERSATION_'))throw error;throw fail('CODEX_CONVERSATION_STATE_INVALID','此聊天的 Codex 会话映射无法读取，未修改原记录');}}
  if(previous&&previous.state!=='ready'){
   if(!priorActionExited(host.stateFile,previous))throw fail('CODEX_CONVERSATION_PREVIOUS_UNCONFIRMED','此聊天上次 Codex 执行尚无匹配退出证据；仅暂停此会话，未重放旧任务');
   if(!previous.threadId)throw fail('CODEX_CONVERSATION_THREAD_UNCONFIRMED','上次 Codex 执行已退出，但没有原生 thread.started 回执；未猜测或新建会话');
   const rollout=previous.rollout||findRollout(scope.home,previous.threadId,scope.cwd,previous.startedAt,now());rolloutMetadata(scope.home,rollout,previous.threadId,scope.cwd);previous={...previous,state:'ready',rollout,updatedAt:now()};writeJson(file,previous);
  }
  if(previous)rolloutMetadata(scope.home,previous.rollout,previous.threadId,scope.cwd);
  const selectedInvocation=conversationInvocation(invocation,previous?.threadId);
  if(previous&&host.currentPrompt!==null){if(typeof resumePromptSuffix!=='string'||resumePromptSuffix.length>1024*1024)throw fail('CODEX_CONVERSATION_INPUT_INVALID','Codex 本次图片指令无效，未恢复会话');selectedInvocation.stdin=host.currentPrompt+resumePromptSuffix;}
  current={schemaVersion:1,key,scope,state:'pending',threadId:previous?.threadId||null,rollout:previous?.rollout||null,actionId:host.actionId,attemptId:randomUUID(),startedAt:now(),updatedAt:now()};writeJson(file,current);
  const receipt=status=>({schemaVersion:1,kind:'codex.conversation',scopeKey:key,threadId:current.threadId,method:previous?'codex.exec.resume':'codex.exec',status,durable:status==='bound',actionId:host.actionId});
  const save=()=>{current.updatedAt=now();writeJson(file,current);};
  const observe=line=>{let event;try{event=JSON.parse(line);}catch{return;}if(event?.type!=='thread.started')return;const candidate=event.thread_id;if(typeof candidate!=='string'||!UUID.test(candidate)){streamError='CODEX_CONVERSATION_THREAD_INVALID';return;}const threadId=candidate.toLowerCase();if(observed&&observed!==threadId||previous&&previous.threadId!==threadId){streamError='CODEX_CONVERSATION_THREAD_MISMATCH';return;}observed=threadId;if(!previous&&current.threadId!==threadId){current.threadId=threadId;try{save();}catch{streamError='CODEX_CONVERSATION_WRITE_FAILED';}}};
  return{
   invocation:selectedInvocation,key,
   markSpawned(){spawned=true;},
   observeStdout(chunk){if(settled)return;buffer+=String(chunk||'');if(buffer.length>1024*1024){streamError='CODEX_CONVERSATION_STREAM_LIMIT';buffer='';return;}const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines)observe(line);},
   complete({processExit,code,signal}={}){
    if(settled)return receipt(current.state==='ready'?'bound':'unconfirmed');if(buffer){observe(buffer);buffer='';}
    if(ownedNeverLaunched(processExit)){this.notLaunched();return previous?{...receipt('not_started'),threadId:previous.threadId,durable:true}:receipt('not_started');}
    if(!ownedRootExited(processExit)||signal||streamError||!observed){current.state='unconfirmed';save();settled=true;throw fail(streamError||(!ownedRootExited(processExit)?'CODEX_CONVERSATION_EXIT_UNCONFIRMED':'CODEX_CONVERSATION_THREAD_UNCONFIRMED'),'Codex 原生会话或退出回执无法核对，未关联其他会话、未重跑旧任务');}
    current.rollout=previous?.rollout||findRollout(scope.home,observed,scope.cwd,current.startedAt,now());rolloutMetadata(scope.home,current.rollout,observed,scope.cwd);current.threadId=observed;current.state='ready';save();settled=true;return receipt('bound');
   },
   notLaunched(){if(settled)return;if(previous)writeJson(file,previous);else{noLinks(file);fs.unlinkSync(file);}settled=true;},
   close(){try{if(!settled){if(!spawned)this.notLaunched();else{current.state='unconfirmed';save();settled=true;}}}finally{release();}},
  };
 }catch(error){release();throw error;}
}
export function prepareCodexConversationSession(options={}){
 const host=bindings.get(options.binding);
 try{return prepareSession(options);}catch(error){throw host?markCodexConversationPrelaunchFailure(error,host):error;}
}
