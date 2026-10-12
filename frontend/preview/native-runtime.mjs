// Actual installed Hermes, with an owned HOME and loopback protocol providers.
// This adapter reuses product dispatch, durable delivery and bounded scheduling.
import fs from 'node:fs';
import path from 'node:path';
import {stringify} from 'yaml';
import {createLocalActionExecutor} from '../../src/local-action.mjs';
import {ActionDispatcher} from '../../src/daemon.mjs';
import {createActionScheduler} from '../../src/daemon-action-scheduler.mjs';
import {createActionDelivery} from '../../src/daemon-action-delivery.mjs';
import {discoverInstalledRuntimes} from '../../src/runtime-adapters.mjs';
import {createBotGatewayManager} from '../../src/hermes-gateway-runtime.mjs';
import {assertPreviewNativeAction} from './native-policy.mjs';

export function preparePreviewNativeHome(directory,apiBase){
  const home=path.join(directory,'runtime-home'),source=path.join(home,'.hermes'),guard=path.join(home,'guard'),managed=path.join(home,'managed');
  for(const dir of [home,source,guard,managed])fs.mkdirSync(dir,{recursive:true});
  const once=(file,body)=>{if(!fs.existsSync(file))fs.writeFileSync(file,body,{mode:0o600,flag:'wx'});};
  once(path.join(source,'config.yaml'),stringify({model:{provider:'custom:preview-local',default:'preview-local-model',base_url:apiBase+'/__preview/native-peer/v1',api_mode:'chat_completions'},providers:{'preview-local':{key_env:'PREVIEW_LOCAL_PROVIDER_KEY',base_url:apiBase+'/__preview/native-peer/v1',api_mode:'chat_completions',context_length:131072}},models_dev:{url:apiBase+'/__preview/native-peer/catalog'}}));
  once(path.join(source,'.env'),'PREVIEW_LOCAL_PROVIDER_KEY=local-protocol-only\nPREVIEW_VOICE_KEY=local-audio-only\n');once(path.join(source,'auth.json'),'{}');
  once(path.join(managed,'config.yaml'),stringify({updates:{check:false},auxiliary:{title_generation:{enabled:false},background_review:{enabled:false}}}));
  // Python SDKs may not honor provider URL configuration. Block every external
  // socket in this owned process tree, including default discovery endpoints.
  once(path.join(guard,'sitecustomize.py'),"import socket,ipaddress\n_orig=socket.socket.connect\ndef local_connect(self,address):\n if isinstance(address,tuple):\n  host=str(address[0])\n  try: allowed=(host=='localhost' or ipaddress.ip_address(host).is_loopback) and int(address[1])=="+new URL(apiBase).port+"\n  except ValueError: allowed=False\n  if not allowed: raise RuntimeError('Isolated preview blocks non-owned network endpoints')\n return _orig(self,address)\nsocket.socket.connect=local_connect\n");
  Object.assign(process.env,{HERMES_HOME:source,HERMES_MANAGED_DIR:managed,HERMES_ALLOW_PRIVATE_URLS:'true',PYTHONNOUSERSITE:'1',PYTHONPATH:guard,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'});
  return {home,source};
}

export async function previewNativePeer(req,res){
  if(!req.path.startsWith('/__preview/native-peer/'))return false;
  const route=req.path.slice('/__preview/native-peer'.length),chunks=[];
  if(req.body===undefined)for await(const chunk of req)chunks.push(chunk);
  const body=req.body??(chunks.length&&['/mcp','/v1/chat/completions','/v1/audio/speech'].includes(route)?JSON.parse(Buffer.concat(chunks).toString()||'{}'):{});
  if(route==='/mcp'){
    if(req.method==='GET'){res.status(405).end();return true;}if(body.id===undefined){res.status(202).end();return true;}
    const result=body.method==='initialize'?{protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'preview-loopback',version:'1'}}:body.method==='tools/list'?{tools:[{name:'lookup',description:'本机协议预览查询',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']},annotations:{readOnlyHint:true}}]}:body.method==='tools/call'?{content:[{type:'text',text:'【本地测试 MCP】'+String(body.params.arguments.query)}],isError:false}:{};
    res.json({jsonrpc:'2.0',id:body.id,result});return true;
  }
  if(route==='/v1/audio/transcriptions'){res.type('text/plain').send('本机原生 STT 已完成：这是本地协议测试音频。');return true;}
  if(route==='/v1/audio/speech'){
    const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);res.type('audio/wav').send(wav);return true;
  }
  if(route==='/v1/chat/completions'){
    const answer='【本机原生 Hermes · 本地测试 provider】已完成这个隔离回合。此回复验证同一 Bot 的原生执行与结果回传；没有连接外部模型或业务账号。';
    if(body.stream){res.type('text/event-stream');res.end('data: '+JSON.stringify({id:'preview',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:answer},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'preview',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
    else res.json({id:'preview',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});return true;
  }
  res.json({});return true;
}

export function createPreviewNativeRuntime({directory,repo,workspaces,ownerUserId,apiBase,log}){
  const {home,source}=preparePreviewNativeHome(directory,apiBase),version=discoverInstalledRuntimes().runtimes.Hermes?.version;
  if(!version)throw new Error('原生预览未发现已安装 Hermes；不会回退为合成成功');
  const file=path.join(directory,'data/native-devices.private.json'),devices=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  for(const {slug} of workspaces)if(!devices[slug]){const pairing=repo.createDevicePairing(slug,{createdBy:ownerUserId,name:'本机原生隔离预览'});devices[slug]=repo.claimDevicePairing({code:pairing.code,name:'本机原生隔离预览'});}
  fs.writeFileSync(file,JSON.stringify(devices),{mode:0o600});
  let stopping=false;const connections=[];
  const request=async(connection,route,body)=>{const response=await fetch(apiBase+route,{method:'POST',headers:{'content-type':'application/json','x-ziwei-device-token':connection.deviceToken},body:JSON.stringify({...body,workspace:connection.workspace}),redirect:'error',signal:AbortSignal.timeout(120000)});const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.code||'PREVIEW_NATIVE_API_ERROR'),{status:response.status});return value;};
  for(const {slug} of workspaces){
    const device=devices[slug],runtimeDir=path.join(home,'workers',slug);fs.mkdirSync(runtimeDir,{recursive:true});
    const gateways=createBotGatewayManager({apiBase,workspace:slug,deviceToken:device.deviceToken});
    const executor=createLocalActionExecutor({runtimeDir,defaultWorkdir:home,hermesHomePath:source,defaultRuntime:'Hermes',workspace:slug,apiBase,deviceId:device.deviceId,deviceToken:device.deviceToken,terminalMcpConfig:{enabled:false}});
    let delivery;const dispatcher=new ActionDispatcher({workspace:slug,deviceId:device.deviceId,workdir:home,stateFile:path.join(runtimeDir,'action-state.json'),canExecute:()=>!stopping,
      onEvent:(event,extra)=>{log.write(event,{workspace:slug,actionId:extra.actionId,stage:extra.stage,code:extra.code});if(extra.actionId&&['action.started','action.output','action.progress','action.stage','action.waiting'].includes(event))delivery?.recordEvent(extra.actionId,event,extra);},
      execute:async(action,context)=>{
        assertPreviewNativeAction(action,home,apiBase);const operation=action.payload.nativeOperation;let result;
        if(operation?.resource==='gateway'&&['connect','disconnect','inbound','outbound'].includes(operation.operation)){
          const data=await gateways.operate(action,{context:action.payload.hermesBot,baseHome:source,privateDirectory:path.join(runtimeDir,'bot-instances'),workspace:slug,apiBase,operation,cwd:home,signal:context.signal,beforeSpawn:async()=>{const receipt=await request(device,`/a2a/v1/actions/${action.id}/bot-start`,{});if(!receipt.allowed)throw Object.assign(new Error('Bot 授权已撤销'),{definitelyNotStarted:true});}});
          const failed=data.success===false||operation.operation==='connect'&&!data.connected;
          result={status:failed?'failed':'succeeded',result:{nativeOperation:{schemaVersion:2,resource:'gateway',operation:operation.operation,employeeId:action.payload.hermesBot.employeeId,revision:action.payload.hermesBot.revision,nativeVersion:data.nativeVersion||version,status:failed?'failed':'succeeded',data},...(data.code==='EXECUTION_UNCERTAIN'?{code:data.code,executionState:'uncertain'}:{})}};
        }else result=await executor(action,context);
        if(result.result){result.result.executionSource='local_test_provider';if(result.result.nativeOperation)result.result.nativeOperation.executionSource='local_test_provider';}return result;
      }});
    delivery=createActionDelivery({directory:path.join(runtimeDir,'action-delivery'),identity:{apiBase,workspace:slug,deviceId:device.deviceId},post:(route,body)=>request(device,route,body),dispatch:action=>dispatcher.dispatch(action),onEvent:(event,extra)=>log.write(event,{workspace:slug,actionId:extra.actionId,code:extra.code})});
    const scheduler=createActionScheduler({execute:action=>delivery.execute(action),canStart:action=>!stopping&&(!dispatcher.quarantined||delivery.canDeliverWithoutExecution(action)),quarantinedActionIds:()=>dispatcher.quarantinedActionIds,onError:(error,action)=>log.write('native_delivery_error',{actionId:action.id,error:error.message})});
    connections.push({slug,device,dispatcher,delivery,scheduler,gateways});
  }
  const heartbeat=()=>{for(const {slug,device} of connections)repo.heartbeatDevice(slug,{deviceId:device.deviceId,name:'本机原生隔离预览 · 本地测试 provider',pid:process.pid,runtimes:{Hermes:{status:'available',version,profiles:[{name:'default',provider_configured:true,authentication_configured:true,readiness:{ready:true}}],models:[{id:'preview-local-model',label:'本机原生 · 本地测试 provider'}]}}});};
  heartbeat();const monitor=setInterval(heartbeat,10000),worker=setInterval(()=>{try{for(const connection of connections){const pending=repo.listA2AActions(connection.slug,{status:'pending',deviceId:connection.device.deviceId});connection.scheduler.schedule([...connection.delivery.recoverActions(),...pending]);}}catch(error){log.write('native_poll_error',{code:error.code,error:error.message});}},500);
  return {version,home,devices:Object.fromEntries(connections.map(item=>[item.slug,item.device.deviceId])),ownsToken(token){const credential=repo.authenticateDeviceToken(token);return Boolean(credential&&connections.some(item=>item.device.deviceId===credential.device_id));},async close(){stopping=true;clearInterval(worker);clearInterval(monitor);for(const connection of connections){for(const action of repo.listA2AActions(connection.slug,{status:'acked',deviceId:connection.device.deviceId}))connection.dispatcher.cancel(action.id);await connection.gateways.close();}await Promise.all(connections.map(item=>item.scheduler.whenIdle()));}};
}
