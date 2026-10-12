import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
import {openDatabase} from '../backend/db.mjs';

const appUrl=new URL('../backend/app.mjs',import.meta.url).href;
const fixtureDirectory=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-sqlite-contention-'));
function removeFixture(directory){
  const relative=path.relative(os.tmpdir(),directory);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('ziwei-sqlite-contention-'));
  fs.rmSync(directory,{recursive:true,force:true});
}
function child(source,filename){
  const process=spawn(globalThis.process.execPath,['--input-type=module','-e',source],{env:{...globalThis.process.env,ZIWEI_CONTENTION_TEST_DB:filename},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  const messages=[],waiters=[];let exited=false,stderr='';
  process.stderr.on('data',value=>{stderr+=String(value);});
  process.on('message',message=>{messages.push(message);for(const waiter of [...waiters])if(waiter.match(message)){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(message);}});
  process.on('exit',(code,signal)=>{exited=true;for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(new Error(`Isolated child exited (${code??signal}): ${stderr.slice(-1200)}`));}});
  function wait(match,timeout=6000){
    const existing=messages.find(match);if(existing)return Promise.resolve(existing);
    if(exited)return Promise.reject(new Error(`Isolated child already exited: ${stderr.slice(-1200)}`));
    return new Promise((resolve,reject)=>{const waiter={match,resolve,reject};waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Isolated child response timed out'));},timeout);waiters.push(waiter);});
  }
  async function stop(){
    if(exited)return;
    const closed=new Promise(resolve=>process.once('exit',resolve));
    process.kill();await closed;
  }
  return {process,wait,stop,get exited(){return exited;}};
}
async function readLock(filename,releaseAfterMs=null){
  const locker=child(`
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(process.env.ZIWEI_CONTENTION_TEST_DB,{readOnly:true});
    db.exec('BEGIN');db.prepare('SELECT count(*) FROM workspaces').get();
    process.send({type:'locked'});
    function release(){db.exec('ROLLBACK');db.close();process.send({type:'released'});}
    process.on('message',message=>{if(message.type==='release')release();});
    ${releaseAfterMs===null?'':`setTimeout(release,${releaseAfterMs});`}
  `,filename);
  await locker.wait(message=>message.type==='locked');return locker;
}
async function serverFixture(filename){
  const server=child(`
    import {createHash} from 'node:crypto';
    import {createApp,attachRealtimeWebSocket} from ${JSON.stringify(appUrl)};
    const app=createApp({filename:process.env.ZIWEI_CONTENTION_TEST_DB,requireAuth:true,enableScheduler:false});
    const account=app.locals.auth.setup({name:'contention owner',email:'contention@example.test',password:'isolated-test-password'});
    app.locals.auth.createWorkspace(account.user_id,{name:'Contention fixture',slug:'contention-fixture'});
    const db=app.locals.repo.db;
    const originalAuthenticate=app.locals.auth.authenticate.bind(app.locals.auth),originalAccess=app.locals.auth.canAccess.bind(app.locals.auth);
    const server=app.listen(0,'127.0.0.1');const sockets=attachRealtimeWebSocket(server,app);
    const state=()=>createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM local_sessions ORDER BY id').all())).digest('hex');
    server.once('listening',()=>process.send({type:'ready',port:server.address().port,cookie:'ziwei_session='+account.session.token,pid:process.pid,sessionState:state()}));
    process.on('message',message=>{
      if(message.type==='timeout'){db.exec('PRAGMA busy_timeout='+message.ms);process.send({type:'timeout-set'});}
      if(message.type==='state')process.send({type:'state',requestId:message.requestId,pid:process.pid,sessionState:state()});
      if(message.type==='access-failure'){app.locals.auth.canAccess=()=>{throw new Error('isolated access failure');};process.send({type:'access-failure-set'});}
      if(message.type==='restore-auth'){app.locals.auth.authenticate=originalAuthenticate;app.locals.auth.canAccess=originalAccess;process.send({type:'auth-restored'});}
    });
  `,filename);
  const ready=await server.wait(message=>message.type==='ready');return {server,...ready};
}
async function handshake(fixture,{cookie=fixture.cookie}={}){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(`ws://127.0.0.1:${fixture.port}/api/workspaces/contention-fixture/notifications/ws`,{headers:cookie?{cookie}:{}});
    const timer=setTimeout(()=>{socket.terminate();reject(new Error('WebSocket handshake timed out'));},6000);
    let finished=false;
    socket.on('error',error=>{if(!finished){finished=true;clearTimeout(timer);reject(error);}});
    socket.on('message',raw=>{const message=JSON.parse(String(raw));if(message.type==='ready'){finished=true;clearTimeout(timer);socket.close();resolve({status:101,message});}});
    socket.on('unexpected-response',(_request,response)=>{
      finished=true;clearTimeout(timer);response.resume();response.once('end',()=>{socket.terminate();resolve({status:response.statusCode,retryAfter:response.headers['retry-after']});});
    });
  });
}

test('default database connection waits for a real short read lock before committing its write',async()=>{
  const directory=fixtureDirectory(),filename=path.join(directory,'fixture.sqlite');let db,locker;
  try{
    db=openDatabase({filename});db.prepare("UPDATE workspaces SET name='before' WHERE slug='test-111'").run();
    locker=await readLock(filename,250);const started=Date.now();
    db.prepare("UPDATE workspaces SET name='after' WHERE slug='test-111'").run();
    assert.ok(Date.now()-started>=150,'write must wait for the other process to release its actual SQLite reader');
    assert.equal(db.prepare("SELECT name FROM workspaces WHERE slug='test-111'").get().name,'after');
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout,5000);
    await locker.wait(message=>message.type==='released');
  }finally{await locker?.stop();db?.close();removeFixture(directory);}
});

