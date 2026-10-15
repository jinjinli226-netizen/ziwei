import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {crc32} from 'node:zlib';
import {inspectRasterImage,rasterImageMimeType} from '../src/raster-image.mjs';
import {normalizeConversationAttachments} from '../backend/conversation-attachments.mjs';
import {validateImageBytes,createImageArtifactSession,readImageArtifacts} from '../src/conversation-image-artifacts.mjs';
import {createRepository} from '../backend/repository.mjs';
import {rasterFixtures as images} from './fixtures/raster-images.mjs';

const mime=name=>name.toLowerCase().includes('jpeg')?'image/jpeg':name.toLowerCase().includes('webp')?'image/webp':name.toLowerCase().includes('gif')?'image/gif':'image/png';
const attachment=(bytes,name='image.png',mimeType='image/png')=>({name,mimeType,contentEncoding:'base64',content:bytes.toString('base64')});
const tails=[Buffer.from('\r\n'),Buffer.alloc(4),Buffer.from('metadata\0PNG IEND JPEG \xff\xd9 GIF ; RIFF WEBP')];
for(const[name,original]of Object.entries(images))test(`complete ${name} keeps its actual end and all original bytes with trailing CRLF, NUL or metadata`,()=>{
  for(const tail of [Buffer.alloc(0),...tails]) {
    const bytes=Buffer.concat([original,tail]),snapshot=Buffer.from(bytes),info=inspectRasterImage(bytes);
    assert.deepEqual(info,{mimeType:mime(name),width:12,height:9,endOffset:original.length});
    const normalized=normalizeConversationAttachments([attachment(bytes,name,mime(name))])[0];
    assert.equal(normalized.mimeType,mime(name));assert.equal(normalized.size,bytes.length);assert.deepEqual(Buffer.from(normalized.content,'base64'),bytes);
    assert.equal(validateImageBytes(bytes,mime(name)),mime(name));assert.deepEqual(bytes,snapshot);
  }
});

function pngChunk(type,data){const length=Buffer.alloc(4),crc=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([length,body,crc]);}
function pngParts(){const parts=[];for(let at=8;at<images.png.length;){const end=at+12+images.png.readUInt32BE(at);parts.push({type:images.png.toString('ascii',at+4,at+8),bytes:images.png.subarray(at,end)});at=end;}return parts;}
test('PNG chunk boundaries reject fake IEND, missing IDAT, invalid lengths and truncated trailers',()=>{
  const chunks=pngParts(),header=chunks.find(c=>c.type==='IHDR').bytes,end=chunks.find(c=>c.type==='IEND').bytes,signature=images.png.subarray(0,8);
  const fakeEnd=pngChunk('tEXt',Buffer.concat([Buffer.from('comment\0'),end]));
  const badLength=Buffer.from(images.png);badLength.writeUInt32BE(0x7fffffff,33);
  const zero=Buffer.from(images.png);zero.writeUInt32BE(0,16);
  for(const bytes of [Buffer.concat([signature,header,end]),Buffer.concat([signature,header,fakeEnd]),Buffer.concat([signature,header,pngChunk('IDAT',end)]),badLength,zero,...Array.from({length:12},(_,i)=>images.png.subarray(0,-i-1))])assert.equal(inspectRasterImage(bytes),null);
  assert.equal(inspectRasterImage(Buffer.concat([images.png.subarray(0,-12),fakeEnd,end])).mimeType,'image/png');
});

