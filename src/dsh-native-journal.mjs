import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.entries(item).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b))):item);
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function createDshNativeMutationJournal({directory}={}){
 if(!directory)throw new TypeError('DSH mutation journal directory is required');
 const active=new Map();
 const fileFor=id=>path.join(directory,`${hash(id)}.json`);
 function read(id){
  try{return JSON.parse(fs.readFileSync(fileFor(id),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 function save(record){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const target=fileFor(record.actionId),temporary=`${target}.${randomUUID()}.tmp`;let fd;
  try{fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,target);}
  finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 }
 function unknown(operation){
  return{schemaVersion:1,subject:operation.subject,scope:operation.scope,source:'dsh-native',checkedAt:new Date().toISOString(),resource:operation.resource,operation:operation.operation,status:'unknown',reasonCode:'DSH_NATIVE_OUTCOME_UNKNOWN',data:{error:{code:'DSH_NATIVE_OUTCOME_UNKNOWN'}}};
 }
 async function run(action,execute){
  const operation=action?.payload?.dshOperation;
  if(typeof action?.id!=='string'||!action.id||!object(operation?.subject)||!object(operation.scope)||typeof execute!=='function')throw new TypeError('DSH mutation journal requires an action and executor');
  const binding=hash(canonical({subject:operation.subject,scope:operation.scope,resource:operation.resource,operation:operation.operation,input:operation.input})),previous=read(action.id);
  if(previous&&previous.binding!==binding)fail('DSH_NATIVE_JOURNAL_BINDING_CHANGED');
  if(active.has(action.id))return active.get(action.id);
  if(previous)return previous.phase==='settled'?previous.result:unknown(operation);
  const record={version:1,actionId:action.id,binding,phase:'prepared'};
  save(record);
  const pending=(async()=>{
   let result;try{result=await execute(action);}catch{return unknown(operation);}
   save({...record,phase:'settled',result});return result;
  })().finally(()=>active.delete(action.id));
  active.set(action.id,pending);return pending;
 }
 return{run};
}
