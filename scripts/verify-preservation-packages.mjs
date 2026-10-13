import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FROZEN_VERSIONS,digest} from '../backend/version-preservation.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyPreservationPackages(directory,{candidateCommit}={}) {
 const root=path.resolve(directory),manifests=[];
 for(const role of ['v1-compat','v2']){
  const file=path.join(root,role+'-manifest.json'),manifest=JSON.parse(fs.readFileSync(file));
  if(manifest.schemaVersion!==1||manifest.productRole!==role||digest(manifest.versions)!==digest(FROZEN_VERSIONS)||! /^[a-f0-9]{40}$/.test(manifest.candidateCommit)||candidateCommit&&manifest.candidateCommit!==candidateCommit||!Array.isArray(manifest.artifacts)||manifest.artifacts.length!==3)throw new Error('Preservation manifest identity mismatch');
  for(const suffix of ['windows-client.tgz','api.zip','frontend.zip']){
   const expected=role+'-'+suffix,artifact=manifest.artifacts.find(row=>path.basename(row.path)===expected);if(!artifact)throw new Error('Preservation artifact missing from manifest');
   const bytes=fs.readFileSync(path.join(root,expected));if(bytes.length!==artifact.bytes||sha(bytes)!==artifact.sha256)throw new Error('Preservation artifact digest mismatch: '+expected);
  }
  if(sha(JSON.stringify(manifest.contents))!==manifest.buildDigest)throw new Error('Preservation source contents digest mismatch');manifests.push(manifest);
 }
 if(manifests[0].candidateCommit!==manifests[1].candidateCommit)throw new Error('Preservation candidate commits differ');
 return manifests;
}
