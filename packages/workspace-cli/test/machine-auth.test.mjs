import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
test('registered machine credentials obtain a site token and require server native binding before saving',async()=>{
  const {machineLogin}=await import('../src/machine.mjs');let saved=null;
  const context={selection:{origin:'https://workspace.test',purpose:'employee'},env:{},secrets:[],store:{snapshot:async()=>({version:null,credential:null}),compareAndSwap:async(_s,_v,c)=>{saved=c;return {credential:c};}},request:async req=>{
    if(req.path==='/api/identity/config')return {payload:{mode:'unified',ready:true,service:'workspace',issuer:'https://op.test/realms/ziwei',audience:'ziwei-workspace-api'}};
    if(req.path.endsWith('/.well-known/openid-configuration'))return {payload:{issuer:'https://op.test/realms/ziwei',token_endpoint:'https://op.test/realms/ziwei/token',revocation_endpoint:'https://op.test/realms/ziwei/revoke'}};
    if(req.path.endsWith('/token'))return {payload:{access_token:'signed-test-token',token_type:'Bearer',expires_in:300,scope:'workspace:read'}};
    if(req.path==='/api/identity/me')return {payload:{verified:true,verification:'server',identity:{issuer:'https://op.test/realms/ziwei',subject:'machine-sub'},user:{id:'original-owner'},memberships:[{slug:'original'}],scopes:['workspace:read']}};
    throw Error('unexpected request');
  }};
  const credential={issuer:'https://op.test/realms/ziwei',origin:'https://workspace.test',clientId:'ziwei-workspace-worker-one',subject:'machine-sub',clientSecret:'private-secret'};
  const result=await machineLogin(context,{workspace:'original','worker-file':'/protected/worker.json'},()=>credential);
  assert.equal(saved.clientId,credential.clientId);assert.equal(saved.identity.subject,'machine-sub');assert.equal(JSON.stringify(saved).includes('private-secret'),false);assert.equal(result.serverVerified,true);
  context.request=async req=>req.path==='/api/identity/me'?{payload:{verified:false}}:req.path==='/api/identity/config'?{payload:{mode:'unified',ready:true,service:'workspace',issuer:credential.issuer,audience:'ziwei-workspace-api'}}:req.path.endsWith('configuration')?{payload:{issuer:credential.issuer,token_endpoint:credential.issuer+'/token',revocation_endpoint:credential.issuer+'/revoke'}}:{payload:{access_token:'other-token',token_type:'Bearer',expires_in:300}};
  context.store.snapshot=async()=>({version:null,credential:null});saved=null;await assert.rejects(()=>machineLogin(context,{workspace:'original','worker-file':'/protected/worker.json'},()=>credential));assert.equal(saved,null);
});
