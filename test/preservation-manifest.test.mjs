import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPreservationPackages} from '../scripts/verify-preservation-packages.mjs';
import {FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
test('package verification refuses missing manifests, wrong role, wrong SHA and mixed candidate commits',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-manifest-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.throws(()=>verifyPreservationPackages(root));
 const manifests=[];for(const role of ['v1-compat','v2']){const artifacts=['windows-client.tgz','api.zip','frontend.zip'].map(suffix=>{const file=path.join(root,role+'-'+suffix),bytes=Buffer.from(role+suffix);fs.writeFileSync(file,bytes);return{path:file,sha256:hash(bytes),bytes:bytes.length};}),manifest={schemaVersion:1,productRole:role,candidateCommit:'a'.repeat(40),versions:FROZEN_VERSIONS,artifacts,contents:[],buildDigest:hash('[]')};manifests.push(manifest);fs.writeFileSync(path.join(root,role+'-manifest.json'),JSON.stringify(manifest));}
 assert.equal(verifyPreservationPackages(root).length,2);
 const file=path.join(root,'v2-manifest.json');for(const patch of [{productRole:'v1-compat'},{candidateCommit:'b'.repeat(40)},{artifacts:manifests[1].artifacts.map(row=>({...row,sha256:'0'.repeat(64)}))}]){fs.writeFileSync(file,JSON.stringify({...manifests[1],...patch}));assert.throws(()=>verifyPreservationPackages(root));}fs.writeFileSync(file,JSON.stringify(manifests[1]));fs.appendFileSync(path.join(root,'v2-api.zip'),'tamper');assert.throws(()=>verifyPreservationPackages(root),/digest mismatch/);
});