test('JPEG skips EXIF thumbnail markers, requires main frame and scan, and follows progressive scans',()=>{
  const bytes=images.jpegWithExifThumbnail,firstEoi=bytes.indexOf(Buffer.from([255,217]));
  assert.ok(firstEoi<bytes.length-2);assert.equal(inspectRasterImage(bytes).endOffset,bytes.length);
  const appEnd=4+bytes.readUInt16BE(4);
  assert.equal(inspectRasterImage(bytes.subarray(0,firstEoi+2)),null);
  assert.equal(inspectRasterImage(Buffer.concat([bytes.subarray(0,appEnd),Buffer.from([255,217])])),null);
  const progressive=images.progressiveJpeg,sos=progressive.indexOf(Buffer.from([255,218])),scanEnd=sos+2+progressive.readUInt16BE(sos+2);
  assert.ok(progressive.indexOf(Buffer.from([255,218]),scanEnd)>scanEnd);
  const badLength=Buffer.from(images.jpeg);badLength.writeUInt16BE(65535,4);
  const sof=images.jpeg.indexOf(Buffer.from([255,192])),frame=images.jpeg.subarray(sof,sof+2+images.jpeg.readUInt16BE(sof+2));
  assert.equal(inspectRasterImage(Buffer.concat([images.jpeg.subarray(0,-2),frame,images.jpeg.subarray(-2)])),null,'a new frame cannot borrow the previous frame scan');
  for(const invalid of [Buffer.from([255,216,255,217]),badLength,Buffer.concat([progressive.subarray(0,scanEnd),Buffer.from([255,217])]),progressive.subarray(0,-2),images.jpeg.subarray(0,-1)])assert.equal(inspectRasterImage(invalid),null);
});

test('GIF follows color tables, extension subblocks and every animation frame before its trailer',()=>{
  const globalSize=3*(1<<((images.gif[10]&7)+1)),at=13+globalSize;
  const comment=Buffer.from([0x21,0xfe,1,0x3b,0]),commented=Buffer.concat([images.gif.subarray(0,at),comment,images.gif.subarray(at)]);
  assert.equal(inspectRasterImage(commented).endOffset,commented.length);
  const descriptor=images.gif.subarray(at,at+10),emptyFrame=Buffer.concat([images.gif.subarray(0,at),descriptor,Buffer.from([8,0,0x3b])]);
  const malformedControl=Buffer.from(images.animatedGif),control=malformedControl.indexOf(Buffer.from([0x21,0xf9,4]));assert.ok(control>0);malformedControl[control+2]=5;
  for(const invalid of [commented.subarray(0,-1),images.gif.subarray(0,13),images.animatedGif.subarray(0,-15),emptyFrame,malformedControl])assert.equal(inspectRasterImage(invalid),null);
});

function webpChunk(type,data){const size=Buffer.alloc(4);size.writeUInt32LE(data.length);return Buffer.concat([Buffer.from(type),size,data,...(data.length%2?[Buffer.alloc(1)]:[])]);}
function riff(...chunks){const body=Buffer.concat([Buffer.from('WEBP'),...chunks]),size=Buffer.alloc(4);size.writeUInt32LE(body.length);return Buffer.concat([Buffer.from('RIFF'),size,body]);}
test('WebP requires complete declared chunks and a real VP8/VP8L image, not only canvas or metadata',()=>{
  const vp8x=Buffer.alloc(10),vp8=Buffer.alloc(11),vp8l=Buffer.from([0x2f,0,0,0,0]);vp8x[4]=1;vp8x[7]=1;
  const tooLong=Buffer.from(images.webp);tooLong.writeUInt32LE(tooLong.length,4);
  const badChunk=Buffer.from(images.webp);badChunk.writeUInt32LE(0x7fffffff,16);
  const badPartition=Buffer.from(images.extendedWebp);let vp8Offset=12;while(badPartition.toString('ascii',vp8Offset,vp8Offset+4)!=='VP8 '){const size=badPartition.readUInt32LE(vp8Offset+4);vp8Offset+=8+size+(size&1);}badPartition.writeUIntLE((0x7ffff<<5)|16,vp8Offset+8,3);
  for(const invalid of [riff(webpChunk('VP8X',vp8x)),riff(webpChunk('EXIF',Buffer.from('VP8 fake pixels'))),riff(webpChunk('VP8 ',vp8)),riff(webpChunk('VP8L',vp8l)),tooLong,badChunk,badPartition,images.webp.subarray(0,-1)])assert.equal(inspectRasterImage(invalid),null);
  const padded=riff(webpChunk('JUNK',Buffer.from('x')),webpChunk('VP8L',images.webp.subarray(20,20+images.webp.readUInt32LE(16))));
  assert.equal(inspectRasterImage(padded).mimeType,'image/webp');
});

