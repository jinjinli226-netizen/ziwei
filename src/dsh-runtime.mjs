import WebSocket from 'ws';
import { redactSecrets } from './redaction.mjs';
import {createDshSessionEvidence} from './dsh-session-evidence.mjs';

const errorText = value => typeof value === 'string' ? value : value?.message || JSON.stringify(value || '未知错误');
const contentText = content => typeof content === 'string' ? content : (content || []).filter(block => block.type === 'text').map(block => block.text).join('');

async function rpc(baseUrl, botName, method, args, signal, fetchImpl=globalThis.fetch) {
  const url=`${baseUrl.replace(/\/$/,'')}/runtime/${encodeURIComponent(botName)}/api/${method}`;
  const rpcId=crypto.randomUUID();
  const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args}}),signal});
  const body=await response.json().catch(()=>({}));
  if(!response.ok || body.result?.ok === false) throw new Error(errorText(body.result?.error || body.error || `DSH ${method} HTTP ${response.status}`));
  if(body.type !== 'server-response' || body.rpcId !== rpcId || !body.result) throw new Error(`DSH ${method} returned an invalid RPC response`);
  return body.result.value;
}

export function listDshSessions({baseUrl='http://127.0.0.1:7879',botName,signal,fetchImpl=globalThis.fetch}={}) {
  if(!botName) return Promise.reject(new Error('DSH runtime requires botName'));
  return rpc(baseUrl,botName,'session/list',{_request:{}},signal,fetchImpl);
}

export function cancelDshSession({baseUrl='http://127.0.0.1:7879',botName,sessionId,signal,fetchImpl=globalThis.fetch}={}) {
  if(!botName || !sessionId) return Promise.reject(new Error('DSH session cancellation requires botName and sessionId'));
  return rpc(baseUrl,botName,'session/cancel',{request:{sessionId}},signal,fetchImpl);
}

