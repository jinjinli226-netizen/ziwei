import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {createApp} from './app.mjs';
import {createManagementService} from './management.mjs';
import {mobileRunView} from './mobile-read-view.mjs';
import {rasterFixtures} from '../test/fixtures/raster-images.mjs';

async function request(app,url,{cookie='',headers={}}={}) {
  const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}});
  const req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[];
  req.method='GET';req.url=url;req.headers={host:'mobile-runs.fixture',cookie,...headers};
  try{return await new Promise((resolve,reject)=>{
    res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));done?.();return true;};
    res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,bytes,json:()=>JSON.parse(bytes)});res.emit('finish');return res;};
    req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture request')));req.push(null);
  });}finally{socket.destroy();}
}
function fixture(t) {
  const mcpToken=randomUUID(),slug='mobile-run-media',app=createApp({memory:true,requireAuth:true,mcpToken,mcpWorkspace:slug,mcpRole:'owner'}),repo=app.locals.repo,auth=app.locals.auth;
  t.after(()=>repo.db.close());
  const owner=auth.setup({email:'mobile-run-owner@fixture.test',password:'isolated-fixture-password'});
  auth.createWorkspace(owner.user_id,{slug,name:'Mobile run media fixture',kind:'team'});
  const ws=repo.getWorkspace(slug),ownerCookie=`ziwei_session=${owner.session.token}`;
  repo.heartbeatDevice(slug,{deviceId:'mobile-run-pc',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}]}}});
  const bot=createManagementService(repo).bots.create(slug,{name:'Fixture Bot',targetDeviceId:'mobile-run-pc',runtimeProfile:'default',visibility:'workspace',idempotencyKey:'media-bot'},{actorUserId:owner.user_id,actorRole:'owner'});
  return {app,repo,auth,mcpToken,slug,ws,ownerCookie,bot};
}
const clone=value=>structuredClone(value);
function freeze(value) {if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}
const image=(bytes=rasterFixtures.png)=>({name:'original.png',mimeType:'image/png',contentEncoding:'base64',size:bytes.length,content:bytes.toString('base64'),unknownAttachment:{keep:true}});
const metadata=value=>{const {content,...rest}=value;return rest;};
const proof=()=>({code:'EXECUTION_UNCERTAIN',executionState:'uncertain',fixture:false,stopConfirmed:true,processExit:{launched:true,rootPid:321,rootConfirmed:true,treeConfirmed:true,activeProcesses:0,rootExitCode:0,unknownExit:{keep:true}},unknownProof:{keep:true},output:'Complete output '.repeat(1024),stdout:'Complete stdout',message:'Complete message',summary:'Complete summary',text:'Complete text'});

test('only recognized inline raster slots change; all terminal proof and full text survive without mutation',()=>{
  const attachment=image(),result={...proof(),outputArtifacts:[attachment],result:{...proof(),outputArtifacts:[attachment]}},eventResult=clone(result);
  const original=freeze({id:'original',status:'expired',acked_at:'2026-10-17T00:00:00Z',payload:{prompt:'[紫薇汇报:original] '+ 'Complete prompt '.repeat(4096),messageId:'exact-original-message',actionId:'exact-original-action',attachments:[attachment],unknownPayload:{content:'keep arbitrary content'}},result,events:[{id:'old-progress',type:'progress',data:{keep:true}},{id:'terminal',type:'succeeded',message:'Original terminal',data:{result:eventResult,unknownEvent:{keep:true}}},{id:'failed-proof',type:'failed',data:{result:clone(result)}},{id:'latest',type:'progress',message:'Latest message',data:{message:'Latest nested message',result:clone(result),unknownLast:{keep:true}}}]});
  const before=JSON.stringify(original),projected=mobileRunView(original),expected=clone(original);
  expected.payload.attachments=[metadata(attachment)];
  for(const value of [expected.result,expected.result.result,...expected.events.flatMap(event=>event.data.result?[event.data.result,event.data.result.result]:[])])value.outputArtifacts=[metadata(attachment)];
  expected.events.shift();expected.event_count=4;
  assert.deepEqual(projected,expected);assert.equal(JSON.stringify(original),before);
  assert.equal(projected.payload.unknownPayload,original.payload.unknownPayload);assert.equal(projected.result.processExit,original.result.processExit);
  assert.deepEqual(mobileRunView(projected),projected);
});

