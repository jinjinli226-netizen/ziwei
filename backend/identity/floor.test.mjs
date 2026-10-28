import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
test('unified floor rejects legacy, missing store and changed issuer; external marker survives business restore',async()=>{
  const {assertUnifiedFloor}=await import('./floor.mjs');const db=new DatabaseSync(':memory:'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-floor-'));
  const env={ZIWEI_IDENTITY_MODE:'unified',ZIWEI_IDENTITY_ISSUER:'https://op.test/realms/ziwei',ZIWEI_IDENTITY_ORIGIN:'https://workspace.test',ZIWEI_IDENTITY_SECURITY_DIR:dir};
  assertUnifiedFloor(db,env);assert.throws(()=>assertUnifiedFloor(db,{...env,ZIWEI_IDENTITY_MODE:'legacy'}));assert.throws(()=>assertUnifiedFloor(db,{...env,ZIWEI_IDENTITY_SECURITY_DIR:undefined}));
  assert.throws(()=>assertUnifiedFloor(db,{...env,ZIWEI_IDENTITY_ISSUER:'https://different.test/realms/ziwei'}));
  const restored=new DatabaseSync(':memory:');assert.throws(()=>assertUnifiedFloor(restored,{...env,ZIWEI_IDENTITY_MODE:'legacy'}));assert.throws(()=>assertUnifiedFloor(restored,env));
  db.close();restored.close();fs.rmSync(path.join(dir,'unified-required.json'));fs.rmdirSync(dir);
});
