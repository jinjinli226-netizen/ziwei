import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runCli} from '../src/main.mjs';
import {CredentialStore} from '../src/config.mjs';

test('long-lived login opts into offline_access while preserving workspace scopes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-long-lived-'));
  const origin='https://workspace.example.test',issuer='https://identity.example.test/realms/ziwei';
  const scopes=['openid','workspace:read','workspace:write'];
  let stdout='',requested;
  try{
    const result=await runCli(['auth','login','--long-lived','--workspace','team','--api',origin],{
      env:{ZIWEI_WORKSPACE_CONFIG_DIR:root},stdout:value=>stdout+=value,stderr:()=>{},
      fetchImpl:async(url,init)=>{
        if(String(url)===origin+'/api/identity/config')return Response.json({mode:'unified',service:'workspace',ready:true,issuer,cliClientId:'ziwei-workspace-cli',audience:'ziwei-workspace-api',scopes,cliTransports:['native']});
        if(String(url)===issuer+'/.well-known/openid-configuration')return Response.json({issuer,device_authorization_endpoint:issuer+'/device',token_endpoint:issuer+'/token'});
        assert.equal(String(url),issuer+'/device');
        requested=new URLSearchParams(init.body).get('scope');
        return Response.json({device_code:'synthetic-private-device-code',user_code:'PUBLIC',verification_uri:issuer+'/verify',expires_in:300});
      }
    });
    assert.equal(result.exitCode,0,stdout);
    assert.equal(requested,scopes.join(' ')+' offline_access');
    const saved=await new CredentialStore(root).load({origin,profile:'default',account:'default',purpose:'person'});
    assert.equal(saved.loginMode,'long-lived');
    assert.equal(stdout.includes('synthetic-private-device-code'),false);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('long-lived CLI flag requires a human unified login before reading credentials or dispatching',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-long-lived-boundary-'));
  try{
    for(const args of [
      ['auth','login','--purpose','employee'],
      ['auth','login','--mode','machine','--purpose','employee','--worker-file',path.join(root,'absent-worker.json')],
      ['auth','login','--mode','native'],
      ['auth','login','--mode','managed','--purpose','employee'],
      ['auth','status']
    ]){
      let stdout='';
      const result=await runCli([...args,'--long-lived','--workspace','team','--api','https://workspace.example.test'],{
        env:{ZIWEI_WORKSPACE_CONFIG_DIR:root},stdout:value=>stdout+=value,stderr:()=>{},
        readStdin:async()=>assert.fail('invalid long-lived mode must not read secret input'),
        fetchImpl:async()=>assert.fail('invalid long-lived mode must not dispatch')
      });
      assert.equal(result.exitCode,2,stdout);
    }
    await assert.rejects(fs.access(path.join(root,'credentials.json')),error=>error.code==='ENOENT');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
