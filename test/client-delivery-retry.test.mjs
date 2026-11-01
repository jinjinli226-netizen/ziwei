import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {createHash} from 'node:crypto';
import * as lifecycle from '../scripts/client-lifecycle.mjs';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';

async function fixture(t,patch={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-delivery-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'package.json'),'{}');const file=path.join(root,'ziwei_user.json'),calls=[];
  const config={workspace:'fixture',deviceId:'device_fixture',deviceToken:'PRIVATE_CONTROL_TOKEN',healthHost:'127.0.0.1'};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/healthz')return res.end(JSON.stringify({service:'ziwei_user',agentId:'ziwei_user',pid:1234,workspace:'fixture',deviceId:'device_fixture',clientBuild:clientBuildIdentity(root),activeActionCount:2,pollingCount:0,lifecycle:{nonce:'synthetic-local-nonce-12345',root,configPath:file,configSha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),startedAt:'2026-11-01T00:00:00.000Z',managedAuxiliaryCount:0},...patch}));
    let text='';for await(const part of req)text+=part;calls.push({url:req.url,headers:req.headers,body:JSON.parse(text)});
    res.end(JSON.stringify({actionId:'action_fixture',state:'confirmed',status:'succeeded'}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  config.healthPort=server.address().port;fs.writeFileSync(file,JSON.stringify(config));
  return{root,file,calls,env:{ZIWEI_CONFIG:file}};
}

test('CLI receipt retry authenticates only the selected daemon boot and never starts or stops it',async t=>{
  assert.equal(typeof lifecycle.retryClientDelivery,'function');
  const f=await fixture(t);const result=await lifecycle.retryClientDelivery({...f,actionId:'action_fixture'});
  assert.deepEqual(result,{actionId:'action_fixture',state:'confirmed',status:'succeeded'});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/local/delivery-retry');
  assert.deepEqual(f.calls[0].body,{nonce:'synthetic-local-nonce-12345',workspace:'fixture',actionId:'action_fixture'});
  assert.equal(f.calls[0].headers['x-ziwei-local-control'],'PRIVATE_CONTROL_TOKEN');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|nonce/);
});

test('CLI receipt retry refuses a different device before sending authenticated control',async t=>{
  assert.equal(typeof lifecycle.retryClientDelivery,'function');
  const f=await fixture(t,{deviceId:'another-device'});
  await assert.rejects(lifecycle.retryClientDelivery({...f,actionId:'action_fixture'}),{code:'CLIENT_IDENTITY_MISMATCH'});
  assert.equal(f.calls.length,0);
});
