import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {defaultUserDir,resolveConfigPath} from '../daemon/config.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {resolveNpmCli} from './client-update.mjs';
import {BOT_FORCE_ABANDON_POLICY as POLICY,canonicalForceAbandonValue as canonical,forceAbandonBytesDigest as hash} from '../src/bot-force-abandon-contract.mjs';
import {FORCE_ABANDON_NATIVE_RULES,forceAbandonHealthOrigin,inspectForceAbandonInstalledProcesses,inspectForceAbandonListenerCount,inspectForceAbandonSourceSnapshot,inspectForceAbandonOfflineArtifacts} from './client-force-abandon-recovery.mjs';

const run=promisify(execFile),ascii=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const fail=code=>Object.assign(new Error(code),{code});
const SAFE_CODES=new Set(['DIAGNOSE_ARGUMENT_INVALID','DIAGNOSE_ROOT_UNAVAILABLE','DIAGNOSE_PACKAGE_INVALID','DIAGNOSE_CONFIG_UNAVAILABLE','DIAGNOSE_INTERNAL_FAILED']);
function restrictedJson(file){
 for(let current=path.resolve(file);;current=path.dirname(current)){let st;try{st=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}if(st?.isSymbolicLink())throw fail('DIAGNOSE_CONFIG_UNAVAILABLE');if(current===path.dirname(current))break;}
 const st=fs.lstatSync(file);if(!st.isFile()||st.nlink!==1||st.size>1024*1024)throw fail('DIAGNOSE_CONFIG_UNAVAILABLE');const bytes=fs.readFileSync(file);return{value:JSON.parse(bytes.toString('utf8')),sha256:hash(bytes)};
}

export async function resolveDiagnosticRoot({root,env=process.env,runCommand=run}={}){
 if(root!==undefined&&(!path.isAbsolute(root)||/[\r\n\0]/.test(root)))throw fail('DIAGNOSE_ARGUMENT_INVALID');
 if(!root){try{const npm=resolveNpmCli({env});const {stdout}=await runCommand(process.execPath,[npm,'root','--global'],{env,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536});const modules=stdout.trim();if(!path.isAbsolute(modules)||/[\r\n\0]/.test(modules))throw fail('DIAGNOSE_ROOT_UNAVAILABLE');root=path.join(modules,'ziwei');}catch{throw fail('DIAGNOSE_ROOT_UNAVAILABLE');}}
 root=path.resolve(root);let meta;try{meta=restrictedJson(path.join(root,'package.json')).value;}catch{throw fail('DIAGNOSE_PACKAGE_INVALID');}
 if(meta?.name!=='ziwei'||meta.bin?.ziwei_user!=='scripts/ziwei-user.mjs')throw fail('DIAGNOSE_PACKAGE_INVALID');return root;
}

// node:http connects directly to the validated loopback address; machine proxy
// settings and external provider access do not turn an error into "absent".
export function probeRecoveryHealth(origin,{timeoutMs=3000,get=http.get}={}){
 return new Promise(resolve=>{
  let settled=false,request;const deadline=setTimeout(()=>{done({state:'timeout'});request?.destroy();},timeoutMs);const done=value=>{if(!settled){settled=true;clearTimeout(deadline);resolve(value);}};
  request=get(new URL('/healthz',origin),{agent:false},response=>{
   if(response.statusCode!==200){response.resume();done({state:'http_error',status:response.statusCode});return;}
   let size=0,body='';response.setEncoding('utf8');response.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>65536){done({state:'invalid_response'});request.destroy();}else body+=chunk;});
   response.on('error',()=>done({state:'unreachable'}));response.on('end',()=>{try{const value=JSON.parse(body);if(!value||typeof value!=='object'||Array.isArray(value)){done({state:'invalid_response'});return;}done({state:'present',identityMatches:value.service==='ziwei_user'&&value.agentId==='ziwei_user'&&value.workspace===POLICY.subject.workspace&&value.deviceId===POLICY.subject.deviceId});}catch{done({state:'invalid_response'});}});
  });
  request.setTimeout(timeoutMs,()=>{done({state:'timeout'});request.destroy();});
  request.on('error',error=>done({state:error?.code==='ECONNREFUSED'?'connection_refused':'unreachable'}));
 });
}