test('authenticated WebSocket waits through a short real read lock and retains workspace authorization',async()=>{
  const directory=fixtureDirectory(),filename=path.join(directory,'fixture.sqlite');let fixture,locker;
  try{
    fixture=await serverFixture(filename);locker=await readLock(filename,250);
    const connected=await handshake(fixture);assert.equal(connected.status,101);assert.equal(connected.message.workspace,'contention-fixture');
    await locker.wait(message=>message.type==='released');
    assert.equal((await handshake(fixture,{cookie:'ziwei_session=invalid-fixture-token'})).status,401);
    assert.equal(fixture.server.exited,false);
  }finally{await locker?.stop();await fixture?.server.stop();removeFixture(directory);}
});

test('WebSocket read-lock contention beyond its wait budget returns 503 without exiting the API or mutating sessions',async()=>{
  const directory=fixtureDirectory(),filename=path.join(directory,'fixture.sqlite');let fixture,locker;
  try{
    fixture=await serverFixture(filename);fixture.server.process.send({type:'timeout',ms:60});await fixture.server.wait(message=>message.type==='timeout-set');
    locker=await readLock(filename);
    const response=await handshake(fixture);assert.equal(response.status,503);assert.equal(response.retryAfter,'1');
    assert.equal(fixture.server.exited,false,'busy authentication must not escape the upgrade callback');
    fixture.server.process.send({type:'state',requestId:'after-busy'});
    const state=await fixture.server.wait(message=>message.type==='state'&&message.requestId==='after-busy');assert.equal(state.pid,fixture.pid);assert.equal(state.sessionState,fixture.sessionState);
    const health=await fetch(`http://127.0.0.1:${fixture.port}/healthz`);assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
    locker.process.send({type:'release'});await locker.wait(message=>message.type==='released');
    assert.equal((await handshake(fixture)).status,101,'the same API process must authenticate after the reader releases');
  }finally{await locker?.stop();await fixture?.server.stop();removeFixture(directory);}
});

test('an unexpected workspace access failure rejects the upgrade with 500 and keeps authentication enforced',async()=>{
  const directory=fixtureDirectory(),filename=path.join(directory,'fixture.sqlite');let fixture;
  try{
    fixture=await serverFixture(filename);fixture.server.process.send({type:'access-failure'});await fixture.server.wait(message=>message.type==='access-failure-set');
    assert.equal((await handshake(fixture)).status,500);assert.equal(fixture.server.exited,false);
    fixture.server.process.send({type:'restore-auth'});await fixture.server.wait(message=>message.type==='auth-restored');
    assert.equal((await handshake(fixture,{cookie:null})).status,401);assert.equal((await handshake(fixture)).status,101);
  }finally{await fixture?.server.stop();removeFixture(directory);}
});
