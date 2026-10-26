import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseDocument} from 'yaml';

const MAX_FILE_BYTES=256*1024,MAX_ITEMS=200;
const SUBJECT_KEYS=['workspace','workspaceId','employeeId','ownerUserId','deviceId','runtime','profile','revision','controlEpoch','configFingerprint'];
const SOURCES=new Set(['runtime_skill','project_skill','shared_skill','platform_config','runtime_config','npm_package','managed_installation']);
const CLI_PACKAGES=Object.freeze([
 {id:'team',name:'Team Planner',packageName:'@ziwei/team-planner-cli',command:'team-planner'},
 {id:'lark',name:'飞书 CLI',packageName:'@larksuite/cli',command:'lark-cli'},
 {id:'workspace',name:'紫薇 CLI',packageName:'@ziwei/workspace-cli',command:'ziwei-workspace'},
 {id:'bkl',name:'爆款库 CLI',packageName:'@qzelynth/bkl',command:'bkl'},
 {id:'ziwei-memory',name:'紫薇记忆 CLI',packageName:'@qzelynth/ziwei-memory-cli',command:'ziwei-memory'}
]);
const CLI_IDS=new Set([...CLI_PACKAGES.map(v=>v.id),'libtv']);
const fail=()=>{throw Object.assign(new Error('EMPLOYEE_CAPABILITY_SUBJECT_INVALID'),{code:'EMPLOYEE_CAPABILITY_SUBJECT_INVALID'});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/.test(value)&&!value.includes('..')&&!value.includes('://');
const slug=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)&&!['.','..'].includes(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fingerprint=value=>typeof value==='string'&&/^[a-fA-F0-9]{64}$/.test(value);
const clone=value=>JSON.parse(JSON.stringify(value));
function normalizeSubject(value){
 if(!object(value)||!slug(value.runtime)||!id(value.workspace)||!id(value.employeeId)||!id(value.deviceId)||(value.profile!==null&&!slug(value.profile)))fail();
 for(const field of ['workspaceId','ownerUserId'])if(value[field]!==undefined&&value[field]!==null&&!id(value[field]))fail();
 for(const field of ['revision','controlEpoch'])if(value[field]!==null&&(!Number.isSafeInteger(value[field])||value[field]<0))fail();
 if(value.configFingerprint!==undefined&&!fingerprint(value.configFingerprint))fail();
 return Object.fromEntries(SUBJECT_KEYS.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
}
function sameSubject(a,b){try{return JSON.stringify(normalizeSubject(a))===JSON.stringify(normalizeSubject(b));}catch{return false;}}
function safeSummary(value,max=500){
 if(typeof value!=='string')return null;
 return value.replace(/[\0-\x1f\x7f]/g,' ').replace(/https?:\/\/\S+/gi,'[link]')
  .replace(/\b(?:api[_ -]?key|token|password|secret|authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,'[redacted]')
  .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g,'[redacted]')
  .replace(/\b[A-Za-z0-9_+/-]{40,}={0,2}\b/g,'[redacted]').replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|etc)\/)[^\s]+/g,'[path]')
  .replace(/\s+/g,' ').trim().slice(0,max)||null;
}
const safeName=value=>slug(value)&&safeSummary(value,100)===value;
const version=value=>typeof value==='string'&&/^[0-9][0-9A-Za-z.+-]{0,39}$/.test(value)?value:null;
const baseLayers=()=>({installation:'unknown',visibility:'unknown',configuration:'unknown',authorization:'unknown',loaded:'unknown'});
const section=(items,status='ready',reason=null)=>({status,reason,items});
function reasonFor(error){return ['ENOENT','ENOTDIR'].includes(error?.code)?'metadata_missing':error?.code==='CAPABILITY_METADATA_TOO_LARGE'?'metadata_too_large':'metadata_unreadable';}
function filesystem(io={}){return{lstatSync:io.lstatSync||fs.lstatSync,statSync:io.statSync||fs.statSync,readFileSync:io.readFileSync||fs.readFileSync,readdirSync:io.readdirSync||fs.readdirSync};}
function noLinks(file,io){
 if(!path.isAbsolute(file)||/[\0\r\n]/.test(file))throw Error('CAPABILITY_PATH_INVALID');
 let current=path.resolve(file),count=0;
 while(current!==path.dirname(current)&&count++<64){try{if(io.lstatSync(current).isSymbolicLink())throw Error('CAPABILITY_PATH_LINK');}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}current=path.dirname(current);}
}
function readMetadata(file,io){noLinks(file,io);const st=io.lstatSync(file);if(!st.isFile()||st.size>MAX_FILE_BYTES)throw Object.assign(Error('CAPABILITY_METADATA_TOO_LARGE'),{code:'CAPABILITY_METADATA_TOO_LARGE'});const content=io.readFileSync(file,'utf8');if(Buffer.byteLength(content)>MAX_FILE_BYTES)throw Object.assign(Error('CAPABILITY_METADATA_TOO_LARGE'),{code:'CAPABILITY_METADATA_TOO_LARGE'});return content;}
function parseYaml(content){const document=parseDocument(content,{uniqueKeys:true});if(document.errors.length)throw Error('CAPABILITY_METADATA_INVALID');const value=document.toJS({maxAliasCount:0});if(!object(value))throw Error('CAPABILITY_METADATA_INVALID');return value;}
function evidence(runtimeContext,kind,group,subject,name){const value=runtimeContext[kind];return object(value)&&sameSubject(value.subject,subject)&&Array.isArray(value[group])&&value[group].includes(name);}
function permissionMode(config){return config.permissionMode||config.permissions?.mode||'unknown';}

