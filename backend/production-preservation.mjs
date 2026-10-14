import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {types} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createPreservation,FROZEN_VERSIONS,PRODUCT_ROLE,digest,uncertain,exitedTree,copyLegacyActionPolicy} from './version-preservation.mjs';
import {readDatabaseSnapshot,nativeActionDigest} from './preservation-native-databases.mjs';
import {verifyPreservationPackages} from '../scripts/verify-preservation-packages.mjs';
import {validateNativeSourceRefs,namespaceCaptureFile,verifyRuntimeCaptureEnvelope} from './preservation-source-namespace.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[-a-zA-Z0-9_]{1,128}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const compare=(a,b)=>a<b?-1:a>b?1:0;

/** Encode sorted pairs directly: putting them back in an object reorders numeric keys. */
export function canonicalProduction(value){
 const seen=new Set();
 function encode(item,depth){
  if(depth>128)fail('PRODUCTION_NON_JSON');
  if(item===null||typeof item==='string'||typeof item==='boolean')return JSON.stringify(item);
  if(typeof item==='number'){if(!Number.isFinite(item))fail('PRODUCTION_NON_JSON');return JSON.stringify(item);}
  if(typeof item!=='object'||types.isProxy(item)||seen.has(item))fail('PRODUCTION_NON_JSON');
  const proto=Object.getPrototypeOf(item),array=Array.isArray(item);
  if(proto!==(array?Array.prototype:Object.prototype))fail('PRODUCTION_NON_JSON');
  if(Object.hasOwn(Object.prototype,'toJSON')||array&&Object.hasOwn(Array.prototype,'toJSON'))fail('PRODUCTION_NON_JSON');
  const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string'||key==='toJSON'||!('value' in descriptors[key])||(!descriptors[key].enumerable&&!(array&&key==='length'))))fail('PRODUCTION_NON_JSON');
  seen.add(item);let result;
  if(array){
   if(keys.length!==item.length+1||keys.some(key=>key!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=item.length)))fail('PRODUCTION_NON_JSON');
   result='['+Array.from({length:item.length},(_,index)=>encode(descriptors[String(index)].value,depth+1)).join(',')+']';
  }else result='{'+keys.sort(compare).map(key=>JSON.stringify(key)+':'+encode(descriptors[key].value,depth+1)).join(',')+'}';
  seen.delete(item);return result;
 }
 return encode(value,0);
}
export const digestProduction=value=>hash(canonicalProduction(value));
const copy=value=>JSON.parse(canonicalProduction(value));
const equal=(a,b)=>digestProduction(a)===digestProduction(b);
function fields(value,required,optional=[]){
 canonicalProduction(value);
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('PRODUCTION_FIELDS_INVALID');
}
function argumentsObject(input,allowed){
 if(!input||typeof input!=='object'||types.isProxy(input)||Object.getPrototypeOf(input)!==Object.prototype)fail('PRODUCTION_ARGUMENT_INVALID');
 const descriptors=Object.getOwnPropertyDescriptors(input);
 if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||!allowed.includes(key)||!descriptors[key].enumerable||!('value' in descriptors[key])))fail('PRODUCTION_ARGUMENT_INVALID');
 return Object.fromEntries(Object.entries(descriptors).map(([key,row])=>[key,row.value]));
}
function unique(values,code='PRODUCTION_SCOPE_INVALID'){
 if(!Array.isArray(values)||new Set(values).size!==values.length)fail(code);
 return values;
}
function privateFile(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)fail('PRODUCTION_PATH_INVALID');
 let cursor=file;
 while(true){if(fs.lstatSync(cursor).isSymbolicLink())fail('PRODUCTION_PATH_LINKED');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
 const stat=fs.lstatSync(file,{bigint:true});
 if(!stat.isFile()||stat.nlink!==1n||fs.realpathSync.native(file)!==file)fail('PRODUCTION_PATH_INVALID');
 return stat;
}
export function productionDatabaseIdentity(database){
 fields(database,['path','canonicalPath','identity','databaseId']);fields(database.identity,['dev','ino']);
 if(database.path!==database.canonicalPath||!uuid(database.databaseId)||typeof database.identity.dev!=='string'||typeof database.identity.ino!=='string')fail('PRODUCTION_DATABASE_IDENTITY');
 const stat=privateFile(database.path);
 if(String(stat.dev)!==database.identity.dev||String(stat.ino)!==database.identity.ino)fail('PRODUCTION_DATABASE_IDENTITY');
 return copy(database);
}
function validateTrust(trust){
 fields(trust,['schemaVersion','algorithm','hosts','approvedSpecs'],['backupHostId']);
 if(trust.schemaVersion!==1||trust.algorithm!=='hmac-sha256'||!Array.isArray(trust.hosts)||!trust.hosts.length||!Array.isArray(trust.approvedSpecs))fail('PRODUCTION_TRUST_INVALID');
 unique(trust.hosts.map(host=>host.hostId),'PRODUCTION_TRUST_INVALID');
 unique(trust.hosts.map(host=>host.keyId),'PRODUCTION_TRUST_INVALID');
 for(const host of trust.hosts){fields(host,['hostId','keyId','keyRef','bindingDigest']);if(!id(host.hostId)||!id(host.keyId)||!hex(host.bindingDigest))fail('PRODUCTION_TRUST_INVALID');privateFile(host.keyRef);}
 for(const pin of trust.approvedSpecs){fields(pin,['operationId','specHash']);if(!id(pin.operationId)||!hex(pin.specHash))fail('PRODUCTION_TRUST_INVALID');}
 if(trust.backupHostId!==undefined&&!trust.hosts.some(host=>host.hostId===trust.backupHostId))fail('PRODUCTION_TRUST_INVALID');
 return trust;
}
function trustedKey(trust,hostId,keyId){
 validateTrust(trust);
 const host=trust.hosts.find(row=>row.hostId===hostId);
 if(!host||keyId!==undefined&&host.keyId!==keyId)fail('PRODUCTION_SIGNER_INVALID');
 const stat=privateFile(host.keyRef);
 if(process.platform!=='win32'&&(stat.mode&0o077n)!==0n)fail('PRODUCTION_KEY_NOT_PRIVATE');
 const bytes=fs.readFileSync(host.keyRef);
 if(bytes.length<32)fail('PRODUCTION_KEY_INVALID');
 return {host,bytes};
}
export function signProductionEnvelope(input){
 const {hostId,payload,trust}=argumentsObject(input,['hostId','payload','trust']);
 canonicalProduction(payload);const {host,bytes}=trustedKey(trust,hostId);
 return {schemaVersion:1,algorithm:'hmac-sha256',hostId,keyId:host.keyId,payload:copy(payload),signature:crypto.createHmac('sha256',bytes).update(canonicalProduction(payload)).digest('hex')};
}
export function verifyProductionEnvelope(input){
 const {envelope,trust,expected={},now=Date.now()}=argumentsObject(input,['envelope','trust','expected','now']);
 fields(envelope,['schemaVersion','algorithm','hostId','keyId','payload','signature']);canonicalProduction(expected);
 if(envelope.schemaVersion!==1||envelope.algorithm!=='hmac-sha256'||!hex(envelope.signature))fail('PRODUCTION_ENVELOPE_INVALID');
 const {bytes}=trustedKey(trust,envelope.hostId,envelope.keyId);
 const signature=crypto.createHmac('sha256',bytes).update(canonicalProduction(envelope.payload)).digest();
 if(!crypto.timingSafeEqual(signature,Buffer.from(envelope.signature,'hex')))fail('PRODUCTION_SIGNATURE_INVALID');
 for(const [key,value] of Object.entries(expected))if(!Object.hasOwn(envelope.payload,key)||!equal(envelope.payload[key],value))fail('PRODUCTION_PROOF_BINDING');
 if(Object.hasOwn(envelope.payload,'issuedAt')||Object.hasOwn(envelope.payload,'expiresAt'))validateProductionFreshness(envelope.payload,now);
 return copy(envelope.payload);
}
export function validateProductionFreshness(payload,now=Date.now()){
 const {issuedAt,expiresAt,challenge}=payload;
 const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 if(!uuid(challenge)||!iso(issuedAt)||!iso(expiresAt)||!Number.isFinite(now)||Date.parse(expiresAt)-Date.parse(issuedAt)!==60000||Date.parse(issuedAt)>now+5000||Date.parse(expiresAt)<now-5000)fail('PRODUCTION_PROOF_EXPIRED');
}
const absolute=value=>typeof value==='string'&&(path.win32.isAbsolute(value)||path.posix.isAbsolute(value))&&!value.includes('\0');
const inside=(root,file,flavour=path)=>{const relative=flavour.relative(root,file);return relative===''||relative!=='..'&&!relative.startsWith('..'+flavour.sep)&&!flavour.isAbsolute(relative);};
function instance(value){
 fields(value,['pid','createdAt','nonceDigest'],['identityKind','nativeBirth']);
 const kind=value.identityKind||'boot-nonce';
 if(!Number.isSafeInteger(value.pid)||value.pid<=0||!['boot-nonce','systemd-invocation','legacy-os-start'].includes(kind))fail('PRODUCTION_INSTANCE_INVALID');
 if(kind==='boot-nonce'&&(!Number.isFinite(Date.parse(value.createdAt))||!hex(value.nonceDigest))||kind==='systemd-invocation'&&(!hex(value.nonceDigest)||!value.nativeBirth)||kind==='legacy-os-start'&&(value.nonceDigest!==null||!value.nativeBirth))fail('PRODUCTION_INSTANCE_INVALID');
 if(value.nativeBirth){fields(value.nativeBirth,['bootId'],['startTicks','createdAt']);if(typeof value.nativeBirth.bootId!=='string'||!(/^[a-f0-9-]{36}$|^[a-f0-9]{64}$/).test(value.nativeBirth.bootId)||Boolean(value.nativeBirth.startTicks)===Boolean(value.nativeBirth.createdAt)||value.nativeBirth.startTicks&&!(/^[1-9][0-9]*$/).test(value.nativeBirth.startTicks)||value.nativeBirth.createdAt&&!Number.isFinite(Date.parse(value.nativeBirth.createdAt)))fail('PRODUCTION_INSTANCE_INVALID');}
 if(value.createdAt!==null&&!Number.isFinite(Date.parse(value.createdAt)))fail('PRODUCTION_INSTANCE_INVALID');
}
function newerInstance(original,row){
 if(original.nativeBirth){
  if(!row.nativeBirth||row.nativeBirth.bootId!==original.nativeBirth.bootId)return false;
  if(original.nativeBirth.startTicks)return /^[1-9][0-9]*$/.test(row.nativeBirth.startTicks||'')&&BigInt(row.nativeBirth.startTicks)>BigInt(original.nativeBirth.startTicks);
  return Number.isFinite(Date.parse(row.nativeBirth.createdAt))&&Date.parse(row.nativeBirth.createdAt)>Date.parse(original.nativeBirth.createdAt);
 }
 return Number.isFinite(Date.parse(row.createdAt))&&Date.parse(row.createdAt)>Date.parse(original.createdAt);
}
function validateInstallTargets(original,kind,packages,manifests){
 fields(original.installTargets,['v1-compat','v2']);
 for(const role of ['v1-compat','v2']){
  const target=original.installTargets[role];fields(target,['root','entryPath','manifestSha256','buildDigest']);
  const flavour=path.posix.isAbsolute(original.root)?path.posix:path.win32,manifest=manifests.find(row=>row.productRole===role),pin=packages.manifests.find(row=>row.productRole===role);
  if(!flavour.isAbsolute(target.root)||!flavour.isAbsolute(target.entryPath)||flavour.resolve(target.root)!==target.root||flavour.resolve(target.entryPath)!==target.entryPath||!inside(target.root,target.entryPath,flavour)||!hex(target.manifestSha256)||target.manifestSha256!==pin.sha256||target.buildDigest!==(kind==='api'?manifest.buildDigest:manifest.clientBuild))fail('PRODUCTION_INSTALL_TARGET_INVALID');
  const relative=flavour.relative(target.root,target.entryPath).replaceAll('\\','/'),contents=kind==='api'?manifest.contents:manifest.clientContents;
  if(kind==='api'&&!['backend','src','scripts','skills','daemon'].includes(relative.split('/')[0])||!Array.isArray(contents)||!contents.some(row=>row.path===relative&&hex(row.sha256)))fail('PRODUCTION_INSTALL_TARGET_INVALID');
  if(kind==='api'&&(inside(original.root,target.root,flavour)||inside(target.root,original.root,flavour)))fail('PRODUCTION_INSTALL_TARGET_INVALID');
 }
 if(kind==='api'){const flavour=path.posix.isAbsolute(original.root)?path.posix:path.win32,a=original.installTargets['v1-compat'].root,b=original.installTargets.v2.root;if(inside(a,b,flavour)||inside(b,a,flavour))fail('PRODUCTION_INSTALL_TARGET_INVALID');}
}
function installedTargets(binding){
 return [...binding.clients.map(original=>({kind:'client',original})),...binding.apiInstances.map(original=>({kind:'api',original}))].map(({kind,original})=>({kind,bindingDigest:digestProduction(original),productRole:'v2',...copy(original.installTargets.v2),targetDigest:digestProduction(original.installTargets.v2)}));
}
function verifyStagedPackage(spec,packageRoot){
 const packages=spec.packages;fields(packages,['directory','manifests','artifacts']);
 if(!absolute(packages.directory)||!Array.isArray(packages.manifests)||packages.manifests.length!==2||!Array.isArray(packages.artifacts)||packages.artifacts.length!==6)fail('PRODUCTION_PACKAGE_INVALID');
 const manifests=verifyPreservationPackages(packages.directory,{candidateCommit:spec.candidateCommit});
 unique(packages.manifests.map(row=>row.productRole),'PRODUCTION_PACKAGE_INVALID');unique(packages.artifacts.map(row=>row.name),'PRODUCTION_PACKAGE_INVALID');
 for(const manifest of manifests){
  const pin=packages.manifests.find(row=>row.productRole===manifest.productRole);if(!pin)fail('PRODUCTION_PACKAGE_INVALID');fields(pin,['productRole','sha256']);
  const file=path.join(packages.directory,manifest.productRole+'-manifest.json');privateFile(file);if(!hex(pin.sha256)||hash(fs.readFileSync(file))!==pin.sha256)fail('PRODUCTION_PACKAGE_CHANGED');
  for(const row of manifest.artifacts){const name=path.basename(row.path),pin=packages.artifacts.find(item=>item.name===name);if(!pin)fail('PRODUCTION_PACKAGE_INVALID');fields(pin,['name','sha256','bytes']);privateFile(path.join(packages.directory,name));if(pin.sha256!==row.sha256||pin.bytes!==row.bytes)fail('PRODUCTION_PACKAGE_CHANGED');}
 }
 const root=path.resolve(packageRoot),descriptorFile=path.join(root,'preservation-package.json');privateFile(descriptorFile);
 const descriptor=JSON.parse(fs.readFileSync(descriptorFile)),manifest=manifests.find(row=>row.productRole===PRODUCT_ROLE);
 if(!manifest||descriptor.productRole!==PRODUCT_ROLE||descriptor.candidateCommit!==spec.candidateCommit||!equal(descriptor.versions,FROZEN_VERSIONS))fail('PRODUCTION_PACKAGE_ROLE');
 const roleFile=path.join(root,'src','execution-admission.mjs');privateFile(roleFile);
 if(!new RegExp("export\\s+const\\s+PRODUCT_ROLE\\s*=\\s*['\"]"+PRODUCT_ROLE+"['\"]").test(fs.readFileSync(roleFile,'utf8')))fail('PRODUCTION_PACKAGE_ROLE');
 const included=relative=>['backend','src','scripts','skills','daemon'].includes(relative.split('/')[0])||['package.json','package-lock.json','preservation-package.json'].includes(relative);
 const entries=manifest.contents.filter(row=>included(row.path)),expected=new Set();
 for(const row of entries){fields(row,['path','sha256']);if(!hex(row.sha256)||typeof row.path!=='string'||row.path.includes('\\')||path.posix.isAbsolute(row.path)||row.path.split('/').some(part=>!part||part==='.'||part==='..')||expected.has(row.path))fail('PRODUCTION_PACKAGE_INVALID');expected.add(row.path);const file=path.join(root,row.path);privateFile(file);if(hash(fs.readFileSync(file))!==row.sha256)fail('PRODUCTION_PACKAGE_CHANGED');}
 for(const mandatory of ['backend/production-preservation.mjs','backend/version-preservation.mjs','backend/preservation-native-evidence.mjs','backend/preservation-native-databases.mjs','scripts/production-source-proof.mjs','scripts/v2-preservation.mjs','scripts/verify-preservation-packages.mjs','src/execution-admission.mjs','preservation-package.json'])if(!expected.has(mandatory))fail('PRODUCTION_PACKAGE_CLOSURE');
 // packageRoot cannot lend its identity to code imported from another checkout.
 // Cover the loaded static and literal dynamic relative dependency closure,
 // including the source collector's native/lifecycle modules.
 const loadedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),pending=['backend/production-preservation.mjs','scripts/production-source-proof.mjs'],checked=new Set();
 while(pending.length){
  const relative=pending.pop();if(checked.has(relative))continue;checked.add(relative);
  const entry=manifest.contents.find(row=>row.path===relative),file=path.join(loadedRoot,relative);privateFile(file);
  const bytes=fs.readFileSync(file);if(!entry||hash(bytes)!==entry.sha256)fail('PRODUCTION_LOADED_CLOSURE_CHANGED');
  for(const match of bytes.toString('utf8').matchAll(/\b(?:from\s+|import\s*\(\s*|import\s+)(['"])(\.[^'"]+)\1/g)){
   const dependency=path.resolve(path.dirname(file),match[2]);if(!inside(loadedRoot,dependency))fail('PRODUCTION_PACKAGE_CLOSURE');
   pending.push(path.relative(loadedRoot,dependency).replaceAll('\\','/'));
  }
 }
 function walk(directory,prefix){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const relative=prefix?prefix+'/'+entry.name:entry.name,file=path.join(directory,entry.name);if(entry.isSymbolicLink())fail('PRODUCTION_PACKAGE_CHANGED');if(entry.isDirectory())walk(file,relative);else if(!expected.has(relative))fail('PRODUCTION_PACKAGE_CHANGED');}}
 for(const name of ['backend','src','scripts','skills','daemon'])if(fs.existsSync(path.join(root,name)))walk(path.join(root,name),name);
 return {role:PRODUCT_ROLE,root,manifest,manifests};
}
export function validateProductionSpec(input){
 const {spec:raw,trust:rawTrust,database,packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')}=argumentsObject(input,['spec','trust','database','packageRoot']);
 if(raw===rawTrust)fail('PRODUCTION_INDEPENDENT_TRUST_REQUIRED');
 const spec=copy(raw),trust=copy(rawTrust);validateTrust(trust);
 fields(spec,['schemaVersion','mode','operationId','specHash','authorization','database','packages','candidateCommit','qa','versions','hosts','backupScope','bootstrap']);
 if(spec.schemaVersion!==1||spec.mode!=='production'||!id(spec.operationId)||!hex(spec.specHash)||!(/^[a-f0-9]{40}$/).test(spec.candidateCommit||''))fail('PRODUCTION_SPEC_INVALID');
 const unhashed={...spec};delete unhashed.specHash;
 if(digestProduction(unhashed)!==spec.specHash)fail('PRODUCTION_SPEC_HASH');
 if(!trust.approvedSpecs.some(pin=>pin.operationId===spec.operationId&&pin.specHash===spec.specHash))fail('PRODUCTION_SPEC_NOT_APPROVED');
 if(database!==undefined&&!equal(database,spec.database))fail('PRODUCTION_DATABASE_IDENTITY');
 productionDatabaseIdentity(spec.database);
 fields(spec.authorization,['executor','targetOrigins','allowedCommands']);
 if(spec.authorization.executor!=='R01'||!unique(spec.authorization.targetOrigins).length||!unique(spec.authorization.allowedCommands).length||spec.authorization.allowedCommands.some(value=>!['inspect','prepare','seal','restore','abort'].includes(value)))fail('PRODUCTION_AUTHORIZATION');
 for(const origin of spec.authorization.targetOrigins){let url;try{url=new URL(origin);}catch{fail('PRODUCTION_AUTHORIZATION');}if(!['http:','https:'].includes(url.protocol)||url.origin!==origin||url.username||url.password)fail('PRODUCTION_AUTHORIZATION');}
 fields(spec.qa,['commit','evidenceSha256']);if(!(/^[a-f0-9]{40}$/).test(spec.qa.commit||'')||!hex(spec.qa.evidenceSha256)||!equal(spec.versions,FROZEN_VERSIONS))fail('PRODUCTION_VERSION_INVALID');
 fields(spec.bootstrap,['fromRole','offline','allOriginalWritersStopped']);if(!['v1','v2'].includes(spec.bootstrap.fromRole)||spec.bootstrap.offline!==true||spec.bootstrap.allOriginalWritersStopped!==true)fail('PRODUCTION_BOOTSTRAP_INVALID');
 if(!Array.isArray(spec.hosts)||!spec.hosts.length||spec.hosts.length>32)fail('PRODUCTION_SCOPE_INVALID');
 unique(spec.hosts.map(host=>host.hostId));
 unique(spec.hosts.flatMap(host=>host.deviceIds));
 for(const host of spec.hosts){
  fields(host,['hostId','deviceIds','workspaceIds','clients','apiInstances'],['nativeSourceRefs']);validateNativeSourceRefs(host);
  if(!id(host.hostId)||!Array.isArray(host.clients)||!Array.isArray(host.apiInstances)||!host.clients.length&&!host.apiInstances.length)fail('PRODUCTION_SCOPE_INVALID');
  for(const values of [host.deviceIds,host.workspaceIds])if(unique(values).some(value=>!id(value)))fail('PRODUCTION_SCOPE_INVALID');
  const authority=trust.hosts.find(row=>row.hostId===host.hostId);if(!authority||authority.bindingDigest!==digestProduction(host))fail('PRODUCTION_HOST_BINDING');
  for(const client of host.clients){fields(client,['root','entryPath','configPath','userHome','runtimeDir','baseHome','configSha256','installedRole','clientBuild','originalInstance','installTargets']);if(['root','entryPath','configPath','userHome','runtimeDir','baseHome'].some(key=>!absolute(client[key]))||!hex(client.configSha256)||!hex(client.clientBuild)||!['v1','v1-compat','v2'].includes(client.installedRole))fail('PRODUCTION_SCOPE_INVALID');const flavour=path.posix.isAbsolute(client.root)?path.posix:path.win32;if(!inside(client.root,client.entryPath,flavour)||!inside(client.userHome,client.runtimeDir,flavour))fail('PRODUCTION_SCOPE_INVALID');instance(client.originalInstance);}
  for(const api of host.apiInstances){fields(api,['root','entryPath','role','buildDigest','serviceManager','originalInstance','installTargets']);if(!absolute(api.root)||!absolute(api.entryPath)||!inside(api.root,api.entryPath,path.posix.isAbsolute(api.root)?path.posix:path.win32)||!hex(api.buildDigest)||!['v1','v1-compat','v2'].includes(api.role)||typeof api.serviceManager!=='string'||!api.serviceManager)fail('PRODUCTION_SCOPE_INVALID');instance(api.originalInstance);}
 }
 fields(spec.backupScope,['mainDatabase','controlDatabases','objectRoots','homes','journals','configs','privateReferences']);
 if(spec.backupScope.mainDatabase!==spec.database.canonicalPath)fail('PRODUCTION_BACKUP_SCOPE');
 for(const key of ['controlDatabases','objectRoots','homes','journals','configs','privateReferences'])if(unique(spec.backupScope[key]).some(value=>!absolute(value)))fail('PRODUCTION_BACKUP_SCOPE');
 for(const client of spec.hosts.flatMap(host=>host.clients))if(!spec.backupScope.homes.includes(client.baseHome)||!spec.backupScope.homes.includes(client.userHome)||!spec.backupScope.configs.includes(client.configPath)||!spec.backupScope.journals.includes(client.runtimeDir))fail('PRODUCTION_BACKUP_SCOPE');
 const staged=verifyStagedPackage(spec,packageRoot);
 for(const host of spec.hosts){for(const original of host.clients)validateInstallTargets(original,'client',spec.packages,staged.manifests);for(const original of host.apiInstances)validateInstallTargets(original,'api',spec.packages,staged.manifests);}
 return {spec,trust,databaseIdentity:copy(spec.database),...staged};
}

const projectionTables=['workspaces','devices','employees','tasks','conversations','a2a_actions','management_requests','a2a_action_events','employee_template_instances','employee_custom_params','automations','automation_runs','webhook_deliveries','hermes_bots','bot_routines','bot_gateway_inbox','ziwei_connect_bindings','ziwei_connect_runs','employee_phone_mcp'];
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const tableExists=(db,table)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const normal=value=>value instanceof Uint8Array?{sqliteBlob:Buffer.from(value).toString('hex')}:value;
const rows=(db,table)=>tableExists(db,table)?db.prepare('SELECT * FROM '+quote(table)).all().map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,normal(value)]))):[];
/** No repository/app, UDF, Hermes table or pre-existing intent is needed. */
export function readProductionProjection(db){
 const tables={},excluded=new Set(['audit_events','runtime_metadata','runtime_device_metadata','version_preservation','version_preservation_events','production_preservation_identity','production_preservation_receipts']);
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name).filter(name=>!excluded.has(name)&&!name.startsWith('sqlite_'));
 for(const table of unique([...names,...projectionTables.filter(name=>!names.includes(name))]).sort(compare)){
  if(!tableExists(db,table)){Object.defineProperty(tables,table,{value:{present:false,columns:[],rows:[]},enumerable:true});continue;}
  const columns=db.prepare('PRAGMA table_info('+quote(table)+')').all().map(row=>({name:row.name,type:row.type,pk:row.pk}));
  const values=rows(db,table).map(row=>{
   if(table==='devices'){for(const key of Object.keys(row))if(/^(last_seen|heartbeat|bridge_|client_build|pid$|arch$|runtime_discovery|management_mcp|terminal_mcp|ip_hint)/.test(key))delete row[key];if(row.status!=='disabled')row.status='liveness';}
   if(table==='runtimes')for(const key of ['last_seen','status','version'])delete row[key];
   // Non-binding tables remain fully covered by row digests, without sending
   // authentication material, encrypted environment values or document bodies.
   return projectionTables.includes(table)?row:{rowDigest:digestProduction(row)};
  }).sort((a,b)=>compare(canonicalProduction(a),canonicalProduction(b)));
  Object.defineProperty(tables,table,{value:{present:true,columns,rows:values},enumerable:true});
 }
 if(!tables.workspaces?.present||!tables.a2a_actions?.present)fail('PRODUCTION_DATABASE_SCHEMA');
 return {schemaVersion:1,kind:'bootstrap-projection-v1',tables};
}
function controlState(db){
 if(!tableExists(db,'version_preservation'))return {state:'absent',operationId:null};
 const row=db.prepare('SELECT * FROM version_preservation WHERE singleton=1').get();
 return row?{state:row.state,operationId:row.operation_id,intentDigest:digest(row.intent_json),snapshotDigest:row.snapshot_json?digest(row.snapshot_json):null,versionsDigest:digest(row.versions_json)}:{state:'absent',operationId:null};
}
function storedReceipt(db,spec,command){
 if(tableExists(db,'production_preservation_identity')){const identity=db.prepare('SELECT * FROM production_preservation_identity WHERE singleton=1').get();if(identity&&(identity.database_id!==spec.database.databaseId||!equal(JSON.parse(identity.file_identity_json),spec.database)))fail('PRODUCTION_DATABASE_CONFLICT');}
 if(!tableExists(db,'production_preservation_receipts'))return null;
 const prior=db.prepare('SELECT * FROM production_preservation_receipts WHERE operation_id=?').all(spec.operationId);
 if(prior.some(row=>row.spec_hash!==spec.specHash))fail('PRODUCTION_OPERATION_CONFLICT');
 const receipt=prior.find(row=>row.command===command);return receipt?JSON.parse(receipt.receipt_json):null;
}
const requestFields=['domain','schemaVersion','kind','command','collector','challenge','issuedAt','expiresAt','operationId','specHash','databaseIdentity','freezeDigest','binding','actionProjection','gatewayInbox','homes','priorEvidenceDigest','targetOrigins','installed','controlIdentity'];
export function validateProductionRequest(input){
 const {request,trust,command,kind,now=Date.now()}=argumentsObject(input,['request','trust','command','kind','now']);
 const payload=verifyProductionEnvelope({envelope:request,trust,expected:{domain:'ziwei-production-request-v1',schemaVersion:1,collector:'ziwei-production-source-v1',...(command?{command}:{}),...(kind?{kind}:{})},now});
 fields(payload,requestFields);
 if(!['collect','recheck'].includes(payload.kind)||!['prepare','seal','restore','abort'].includes(payload.command)||!id(payload.operationId)||!hex(payload.specHash)||!hex(payload.freezeDigest))fail('PRODUCTION_REQUEST_INVALID');
 const host=trust.hosts.find(row=>row.hostId===request.hostId);
 if(payload.binding.hostId!==host.hostId||digestProduction(payload.binding)!==host.bindingDigest||!trust.approvedSpecs.some(pin=>pin.operationId===payload.operationId&&pin.specHash===payload.specHash))fail('PRODUCTION_HOST_BINDING');
 if(payload.kind==='collect'?payload.priorEvidenceDigest!==null:!hex(payload.priorEvidenceDigest))fail('PRODUCTION_REQUEST_INVALID');
 if(!Array.isArray(payload.targetOrigins)||!payload.targetOrigins.length)fail('PRODUCTION_REQUEST_INVALID');
 if(payload.command==='restore'){fields(payload.installed,['productRole','candidateCommit','databaseId','apiBuildDigest','clientBuild','apiContents','clientContents','targets']);if(payload.installed.productRole!=='v2'||payload.installed.databaseId!==payload.databaseIdentity.databaseId||!equal(payload.installed.targets,installedTargets(payload.binding)))fail('PRODUCTION_INSTALL_TARGET_INVALID');}
 else if(payload.installed!==null)fail('PRODUCTION_INSTALL_TARGET_INVALID');
 return payload;
}
const proofFields=['domain','schemaVersion','kind','command','collector','challenge','issuedAt','expiresAt','operationId','specHash','databaseIdentity','freezeDigest','bindingDigest','actionProjectionDigest','gatewayInboxDigest','homesDigest','installedDigest','priorEvidenceDigest','observations','files','directories','nativeDatabases','nativeStateProofs','gatewayInboxProofs','actionBindings','issues','safe','evidenceDigest','runtimeProofs'];
export function productionEvidenceDigest(payload){const value=copy(payload);delete value.evidenceDigest;for(const key of ['domain','kind','challenge','issuedAt','expiresAt','priorEvidenceDigest','runtimeProofs'])delete value[key];return digestProduction(value);}
export function productionHostActions(binding,projection){
 return projection.tables.a2a_actions.rows.filter(action=>{
  if(!binding.workspaceIds.includes(action.workspace_id))return false;
  let payload={};try{payload=JSON.parse(action.payload_json);}catch{if(action.acked_at)fail('PRODUCTION_ACTION_SCOPE_UNKNOWN');}
  const employee=projection.tables.employees?.rows.find(row=>row.id===(payload.employeeId||payload.employee_id||payload.assignee));
  const conversation=projection.tables.conversations?.rows.find(row=>row.id===(payload.conversationId||payload.conversation_id));
  const device=payload.deviceId||payload.device_id||payload.targetDeviceId||payload.target_device_id||employee?.target_device_id||conversation?.device_id;
  if(!device&&action.acked_at)fail('PRODUCTION_ACTION_SCOPE_UNKNOWN');
  return device?binding.deviceIds.includes(device):binding.apiInstances.length>0;
 });
}
/** A stable row digest does not establish execution/delivery terminal state. */
export function productionSemanticIssues(projection,originalActionProofs=[]){
 const issues=[];
 const parsed=row=>{if(row.result_json===null||row.result_json===undefined||row.result_json==='')return null;try{return JSON.parse(row.result_json);}catch{issues.push({code:'PRODUCTION_RESULT_INVALID',id:row.id});return null;}};
 const debt=value=>value&&typeof value==='object'&&(value.retainEvidence===true||value.status==='blocked'||value.executionState==='blocked'||value.processExit&&!exitedTree(value.processExit)||Object.values(value).some(debt));
 for(const row of projection.tables.a2a_actions.rows){
  const result=parsed(row),assessment=originalActionProofs.some(proof=>proof.kind==='legacy-never-dispatched-v1'&&proof.actionId===row.id&&proof.actionDigest===nativeActionDigest(row)&&proof.verified===true);
  if(!['succeeded','failed','expired'].includes(row.status)||uncertain(result)||debt(result)||['succeeded','failed'].includes(row.status)&&!row.acked_at||row.status==='expired'&&row.acked_at&&!assessment)issues.push({code:'PRODUCTION_ORIGINAL_ACTION_DEBT',id:row.id});
 }
 for(const [table,terminal] of [['automation_runs',['completed','failed','dry_run','cancelled']],['webhook_deliveries',['delivered','failed','cancelled']],['ziwei_connect_runs',['succeeded','failed','dry_run','cancelled']]]){
  for(const row of projection.tables[table]?.rows||[]){const result=parsed(row);if(!terminal.includes(row.status)||uncertain(result)||debt(result))issues.push({code:'PRODUCTION_ORIGINAL_QUEUE_DEBT',table,id:row.id});}
 }
 return issues;
}
function validateObservations(payload,binding,manifest){
 const observations=payload.observations;fields(observations,['namespace','namespaceComplete','workerScopeComplete','originalStopped','restarted','unresolved','instances'],['runningV2','scopeDigest']);
 if(observations.scopeDigest!==undefined&&!hex(observations.scopeDigest))fail('PRODUCTION_PROOF_INVALID');
 if(!['win32','linux'].includes(observations.namespace)||observations.namespaceComplete!==true||observations.workerScopeComplete!==true||observations.originalStopped!==true||observations.restarted!==false||!Array.isArray(observations.unresolved)||observations.unresolved.length||!Array.isArray(observations.instances))fail('PRODUCTION_SOURCE_NOT_STOPPED');
 const expected=[...binding.clients,...binding.apiInstances];
 if(observations.instances.length!==expected.length)fail('PRODUCTION_INSTANCE_COVERAGE');
 for(const original of expected){const matches=observations.instances.filter(row=>row.bindingDigest===digestProduction(original)&&equal(row.originalInstance,original.originalInstance)&&row.stopped===true);if(matches.length!==1)fail('PRODUCTION_INSTANCE_COVERAGE');}
 if(payload.command==='restore'){
  const running=observations.runningV2;
  if(!running||running.productRole!=='v2'||!Array.isArray(running.instances)||running.instances.length!==expected.length)fail('PRODUCTION_RESTORE_RUNNING_V2_REQUIRED');
  if(binding.apiInstances.length){if(running.fenceState!=='sealed'||running.buildDigest!==manifest.buildDigest||running.databaseId!==payload.databaseIdentity.databaseId)fail('PRODUCTION_RESTORE_RUNNING_V2_REQUIRED');}
  else if(['fenceState','buildDigest','databaseId'].some(key=>Object.hasOwn(running,key)))fail('PRODUCTION_RESTORE_CLIENT_API_CLAIM');
  for(const original of expected){const target=original.installTargets.v2,kind=original.configPath?'client':'api',matched=running.instances.filter(row=>row.kind===kind&&row.bindingDigest===digestProduction(original)&&row.targetDigest===digestProduction(target)&&row.root===target.root&&row.entryPath===target.entryPath&&row.running===true&&row.productRole==='v2'&&row.buildDigest===target.buildDigest&&Number.isSafeInteger(row.pid)&&row.pid>0&&hex(row.nonceDigest)&&row.nonceDigest!==original.originalInstance.nonceDigest&&newerInstance(original.originalInstance,row));if(matched.length!==1)fail('PRODUCTION_RESTORE_RUNNING_V2_REQUIRED');}
 }else if(observations.runningV2!==undefined)fail('PRODUCTION_SOURCE_NOT_STOPPED');
}
export function verifySourceProofs(envelopes,requests,trust,manifest,legacyActionPolicy=null){
 if(!Array.isArray(envelopes)||envelopes.length!==requests.length)fail('PRODUCTION_HOST_COVERAGE');
 unique(envelopes.map(row=>row.hostId),'PRODUCTION_HOST_COVERAGE');
 const records=[],apiTargets=requests.flatMap(request=>request.payload.command==='restore'?request.payload.installed.targets.filter(row=>row.kind==='api').map(target=>({hostId:request.hostId,target})):[]),apiRuntime=[];
 if(requests.some(request=>request.payload.command==='restore')&&!apiTargets.length)fail('PRODUCTION_RESTORE_API_REQUIRED');
 for(const request of requests){
  const envelope=envelopes.find(row=>row.hostId===request.hostId);if(!envelope)fail('PRODUCTION_HOST_COVERAGE');
  const source=request.payload;
  const payload=verifyProductionEnvelope({envelope,trust,expected:{domain:source.kind==='collect'?'ziwei-production-collect-proof-v1':'ziwei-production-recheck-proof-v1',schemaVersion:1,kind:source.kind,command:source.command,collector:source.collector,challenge:source.challenge,issuedAt:source.issuedAt,expiresAt:source.expiresAt,operationId:source.operationId,specHash:source.specHash,databaseIdentity:source.databaseIdentity,freezeDigest:source.freezeDigest,bindingDigest:digestProduction(source.binding),actionProjectionDigest:digestProduction(source.actionProjection),gatewayInboxDigest:digestProduction(source.gatewayInbox),homesDigest:digestProduction(source.homes),installedDigest:digestProduction(source.installed),priorEvidenceDigest:source.priorEvidenceDigest}});
  fields(payload,proofFields);
  for(const field of ['files','directories','nativeDatabases','nativeStateProofs','gatewayInboxProofs','actionBindings','issues','runtimeProofs'])if(!Array.isArray(payload[field]))fail('PRODUCTION_PROOF_INVALID');
  if(payload.safe!==true||payload.issues.length||!hex(payload.evidenceDigest)||payload.evidenceDigest!==productionEvidenceDigest(payload))fail('PRODUCTION_SOURCE_UNSAFE');
  validateObservations(payload,source.binding,manifest);
  const permitted=[...source.binding.clients.flatMap(client=>[client.root,client.userHome,client.runtimeDir,client.baseHome]),...source.binding.apiInstances.map(api=>api.root),...source.homes.map(home=>home.home),...[...source.binding.clients,...source.binding.apiInstances].flatMap(original=>Object.values(original.installTargets).map(target=>target.root))];
  const configPaths=source.binding.clients.map(client=>client.configPath);
  const refs=validateNativeSourceRefs(source.binding),referenceFiles=refs.filter(row=>row.sha256),captureFiles=refs.filter(row=>row.kind==='namespace-capture-directory-v1').flatMap(ref=>['before-stop','after-stop'].map(phase=>namespaceCaptureFile(ref,phase)));
  for(const record of [...payload.files,...payload.directories,...payload.nativeDatabases]){
   const flavour=payload.observations.namespace==='win32'?path.win32:path.posix;
   const externalFile=payload.files.includes(record)&&(referenceFiles.some(ref=>ref.canonicalPath===record.path&&record.sha256===ref.sha256)||captureFiles.includes(record.path));
   if(typeof record.path!=='string'||!flavour.isAbsolute(record.path)||!configPaths.includes(record.path)&&!permitted.some(root=>inside(root,record.path,flavour))&&!externalFile)fail('PRODUCTION_RECORD_SCOPE');
   if(record.deviceId&&!source.binding.deviceIds.includes(record.deviceId)||record.workspaceId&&!source.binding.workspaceIds.includes(record.workspaceId))fail('PRODUCTION_RECORD_SCOPE');
  }
  for(const file of payload.files){if(typeof file.path!=='string'||typeof file.exists!=='boolean'||file.exists&&(!hex(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||!file.identity))fail('PRODUCTION_PROOF_INVALID');}
  for(const directory of payload.directories)if(typeof directory.path!=='string'||typeof directory.exists!=='boolean'||!Array.isArray(directory.names)||directory.exists&&!directory.identity)fail('PRODUCTION_PROOF_INVALID');
  for(const client of source.binding.clients)if(!payload.files.some(row=>row.path===client.configPath&&row.exists&&row.sha256===client.configSha256))fail('PRODUCTION_CONFIG_COVERAGE');
  const hostActions=productionHostActions(source.binding,source.actionProjection);
  if(payload.actionBindings.length!==hostActions.length||new Set(payload.actionBindings.map(row=>row.id)).size!==payload.actionBindings.length)fail('PRODUCTION_ACTION_COVERAGE');
  for(const action of hostActions)if(!payload.actionBindings.some(row=>row.id===action.id&&row.digest===nativeActionDigest(action)))fail('PRODUCTION_ACTION_COVERAGE');
  for(const proof of payload.nativeStateProofs.filter(row=>row.kind==='legacy-never-dispatched-v1')){
   const policy=legacyActionPolicy;
   const keys=['schemaVersion','kind','actionId','actionDigest','operationId','specHash','freezeDigest','hostId','workspaceId','workspace','deviceId','origin','authorizationDigest','historicalGenerationDigest','policyDigest','sourceDigest','cacheDigest','loggerDigest','artifactDigest','conclusion','verified'];
   const action=hostActions.find(row=>row.id===proof.actionId);
   if(Object.keys(proof).length!==keys.length||keys.some(key=>!Object.hasOwn(proof,key))||!action||action.status!=='expired'||!action.acked_at||action.result_json!==''||!source.actionProjection.tables.workspaces.rows.some(row=>row.id===proof.workspaceId&&row.slug===proof.workspace)||!source.targetOrigins.includes(proof.origin))fail('PRODUCTION_ACTION_COVERAGE');
   if(!policy||proof.schemaVersion!==1||proof.hostId!==source.binding.hostId||proof.operationId!==source.operationId||proof.specHash!==source.specHash||proof.freezeDigest!==source.freezeDigest||proof.verified!==true||proof.conclusion!=='never-dispatched'||uncertain(proof)||!hex(proof.artifactDigest)||Object.entries(policy).filter(([key])=>key!=='requiredFiles').some(([key,value])=>proof[key]!==value)||!hostActions.some(action=>action.id===proof.actionId&&nativeActionDigest(action)===proof.actionDigest))fail('PRODUCTION_ACTION_COVERAGE');
   for(const required of policy.requiredFiles)if(payload.files.filter(file=>file.path===required.path&&file.exists===true&&file.sha256===required.sha256).length!==1)fail('PRODUCTION_ACTION_COVERAGE');
  }
  if(source.command==='restore'&&[...source.binding.clients,...source.binding.apiInstances].length){
   if(!refs.some(ref=>ref.kind==='runtime-identity-directory-v1')||payload.runtimeProofs.length!==1)fail('PRODUCTION_RESTORE_RUNNING_V2_REQUIRED');
   const runtime=verifyRuntimeCaptureEnvelope({envelope:payload.runtimeProofs[0],trust,request:source});
   for(const sample of runtime.instances)if(!payload.observations.runningV2.instances.some(row=>['kind','bindingDigest','targetDigest','root','entryPath','productRole','buildDigest','pid','nativeBirth','nonceDigest'].every(key=>equal(row[key],sample[key]))))fail('PRODUCTION_RESTORE_RUNNING_V2_REQUIRED');
   for(const sample of runtime.instances.filter(row=>row.kind==='api')){const proof=sample.apiIdentity.payload;if(proof.fenceState!==payload.observations.runningV2.fenceState||proof.buildDigest!==payload.observations.runningV2.buildDigest||proof.databaseIdentity.databaseId!==payload.observations.runningV2.databaseId)fail('PRODUCTION_RESTORE_RUNNING_V2_REQUIRED');apiRuntime.push({hostId:request.hostId,sample});}
  }else if(payload.runtimeProofs.length)fail('PRODUCTION_PROOF_INVALID');
  for(const database of payload.nativeDatabases)for(const suffix of ['','-wal','-journal','-shm'])if(!payload.files.some(row=>row.path===database.path+suffix))fail('PRODUCTION_DATABASE_COVERAGE');
  records.push({hostId:envelope.hostId,payload});
 }
 const legacyProofs=records.flatMap(row=>row.payload.nativeStateProofs.filter(proof=>proof.kind==='legacy-never-dispatched-v1'));
 if(legacyActionPolicy&&legacyProofs.length!==1||!legacyActionPolicy&&legacyProofs.length)fail('PRODUCTION_ACTION_COVERAGE');
 if(apiRuntime.length!==apiTargets.length)fail('PRODUCTION_RESTORE_API_REQUIRED');
 for(const {hostId,target} of apiTargets)if(apiRuntime.filter(row=>row.hostId===hostId&&row.sample.bindingDigest===target.bindingDigest&&row.sample.targetDigest===target.targetDigest).length!==1)fail('PRODUCTION_RESTORE_API_REQUIRED');
 return records;
}
function homesFor(spec,projection){
 const homes=[];
 for(const host of spec.hosts)for(const client of host.clients)for(const workspaceId of host.workspaceIds){const workspace=projection.tables.workspaces.rows.find(row=>row.id===workspaceId);if(!workspace)fail('PRODUCTION_WORKSPACE_COVERAGE');for(const employee of projection.tables.employees?.rows||[]){if(employee.workspace_id!==workspaceId||employee.runtime!=='hermes'||employee.target_device_id&&!host.deviceIds.includes(employee.target_device_id))continue;homes.push({hostId:host.hostId,home:client.baseHome,sourceProfile:employee.runtime_profile||'default',employeeId:employee.id,workspace:workspace.slug,workspaceId,deviceId:employee.target_device_id||host.deviceIds[0]||null,origin:spec.authorization.targetOrigins[0]});}}
 return homes;
}
function requestsFor(validated,command,kind,projection,freezeDigest,priorEvidenceDigest,controlIdentity){
 const challenge=crypto.randomUUID(),issuedAt=new Date().toISOString(),expiresAt=new Date(Date.parse(issuedAt)+60000).toISOString();
 const homes=homesFor(validated.spec,projection),gatewayInbox=projection.tables.bot_gateway_inbox?.rows||[];
 return validated.spec.hosts.map(binding=>{const installed=command==='restore'?{productRole:'v2',candidateCommit:validated.spec.candidateCommit,databaseId:validated.spec.database.databaseId,apiBuildDigest:validated.manifest.buildDigest,clientBuild:validated.manifest.clientBuild,apiContents:validated.manifest.contents,clientContents:validated.manifest.clientContents||[],targets:installedTargets(binding)}:null;return signProductionEnvelope({hostId:binding.hostId,trust:validated.trust,payload:{domain:'ziwei-production-request-v1',schemaVersion:1,kind,command,collector:'ziwei-production-source-v1',challenge,issuedAt,expiresAt,operationId:validated.spec.operationId,specHash:validated.spec.specHash,databaseIdentity:validated.databaseIdentity,freezeDigest,binding,actionProjection:projection,gatewayInbox,homes:homes.filter(row=>row.hostId===binding.hostId),priorEvidenceDigest,targetOrigins:validated.spec.authorization.targetOrigins,installed,controlIdentity}});});
}
function verifyBackup(envelope,validated,freezeDigest){
 if(!envelope||envelope.hostId!==validated.trust.backupHostId)fail('PRODUCTION_BACKUP_REQUIRED');
 const payload=verifyProductionEnvelope({envelope,trust:validated.trust,expected:{domain:'ziwei-production-backup-proof-v1',schemaVersion:1,kind:'backup-restore-read',command:'seal',operationId:validated.spec.operationId,specHash:validated.spec.specHash,databaseIdentity:validated.databaseIdentity,freezeDigest,scopeDigest:digestProduction(validated.spec.backupScope)}});
 fields(payload,['domain','schemaVersion','kind','command','challenge','issuedAt','expiresAt','operationId','specHash','databaseIdentity','freezeDigest','scopeDigest','manifestDigest','restoreReadDigest','mainDatabase','controlDatabases','objectsDigest','homesDigest','journalsDigest','configsDigest','privateReferencesDigest','originalWritersStopped','safe']);
 if(payload.originalWritersStopped!==true||payload.safe!==true||['manifestDigest','restoreReadDigest','objectsDigest','homesDigest','journalsDigest','configsDigest','privateReferencesDigest'].some(key=>!hex(payload[key]))||!Array.isArray(payload.controlDatabases)||payload.controlDatabases.length!==validated.spec.backupScope.controlDatabases.length)fail('PRODUCTION_BACKUP_INVALID');
 const databases=[payload.mainDatabase,...payload.controlDatabases];
 if(payload.mainDatabase?.path!==validated.spec.backupScope.mainDatabase)fail('PRODUCTION_BACKUP_INVALID');
 for(const database of databases){fields(database,['path','integrity','foreignKeys','stablePrimaryKeysDigest','fileDigest']);if(database.integrity!=='ok'||database.foreignKeys!=='ok'||!hex(database.stablePrimaryKeysDigest)||!hex(database.fileDigest))fail('PRODUCTION_BACKUP_INVALID');}
 if(!equal(payload.controlDatabases.map(row=>row.path).sort(compare),validated.spec.backupScope.controlDatabases.slice().sort(compare)))fail('PRODUCTION_BACKUP_INVALID');
 return payload;
}
/** Every await is before creating a writable DB/guard. Hooks are synchronous. */
export async function runProductionPreservation(input,{legacyActionPolicy=null}={}){
 const {command='inspect',apply=false,spec,trust,proofProvider,backupProof,packageRoot}=argumentsObject(input,['command','apply','spec','trust','proofProvider','backupProof','packageRoot']);
 if(!['inspect','prepare','seal','restore','abort'].includes(command)||typeof apply!=='boolean')fail('PRODUCTION_COMMAND_INVALID');
 const validated=validateProductionSpec({spec,trust,...(packageRoot!==undefined?{packageRoot}:{})}),pinned=validated.spec;
 const legacyPolicy=copyLegacyActionPolicy(legacyActionPolicy);
 if(legacyPolicy&&(legacyPolicy.specHash!==pinned.specHash||!pinned.hosts.some(host=>host.hostId===legacyPolicy.hostId&&host.workspaceIds.includes(legacyPolicy.workspaceId)&&host.deviceIds.includes(legacyPolicy.deviceId))))fail('PRODUCTION_ACTION_COVERAGE');
 if(!pinned.authorization.allowedCommands.includes(command))fail('PRODUCTION_COMMAND_NOT_AUTHORIZED');
 const initial=readDatabaseSnapshot(pinned.database.path,db=>({projection:readProductionProjection(db),control:controlState(db),receipt:storedReceipt(db,pinned,command)}));
 if(initial.control.operationId&&initial.control.operationId!==pinned.operationId&&initial.control.state!=='restored')fail('PRODUCTION_OPERATION_CONFLICT');
 if(command==='inspect'||!apply)return {mode:'plan',willApply:false,command,operationId:pinned.operationId,specHash:pinned.specHash,databaseId:pinned.database.databaseId,role:validated.role,state:initial.control.state,projectionDigest:digestProduction(initial.projection),receipt:initial.receipt};
 if(validated.role!=='v2')fail('PRODUCTION_COMPAT_READ_ONLY');
 if(initial.receipt)return initial.receipt;
 if(command==='prepare'&&initial.control.operationId===pinned.operationId&&initial.control.state!=='absent'||command==='seal'&&initial.control.state==='sealed'||command==='restore'&&initial.control.state==='restored')fail('PRODUCTION_RECEIPT_UNKNOWN');
 if(command!=='prepare'&&initial.control.operationId!==pinned.operationId)fail('PRODUCTION_OPERATION_REQUIRED');
 if(!proofProvider||typeof proofProvider.collect!=='function'||typeof proofProvider.recheck!=='function')fail('PRODUCTION_TRANSPORT_REQUIRED');
 const freezeDigest=digestProduction({operationId:pinned.operationId,specHash:pinned.specHash,databaseIdentity:validated.databaseIdentity,versions:FROZEN_VERSIONS});
 const collectRequests=requestsFor(validated,command,'collect',initial.projection,freezeDigest,null,initial.control);
 const context={operationId:pinned.operationId,specHash:pinned.specHash,databaseIdentity:validated.databaseIdentity,freezeDigest,requiredHosts:pinned.hosts.map(row=>row.hostId)};
 const envelopes=copy(await proofProvider.collect({...copy(context),requests:copy(collectRequests),priorEvidenceDigest:null}));
 const collected=verifySourceProofs(envelopes,collectRequests,validated.trust,validated.manifest,legacyPolicy),priorEvidenceDigest=digestProduction(envelopes);
 if(productionSemanticIssues(initial.projection,collected.flatMap(row=>row.payload.nativeStateProofs)).length)fail('PRODUCTION_ORIGINAL_DEBT');
 for(const action of initial.projection.tables.a2a_actions.rows)if(!collected.some(row=>row.payload.actionBindings.some(binding=>binding.id===action.id&&binding.digest===nativeActionDigest(action))))fail('PRODUCTION_ACTION_COVERAGE');
 const recheckRequests=requestsFor(validated,command,'recheck',initial.projection,freezeDigest,priorEvidenceDigest,initial.control);
 const fresh=copy(await proofProvider.recheck({...copy(context),requests:copy(recheckRequests),previous:copy(envelopes),priorEvidenceDigest}));
 const rechecked=verifySourceProofs(fresh,recheckRequests,validated.trust,validated.manifest,legacyPolicy);
 for(const original of collected){const latest=rechecked.find(row=>row.hostId===original.hostId);if(!latest||latest.payload.evidenceDigest!==original.payload.evidenceDigest)fail('PRODUCTION_SOURCE_CHANGED');}
 const backup=command==='seal'?verifyBackup(backupProof||await proofProvider.backup?.({...copy(context),scope:copy(pinned.backupScope)}),validated,freezeDigest):null;
 const projectionDigest=digestProduction(initial.projection);
 for(const request of [...collectRequests,...recheckRequests])validateProductionFreshness(request.payload);
 if(backup)validateProductionFreshness(backup);
 verifyStagedPackage(pinned,validated.root);
 productionDatabaseIdentity(pinned.database);
 if(readDatabaseSnapshot(pinned.database.path,db=>digestProduction(readProductionProjection(db)))!==projectionDigest)fail('PRODUCTION_PROJECTION_CHANGED');
 const trustedRecords=new WeakMap(),native={safe:true,issues:[],operationId:pinned.operationId,files:[],directories:[],nativeDatabases:[],nativeStateProofs:[],gatewayInboxProofs:[],actionBindings:[]};
 for(const {payload} of rechecked)for(const key of ['files','directories','nativeDatabases','nativeStateProofs','gatewayInboxProofs','actionBindings'])for(const record of payload[key]){if(key==='files')trustedRecords.set(record,'file');else if(key==='directories')trustedRecords.set(record,'directory');else if(key==='nativeStateProofs'&&legacyPolicy&&record.kind==='legacy-never-dispatched-v1')trustedRecords.set(record,record.kind);if(key==='actionBindings'&&native[key].some(row=>row.id===record.id)){if(!native[key].some(row=>equal(row,record)))fail('PRODUCTION_ACTION_COVERAGE');}else native[key].push(record);}
 const db=new DatabaseSync(pinned.database.path);let committed,receiptWrite=false;
 try{
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
  const recovered=storedReceipt(db,pinned,command);if(recovered)return recovered;
  // Last boundary check after package reads, snapshot reads and DB open.
  for(const request of [...collectRequests,...recheckRequests])validateProductionFreshness(request.payload);
  if(backup)validateProductionFreshness(backup);
  db.function('ziwei_production_receipt_write_admitted',()=>receiptWrite?1:0);
  // Source proof is complete before this first schema write.
  db.exec('CREATE TABLE IF NOT EXISTS production_preservation_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),database_id TEXT NOT NULL,file_identity_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS production_preservation_receipts(operation_id TEXT NOT NULL,command TEXT NOT NULL,spec_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,PRIMARY KEY(operation_id,command));');
  for(const table of ['production_preservation_identity','production_preservation_receipts'])for(const event of ['INSERT','UPDATE','DELETE'])db.exec("CREATE TRIGGER IF NOT EXISTS "+table+'_'+event.toLowerCase()+" BEFORE "+event+" ON "+table+" WHEN ziwei_production_receipt_write_admitted()=0 BEGIN SELECT RAISE(ABORT,'PRODUCTION_RECEIPT_PRIVATE'); END");
  const guard=createPreservation(db,{
   legacyActionPolicy:legacyPolicy,
   collectNativeEvidence:()=>{const row=db.prepare('SELECT * FROM version_preservation WHERE singleton=1').get();return {...native,intentDigest:digest(row.intent_json),versionsDigest:digest(row.versions_json)};},
   verifySourceRecord:({kind,record})=>trustedRecords.get(record)===kind?true:undefined,
   beforeCommit:()=>{productionDatabaseIdentity(pinned.database);storedReceipt(db,pinned,command);if(digestProduction(readProductionProjection(db))!==projectionDigest)fail('PRODUCTION_PROJECTION_CHANGED');for(const request of recheckRequests)validateProductionFreshness(request.payload);if(backup)validateProductionFreshness(backup);},
   persistReceipt:({row,report})=>{
    committed={mode:'applied',command,operationId:pinned.operationId,specHash:pinned.specHash,databaseId:pinned.database.databaseId,databaseIdentity:validated.databaseIdentity,role:validated.role,state:row.state,freezeDigest,projectionDigest,intentDigest:digest(row.intent_json),snapshotDigest:row.snapshot_json?digest(row.snapshot_json):null,evidenceDigest:digestProduction(fresh),backupDigest:backup?digestProduction(backup):null,report:copy(report)};
    receiptWrite=true;try{db.prepare('INSERT OR IGNORE INTO production_preservation_identity VALUES(1,?,?)').run(pinned.database.databaseId,canonicalProduction(pinned.database));db.prepare('INSERT INTO production_preservation_receipts VALUES(?,?,?,?)').run(pinned.operationId,command,pinned.specHash,canonicalProduction(committed));}finally{receiptWrite=false;}
   }
  });
  await guard[{prepare:'begin',seal:'seal',restore:'restore',abort:'abort'}[command]]({operationId:pinned.operationId,versions:FROZEN_VERSIONS});
  if(!committed)fail('PRODUCTION_RECEIPT_MISSING');
  return copy(committed);
 }finally{db.close();}
}
