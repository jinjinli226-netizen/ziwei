import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,token} from './fixtures.mjs';
test('Control bridge requires real unified owner, current admin/scope and trusted local original request; no identity header grant',async()=>{
 const {authorizeControlBridge}=await import('./control-bridge.mjs'),f=await fixture(),t=token();f.setCurrent({active:true,...t.payload,client_id:t.payload.azp});
 const req={socket:{remoteAddress:'127.0.0.1'},headers:{authorization:`Bearer ${t.raw}`,origin:'https://ziwei.test','x-original-uri':'/api/android-devices','x-original-method':'GET'}};
 const run=(request=req,owner='u1')=>authorizeControlBridge(request,f.identity,{ownerUserId:owner});
 try{
  assert.equal((await run()).authenticated,true);
  await assert.rejects(()=>run({...req,headers:{...req.headers,authorization:undefined,'x-ziwei-user':'u1'}}));
  await assert.rejects(()=>run({...req,socket:{remoteAddress:'203.0.113.1'}}));
  await assert.rejects(()=>run(req,'other-owner'));
  f.setCurrent({active:true,...t.payload,client_id:t.payload.azp,resource_access:{'ziwei-workspace-api':{roles:['access','read']}}});await assert.rejects(()=>run());
  f.setCurrent({active:true,...t.payload,client_id:t.payload.azp});await assert.rejects(()=>run({...req,headers:{...req.headers,'x-original-method':'POST',origin:'https://evil.test'}}));
  f.setCurrent({active:false});await assert.rejects(()=>run());
 }finally{f.db.close();}
});
test('Control actual employee management declarations use method-exact bridge and keep core employee/machine routes outside it',async()=>{
 const {authorizeControlBridge}=await import('./control-bridge.mjs'),f=await fixture(),t=token();f.setCurrent({active:true,...t.payload,client_id:t.payload.azp});
 const req=(method,uri)=>({socket:{remoteAddress:'127.0.0.1'},headers:{authorization:`Bearer ${t.raw}`,origin:f.env.ZIWEI_IDENTITY_ORIGIN,'x-original-uri':uri,'x-original-method':method}});
 const run=(m,u)=>authorizeControlBridge(req(m,u),f.identity,{ownerUserId:'u1'});
 try{
  for(const[m,u]of [['POST','/api/employees'],['GET','/api/employee-access'],['POST','/api/employees/original/access'],['POST','/api/employees/original/access/revoke'],['POST','/api/employees/original/control']])assert.equal((await run(m,u)).authenticated,true);
  for(const[m,u]of [['GET','/api/employees'],['PATCH','/api/employees/original'],['DELETE','/api/employees/original'],['POST','/api/employees/original/environment'],['POST','/api/employee/sessions'],['POST','/api/device/v1/heartbeat']])await assert.rejects(()=>run(m,u),e=>e.status===403);
 }finally{f.db.close();}
});
