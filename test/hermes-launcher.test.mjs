import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readUvLauncherResources,resolveHermesLauncher} from '../src/hermes-launcher.mjs';
import {hermesMcpSpawnSpec,runtimeDiscoverySpawnSpec} from '../src/runtime-adapters.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function scriptZip(text){
  const name=Buffer.from('__main__.py'),body=Buffer.from(text),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22),crc=crc32(body);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}
// Format fixtures follow UV's public RT_RCDATA builder ABI; no PE is executed.
function uvPe({python='C:\\Program Files\\Hermes\\venv\\Scripts\\python.exe',kind=Buffer.from([1]),magic=0x20b,resourceShift=0,script='from hermes_cli.main import main\nif __name__ == "__main__": main()\n'}={}){
  const rawOffset=0x400,sectionRva=0x1000,size=0x2000,resourceRva=sectionRva+resourceShift,base=rawOffset+resourceShift,bytes=Buffer.alloc(rawOffset+size);
  bytes.write('MZ');bytes.writeUInt32LE(0x80,0x3c);bytes.write('PE\0\0',0x80,'binary');bytes.writeUInt16LE(1,0x86);bytes.writeUInt16LE(magic===0x20b?0xf0:0xe0,0x94);
  const optional=0x98,optionalSize=magic===0x20b?0xf0:0xe0,directory=optional+(magic===0x20b?112:96);
  bytes.writeUInt16LE(magic,optional);bytes.writeUInt32LE(16,optional+(magic===0x20b?108:92));bytes.writeUInt32LE(resourceRva,directory+16);bytes.writeUInt32LE(size-resourceShift,directory+20);
  const section=optional+optionalSize;bytes.write('.rsrc',section);bytes.writeUInt32LE(size,section+8);bytes.writeUInt32LE(sectionRva,section+12);bytes.writeUInt32LE(size,section+16);bytes.writeUInt32LE(rawOffset,section+20);
  bytes.writeUInt16LE(1,base+14);bytes.writeUInt32LE(10,base+16);bytes.writeUInt32LE(0x80000020,base+20);bytes.writeUInt16LE(3,base+0x20+12);
  const entries=[['UV_TRAMPOLINE_KIND',kind,0x200],['UV_PYTHON_PATH',Buffer.isBuffer(python)?python:Buffer.from(python),0x220],['UV_SCRIPT_DATA',scriptZip(script),0x500]];
  entries.forEach(([name,data,dataOffset],i)=>{
    const nameOffset=0x100+i*0x50,langOffset=0x60+i*0x20,entryOffset=0xc0+i*16,at=base+0x30+i*8;
    bytes.writeUInt32LE((0x80000000|nameOffset)>>>0,at);bytes.writeUInt32LE((0x80000000|langOffset)>>>0,at+4);bytes.writeUInt16LE(name.length,base+nameOffset);bytes.write(name,base+nameOffset+2,'utf16le');
    bytes.writeUInt16LE(1,base+langOffset+14);bytes.writeUInt32LE(0,base+langOffset+16);bytes.writeUInt32LE(entryOffset,base+langOffset+20);
    bytes.writeUInt32LE(resourceRva+dataOffset,base+entryOffset);bytes.writeUInt32LE(data.length,base+entryOffset+4);data.copy(bytes,base+dataOffset);
  });
  return{bytes,base,directory,rawOffset,scriptOffset:base+0x500};
}
function files(entries){const data=new Map(entries.map(([name,value])=>[path.win32.normalize(name).toLowerCase(),Buffer.isBuffer(value)?value:Buffer.from(value)]));return{statSync(name){if(!data.has(path.win32.normalize(name).toLowerCase()))throw new Error('Missing file');return{isFile:()=>true};},readFileSync(name){const bytes=data.get(path.win32.normalize(name).toLowerCase());if(!bytes)throw new Error('Missing file');return bytes;}};}

test('UTF-8 absolute shebangs retain Chinese paths and spaces without choosing another Python',()=>{
  const launcher='C:\\用户\\Hermes\\hermes.exe',python='C:\\用户\\Program Files\\venv\\Scripts\\python.exe';
  const io=files([[launcher,`#!"${python}"\r\nfrom hermes_cli.main import main\n`],[python,'python']]);
  assert.equal(resolveHermesLauncher(launcher,{platform:'win32',io}).interpreter,python);
  for(const bad of ['#!/usr/bin/env python3\n','#!python.exe\n',`#!"${python}" -X utf8\n`,'not a launcher'])assert.throws(()=>resolveHermesLauncher(launcher,{platform:'win32',io:files([[launcher,bad],[python,'python']])}),/解释器/);
});