test('runs without events also project recognized media and preserve unrelated structure',()=>{
  const attachment=image(),original=freeze({id:'no-events',payload:{attachments:[attachment]},result:{result:{outputArtifacts:[attachment],...proof()}},unknown:{keep:true}}),before=JSON.stringify(original);
  const actual=mobileRunView(original);
  assert.deepEqual(actual.payload.attachments,[metadata(attachment)]);assert.deepEqual(actual.result.result.outputArtifacts,[metadata(attachment)]);assert.equal(actual.result.result.output,original.result.result.output);
  assert.equal(Object.hasOwn(actual,'events'),false);assert.equal(Object.hasOwn(actual,'event_count'),false);assert.equal(JSON.stringify(original),before);
  for(const value of [undefined,null,7,'original string',[],{id:'unchanged',result:'Original result text'}])assert.equal(mobileRunView(value),value);
});

test('non-images, unknown encodings, mismatched MIME and unrelated content are retained exactly',()=>{
  const png=rasterFixtures.png.toString('base64'),unknown=[
    {name:'document.txt',mimeType:'text/plain',contentEncoding:'base64',content:png},
    {name:'unknown.png',mimeType:'image/png',contentEncoding:'base32',content:png},
    {name:'invalid.png',mimeType:'image/png',contentEncoding:'base64',content:Buffer.from('not an image').toString('base64')},
    {name:'wrong.jpg',mimeType:'image/jpeg',contentEncoding:'base64',content:png},
    {name:'remote.png',url:'https://example.invalid/image.png',mimeType:'image/png',contentEncoding:'base64',content:png},
    {name:'svg.svg',url:'data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')},
    {name:'opaque',content:png,unknownProof:{keep:true}},
    {name:'invalid-base64.png',mimeType:'image/png',contentEncoding:'base64',content:'%%%INVALID%%%'}
  ],original=freeze({payload:{attachments:unknown,context:{content:png}},result:{outputArtifacts:unknown,proofAttachment:image(),nativeOperation:{data:{outputArtifacts:[image()]}}},events:[{id:'terminal',type:'succeeded',data:{result:{outputArtifacts:unknown},attachments:[image()]}}]}),before=JSON.stringify(original);
  const actual=mobileRunView(original);
  assert.equal(actual.payload,original.payload);assert.equal(actual.result,original.result);assert.equal(actual.events[0],original.events[0]);assert.equal(JSON.stringify(original),before);
});

test('existing recognized image representations and matching aliases remove only their own bytes',()=>{
  const png=rasterFixtures.png.toString('base64'),values=[
    {name:'data-url',url:`data:image/png;base64,${png}`,dataUrl:`data:image/png;base64,${png}`,unknown:'keep'},
    {name:'data',mime:'image/png',data:png},
    {name:'content-base64',mimeType:'image/png',contentBase64:png},
    {name:'gif',mimeType:'image/gif',contentEncoding:'base64',content:rasterFixtures.gif.toString('base64')},
    {name:'jpeg',mimeType:'image/jpeg',contentEncoding:'base64',content:rasterFixtures.jpeg.toString('base64')},
    {name:'webp',mimeType:'image/webp',contentEncoding:'base64',content:rasterFixtures.webp.toString('base64')},
    {name:'different-alias',url:`data:image/png;base64,${png}`,preview:`data:image/gif;base64,${rasterFixtures.gif.toString('base64')}`}
  ],actual=mobileRunView({payload:{attachments:freeze(values)}}).payload.attachments;
  assert.deepEqual(actual[0],{name:'data-url',unknown:'keep',size:rasterFixtures.png.length,mimeType:'image/png'});
  assert.equal(actual[1].data,undefined);assert.equal(actual[2].contentBase64,undefined);
  for(const index of [3,4,5])assert.equal(actual[index].content,undefined);
  assert.equal(actual[6].url,undefined);assert.equal(actual[6].preview,values[6].preview,'a different image alias is not silently erased');
});

