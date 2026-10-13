import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scanNativeFiles} from '../backend/preservation-native-evidence.mjs';
test('native file manifests preserve actual full-width IDs accepted by strict source recheck',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-file-id-')),runtimeDir=path.join(root,'runtime');fs.mkdirSync(runtimeDir);fs.writeFileSync(path.join(runtimeDir,'action-state.json'),JSON.stringify({version:2,started:[],completed:[]}));t.after(()=>{assert.ok(root.startsWith(path.join(os.tmpdir(),'ziwei-file-id-')));fs.rmSync(root,{recursive:true,force:true});});
 const scan=scanNativeFiles({connections:[{workspace:'native',deviceId:'native',apiBase:'https://native.invalid',runtimeDir,hermesHome:root}],actions:[],homes:[]});assert.deepEqual(scan.issues,[]);for(const record of [...scan.files,...scan.directories].filter(row=>row.exists)){const stat=fs.lstatSync(record.path,{bigint:true});assert.deepEqual(record.identity,{dev:String(stat.dev),ino:String(stat.ino)});}
});
