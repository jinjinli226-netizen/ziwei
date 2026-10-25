import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {defaultUserDir} from '../daemon/config.mjs';
import {canonicalSecretBinding,openSecret} from './bot-secret-crypto.mjs';

function dpapi(value,operation){if(process.platform!=='win32')throw new Error('BOT_SECRET_OS_STORE_UNSUPPORTED');const script=`Add-Type -AssemblyName System.Security; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;try{return Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:Buffer.from(value).toString('base64'),encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim(),'base64');}catch{throw new Error('BOT_SECRET_OS_STORE_FAILED');}}
export const protectDeviceSecret=value=>dpapi(value,'Protect');
export const unprotectDeviceSecret=value=>dpapi(value,'Unprotect');
export function botSecretDirectory({apiBase,workspace,deviceId}){return path.join(defaultUserDir(),'bot-provider-secrets',createHash('sha256').update(canonicalSecretBinding({origin:new URL(apiBase).origin,workspace,deviceId})).digest('hex'));}
export function createBotDeviceSecretStore({directory,protect=protectDeviceSecret,unprotect=unprotectDeviceSecret}={}){
 function safe(file){if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('BOT_SECRET_PATH_INVALID');}
 safe(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 function write(file,value){safe(file);const tmp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,value,{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}}
 const identityFile=path.join(directory,'identity.dpapi');safe(identityFile);
 let identity;
 function deviceIdentity(){if(!identity){if(fs.existsSync(identityFile)){const raw=unprotect(fs.readFileSync(identityFile));try{identity=JSON.parse(raw.toString());}finally{raw.fill(0);}}else{identity=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});const raw=Buffer.from(JSON.stringify(identity));try{const tmp=identityFile+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,protect(raw),{mode:0o600,flag:'wx'});try{fs.linkSync(tmp,identityFile);}catch(error){if(error.code!=='EEXIST')throw error;const existing=unprotect(fs.readFileSync(identityFile));try{identity=JSON.parse(existing.toString());}finally{existing.fill(0);}}}finally{try{fs.unlinkSync(tmp);}catch{}}}finally{raw.fill(0);}}}return{publicKey:identity.publicKey};}
 function file(id){return path.join(directory,createHash('sha256').update(id).digest('hex')+'.dpapi');}
 function read(id){const target=file(id);safe(target);if(!fs.existsSync(target))return null;const raw=unprotect(fs.readFileSync(target));try{return JSON.parse(raw.toString());}finally{raw.fill(0);}}
 function applyUnlocked(delivery){if(delivery.blocked||!delivery.binding||delivery.binding.purpose!=='bot-provider-key'||delivery.employeeId!==delivery.binding.employeeId||delivery.version!==delivery.binding.version)throw new Error('BOT_SECRET_BINDING_CONFLICT');const previous=read(delivery.employeeId);if(previous&&previous.version>delivery.version)throw new Error('BOT_SECRET_STALE_DELIVERY');if(previous&&previous.version===delivery.version){if(canonicalSecretBinding(previous.binding)!==canonicalSecretBinding(delivery.binding)||previous.operation!==delivery.operation)throw new Error('BOT_SECRET_BINDING_CONFLICT');return;}
 deviceIdentity();let secret=null;if(delivery.operation==='replace'){secret=openSecret(identity.privateKey,delivery.binding,delivery.envelope);if(!secret||Buffer.byteLength(secret)>4096||/[\0\r\n]/.test(secret))throw new Error('BOT_SECRET_VALUE_INVALID');}else if(delivery.operation!=='clear')throw new Error('BOT_SECRET_OPERATION_INVALID');const raw=Buffer.from(JSON.stringify({version:delivery.version,binding:delivery.binding,operation:delivery.operation,secret}));try{write(file(delivery.employeeId),protect(raw));}finally{raw.fill(0);secret=null;}}
 function applyDelivery(delivery){const lock=file(delivery.employeeId)+'.lock';safe(lock);let fd;for(let i=0;i<30;i++){try{fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,String(process.pid));break;}catch(error){if(error.code!=='EEXIST')throw error;let pid;try{pid=Number(fs.readFileSync(lock,'utf8'));if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(probe){if(probe.code==='ESRCH'){fs.unlinkSync(lock);continue;}}}}catch{}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}if(fd===undefined)throw new Error('BOT_SECRET_STORE_BUSY');try{return applyUnlocked(delivery);}finally{fs.closeSync(fd);fs.unlinkSync(lock);}}
 function readCredential(binding){const saved=read(binding.employeeId);if(!saved||canonicalSecretBinding(saved.binding)!==canonicalSecretBinding(binding)||saved.operation!=='replace')throw new Error('BOT_SECRET_NOT_CONFIGURED');return saved.secret;}
 function openBoundSecret(binding,envelope){deviceIdentity();return openSecret(identity.privateKey,binding,envelope);}
 function hasIndependentCredential(employeeId){return Boolean(read(employeeId));}
 return{deviceIdentity,applyDelivery,readCredential,openBoundSecret,hasIndependentCredential};
}