test('real authenticated mobile five-run HTTP drops duplicate image bytes while default, MCP and stored receipts remain exact',async t=>{
  const f=fixture(t),bytes=Buffer.concat([rasterFixtures.png,Buffer.alloc(1024*1024,61)]),attachment=image(bytes),db=f.repo.db;
  const insert=db.prepare('INSERT INTO a2a_actions(id,workspace_id,agent_id,type,payload_json,dedupe_key,status,created_at,acked_at,completed_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)'),event=db.prepare('INSERT INTO a2a_action_events(id,action_id,type,message,data_json,created_at) VALUES(?,?,?,?,?,?)');
  for(let index=0;index<5;index++){
    const id=`media-run-${index}`,stamp=`2028-01-01T00:00:0${index}.000Z`,payload={hermesBot:{employeeId:f.bot.id},prompt:'[紫薇汇报:fixture] '+ 'full prompt '.repeat(512),messageId:`original-message-${index}`,attachments:[attachment],unknownPayload:{keep:true}},result={...proof(),outputArtifacts:[attachment],result:{...proof(),outputArtifacts:[attachment]}};
    insert.run(id,f.ws.id,'ziwei_user','conversation.execute',JSON.stringify(payload),id,'failed',stamp,stamp,stamp,JSON.stringify(result));
    event.run(`${id}-early`,id,'progress','Old progress',JSON.stringify({message:'Old progress'}),stamp);
    event.run(`${id}-proof`,id,'succeeded','Complete proof event',JSON.stringify({result,unknownEvent:{keep:true}}),stamp);
    event.run(`${id}-tail`,id,'progress','Last progress',JSON.stringify({message:'Latest nested message'}),stamp);
  }
  const stored=()=>db.prepare('SELECT id,payload_json,result_json,status FROM a2a_actions ORDER BY id').all(),storedEvents=()=>db.prepare('SELECT * FROM a2a_action_events ORDER BY id').all();
  const before=stored(),beforeEvents=storedEvents(),schema=db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  const path=`/api/workspaces/${f.slug}/bots/${f.bot.id}/runs`,raw=await request(f.app,path,{cookie:f.ownerCookie}),mobile=await request(f.app,path+'?view=mobile',{cookie:f.ownerCookie});
  assert.equal(raw.status,200);assert.equal(mobile.status,200);const actual=mobile.json().runs,original=raw.json().runs;
  t.diagnostic(JSON.stringify({defaultBytes:raw.bytes.length,mobileBytes:mobile.bytes.length}));
  assert.equal(actual.length,5);assert(raw.bytes.length>30*1024*1024);assert(mobile.bytes.length<400000);assert(mobile.bytes.length<raw.bytes.length/20);
  for(let index=0;index<actual.length;index++){
    assert.deepEqual(actual[index],mobileRunView(original[index]));assert.equal(actual[index].payload.prompt,original[index].payload.prompt);assert.equal(actual[index].payload.messageId,original[index].payload.messageId);
    assert.deepEqual(actual[index].result.processExit,original[index].result.processExit);assert.deepEqual(actual[index].result.unknownProof,original[index].result.unknownProof);assert.equal(actual[index].result.output,original[index].result.output);
    assert.equal(actual[index].event_count,3);assert.equal(actual[index].events[0].id,`${actual[index].id}-proof`);assert.deepEqual(actual[index].events[0].data.result.processExit,original[index].events[1].data.result.processExit);
  }
  const after=await request(f.app,path,{cookie:f.ownerCookie}),mcp=await request(f.app,`/mcp/v1/workspaces/${f.slug}/bots/${f.bot.id}/runs?view=mobile`,{headers:{authorization:`Bearer ${f.mcpToken}`}});
  assert.deepEqual(after.bytes,raw.bytes);assert.deepEqual(mcp.bytes,raw.bytes);assert.deepEqual(stored(),before);assert.deepEqual(storedEvents(),beforeEvents);assert.deepEqual(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),schema);
  assert.equal((await request(f.app,path+'?view=mobile')).status,401);
  const outsider=f.auth.register({email:'outsider-media@fixture.test',password:'isolated-fixture-password'});assert.equal((await request(f.app,path+'?view=mobile',{cookie:`ziwei_session=${outsider.session.token}`})).status,403);
  t.diagnostic(JSON.stringify({defaultBytes:raw.bytes.length,mobileBytes:mobile.bytes.length,defaultSha256:createHash('sha256').update(raw.bytes).digest('hex'),mobileSha256:createHash('sha256').update(mobile.bytes).digest('hex')}));
});
