import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as localAction from '../src/local-action.mjs';
import {runtimeInvocation,discoverInstalledRuntimes,resetRuntimeDiscovery} from '../src/runtime-adapters.mjs';
import {rasterFixtures} from './fixtures/raster-images.mjs';

const MiB=1024*1024;
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-runtime-references-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function reference(size=12*MiB,name='large.png'){
  const chunk=Buffer.alloc(64*1024,61),sum=createHash('sha256');
  for(let offset=0;offset<size;offset+=chunk.length)sum.update(chunk.subarray(0,Math.min(chunk.length,size-offset)));
  return{attachmentId:'attachment-fixture',name,mimeType:'image/png',size,sha256:sum.digest('hex')};
}
async function transferFor(attachment){
  const {createAttachmentTransfer}=await import('../src/conversation-attachment-transfer.mjs');
  let requests=0;
  const transfer=createAttachmentTransfer({apiBase:'https://attachment.fixture',headers:{'x-ziwei-device-token':'fixture-device'},fetchImpl:async(url,options)=>{
    requests++;assert.equal(new URL(url).pathname,`/a2a/v1/actions/reference-action/attachments/${attachment.attachmentId}`);
    assert.equal(options.headers.get('x-ziwei-device-token'),'fixture-device');assert.equal(options.redirect,'error');
    let remaining=attachment.size;
    return new Response(new ReadableStream({pull(controller){if(!remaining){controller.close();return;}const bytes=Buffer.alloc(Math.min(64*1024,remaining),61);remaining-=bytes.length;controller.enqueue(bytes);}}));
  }});
  return{transfer,get requests(){return requests;}};
}

test('reference attachments stream to the approved action folder and recovery verifies existing bytes without loading them',async t=>{
  assert.equal(typeof localAction.materializeRuntimeAttachmentsAsync,'function');
  const root=fixture(t),attachment=reference(),f=await transferFor(attachment);
  const read=fs.readFileSync;
  t.mock.method(fs,'readFileSync',(file,...args)=>{assert.equal(String(file).includes(`${path.sep}.ziwei${path.sep}attachments${path.sep}`),false,'reference content must never be read into memory');return read(file,...args);});
  const options={attachments:[attachment],cwd:root,actionId:'reference-action',transfer:f.transfer};
  const [file]=await localAction.materializeRuntimeAttachmentsAsync(options);
  assert.equal(file.path,path.join(root,'.ziwei','attachments','reference-action','large.png'));
  assert.equal(fs.statSync(file.path).size,attachment.size);assert.equal(file.nativeVision,false);assert.equal(file.sha256,attachment.sha256);
  assert.equal(Object.hasOwn(file,'content'),false);assert.equal(Object.hasOwn(file,'contentEncoding'),false);
  assert.deepEqual(await localAction.materializeRuntimeAttachmentsAsync(options),[file]);assert.equal(f.requests,1);
  const fd=fs.openSync(file.path,'r+');try{fs.writeSync(fd,Buffer.from('wrong'),0,5,0);}finally{fs.closeSync(fd);}
  await assert.rejects(localAction.materializeRuntimeAttachmentsAsync(options),/内容不同|摘要|mismatch/);assert.equal(f.requests,1);
});

test('reference count and aggregate 500 MiB limits reject the whole batch before any download',async t=>{
  assert.equal(typeof localAction.materializeRuntimeAttachmentsAsync,'function');
  const root=fixture(t),transfer={download(){throw Error('download must not start');}},base={attachmentId:'fixture',name:'file.bin',mimeType:'application/octet-stream',size:1,sha256:'a'.repeat(64)};
  await assert.rejects(localAction.materializeRuntimeAttachmentsAsync({attachments:Array.from({length:21},()=>base),cwd:root,transfer}),/20/);
  await assert.rejects(localAction.materializeRuntimeAttachmentsAsync({attachments:[{...base,size:500*MiB},{...base,size:1}],cwd:root,transfer}),/500 MiB/);
});