test('normalization supports JPG aliases while preserving exact MIME and full size restrictions',()=>{
  for(const declared of ['image/jpg','image/pjpeg','IMAGE/JPEG']) {
    assert.equal(normalizeConversationAttachments([attachment(images.jpeg,'camera.jpg',declared)])[0].mimeType,'image/jpeg');
    assert.equal(validateImageBytes(images.jpeg,declared),'image/jpeg');
  }
  assert.throws(()=>normalizeConversationAttachments([attachment(images.png,'wrong.jpg','image/jpeg')]),/wrong\.jpg.*不一致/);
  assert.throws(()=>normalizeConversationAttachments([attachment(images.jpeg,'wrong.png','image/png')]),/wrong\.png.*不一致/);
  const large=Buffer.alloc(10*1024*1024+1);images.png.copy(large);
  assert.throws(()=>normalizeConversationAttachments([attachment(large,'large.png')]),/large\.png.*10 MiB/);
  const six=Buffer.concat([images.png,Buffer.alloc(6*1024*1024-images.png.length)]);
  assert.throws(()=>normalizeConversationAttachments([attachment(six,'one.png'),attachment(six,'two.png')]),/two\.png.*10 MiB/);
  assert.equal(rasterImageMimeType(Buffer.from('fake PNG IEND JPEG \xff\xd9')),null);
});

test('one invalid image identifies its filename and leaves no partial message, audit or action',t=>{
  const repo=createRepository({memory:true});t.after(()=>repo.db.close());
  const employee=repo.createEmployee('test-111',{name:'Raster fixture',runtime:'Codex'}),conversation=repo.createConversation('test-111',{employeeId:employee.id});
  const before=repo.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  assert.throws(()=>repo.addConversationMessage(conversation.id,{content:'three images',attachments:[attachment(images.png,'first.png'),attachment(images.jpeg,'second.jpg','image/jpeg'),attachment(images.png.subarray(0,-2),'broken-third.png')]}),/broken-third\.png.*图片内容无效/);
  assert.equal(repo.getConversation(conversation.id).messages.length,0);assert.equal(repo.listA2AActions('test-111',{status:'all'}).length,0);assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before);
  const bytes=Buffer.concat([images.jpeg,tails[2]]),sent=repo.addConversationMessage(conversation.id,{attachments:[attachment(images.png,'first.png'),attachment(bytes,'second.jpg','image/jpg'),attachment(images.webp,'third.webp','image/webp')]});
  const action=repo.getA2AAction(sent.execution.id);assert.equal(action.payload.attachments[1].content,bytes.toString('base64'));assert.equal(action.payload.attachments[1].size,bytes.length);
});

test('artifact output keeps trailing bytes and names the exact invalid image',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'raster-artifact-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const session=createImageArtifactSession({runtimeDir:root,actionId:'raster-action',conversationId:'raster-conversation'}),bytes=Buffer.concat([images.png,tails[0]]);
  const manifest=entry=>fs.writeFileSync(session.manifestPath,JSON.stringify({version:1,actionId:session.actionId,conversationId:session.conversationId,artifacts:[entry]}));
  fs.writeFileSync(path.join(session.directory,'result.png'),bytes);manifest({path:'result.png'});
  const output=readImageArtifacts(session);assert.equal(output[0].content,bytes.toString('base64'));assert.equal(output[0].size,bytes.length);
  fs.writeFileSync(path.join(session.directory,'bad.png'),images.png.subarray(0,-2));manifest({path:'bad.png',name:'report-image.png'});assert.throws(()=>readImageArtifacts(session),/report-image\.png.*图片格式/);
});
