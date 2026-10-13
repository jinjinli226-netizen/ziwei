import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {defaultNativeSourceIO} from '../backend/preservation-source-namespace.mjs';

const binary='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const moduleRoot=path.join(path.dirname(binary),'Modules');
const helper=fs.readFileSync(new URL('../backend/preservation-source-native-windows.ps1',import.meta.url),'utf8').replaceAll('\r\n','\n');
const marker='# ZIWEI_SYSTEM_MODULE_PRELUDE_END';
function run(script,input=''){
 const env={...process.env,PSModulePath:moduleRoot};
 const directory=path.resolve('.local/preservation-native-qualification/diagnostics');fs.mkdirSync(directory,{recursive:true});
 const diagnostic=path.join(directory,crypto.randomUUID()+'.jsonl');
 return new Promise((resolve,reject)=>{
  const write=(event,fields={})=>fs.appendFileSync(diagnostic,JSON.stringify({at:new Date().toISOString(),supervisorPid:process.pid,event,...fields})+'\n');
  const child=execFile(binary,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',env,timeout:20000,maxBuffer:256*1024},(error,stdout,stderr)=>{clearInterval(timer);write('exit',{pid:child.pid,exitCode:error?.code??0,signal:error?.signal??null});if(error)reject(Object.assign(error,{stdout,stderr}));else resolve(stdout.trim()?JSON.parse(stdout):null);});
  write('start',{pid:child.pid});const timer=setInterval(()=>write('heartbeat',{pid:child.pid,alive:child.exitCode===null}),1000);child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}

test('Windows execution prelude pins the effective search path and system command provenance after startup',{skip:process.platform!=='win32',timeout:25000},async()=>{
 assert.ok(helper.includes(marker),'the execution-time module prelude must exist');
 const prelude=helper.slice(0,helper.indexOf(marker));
 const result=await run("$ziweiStartupModulePath=$env:PSModulePath;"+prelude+";Import-ZiweiSystemModule 'NetTCPIP';Import-ZiweiSystemModule 'Microsoft.PowerShell.Security';$commands=@(foreach($name in @('CimCmdlets\\Get-CimInstance','CimCmdlets\\Invoke-CimMethod','NetTCPIP\\Get-NetTCPConnection','Microsoft.PowerShell.Utility\\ConvertFrom-Json','Microsoft.PowerShell.Utility\\ConvertTo-Json','Microsoft.PowerShell.Utility\\Add-Type','Microsoft.PowerShell.Security\\Get-AuthenticodeSignature')){$command=Microsoft.PowerShell.Core\\Get-Command $name;[pscustomobject]@{name=$command.Name;type=[string]$command.CommandType;module=$command.ModuleName;modulePath=$command.Module.Path;moduleBase=$command.Module.ModuleBase}});[pscustomobject]@{startupModulePath=$ziweiStartupModulePath;effectiveModulePath=$env:PSModulePath;autoload=[string]$PSModuleAutoLoadingPreference;commands=$commands}|Microsoft.PowerShell.Utility\\ConvertTo-Json -Depth 5 -Compress");
 assert.equal(result.effectiveModulePath.toLowerCase(),moduleRoot.toLowerCase());assert.equal(result.autoload,'None');assert.equal(result.commands.length,7);
 const cim=result.commands.find(row=>row.name==='Get-CimInstance'),tcp=result.commands.find(row=>row.name==='Get-NetTCPConnection');
 assert.equal(cim.type,'Cmdlet');assert.equal(cim.module,'CimCmdlets');assert.equal(cim.moduleBase.toLowerCase(),path.join(moduleRoot,'CimCmdlets').toLowerCase());
 assert.equal(tcp.type,'Function');assert.equal(tcp.module,'MSFT_NetTCPConnection');assert.equal(tcp.modulePath.toLowerCase(),path.join(moduleRoot,'NetTCPIP','MSFT_NetTCPConnection.cdxml').toLowerCase());
 const artifact=path.resolve('.local/preservation-native-qualification/powershell-module-fixed.json');fs.writeFileSync(artifact,JSON.stringify(result,null,2));
});

test('Windows helper refuses a preloaded impostor CIM module before returning absent',{skip:process.platform!=='win32',timeout:25000},async()=>{
 const impostor="Microsoft.PowerShell.Core\\Import-Module (Microsoft.PowerShell.Core\\New-Module -Name CimCmdlets -ScriptBlock {function Get-CimInstance {return $null};Microsoft.PowerShell.Core\\Export-ModuleMember -Function Get-CimInstance}) -Force;";
 await assert.rejects(run(impostor+helper,JSON.stringify({pid:2147483647})),error=>{assert.match(error.stderr,/SOURCE_WINDOWS_MODULE_UNPROVEN/);assert.equal(error.stdout.trim(),'');return true;});
});

test('default Windows listener and absent readers work with the fixed module prelude',{skip:process.platform!=='win32',timeout:25000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-module-listener-')),entry=path.join(root,'listener.mjs'),port=46093;
 fs.writeFileSync(entry,"import net from 'node:net';const server=net.createServer();server.listen(46093,'127.0.0.1',()=>process.send({ready:true}));process.on('message',()=>server.close(()=>process.exit(0)));");
 const child=spawn(process.execPath,[entry],{cwd:root,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const dir=path.resolve('.local/preservation-native-qualification/diagnostics');fs.mkdirSync(dir,{recursive:true});const diagnostic=path.join(dir,crypto.randomUUID()+'.jsonl'),write=(event,fields={})=>fs.appendFileSync(diagnostic,JSON.stringify({at:new Date().toISOString(),supervisorPid:process.pid,pid:child.pid,port,event,...fields})+'\n');write('start');const timer=setInterval(()=>write('heartbeat',{alive:child.exitCode===null}),1000);child.once('exit',(exitCode,signal)=>{clearInterval(timer);write('exit',{exitCode,signal});});
 t.after(async()=>{if(child.exitCode===null){const done=once(child,'exit');child.send('exit');await done;}assert.ok(root.startsWith(path.join(os.tmpdir(),'ziwei-module-listener-')));fs.rmSync(root,{recursive:true,force:true});});await once(child,'message');
 const native=await defaultNativeSourceIO.readProcess(child.pid),listener=await defaultNativeSourceIO.readListener('http://127.0.0.1:'+port,child.pid);assert.equal(native.entryPath,entry);assert.deepEqual(listener,{listenerPid:child.pid});
 const done=once(child,'exit');child.send('exit');await done;const absent=await defaultNativeSourceIO.readProcess(child.pid);assert.equal(absent,null);
 fs.writeFileSync(path.resolve('.local/preservation-native-qualification/powershell-module-listener.json'),JSON.stringify({port,pid:child.pid,nativeBirth:native.nativeBirth,creationFileTime:native.creationFileTime,listener,absent},null,2));
});
