import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as artifacts from '../src/conversation-image-artifacts.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-output-ref-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return artifacts.createImageArtifactSession({runtimeDir:root,actionId:'action-output-reference',conversationId:'conv-output-reference',references:true});}
function manifest(s,entries,overrides={}){fs.writeFileSync(s.manifestPath,JSON.stringify({version:1,actionId:s.actionId,conversationId:s.conversationId,artifacts:entries,...overrides}));}

test('reference output sessions describe general files without reading their full bytes into JSON',async t=>{
 const s=fixture(t),bytes=Buffer.alloc(11*1024*1024,42),file=path.join(s.directory,'report.bin');fs.writeFileSync(file,bytes);manifest(s,[{path:'report.bin',mimeType:'application/octet-stream'}]);
 assert.equal(s.references,true);assert.equal(typeof artifacts.readImageArtifactDescriptors,'function');
 const result=await artifacts.readImageArtifactDescriptors(s);
 assert.deepEqual(result,[{path:file,name:'report.bin',mimeType:'application/octet-stream',size:bytes.length,sha256:sha(bytes)}]);
 assert.ok(JSON.stringify(result).length<1024);assert.ok(!Object.hasOwn(result[0],'content'));
 const instructions=artifacts.imageArtifactInstructions(s);assert.match(instructions,/500 MiB/);assert.match(instructions,/附件/);assert.match(instructions,/mimeType/);
});

test('descriptor manifests retain identity, declared paths and combined limits',async t=>{
 const s=fixture(t);fs.writeFileSync(path.join(s.directory,'one.txt'),'hello');
 assert.equal(typeof artifacts.readImageArtifactDescriptors,'function');
 for(const entry of [{path:'../outside.bin'},{path:'one.txt:stream'},{path:'C:\\outside.bin'}]){manifest(s,[entry]);await assert.rejects(artifacts.readImageArtifactDescriptors(s),/路径|目录/);}
 manifest(s,[{path:'one.txt'}],{actionId:'action-other'});await assert.rejects(artifacts.readImageArtifactDescriptors(s),/执行|清单/);
 manifest(s,Array.from({length:21},(_,i)=>({path:`file-${i}`})));await assert.rejects(artifacts.readImageArtifactDescriptors(s),/20/);
 const large=path.join(s.directory,'too-large.bin');const fd=fs.openSync(large,'w');fs.ftruncateSync(fd,500*1024*1024+1);fs.closeSync(fd);manifest(s,[{path:'too-large.bin'}]);await assert.rejects(artifacts.readImageArtifactDescriptors(s),/500 MiB/);
});

test('descriptor outputs hash the exact 500 MiB boundary with bounded chunks',async t=>{
 const s=fixture(t),file=path.join(s.directory,'boundary.bin');const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,500*1024*1024);fs.closeSync(fd);manifest(s,[{path:'boundary.bin'}]);
 assert.equal(typeof artifacts.readImageArtifactDescriptors,'function');const result=await artifacts.readImageArtifactDescriptors(s);
 const hash=createHash('sha256'),chunk=Buffer.alloc(1024*1024);for(let i=0;i<500;i++)hash.update(chunk);
 assert.equal(result[0].sha256,hash.digest('hex'));assert.equal(result[0].size,500*1024*1024);assert.ok(JSON.stringify(result).length<1024);
});