for(const magic of [0x10b,0x20b])test(`UV PE ${magic.toString(16)} maps named resources by RVA, including a shifted resource directory`,()=>{
  const python='C:\\用户\\Program Files\\Hermes\\venv\\Scripts\\python.exe',f=uvPe({python,magic,resourceShift:0x20}),launcher='C:\\Hermes\\bin\\hermes.exe';
  const resources=readUvLauncherResources(f.bytes);assert.equal(resources.pythonPath,python);assert.equal(resources.resource.offset,f.scriptOffset);assert.equal(resources.resource.launcherSha256,hash(f.bytes));
  const selected=resolveHermesLauncher(launcher,{platform:'win32',io:files([[launcher,f.bytes],[python,'python']])});assert.equal(selected.interpreter,python);assert.equal(selected.kind,'uv-resource');assert.equal(selected.binding.resource.interpreter,python);
});

test('official cmd delegates to the exact venv exe and a relocatable resource resolves only its sibling Python',()=>{
  const cmd='C:\\Hermes\\bin\\hermes.cmd',launcher='C:\\Hermes\\hermes-agent\\venv\\Scripts\\hermes.exe',python='C:\\Hermes\\hermes-agent\\venv\\Scripts\\python.exe',config='C:\\Hermes\\hermes-agent\\venv\\pyvenv.cfg',body=`@echo off\r\n"${launcher}" %*\r\n`,f=uvPe({python:'python.exe'});
  const io=files([[cmd,body],[launcher,f.bytes],[python,'python'],[config,'home = C:\\Python\nrelocatable = true\n']]),selected=resolveHermesLauncher(cmd,{platform:'win32',io});
  assert.equal(selected.launcher,launcher);assert.equal(selected.interpreter,python);assert.equal(selected.binding.wrapper.path,cmd);assert.equal(selected.binding.wrapper.sha256,hash(Buffer.from(body)));
  for(const bad of [`@echo off\n"${launcher}" %* & whoami\n`,`@echo off\n"${launcher}" %*\necho extra\n`,`@echo off\n"%PATH%\\hermes.exe" %*\n`])assert.throws(()=>resolveHermesLauncher(cmd,{platform:'win32',io:files([[cmd,bad],[launcher,f.bytes],[python,'python'],[config,'relocatable=true']])}));
  assert.throws(()=>resolveHermesLauncher(launcher,{platform:'win32',io:files([[launcher,f.bytes],[python,'python'],[config,'relocatable=false']])}));
  assert.throws(()=>resolveHermesLauncher('C:\\Hermes\\bin\\hermes.exe',{platform:'win32',io:files([['C:\\Hermes\\bin\\hermes.exe',f.bytes],['C:\\Hermes\\bin\\python.exe','wrong Python']])}));
});

for(const[name,build,mutate]of [
  ['Python proxy kind',()=>uvPe({kind:Buffer.from([2])})],
  ['empty kind',()=>uvPe({kind:Buffer.alloc(0)})],
  ['wide kind',()=>uvPe({kind:Buffer.from([1,0,0,0])})],
  ['NUL path',()=>uvPe({python:'C:\\Python\\python.exe\0'})],
  ['invalid UTF-8 path',()=>uvPe({python:Buffer.from([0xff,0xfe])})],
  ['duplicate resource name',()=>uvPe(),f=>f.bytes.writeUInt32LE(0x80000100, f.base+0x38)],
  ['cyclic resource directory',()=>uvPe(),f=>f.bytes.writeUInt32LE(0x80000000,f.base+0x34)],
  ['out of bounds resource RVA',()=>uvPe(),f=>f.bytes.writeUInt32LE(0xffffffff,f.directory+16)],
  ['missing path resource',()=>uvPe(),f=>f.bytes.writeUInt16LE(2,f.base+0x20+12)],
  ['ambiguous language',()=>uvPe(),f=>f.bytes.writeUInt16LE(2,f.base+0x60+14)],
])test(`UV launcher refuses ${name} without falling back to an unbound interpreter`,()=>{
  const f=build();mutate?.(f);assert.throws(()=>readUvLauncherResources(f.bytes));
});