/** Only local daemon settings select HOME/cwd. Wire homeCandidate/paths are ignored. */
export function deriveCapabilityRuntimeContext({payload,hermesHome,codexHome,defaultWorkdir}={}){
 const subject=normalizeSubject(payload?.capabilityInspection?.subject||payload?.subject);
 const base=subject.runtime==='Hermes'?hermesHome:subject.runtime==='Codex'?codexHome:null;
 const home=typeof base==='string'&&path.isAbsolute(base)?(subject.runtime==='Hermes'&&subject.profile&&subject.profile!=='default'?path.join(base,'profiles',subject.profile):base):null;
 return{home,cwd:typeof defaultWorkdir==='string'&&path.isAbsolute(defaultWorkdir)?path.resolve(defaultWorkdir):null};
}

/** Known package filenames under bounded local installation roots; never run npm or a CLI. */
export function deriveMachineCapabilityRoots({env=process.env,execPath=process.execPath,argvEntry=process.argv[1]}={}){
 const roots=[];const add=value=>{if(typeof value==='string'&&path.isAbsolute(value)&&!/[\0\r\n]/.test(value)&&!roots.includes(path.resolve(value)))roots.push(path.resolve(value));};
 add(path.join(path.dirname(execPath),'node_modules'));
 if(env.APPDATA)add(path.join(env.APPDATA,'npm','node_modules'));
 const prefix=env.npm_config_prefix||env.NPM_CONFIG_PREFIX;if(prefix&&path.isAbsolute(prefix))add(path.join(prefix,'node_modules'));
 if(argvEntry&&path.isAbsolute(argvEntry)){let parent=path.dirname(argvEntry);for(let n=0;n<8;n++){if(path.basename(parent)==='node_modules')add(parent);const next=path.dirname(parent);if(next===parent)break;parent=next;}}
 return roots.slice(0,16);
}

