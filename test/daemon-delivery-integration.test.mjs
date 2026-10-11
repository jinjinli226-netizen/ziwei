import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createRepository} from '../backend/repository.mjs';
import {createApp} from '../backend/app.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(100);}throw new Error('Timed out waiting for isolated daemon');}
async function fixture(t,intercept=()=>false){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-delivery-live-'));
 const repo=createRepository({memory:true});const device=repo.claimDevicePairing({code:repo.createDevicePairing('test-111',{name:'Isolated delivery test',os:'Windows'}).code});
 const app=createApp({repository:repo,requireAuth:true,requireDeviceAuth:true,enableScheduler:false});
 const server=http.createServer((req,res)=>{if(!intercept(req,res,()=>app(req,res)))app(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const healthPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const config=path.join(directory,'ziwei_user.json'),home=path.join(directory,'home');
 fs.writeFileSync(config,JSON.stringify({workspace:'test-111',deviceId:device.deviceId,deviceToken:device.deviceToken,apiBase:`http://127.0.0.1:${server.address().port}`,healthPort,healthHost:'127.0.0.1',heartbeatMs:1000,pollMs:1000,workdir:directory}));
 let child,output='';
 const start=()=>{child=spawn(process.execPath,[path.resolve('daemon/ziwei_user.mjs')],{env:{...process.env,ZIWEI_CONFIG:config,ZIWEI_USER_HOME:home},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});return child;};
 const stop=async()=>{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await Promise.race([exited,delay(2000)]);if(child.exitCode===null){child.kill('SIGKILL');await exited;}}};
 const health=async()=>{try{return await(await fetch(`http://127.0.0.1:${healthPort}/readyz`)).json();}catch{return null;}};
 t.after(async()=>{await stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repo.db.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {repo,device,home,directory,start,stop,health,get output(){return output;}};
}

test('a real authenticated daemon recovers a lost ACK and a restart with cached result without reexecuting',{timeout:45000},async t=>{
 let lostAck=false,blockResult=true,resultRequests=0;
 const f=await fixture(t,(req,res)=>{
  if(req.url?.endsWith('/result')){resultRequests++;if(blockResult){req.resume();res.destroy();return true;}}
  if(req.url?.endsWith('/ack')&&!lostAck){lostAck=true;const end=res.end.bind(res);res.end=(...args)=>{if(res.statusCode===200){res.destroy();return res;}return end(...args);};}
  return false;
 });
 const action=f.repo.createA2AAction('test-111',{type:'directory.inspect',payload:{deviceId:f.device.deviceId,path:f.directory,includeChildren:false,includeRoots:false}});
 f.start();const stateFile=path.join(f.home,'runtime','action-state.json');
 await until(()=>{try{return JSON.parse(fs.readFileSync(stateFile,'utf8')).completed.some(entry=>entry.result.actionId===action.id);}catch{return false;}});
 await until(()=>resultRequests>=1);await f.stop();
 assert.equal(f.repo.getA2AAction(action.id).status,'acked');assert.equal(lostAck,true);
 blockResult=false;f.start();await until(()=>f.repo.getA2AAction(action.id).status==='succeeded');
 await until(async()=>Boolean((await f.health())?.ready));
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));assert.equal(state.completed.filter(entry=>entry.result.actionId===action.id).length,1);
 assert.equal(f.output.split('\n').filter(line=>{try{const e=JSON.parse(line);return e.event==='action.started'&&e.actionId===action.id;}catch{return false;}}).length,1,'the real executor starts once across two daemon boots');
 assert.equal(f.repo.getA2AAction(action.id).result.path,f.directory);
});

test('the first slow input poll keeps heartbeats and readiness running and can be drained',{timeout:40000},async t=>{
 let firstPending=false,heartbeats=0,heldResponse;
 const f=await fixture(t,(req,res,run)=>{
  if(req.url?.endsWith('/heartbeat'))heartbeats++;
  if(req.url?.startsWith('/a2a/v1/actions?')&&!heldResponse){firstPending=true;heldResponse=res;res.on('close',()=>{firstPending=false;});return true;}
  return false;
 });
 f.start();await until(()=>firstPending&&heartbeats>=4);
 const health=await f.health();assert.equal(health.ready,true,f.output);assert.equal(health.pollingCount,1);assert.equal(firstPending,true,'initial poll is still waiting after the former 3s budget');
 const config=JSON.parse(fs.readFileSync(path.join(f.directory,'ziwei_user.json'),'utf8'));
 const paused=await fetch(`http://127.0.0.1:${config.healthPort}/local/connection-control`,{method:'POST',headers:{'x-ziwei-local-control':config.deviceToken,'content-type':'application/json'},body:JSON.stringify({operation:'pause'})});assert.equal(paused.status,200);
 await until(async()=>{const h=await f.health();return h?.connectionState==='draining'&&h.pollingCount===0;});assert.equal(firstPending,false);
});
