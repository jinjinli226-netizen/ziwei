import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createTpnsSender,tpnsSignature} from './mobile-push-tpns.mjs';
const env={ZIWEI_TPNS_ENABLED:'1',ZIWEI_TPNS_ACCESS_ID:'1500001048',ZIWEI_TPNS_ACCESS_KEY:'client-public',ZIWEI_TPNS_SECRET_KEY:'server-fixture-secret',ZIWEI_TPNS_REGION:'guangzhou'};
// Official Android callback sample, 40 chars, is routing data rather than FCM.
const input={token:'6ed8af8d7b18049d9fed116a9db9c71ab44d5565',deliveryId:'abcdefghijklmnopqrstuvwx12345678'};

test('TPNS hexadecimal-then-Base64 HMAC matches independent RFC4231 digest',()=>{
  const rfc='5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
  assert.equal(tpnsSignature('Jefe','','','what do ya want for nothing?'),Buffer.from(rfc).toString('base64'));
});
test('real sender signs exact UTF8 request bytes, sends a single generic token notification and opaque Intent',async()=>{
  const sender=createTpnsSender({env,now:()=>1565314789000,fetch:async(url,request)=>{
    assert.equal(url,'https://api.tpns.tencent.com/v3/push/app');assert.equal(request.method,'POST');assert.equal(request.redirect,'error');assert.equal(request.headers.TimeStamp,'1565314789');
    const hex=crypto.createHmac('sha256',env.ZIWEI_TPNS_SECRET_KEY).update('1565314789'+env.ZIWEI_TPNS_ACCESS_ID+request.body).digest('hex');assert.equal(request.headers.Sign,Buffer.from(hex).toString('base64'));
    const body=JSON.parse(request.body);assert.deepEqual(body.token_list,[input.token]);assert.equal(body.audience_type,'token');assert.equal(body.message_type,'notify');assert.deepEqual(JSON.parse(body.message.android.custom_content),{deliveryId:input.deliveryId});assert.equal(body.message.android.action.intent,`ziwei-manager://push?deliveryId=${input.deliveryId}`);assert(!request.body.includes('employeeId'));assert(!request.body.includes('target'));assert(!request.body.includes(env.ZIWEI_TPNS_SECRET_KEY));
    return new Response(JSON.stringify({ret_code:0,push_id:'provider-receipt-id'}),{status:200});
  }});
  assert.deepEqual(await sender.send(input),{accepted:true,providerId:'provider-receipt-id'});assert(!JSON.stringify(sender.status()).includes(env.ZIWEI_TPNS_SECRET_KEY));
});
test('missing or arbitrary endpoint configuration never sends and never exposes credentials',async()=>{
  let called=false;const sender=createTpnsSender({env:{...env,ZIWEI_TPNS_REGION:'https://attacker.test'},fetch:async()=>{called=true;}});assert.equal(sender.status().configured,false);assert.equal(sender.status().accessKey,null);await assert.rejects(sender.send(input),{code:'PUSH_NOT_CONFIGURED'});assert.equal(called,false);
});
test('ambiguous HTTP, bad JSON and over-limit outcomes are redacted and never blindly retried',async()=>{
  for(const response of [new Response('SECRET_ERROR',{status:503}),new Response('{broken',{status:200}),new Response('unverified gateway',{status:429}),new Response('x'.repeat(17000),{status:200})]){
    const sender=createTpnsSender({env,fetch:async()=>response});await assert.rejects(sender.send(input),error=>{assert.match(error.code,/^PUSH_PROVIDER_/);assert(!error.message.includes('SECRET_ERROR'));assert.equal(error.retryable,false);assert.equal(error.unknownOutcome,true);return true;});
  }
});
test('sender timeout aborts the transport and preserves an unknown non-retryable outcome',async()=>{
  const sender=createTpnsSender({env,timeoutMs:5,fetch:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('secret underlying transport'))))});await assert.rejects(sender.send(input),{code:'PUSH_PROVIDER_UNAVAILABLE',retryable:false,unknownOutcome:true});
});
test('only an explicit provider throttle rejection is retryable; other definitive rejections fail',async()=>{
  for(const code of [1008028,10001]){const sender=createTpnsSender({env,fetch:async()=>new Response(JSON.stringify({ret_code:code,err_msg:'SECRET_ERROR'}))});await assert.rejects(sender.send(input),error=>{assert.equal(error.code,'PUSH_PROVIDER_REJECTED');assert.equal(error.retryable,code===1008028);assert.equal(error.unknownOutcome,undefined);assert(!error.message.includes('SECRET_ERROR'));return true;});}
});
test('only an explicit filtered token is marked invalid; no arbitrary error message can revoke a device',async()=>{
  const sender=createTpnsSender({env,fetch:async()=>new Response(JSON.stringify({ret_code:0,push_id:'filtered',invalid_targe_list:[input.token]}))});await assert.rejects(sender.send(input),{code:'PUSH_TOKEN_INVALID',invalidToken:true,retryable:false});
});
