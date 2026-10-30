import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {IncomingMessage,ServerResponse} from 'node:http';
import {createApp} from './app.mjs';
import {fixture as identityFixture,token} from './identity/fixtures.mjs';
import {DSH_NATIVE_FEATURE} from '../src/dsh-native-contract.mjs';
import {sealBrowserAnswer} from '../frontend/src/bot-interaction.js';
import {openSecret} from '../src/bot-secret-crypto.mjs';

function handle(app,url,{method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const text=body?JSON.stringify(body):null,req=new IncomingMessage(new PassThrough());if(text)req.push(text);req.push(null);req.complete=true;
  Object.assign(req,{method,url,headers:{host:'dsh-native.test',...(text?{'content-type':'application/json','content-length':Buffer.byteLength(text)}:{}),...headers}});
  const res=new ServerResponse(req);res.end=function(chunk){const text=chunk?Buffer.from(chunk).toString('utf8'):'';let body;try{body=JSON.parse(text);}catch{body=text;}resolve({status:this.statusCode,body});return this;};
  app.handle(req,res,error=>{if(error)return reject(error);res.statusCode=404;res.end('{}');});
 });
}
test('actual native HTTP routes preserve human/device identity through encrypted prepare, answer and claim',async t=>{
 const identity=await identityFixture();t.after(()=>identity.db.close());
 const app=createApp({memory:true,enableScheduler:false,identityOptions:{env:identity.env,fetch:identity.fetch}}),repo=app.locals.repo;t.after(()=>repo.db.close());
 const account=app.locals.auth.setup({email:'native-http@fixture.invalid',password:'fixture-native-password'}),{workspace}=app.locals.auth.createWorkspace(account.user_id,{name:'Native HTTP',slug:'native-http',kind:'team'});
 app.locals.identity.bindings.bind({issuer:identity.env.ZIWEI_IDENTITY_ISSUER,subject:'person',nativeUserId:account.user_id,workspaceIds:[workspace.id]});
 const person=token(),headers={authorization:'Bearer '+person.raw};identity.setCurrent({active:true,...person.payload,client_id:person.payload.azp});
 const pair=repo.claimDevicePairing({code:repo.createDevicePairing(workspace.slug,{createdBy:account.user_id,name:'HTTP device'}).code});
 repo.heartbeatDevice(workspace.slug,{deviceId:pair.deviceId,runtimeDiscovery:{features:[DSH_NATIVE_FEATURE]},runtimes:{DSH:{status:'available',profiles:[{name:'http-bot'}]}}});
 const employee=repo.createEmployee(workspace.slug,{name:'HTTP DSH',runtime:'DSH',runtimeProfile:'http-bot',targetDeviceId:pair.deviceId,ownerUserId:account.user_id});
 const base=`/api/workspaces/${workspace.slug}/employees/${employee.id}/dsh/native`,state=await handle(app,base+'/state',{headers});assert.equal(state.status,200);assert.equal(state.body.subject.profile,'http-bot');
 assert.equal((await handle(app,base+'/capabilities',{headers})).body.clientReported,true);
 const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const deviceHeaders={'x-ziwei-device-token':pair.deviceToken};
 const register=await handle(app,`/api/workspaces/${workspace.slug}/bot-provider-credentials/device/register`,{method:'POST',headers:deviceHeaders,body:{publicKey:keys.publicKey}});
 assert.equal(register.status,200,JSON.stringify(register.body));
 const prepared=await handle(app,base+'/secure-requests',{method:'POST',headers,body:{resource:'credentials',operation:'set',input:{ref:'HTTP_NATIVE_KEY'},expectedSubjectHash:state.body.subjectHash,idempotencyKey:'http-secret'}});
 assert.equal(prepared.status,202,JSON.stringify(prepared.body));const request=prepared.body;
 const envelope=await sealBrowserAnswer(request.devicePublicKey,request.binding,{value:'synthetic-http-secret'});
 assert.equal((await handle(app,`${base}/secure-requests/${request.requestId}/answer`,{method:'POST',headers,body:{envelope}})).status,200);
 const claimUrl=`/a2a/v1/actions/${request.action.id}/dsh-native/secrets/${request.requestId}/claim`;
 assert.equal((await handle(app,claimUrl,{method:'POST'})).status,401);
 const ack=await handle(app,`/a2a/v1/actions/${request.action.id}/ack`,{method:'POST',headers:deviceHeaders,body:{}});assert.equal(ack.status,200,JSON.stringify(ack.body));
 const claimed=await handle(app,claimUrl,{method:'POST',headers:deviceHeaders,body:{}});assert.equal(claimed.status,200,JSON.stringify(claimed.body));assert.equal(claimed.body.state,'claimed');
 assert.equal(JSON.parse(openSecret(keys.privateKey,claimed.body.binding,claimed.body.envelope)).value,'synthetic-http-secret');
 const publicAction=await handle(app,`/api/workspaces/${workspace.slug}/actions/${request.action.id}`,{headers});assert.equal(publicAction.status,200);assert.doesNotMatch(JSON.stringify(publicAction.body),/synthetic-http-secret|ciphertext|wrappedKey/);
 identity.setCurrent({active:true,...person.payload,client_id:person.payload.azp,resource_access:{'ziwei-workspace-api':{roles:['access','read']}}});
 assert.equal((await handle(app,base+'/refresh',{method:'POST',headers,body:{resources:['bot']}})).status,403);
});
