import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {readDatabaseSnapshot} from '../backend/preservation-native-databases.mjs';

function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-nonhot-journal-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'fixture.sqlite'),db=new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=DELETE; CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('original row');");
  db.close();
  return {file,journal:file+'-journal'};
}
const evidence=file=>({bytes:fs.readFileSync(file),identity:fs.statSync(file).ino});
const same=(file,before)=>{assert.deepEqual(fs.readFileSync(file),before.bytes);assert.equal(fs.statSync(file).ino,before.identity);};

test('a complete zero-magic retained journal is inspected through a private copy without altering original bytes or identity',t=>{
  const f=fixture(t),journal=Buffer.alloc(8720);
  Buffer.from('000000000000000000000000fe265fd70000dd3b0000020000001000','hex').copy(journal);
  fs.writeFileSync(f.journal,journal);
  const databaseBefore=evidence(f.file),journalBefore=evidence(f.journal);
  assert.equal(readDatabaseSnapshot(f.file,db=>db.prepare('SELECT value FROM fixture').get().value),'original row');
  same(f.file,databaseBefore);same(f.journal,journalBefore);
});

test('every partial nonempty journal header remains refused before the reader runs',t=>{
  const f=fixture(t),databaseBefore=evidence(f.file);
  for(const length of [1,7,8,27]){
    fs.writeFileSync(f.journal,Buffer.alloc(length));const journalBefore=evidence(f.journal);let called=false;
    assert.throws(()=>readDatabaseSnapshot(f.file,()=>{called=true;}),/NATIVE_DATABASE_RECOVERY_REQUIRED/);
    assert.equal(called,false);same(f.file,databaseBefore);same(f.journal,journalBefore);
  }
});

test('hot SQLite magic and any other nonzero magic remain refused without changing source files',t=>{
  const f=fixture(t),databaseBefore=evidence(f.file);
  for(const header of ['d9d505f920a163d7','0100000000000000','0000000000000001']){
    const journal=Buffer.alloc(8720);Buffer.from(header,'hex').copy(journal);fs.writeFileSync(f.journal,journal);const journalBefore=evidence(f.journal);
    assert.throws(()=>readDatabaseSnapshot(f.file,()=>assert.fail('reader must not run')),/NATIVE_DATABASE_RECOVERY_REQUIRED/);
    same(f.file,databaseBefore);same(f.journal,journalBefore);
  }
});

test('a non-hot journal changing during the private read still fails the existing unchanged-hash guard',t=>{
  const f=fixture(t);fs.writeFileSync(f.journal,Buffer.alloc(28));const databaseBefore=evidence(f.file);
  assert.throws(()=>readDatabaseSnapshot(f.file,db=>{assert.equal(db.prepare('SELECT COUNT(*) n FROM fixture').get().n,1);fs.appendFileSync(f.journal,'changed by isolated fixture');}),/NATIVE_DATABASE_CHANGED/);
  same(f.file,databaseBefore);assert.equal(fs.statSync(f.journal).size,28+Buffer.byteLength('changed by isolated fixture'));
});
