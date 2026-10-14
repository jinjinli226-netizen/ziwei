import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scanNativeFiles} from '../backend/preservation-native-evidence.mjs';
import {scanOwnedNativeDatabases} from '../backend/preservation-native-databases.mjs';
import {createRepository} from '../backend/repository.mjs';
import {FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {DatabaseSync} from 'node:sqlite';
test('native file manifests preserve actual full-width IDs accepted by strict source recheck',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-file-id-')),runtimeDir=path.join(root,'runtime');fs.mkdirSync(runtimeDir);fs.writeFileSync(path.join(runtimeDir,'action-state.json'),JSON.stringify({version:2,started:[],completed:[]}));t.after(()=>{assert.ok(root.startsWith(path.join(os.tmpdir(),'ziwei-file-id-')));fs.rmSync(root,{recursive:true,force:true});});
 const scan=scanNativeFiles({connections:[{workspace:'native',deviceId:'native',apiBase:'https://native.invalid',runtimeDir,hermesHome:root}],actions:[],homes:[]});assert.deepEqual(scan.issues,[]);for(const record of [...scan.files,...scan.directories].filter(row=>row.exists)){const stat=fs.lstatSync(record.path,{bigint:true});assert.deepEqual(record.identity,{dev:String(stat.dev),ino:String(stat.ino)});}
});
for(const mutate of [false,true])test(`full-width native file identity ${mutate?'low-bit change refuses final seal':'remains exact through database manifests and final seal'}`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-full-width-seal-')),runtimeDir=path.join(root,'runtime');fs.mkdirSync(runtimeDir);fs.writeFileSync(path.join(runtimeDir,'action-state.json'),JSON.stringify({version:2,started:[],completed:[]}));fs.mkdirSync(path.join(root,'collaboration','bot_relay'),{recursive:true});fs.writeFileSync(path.join(root,'collaboration','bot_relay','roster.json'),'{}');const nativeDb=new DatabaseSync(path.join(root,'state.db'));nativeDb.exec('CREATE TABLE state_meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(30);CREATE TABLE sessions(id TEXT PRIMARY KEY,source TEXT,started_at REAL);CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,timestamp REAL)');nativeDb.close();
 // Deterministically model a real NTFS file ID above Number.MAX_SAFE_INTEGER.
 // Files/bytes and all other metadata remain actual isolated OS fixtures.
 const original=fs.lstatSync;let fullWidth=mutate?9007199254740992n:9007199254740993n;t.mock.method(fs,'lstatSync',(file,options)=>{const stat=original(file,options);if(!path.resolve(String(file)).startsWith(root+path.sep))return stat;return new Proxy(stat,{get(target,key){if(key==='ino')return options?.bigint?fullWidth:Number(fullWidth);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});});
 const native=scanOwnedNativeDatabases({homes:[{home:root,nativeVersion:'0.21.3'}]});for(const record of [...native.files,...native.directories].filter(row=>row.exists))assert.equal(record.identity.ino,String(fullWidth));
 const repo=createRepository({memory:true,preservation:{collectNativeEvidence:async()=>{const proof=scanNativeFiles({connections:[{workspace:'native',deviceId:'native',apiBase:'https://native.invalid',runtimeDir,hermesHome:root}],actions:[],homes:[]});if(mutate)fullWidth++;return proof;}}});t.after(()=>{repo.db.close();t.mock.restoreAll();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});repo.preservation.begin({operationId:'full-width-original',versions:FROZEN_VERSIONS});if(mutate){await assert.rejects(repo.preservation.seal({operationId:'full-width-original'}),{code:'ROLLBACK_EVIDENCE_CHANGED'});assert.equal(repo.preservation.inspect().state,'preparing');}else assert.equal((await repo.preservation.seal({operationId:'full-width-original'})).state,'sealed');
});
