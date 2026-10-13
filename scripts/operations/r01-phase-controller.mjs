import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {canonicalDigest} from './r01-proof-provider.mjs';
export {createProductionPhaseController} from './r01-production-wire.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const commands=['inspect','prepare','seal','restore','abort'];
const expectedState={prepare:'preparing',seal:'sealed',restore:'restored',abort:'restored'};
function plain(file){const full=path.resolve(file);if(!path.isAbsolute(file))fail('OPS_ABSOLUTE_PATH_REQUIRED');let cursor=full;while(true){if(fs.lstatSync(cursor).isSymbolicLink())fail('OPS_PATH_LINKED');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}if(fs.realpathSync.native(full).toLowerCase()!==full.toLowerCase())fail('OPS_PATH_REDIRECTED');return full;}
function within(root,file){const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);}
function newJson(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function saveLedger(file,value){const temporary=file+'.'+crypto.randomUUID()+'.next';const handle=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(handle,JSON.stringify(value)+'\n');fs.fsyncSync(handle);}finally{fs.closeSync(handle);}fs.renameSync(temporary,file);}
function validateSpec(spec){if(spec?.schemaVersion!==1||spec.mode!=='production'||!/^[-a-zA-Z0-9_]{1,128}$/.test(spec.operationId||''))fail('OPS_SPEC_INVALID');const {specHash,...body}=spec;if(specHash!==canonicalDigest(body))fail('OPS_SPEC_HASH_MISMATCH');if(['trust','privateKey','key','backupProof'].some(key=>key in spec))fail('OPS_SPEC_TRUST_INJECTION');}
function immutableCopy(value){canonicalDigest(value);const result=JSON.parse(JSON.stringify(value));const freeze=item=>{if(item&&typeof item==='object'){Object.values(item).forEach(freeze);Object.freeze(item);}return item;};return freeze(result);}

/** Read-only dependency report, executable before product interface delivery.
 * Existence is only reported, never treated as hash/QA/production acceptance.
 */
export function describeOpsPlan({packageRoot}={}){
  const root=plain(packageRoot),required=['backend/production-preservation.mjs','scripts/production-source-proof.mjs'];
  return {mode:'plan',willApply:false,productionReady:false,packageRoot:root,missing:required.filter(file=>!fs.existsSync(path.join(root,file))),requiredBeforeApply:['frozen accepted candidate and six artifacts/two manifests','independent trust and pinned product/source API','exact product envelope/spec/backup schema','source signer and verifier private ops key references','native stopped-writers/tree and full claim evidence','backup/restore-read signed proof','Q G1-G5 and formal-entry acceptance'],phaseOrder:['stage','original V1 pause/drain/stop and original tree proof','offline init/prepare/seal','read sealed persistent receipt','install/start fenced role','inspect actual role/build','V2 restore still paused']};
}

/** Only the exact independently pinned E02 product adapter can mutate. The
 * normalizer/verifiers are trusted controller code, never JSON-spec functions.
 * Ledger tracks controller uncertainty; it never edits product phases, native
 * journals/statuses or replays an accepted request to recover a lost receipt.
 */
