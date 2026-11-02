import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CredentialStore} from '../src/config.mjs';
import {machineLogin} from '../src/machine.mjs';

test('registered machine token has no RT and requires server native binding before saving',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-machine-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const issuer='https://op.test/realms/ziwei';
  const selection={origin:'https://workspace.test',profile:'test',account:'machine',purpose:'employee'};
  const credential={issuer,origin:selection.origin,clientId:'ziwei-workspace-worker-one',subject:'machine-sub',clientSecret:'synthetic-private-secret'};
  const store=new CredentialStore(root),revoked=[];
  let verified=true,refreshToken;
  const context={selection,env:{},secrets:[],store,request:async req=>{
    if(req.path==='/api/identity/config')return{payload:{mode:'unified',ready:true,service:'workspace',issuer,audience:'ziwei-workspace-api'}};
    if(req.path.endsWith('/.well-known/openid-configuration'))return{payload:{issuer,token_endpoint:issuer+'/token',revocation_endpoint:issuer+'/revoke'}};
    if(req.path===issuer+'/token'){
      assert.equal(req.form.grant_type,'client_credentials');assert.equal(req.form.scope,'workspace:read workspace:write');
      return{payload:{access_token:'synthetic-machine-access',token_type:'Bearer',expires_in:300,scope:'workspace:read',...(refreshToken?{refresh_token:refreshToken}:{})}};
    }
    if(req.path==='/api/identity/me')return{payload:{verified,verification:'server',identity:{issuer,subject:'machine-sub'},user:{id:'original-owner'},memberships:[{slug:'original'}],scopes:['workspace:read']}};
    if(req.path===issuer+'/revoke'){revoked.push(req.form.token);return{payload:{}};}
    assert.fail('unexpected synthetic request');
  }};
  const options={workspace:'original','worker-file':path.join(root,'synthetic-worker.json')};
  const result=await machineLogin(context,options,()=>credential);
  const saved=await store.load(selection);
  assert.equal(saved.clientId,credential.clientId);assert.equal(saved.identity.subject,'machine-sub');assert.equal(saved.refreshToken,null);
  assert.equal(JSON.stringify(saved).includes(credential.clientSecret),false);assert.equal(result.serverVerified,true);assert.equal(result.automaticRefresh,false);
  assert.equal(JSON.stringify(result).includes('synthetic-machine-access'),false);

  context.selection={...selection,account:'denied'};verified=false;
  await assert.rejects(machineLogin(context,options,()=>credential),error=>error.code==='UNAUTHENTICATED');
  assert.equal(await store.load(context.selection),null);

  context.selection={...selection,account:'bad-refresh'};verified=true;refreshToken='synthetic-machine-refresh';
  await assert.rejects(machineLogin(context,options,()=>credential),error=>error.code==='UNAUTHENTICATED');
  assert.equal(await store.load(context.selection),null);assert.equal(revoked.length,2);
  assert.ok(revoked.every(token=>token==='synthetic-machine-access'));
});
