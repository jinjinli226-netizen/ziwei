import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
// Formal production wiring uses the frozen product ABI. Existing generic
// exports below remain isolated fixture utilities.
export {createProductionProofProvider,createSourceCliTransport} from './r01-production-wire.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function canonical(value){
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(canonical);
  if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  fail('OPS_NON_JSON_VALUE');
}
export const canonicalDigest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(canonical(value)));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function plain(file){
  if(!path.isAbsolute(file))fail('OPS_ABSOLUTE_PATH_REQUIRED');
  const absolute=path.resolve(file);
  let current=absolute;
  while(true){if(fs.lstatSync(current).isSymbolicLink())fail('OPS_PATH_LINKED');const parent=path.dirname(current);if(parent===current)break;current=parent;}
  if(fs.realpathSync.native(absolute).toLowerCase()!==absolute.toLowerCase())fail('OPS_PATH_REDIRECTED');
  return absolute;
}
function inside(root,file){const rel=path.relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel);}

/** Controller-owned functions and independent trust only. Spec never supplies
 * a function/key/transport; original signed envelopes are forwarded unchanged.
 * verifyEnvelope must be the frozen product verifier (fixture verifier in tests).
 */
export function createProofProvider({trust,runTransport,verifyEnvelope}={}){
  if(typeof verifyEnvelope!=='function')fail('OPS_VERIFIER_REQUIRED');
  if(typeof runTransport!=='function')fail('OPS_TRANSPORT_REQUIRED');
  if(trust?.schemaVersion!==1||!trust.hosts||Object.getPrototypeOf(trust.hosts)!==Object.prototype)fail('OPS_TRUST_INVALID');
  const trusted=copy(trust),used=new Set();let prior=null;
  function validate(input,stage){
    const allowed=stage==='collect'?['challenge','operationId','specHash','databaseIdentity','freezeDigest','actionProjection','requiredHosts']:['freshChallenge','operationId','specHash','databaseIdentity','freezeDigest','priorEvidenceDigest','requiredHosts'];
    if(!input||Object.keys(input).some(key=>!allowed.includes(key))||allowed.some(key=>!(key in input)))fail('OPS_REQUEST_FIELDS_INVALID');
    const value=copy(input),challenge=stage==='collect'?value.challenge:value.freshChallenge;
    if(typeof challenge!=='string'||challenge.length<16||challenge.length>256||!/^[-a-zA-Z0-9_]+$/.test(challenge))fail('OPS_CHALLENGE_INVALID');
    if(!/^[-a-zA-Z0-9_]{1,128}$/.test(value.operationId)||!hex(value.specHash)||!hex(value.freezeDigest)||!value.databaseIdentity||typeof value.databaseIdentity!=='object')fail('OPS_REQUEST_BINDING_INVALID');
    if(!Array.isArray(value.requiredHosts)||value.requiredHosts.length<1||value.requiredHosts.length>32||new Set(value.requiredHosts).size!==value.requiredHosts.length||value.requiredHosts.some(host=>typeof host!=='string'||!host))fail('OPS_REQUIRED_HOSTS_INVALID');
    for(const hostId of value.requiredHosts){const host=trusted.hosts[hostId];if(!host||host.hostId!==hostId||!hex(host.collectorSha256))fail('OPS_HOST_NOT_TRUSTED');}
    if(used.has(challenge))fail('OPS_CHALLENGE_REUSED');
    if(stage==='recheck'&&(!prior||value.operationId!==prior.operationId||value.specHash!==prior.specHash||value.freezeDigest!==prior.freezeDigest||canonicalDigest(value.databaseIdentity)!==prior.databaseDigest||canonicalDigest(value.requiredHosts)!==prior.hostsDigest||value.priorEvidenceDigest!==prior.evidenceDigest))fail('OPS_RECHECK_BINDING_INVALID');
    // A timeout/unknown response never licenses replay of an accepted request.
    used.add(challenge);return value;
  }
  async function dispatch(input,stage){
    const request=validate(input,stage),envelopes=[];
    for(const hostId of request.requiredHosts){
      const host=trusted.hosts[hostId],context={host:copy(host),stage,request:copy(request)};
      const envelope=await runTransport(copy(host),{stage,request:copy(request)});
      if(!envelope||Array.isArray(envelope)||Object.getPrototypeOf(envelope)!==Object.prototype||await verifyEnvelope(envelope,context)!==true)fail('OPS_ENVELOPE_REJECTED');
      envelopes.push(copy(envelope));
    }
    if(stage==='collect')prior={operationId:request.operationId,specHash:request.specHash,freezeDigest:request.freezeDigest,databaseDigest:canonicalDigest(request.databaseIdentity),hostsDigest:canonicalDigest(request.requiredHosts),evidenceDigest:canonicalDigest(envelopes)};
    return envelopes;
  }
  return Object.freeze({collect:input=>dispatch(input,'collect'),recheck:input=>dispatch(input,'recheck')});
}

