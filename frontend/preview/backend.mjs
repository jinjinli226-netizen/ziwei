// Local preview adapter. Uses the product's real API/repository and a dedicated
// SQLite file. The only executor below is a labelled in-process fixture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import {createApp,attachRealtimeWebSocket} from '../../backend/app.mjs';
import {createManagementService} from '../../backend/management.mjs';
import {createPreviewLog} from './diagnostics.mjs';
import {previewRequestAllowed} from './policy.mjs';
import {previewStateDirectory} from './state-root.mjs';
import {createPreviewNativeRuntime,preparePreviewNativeHome,previewNativePeer} from './native-runtime.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const directory=previewStateDirectory(root);
const data=path.join(directory,'data'),runtimeHome=path.join(directory,'runtime-home');
fs.mkdirSync(data,{recursive:true});fs.mkdirSync(runtimeHome,{recursive:true});
const apiPort=Number(process.env.ZIWEI_PREVIEW_API_PORT || 4283);
const frontendPort=Number(process.env.ZIWEI_PREVIEW_FRONTEND_PORT || 5283);
if(!Number.isInteger(apiPort)||apiPort<1024||apiPort>65535)throw new Error('Invalid preview API port');
const log=createPreviewLog(path.join(directory,'logs'),`backend-${process.env.ZIWEI_PREVIEW_INSTANCE || process.pid}`);
preparePreviewNativeHome(directory,`http://127.0.0.1:${apiPort}`);
const discoverFixture=()=>({agents:{Hermes:{version:'fixture-no-Hermes',models:[{id:'fixture-model',label:'合成演示模型（未调用真实模型）',provider:'fixture'}]}}});
// Repository's raw persisted key differs from its configured-string key mode.
// Initialize against the existing state's owning cwd so ciphertext remains valid.
const previousCwd=process.cwd();let app;
try{process.chdir(path.resolve(directory,'../..'));app=createApp({filename:path.join(data,'preview.sqlite'),objectStoreDir:path.join(data,'objects'),discoverLocalVersions:discoverFixture,enableScheduler:false,requireAuth:true,requireDeviceAuth:true,managementMcpSecretFile:path.join(data,'management-signing.key'),ziweiConnectApiBase:'http://127.0.0.1:1/api'});}finally{process.chdir(previousCwd);}
const repo=app.locals.repo,auth=app.locals.auth,management=createManagementService(repo);
const accessFile=path.join(data,'local-preview-access.private.json');
let credentials;
if(fs.existsSync(accessFile))credentials=JSON.parse(fs.readFileSync(accessFile,'utf8'));
else {credentials={email:'preview@ziwei.invalid',password:crypto.randomBytes(32).toString('base64url')};fs.writeFileSync(accessFile,JSON.stringify(credentials),{mode:0o600});}
const initialized=Boolean(repo.db.prepare('SELECT 1 FROM local_users WHERE email=?').get(credentials.email));
const principal=initialized?auth.login(credentials):auth.setup({...credentials,name:'本地预览'});
let session=principal.session;
const workspaces=[{slug:'preview-bots',name:'Bot 本地预览'},{slug:'preview-alt',name:'第二个隔离工作区'}];
for(const workspace of workspaces)if(!auth.canAccess(principal.user_id,workspace.slug))auth.createWorkspace(principal.user_id,{...workspace,kind:'personal'});
const context={actorUserId:principal.user_id,actorRole:'owner'};
const deviceFile=path.join(data,'fixture-devices.json');
const fixtureDevices=fs.existsSync(deviceFile)?JSON.parse(fs.readFileSync(deviceFile,'utf8')):{};
for(const workspace of workspaces)if(!fixtureDevices[workspace.slug])fixtureDevices[workspace.slug]=repo.createDevice(workspace.slug,{name:'合成演示设备（未连接真实 Hermes）',ownerUserId:principal.user_id}).id;
fs.writeFileSync(deviceFile,JSON.stringify(fixtureDevices));
function heartbeat(){
  for(const workspace of workspaces)repo.heartbeatDevice(workspace.slug,{deviceId:fixtureDevices[workspace.slug],name:'合成演示设备（未连接真实 Hermes）',runtimes:{Hermes:{status:'available',version:'fixture-no-Hermes',profiles:[{name:'preview-fixture',provider_configured:true,authentication_configured:true,readiness:{ready:true}}],models:[{id:'fixture-model',label:'合成演示模型（未调用真实模型）'}]}}});
}
heartbeat();
const seeded=path.join(data,'fixture-seed-v1.json');
if(!fs.existsSync(seeded)){
  for(const [index,workspace] of workspaces.entries()){
    const bot=management.bots.create(workspace.slug,{name:index?'另一工作区的资料员':'资料研究员',description:'合成预览 · 配置与主聊天演示',persona:'清楚说明进展和限制。',instructions:'仅整理合成资料，不操作真实设备或外部账号。',runtimeProfile:'preview-fixture',targetDeviceId:fixtureDevices[workspace.slug],model:'fixture-model',visibility:'personal',idempotencyKey:`preview-seed-${workspace.slug}`},context);
    repo.addConversationMessage(bot.main_conversation_id,{role:'assistant',content:'这是独立本地预览。配置保存使用真实紫薇 API；执行与回复来自标明的合成 fixture，尚未调用真实 Hermes。',dispatch:false});
  }
  fs.writeFileSync(seeded,JSON.stringify({fixture:true,createdAt:new Date().toISOString(),workspaces:workspaces.map(item=>item.slug)}));
}
const native=createPreviewNativeRuntime({directory,repo,workspaces,ownerUserId:principal.user_id,apiBase:`http://127.0.0.1:${apiPort}`,log});
const nativeSeed=path.join(data,'native-seed-v1.json');
if(!fs.existsSync(nativeSeed)){
  const ids=[];for(const workspace of workspaces){const bot=management.bots.create(workspace.slug,{name:'Hermes 原生伙伴',description:'本机原生 Hermes · 本地测试 provider',persona:'清楚说明进展和限制。',instructions:'仅处理这个隔离预览内的资料。回复明确说明本地测试 provider。',runtimeProfile:'default',targetDeviceId:native.devices[workspace.slug],model:'preview-local-model',workdir:native.home,config:{permissions:{mode:'execute',management:false},mcpServers:{preview_local:{transport:'http',url:`http://127.0.0.1:${apiPort}/__preview/native-peer/mcp`,enabled:true,env:{},headers:{}}},voice:{stt:{enabled:true,provider:'openai',baseUrl:`http://127.0.0.1:${apiPort}/__preview/native-peer/v1`,model:'whisper-1',keyEnv:'PREVIEW_VOICE_KEY'},tts:{enabled:true,provider:'openai',baseUrl:`http://127.0.0.1:${apiPort}/__preview/native-peer/v1`,model:'gpt-4o-mini-tts',voice:'alloy',keyEnv:'PREVIEW_VOICE_KEY'}}},idempotencyKey:`native-preview-seed-${workspace.slug}`},context);ids.push(bot.id);repo.addConversationMessage(bot.main_conversation_id,{role:'assistant',content:'这位伙伴使用已安装 Hermes 的独立 HOME。模型、MCP 和语音端仅连接本预览的本地协议服务；正式账号和自动调度没有连接。',dispatch:false});}
  fs.writeFileSync(nativeSeed,JSON.stringify({ids,createdAt:new Date().toISOString(),native:true,localTestProvider:true}));
}
const outer=express();
outer.use(express.json({limit:'16mb'}));
outer.use(async(req,res,next)=>{
  const remote=req.socket.remoteAddress;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return res.status(403).json({error:'仅允许本机预览'});
  const origin=req.headers.origin;
  if(origin&&origin!==`http://127.0.0.1:${frontendPort}`&&origin!==`http://127.0.0.1:${apiPort}`)return res.status(403).json({error:'预览来源不匹配'});
  if(req.method==='OPTIONS')return next();
  if(req.path.startsWith('/__preview/native-peer/')){try{await previewNativePeer(req,res);return;}catch(error){return next(error);}}
  // Device callbacks retain device authentication and never gain the owner cookie.
  const deviceCredential=req.headers['x-ziwei-device-token'];
  if(deviceCredential&&native.ownsToken(deviceCredential)&&(/^\/a2a\/v1\/actions\//.test(req.path)||/^\/api\/workspaces\/[^/]+\/mcp\/bootstrap$/.test(req.path)))return next();
  if(!origin&&/^Bearer /i.test(req.headers.authorization||'')&&/^\/mcp\/v1\/workspaces\/(preview-bots|preview-alt)\/(bots|employees|tasks|actions|summary|discovery|health|conversations)(?:\/|$)/.test(req.path)&&!/phone-mcp/.test(req.path))return next();
  if(!previewRequestAllowed({method:req.method,path:req.path,body:req.body,native:true}))return res.status(503).json({error:'此隔离预览仅开放 Bot 工作流；正式设备、外部账号和业务网络未连接',code:'PREVIEW_EXTERNAL_DISABLED'});
  if(req.path==='/api/auth/logout')return res.json({ok:true,preview:true});
  req.headers.cookie=`${auth.cookieName}=${session.token}`;
  next();
});
outer.get('/__preview/health',(_req,res)=>res.json({ok:true,preview:true,fixtureDevices:true,realHermes:true,localTestProvider:true,nativeVersion:native.version,schedulerEnabled:false,pid:process.pid,database:path.join(data,'preview.sqlite'),runtimeHome}));
outer.use(app);
const server=http.createServer(outer);
server.prependListener('upgrade',req=>{req.headers.cookie=`${auth.cookieName}=${session.token}`;});
const sockets=attachRealtimeWebSocket(server,app);
server.listen(apiPort,'127.0.0.1',()=>log.write('api_listening',{pid:process.pid,port:apiPort,database:path.join(data,'preview.sqlite'),realHermes:true,localTestProvider:true,schedulerEnabled:false}));

// No native executable, provider, management tool, device or network call is
// invoked. Each pending action is visibly answered as a synthetic preview.
const worker=setInterval(()=>{
  try{
    for(const workspace of workspaces){
      const deviceId=fixtureDevices[workspace.slug];
      for(const action of repo.listA2AActions(workspace.slug,{status:'pending',deviceId})){
        repo.ackA2AAction(action.id,{deviceId});
        const snapshot=action.payload?.hermesBot;
        const validation=action.type==='hermes.bot.validate';
        if(!['hermes.bot.validate','conversation.execute','automation.execute'].includes(action.type)||action.payload?.nativeDriver||action.payload?.collaboration){repo.resultA2AAction(action.id,{deviceId,status:'failed',error:'合成电脑不执行原生能力；请创建或选择绑定“本机原生隔离预览”的伙伴。',result:{fixture:true,code:'PREVIEW_NATIVE_REQUIRES_NATIVE_DEVICE',stopConfirmed:true}});continue;}
        if(snapshot){
          if(!validation)repo.authorizeBotStart(action.id,{deviceId});
          repo.recordA2AEvent(action.id,{deviceId,type:'action.output',stage:'fixture',message:'隔离预览 fixture：未调用真实 Hermes、模型、MCP 或设备。'});
          repo.resultA2AAction(action.id,{deviceId,status:'succeeded',result:validation?{fixture:true,botValidation:{valid:true,schemaVersion:1,employeeId:snapshot.employeeId,revision:snapshot.revision,sourceProfile:'preview-fixture',nativeVersion:'fixture-no-Hermes'},output:'合成配置回执，仅演示控制流程；真实 Hermes 仍未连接。'}:{fixture:true,output:'【合成预览结果】已收到这次工作。此回复用于验证长期聊天与结果回传，未调用真实 Hermes，也未执行真实业务。'}});
        }else repo.resultA2AAction(action.id,{deviceId,status:'failed',error:'预览仅提供 Bot 合成执行；Creator 实际模型创建流程尚未在此预览连接',result:{fixture:true,code:'PREVIEW_EXECUTION_DISABLED',stopConfirmed:true}});
      }
    }
  }catch(error){log.write('fixture_worker_error',{error:error.message,code:error.code});}
},1000);
const monitor=setInterval(()=>{heartbeat();log.write('api_heartbeat',{pid:process.pid,port:apiPort,fixture:true});},15000);
const renewal=setInterval(()=>{session=auth.login(credentials).session;},24*60*60*1000);
process.on('uncaughtExceptionMonitor',error=>log.write('uncaught_exception',{error:error.message,stack:error.stack}));
let stopping=false;
async function shutdown(code,reason){if(stopping)return;stopping=true;log.write('api_stopping',{reason,code});clearInterval(worker);clearInterval(monitor);clearInterval(renewal);await native.close();for(const socket of sockets.clients)socket.terminate();server.closeAllConnections?.();server.close(()=>process.exit(code));setTimeout(()=>process.exit(code),2000).unref();}
process.on('unhandledRejection',error=>{log.write('unhandled_rejection',{error:String(error)});shutdown(1,'unhandled_rejection');});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>shutdown(0,signal));
process.on('exit',code=>log.write('api_exit',{code}));