export function createMachineCapabilityInventory({npmRoots=deriveMachineCapabilityRoots(),managedCliRecords=[],io:injected={},now=Date.now,ttlMs=30000}={}){
 const io=filesystem(injected),roots=[...new Set(npmRoots.filter(p=>typeof p==='string'&&path.isAbsolute(p)))].slice(0,16);let cached=null,expires=0,inflight=null;
 async function discover(){
  const items=[];let found=0;
  for(const spec of CLI_PACKAGES){let item={id:spec.id,name:spec.name,...baseLayers(),source:'npm_package',reason:'managed_installation_not_found'};
   for(const root of roots){const folder=path.join(root,...spec.packageName.split('/'));try{
    const meta=JSON.parse(readMetadata(path.join(folder,'package.json'),io));if(meta.name!==spec.packageName)continue;
    const bin=typeof meta.bin==='string'?meta.bin:meta.bin?.[spec.command];if(typeof bin!=='string'||!bin||path.isAbsolute(bin)||/[\0\r\n]/.test(bin))continue;
    const executable=path.resolve(folder,bin),relative=path.relative(folder,executable);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;
    noLinks(executable,io);if(!io.lstatSync(executable).isFile())continue;
    item={...item,packageName:spec.packageName,version:version(meta.version),installation:'installed',reason:null};found++;break;
   }catch{/* No private filesystem diagnostics or package bodies leave the collector. */}}
   items.push(item);
  }
  for(const record of managedCliRecords.slice(0,32)){
   if(!object(record)||!CLI_IDS.has(record.id)||record.trusted!==true||!['official_installer','ziwei_managed_installation'].includes(record.source)||typeof record.binaryPath!=='string')continue;
   const previous=items.find(item=>item.id===record.id);if(previous?.installation==='installed')continue;
   try{noLinks(record.binaryPath,io);if(!io.lstatSync(record.binaryPath).isFile())continue;const item={id:record.id,name:record.id==='libtv'?'LibTV CLI':CLI_PACKAGES.find(v=>v.id===record.id).name,...baseLayers(),source:'managed_installation',installation:'installed',version:version(record.version),reason:version(record.version)?null:'version_unknown'};if(previous)items.splice(items.indexOf(previous),1,item);else items.push(item);found++;}catch{}}
  if(!items.some(item=>item.id==='libtv'))items.push({id:'libtv',name:'LibTV CLI',...baseLayers(),source:'managed_installation',reason:'managed_installation_not_verified'});
  return section(items,found?'partial':'unknown',found?'employee_authorization_unverified':'managed_installation_not_verified');
 }
 return async function machineInventory(){const time=now();if(cached&&time<expires)return clone(cached);if(!inflight)inflight=discover().then(value=>{cached=value;expires=now()+Math.max(1000,Math.min(300000,ttlMs));return value;}).finally(()=>{inflight=null;});return clone(await inflight);};
}

