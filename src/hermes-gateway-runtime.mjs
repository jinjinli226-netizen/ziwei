import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {nativeSpawn,appendNativeLifecycle} from './hermes-native-runtime.mjs';
import {spawnSupervisedRuntime} from './runtime-process.mjs';

/** Owned adapters, no GatewayRunner, cron, native agent or arbitrary PID control. */
export function createBotGatewayManager({apiBase,workspace,deviceToken}={},dependencies={}) {
  const prepare=dependencies.nativeSpawn || nativeSpawn,spawn=dependencies.spawnSupervisedRuntime || spawnSupervisedRuntime;
  const workers=new Map();
  const api=async(method,url,body)=>{
    const response=await fetch(`${apiBase.replace(/\/$/,'')}${url}`,{method,headers:{'content-type':'application/json','x-ziwei-device-token':deviceToken},...(body?{body:JSON.stringify({...body,workspace})}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});
    const result=await response.json();if(!response.ok)throw new Error(result.code || `GATEWAY_API_${response.status}`);return result;
  };
  const keyFor=(context,platform)=>`${context.employeeId}:${platform}`;
  const accepting=worker=>!worker.closed&&!worker.stopping&&worker.status==='connected';
  const closeAdmission=worker=>{worker.stopping=true;if(worker.status!=='failed')worker.status='disconnected';};
  const command=(worker,input)=>new Promise(resolve=>{
    if(!accepting(worker)){resolve({success:false,code:'GATEWAY_NOT_CONNECTED'});return;}
    const commandId=randomUUID();const timer=setTimeout(()=>{worker.commands.delete(commandId);resolve({success:false,code:'EXECUTION_UNCERTAIN'});},35000);
    worker.commands.set(commandId,result=>{clearTimeout(timer);resolve(result);});worker.child.stdin.write(JSON.stringify({...input,commandId})+'\n');
  });
  const receive=async(worker,event)=>{
    if(!accepting(worker))return;
    const messageKey=JSON.stringify([String(event.chatId),event.messageId]);
    if(worker.inFlight.has(messageKey)){worker.pendingInbound.set(messageKey,event);return;}
    worker.inFlight.add(messageKey);
    try {
      const received=await api('POST',`/a2a/v1/actions/${worker.actionId}/bot-gateway-ingress`,{platform:worker.platform,chatId:String(event.chatId),messageId:event.messageId,content:event.content});
      let delivery=received.delivery;
      while(delivery.status==='queued'&&accepting(worker)){await new Promise(resolve=>setTimeout(resolve,500));if(!accepting(worker))return;delivery=await api('GET',`/a2a/v1/actions/${worker.actionId}/bot-gateway-deliveries/${encodeURIComponent(delivery.id)}?workspace=${encodeURIComponent(workspace)}`);}
      if(!accepting(worker))return;
      if(!delivery.action){appendNativeLifecycle(worker.home,{event:'gateway.inbound.requires_authorization',deliveryId:delivery.id});return;}
      const action=delivery.action;
      appendNativeLifecycle(worker.home,{event:'gateway.inbound.accepted',actionId:action.id,messageId:event.messageId});
      // The source delivery ID has durable server dedupe. Read only the one
      // original action; a timeout never dispatches a second execution.
      const deadline=Date.now()+840000;
      while(Date.now()<deadline && accepting(worker)){
        const current=await api('GET',`/a2a/v1/actions/${action.id}?workspace=${encodeURIComponent(workspace)}`);
        if(!accepting(worker))return;
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
    finally{worker.inFlight.delete(messageKey);const pending=worker.pendingInbound.get(messageKey);worker.pendingInbound.delete(messageKey);if(pending&&accepting(worker))queueMicrotask(()=>void receive(worker,pending));}
  };
  return {
    status(context){return[...workers.values()].filter(worker=>worker.context.employeeId===context.employeeId).map(worker=>({platform:worker.platform,status:worker.status,code:worker.code || null,processAlive:worker.closed?(process.platform!=='win32'||worker.processExit?.treeConfirmed===true?false:null):true,processExit:worker.processExit || null,sourceActionId:worker.actionId,revision:worker.context.revision,controlEpoch:worker.context.controlEpoch,pid:worker.child.pid || null}));},
    async operate(action,options){
      await options.beforeSpawn?.();
      const context=options.context,{operation,input}=options.operation,platform=input.platform,key=keyFor(context,platform);
      let worker=workers.get(key);
      if(operation==='connect'){
        if(worker?.closed&&process.platform==='win32'&&worker.processExit?.treeConfirmed!==true)return{connected:false,success:false,code:'EXECUTION_UNCERTAIN',processExit:worker.processExit};
        if(worker&&!worker.closed){if(worker.actionId===action.id)return{connected:accepting(worker),status:worker.status,code:worker.code,duplicate:true,sourceActionId:action.id};throw new Error('该 Bot 平台已有受监管连接；先断开并核对回执');}
        await options.beforeSpawn?.();
        const spec=prepare({...options,worker:true}),supervision=spawn(spec);
        worker={context,platform,actionId:action.id,home:spec.prepared.home,...supervision,closed:false,status:'starting',code:null,commands:new Map(),inFlight:new Set(),pendingInbound:new Map(),line:'',leaseBusy:false};workers.set(key,worker);
        appendNativeLifecycle(worker.home,{event:'gateway.starting',sourceActionId:action.id,revision:context.revision,controlEpoch:context.controlEpoch});
        let resolveReady;const ready=new Promise(resolve=>{resolveReady=resolve;});
        worker.child.on('error',()=>resolveReady({connected:false,code:'GATEWAY_SPAWN_FAILED'}));
        worker.child.stderr.on('data',()=>{});
        worker.child.stdout.on('data',chunk=>{
          worker.line+=String(chunk);if(worker.line.length>1024*1024){closeAdmission(worker);void worker.stop();return;}const lines=worker.line.split(/\r?\n/);worker.line=lines.pop() || '';
          for(const line of lines)if(line.startsWith('ZIWEI_GATEWAY_EVENT:')){let event;try{event=JSON.parse(line.slice('ZIWEI_GATEWAY_EVENT:'.length));}catch{continue;}
            if(['connected','failed','status','heartbeat','disconnected'].includes(event.event)){
              const status=event.status || (['connected','failed','disconnected'].includes(event.event)?event.event:null);
              if(!worker.closed&&worker.status!=='failed'&&(!worker.stopping||status==='failed')&&['connected','retrying','failed','disconnected'].includes(status)){worker.status=status;worker.code=/^[A-Za-z0-9_-]{1,100}$/.test(event.code || '')?event.code:null;}
              appendNativeLifecycle(worker.home,{event:'gateway.channel',status:worker.status,code:worker.code,pid:worker.child.pid || null});
            }
            if(event.event==='connected'&&accepting(worker)){appendNativeLifecycle(worker.home,{event:'gateway.connected',pid:event.pid,sourceActionId:action.id});resolveReady({connected:true,pid:event.pid,nativeVersion:event.nativeVersion,sourceActionId:action.id});}
            else if(event.event==='failed')resolveReady({connected:false,code:event.code});
            else if(event.event==='heartbeat')appendNativeLifecycle(worker.home,{event:'gateway.heartbeat',pid:event.pid,status:worker.status,code:worker.code});
            else if(event.event==='inbound')void receive(worker,event);
            else if(event.event==='command_result'){worker.commands.get(event.commandId)?.(event);worker.commands.delete(event.commandId);}
          }
        });
        worker.child.stdin.write(JSON.stringify({...options.operation,actionId:action.id,context})+'\n');
        const lease=setInterval(async()=>{if(worker.leaseBusy||worker.closed||worker.stopping)return;worker.leaseBusy=true;try{await api('POST',`/a2a/v1/actions/${action.id}/bot-gateway-lease`,{});appendNativeLifecycle(worker.home,{event:'gateway.supervisor.health',pid:worker.child.pid || null,status:worker.status});}catch{worker.status='failed';worker.code='GATEWAY_LEASE_REVOKED';closeAdmission(worker);worker.child.stdin.end(JSON.stringify({operation:'disconnect'})+'\n');setTimeout(()=>{if(!worker.closed)void worker.stop();},12000).unref?.();}finally{worker.leaseBusy=false;}},10000);lease.unref?.();
        void worker.completionEvidence.then(evidence=>{worker.closed=true;worker.processExit=evidence;if(worker.status!=='failed')worker.status='disconnected';clearInterval(lease);spec.cleanup();appendNativeLifecycle(worker.home,{event:'gateway.exit',status:worker.status,code:worker.code,processExit:evidence});for(const resolve of worker.commands.values())resolve({success:false,code:'EXECUTION_UNCERTAIN'});worker.commands.clear();resolveReady({connected:false,code:worker.code || 'GATEWAY_EXITED_BEFORE_READY',processExit:evidence});});
        const timeout=setTimeout(()=>resolveReady({connected:false,code:'GATEWAY_CONNECT_TIMEOUT'}),50000);const result=await ready;clearTimeout(timeout);
        if(!result.connected){closeAdmission(worker);await worker.stop();const evidence=await worker.completionEvidence;if(process.platform==='win32'&&!evidence.treeConfirmed)return{...result,success:false,code:'EXECUTION_UNCERTAIN',processExit:evidence};return{...result,processExit:evidence};}return result;
      }
      if(operation==='disconnect'){
        if(!worker)return{connected:false,stopConfirmed:true,alreadyDisconnected:true};
        if(worker.closed){const stopConfirmed=process.platform!=='win32'||worker.processExit?.treeConfirmed===true;return{connected:false,stopConfirmed,alreadyDisconnected:true,processExit:worker.processExit,...(!stopConfirmed?{success:false,code:'EXECUTION_UNCERTAIN'}:{})};}
        closeAdmission(worker);
        worker.child.stdin.end(JSON.stringify({operation:'disconnect'})+'\n');const timer=setTimeout(()=>void worker.stop(),12000);const evidence=await worker.completionEvidence;clearTimeout(timer);
        const stopConfirmed=process.platform!=='win32'||evidence.treeConfirmed;
        return{connected:false,stopConfirmed,...(!stopConfirmed?{success:false,code:'EXECUTION_UNCERTAIN'}:{}),processExit:evidence};
      }
      if(!worker||!accepting(worker)||worker.context.revision!==context.revision||worker.context.controlEpoch!==context.controlEpoch)throw new Error('当前 Bot 版本没有已连接 Gateway');
      await options.beforeSpawn?.();await api('POST',`/a2a/v1/actions/${worker.actionId}/bot-gateway-lease`,{});
      return command(worker,{operation:operation==='outbound'?'send':'inbound',...input});
    },
    async close(){await Promise.all([...workers.values()].filter(worker=>!worker.closed).map(worker=>{closeAdmission(worker);return worker.stop();}));},
  };
}
