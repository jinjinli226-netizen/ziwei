import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {botSecretDirectory,createBotDeviceSecretStore} from './bot-device-secret-store.mjs';
import {canonicalSecretBinding} from './bot-secret-crypto.mjs';
const AAD=Buffer.from('ziwei-hermes-interaction-v1');
export function encryptInteractionPacket(key,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(AAD);const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final(),cipher.getAuthTag()]);return JSON.stringify({iv:iv.toString('base64'),body:body.toString('base64')})+'\n';}
export function decryptInteractionPacket(key,packet){if(!packet||typeof packet.iv!=='string'||typeof packet.body!=='string'||packet.body.length>131072)throw Error('BOT_INTERACTION_PACKET_INVALID');const data=Buffer.from(packet.body,'base64'),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(packet.iv,'base64'));decipher.setAAD(AAD);decipher.setAuthTag(data.subarray(-16));return JSON.parse(Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]).toString('utf8'));}

export async function createBotInteractionBridge({apiBase,workspace,deviceId,deviceToken,context,actionId,signal,store,fetchImpl=fetch,pollMs=1000,onWait}={}){
 const origin=new URL(apiBase);if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))throw Error('BOT_INTERACTION_ORIGIN_INVALID');
 if(!deviceToken||!context||context.workspace!==workspace||context.deviceId!==deviceId||!actionId)throw Error('BOT_INTERACTION_BINDING_INVALID');
 store||=createBotDeviceSecretStore({directory:botSecretDirectory({apiBase,workspace,deviceId})});
 const key=randomBytes(32),privateDirectory=process.platform==='win32'?null:fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-interaction-'));
 if(privateDirectory)fs.chmodSync(privateDirectory,0o700);
 const address=process.platform==='win32'?`\\\\.\\pipe\\ziwei-interaction-${randomUUID()}`:path.join(privateDirectory,'bridge.sock');
 const sockets=new Set(),pending=new Set();let closed=false;
 const controller=new AbortController();
 async function request(url,method='GET',body){const result=await fetchImpl(new URL(url,origin),{method,headers:{authorization:`Bearer ${deviceToken}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),redirect:'error'});if(!result.ok)throw Error('BOT_INTERACTION_RELAY_FAILED');return result.json();}
 let deviceBinding;try{({binding:deviceBinding}=await request(`/a2a/v1/actions/${encodeURIComponent(actionId)}/interactions/start`,'POST'));}catch(error){key.fill(0);if(privateDirectory)fs.rmdirSync(privateDirectory);throw error;}
 async function exchange(input){
  const expected={employeeId:context.employeeId,profile:context.instance?.profile||context.sourceProfile,deviceId,actionId,revision:context.revision,controlEpoch:context.controlEpoch};
  if(!input||Object.entries(expected).some(([k,v])=>input[k]!==v)||input.workspaceId!==deviceBinding.workspaceId||pending.has(input.requestId))throw Error('BOT_INTERACTION_BINDING_INVALID');
  pending.add(input.requestId);try{onWait?.({state:'waiting',requestId:input.requestId,kind:input.kind});}catch{}
  try{
   const view=await request(`/a2a/v1/actions/${encodeURIComponent(actionId)}/interactions`,'POST',input);
   while(!closed&&Date.now()<input.expiresAt*1000){
    const answer=await request(`/a2a/v1/actions/${encodeURIComponent(actionId)}/interactions/${encodeURIComponent(input.requestId)}/claim`,'POST');
    if(answer.state==='answered'){
     if(canonicalSecretBinding(answer.binding)!==canonicalSecretBinding(view.binding))throw Error('BOT_INTERACTION_BINDING_INVALID');
     let plaintext=store.openBoundSecret(answer.binding,answer.envelope);try{return{requestId:input.requestId,state:'answered',value:JSON.parse(plaintext)};}finally{plaintext=null;}
    }
    if(answer.state!=='waiting')return{requestId:input.requestId,state:answer.state};
    await new Promise(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,pollMs);controller.signal.addEventListener('abort',done,{once:true});});
   }
   return{requestId:input.requestId,state:'expired'};
  }finally{pending.delete(input.requestId);try{onWait?.({state:'resolved',requestId:input.requestId,kind:input.kind});}catch{}}
 }
 const server=net.createServer(socket=>{
  sockets.add(socket);let buffer='',handled=false;socket.setTimeout(310000,()=>socket.destroy());socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  socket.on('data',async chunk=>{if(handled)return;buffer+=chunk.toString('utf8');if(buffer.length>131072){socket.destroy();return;}const end=buffer.indexOf('\n');if(end<0)return;handled=true;
   try{const input=decryptInteractionPacket(key,JSON.parse(buffer.slice(0,end)));buffer='';const response=await exchange(input);if(!closed)socket.end(encryptInteractionPacket(key,response));if(response.value)for(const field of Object.keys(response.value))response.value[field]='';}
   catch{if(!closed)socket.end(encryptInteractionPacket(key,{state:'cancelled'}));}
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,resolve);});
 if(privateDirectory)fs.chmodSync(address,0o600);
 const close=()=>{if(closed)return;closed=true;controller.abort();for(const socket of sockets)socket.destroy();server.close();key.fill(0);if(privateDirectory){try{fs.unlinkSync(address);}catch{}try{fs.rmdirSync(privateDirectory);}catch{}}signal?.removeEventListener('abort',close);};
 signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)close();
 return{env:{ZIWEI_INTERACTION_PIPE:address,ZIWEI_INTERACTION_PIPE_KEY:key.toString('base64'),ZIWEI_INTERACTION_BINDING:JSON.stringify(deviceBinding)},close};
}