function python(){for(const binary of ['python3','python']){const p=spawnSync(binary,['-c','import sys;print(sys.executable)'],{encoding:'utf8'});if(p.status===0)return p.stdout.trim();}return null;}
test('native version, execution, fingerprint and wrapper checks consume one UV launcher binding without executing the PE',t=>{
  const interpreter=python();if(!interpreter){t.skip('Python fixture required');return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-launcher-native-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,body)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);return file;};
  write('hermes_cli/__init__.py','__version__="0.22.0"\n');write('hermes_cli/managed_scope.py','HERMES_MANAGED_DIR=True\n');write('hermes_cli/config.py','def load_config():\n return {}\n');write('hermes_cli/mcp_startup.py','def _has_configured_mcp_servers():\n return False\n');write('hermes_cli/main.py','import json\ndef main():\n print(json.dumps({"boundNativeMain":True,"modelCalls":0}))\n return 0\n');
  const f=uvPe({python:interpreter}),launcher=write('hermes.exe',f.bytes),wrapper=write('hermes.cmd','synthetic wrapper whose bytes are fingerprinted'),binding={schemaVersion:1,resource:{...readUvLauncherResources(f.bytes).resource,interpreter},wrapper:{path:wrapper,sha256:hash(fs.readFileSync(wrapper))}},bootstrap=path.resolve('src/hermes-mcp-bootstrap.py');
  const env={...process.env,PYTHONPATH:root,HERMES_HOME:root,HERMES_MANAGED_DIR:root};for(const key of Object.keys(env))if(key.startsWith('ZIWEI_'))delete env[key];
  const run=args=>spawnSync(interpreter,[bootstrap,...args],{env,encoding:'utf8',timeout:5000});
  const probe=run(['--probe',launcher,'--launcher-binding',JSON.stringify(binding)]);assert.equal(probe.status,0,probe.stderr);const proof=JSON.parse(probe.stdout);assert.deepEqual(proof.launcherBinding,binding);
  const version=run(['--version-probe',launcher,'--launcher-binding',JSON.stringify(binding)]);assert.equal(version.status,0,version.stderr);assert.match(version.stdout,/Hermes 0.22.0/);
  for(const mode of ['--probe','--version-probe'])assert.equal(run([mode,launcher,'--unbound',JSON.stringify(binding)]).status,125);
  for(const resource of [{...binding.resource,sha256:'0'.repeat(64)},{...binding.resource,launcherSha256:'0'.repeat(64)},{...binding.resource,interpreter:path.join(root,'missing-python')}])assert.equal(run(['--probe',launcher,'--launcher-binding',JSON.stringify({...binding,resource})]).status,125);
  const execution=run(['--launcher',launcher,'--binding',JSON.stringify(proof),'--']);assert.equal(execution.status,0,execution.stderr);assert.equal(JSON.parse(execution.stdout).boundNativeMain,true);
  fs.appendFileSync(wrapper,' changed target');const changed=run(['--launcher',launcher,'--binding',JSON.stringify(proof),'--']);assert.equal(changed.status,125);assert.doesNotMatch(changed.stdout,/boundNativeMain/);
  const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
  try{
    Object.defineProperty(process,'platform',{value:'win32'});
    const spec=hermesMcpSpawnSpec(launcher,[],{env});assert.equal(spec.command,interpreter);assert.deepEqual(spec.args.slice(1,5),['--launcher',launcher,'--binding',spec.args[4]]);assert.deepEqual(JSON.parse(spec.args[4]).launcherBinding.resource,binding.resource);
    const versionSpec=runtimeDiscoverySpawnSpec(launcher,['--version']);assert.equal(versionSpec.command,interpreter);assert.equal(versionSpec.args[1],'--version-probe');
  }finally{Object.defineProperty(process,'platform',descriptor);}
});