export function createPhaseController({privateRoot,journalDirectory,productAdapter,readReceipt,verifyReleaseGate,verifyBackupProof,proofProvider}={}){
  const root=plain(privateRoot),directory=path.resolve(journalDirectory||'');
  if(!within(root,directory))fail('OPS_PRIVATE_OUTPUT_REQUIRED');plain(path.dirname(directory));
  const ledgerFile=path.join(directory,'ledger.json');
  const load=()=>fs.existsSync(ledgerFile)?JSON.parse(fs.readFileSync(plain(ledgerFile),'utf8')):null;
  function product(){if(typeof productAdapter?.runProductionPreservation!=='function'||typeof productAdapter?.validateProductionSpec!=='function'||typeof readReceipt!=='function')fail('OPS_PRODUCT_ENTRY_UNAVAILABLE');}
  function receipt(result,spec){const value=readReceipt(result);if(!value||value.operationId!==spec.operationId||value.specHash!==spec.specHash||!['v2','preparing','sealed','restored'].includes(value.state)||!['v2','v1-compat'].includes(value.role))fail('OPS_RECEIPT_INVALID');return JSON.parse(JSON.stringify(value));}
  async function run({command='inspect',apply=false,spec,trust,backupProof}={}){
    if(!commands.includes(command)||typeof apply!=='boolean')fail('OPS_COMMAND_INVALID');
    if(command==='inspect'&&apply)fail('OPS_INSPECT_IS_READ_ONLY');
    if(!trust||trust===spec)fail('OPS_INDEPENDENT_TRUST_REQUIRED');
    spec=immutableCopy(spec);trust=immutableCopy(trust);if(backupProof!==undefined)backupProof=immutableCopy(backupProof);
    product();validateSpec(spec);
    const prior=load();if(prior&&(prior.operationId!==spec.operationId||prior.specHash!==spec.specHash))fail('OPS_JOURNAL_OPERATION_CONFLICT');
    if(apply&&prior?.pending)fail('OPS_INSPECT_REQUIRED');
    if(apply){
      if(typeof verifyReleaseGate!=='function'||await verifyReleaseGate({spec,trust})!==true)fail('OPS_RELEASE_GATE_NOT_ACCEPTED');
      if(typeof proofProvider?.collect!=='function'||typeof proofProvider?.recheck!=='function')fail('OPS_PROOF_PROVIDER_REQUIRED');
      if(command==='seal'&&(!backupProof||typeof verifyBackupProof!=='function'||await verifyBackupProof(backupProof,{spec,trust})!==true))fail('OPS_BACKUP_PROOF_REQUIRED');
      if(command==='restore'){
        const current=receipt(await productAdapter.runProductionPreservation({command:'inspect',apply:false,spec,trust,proofProvider}),spec);
        if(current.role!=='v2')fail('OPS_COMPAT_CANNOT_RESTORE');
      }
    }
    // Plans/inspect call only product's explicitly read-only path. Missing
    // schema/legacy bootstrap is the product's job; no createApp/schema fallback.
    if(!apply){
      const result=await productAdapter.runProductionPreservation({command,apply:false,spec,trust,proofProvider,...(backupProof?{backupProof}:{})});
      const observed=receipt(result,spec);
      if(prior?.pending&&command==='inspect'&&observed.state===expectedState[prior.pending.command]||!prior){
        fs.mkdirSync(directory,{recursive:true,mode:0o700});plain(directory);
        const lock=path.join(directory,'controller.lock'),nonce=crypto.randomUUID();let handle;
        try{handle=fs.openSync(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')return {mode:'plan',willApply:false,result,recoveryBlockedByController:true};throw error;}
        try{
          fs.writeFileSync(handle,JSON.stringify({pid:process.pid,nonce}));fs.fsyncSync(handle);fs.closeSync(handle);handle=undefined;
          const latest=load();
          if(prior?.pending&&latest?.pending?.attempt===prior.pending.attempt){
            saveLedger(ledgerFile,{...latest,pending:null,lastReceipt:observed});
            newJson(path.join(directory,crypto.randomUUID()+'-recovered.json'),{operationId:spec.operationId,specHash:spec.specHash,recoveredByReadOnlyInspect:true,receiptDigest:canonicalDigest(observed),at:new Date().toISOString()});
          }else if(!latest)saveLedger(ledgerFile,{operationId:spec.operationId,specHash:spec.specHash,pending:null,lastReceipt:observed});
        }finally{if(handle!==undefined)fs.closeSync(handle);const own=JSON.parse(fs.readFileSync(lock,'utf8'));if(own.nonce===nonce&&own.pid===process.pid)fs.unlinkSync(lock);}
      }
      return {mode:'plan',willApply:false,result};
    }
    fs.mkdirSync(directory,{recursive:true,mode:0o700});plain(directory);
    const lock=path.join(directory,'controller.lock'),nonce=crypto.randomUUID();let handle;
    try{handle=fs.openSync(lock,'wx',0o600);fs.writeFileSync(handle,JSON.stringify({pid:process.pid,nonce}));fs.fsyncSync(handle);}catch{if(handle!==undefined)fs.closeSync(handle);fail('OPS_CONTROLLER_LOCKED');}fs.closeSync(handle);
    const attempt=crypto.randomUUID(),pending={attempt,command,operationId:spec.operationId,specHash:spec.specHash,at:new Date().toISOString()};
    try{
      // Re-read under lock; another operator may have changed the ledger while
      // gate/backup checks awaited. Do not use the old pre-lock state.
      const current=load();if(current&&(current.pending||current.operationId!==spec.operationId||current.specHash!==spec.specHash))fail('OPS_INSPECT_REQUIRED');
      newJson(path.join(directory,attempt+'-request.json'),{...pending,apply:true,backupProofDigest:backupProof?canonicalDigest(backupProof):null});
      saveLedger(ledgerFile,{operationId:spec.operationId,specHash:spec.specHash,pending,lastReceipt:current?.lastReceipt||null});
      try{
        const result=await productAdapter.runProductionPreservation({command,apply:true,spec,trust,proofProvider,...(backupProof?{backupProof}:{})});
        const actual=receipt(result,spec);if(actual.state!==expectedState[command])fail('OPS_RECEIPT_INVALID');
        newJson(path.join(directory,attempt+'-receipt.json'),{operationId:spec.operationId,specHash:spec.specHash,command,receiptDigest:canonicalDigest(actual),at:new Date().toISOString()});
        saveLedger(ledgerFile,{operationId:spec.operationId,specHash:spec.specHash,pending:null,lastReceipt:actual});
        return {mode:'applied',command,result};
      }catch(error){newJson(path.join(directory,attempt+'-unknown.json'),{operationId:spec.operationId,specHash:spec.specHash,command,outcome:'unknown',errorClass:error.constructor?.name||'Error',at:new Date().toISOString()});fail('OPS_PRODUCT_OUTCOME_UNKNOWN');}
    }finally{
      // Release only this own lock. A stale/foreign lock is never removed.
      if(fs.existsSync(lock)){const value=JSON.parse(fs.readFileSync(lock,'utf8'));if(value.nonce===nonce&&value.pid===process.pid)fs.unlinkSync(lock);}
    }
  }
  return Object.freeze({run});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const args=process.argv.slice(2),index=args.indexOf('--package-root');if(args[0]!=='plan'||index<0||!args[index+1]||args.includes('--apply'))fail('OPS_PLAN_ONLY_ENTRY');console.log(JSON.stringify(describeOpsPlan({packageRoot:path.resolve(args[index+1])}),null,2));}
  catch(error){console.error(JSON.stringify({code:/^OPS_[A-Z0-9_]+$/.test(error.code||'')?error.code:'OPS_PLAN_FAILED',willApply:false,productionReady:false}));process.exitCode=1;}
}
