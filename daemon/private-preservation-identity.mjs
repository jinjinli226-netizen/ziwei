import fs from 'node:fs';
import path from 'node:path';
import {inspectLocalDaemonMaintenanceFiles} from '../backend/preservation-native-evidence.mjs';

const refuse=code=>{throw Object.assign(Error('Private client identity refused'),{code});};
const counter=value=>{if(!Number.isSafeInteger(value)||value<0)refuse('SOURCE_CLIENT_STATE_UNPROVEN');return value;};
export function loadPrivateClientIdentityConfiguration(env=process.env){
 const file=env.ZIWEI_PRODUCTION_CLIENT_IDENTITY_CONFIG;if(!file)return null;
 try{
  if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)refuse('SOURCE_CLIENT_CONFIGURATION');
  for(let current=file;;current=path.dirname(current)){const stat=fs.lstatSync(current,{bigint:true});if(stat.isSymbolicLink()||current===file&&(!stat.isFile()||stat.nlink!==1n||stat.size>256n*1024n))refuse('SOURCE_CLIENT_CONFIGURATION');if(path.dirname(current)===current)break;}
  if(fs.realpathSync.native(file)!==file)refuse('SOURCE_CLIENT_CONFIGURATION');
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  if(config?.schemaVersion!==1||Object.keys(config).sort().join(',')!=='hostId,schemaVersion,trust'||typeof config.hostId!=='string'||!config.hostId||!config.trust||typeof config.trust!=='object'||Array.isArray(config.trust))refuse('SOURCE_CLIENT_CONFIGURATION');
  return{hostId:config.hostId,trust:structuredClone(config.trust)};
 }catch{refuse('SOURCE_CLIENT_CONFIGURATION');}
}
export function privateClientConnections(connections){
 if(!(connections instanceof Map))refuse('SOURCE_CLIENT_STATE_UNPROVEN');
 return [...connections.values()].map(c=>({workspace:c.config.workspace,deviceId:c.config.deviceId,apiBase:c.config.apiBase,hermesHome:c.hermesHomePath,runtimeDir:c.runtimeDir,primary:c.config.primary}));
}
/** Reads current registered work and complete local journals. These counters do
 * not attest historical discovery/raw-spawn descendants or native namespace. */
export function createPrivateClientStateReader({connections,isDraining,connectionErrors}){
 if(!(connections instanceof Map)||typeof isDraining!=='function'||typeof connectionErrors!=='function')refuse('SOURCE_CLIENT_STATE_UNPROVEN');
 return()=>{
  const draining=isDraining(),errors=connectionErrors();if(typeof draining!=='boolean'||!Array.isArray(errors))refuse('SOURCE_CLIENT_STATE_UNPROVEN');
  const projection=privateClientConnections(connections),rows=[...connections.values()],managers=rows.map(c=>c.localExecutor.maintenanceStatus());
  if(managers.some(row=>!row||!Array.isArray(row.workers)))refuse('SOURCE_CLIENT_STATE_UNPROVEN');
  const workers=managers.flatMap(row=>row.workers),files=inspectLocalDaemonMaintenanceFiles({connections:projection});
  if(!Array.isArray(files.issues)||rows.some(c=>typeof c.polling!=='boolean'||!Array.isArray(c.dispatcher.quarantinedActionIds)))refuse('SOURCE_CLIENT_STATE_UNPROVEN');
  const issues=[...errors,...files.issues];if(files.safe!==true&&!files.issues.length)issues.push({code:'CLIENT_LOCAL_FILES_UNPROVEN'});
  if(managers.some(row=>row.safe!==true)||workers.some(row=>!row||![true,false,null].includes(row.processAlive)))issues.push({code:'CLIENT_REGISTERED_WORKERS_UNPROVEN'});
  const sum=(values,key)=>counter(values.reduce((n,row)=>n+counter(row[key]),0));
  return{connectionState:draining?'draining':'connected',connections:projection,issues,
   activeActionCount:sum(rows.map(c=>c.actionScheduler),'activeCount'),pollingCount:rows.filter(c=>c.polling).length,
   quarantinedActionCount:counter(rows.reduce((n,c)=>n+c.dispatcher.quarantinedActionIds.length,0)),pendingDeliveryCount:sum(rows.map(c=>c.actionDelivery),'pendingCount'),blockedDeliveryCount:sum(rows.map(c=>c.actionDelivery),'blockedCount'),
   managedAuxiliaryCount:workers.filter(row=>row.processAlive!==false).length,gatewayPendingCount:sum(workers,'pendingCommands'),gatewayInFlightCount:sum(workers,'inFlight'),gatewayInboundCount:sum(workers,'pendingInbound')};
 };
}
/** Adapts the fixed E03 Express-shaped handler to the existing Node HTTP server.
 * Handler selection and state getters are code-only; configuration/request JSON
 * cannot select callbacks. No extra listener or repository is created. */
export function createPrivateIdentityHttpRoute(handler){
 if(handler!==null&&typeof handler!=='function')refuse('SOURCE_CLIENT_CONFIGURATION');
 return(req,res)=>{
  if(!handler||req.url!=='/internal/preservation/identity')return false;
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.writeHead(404);res.end();return true;}
  const refused=()=>{if(!res.writableEnded){res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({code:'SOURCE_CLIENT_IDENTITY_REFUSED'}));}};
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)){refused();return true;}
  let chunks=[],length=0,finished=false;
  req.on('data',chunk=>{if(finished)return;length+=chunk.length;if(length>1024*1024){finished=true;chunks=[];refused();}else chunks.push(chunk);});
  req.on('error',()=>{finished=true;chunks=[];refused();});
  req.on('end',()=>{
   if(finished)return;finished=true;
   try{req.body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));chunks=[];const response={setHeader:(name,value)=>res.setHeader(name,value),status(code){res.statusCode=code;return this;},json(value){res.setHeader('content-type','application/json');res.end(JSON.stringify(value));return this;}};handler(req,response);}catch{refused();}
  });
  return true;
 };
}
