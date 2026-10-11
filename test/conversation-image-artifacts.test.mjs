import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeInvocation } from '../src/runtime-adapters.mjs';

const artifacts = await import('../src/conversation-image-artifacts.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lM8AAAAASUVORK5CYII=', 'base64');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-image-artifact-test-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  return root;
}
function session(t, actionId='action-image', conversationId='conversation-image') {
  assert.equal(typeof artifacts.createImageArtifactSession,'function','per-execution image artifact session is missing');
  return artifacts.createImageArtifactSession({runtimeDir:fixture(t),actionId,conversationId});
}
function manifest(s, entries, overrides={}) {
  fs.writeFileSync(s.manifestPath, JSON.stringify({version:1,actionId:s.actionId,conversationId:s.conversationId,artifacts:entries,...overrides}));
}

test('Codex images are attached with native vision arguments and stdin remains literal', () => {
  const images=[{path:'C:\\fixture images\\one.png',mimeType:'image/png'},{path:'D:\\two.jpg',mimeType:'image/jpeg'}];
  const invocation=runtimeInvocation('Codex',{prompt:'Inspect actual image pixels',attachments:images});
  assert.deepEqual(invocation.args.filter((value,index)=>invocation.args[index-1]==='--image'),images.map(x=>x.path));
  assert.equal(invocation.stdin,'Inspect actual image pixels');
  assert.equal(invocation.args.at(-1),'-');
});
test('Hermes one image uses single-query chat image input', () => {
  const invocation=runtimeInvocation('Hermes',{prompt:'Inspect image',attachments:[{path:'C:\\one.png',mimeType:'image/png'}]});
  assert.ok(invocation.args.includes('chat'));
  assert.equal(invocation.args[invocation.args.indexOf('--image')+1],'C:\\one.png');
  assert.ok(invocation.args.includes('-Q'));
});
test('Hermes multiple image input fails instead of dropping images', () => {
  assert.throws(()=>runtimeInvocation('Hermes',{prompt:'Inspect images',attachments:[{path:'one.png',mimeType:'image/png'},{path:'two.png',mimeType:'image/png'}]}),/Hermes.*一张|Hermes.*single/);
});
test('unverified runtimes refuse images instead of sending text paths as vision', () => {
  for(const runtime of ['Claude','Gemini']) assert.throws(()=>runtimeInvocation(runtime,{prompt:'Inspect image',attachments:[{path:'one.png',mimeType:'image/png'}]}),/图片输入|image input/);
});
test('same action receives separate nonce directories and explicit output instructions', t => {
  const runtimeDir=fixture(t);
  assert.equal(typeof artifacts.createImageArtifactSession,'function');
  const a=artifacts.createImageArtifactSession({runtimeDir,actionId:'same-action',conversationId:'same-conversation'});
  const b=artifacts.createImageArtifactSession({runtimeDir,actionId:'same-action',conversationId:'same-conversation'});
  assert.notEqual(a.directory,b.directory);assert.ok(fs.statSync(a.directory).isDirectory());
  assert.equal(path.dirname(a.manifestPath),a.directory);
  const instructions=artifacts.imageArtifactInstructions(a);
  assert.ok(instructions.includes(a.directory));assert.ok(instructions.includes(a.manifestPath));
  assert.ok(instructions.includes('same-action'));assert.ok(instructions.includes('same-conversation'));
});
test('only manifest-declared current execution images become base64 outputs', t => {
  const s=session(t);fs.writeFileSync(path.join(s.directory,'declared.png'),png);
  fs.writeFileSync(path.join(s.directory,'unlisted.png'),png);
  manifest(s,[{path:'declared.png',name:'returned.png'}]);
  const output=artifacts.readImageArtifacts(s);
  assert.deepEqual(output,[{name:'returned.png',mimeType:'image/png',size:png.length,contentEncoding:'base64',content:png.toString('base64')}]);
  assert.equal(JSON.stringify(output).includes(s.directory),false);
});
test('no manifest means no output even when images exist', t => {
  const s=session(t);fs.writeFileSync(path.join(s.directory,'not-declared.png'),png);
  assert.deepEqual(artifacts.readImageArtifacts(s),[]);
});
test('manifest version and action/conversation identity must match current execution', t => {
  const s=session(t);fs.writeFileSync(path.join(s.directory,'one.png'),png);
  for(const override of [{version:2},{actionId:'another-action'},{conversationId:'another-conversation'}]) {
    manifest(s,[{path:'one.png'}],override);assert.throws(()=>artifacts.readImageArtifacts(s),/manifest|清单|执行|会话/);
  }
});
test('absolute, traversal and Windows alternate stream output paths are rejected', t => {
  const s=session(t);
  for(const filename of ['../outside.png',path.join(s.directory,'one.png'),'C:\\outside.png','D:relative.png','image.png:secret']) {
    manifest(s,[{path:filename}]);assert.throws(()=>artifacts.readImageArtifacts(s),/路径|path|目录/);
  }
});
test('junction output directories cannot import an outside image', t => {
  const s=session(t);const outside=fixture(t);fs.writeFileSync(path.join(outside,'one.png'),png);
  fs.symlinkSync(outside,path.join(s.directory,'linked'),process.platform==='win32'?'junction':'dir');
  manifest(s,[{path:'linked/one.png'}]);assert.throws(()=>artifacts.readImageArtifacts(s),/链接|link|目录/);
});
test('hardlinked output and manifest files are rejected', t => {
  const s=session(t);const outside=fixture(t);const original=path.join(outside,'one.png');fs.writeFileSync(original,png);
  fs.linkSync(original,path.join(s.directory,'one.png'));manifest(s,[{path:'one.png'}]);
  assert.throws(()=>artifacts.readImageArtifacts(s),/链接|link/);
  const second=session(t);const outsideManifest=path.join(outside,'manifest.json');
  fs.writeFileSync(outsideManifest,JSON.stringify({version:1,actionId:second.actionId,conversationId:second.conversationId,artifacts:[]}));
  fs.linkSync(outsideManifest,second.manifestPath);assert.throws(()=>artifacts.readImageArtifacts(second),/链接|link/);
});
test('invalid image bytes and claimed MIME mismatches fail with concrete errors', t => {
  const s=session(t);fs.writeFileSync(path.join(s.directory,'false.png'),'not an image');
  manifest(s,[{path:'false.png'}]);assert.throws(()=>artifacts.readImageArtifacts(s),/图片格式|image|魔数/);
  fs.writeFileSync(path.join(s.directory,'real.png'),png);manifest(s,[{path:'real.png',mimeType:'image/jpeg'}]);
  assert.throws(()=>artifacts.readImageArtifacts(s),/MIME|类型|格式/);
});
test('raster validation rejects signature-only, truncated and zero-dimension images', () => {
  const zeroPng=Buffer.from(png);zeroPng.writeUInt32BE(0,16);
  const gif=Buffer.from('474946383961010001008000000000002c00000000010001000002024401003b','hex');
  const webp=Buffer.alloc(20);webp.write('RIFF');webp.writeUInt32LE(12,4);webp.write('WEBPVP8 ',8);
  for(const bytes of [png.subarray(0,8),png.subarray(0,png.length-2),zeroPng,Buffer.from([255,216,255,0]),gif.subarray(0,gif.length-1),Buffer.concat([webp,Buffer.from([0])])]) {
    assert.throws(()=>artifacts.validateImageBytes(bytes),/图片格式|魔数|结构/);
  }
  assert.equal(artifacts.validateImageBytes(png),'image/png');
  assert.equal(artifacts.validateImageBytes(Buffer.from([255,216,255,217])),'image/jpeg');
  assert.equal(artifacts.validateImageBytes(gif),'image/gif');
  assert.equal(artifacts.validateImageBytes(webp),'image/webp');
});
test('single image and combined image bytes cannot exceed 10 MiB', t => {
  const s=session(t);const one=Buffer.alloc(10*1024*1024+1);png.copy(one);
  fs.writeFileSync(path.join(s.directory,'large.png'),one);manifest(s,[{path:'large.png'}]);
  assert.throws(()=>artifacts.readImageArtifacts(s),/10 MiB|大小|size/);
  const six=Buffer.alloc(6*1024*1024);png.copy(six);png.subarray(-12).copy(six,six.length-12);
  for(const filename of ['a.png','b.png'])fs.writeFileSync(path.join(s.directory,filename),six);
  manifest(s,[{path:'a.png'},{path:'b.png'}]);assert.throws(()=>artifacts.readImageArtifacts(s),/10 MiB|总大小|size/);
});
test('duplicate declarations and overlarge manifests fail without partial output', t => {
  const s=session(t);fs.writeFileSync(path.join(s.directory,'one.png'),png);
  manifest(s,[{path:'one.png'},{path:'one.png'}]);assert.throws(()=>artifacts.readImageArtifacts(s),/重复|duplicate/);
  fs.writeFileSync(s.manifestPath,' '.repeat(64*1024+1));assert.throws(()=>artifacts.readImageArtifacts(s),/清单|manifest/);
});
test('image event results carry metadata without base64 image contents', () => {
  assert.equal(typeof artifacts.imageArtifactEventResult,'function','image event metadata summary is missing');
  const result={output:'Created image',outputArtifacts:[{name:'returned.png',mimeType:'image/png',size:png.length,contentEncoding:'base64',content:png.toString('base64')}],inputAttachments:[{name:'input.png',path:'fixture-input-path'}]};
  const event=artifacts.imageArtifactEventResult(result);
  assert.equal(event.output,'Created image');
  assert.equal(event.outputArtifactCount,1);
  assert.deepEqual(event.outputArtifacts,[{name:'returned.png',mimeType:'image/png',size:png.length}]);
  assert.equal(JSON.stringify(event).includes(png.toString('base64')),false);
  assert.equal(result.outputArtifacts[0].content,png.toString('base64'));
});
test('failed and successful results without outputArtifacts still receive the event JSON budget', () => {
  for(const status of ['failed','succeeded']) {
    const result={status,code:status==='failed'?'runtime_failed':0,output:'x'.repeat(4*1024*1024),diagnostics:'d'.repeat(1024*1024)};
    const event=artifacts.imageArtifactEventResult(result);
    assert.ok(Buffer.byteLength(JSON.stringify(event))<=128*1024);
    assert.equal(event.status,status);assert.equal(event.code,result.code);
    assert.equal(event.truncated,true);assert.match(event.output,/回传.*截断/);
    assert.equal(event.outputArtifacts,undefined);
    assert.equal(result.output.length,4*1024*1024,'event budget must not mutate full upload result');
  }
});
test('maximum image bytes survive exact JSON delivery budget while diagnostics are removed first', () => {
  assert.equal(typeof artifacts.imageArtifactDeliveryBody,'function');
  const bytes=Buffer.alloc(10*1024*1024);png.copy(bytes);png.subarray(-12).copy(bytes,bytes.length-12);
  const image={name:'maximum.png',mimeType:'image/png',size:bytes.length,contentEncoding:'base64',content:bytes.toString('base64')};
  const body={status:'succeeded',result:{runtime:'Codex',output:'图片已生成',diagnostics:'d'.repeat(3*1024*1024),outputArtifacts:[image]},error:null};
  assert.ok(Buffer.byteLength(JSON.stringify(body))>16*1024*1024);
  const delivery=artifacts.imageArtifactDeliveryBody(body);
  assert.ok(Buffer.byteLength(JSON.stringify(delivery))<=15*1024*1024);
  assert.equal(delivery.status,'succeeded');assert.equal(delivery.result.output,'图片已生成');
  assert.equal(delivery.result.outputArtifacts[0].content,image.content);
  assert.equal(delivery.result.diagnostics,null);assert.equal(delivery.result.truncated,true);
  assert.match(delivery.result.truncationReason,/json.*budget/i);
  assert.equal(body.result.diagnostics.length,3*1024*1024,'caller result must not be mutated');
});
test('control characters and Unicode output truncate by actual serialized JSON bytes without corrupting images', () => {
  assert.equal(typeof artifacts.imageArtifactDeliveryBody,'function');
  const output='\u0000\u0001\"\\😀汉字'.repeat(900000);
  const body={status:'succeeded',result:{output,diagnostics:'x'.repeat(1024*1024),outputArtifacts:[{name:'image.png',mimeType:'image/png',size:png.length,contentEncoding:'base64',content:png.toString('base64')}]},error:null};
  const delivery=artifacts.imageArtifactDeliveryBody(body,{maxBytes:64*1024});
  assert.ok(Buffer.byteLength(JSON.stringify(delivery))<=64*1024);
  assert.equal(delivery.result.outputArtifacts[0].content,png.toString('base64'));
  assert.match(delivery.result.output,/回传.*截断/);assert.equal(delivery.result.truncated,true);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(delivery.result.output));
  const event=artifacts.imageArtifactEventResult(body.result);
  assert.ok(Buffer.byteLength(JSON.stringify(event))<=128*1024);
  assert.equal(event.outputArtifacts[0].content,undefined);
});
