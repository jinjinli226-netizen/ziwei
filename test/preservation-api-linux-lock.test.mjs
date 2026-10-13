import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {readApiDatabaseConnectionIdentity} from '../backend/preservation-source-namespace.mjs';
test('Linux identity observes the existing SQLite FD without releasing an actual transaction lock',{skip:process.platform!=='linux'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-db-lock-')),file=path.join(root,'current.sqlite'),db=new DatabaseSync(file);t.after(()=>{db.close();assert.ok(root.startsWith(path.join(os.tmpdir(),'ziwei-db-lock-')));fs.rmSync(root,{recursive:true,force:true});});db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE sample(id INTEGER PRIMARY KEY); BEGIN IMMEDIATE; INSERT INTO sample VALUES(1)');
 const competitor=()=>spawnSync(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);try{db.exec('PRAGMA busy_timeout=0;INSERT INTO sample VALUES(2)');console.log('wrote');}catch(error){console.log('locked');}finally{db.close();}",file],{encoding:'utf8',timeout:10000});
 const before=competitor();assert.equal(before.status,0);assert.equal(before.stdout.trim(),'locked');for(let count=0;count<3;count++)assert.equal(readApiDatabaseConnectionIdentity(file).canonicalPath,file);const after=competitor();assert.equal(after.status,0);assert.equal(after.stdout.trim(),'locked');db.exec('COMMIT');const released=competitor();assert.equal(released.status,0);assert.equal(released.stdout.trim(),'wrote');assert.equal(db.prepare('SELECT count(*) n FROM sample').get().n,2);
});
