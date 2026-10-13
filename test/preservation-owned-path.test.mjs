import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertNoOwnedBotResource,executionBinding} from '../src/execution-admission.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
test('native canonical fence rejects uppercase profile and real junction HOME/profile aliases',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-owned-fence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const owned=path.join(root,'profiles','bot-owned');fs.mkdirSync(owned,{recursive:true});fs.writeFileSync(path.join(owned,'ziwei-instance.json'),JSON.stringify({version:1,templateId:'ziwei-hermes-bot',mode:'owned_profile',employeeId:'employee_owned'}));
 fs.symlinkSync(owned,path.join(root,'profiles','ordinary-alias'),process.platform==='win32'?'junction':'dir');fs.symlinkSync(owned,path.join(root,'home-alias'),process.platform==='win32'?'junction':'dir');
 for(const payload of [{profile:'ordinary-alias'},{env:{HERMES_HOME:path.join(root,'home-alias')},profile:'default'},{cwd:path.join(root,'home-alias','nested','new')} ,...(process.platform==='win32'?[{profile:'BOT-OWNED'}]:[])])assert.throws(()=>assertNoOwnedBotResource({payload},{hermesHome:root}),error=>error.code==='V2_OBJECT_SEALED'&&error.definitelyNotStarted===true);
 assert.doesNotThrow(()=>assertNoOwnedBotResource({payload:{profile:'default'}},{hermesHome:root}));
 const creator=path.join(root,'profiles','Creator');fs.mkdirSync(creator);fs.writeFileSync(path.join(creator,'ziwei-instance.json'),JSON.stringify({version:1,templateId:'ziwei-creator',employeeId:'employee_creator'}));assert.doesNotThrow(()=>assertNoOwnedBotResource({payload:{profile:'Creator'}},{hermesHome:root}));
});
test('relative runtime file targets and a junction changed after wire admission are rejected before writing',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-final-fence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const runtime=path.join(root,'runtime'),owned=path.join(root,'owned'),ordinary=path.join(root,'ordinary'),alias=path.join(runtime,'alias');for(const directory of [runtime,owned,ordinary])fs.mkdirSync(directory);fs.writeFileSync(path.join(owned,'ziwei-instance.json'),JSON.stringify({templateId:'ziwei-hermes-bot'}));fs.symlinkSync(owned,alias,process.platform==='win32'?'junction':'dir');
 const action={id:'relative-write',type:'file.write',payload:{path:'alias/new.txt',content:'must not write'}};assert.throws(()=>assertNoOwnedBotResource(action,{runtimeDir:runtime,defaultWorkdir:root,protectedHomes:[owned]}),{code:'V2_OBJECT_SEALED'});assert.equal(fs.existsSync(path.join(owned,'new.txt')),false);
 for(const type of ['file.write','file.read'])assert.throws(()=>assertNoOwnedBotResource({type,payload:{name:'alias/new.txt'}},{runtimeDir:runtime,defaultWorkdir:root,protectedHomes:[owned]}),{code:'V2_OBJECT_SEALED'});
 fs.unlinkSync(alias);fs.symlinkSync(ordinary,alias,process.platform==='win32'?'junction':'dir');const original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({allowed:true,actionId:action.id,executionBinding:executionBinding(action),productState:'sealed',protectedHomes:[owned]})});t.after(()=>{globalThis.fetch=original;});
 const executor=createLocalActionExecutor({runtimeDir:runtime,defaultWorkdir:root,hermesHomePath:root,admissionHandledByDispatcher:true,apiBase:'http://127.0.0.1:1',workspace:'test-111',deviceId:'fixture',deviceToken:'fixture'});await executor.authorizeExecution(action);fs.unlinkSync(alias);fs.symlinkSync(owned,alias,process.platform==='win32'?'junction':'dir');await assert.rejects(executor({...action,payload:{...action.payload,workdir:root}}),{code:'V2_OBJECT_SEALED'});assert.equal(fs.existsSync(path.join(owned,'new.txt')),false);
});