function defaultSkillRoots(subject,context){const roots=[];if(context.home)roots.push({path:path.join(context.home,'skills'),scope:'runtime'});if(context.cwd&&subject.runtime==='Codex'){roots.push({path:path.join(context.cwd,'.agents','skills'),scope:'project'});roots.push({path:path.join(context.cwd,'.codex','skills'),scope:'project'});}return roots;}
function skillEntries(root,io){
 const entriesFound=[],queue=[{directory:root,depth:0}];let visited=0,truncated=false;
 while(queue.length&&visited<400&&entriesFound.length<MAX_ITEMS){const{directory,depth}=queue.shift();noLinks(directory,io);const listed=io.readdirSync(directory,{withFileTypes:true});if(listed.length>MAX_ITEMS)truncated=true;const entries=listed.slice(0,MAX_ITEMS).sort((a,b)=>a.name.localeCompare(b.name));
  for(const entry of entries){if(visited>=400||entriesFound.length>=MAX_ITEMS){truncated=true;break;}visited++;if(!entry.isDirectory()||entry.isSymbolicLink()||!(slug(entry.name)||entry.name==='.system'))continue;
   const folder=path.join(directory,entry.name),file=path.join(folder,'SKILL.md');let exists=false;try{const st=io.lstatSync(file);exists=st.isFile()&&!st.isSymbolicLink();}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
   if(exists)entriesFound.push({name:entry.name,file});else if(depth<2)queue.push({directory:folder,depth:depth+1});else truncated=true;
  }
 }
 if(queue.length)truncated=true;
 return{entries:entriesFound,truncated};
}
function collectSkills(subject,config,context,io){
 const roots=Array.isArray(context.skillRoots)?context.skillRoots.slice(0,16):defaultSkillRoots(subject,context),items=[],seen=new Set();let readable=0,failed=0,runtimeRootObserved=false,externalNotInspected=false,truncated=Array.isArray(context.skillRoots)&&context.skillRoots.length>16;
 let nativeDisabled=[];
 if(subject.runtime==='Hermes'&&context.home){try{const native=parseYaml(readMetadata(path.join(context.home,'config.yaml'),io));nativeDisabled=Array.isArray(native.skills?.disabled)?native.skills.disabled.filter(slug).slice(0,MAX_ITEMS):[];const declared=[...(Array.isArray(native.skills?.external_dirs)?native.skills.external_dirs:[]),...(native.skills?.create_dir?[native.skills.create_dir]:[])];externalNotInspected=declared.some(value=>typeof value!=='string'||!path.isAbsolute(value)||!roots.some(root=>typeof root.path==='string'&&path.isAbsolute(root.path)&&path.resolve(root.path)===path.resolve(value)));}catch{/* No native enablement is inferred when policy is absent or unreadable. */}}
 if(!roots.length)return section([],'unknown','runtime_context_unavailable');
 for(const root of roots){if(items.length>=MAX_ITEMS){truncated=true;break;}if(!object(root)||!['runtime','project','shared'].includes(root.scope)||typeof root.path!=='string'){failed++;continue;}
  let entries;try{noLinks(root.path,io);const scan=skillEntries(root.path,io);entries=scan.entries;truncated||=scan.truncated;readable++;if(root.scope==='runtime')runtimeRootObserved=true;}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))failed++;continue;}
  for(const entry of entries){if(items.length>=MAX_ITEMS){truncated=true;break;}
   const file=entry.file;let content,meta;try{content=readMetadata(file,io);const match=content.match(/^\uFEFF?---\s*\r?\n([\s\S]{0,16384}?)\r?\n---(?:\r?\n|$)/);if(!match)throw Error('CAPABILITY_METADATA_INVALID');meta=parseYaml(match[1]);}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))failed++;continue;}
   const name=safeName(meta.name)?meta.name:entry.name;if(!safeName(name))continue;const key=root.scope+':'+name;if(seen.has(key))continue;seen.add(key);
   const disabled=(config.skills?.disabled||[]).includes(name)||(Array.isArray(config.disabledSkills)&&config.disabledSkills.includes(name));
   const runtimeDisabled=(context.disabledSkills||[]).includes(name)||nativeDisabled.includes(name);const enabled=disabled||runtimeDisabled?'disabled':evidence(context,'enabledEvidence','skills',subject,name)?'enabled':'unknown';
   const assignments=object(context.skillAssignments)?context.skillAssignments:{};const catalogId=typeof assignments[name]==='string'&&id(assignments[name])?assignments[name]:null;
   const assigned=Array.isArray(config.skills)?(catalogId?config.skills.includes(catalogId)?'assigned':'not_assigned':'unknown'):'unknown';
   const item={id:`skill:${root.scope}:${name}`,name,description:safeSummary(meta.description),version:version(String(meta.version??'')),hash:createHash('sha256').update(content).digest('hex'),source:`${root.scope}_skill`,...baseLayers(),installation:'installed',visibility:'visible',configuration:'configured',assigned,enabled,onDemand:enabled==='disabled'?'unavailable':evidence(context,'onDemandEvidence','skills',subject,name)?'available':'unknown',authorization:evidence(context,'authorizationEvidence','skills',subject,name)?'authorized':'unknown',loaded:evidence(context,'loadedEvidence','skills',subject,name)?'loaded':'unknown',reason:null};items.push(item);
  }
 }
 const incomplete=failed||!runtimeRootObserved||externalNotInspected||truncated;
 return section(items,truncated?'partial':incomplete?(items.length?'partial':'unknown'):readable?'ready':'unknown',truncated?'inventory_truncated':externalNotInspected?'external_roots_not_inspected':failed?'some_metadata_unreadable':!runtimeRootObserved?'runtime_skill_root_missing':readable?null:'skill_roots_missing');
}

