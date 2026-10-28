import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,token,aud} from './fixtures.mjs';
import {authorizeControlBridge} from './control-bridge.mjs';

const request=(f,raw,method)=>({socket:{remoteAddress:'127.0.0.1'},headers:{authorization:`Bearer ${raw}`,origin:f.env.ZIWEI_IDENTITY_ORIGIN,'x-original-method':method,'x-original-uri':'/api/android-devices'}});
test('Control exact access/admin-only roles are denied for both read and write despite both scopes',async()=>{
 const f=await fixture(),t=token({resource_access:{[aud]:{roles:['access','admin']}}});
 f.setCurrent({active:true,...t.payload,client_id:t.payload.azp});
 try{for(const method of ['GET','POST'])await assert.rejects(()=>authorizeControlBridge(request(f,t.raw,method),f.identity,{ownerUserId:'u1'}),e=>e.status===403);}finally{f.db.close();}
});
test('Control write denies an OP-revoked write role even when admin read and both scope strings remain',async()=>{
 const f=await fixture(),t=token();f.setCurrent({active:true,...t.payload,client_id:t.payload.azp,resource_access:{[aud]:{roles:['access','read','admin']}}});
 try{assert.equal((await authorizeControlBridge(request(f,t.raw,'GET'),f.identity,{ownerUserId:'u1'})).authenticated,true);await assert.rejects(()=>authorizeControlBridge(request(f,t.raw,'POST'),f.identity,{ownerUserId:'u1'}),e=>e.status===403);}finally{f.db.close();}
});
test('Control write denies an issued token without write role even when both scopes and native owner remain',async()=>{
 const f=await fixture(),t=token({resource_access:{[aud]:{roles:['access','read','admin']}}});f.setCurrent({active:true,...t.payload,client_id:t.payload.azp});
 try{await assert.rejects(()=>authorizeControlBridge(request(f,t.raw,'POST'),f.identity,{ownerUserId:'u1'}),e=>e.status===403);}finally{f.db.close();}
});
test('Control retains the original metadata-read prerequisite for write-only principals',async()=>{
 const f=await fixture(),t=token({scope:'openid workspace:write',resource_access:{[aud]:{roles:['access','write','admin']}}});f.setCurrent({active:true,...t.payload,client_id:t.payload.azp});
 try{await assert.rejects(()=>authorizeControlBridge(request(f,t.raw,'POST'),f.identity,{ownerUserId:'u1'}),e=>e.status===403);await assert.rejects(()=>authorizeControlBridge(request(f,t.raw,'GET'),f.identity,{ownerUserId:'u1'}),e=>e.status===403);}finally{f.db.close();}
});