function isolatedPe(interpreter,script){
  const f=uvPe();f.bytes.writeUInt32LE(0,f.directory+16);f.bytes.writeUInt32LE(0,f.directory+20);f.bytes.write('#!\0\0P\0A\0T\0H',0x280,'binary');
  return Buffer.concat([f.bytes,Buffer.from(`#!"${interpreter}" -I\r\n`),scriptZip(script)]);
}
test('the official store launcher accepts only absolute Python with the exact isolated flag',()=>{
  const launcher='C:\\用户\\Hermes\\bin\\hermes.exe',interpreter='C:\\用户\\Hermes\\runtime\\python.exe',bytes=isolatedPe(interpreter,'from hermes_cli.main import main\n# a ZIP payload may itself contain #!C:\\unbound\\python.exe -I\n');
  const selected=resolveHermesLauncher(launcher,{platform:'win32',io:files([[launcher,bytes],[interpreter,'python']])});
  assert.ok(bytes.indexOf(Buffer.from('#!'))<bytes.indexOf(Buffer.from(`#!\"${interpreter}\"`)));
  assert.equal(selected.interpreter,interpreter);assert.deepEqual(selected.pythonArgs,['-I']);assert.equal(selected.binding.isolated.launcherSha256,hash(bytes));
  for(const suffix of [' -I -E',' -E',' -I -c evil',' -I -I'])assert.throws(()=>resolveHermesLauncher(launcher,{platform:'win32',io:files([[launcher,`#!"${interpreter}"${suffix}\n`],[interpreter,'python']])}));
});

