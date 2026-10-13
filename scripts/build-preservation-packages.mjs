import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {patchRuntimeProfileBinding,patchNativeProfileBinding} from './preservation-profile-patch.mjs';
const root=path.resolve(import.meta.dirname,'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(command,args,cwd=root)=>execFileSync(command,args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
function replace(text,needle,value,file){const count=text.split(needle).length-1;if(count!==1)throw new Error(`Baseline anchor mismatch ${file}: ${count}`);return text.replace(needle,value);}
function patch(file,apply){fs.writeFileSync(file,apply(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')));}
const shared=['backend/version-preservation.mjs','backend/preservation-native-evidence.mjs','backend/preservation-native-databases.mjs','backend/preservation-legacy-archive.mjs','backend/preservation-legacy-source.mjs','backend/preservation-source-namespace.mjs','backend/production-preservation.mjs','scripts/production-source-proof.mjs','src/execution-admission.mjs','src/hermes-profile-binding.py','scripts/preservation-profile-patch.mjs','scripts/client-lifecycle.mjs','scripts/v2-preservation.mjs','scripts/verify-preservation-packages.mjs'];
function v1Overlay(directory){
  patch(path.join(directory,'backend/db.mjs'),text=>{
    text=replace(text,"import path from 'node:path';","import path from 'node:path';\nimport {createPreservation} from './version-preservation.mjs';",'db import');
    text=replace(text,"export function openDatabase({ memory = false, filename = path.join(ROOT, 'data', 'ziwei.sqlite') } = {}) {","export function openDatabase({ memory = false, filename = process.env.ZIWEI_DB_FILE || path.join(ROOT, 'data', 'ziwei.sqlite'), preservation } = {}) {",'db path');
    return replace(text,"db.exec('PRAGMA busy_timeout = 5000');","db.exec('PRAGMA busy_timeout = 5000');\n  createPreservation(db,preservation);",'db registration');
  });
  patch(path.join(directory,'backend/repository.mjs'),text=>{
    text=replace(text,"import crypto from 'node:crypto';","import crypto from 'node:crypto';\nimport {guardRepository} from './version-preservation.mjs';",'repository import');
    text=replace(text,'  return {\n    db,','  return guardRepository({\n    db,','repository return');
    text=replace(text,'  };\n}\n','  },options.preservation);\n}\n','repository end');
    text=text.replaceAll("WHERE id=? AND status IN ('pending','acked')","WHERE id=? AND ziwei_v2_admitted(id)=1 AND status IN ('pending','acked')");
    text=replace(text,"WHERE workspace_id=? AND status IN ('pending','acked') AND expires_at","WHERE workspace_id=? AND ziwei_v2_admitted(id)=1 AND status IN ('pending','acked') AND expires_at",'poll expiry');
    text=replace(text,"Date.parse(current.expires_at) <= Date.now()) {","Date.parse(current.expires_at) <= Date.now() && db.prepare('SELECT ziwei_v2_admitted(?) admitted').get(current.id).admitted===1) {",'history expiry');
    text=replace(text,"WHERE status IN ('queued','retrying') AND (next_retry_at","WHERE ziwei_v2_automation_admitted(automation_id)=1 AND status IN ('queued','retrying') AND (next_retry_at",'webhook dispatch');
    text=replace(text,"for (const item of items) due.push(this.runAutomation(item.id,'scheduled'));","for (const item of items) if(db.prepare('SELECT ziwei_v2_automation_admitted(?) admitted').get(item.id).admitted===1)due.push(this.runAutomation(item.id,'scheduled'));",'scheduler');
    return text;
  });
  patch(path.join(directory,'backend/app.mjs'),text=>{
    text=replace(text,"import { createRepository } from './repository.mjs';","import { createRepository } from './repository.mjs';\nimport {guardRepository} from './version-preservation.mjs';",'app import');
    text=replace(text,"const repo = options.repository || createRepository({ ...options, onEvent: event => realtime.publish(event) });","const repo = guardRepository(options.repository || createRepository({ ...options, onEvent: event => realtime.publish(event) }),options.preservation);",'app injection');
    const anchor="  app.post('/a2a/v1/actions/:id/ack',";const offset=text.indexOf(anchor),end=text.indexOf('\n',offset);if(offset<0)throw new Error('ACK route absent');
    return text.slice(0,end)+"\n  app.post('/a2a/v1/actions/:id/execution-admission',(req,res)=>{if(!assertA2AActionWorkspace(repo,req,res))return;res.json(repo.authorizeActionExecution(req.params.id,{deviceId:req.deviceCredential?.deviceId}));});"+text.slice(end);
  });
  for(const file of ['backend/ziwei-connect.mjs','backend/phone-mcp.mjs'])fs.copyFileSync(path.join(root,file),path.join(directory,file));
  patch(path.join(directory,'backend/management.mjs'),text=>{
    for(const [signature,input] of [['updateEmployee(slug, id, input, context = {}) {','{employeeId:id}'],['createConversation(slug,input={},context={}) {','input'],['createTask(slug, input, context = {}) {','input'],['createProfile(slug, input, context = {}) {','input']])text=replace(text,signature,signature+'\n      repo.preservation?.assert('+input+');','management preflight');return text;
  });
  // V2 has no baseline daemon changes; this overlay adds only maintenance
  // visibility. The V1 local executor keeps its original supported actions.
  fs.copyFileSync(path.join(root,'daemon/ziwei_user.mjs'),path.join(directory,'daemon/ziwei_user.mjs'));
  fs.copyFileSync(path.join(root,'src/daemon.mjs'),path.join(directory,'src/daemon.mjs'));
  fs.copyFileSync(path.join(root,'src/management-bootstrap.mjs'),path.join(directory,'src/management-bootstrap.mjs'));
  patch(path.join(directory,'src/local-action.mjs'),text=>{
    text=replace(text,"import fs from 'node:fs';","import fs from 'node:fs';\nimport {authorizeNativeExecution,assertNoOwnedBotResource,createHermesExecutionGuard} from './execution-admission.mjs';",'executor import');
    text=replace(text,'{runtimeDir, defaultWorkdir','{runtimeDir, admissionHandledByDispatcher=false, defaultWorkdir','executor flag');
    text=replace(text,'  return async (action, context = {}) => {','  const admissions=new Map();\n  const execute = async (action, context = {}) => {\n    const permit=admissionHandledByDispatcher?admissions.get(action.id):await authorizeNativeExecution(action,{apiBase,workspace,deviceId,deviceToken,signal:context.signal,hermesHome:hermesHomePath||hermesHome(),runtimeDir,defaultWorkdir});\n    assertNoOwnedBotResource(action,{hermesHome:hermesHomePath||hermesHome(),protectedHomes:permit?.protectedHomes||[],runtimeDir,defaultWorkdir});\n    admissions.delete(action.id);','executor admission');
    text=replace(text,'      const preparedManagement = automaticManagement',"      const executionGuard=createHermesExecutionGuard(action,{protectedHomes:permit?.protectedHomes||[],runtimeDir,defaultWorkdir});\n      if(String(runtime).trim().toLowerCase()==='hermes')executionGuard.select({sourceHome:hermesProfileHome(payload.profile||payload.runtimeProfile||payload.runtime_profile||payload.hermesProfile||payload.hermes_profile||'default',{baseHome:hermesHomePath||payload.env?.HERMES_HOME||hermesHome()}),profile:payload.profile||payload.runtimeProfile||payload.runtime_profile||payload.hermesProfile||payload.hermes_profile||'default',baseHome:hermesHomePath||payload.env?.HERMES_HOME||hermesHome()});\n      const preparedManagement = automaticManagement",'executor resource binding');
    text=replace(text,'        codexMcpDisabledServers,','        codexMcpDisabledServers,\n        executionGuard,','executor trusted guard');
    if(!/  };\n}\s*$/.test(text))throw new Error('Executor suffix changed');
    return text.replace(/  };\n}\s*$/,'  };\n  execute.authorizeExecution=async action=>{const permit=await authorizeNativeExecution(action,{apiBase,workspace,deviceId,deviceToken,hermesHome:hermesHomePath||hermesHome(),runtimeDir,defaultWorkdir});admissions.set(action.id,permit);return permit;};\n  execute.maintenanceStatus=()=>({safe:true,workers:[]});\n  execute.close=async()=>{};\n  return execute;\n}\n');
  });
  patch(path.join(directory,'src/runtime-adapters.mjs'),patchRuntimeProfileBinding);
  patch(path.join(directory,'src/hermes-mcp-bootstrap.py'),patchNativeProfileBinding);
  patch(path.join(directory,'frontend/index.html'),text=>replace(text,'<body>','<body>\n    <div role="status" style="background:#eef6ff;color:#174e88;padding:8px 16px;font:14px sans-serif">V2 Bot 已封存，数据保留。原员工功能继续可用；恢复 V2 后可显式恢复 Bot。</div>','frontend notice'));
}
function fileList(directory,prefix=''){return fs.readdirSync(path.join(directory,prefix),{withFileTypes:true}).flatMap(entry=>{const relative=path.posix.join(prefix,entry.name);if(['node_modules','.git','data','.local'].includes(entry.name))return [];return entry.isDirectory()?fileList(directory,relative):[{path:relative,sha256:sha(fs.readFileSync(path.join(directory,relative)))}];});}
export function buildPackages({output=path.join(root,'.local','preservation-packages')}={}){
  if(fs.existsSync(output))throw new Error('Output already exists; use a fresh directory to preserve history');fs.mkdirSync(output,{recursive:true});
  const overlays=shared.concat(['backend/db.mjs','backend/repository.mjs','backend/app.mjs','backend/bots.mjs','backend/management.mjs','backend/ziwei-connect.mjs','backend/phone-mcp.mjs','src/local-action.mjs','src/daemon.mjs','src/management-bootstrap.mjs','src/runtime-adapters.mjs','src/hermes-gateway-runtime.mjs','daemon/ziwei_user.mjs']);
  overlays.push('src/hermes-mcp-bootstrap.py','src/hermes-native-bridge.py');
  const candidateCommit=run('git',['rev-parse','HEAD']).trim(),overlay=overlays.map(file=>({path:file,sha256:sha(fs.readFileSync(path.join(root,file)))})),packages=[];
  const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  for(const role of ['v1-compat','v2']){
    const baseline=role==='v2'?FROZEN_VERSIONS.v2:FROZEN_VERSIONS.v1,directory=path.join(output,role),archive=path.join(output,`${role}-baseline.tar`);fs.mkdirSync(directory);
    run('git',['archive','--format=tar',baseline,`--output=${archive}`]);run('tar',['-xf',archive,'-C',directory]);
    for(const file of shared){fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(directory,file));}
    if(role==='v1-compat')v1Overlay(directory);else for(const file of overlays)fs.copyFileSync(path.join(root,file),path.join(directory,file));
    patch(path.join(directory,'src/execution-admission.mjs'),text=>text.replace("PRODUCT_ROLE='v2'",`PRODUCT_ROLE='${role}'`));
    const meta=JSON.parse(fs.readFileSync(path.join(directory,'package.json')));meta.files=[...new Set([...meta.files,'backend/version-preservation.mjs','backend/preservation-native-evidence.mjs','backend/preservation-native-databases.mjs','backend/preservation-legacy-archive.mjs','backend/preservation-legacy-source.mjs','backend/preservation-source-namespace.mjs','backend/production-preservation.mjs','scripts/production-source-proof.mjs','scripts/v2-preservation.mjs','scripts/verify-preservation-packages.mjs','preservation-package.json'])];meta.bundleDependencies=Object.keys(meta.dependencies);
    fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify(meta,null,2)+'\n');
    const descriptor={schemaVersion:1,product:role==='v2'?'V2':'V1 data-preserving compatibility',productRole:role,packageSemver:meta.version,baseline,candidateCommit,versions:FROZEN_VERSIONS,overlay,productionApplied:false};fs.writeFileSync(path.join(directory,'preservation-package.json'),JSON.stringify(descriptor,null,2));
    fs.symlinkSync(path.join(root,'node_modules'),path.join(directory,'node_modules'),'junction');
    run(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--config','frontend/vite.config.mjs'],directory);
    const pack=JSON.parse(run(process.execPath,[npmCli,'pack','--json','--ignore-scripts','--offline','--pack-destination',output],directory));
    const clientFile=path.join(output,`${role}-windows-client.tgz`);fs.renameSync(path.join(output,pack[0].filename),clientFile);
    const installPrefix=path.join(output,role+'-installation-proof');fs.mkdirSync(installPrefix);run(process.execPath,[npmCli,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',installPrefix,clientFile]);const installedRoot=path.join(installPrefix,'node_modules/ziwei'),clientContents=fileList(installedRoot),installationChanges=clientContents.filter(row=>fs.existsSync(path.join(directory,row.path))&&sha(fs.readFileSync(path.join(directory,row.path)))!==row.sha256).map(row=>({...row,sourceSha256:sha(fs.readFileSync(path.join(directory,row.path)))}));
    const frontendFile=path.join(output,`${role}-frontend.zip`);run('tar',['-a','-cf',frontendFile,'-C',path.join(directory,'frontend/dist'),'.']);
    const apiFile=path.join(output,`${role}-api.zip`);run('tar',['-a','-cf',apiFile,'-C',directory,'backend','src','scripts','skills','daemon','package.json','package-lock.json','preservation-package.json']);
    const contents=fileList(directory),manifest={...descriptor,sourceClientBuild:clientBuildIdentity(directory),clientBuild:clientBuildIdentity(installedRoot),clientContents,installationChanges,contents,buildDigest:sha(JSON.stringify(contents)),artifacts:[clientFile,frontendFile,apiFile].map(file=>({path:file,sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size})),offlineDependenciesBundled:true,apiDependencies:'Install bundled local client into an isolated prefix; use its node_modules for API. No global installation.'};
    fs.writeFileSync(path.join(output,`${role}-manifest.json`),JSON.stringify(manifest,null,2));packages.push({role,directory,manifest});
  }
  fs.writeFileSync(path.join(output,'build-receipt.json'),JSON.stringify({schemaVersion:1,candidateCommit,output,packages:packages.map(({role,directory,manifest})=>({role,directory,buildDigest:manifest.buildDigest,artifacts:manifest.artifacts}))},null,2));return packages;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const index=process.argv.indexOf('--output');const packages=buildPackages({output:index>=0?path.resolve(process.argv[index+1]):undefined});console.log(JSON.stringify(packages.map(({role,directory,manifest})=>({role,directory,buildDigest:manifest.buildDigest,artifacts:manifest.artifacts})),null,2));}
