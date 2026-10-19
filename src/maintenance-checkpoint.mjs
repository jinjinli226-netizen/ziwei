import path from 'node:path';

const branded=new WeakMap();
const fields=['schemaVersion','actionId','executionBinding','updateId','targetBuild','runtime','profile','home','cwd','sessionId','checkpointDigest','messageCount','pendingTools','processExit'];
const exitFields=new Set(['platform','supervisor','launched','rootPid','rootConfirmed','rootExitCode','treeConfirmed','activeProcesses','cancelled','backgroundProcessesRetained','failureCode','hostExitCode','signal','hostSignal','streamsComplete']);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const absolute=v=>typeof v==='string'&&v.length>0&&v.length<=32767&&!v.includes('\0')&&(path.win32.isAbsolute(v)||path.posix.isAbsolute(v));
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const canonical=v=>JSON.stringify(v,(_k,x)=>plain(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};

/** A checkpoint proves only this local invocation exited at a completed tool
 * boundary. It never declares the task or a remote phone operation complete. */
export function validateMaintenancePause(receipt,expected={}){
 try{
  if(!plain(receipt)||Object.keys(receipt).length!==fields.length||fields.some(k=>!Object.hasOwn(receipt,k))||receipt.schemaVersion!==1||!identifier(receipt.actionId)||!identifier(receipt.updateId)||![receipt.executionBinding,receipt.targetBuild,receipt.checkpointDigest].every(hex)||receipt.runtime!=='Hermes'||typeof receipt.profile!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(receipt.profile)||!absolute(receipt.home)||!absolute(receipt.cwd)||!identifier(receipt.sessionId)||!Number.isSafeInteger(receipt.messageCount)||receipt.messageCount<=0||receipt.pendingTools!==0)return false;
  const e=receipt.processExit;
  if(!plain(e)||Object.keys(e).some(k=>!exitFields.has(k))||e.launched!==true||e.rootConfirmed!==true||e.treeConfirmed!==true||!Number.isSafeInteger(e.rootPid)||e.rootPid<=0||e.rootExitCode!==0||e.activeProcesses!==0||e.cancelled!==false||e.backgroundProcessesRetained===true||e.failureCode!=null||e.signal!=null||e.hostSignal!=null||e.streamsComplete!==undefined&&e.streamsComplete!==true||!['win32','linux','darwin'].includes(e.platform)||!['windows-job','direct'].includes(e.supervisor)||e.platform==='win32'&&(e.supervisor!=='windows-job'||e.hostExitCode!==0))return false;
  if(!plain(expected)||Object.keys(expected).some(k=>!fields.includes(k)))return false;
  return Object.entries(expected).every(([k,v])=>canonical(receipt[k])===canonical(v));
 }catch{return false;}
}
export function markMaintenancePaused(result,receipt){
 if(!plain(result)||result.status!=='maintenance_paused'||!validateMaintenancePause(receipt)||branded.has(result))throw Object.assign(new Error('Invalid maintenance checkpoint'),{code:'MAINTENANCE_CHECKPOINT_INVALID'});
 branded.set(result,freeze(JSON.parse(JSON.stringify(receipt))));return result;
}
export function consumeMaintenancePaused(result){const receipt=result&&typeof result==='object'?branded.get(result):null;if(receipt)branded.delete(result);return receipt||null;}
