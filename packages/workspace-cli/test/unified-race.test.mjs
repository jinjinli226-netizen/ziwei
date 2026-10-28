import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {CredentialStore} from '../src/config.mjs';
import {runCli} from '../src/main.mjs';
const mainUrl=new URL('../src/main.mjs',import.meta.url).href;
const origin='https://workspace.example.test',issuer='https://identity.example.test/realms/ziwei';
const selection={origin,profile:'default',account:'default',purpose:'person'};
async function waitForFile(file){const deadline=Date.now()+5000;while(Date.now()<deadline){try{await fs.access(file);return;}catch{}await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Isolated refresh did not reach its synthetic exchange barrier');}
test('cross-process refresh returns rotated grant after logout, cannot restore store and requests token cleanup',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-unified-race-'));
  const ready=path.join(root,'synthetic-ready'),release=path.join(root,'synthetic-release');
  let finished;
  try{
    const store=new CredentialStore(root);
    await store.save(selection,{mode:'unified',identitySource:'unified-oidc-device',issuer,clientId:'ziwei-workspace-cli',audience:'ziwei-workspace-api',apiBase:origin,workspace:'team',accessToken:'synthetic-old-access',refreshToken:'synthetic-old-refresh',expiresAt:new Date(Date.now()+300000).toISOString(),scopes:['openid','workspace:read'],identity:{issuer,subject:'synthetic-subject'}});
    const code=`
      import fs from 'node:fs/promises';import {runCli} from ${JSON.stringify(mainUrl)};
      const origin=${JSON.stringify(origin)},issuer=${JSON.stringify(issuer)},revoked=[];
      const result=await runCli(['auth','refresh','--api',origin],{env:{ZIWEI_WORKSPACE_CONFIG_DIR:${JSON.stringify(root)}},stdout:()=>{},stderr:()=>{},fetchImpl:async(url,init)=>{
        const target=String(url);
        if(target===origin+'/api/identity/config')return Response.json({service:'workspace',mode:'unified',issuer,cliClientId:'ziwei-workspace-cli',audience:'ziwei-workspace-api',scopes:['openid','workspace:read','workspace:write'],cliTransports:['native','mcp'],ready:true,legacyAllowed:false});
        if(target===issuer+'/.well-known/openid-configuration')return Response.json({issuer,device_authorization_endpoint:issuer+'/device',token_endpoint:issuer+'/token',revocation_endpoint:issuer+'/revoke'});
        if(target===issuer+'/token'){
          await fs.writeFile(${JSON.stringify(ready)},'ready');
          while(true){try{await fs.access(${JSON.stringify(release)});break;}catch{}await new Promise(resolve=>setTimeout(resolve,5));}
          return Response.json({access_token:'synthetic-late-access',refresh_token:'synthetic-late-refresh',token_type:'Bearer',expires_in:300,scope:'openid workspace:read'});
        }
        if(target===origin+'/api/identity/me')return Response.json({verified:true,verification:'server',identity:{issuer,subject:'synthetic-subject'},user:{id:'synthetic-user'},memberships:[{slug:'team'}],scopes:['workspace:read']});
        if(target===issuer+'/revoke'){const body=new URLSearchParams(init.body);revoked.push({hint:body.get('token_type_hint'),syntheticMatch:['synthetic-late-access','synthetic-late-refresh'].includes(body.get('token')),client:body.get('client_id')});return new Response('');}
        throw Error('Unexpected synthetic request');
      }});
      process.stdout.write(JSON.stringify({exitCode:result.exitCode,envelope:result.envelope,revoked}));
    `;
    const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot||''},windowsHide:true});
    let output='',stderr='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>stderr+=value);
    finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',exit=>exit===0?resolve():reject(new Error(`Synthetic refresh worker failed (${exit}): ${stderr}`)));});
    await waitForFile(ready);
    let stdout='';const result=await runCli(['auth','logout','--api',origin,'--local'],{env:{ZIWEI_WORKSPACE_CONFIG_DIR:root},stdout:value=>stdout+=value,fetchImpl:async()=>assert.fail('local logout must not fetch')});
    assert.equal(result.exitCode,0,stdout);assert.equal(await store.load(selection),null);
    await fs.writeFile(release,'release');await finished;
    const observed=JSON.parse(output);assert.equal(observed.exitCode,6,output);assert.equal(observed.envelope.error.details.localSessionRestored,false);assert.equal(observed.envelope.error.details.lateRevocation.remoteRevocation,'accepted');
    assert.deepEqual(observed.revoked,[{hint:'refresh_token',syntheticMatch:true,client:'ziwei-workspace-cli'},{hint:'access_token',syntheticMatch:true,client:'ziwei-workspace-cli'}]);
    assert.equal(await store.load(selection),null);
    for(const secret of ['synthetic-old-access','synthetic-old-refresh','synthetic-late-access','synthetic-late-refresh'])assert.ok(!output.includes(secret));
  }finally{
    await fs.writeFile(release,'release').catch(()=>{});if(finished)await finished.catch(()=>{});
    await fs.rm(root,{recursive:true,force:true});
  }
});
