import {rasterFixtures} from './fixtures/raster-images.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLocalActionExecutor } from '../src/local-action.mjs';
import { discoverInstalledRuntimes,resetRuntimeDiscovery,executeRuntime } from '../src/runtime-adapters.mjs';

const png=rasterFixtures.png;
function fixture(t,executorOptions={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-native-image-test-'));
  const bin=path.join(root,'bin');const cwd=path.join(root,'cwd');const runtimeDir=path.join(root,'runtime');
  fs.mkdirSync(bin);fs.mkdirSync(cwd);
  const entry=path.join(bin,'node_modules','@openai','codex','bin','codex.js');fs.mkdirSync(path.dirname(entry),{recursive:true});
  fs.writeFileSync(path.join(bin,'codex.cmd'),'@echo off\r\nexit /b 99\r\n');
  fs.writeFileSync(entry,`const fs=require('node:fs'),path=require('node:path');
if(process.argv.slice(2).join(' ')==='--version'){console.log('codex-cli 0.162.0');process.exit(0);}
if(process.argv[2]!=='exec')process.exit(4);
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
 fs.appendFileSync('fake-cli-invocations.txt','invoked\\n');
 const dir=process.env.ZIWEI_IMAGE_OUTPUT_DIR,manifest=process.env.ZIWEI_IMAGE_OUTPUT_MANIFEST;
 if(dir&&manifest){
  const bytes=Buffer.from('${png.toString('base64')}','base64');
  fs.writeFileSync(path.join(dir,'answer.png'),process.env.ZIWEI_FAKE_BAD_IMAGE?'invalid image':bytes);
  fs.writeFileSync(manifest,JSON.stringify({version:1,actionId:process.env.ZIWEI_IMAGE_OUTPUT_ACTION_ID,conversationId:process.env.ZIWEI_IMAGE_OUTPUT_CONVERSATION_ID||null,artifacts:[{path:process.env.ZIWEI_FAKE_OUTSIDE?'../outside.png':'answer.png'}]}));
 }
 const images=process.argv.filter((x,i)=>process.argv[i-1]==='--image');
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({fixture:true,models:0,imageCount:images.length,actualImageBytes:images.map(x=>fs.readFileSync(x).length),hasOutputInstructions:input.includes('[本次执行的图片输出通道]'),configOverrides:process.argv.filter((x,i)=>process.argv[i-1]==='--config')})}}));
});`);
  const codexHome=path.join(root,'codex-home');fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome,'auth.json'),JSON.stringify({OPENAI_API_KEY:crypto.randomBytes(18).toString('hex')}));
  const hermesHome=path.join(root,'hermes-home');fs.mkdirSync(hermesHome);
  const env={CODEX_HOME:codexHome,HERMES_HOME:hermesHome,NPM_CONFIG_USERCONFIG:path.join(root,'empty.npmrc'),PATH:[bin,path.join(process.env.SystemRoot,'System32')].join(';'),APPDATA:root,npm_config_prefix:bin};
  const original=new Map(Object.keys(env).map(key=>[key,process.env[key]]));
  for(const [key,value] of Object.entries(env))process.env[key]=value;
  fs.writeFileSync(env.NPM_CONFIG_USERCONFIG,'');t.mock.method(os,'homedir',()=>root);resetRuntimeDiscovery();
  t.after(()=>{for(const [key,value]of original){if(value===undefined)delete process.env[key];else process.env[key]=value;}resetRuntimeDiscovery();fs.rmSync(root,{recursive:true,force:true});});
  const found=discoverInstalledRuntimes({force:true});
  assert.equal(found.runtimes.Codex.binary,path.join(bin,'codex.cmd'));
  assert.equal(found.runtimes.Codex.status,'available');
  assert.ok(Object.values(found.runtimes).filter(x=>x.status==='available').every(x=>x.binary===path.join(bin,'codex.cmd')));
  const execute=createLocalActionExecutor({runtimeDir,defaultWorkdir:cwd,...executorOptions});
  const action={id:'image-action',type:'conversation.execute',payload:{conversationId:'image-conversation',runtime:'Codex',prompt:'Inspect image and return another image',attachments:[{name:'input.png',mimeType:'image/png',contentEncoding:'base64',content:png.toString('base64')}]}};
  return {root,cwd,runtimeDir,execute,action};
}
const windowsOnly={skip:process.platform!=='win32'};