export async function executeDshRuntime({baseUrl='http://127.0.0.1:7879',botName,prompt,cwd=process.cwd(),sessionId=null,signal,onOutput,onStage,sessionAuthority={},onSessionSupervision,cancellationTimeoutMs=3000,fetchImpl=globalThis.fetch,WebSocketImpl=WebSocket}={}) {
  if(!botName) throw new Error('DSH runtime requires botName');
  const session=sessionId || (await rpc(baseUrl,botName,'session/create',{request:{cwd}},signal,fetchImpl))?.sessionId;
  if(!session) throw new Error('DSH session/create did not return sessionId');
  const requestId=crypto.randomUUID();
  return new Promise(resolve=>{
    let socket,followId,eventsId,retryTimer,cancelTimer,terminalExit,settled=false,cancelling=false,cancelSent=false,promptSent=false,retries=0,currentTurn=null,targetTurn=null;
    const evidence=createDshSessionEvidence({...sessionAuthority,botName,sessionId:session,requestId},()=>cancel());
    const seen=new Set(); const messages=new Map(); const liveText=new Map(); const attempts=new Map();
    const output=()=>[...new Map([...liveText,...messages]).values()].filter(Boolean).join('\n\n');
    const stage=(value)=>onStage?.({...value,sessionId:session});
    const finish=value=>{
      if(settled)return;settled=true;clearTimeout(retryTimer);clearTimeout(cancelTimer);signal?.removeEventListener('abort',cancel);
      try{socket?.close();}catch{}
      const uncertain=promptSent&&!terminalExit?{status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain'}:{};
      resolve({...value,...uncertain,output:output(),sessionId:session,...(terminalExit?{sessionExit:terminalExit}:{})});
    };
    const sendCancellation=async()=>{
      if(cancelSent||settled||targetTurn===null)return;cancelSent=true;
      try{await cancelDshSession({baseUrl,botName,sessionId:session,signal:AbortSignal.timeout(3000),fetchImpl});}catch{}
    };
    const cancel=async()=>{
      if(cancelling || settled)return;cancelling=true;
      cancelTimer=setTimeout(()=>finish({status:'failed',code:'EXECUTION_UNCERTAIN',executionState:'uncertain',error:'DSH 已请求取消当前任务，但 turn 终态未确认'}),cancellationTimeoutMs);
      await sendCancellation();
    };
    const publish=(key,text)=>{
      const before=liveText.get(key)||'';liveText.set(key,text);
      if(text.startsWith(before)){const delta=text.slice(before.length);if(delta)onOutput?.(delta);}
      else stage({stage:'response',message:'DSH 回答已更新',summary:redactSecrets(text).slice(0,4000)});
    };
    const acceptChunk=(attempt,chunk,publishNow=true)=>{
      if(chunk.type==='text-delta') { attempt.text+=chunk.text; if(publishNow)publish(`${attempt.turn}:${attempt.step}`,attempt.text); }
      else if(chunk.type==='reasoning-delta')stage({stage:'reasoning',summary:redactSecrets(chunk.text).slice(0,4000)});
      else if(chunk.type==='tool-call-delta' && chunk.name)stage({stage:'tool',detail:chunk.name,message:'DSH 工具调用参数更新'});
    };
    const acceptAssistant=frame=>{
      if(settled)return;
      if(frame.type==='start') { if(frame.turn===targetTurn)attempts.set(frame.attemptId,{turn:frame.turn,step:frame.step,nextIndex:0,text:''});return; }
      const attempt=attempts.get(frame.attemptId);if(!attempt)return;
      if(frame.type==='chunk') {
        if(frame.index<attempt.nextIndex)return;
        if(frame.index>attempt.nextIndex){socket.close();return;}
        attempt.nextIndex++;acceptChunk(attempt,frame.chunk);
      }
      if(frame.type==='end' && frame.outcome?.kind==='abandoned')attempts.delete(frame.attemptId);
    };
    const acceptRecord=(record,baseline=false)=>{
      if(settled)return;
      const event=record.event;if(!event || seen.has(event.seq))return;seen.add(event.seq);
      const data=event.data||{};
      if(event.type==='turn/start')currentTurn=data.turn;
      if(baseline)return;
      // The request echo identifies the queued turn; an older running turn in
      // the resumed Session must not complete this newly submitted action.
      if(event.type==='user/message' && data.source?.rpcId===requestId) {targetTurn=currentTurn;evidence.acceptRequest(targetTurn);stage({stage:'progress',message:'DSH 正在执行',detail:`Bot ${botName}`});if(cancelling)void sendCancellation();}
      if(targetTurn===null || (data.turn!==undefined && data.turn!==targetTurn))return;
      const key=`${data.turn}:${data.step}`;
      if(event.surfaceOp && event.surfaceOp!=='append')return;
      if(record.type==='chunks') {
        if(event.type==='chunkrow/text-chunks')publish(key,(liveText.get(key)||'')+(data.texts||[]).join(''));
        if(event.type==='chunkrow/reasoning-chunks')stage({stage:'reasoning',summary:redactSecrets((data.texts||[]).join('')).slice(0,4000)});
      }
      if(event.type==='assistant/message') {const text=contentText(data.message?.content);messages.set(key,text);publish(key,text);}
      if(event.type==='assistant/chunk') {
        const attempt={turn:data.turn,step:data.step,text:liveText.get(key)||''};acceptChunk(attempt,data.chunk);
      }
      if(event.type==='tool/call')stage({stage:/pwsh|shell|command|terminal/.test(data.name)?'command':'tool',message:'DSH 工具开始',detail:data.name,callId:data.callId,status:'running'});
      if(event.type==='tool/result')for(const block of data.message?.content||[])if(block.type==='tool-result')stage({stage:'tool',message:block.isError || data.error?'DSH 工具失败':'DSH 工具完成',detail:data.message?.source?.toolName || block.toolCallId,callId:block.toolCallId,status:block.isError || data.error?'failed':'completed'});
      if(event.type==='turn/end') {
        const reason=data.reason||{};
        terminalExit=evidence.finishTurn(data.turn,reason.kind);
        if(!terminalExit)return;
        if(reason.kind==='completed')finish({status:'succeeded'});
        else if(reason.kind==='aborted')finish({status:'failed',code:'cancelled',error:'DSH execution cancelled'});
        else finish({status:'failed',code:reason.kind==='max-tokens'?'max_tokens':'turn_failed',error:reason.kind==='max-tokens'?'DSH reached its token limit':errorText(reason.error || reason)});
      }
    };
    const restoreAttempt=active=>{
      if(!active || active.turn!==targetTurn)return;
      const attempt={turn:active.turn,step:active.step,nextIndex:active.nextIndex,text:''};attempts.set(active.attemptId,attempt);
      for(const record of active.stream||[]) {
        if(record.type==='chunk')acceptChunk(attempt,record.chunk,false);
        else if(record.type==='text-chunks')for(const text of record.texts||[])acceptChunk(attempt,{type:'text-delta',text},false);
        else if(record.type==='reasoning-chunks')for(const text of record.texts||[])acceptChunk(attempt,{type:'reasoning-delta',text},false);
      }
      publish(`${attempt.turn}:${attempt.step}`,attempt.text);
    };
    const submit=()=>{
      if(promptSent || settled || cancelling)return;promptSent=true;
      void rpc(baseUrl,botName,'session/prompt',{request:{requestId,sessionId:session,mode:'queue',content:[{type:'text',text:String(prompt||'')}],clientTimeZone:'Asia/Shanghai'}},signal,fetchImpl).catch(error=>{
        if(!signal?.aborted)finish({status:'failed',code:'prompt_failed',error:error.message});
      });
    };
    const connect=()=>{
      if(settled)return;
      const activeSocket=new WebSocketImpl(`${baseUrl.replace(/^http/,'ws').replace(/\/$/,'')}/runtime/${encodeURIComponent(botName)}/api/remote.mux`);
      socket=activeSocket;followId=crypto.randomUUID();eventsId=crypto.randomUUID();
      const thisFollowId=followId;const thisEventsId=eventsId;
      activeSocket.on('open',()=>{
        activeSocket.send(JSON.stringify({type:'open',streamId:thisFollowId,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId:session},assistantStream:true,maxMessages:100}}}}));
        activeSocket.send(JSON.stringify({type:'open',streamId:thisEventsId,endpoint:'$events',payload:{args:{}}}));
      });
      activeSocket.on('message',raw=>{
        if(settled || socket!==activeSocket)return;
        let frame;try{frame=JSON.parse(String(raw));}catch{finish({status:'failed',code:'invalid_frame',error:'DSH returned invalid stream JSON'});return;}
        if(frame.type==='item' && (!frame.value || typeof frame.value!=='object')) {finish({status:'failed',code:'invalid_frame',error:'DSH stream item is missing its native value'});return;}
        if(frame.streamId===thisEventsId && frame.type==='item') {
          const value=frame.value;
          if(value.type==='waterfall' && value.event==='approval/request' && value.agentId===session)stage({stage:'approval',message:'DSH 等待审批',detail:value.request?.toolName || '工具审批',requestId:value.eventId});
          if(value.type==='emit' && value.event==='api-session/error' && value.args?.[0]===session && targetTurn!==null)finish({status:'failed',code:'session_error',error:errorText(value.args[1])});
          return;
        }
        if(frame.streamId!==thisFollowId)return;
        if(frame.type==='error'){finish({status:'failed',code:'stream_error',error:errorText(frame.error)});return;}
        if(frame.type==='end'){activeSocket.close();return;}
        if(frame.type!=='item')return;
        const value=frame.value;
        if(value.type==='snapshot') {
          const baseline=!promptSent;
          for(const record of value.records||[])acceptRecord(record,baseline);
          restoreAttempt(value.assistantStream?.activeAttempt);
          submit();
        } else if(value.type==='event' || value.type==='chunks')acceptRecord(value);
        else if(value.type==='assistant-stream')acceptAssistant(value.frame);
      });
      activeSocket.on('error',()=>{});
      activeSocket.on('close',()=>{
        if(settled || socket!==activeSocket)return;
        if(retries>=3){finish({status:'failed',code:'stream_closed',error:'DSH 实时订阅连接中断，未收到当前 turn/end'});return;}
        stage({stage:'progress',message:'DSH 正在恢复实时订阅',detail:`Bot ${botName} · session ${session}`});
        retryTimer=setTimeout(connect,200*2**retries++);
      });
    };
    onSessionSupervision?.(evidence.capability);
    if(signal?.aborted){void cancel();return;}
    signal?.addEventListener('abort',cancel,{once:true});connect();
  });
}