function tomlMcp(content){const servers=Object.create(null);let name=null,count=0,truncated=false;for(const line of content.split(/\r?\n/)){const header=line.match(/^\s*\[mcp_servers\.(?:([A-Za-z0-9_-]+)|"([A-Za-z0-9_-]+)")\]\s*(?:#.*)?$/);if(header){name=header[1]||header[2];if(!Object.hasOwn(servers,name)){if(count>=MAX_ITEMS){truncated=true;break;}count++;servers[name]={};}continue;}if(/^\s*\[/.test(line)){name=null;continue;}if(!name)continue;if(/^\s*command\s*=/.test(line))servers[name].transport='stdio';if(/^\s*url\s*=/.test(line))servers[name].transport='http';const enabled=line.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/);if(enabled)servers[name].enabled=enabled[1]==='true';}return{servers,truncated};}
function collectMcp(subject,config,context,io){
 const items=[],entries=new Map();let read=false,failed=false,truncated=false;
 const add=(value,source)=>{const values=Array.isArray(value)?value.map(v=>[v?.name,v]):object(value)?Object.entries(value):[];if(values.length>MAX_ITEMS)truncated=true;for(const[name,v]of values.slice(0,MAX_ITEMS)){if(!safeName(name)||!object(v))continue;if(entries.size>=MAX_ITEMS&&!entries.has(name)){truncated=true;continue;}entries.set(name,{entry:v,source});}};
 try{if(object(context.mcpConfiguration)){add(context.mcpConfiguration,'runtime_config');read=true;}else if(context.home){const file=subject.runtime==='Hermes'?path.join(context.home,'config.yaml'):path.join(context.home,!subject.profile||subject.profile==='default'?'config.toml':`${subject.profile}.config.toml`),raw=readMetadata(file,io);if(subject.runtime==='Hermes')add(parseYaml(raw).mcp_servers,'runtime_config');else{const scan=tomlMcp(raw);truncated||=scan.truncated;add(scan.servers,'runtime_config');}read=true;}}catch{failed=true;}
 add(config.mcpServers,'platform_config');
 for(const[name,{entry,source}]of entries){let transport=entry.transport||entry.type;if(transport==='streamable-http'||transport==='streamable_http')transport='http';if(!['stdio','http','sse'].includes(transport))transport=typeof entry.command==='string'?'stdio':typeof entry.url==='string'?'http':'unknown';const disabled=entry.enabled===false;items.push({id:`mcp:${name}`,name,source,transport,...baseLayers(),configuration:'configured',visibility:source==='runtime_config'?'visible':'unknown',enabled:disabled?'disabled':'enabled',authorization:evidence(context,'authorizationEvidence','mcp',subject,name)?'authorized':'unknown',loaded:evidence(context,'loadedEvidence','mcp',subject,name)?'loaded':'unknown',reason:null});}
 return section(items,truncated?'partial':failed?(items.length?'partial':'unknown'):read||items.length?'ready':'unknown',truncated?'inventory_truncated':failed?'native_configuration_unreadable':read||items.length?null:'runtime_context_unavailable');
}

function normalizeMachineCli(machine,subject,context){const items=[];for(const raw of (Array.isArray(machine?.items)?machine.items:[]).slice(0,64)){
 if(!object(raw)||!CLI_IDS.has(raw.id))continue;
 const spec=CLI_PACKAGES.find(v=>v.id===raw.id),item={id:raw.id,name:spec?.name||'LibTV CLI',source:SOURCES.has(raw.source)?raw.source:'managed_installation',...baseLayers(),installation:raw.installation==='installed'?'installed':'unknown',version:version(raw.version),visibility:Array.isArray(context.cliVisibility)&&context.cliVisibility.includes(raw.id)?'visible':'unknown',authorization:evidence(context,'authorizationEvidence','cli',subject,raw.id)?'authorized':'unknown',loaded:evidence(context,'loadedEvidence','cli',subject,raw.id)?'loaded':'unknown',reason:raw.installation==='installed'?null:'managed_installation_not_verified'};
 if(spec&&raw.packageName===spec.packageName)item.packageName=spec.packageName;
 items.push(item);
 }return section(items,items.some(v=>v.installation==='installed')?'partial':'unknown','employee_authorization_unverified');}

/** Read-only metadata collector. Never executes CLI discovery, tools, models, or authentication. */
export async function collectEmployeeCapabilityInventory({subject:rawSubject,config={},runtimeContext={},machineInventory,io:injected={},now=Date.now}={}){
 const subject=normalizeSubject(rawSubject),io=filesystem(injected);let machine=null;
 try{machine=typeof machineInventory==='function'?await machineInventory():machineInventory;}catch{/* Fixed unknown status; no private exception text. */}
 return{schemaVersion:1,subject,checkedAt:new Date(now()).toISOString(),source:'device_readonly',sections:{skills:['Codex','Hermes'].includes(subject.runtime)?collectSkills(subject,config,runtimeContext,io):section([],'unknown','runtime_not_adapted'),mcp:['Codex','Hermes'].includes(subject.runtime)?collectMcp(subject,config,runtimeContext,io):section([],'unknown','runtime_not_adapted'),cli:normalizeMachineCli(machine,subject,runtimeContext)}};
}
