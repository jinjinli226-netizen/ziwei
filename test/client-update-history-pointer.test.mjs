import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {retainLastCompletedUpdatePointer} from '../scripts/client-update.mjs';

test('the last completed update survives replacing latest with queued or failed jobs',t=>{
  const home=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'update-history-pointer-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const directory=path.join(home,'maintenance','update-12345678-1234-1234-1234-123456789abc'),resultFile=path.join(directory,'result.json'),latest=path.join(home,'maintenance/latest-update.json'),retained=path.join(home,'maintenance/last-completed-update.json');
  fs.mkdirSync(directory,{recursive:true});const pointer={resultFile,directory};fs.writeFileSync(latest,JSON.stringify(pointer));fs.writeFileSync(resultFile,JSON.stringify({operation:'update',state:'complete'}));
  assert.equal(retainLastCompletedUpdatePointer({home}).retained,true);assert.deepEqual(JSON.parse(fs.readFileSync(retained)),pointer);
  const original=fs.readFileSync(retained);for(const state of ['queued','running','failed']){fs.writeFileSync(resultFile,JSON.stringify({operation:'update',state}));assert.equal(retainLastCompletedUpdatePointer({home}).retained,false);assert.deepEqual(fs.readFileSync(retained),original);}
});

test('a pointer outside maintenance, a linked result and malformed input are never retained',t=>{
  const home=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'update-history-pointer-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const maintenance=path.join(home,'maintenance');fs.mkdirSync(maintenance);const outside=path.join(home,'result.json');fs.writeFileSync(outside,JSON.stringify({operation:'update',state:'complete'}));
  const latest=path.join(maintenance,'latest-update.json');fs.writeFileSync(latest,JSON.stringify({directory:home,resultFile:outside}));assert.equal(retainLastCompletedUpdatePointer({home}).retained,false);
  const directory=path.join(maintenance,'update-12345678-1234-1234-1234-123456789abc');fs.mkdirSync(directory);fs.symlinkSync(outside,path.join(directory,'result.json'));fs.writeFileSync(latest,JSON.stringify({directory,resultFile:path.join(directory,'result.json')}));assert.equal(retainLastCompletedUpdatePointer({home}).retained,false);
  fs.writeFileSync(latest,'{');assert.equal(retainLastCompletedUpdatePointer({home}).retained,false);assert.equal(fs.existsSync(path.join(maintenance,'last-completed-update.json')),false);
});
