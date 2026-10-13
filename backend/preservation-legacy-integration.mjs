import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createLegacySourceInterpreter} from './preservation-legacy-source.mjs';
import {createLoggerCoverageVerifier} from './preservation-legacy-coverage.mjs';
import {verifyLegacyArchive} from './preservation-legacy-archive.mjs';
import {digest,copyLegacyActionPolicy} from './version-preservation.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Object.assign(Error('Approved finite legacy source refused'),{code:'SOURCE_LEGACY_POLICY_REFUSED'});};
function readPlain(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)fail();
 for(let current=file;;current=path.dirname(current)){if(fs.lstatSync(current).isSymbolicLink())fail();if(path.dirname(current)===current)break;}
 const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.size>16n*1024n*1024n||fs.realpathSync.native(file)!==file)fail();
 const bytes=fs.readFileSync(file),after=fs.lstatSync(file,{bigint:true});if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs)fail();
 return{bytes,identity:{dev:String(before.dev),ino:String(before.ino)}};
}
/** Only immutable host refs from an independently verified source request may
 * select this fixed interpreter. No callback/function/coverage flag is decoded. */
export function loadApprovedLegacySource({binding,requestBinding}, {readBytes=readPlain}={}){
 const refs=binding.nativeSourceRefs||[],files=[],reads=new Map(),policies=[];
 const readRef=ref=>{if(reads.has(ref.canonicalPath))return reads.get(ref.canonicalPath);const result=readBytes(ref.canonicalPath);if(!result||!Buffer.isBuffer(result.bytes)||sha(result.bytes)!==ref.sha256||!result.identity)fail();reads.set(ref.canonicalPath,result);files.push({path:ref.canonicalPath,exists:true,sha256:ref.sha256,bytes:result.bytes.length,identity:result.identity});return result;};
 for(const ref of refs.filter(row=>row.kind==='legacy-action-assessment')){
  const bytes=readRef(ref).bytes;if(bytes.length>1024*1024)fail();let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail();}
  if(value?.kind==='ziwei-approved-legacy-source-v1')policies.push({ref,value});
 }
 if(!policies.length)return{legacySource:null,guardPolicy:null,files:[]};
 if(policies.length!==1)fail();const{ref:policyRef,value:authorization}=policies[0];
 if(authorization.hostId!==binding.hostId||policyRef.actionId!==authorization.subject?.actionId||!binding.workspaceIds.includes(authorization.workspaceId)||!binding.deviceIds.includes(authorization.deviceId))fail();
 const kinds={archive:'legacy-source-archive',cache:'legacy-action-cache',loggerStart:'legacy-action-logger',loggerEnd:'legacy-action-logger'};
 const approvedFile=(file,kind)=>{
  if(!file||typeof file.path!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>16*1024*1024)fail();
  const matched=refs.filter(row=>row.canonicalPath===file.path&&row.sha256===file.sha256&&(Array.isArray(kind)?kind.includes(row.kind):row.kind===kind)&&row.actionId===authorization.subject.actionId);
  if(matched.length!==1||readRef(matched[0]).bytes.length!==file.bytes)fail();return matched[0];
 };
 for(const[role,file]of Object.entries(authorization.artifacts||{}))approvedFile(file,kinds[role]||['legacy-action-assessment','maintenance-evidence']);
 const coverage=authorization.loggerCoverage;if(!coverage||digest(coverage.generation)!==digest(authorization.generation)||coverage.originalPid!==authorization.generation.pid||coverage.logDir!==authorization.generation.logDir||coverage.actionId!==authorization.subject.actionId||coverage.actionCreatedAt!==authorization.subject.fields.created_at)fail();
 for(const role of ['capture','loggerStart','loggerEnd'])if(digest(coverage[role])!==digest(authorization.artifacts[role==='capture'?'inspect':role]))fail();
 for(const role of ['producer','callRecords','codeReadCallRecords'])approvedFile(coverage[role],'legacy-source-code');
 const reader=file=>{
  if(reads.has(file))return readBytes(file); // Fresh read on every interpreter call.
  const client=binding.clients.filter(row=>row.configPath===file&&row.configSha256===authorization.generation.configSha256);if(client.length!==1)fail();return readBytes(file);
 };
 const verifyLoggerCoverage=createLoggerCoverageVerifier({pins:coverage,readBytes:file=>reader(file).bytes});
 const legacySource=createLegacySourceInterpreter({authorization,requestBinding,readBytes:reader,verifyLoggerCoverage});
 const archive=verifyLegacyArchive(reader(authorization.artifacts.archive.path).bytes,authorization.archivePolicy),authorizationDigest=digest(authorization);
 const requiredFiles=files.map(row=>({path:row.path,sha256:row.sha256}));
 const guardPolicy=copyLegacyActionPolicy({actionId:authorization.subject.actionId,actionDigest:authorization.subject.actionDigest,hostId:authorization.hostId,workspaceId:authorization.workspaceId,deviceId:authorization.deviceId,origin:authorization.origin,specHash:requestBinding.specHash,authorizationDigest,historicalGenerationDigest:digest(authorization.generation),policyDigest:archive.policyDigest,sourceDigest:digest({archive:archive.archiveSha256,build:archive.installedBuild,authorizationDigest}),cacheDigest:authorization.historicalCache.sha256,loggerDigest:digest(['loggerStart','loggerEnd'].map(role=>({path:authorization.artifacts[role].sourcePath,sha256:authorization.artifacts[role].sha256,bytes:authorization.artifacts[role].bytes}))),requiredFiles});
 return{legacySource,guardPolicy,files};
}
/** Independent private coordinator configuration. This is not a request option
 * or a source-host proof; the complete policy is copied before any schema write. */
export function loadPrivateLegacyGuardPolicy(env=process.env){
 const file=env.ZIWEI_PRODUCTION_LEGACY_GUARD_POLICY;if(!file)return null;
 try{return copyLegacyActionPolicy(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readPlain(file).bytes)));}catch{fail();}
}
