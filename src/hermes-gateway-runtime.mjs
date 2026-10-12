import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {nativeSpawn,appendNativeLifecycle} from './hermes-native-runtime.mjs';
import {spawnSupervisedRuntime} from './runtime-process.mjs';

/** Owned adapters, no GatewayRunner, cron, native agent or arbitrary PID control. */
export function createBotGatewayManager({apiBase,workspace,deviceToken}={}) {
  const workers=new Map();
  const api=async(method,url,body)=>{
    const response=await fetch(`${apiBase.replace(/\/$/,'')}${url}`,{method,headers:{'content-type':'application/json','x-ziwei-device-token':deviceToken},...(body?{body:JSON.stringify({...body,workspace})}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});
    const result=await response.json();if(!response.ok)throw new Error(result.code || `GATEWAY_API_${response.status}`);return result;
  };
  const keyFor=(context,platform)=>`${context.employeeId}:${platform}`;
  const command=(worker,input)=>new Promise(resolve=>{
    const commandId=randomUUID();const timer=setTimeout(()=>{worker.commands.delete(commandId);resolve({success:false,code:'EXECUTION_UNCERTAIN'});},35000);
    worker.commands.set(commandId,result=>{clearTimeout(timer);resolve(result);});worker.child.stdin.write(JSON.stringify({...input,commandId})+'\n');
  });
  const receive=async(worker,event)=>{
    const messageKey=JSON.stringify([String(event.chatId),event.messageId]);
    if(worker.inFlight.has(messageKey))return;
    worker.inFlight.add(messageKey);
    try {
      const received=await api('POST',`/a2a/v1/actions/${worker.actionId}/bot-gateway-ingress`,{platform:worker.platform,chatId:String(event.chatId),messageId:event.messageId,content:event.content});
      let delivery=received.delivery;
      while(delivery.status==='queued'&&!worker.closed){await new Promise(resolve=>setTimeout(resolve,500));delivery=await api('GET',`/a2a/v1/actions/${worker.actionId}/bot-gateway-deliveries/${encodeURIComponent(delivery.id)}?workspace=${encodeURIComponent(workspace)}`);}
      if(!delivery.action){appendNativeLifecycle(worker.home,{event:'gateway.inbound.requires_authorization',deliveryId:delivery.id});return;}
      const action=delivery.action;
      appendNativeLifecycle(worker.home,{event:'gateway.inbound.accepted',actionId:action.id,messageId:event.messageId});
      // The source delivery ID has durable server dedupe. Read only the one
      // original action; a timeout never dispatches a second execution.
      const deadline=Date.now()+840000;
      while(Date.now()<deadline && !worker.closed){
        const current=await api('GET',`/a2a/v1/actions/${action.id}?workspace=${encodeURIComponent(workspace)}`);
        if(['succeeded','failed','expired'].includes(current.status)){
          if(current.status==='succeeded'){
            const content=current.result?.output || current.result?.result?.output || current.result?.text;
            if(content){await api('POST',`/a2a/v1/actions/${worker.actionId}/bot-gateway-lease`,{});const result=await command(worker,{operation:'send',chatId:event.chatId,content,replyTo:event.messageId,messageId:event.messageId});appendNativeLifecycle(worker.home,{event:'gateway.inbound.delivery',actionId:action.id,success:result.success,code:result.code || null});}
          }
          return;
        }
        await new Promise(resolve=>{const timer=setTimeout(resolve,1000);timer.unref?.();});
      }
      appendNativeLifecycle(worker.home,{event:'gateway.inbound.unresolved',actionId:action.id,code:'EXECUTION_UNCERTAIN'});
    }catch(error){appendNativeLifecycle(worker.home,{event:'gateway.inbound.rejected',code:String(error.message).slice(0,100)});}
    finally{worker.inFlight.delete(messageKey);}
  };
  return {
    status(context){return[...workers.values()].filter(worker=>worker.context.employeeId===context.employeeId).map(worker=>({platform:worker.platform,status:worker.closed?'disconnected':'connected',sourceActionId:worker.actionId,revision:worker.context.revision,controlEpoch:worker.context.controlEpoch,pid:worker.child.pid || null}));},
    async operate(action,options){
      await options.beforeSpawn?.();
      const context=options.context,{operation,input}=options.operation,platform=input.platform,key=keyFor(context,platform);
      let worker=workers.get(key);
      if(operation==='connect'){
        if(worker&&!worker.closed){if(worker.actionId===action.id)return{connected:true,duplicate:true,sourceActionId:action.id};throw new Error('该 Bot 平台已有受监管连接；先断开并核对回执');}
        await options.beforeSpawn?.();
        const spec=nativeSpawn({...options,worker:true}),supervision=spawnSupervisedRuntime(spec);
        worker={context,platform,actionId:action.id,home:spec.prepared.home,...supervision,closed:false,commands:new Map(),inFlight:new Set(),line:'',leaseBusy:false};workers.set(key,worker);
        appendNativeLifecycle(worker.home,{event:'gateway.starting',sourceActionId:action.id,revision:context.revision,controlEpoch:context.controlEpoch});
        let resolveReady;const ready=new Promise(resolve=>{resolveReady=resolve;});
        worker.child.on('error',()=>resolveReady({connected:false,code:'GATEWAY_SPAWN_FAILED'}));
        worker.child.stderr.on('data',()=>{});
        worker.child.stdout.on('data',chunk=>{
          worker.line+=String(chunk);if(worker.line.length>1024*1024){void worker.stop();return;}const lines=worker.line.split(/\r?\n/);worker.line=lines.pop() || '';
          for(const line of lines)if(line.startsWith('ZIWEI_GATEWAY_EVENT:')){let event;try{event=JSON.parse(line.slice('ZIWEI_GATEWAY_EVENT:'.length));}catch{continue;}
            if(event.event==='connected'){appendNativeLifecycle(worker.home,{event:'gateway.connected',pid:event.pid,sourceActionId:action.id});resolveReady({connected:true,pid:event.pid,nativeVersion:event.nativeVersion,sourceActionId:action.id});}
            else if(event.event==='failed')resolveReady({connected:false,code:event.code});
            else if(event.event==='heartbeat')appendNativeLifecycle(worker.home,{event:'gateway.heartbeat',pid:event.pid});
            else if(event.event==='inbound')void receive(worker,event);
            else if(event.event==='command_result'){worker.commands.get(event.commandId)?.(event);worker.commands.delete(event.commandId);}
          }
        });
        worker.child.stdin.write(JSON.stringify({...options.operation,actionId:action.id,context})+'\n');
        const lease=setInterval(async()=>{if(worker.leaseBusy||worker.closed)return;worker.leaseBusy=true;try{await api('POST',`/a2a/v1/actions/${action.id}/bot-gateway-lease`,{});appendNativeLifecycle(worker.home,{event:'gateway.supervisor.health',pid:worker.child.pid || null});}catch{worker.child.stdin.end(JSON.stringify({operation:'disconnect'})+'\n');setTimeout(()=>{if(!worker.closed)void worker.stop();},12000).unref?.();}finally{worker.leaseBusy=false;}},10000);lease.unref?.();
        void worker.completionEvidence.then(evidence=>{worker.closed=true;clearInterval(lease);spec.cleanup();appendNativeLifecycle(worker.home,{event:'gateway.exit',processExit:evidence});for(const resolve of worker.commands.values())resolve({success:false,code:'EXECUTION_UNCERTAIN'});worker.commands.clear();resolveReady({connected:false,code:'GATEWAY_EXITED_BEFORE_READY',processExit:evidence});});
        const timeout=setTimeout(()=>resolveReady({connected:false,code:'GATEWAY_CONNECT_TIMEOUT'}),50000);const result=await ready;clearTimeout(timeout);
        if(!result.connected){await worker.stop();const evidence=await worker.completionEvidence;if(process.platform==='win32'&&!evidence.treeConfirmed)return{...result,success:false,code:'EXECUTION_UNCERTAIN',processExit:evidence};}return result;
      }
      if(operation==='disconnect'){
        if(!worker||worker.closed)return{connected:false,stopConfirmed:true,alreadyDisconnected:true};
        worker.child.stdin.end(JSON.stringify({operation:'disconnect'})+'\n');const timer=setTimeout(()=>void worker.stop(),12000);const evidence=await worker.completionEvidence;clearTimeout(timer);
        const stopConfirmed=process.platform!=='win32'||evidence.treeConfirmed;
        return{connected:false,stopConfirmed,...(!stopConfirmed?{success:false,code:'EXECUTION_UNCERTAIN'}:{}),processExit:evidence};
      }
      if(!worker||worker.closed||worker.context.revision!==context.revision||worker.context.controlEpoch!==context.controlEpoch)throw new Error('当前 Bot 版本没有已连接 Gateway');
      await options.beforeSpawn?.();await api('POST',`/a2a/v1/actions/${worker.actionId}/bot-gateway-lease`,{});
      return command(worker,{operation:operation==='outbound'?'send':'inbound',...input});
    },
    async close(){await Promise.all([...workers.values()].filter(worker=>!worker.closed).map(worker=>worker.stop()));},
  };
}
