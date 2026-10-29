import {EventEmitter} from 'node:events';

// Native 0.2.1 HTTP envelopes and remote.mux frames verified against the
// installed session controller. The transport stays in memory: no listening
// sockets, resident runtime, model calls or machine credentials are required.
export async function dshFixture(t,{hold=false,initialRecords=[],onPrompt,onFollow,failBots=[],routes,manualPrompt=false,cancelAckOnly=false}={}) {
  const calls=[],sessions=new Map(),connections=[];let sessionCounter=0;
  const ensure=id=>{if(!sessions.has(id))sessions.set(id,{records:[...initialRecords],turn:1,clients:new Set()});return sessions.get(id);};
  const value=(ws,item)=>ws.deliver({type:'item',streamId:ws.followId,value:item});
  const event=(id,type,data)=>{const s=ensure(id),record={type:'event',event:{type,seq:s.records.length+1,time:Date.now(),data}};s.records.push(record);for(const ws of s.clients)if(ws.readyState===1)value(ws,record);return record;};
  const transient=(id,frame)=>{for(const ws of ensure(id).clients)if(ws.readyState===1)value(ws,{type:'assistant-stream',frame});};
  const begin=request=>{const id=request.sessionId,s=ensure(id),turn=++s.turn;event(id,'turn/start',{turn});event(id,'user/message',{content:request.content,source:{kind:'user',rpcId:request.requestId}});return turn;};
  const complete=(request,{reply='DSH 完成',reason={kind:'completed'}}={})=>{const id=request.sessionId,turn=ensure(id).turn;event(id,'assistant/message',{turn,step:0,message:{role:'assistant',content:[{type:'text',text:reply}]}});event(id,'turn/end',{turn,reason});};
  const fetchImpl=async(url,options={})=>{
    options.signal?.throwIfAborted();
    const pathname=new URL(url).pathname,body=JSON.parse(options.body||'{}'),match=pathname.match(/^\/runtime\/([^/]+)\/api\/(.+)$/),bot=match?decodeURIComponent(match[1]):null;
    const reply=(payload,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(payload)});
    let routed;const routeReply=(payload,status)=>{routed=reply(payload,status);};
    if(routes?.({url:pathname,method:options.method||'GET'},body,routeReply))return routed;
    calls.push({path:pathname,bot,...body});
    if(!match||match[2]!==body.method||options.method!=='POST')return reply({error:'native endpoint path required'},404);
    if(failBots.includes(bot))return reply({type:'server-response',rpcId:body.rpcId,result:{ok:false,error:{code:'session/unavailable',message:`${bot} unavailable`}}});
    const request=body.payload.args.request;let result={accepted:true};
    if(body.method==='session/create'){const id=`${bot}-session-${++sessionCounter}`;ensure(id);result={sessionId:id};}
    if(body.method==='session/list')result={items:[{sessionId:'dsh-session-1',running:false}]};
    if(body.method==='session/prompt')setImmediate(()=>{
      const turn=manualPrompt?ensure(request.sessionId).turn:begin(request);
      if(onPrompt)return onPrompt({request,bot,turn,begin,event,transient,complete,sessions,connections});
      if(hold)return;
      transient(request.sessionId,{type:'start',revision:1,attemptId:1,turn,step:0});
      transient(request.sessionId,{type:'chunk',revision:2,attemptId:1,index:0,chunk:{type:'reasoning-delta',index:0,text:'先读取状态'}});
      event(request.sessionId,'tool/call',{turn,step:0,callId:'read-1',name:'read',arguments:'{}'});
      event(request.sessionId,'tool/result',{turn,step:0,message:{content:[{type:'tool-result',toolCallId:'read-1',content:[{type:'text',text:'读取完成'}]}]}});
      transient(request.sessionId,{type:'chunk',revision:3,attemptId:1,index:1,chunk:{type:'text-delta',index:1,text:'DSH '}});
      transient(request.sessionId,{type:'chunk',revision:4,attemptId:1,index:2,chunk:{type:'text-delta',index:1,text:'完成'}});
      complete(request);
    });
    if(body.method==='session/cancel'&&!cancelAckOnly)setImmediate(()=>event(request.sessionId,'turn/end',{turn:ensure(request.sessionId).turn,reason:{kind:'aborted',reason:{kind:'user'}}}));
    return reply({type:'server-response',rpcId:body.rpcId,result:{ok:true,value:result}});
  };
  class MemorySocket extends EventEmitter {
    constructor(url){super();this.bot=decodeURIComponent(new URL(url).pathname.split('/')[2]);this.readyState=0;connections.push(this);setImmediate(()=>{if(this.readyState===3)return;this.readyState=1;this.emit('open');});}
    deliver(frame){if(this.readyState===1)this.emit('message',JSON.stringify(frame));}
    send(raw){const frame=JSON.parse(String(raw));if(frame.type!=='open')return;
      if(frame.endpoint==='$events'){this.eventsId=frame.streamId;return this.deliver({type:'item',streamId:frame.streamId,value:{type:'ready',clientId:'fixture-client'}});}
      if(frame.endpoint!=='session/follow')return;
      this.followId=frame.streamId;this.sessionId=frame.payload.args.request.address.sessionId;const session=ensure(this.sessionId);session.clients.add(this);this.once('close',()=>session.clients.delete(this));
      value(this,{type:'snapshot',records:structuredClone(session.records),hasMore:false,assistantStream:{revision:0}});
      onFollow?.({ws:this,session,sessions,connections,value,event,transient});
    }
    close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
    terminate(){this.close();}
  }
  t.after(()=>connections.forEach(ws=>ws.close()));
  return {baseUrl:'http://dsh-fixture.invalid',transport:{fetchImpl,WebSocketImpl:MemorySocket},calls,sessions,connections,event,transient,complete};
}
