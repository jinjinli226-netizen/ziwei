import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {timingSafeEqual} from 'node:crypto';

const source=fs.readFileSync(new URL('../daemon/ziwei_user.mjs',import.meta.url),'utf8');
const from=source.indexOf('const health = http.createServer('),to=source.indexOf('\nlet stopping = false;',from);
assert(from>=0&&to>from);
const routeSource=source.slice(from,to);

function fixture({retry=async()=>({state:'confirmed',status:'succeeded',secret:'PRIVATE_RETURN'}),token='PRIVATE_CONTROL'}={}){
  const calls=[];
  const connection={config:{workspace:'selected-workspace',deviceId:'selected-device'},actionDelivery:{retryArchivedResult:async actionId=>{calls.push(actionId);return retry(actionId);}}};
  let handler;
  const config={deviceToken:token};
  const context=vm.createContext({Buffer,Map,timingSafeEqual,config,lifecycleNonce:'PRIVATE_NONCE',connections:new Map([['selected-workspace',connection]]),privateIdentityRoute:()=>false,http:{createServer:callback=>{handler=callback;return{};}}});
  vm.runInContext(routeSource,context);
  function request({method='POST',address='127.0.0.1',supplied='PRIVATE_CONTROL',body={nonce:'PRIVATE_NONCE',workspace:'selected-workspace',actionId:'action_fixture'},raw}={}){
    const req=new EventEmitter();
    Object.assign(req,{url:'/local/delivery-retry',method,headers:{'x-ziwei-local-control':supplied},socket:{remoteAddress:address},destroy(){this.destroyed=true;}});
    let resolve;
    const promise=new Promise(done=>{resolve=done;});
    const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(value){this.body=value?JSON.parse(value):null;resolve(this);}};
    handler(req,response);req.emit('data',raw??JSON.stringify(body));req.emit('end');
    return promise;
  }
  return{calls,request,connection};
}

test('local receipt retry routes one explicit action to its selected connection without execution',async()=>{
  const f=fixture(),response=await f.request();
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(response.body,{actionId:'action_fixture',state:'confirmed',status:'succeeded'});
  assert.deepEqual(f.calls,['action_fixture']);
  assert.doesNotMatch(JSON.stringify(response.body),/PRIVATE|secret/);
});

test('local receipt retry authenticates loopback POST, primary control token and current boot',async()=>{
  for(const options of [{method:'GET'},{address:'192.0.2.1'},{supplied:'WRONG_TOKEN'},{supplied:''}]){
    const f=fixture(),response=await f.request(options);assert.equal(response.status,401);assert.deepEqual(f.calls,[]);
  }
  const missingToken=fixture({token:''});assert.equal((await missingToken.request()).status,401);assert.deepEqual(missingToken.calls,[]);
  const stale=fixture(),response=await stale.request({body:{nonce:'OLD_NONCE',workspace:'selected-workspace',actionId:'action_fixture'}});
  assert.equal(response.status,409);assert.equal(response.body.error,'CLIENT_CONTROL_IDENTITY_CHANGED');assert.deepEqual(stale.calls,[]);
});

test('local receipt retry rejects malformed input and never falls back to another workspace',async()=>{
  const invalid=[{nonce:'PRIVATE_NONCE',workspace:'foreign-workspace',actionId:'action_fixture'},
    {nonce:'PRIVATE_NONCE',workspace:'selected-workspace',actionId:'../action_fixture'},
    {nonce:'PRIVATE_NONCE',workspace:'selected-workspace',actionId:['action_fixture']},
    {nonce:'PRIVATE_NONCE',workspace:'selected-workspace',actionId:'action_fixture',dispatch:true}];
  for(const body of invalid){const f=fixture(),response=await f.request({body});assert.equal(response.status,400);assert.deepEqual(f.calls,[]);}
  const broken=fixture();assert.equal((await broken.request({raw:'{'})).status,400);assert.deepEqual(broken.calls,[]);
});

test('local receipt retry preserves only bounded HTTP and code diagnostics from rejected delivery',async()=>{
  const f=fixture({retry:async()=>{throw Object.assign(Error('PRIVATE_PROMPT PRIVATE_TOKEN'),{status:413,code:'PRIVATE_SECRET',body:'PRIVATE_BASE64'});}});
  const response=await f.request();
  assert.equal(response.status,413);assert.equal(response.body.error,'DELIVERY_RETRY_FAILED');assert.equal(response.body.httpStatus,413);
  assert.doesNotMatch(JSON.stringify(response.body),/PRIVATE|body|message|token/i);
  assert.deepEqual(f.calls,['action_fixture']);
});

test('local receipt retry exposes a finite original refusal code without its private error context',async()=>{
  const f=fixture({retry:async()=>{throw Object.assign(Error('PRIVATE_PATH'),{status:409,code:'DELIVERY_RETRY_INCOMPLETE',body:'PRIVATE_RESULT'});}});
  const response=await f.request();
  assert.equal(response.status,409);assert.deepEqual(response.body,{error:'DELIVERY_RETRY_INCOMPLETE',httpStatus:409});
});
