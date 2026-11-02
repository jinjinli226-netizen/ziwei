import fs from 'node:fs/promises';
import path from 'node:path';
import {CredentialStore} from '../src/config.mjs';
import {ensureUnifiedCredential} from '../src/unified.mjs';
const root=process.argv[2],issuer='https://auth.example/realms/ziwei';
const selection={origin:'https://workspace.example',profile:'test',account:'test',purpose:'person'};
const context={store:new CredentialStore(root,{lockTimeoutMs:5000}),selection,env:{},secrets:[],request:async init=>{
 if(init.path==='/api/identity/config')return{payload:{service:'workspace',mode:'unified',ready:true,issuer,cliClientId:'ziwei-workspace-cli',audience:'ziwei-workspace-api',scopes:['openid','workspace:read','workspace:write'],cliTransports:['native']}};
 if(init.path.endsWith('/.well-known/openid-configuration'))return{payload:{issuer,device_authorization_endpoint:issuer+'/device',token_endpoint:issuer+'/token'}};
 if(init.path===issuer+'/token'){
  await fs.appendFile(path.join(root,'test-exchange-count.txt'),'exchange\n');await new Promise(resolve=>setTimeout(resolve,150));
  return{ok:true,status:200,payload:{access_token:'process-access',refresh_token:'process-refresh',token_type:'Bearer',expires_in:300,refresh_expires_in:604800,scope:'openid workspace:read workspace:write'}};
 }
 return{payload:{verified:true,verification:'server',identity:{issuer,subject:'test-subject'},user:{id:'native-user'},memberships:[{slug:'bigtron'}],scopes:['openid','workspace:read','workspace:write']}};
}};
await ensureUnifiedCredential(context);
process.stdout.write('completed\n');