export async function diagnoseBotRecovery({root,env=process.env,platform=process.platform,locateRoot=resolveDiagnosticRoot,installedBuild=clientBuildIdentity,sourceSnapshot=inspectForceAbandonSourceSnapshot,inspectProcesses=inspectForceAbandonInstalledProcesses,inspectListeners=inspectForceAbandonListenerCount,probeHealth=probeRecoveryHealth}={}){
 if(platform!=='win32')return{schemaVersion:1,readOnly:true,state:'not_applicable',reasonCode:'WINDOWS_ONLY'};
 root=await locateRoot({root,env});
 const effectiveEnv={...env,ZIWEI_USER_HOME:env.ZIWEI_USER_HOME||defaultUserDir({platform,env})};
 const configPath=resolveConfigPath({root,env:effectiveEnv});let snapshot;try{snapshot=restrictedJson(configPath);}catch{throw fail('DIAGNOSE_CONFIG_UNAVAILABLE');}
 const config=snapshot.value;
 if(config?.workspace!==POLICY.subject.workspace||config?.deviceId!==POLICY.subject.deviceId)return{schemaVersion:1,readOnly:true,state:'not_applicable',reasonCode:'OTHER_DEVICE_OR_WORKSPACE'};
 const report={schemaVersion:1,readOnly:true,state:'diagnosed',subject:{actionId:POLICY.subject.actionId,scopeMatched:true},checks:[]};
 let origin;try{origin=forceAbandonHealthOrigin(config,effectiveEnv);}catch{report.checks.push({ruleId:'HEALTH_ORIGIN',state:'failed'});return report;}
 let baseline;try{baseline=sourceSnapshot(root);report.source={state:'readable',fileCount:baseline.length};}catch{report.source={state:'unknown'};}
 try{report.build={state:'checked',matches:installedBuild(root)===POLICY.holderBuild};}catch{report.build={state:'unknown'};}
 report.healthBefore=await probeHealth(origin);
 try{const rows=await inspectProcesses(root);if(!Array.isArray(rows))throw fail('DIAGNOSE_INTERNAL_FAILED');report.nativeInventory={state:'checked',count:rows.length};}catch(error){report.nativeInventory={state:'unknown',reasonCode:'NATIVE_INVENTORY_UNVERIFIED',ruleId:FORCE_ABANDON_NATIVE_RULES.includes(error?.recoveryRule)?error.recoveryRule:'NATIVE_COMMAND_FAILED',...(Number.isSafeInteger(error?.unreadableCount)&&error.unreadableCount>0?{unreadableCount:error.unreadableCount}:{})};}
 try{const count=await inspectListeners(origin);if(!Number.isSafeInteger(count)||count<0)throw fail('DIAGNOSE_INTERNAL_FAILED');report.listeners={state:'checked',count};}catch(error){report.listeners={state:'unknown',reasonCode:'NATIVE_LISTENER_UNVERIFIED',ruleId:FORCE_ABANDON_NATIVE_RULES.includes(error?.recoveryRule)?error.recoveryRule:'NATIVE_COMMAND_FAILED'};}
 report.healthAfter=await probeHealth(origin);
 try{report.source.unchanged=baseline!==undefined&&canonical(sourceSnapshot(root))===canonical(baseline);}catch{report.source.unchanged=false;report.source.state='unknown';}
 let currentConfig;try{currentConfig=restrictedJson(configPath);report.configurationUnchanged=currentConfig.sha256===snapshot.sha256;}catch{report.configurationUnchanged=false;}
 const runtimeDir=path.join(defaultUserDir({env:effectiveEnv}),'runtime');
 report.artifacts=inspectForceAbandonOfflineArtifacts({root,configPath,configHash:snapshot.sha256,config,runtimeDir});
 report.offlineObservationPassed=report.healthBefore.state==='connection_refused'&&report.healthAfter.state==='connection_refused'&&report.nativeInventory.state==='checked'&&report.nativeInventory.count===0&&report.listeners.state==='checked'&&report.listeners.count===0&&report.build.matches===true&&report.source.unchanged===true&&report.configurationUnchanged===true&&report.artifacts.checks.every(row=>row.state==='passed')&&report.artifacts.local.state==='passed';
 return report;
}

export async function runRecoveryDiagnostic({argv=process.argv.slice(2),diagnose=diagnoseBotRecovery,write=value=>process.stdout.write(value+'\n')}={}){
 try{if(argv.length!==0&&(argv.length!==2||argv[0]!=='--root'))throw fail('DIAGNOSE_ARGUMENT_INVALID');const report=await diagnose({root:argv[1]});write(ascii(report));return 0;}
 catch(error){write(ascii({schemaVersion:1,readOnly:true,state:'error',code:SAFE_CODES.has(error?.code)?error.code:'DIAGNOSE_INTERNAL_FAILED'}));return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)process.exitCode=await runRecoveryDiagnostic();
