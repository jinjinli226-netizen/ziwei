import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {inspectNativeHealthListener} from '../scripts/client-lifecycle.mjs';

test('a foreign health listener cannot borrow another live process PID',{skip:process.platform!=='win32',timeout:30000},async t=>{
 const child=spawn(process.execPath,['--input-type=module','-e',"import http from 'node:http';const server=http.createServer((q,r)=>r.end('{}'));server.listen(0,'127.0.0.1',()=>console.log(server.address().port));process.stdin.resume();process.stdin.on('end',()=>server.close());"],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const port=await new Promise((resolve,reject)=>{child.stdout.once('data',bytes=>resolve(Number(String(bytes).trim())));child.once('error',reject);});
 const foreign=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({pid:child.pid,connectionState:'draining',activeActionCount:0,maintenance:{safe:true}}));});foreign.listen(0,'127.0.0.1');await once(foreign,'listening');
 t.after(async()=>{await new Promise(resolve=>foreign.close(resolve));const exit=once(child,'exit');child.stdin.end();await exit;});
 assert.equal((await inspectNativeHealthListener('http://127.0.0.1:'+port,child.pid)).listenerPid,child.pid);
 const origin='http://127.0.0.1:'+foreign.address().port;assert.equal((await(await fetch(origin)).json()).pid,child.pid);
 await assert.rejects(inspectNativeHealthListener(origin,child.pid),{code:'HEALTH_LISTENER_MISMATCH'});
});
