import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectLocalDaemonMaintenanceFiles,scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

for(const formal of [false,true])test(`${formal?'formal':'local'} maintenance visits completed history a bounded number of times`,t=>{
  const temp=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'ziwei-indexed-maintenance-'));
  t.after(()=>{assert.equal(path.dirname(root),temp);assert(path.basename(root).startsWith('ziwei-indexed-maintenance-'));fs.rmSync(root,{recursive:true,force:true});});
  const identity={workspace:'indexed-workspace',deviceId:'indexed-device'},count=400,state={version:2,started:[],completed:[]};
  for(let i=0;i<count;i++){
    const key=`action-${i}`;state.started.push({key,actionId:key,identity,startedAt:1,nativeRuntime:true});
    state.completed.push({key,identity,result:{actionId:key,status:'succeeded',completedAt:2,result:{processExit:{launched:false,rootPid:null,rootExitCode:null,treeConfirmed:true,activeProcesses:0}}}});
  }
  const file=path.join(root,'action-state.json'),bytes=JSON.stringify(state);fs.writeFileSync(file,bytes);
  const parse=JSON.parse;let visits=0;
  t.mock.method(JSON,'parse',function(...args){
    const parsed=parse.apply(this,args);
    if(parsed?.version===2&&Array.isArray(parsed.started)&&Array.isArray(parsed.completed))for(const key of ['started','completed'])parsed[key]=new Proxy(parsed[key],{get(target,property,receiver){if(typeof property==='string'&&/^\d+$/.test(property))visits++;return Reflect.get(target,property,receiver);}});
    return parsed;
  });
  const inspect=formal?scanNativeFiles:inspectLocalDaemonMaintenanceFiles,result=inspect({connections:[{...identity,apiBase:'https://indexed.invalid',runtimeDir:root}]});
  assert.equal(result.safe,true,JSON.stringify(result.issues));assert(visits<count*60,`${visits} row visits for ${count} terminal actions`);
  t.diagnostic(`${visits} row visits for ${count} terminal actions`);
  assert.equal(fs.readFileSync(file,'utf8'),bytes);
});