test('store Python stays isolated while native bootstrap activates its bound dependency generation before probe and execution',t=>{
  const interpreter=python();if(!interpreter){t.skip('Python fixture required');return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-isolated-launcher-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,body)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);return file;};
  const installation=path.join(root,'official install 用户'),home=path.join(root,'selected-bot-home'),managed=path.join(root,'managed'),hostile=path.join(root,'untrusted-project');for(const p of [installation,home,managed,hostile])fs.mkdirSync(p,{recursive:true});
  const installWrite=(name,body)=>write(path.relative(root,path.join(installation,name)),body);
  installWrite('hermes_cli/__init__.py','__version__="0.22.0"\n');installWrite('hermes_cli/managed_scope.py','HERMES_MANAGED_DIR=True\n');installWrite('hermes_cli/config.py','def load_config():\n return {}\n');installWrite('hermes_cli/mcp_startup.py','def _has_configured_mcp_servers():\n return False\n');
  const imported=path.join(root,'main-imported'),relaunch=path.join(root,'relaunch-executed');
  installWrite('hermes_cli/main.py',`from pathlib import Path\nPath(${JSON.stringify(imported)}).write_text('main imported')\nfrom generation_dependency import MARKER\nimport json,sys,os\ndef main():\n print(json.dumps({'isolated':sys.flags.isolated,'dependency':MARKER,'home':os.environ['HERMES_HOME'],'argv':sys.argv[1:],'lazy':os.environ.get('HERMES_DISABLE_LAZY_INSTALLS')}))\n return 0\n`);
  installWrite('dependencies/selected/generation_dependency.py','MARKER="selected-native-generation"\n');
  const nativeBootstrap=installWrite('hermes_bootstrap.py',`import sys,os,json\nfrom pathlib import Path\nassert sys.flags.isolated == 1\nassert 'PYTHONPATH' not in os.environ\nassert getattr(sys,'_hermes_pin_default_home',False)\nassert os.environ.get('HERMES_DISABLE_LAZY_INSTALLS') == '1'\nPath(${JSON.stringify(path.join(root,'bootstrap-argv.json'))}).write_text(json.dumps(sys.argv))\nsys.path.insert(1,${JSON.stringify(path.join(installation,'dependencies','selected'))})\n`);
  write('untrusted-project/hermes_bootstrap.py',`from pathlib import Path\nPath(${JSON.stringify(relaunch)}).write_text('untrusted bootstrap')\nraise RuntimeError('wrong bootstrap')\n`);
  const script=`import os, re, sys\nos.environ.pop('PYTHONHOME',None)\nos.environ.pop('PYTHONPATH',None)\nsys.path.insert(0,${JSON.stringify(installation)})\nsys._hermes_pin_default_home = True\ntry:\n import hermes_bootstrap\nexcept Exception:\n raise\nfrom hermes_cli.main import main\nif __name__ == '__main__':\n sys.exit(main())\n`,launcher=write('hermes.exe',isolatedPe(interpreter,script));
  const env={...process.env,PYTHONPATH:hostile,PYTHONHOME:hostile,HERMES_HOME:home,HERMES_MANAGED_DIR:managed,HERMES_DISABLE_LAZY_INSTALLS:'0'};for(const key of Object.keys(env))if(key.startsWith('ZIWEI_'))delete env[key];
  const spec=hermesMcpSpawnSpec(launcher,['--profile','selected'],{env});assert.equal(spec.command,interpreter);assert.equal(spec.args[0],'-I');assert.equal(spec.modeInsertIndex,6);
  const unisolated=spawnSync(spec.command,spec.args.slice(1),{env:{...env,PYTHONHOME:'',PYTHONPATH:''},encoding:'utf8'});assert.equal(unisolated.status,125);
  const proof=JSON.parse(spec.args[5]);assert.equal(proof.launcherBinding.installation.root,fs.realpathSync(installation));assert.equal(proof.paths.bootstrap,fs.realpathSync(nativeBootstrap));assert.equal(fs.existsSync(imported),false);assert.equal(fs.existsSync(relaunch),false);
  const run=s=>spawnSync(s.command,s.args,{env,cwd:hostile,encoding:'utf8',timeout:5000}),executed=run(spec);assert.equal(executed.status,0,executed.stderr);assert.deepEqual(JSON.parse(executed.stdout),{isolated:1,dependency:'selected-native-generation',home,argv:['--profile','selected'],lazy:'0'});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'bootstrap-argv.json'),'utf8')).slice(1),['--profile','selected']);assert.equal(fs.existsSync(relaunch),false);
  const versionSpec=runtimeDiscoverySpawnSpec(launcher,['--version']),version=run(versionSpec);assert.equal(version.status,0,version.stderr);assert.match(version.stdout,/Hermes 0.22.0/);assert.equal(versionSpec.args[0],'-I');
  fs.rmSync(imported);fs.appendFileSync(nativeBootstrap,'\nraise RuntimeError("changed bootstrap must never run")\n');const changed=run(spec);assert.equal(changed.status,125);assert.equal(fs.existsSync(imported),false);assert.doesNotMatch(changed.stderr,/changed bootstrap must never run/);
  // Native update recovery markers must not mutate the installation during a bound launch.
  fs.writeFileSync(nativeBootstrap,`from pathlib import Path\nPath(${JSON.stringify(relaunch)}).write_text('unexpected bootstrap')\nraise RuntimeError("bootstrap must not run with update marker")\n`);
  for(const marker of [path.join(installation,'.hermes-update-zip-swap'),path.join(installation,'.git','hermes-update-pull')]){fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,'native-update');assert.throws(()=>hermesMcpSpawnSpec(launcher,[],{env}),/兼容|入口/);assert.equal(fs.readFileSync(marker,'utf8'),'native-update');assert.equal(fs.existsSync(relaunch),false);fs.rmSync(marker);}
  fs.rmSync(path.join(installation,'.git'),{recursive:true});fs.writeFileSync(path.join(installation,'.git'),'gitdir: ../linked-git');fs.mkdirSync(path.join(root,'linked-git'));fs.writeFileSync(path.join(root,'linked-git','hermes-update-pull'),'native-update');assert.throws(()=>hermesMcpSpawnSpec(launcher,[],{env}),/兼容|入口/);assert.equal(fs.existsSync(relaunch),false);fs.rmSync(path.join(root,'linked-git','hermes-update-pull'));
  // A native restart is refused before subprocess.call can start a second root.
  fs.writeFileSync(nativeBootstrap,`import subprocess\nsubprocess.call([${JSON.stringify(interpreter)},'-c',${JSON.stringify(`from pathlib import Path;Path(${JSON.stringify(relaunch)}).write_text('child')`)}])\n`);
  assert.throws(()=>hermesMcpSpawnSpec(launcher,[],{env}),/兼容|入口/);assert.equal(fs.existsSync(relaunch),false);
  // Missing, dynamic or ambiguous source roots never fall back to ambient imports.
  for(const bad of [script.replace(`sys.path.insert(0,${JSON.stringify(installation)})`,'sys.path.insert(0,os.getcwd())'),script.replace('sys._hermes_pin_default_home = True','sys._hermes_pin_default_home = False'),script.replace('try:\n import hermes_bootstrap','sys.path.insert(0,"another")\ntry:\n import hermes_bootstrap')]){fs.writeFileSync(launcher,isolatedPe(interpreter,bad));assert.throws(()=>hermesMcpSpawnSpec(launcher,[],{env}),/兼容|入口/);}
});
