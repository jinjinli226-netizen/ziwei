import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertNoOwnedBotResource} from '../src/execution-admission.mjs';
test('native canonical fence rejects uppercase profile and real junction HOME/profile aliases',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-owned-fence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const owned=path.join(root,'profiles','bot-owned');fs.mkdirSync(owned,{recursive:true});fs.writeFileSync(path.join(owned,'ziwei-instance.json'),JSON.stringify({version:1,templateId:'ziwei-hermes-bot',mode:'owned_profile',employeeId:'employee_owned'}));
 fs.symlinkSync(owned,path.join(root,'profiles','ordinary-alias'),process.platform==='win32'?'junction':'dir');fs.symlinkSync(owned,path.join(root,'home-alias'),process.platform==='win32'?'junction':'dir');
 for(const payload of [{profile:'ordinary-alias'},{env:{HERMES_HOME:path.join(root,'home-alias')},profile:'default'},{cwd:path.join(root,'home-alias','nested','new')} ,...(process.platform==='win32'?[{profile:'BOT-OWNED'}]:[])])assert.throws(()=>assertNoOwnedBotResource({payload},{hermesHome:root}),error=>error.code==='V2_OBJECT_SEALED'&&error.definitelyNotStarted===true);
 assert.doesNotThrow(()=>assertNoOwnedBotResource({payload:{profile:'default'}},{hermesHome:root}));
 const creator=path.join(root,'profiles','Creator');fs.mkdirSync(creator);fs.writeFileSync(path.join(creator,'ziwei-instance.json'),JSON.stringify({version:1,templateId:'ziwei-creator',employeeId:'employee_creator'}));assert.doesNotThrow(()=>assertNoOwnedBotResource({payload:{profile:'Creator'}},{hermesHome:root}));
});
