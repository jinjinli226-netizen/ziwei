import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
import {verifyPreservationPackages} from './verify-preservation-packages.mjs';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=(code,detail)=>{throw Object.assign(new Error(`${code}: ${detail}`),{code});};
const inside=(root,file)=>{const relative=path.relative(root,file);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export function preservationNpmCli(){
 const file=[path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].find(value=>fs.existsSync(value));
 if(!file)fail('OFFLINE_NPM_UNAVAILABLE','current Node runtime');return file;
}
/** Inspect the actual installed required dependency graph, including nested versions.
 * An ancestor/global copy cannot satisfy the archive's offline closure claim. */
export function inspectRuntimeDependencyClosure(installedRoot){
 installedRoot=fs.realpathSync.native(installedRoot);const dependencyRoot=fs.realpathSync.native(path.dirname(installedRoot)),semver=createRequire(preservationNpmCli())('semver'),queue=[installedRoot],seen=new Set(),packages=[],edges=[];
 while(queue.length){const directory=queue.shift();if(seen.has(directory))continue;seen.add(directory);
  const file=path.join(directory,'package.json'),bytes=fs.readFileSync(file),meta=JSON.parse(bytes),require=createRequire(file);
  if(!inside(dependencyRoot,directory)||!semver.valid(meta.version))fail('OFFLINE_DEPENDENCY_INVALID',meta.name||directory);
  packages.push({path:path.relative(dependencyRoot,directory).replaceAll('\\','/'),name:meta.name,version:meta.version,packageJsonSha256:sha(bytes)});
  const dependencies=[...Object.entries({...meta.dependencies,...meta.optionalDependencies}).map(([name,range])=>({name,range,optional:Object.hasOwn(meta.optionalDependencies||{},name),relationship:'dependency'})),...Object.entries(meta.peerDependencies||{}).map(([name,range])=>({name,range,optional:meta.peerDependenciesMeta?.[name]?.optional===true,relationship:'peer'}))];
  for(const {name,range,optional,relationship} of dependencies){
   if(!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name))fail('OFFLINE_DEPENDENCY_INVALID',name);
   const candidate=(require.resolve.paths(name)||[]).map(base=>path.join(base,name)).find(value=>fs.existsSync(path.join(value,'package.json')));
   if(!candidate){if(optional)continue;fail('OFFLINE_DEPENDENCY_MISSING',`${meta.name} -> ${name}`);}
   const target=fs.realpathSync.native(candidate),value=JSON.parse(fs.readFileSync(path.join(target,'package.json')));
   if(!inside(dependencyRoot,target))fail('OFFLINE_DEPENDENCY_ESCAPE',`${meta.name} -> ${name}`);
   if(!semver.satisfies(value.version,range))fail('OFFLINE_DEPENDENCY_VERSION',`${meta.name} -> ${name}@${value.version} requires ${range}`);
   edges.push({from:path.relative(dependencyRoot,directory).replaceAll('\\','/'),name,range,to:path.relative(dependencyRoot,target).replaceAll('\\','/'),version:value.version,optional,relationship});queue.push(target);
  }
 }
 packages.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);edges.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return {packages,edges,sha256:sha(JSON.stringify({packages,edges}))};
}
const fileList=(directory,prefix='')=>fs.readdirSync(path.join(directory,prefix),{withFileTypes:true}).flatMap(entry=>{const relative=path.posix.join(prefix,entry.name);if(['node_modules','.git','data','.local'].includes(entry.name))return [];return entry.isDirectory()?fileList(directory,relative):[{path:relative,sha256:sha(fs.readFileSync(path.join(directory,relative)))}];});
/** Actual cold-cache installation and actual extracted API factory, without listening. */
export function verifyOfflineRuntimeClosure({clientFile,apiFile}){
 clientFile=path.resolve(clientFile);apiFile=path.resolve(apiFile);const tempParent=fs.realpathSync.native(os.tmpdir()),temp=fs.realpathSync.native(fs.mkdtempSync(path.join(tempParent,'ziwei-offline-runtime-'))),prefix=path.join(temp,'prefix'),cache=path.join(temp,'empty-cache'),api=path.join(temp,'api');
 try{
  for(const directory of [prefix,cache,api])fs.mkdirSync(directory);const userConfig=path.join(temp,'user.npmrc'),globalConfig=path.join(temp,'global.npmrc');fs.writeFileSync(userConfig,'');fs.writeFileSync(globalConfig,'');
  const env={PATH:process.env.PATH||'',HOME:temp,USERPROFILE:temp,TMPDIR:temp,TEMP:temp,TMP:temp,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot,WINDIR:process.env.SystemRoot}:{}),NODE_PATH:''};
  const run=(command,args)=>execFileSync(command,args,{cwd:temp,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
  run(process.execPath,[preservationNpmCli(),'install','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',cache,'--userconfig',userConfig,'--globalconfig',globalConfig,'--prefix',prefix,clientFile]);
  const installedRoot=path.join(prefix,'node_modules/ziwei'),closure=inspectRuntimeDependencyClosure(installedRoot);
  run('tar',['-xf',apiFile,'-C',api]);fs.symlinkSync(path.join(installedRoot,'node_modules'),path.join(api,'node_modules'),process.platform==='win32'?'junction':'dir');
  const probe=path.join(temp,'probe.cjs');fs.writeFileSync(probe,`const assert=require('node:assert/strict'),net=require('node:net'),cp=require('node:child_process'),mod=require('node:module'),url=require('node:url'),path=require('node:path');const deny=()=>{throw Error('Offline runtime probe must not listen, use network or launch helpers')};global.fetch=deny;net.Server.prototype.listen=deny;net.Socket.prototype.connect=deny;for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=deny;mod.syncBuiltinESMExports();(async()=>{const requireClient=mod.createRequire(process.argv[2]);const express=requireClient('express'),ws=requireClient('ws'),yaml=requireClient('yaml');assert.equal(typeof express,'function');express().use(express.json());assert.equal(typeof ws.WebSocketServer,'function');assert.equal(yaml.parse('ok: true').ok,true);const {createApp}=await import(url.pathToFileURL(process.argv[3]));const app=createApp({memory:true,enableScheduler:false,envEncryptionKey:'isolated-offline-probe',objectStoreDir:path.join(process.cwd(),'objects')});try{assert.equal(typeof app,'function');assert.equal(app.locals.repo.db.prepare('SELECT 1 AS ok').get().ok,1);}finally{app.locals.repo.db.close();}console.log(JSON.stringify({imports:['express','ws','yaml','backend/app.mjs'],apiFactory:true,noListeners:true,noNetworkOrHelpers:true}));})().catch(error=>{console.error(error.stack);process.exitCode=1;});`);
  let runtime;try{runtime=JSON.parse(run(process.execPath,[probe,path.join(installedRoot,'package.json'),path.join(api,'backend/app.mjs')]).trim());}catch(error){fail('OFFLINE_RUNTIME_IMPORT_FAILED',String(error.stderr||error.message).slice(0,2000));}
  const guard=path.join(temp,'cli-guard.cjs');fs.writeFileSync(guard,`const net=require('node:net'),cp=require('node:child_process');const deny=()=>{throw Error('Offline CLI probe must not listen, use network or launch helpers')};global.fetch=deny;net.Server.prototype.listen=deny;net.Socket.prototype.connect=deny;for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[name]=deny;require('node:module').syncBuiltinESMExports();`);
  const expectedVersion=JSON.parse(fs.readFileSync(path.join(installedRoot,'package.json'))).version,cliVersion=run(process.execPath,['--require',guard,path.join(installedRoot,'scripts/ziwei-user.mjs'),'version']).trim();if(cliVersion!==`ziwei_user ${expectedVersion}`)fail('OFFLINE_CLIENT_CLI_FAILED','actual installed branded version entry');
  return {clientBuild:clientBuildIdentity(installedRoot),clientContents:fileList(installedRoot),receipt:{schemaVersion:1,kind:'actual-cold-cache-offline-runtime-closure',verified:true,clientArchiveSha256:sha(fs.readFileSync(clientFile)),apiArchiveSha256:sha(fs.readFileSync(apiFile)),emptyCacheBeforeInstall:true,installOffline:true,dependencyGraph:closure,...runtime,clientCli:{command:'version',version:expectedVersion,output:cliVersion,noStartup:true}}};
 }finally{if(path.dirname(temp)!==tempParent||!path.basename(temp).startsWith('ziwei-offline-runtime-'))throw Error('Offline runtime cleanup scope invalid');fs.rmSync(temp,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const directory=path.resolve(process.argv[2]||'.local/preservation-packages'),manifests=verifyPreservationPackages(directory),receipts=[];
 for(const manifest of manifests){const role=manifest.productRole,result=verifyOfflineRuntimeClosure({clientFile:path.join(directory,role+'-windows-client.tgz'),apiFile:path.join(directory,role+'-api.zip')});if(result.clientBuild!==manifest.clientBuild||sha(JSON.stringify(result.clientContents))!==sha(JSON.stringify(manifest.clientContents)))fail('OFFLINE_CLIENT_IDENTITY_CHANGED',role);receipts.push({role,...result.receipt});}
 fs.writeFileSync(path.join(directory,'offline-runtime-proof.json'),JSON.stringify({schemaVersion:1,candidateCommit:manifests[0].candidateCommit,receipts},null,2));console.log(JSON.stringify(receipts.map(({role,verified,dependencyGraph,imports})=>({role,verified,packages:dependencyGraph.packages.length,edges:dependencyGraph.edges.length,imports})),null,2));
}
