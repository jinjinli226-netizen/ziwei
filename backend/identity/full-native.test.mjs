import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,authorize,token} from './fixtures.mjs';
test('unified owner may create a workspace and access notification transports; member cannot create',async()=>{
 const f=await fixture();try{
  await authorize(f,token(),'/api/workspaces','POST');
  for(const path of ['/api/workspaces/one/notifications/stream','/api/workspaces/one/notifications/ws'])await authorize(f,token(),path,'GET');
  f.db.exec("UPDATE members SET role='member'");await assert.rejects(()=>authorize(f,token(),'/api/workspaces','POST'),e=>e.status===403);
 }finally{f.db.close();}
});