test('native Codex receives actual image flags and returns separately declared image bytes',windowsOnly,async t=>{
  const f=fixture(t);const result=await f.execute(f.action);
  assert.equal(result.status,'succeeded');
  const receipt=JSON.parse(result.result.output);
  assert.equal(receipt.imageCount,1);assert.deepEqual(receipt.actualImageBytes,[png.length]);assert.equal(receipt.hasOutputInstructions,true);
  assert.deepEqual(result.result.outputArtifacts,[{name:'answer.png',mimeType:'image/png',size:png.length,contentEncoding:'base64',content:png.toString('base64')}]);
  assert.equal(result.result.inputAttachments[0].name,'input.png');
  assert.equal(result.result.outputArtifacts.some(x=>x.name==='input.png'),false);
});
test('invalid declared generated image makes native execution visibly fail',windowsOnly,async t=>{
  const f=fixture(t);f.action.payload.env={ZIWEI_FAKE_BAD_IMAGE:'1'};
  const result=await f.execute(f.action);
  assert.equal(result.status,'failed');assert.equal(result.code,'image_artifact_invalid');assert.match(result.error,/图片格式|魔数/);
  assert.equal(result.result.outputArtifacts?.length || 0,0);
});
test('outside declaration fails instead of reading any surrounding file',windowsOnly,async t=>{
  const f=fixture(t);f.action.payload.env={ZIWEI_FAKE_OUTSIDE:'1'};
  const result=await f.execute(f.action);
  assert.equal(result.status,'failed');assert.match(result.error,/路径|目录/);assert.equal(result.result.outputArtifacts?.length || 0,0);
});
test('bad uploaded image bytes fail before any CLI execution',windowsOnly,async t=>{
  const f=fixture(t);f.action.payload.attachments[0].content=Buffer.from('not an image').toString('base64');
  await assert.rejects(()=>f.execute(f.action),/图片格式|魔数/);
  assert.equal(fs.existsSync(path.join(f.cwd,'fake-cli-invocations.txt')),false);
});
test('Hermes multiple images cannot fall back to a different installed runtime',windowsOnly,async t=>{
  const f=fixture(t);f.action.payload.runtime='Hermes';f.action.payload.attachments.push({...f.action.payload.attachments[0],name:'second.png'});
  await assert.rejects(()=>f.execute(f.action),/Hermes CLI 不可用/);
  assert.equal(fs.existsSync(path.join(f.cwd,'fake-cli-invocations.txt')),false);
});
test('trusted executor can disable global Codex MCP by quoted key while action payload cannot',windowsOnly,async t=>{
  const f=fixture(t,{codexMcpDisabledServers:['iphone-controller','key.with.dot']});
  f.action.payload.codexMcpDisabledServers=['untrusted-payload'];
  const result=await f.execute(f.action);assert.equal(result.status,'succeeded');
  const overrides=JSON.parse(result.result.output).configOverrides;
  assert.ok(overrides.includes('mcp_servers={"iphone-controller"={enabled=false},"key.with.dot"={enabled=false}}'));
  assert.equal(overrides.some(x=>x.includes('untrusted-payload')),false);
});
test('global Codex MCP table policy precedes scoped management and phone overrides',windowsOnly,async t=>{
  const f=fixture(t),tokenFile=path.join(f.root,'fixture-mcp.json');
  const token=crypto.randomUUID();fs.writeFileSync(tokenFile,JSON.stringify({token,workspaces:['image-fixture']}));
  const result=await executeRuntime({runtime:'Codex',prompt:'isolated fake argv only; no model',cwd:f.cwd,
    codexMcpDisabledServers:['iphone-controller','ziwei_management','ziwei-terminal'],
    managementMcp:{workspace:'image-fixture',config:{enabled:true,tokenFile,baseUrl:'https://example.test'},auditDirectory:path.join(f.root,'audit'),actionId:'image-policy'}});
  assert.equal(result.status,'failed');assert.equal(result.code,'management_mcp_not_loaded','fake argv output must not bypass actual MCP handshake verification');
  const overrides=JSON.parse(result.result.output).configOverrides;
  const table=overrides.findIndex(x=>x.startsWith('mcp_servers={'));
  assert.ok(table>=0);
  assert.ok(table<overrides.findIndex(x=>x.startsWith('mcp_servers.ziwei_management.command=')),'global table must precede the scoped management transport');
  assert.ok(table<overrides.indexOf('mcp_servers.ziwei_management.enabled=true'),'scoped management must override inherited disabled state');
  assert.ok(table<overrides.indexOf('mcp_servers.ziwei-terminal.enabled=false'),'phone policy must follow the global table');
  assert.equal(JSON.stringify(overrides).includes(token),false);
});
test('default empty MCP policy adds no whole-table override to ordinary management execution',windowsOnly,async t=>{
  const f=fixture(t),tokenFile=path.join(f.root,'fixture-mcp.json');
  fs.writeFileSync(tokenFile,JSON.stringify({token:crypto.randomUUID(),workspaces:['image-fixture']}));
  const result=await executeRuntime({runtime:'Codex',prompt:'isolated fake argv only; no model',cwd:f.cwd,
    managementMcp:{workspace:'image-fixture',config:{enabled:true,tokenFile,baseUrl:'https://example.test'},auditDirectory:path.join(f.root,'audit'),actionId:'image-policy-default'}});
  assert.equal(result.status,'failed');assert.equal(result.code,'management_mcp_not_loaded');
  const overrides=JSON.parse(result.result.output).configOverrides;
  assert.equal(overrides.some(x=>x.startsWith('mcp_servers={')),false);
  assert.ok(overrides.includes('mcp_servers.ziwei_management.enabled=true'));
  assert.ok(overrides.includes('mcp_servers.ziwei-terminal.enabled=false'));
});
