import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHermesExecutionGuard} from '../src/execution-admission.mjs';
test('trusted native binding fixes the selected HOME and rejects a later protected junction before preparation',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-profile-binding-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const ordinary=path.join(root,'ordinary'),owned=path.join(root,'owned'),alias=path.join(root,'alias');for(const home of [ordinary,owned])fs.mkdirSync(home);fs.writeFileSync(path.join(owned,'ziwei-instance.json'),JSON.stringify({templateId:'ziwei-hermes-bot'}));fs.symlinkSync(ordinary,alias,process.platform==='win32'?'junction':'dir');
 const guard=createHermesExecutionGuard({type:'runtime.execute',payload:{}},{protectedHomes:[owned],runtimeDir:root,defaultWorkdir:root});const binding=guard.select({sourceHome:alias,profile:'ordinary-alias',baseHome:root});assert.equal(binding.home,fs.realpathSync.native(ordinary));binding.verify();fs.unlinkSync(alias);fs.symlinkSync(owned,alias,process.platform==='win32'?'junction':'dir');assert.throws(()=>binding.verify(),error=>error.code==='V2_OBJECT_SEALED'&&error.definitelyNotStarted===true);assert.throws(()=>guard.select({sourceHome:alias,profile:'ordinary-alias',baseHome:root}),{code:'V2_OBJECT_SEALED'});assert.equal(fs.existsSync(path.join(owned,'state.db')),false);
});
test('an ordinary replacement cannot change a captured binding, and payload fields cannot replace policy',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-binding-change-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const first=path.join(root,'first'),second=path.join(root,'second'),alias=path.join(root,'alias');for(const home of [first,second])fs.mkdirSync(home);fs.symlinkSync(first,alias,process.platform==='win32'?'junction':'dir');const guard=createHermesExecutionGuard({type:'runtime.execute',payload:{executionGuard:'ignore',protectedHomes:[]}},{runtimeDir:root});const binding=guard.select({sourceHome:alias,profile:'ordinary',baseHome:root});assert.equal(binding.home,first);assert.throws(()=>binding.verify({env:{HERMES_HOME:second}}),{code:'EXECUTION_RESOURCE_CHANGED'});fs.unlinkSync(alias);fs.symlinkSync(second,alias,process.platform==='win32'?'junction':'dir');assert.throws(()=>guard.select({sourceHome:alias,profile:'ordinary',baseHome:root}),error=>error.code==='EXECUTION_RESOURCE_CHANGED'&&error.definitelyNotStarted===true);
});