test('reference download rejects an attachment directory that escapes through a junction',async t=>{
  assert.equal(typeof localAction.materializeRuntimeAttachmentsAsync,'function');
  const root=fixture(t),outside=fixture(t);fs.mkdirSync(path.join(root,'.ziwei'));
  fs.symlinkSync(outside,path.join(root,'.ziwei','attachments'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(localAction.materializeRuntimeAttachmentsAsync({attachments:[reference(1)],cwd:root,actionId:'reference-action',transfer:{download(){throw Error('download must not start');}}}),/批准根目录|之外|outside/);
});

for(const runtime of ['Codex','Hermes'])test(`${runtime} sends reference images as file paths while legacy small images keep native vision`,()=>{
  const attachment={name:'large.png',path:path.resolve('large.png'),mimeType:'image/png',bytes:12*MiB,nativeVision:false};
  const referenced=runtimeInvocation(runtime,{prompt:`Read this file with file tools: ${attachment.path}`,attachments:[attachment]});
  assert.equal(referenced.args.includes('--image'),false);assert.ok(String(referenced.stdin).includes(attachment.path));
  const legacy=runtimeInvocation(runtime,{prompt:'Inspect legacy image',attachments:[{...attachment,bytes:128,nativeVision:undefined}]});
  assert.equal(legacy.args.includes('--image'),true);
});

test('an attachment-only legacy DSH image keeps its native image block without an invented prompt',async t=>{
  const root=fixture(t);let selected;
  const execute=localAction.createLocalActionExecutor({runtimeDir:path.join(root,'runtime'),defaultWorkdir:root,dshRuntime:async options=>{selected=options;return{status:'succeeded'};}});t.after(()=>execute.close());
  await execute({id:'legacy-image',type:'conversation.execute',payload:{runtime:'DSH',profile:'bot-real',attachments:[{name:'image.png',mimeType:'image/png',content:rasterFixtures.png.toString('base64'),contentEncoding:'base64'}]}});
  assert.deepEqual(selected.content,[{type:'image',mediaType:'image/png',name:'image.png',data:rasterFixtures.png.toString('base64')}]);
});

test('DSH reference images stay path-only and generated output descriptors preserve the native session exit',async t=>{
  const root=fixture(t),attachment=reference(),f=await transferFor(attachment),runtimeDir=path.join(root,'runtime');
  const sessionExit={schemaVersion:1,source:'dsh-native-session',actionId:'reference-action',employeeId:'employee',conversationId:'conversation',botName:'bot-real',sessionId:'native-session',requestId:'native-request',turn:1,reason:'completed',terminalConfirmed:true};
  let selected;
  const execute=localAction.createLocalActionExecutor({runtimeDir,defaultWorkdir:root,attachmentTransfer:f.transfer,dshRuntime:async options=>{
    selected=options;
    const directory=path.join(runtimeDir,'image-output',fs.readdirSync(path.join(runtimeDir,'image-output'))[0]);
    fs.writeFileSync(path.join(directory,'answer.png'),rasterFixtures.png);
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({version:1,actionId:'reference-action',conversationId:'conversation',artifacts:[{path:'answer.png'}]}));
    return{status:'succeeded',output:'generated output',sessionId:'native-session',sessionExit};
  }});t.after(()=>execute.close());
  const read=fs.readFileSync;
  t.mock.method(fs,'readFileSync',(file,...args)=>{assert.equal(String(file).endsWith('large.png'),false,'DSH must not buffer a large image');return read(file,...args);});
  const result=await execute({id:'reference-action',type:'conversation.execute',payload:{runtime:'DSH',profile:'bot-real',employeeId:'employee',conversationId:'conversation',prompt:'Read the file and generate an image',attachments:[attachment]}});
  assert.equal(result.status,'succeeded');assert.deepEqual(result.result.sessionExit,sessionExit);assert.equal(result.result.processExit,undefined);
  assert.equal(selected.content.length,1);assert.equal(selected.content[0].type,'text');assert.match(selected.content[0].text,/large\.png/);assert.match(selected.prompt,/本次执行的附件输出通道/);
  assert.equal(result.result.inputAttachments[0].nativeVision,false);assert.equal(result.result.outputArtifacts.length,1);
  assert.equal(result.result.outputArtifacts[0].name,'answer.png');assert.equal(result.result.outputArtifacts[0].content,undefined);assert.equal(result.result.outputArtifacts[0].sha256,createHash('sha256').update(rasterFixtures.png).digest('hex'));
});

test('the isolated Codex CLI receives only a large reference path and returns a streamed output descriptor',{skip:process.platform!=='win32'},async t=>{
  const root=fixture(t),bin=path.join(root,'bin'),entry=path.join(bin,'node_modules','@openai','codex','bin','codex.js');
  fs.mkdirSync(path.dirname(entry),{recursive:true});fs.writeFileSync(path.join(bin,'codex.cmd'),'@echo off\r\nexit /b 99\r\n');
  fs.writeFileSync(entry,`const fs=require('node:fs'),path=require('node:path');
if(process.argv.includes('--version')){console.log('codex-cli 0.162.0');process.exit(0);}
if(process.argv.includes('mcp')&&process.argv.includes('list')){console.log('[]');process.exit(0);}
if(process.argv[2]!=='exec')process.exit(4);
let prompt='';process.stdin.on('data',bytes=>prompt+=bytes);process.stdin.on('end',()=>{
 const directory=process.env.ZIWEI_IMAGE_OUTPUT_DIR;
 fs.writeFileSync(path.join(directory,'answer.bin'),Buffer.alloc(1024,32));
 fs.writeFileSync(process.env.ZIWEI_IMAGE_OUTPUT_MANIFEST,JSON.stringify({version:1,actionId:process.env.ZIWEI_IMAGE_OUTPUT_ACTION_ID,conversationId:process.env.ZIWEI_IMAGE_OUTPUT_CONVERSATION_ID,artifacts:[{path:'answer.bin'}]}));
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({images:process.argv.filter((value,index)=>process.argv[index-1]==='--image').length,hasPath:prompt.includes('large.png'),hasInstructions:prompt.includes('500 MiB')})}}));
});`);
  const codexHome=path.join(root,'codex-home'),hermesHome=path.join(root,'hermes-home');fs.mkdirSync(codexHome);fs.mkdirSync(hermesHome);
  fs.writeFileSync(path.join(codexHome,'auth.json'),JSON.stringify({OPENAI_API_KEY:'synthetic-no-model-key'}));
  const env={CODEX_HOME:codexHome,HERMES_HOME:hermesHome,NPM_CONFIG_USERCONFIG:path.join(root,'empty.npmrc'),PATH:[bin,path.join(process.env.SystemRoot,'System32')].join(';'),APPDATA:root,npm_config_prefix:bin};
  const original=new Map(Object.keys(env).map(key=>[key,process.env[key]]));for(const [key,value]of Object.entries(env))process.env[key]=value;
  fs.writeFileSync(env.NPM_CONFIG_USERCONFIG,'');t.mock.method(os,'homedir',()=>root);resetRuntimeDiscovery();
  t.after(()=>{for(const [key,value]of original){if(value===undefined)delete process.env[key];else process.env[key]=value;}resetRuntimeDiscovery();});
  assert.equal(discoverInstalledRuntimes({force:true}).runtimes.Codex.binary,path.join(bin,'codex.cmd'));
  const attachment=reference(),f=await transferFor(attachment),execute=localAction.createLocalActionExecutor({runtimeDir:path.join(root,'runtime'),defaultWorkdir:root,attachmentTransfer:f.transfer});t.after(()=>execute.close());
  const read=fs.readFileSync;t.mock.method(fs,'readFileSync',(file,...args)=>{assert.equal(String(file).endsWith('large.png'),false,'the runtime must not load a reference image');return read(file,...args);});
  const outcome=await execute({id:'reference-action',type:'conversation.execute',payload:{runtime:'Codex',conversationId:'reference-conversation',prompt:'Use the file tools on the attached input',attachments:[attachment]}});
  assert.equal(outcome.status,'succeeded',outcome.error);assert.deepEqual(JSON.parse(outcome.result.output),{images:0,hasPath:true,hasInstructions:true});
  const artifact=outcome.result.outputArtifacts[0];assert.equal(artifact.name,'answer.bin');assert.equal(artifact.size,1024);assert.equal(artifact.content,undefined);assert.equal(artifact.sha256,createHash('sha256').update(Buffer.alloc(1024,32)).digest('hex'));
});
