import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('native API entry selects the explicit isolated DB across package roots',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-db-location-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const database=path.join(directory,'persistent.sqlite'),script=path.join(directory,'check.mjs');
  fs.writeFileSync(script,`import {openDatabase} from ${JSON.stringify(new URL('../backend/db.mjs',import.meta.url).href)};const db=openDatabase();console.log(JSON.stringify(db.prepare('PRAGMA database_list').all()));db.close();`);
  const result=spawnSync(process.execPath,[script],{env:{...process.env,ZIWEI_DB_FILE:database},encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout).find(row=>row.name==='main').file;assert.equal(path.resolve(actual),database);assert.equal(fs.existsSync(database),true);
});