/** Local read-only collector transport. Real production use additionally needs
 * the reviewed source CLI/argument contract and native namespace check.
 * No shell, business command, automatic retry or peer-selected executable.
 */
export function createPinnedProcessTransport({privateRoot,maxBytes=8*1024*1024,timeoutMs=30000}={}){
  const root=plain(privateRoot);
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16*1024*1024||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)fail('OPS_TRANSPORT_BOUNDS_INVALID');
  return async(host,input)=>{
    const transport=host?.transport;
    if(transport?.kind!=='pinned-process')fail('OPS_TRANSPORT_KIND_INVALID');
    const entry=plain(transport.entry),cwd=plain(transport.cwd),executable=plain(transport.executable);
    if(!inside(root,entry)||cwd!==root&&!inside(root,cwd)||path.extname(entry)!=='.mjs')fail('OPS_TRANSPORT_SCOPE_INVALID');
    if(!hex(transport.collectorSha256)||sha(entry)!==transport.collectorSha256)fail('OPS_COLLECTOR_CHANGED');
    if(!hex(transport.executableSha256)||sha(executable)!==transport.executableSha256)fail('OPS_EXECUTABLE_CHANGED');
    if(!Array.isArray(transport.args)||transport.args.length>16||transport.args.some(arg=>typeof arg!=='string'||arg.length>4096||/[\r\n\0]/.test(arg)))fail('OPS_TRANSPORT_ARGS_INVALID');
    const payload=Buffer.from(JSON.stringify(copy(input)));if(payload.length>maxBytes)fail('OPS_REQUEST_TOO_LARGE');
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','SYSTEMROOT','SYSTEMDRIVE','COMSPEC','TEMP','TMP','USERPROFILE','HOME','LOCALAPPDATA','APPDATA'].includes(key.toUpperCase())));
    return await new Promise((resolve,reject)=>{
      const child=spawn(executable,[entry,...transport.args],{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      let chunks=[],length=0,ended=false;
      const rejectOnce=code=>{if(ended)return;ended=true;clearTimeout(timer);child.kill();reject(Object.assign(new Error(code),{code}));};
      const timer=setTimeout(()=>rejectOnce('OPS_TRANSPORT_TIMEOUT'),timeoutMs);
      child.on('error',()=>rejectOnce('OPS_TRANSPORT_START_FAILED'));
      child.stdin.on('error',()=>rejectOnce('OPS_TRANSPORT_INPUT_FAILED'));
      child.stderr.on('data',()=>{}); // Never disclose source stderr or secret paths.
      child.stdout.on('data',chunk=>{length+=chunk.length;if(length>maxBytes)rejectOnce('OPS_RESPONSE_TOO_LARGE');else chunks.push(chunk);});
      child.on('close',code=>{if(ended)return;ended=true;clearTimeout(timer);if(code!==0)return reject(Object.assign(new Error('OPS_TRANSPORT_FAILED'),{code:'OPS_TRANSPORT_FAILED'}));try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!result||Array.isArray(result)||typeof result!=='object')fail('OPS_RESPONSE_INVALID');resolve(result);}catch{reject(Object.assign(new Error('OPS_RESPONSE_INVALID'),{code:'OPS_RESPONSE_INVALID'}));}});
      child.stdin.end(payload);
    });
  };
}
