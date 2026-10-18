import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createRepository} from './repository.mjs';
import {createAuthService} from './auth.mjs';
import {createDeviceUpdateService,OFFICIAL_CLIENT_SOURCE,REMOTE_UPDATE_FEATURE} from './device-updates.mjs';
import {createApp} from './app.mjs';

const OLD='1'.repeat(64),TARGET='2'.repeat(64),SHA='3'.repeat(64),HOST='4'.repeat(64);
function fixture(t){
 const repo=createRepository({memory:true}),db=repo.db,auth=createAuthService(db),owner=auth.setup({email:'updates@fixture.invalid',password:'fixture-updates-password'});
 const ws=auth.createWorkspace(owner.user_id,{slug:'update-fixture',name:'Updates',kind:'team'});
 const slug='update-fixture',pair=repo.claimDevicePairing({code:repo.createDevicePairing(slug,{name:'Windows fixture'}).code});
 const metadata={url:OFFICIAL_CLIENT_SOURCE,clientBuild:TARGET,sha256:SHA,version:'0.1.0'};
 const heartbeat=(input={})=>repo.heartbeatDevice(slug,{deviceId:pair.deviceId,name:'Windows fixture',os:'Windows',pid:1001,clientBuild:OLD,runtimeDiscovery:{features:[REMOTE_UPDATE_FEATURE],maintenanceHostId:HOST},...input});
 heartbeat();let clock=Date.now();const service=createDeviceUpdateService(repo,{now:()=>clock,readRelease:async()=>metadata}),context={actorUserId:owner.user_id};
 t.after(()=>db.close());
 const credential=()=>repo.authenticateDeviceToken(pair.deviceToken),input={idempotencyKey:'fixture-update-0001',waitForIdle:true};
 const create=()=>service.create(slug,pair.deviceId,input,context);
 return{repo,db,auth,owner,ws,slug,pair,metadata,service,context,heartbeat,credential,input,create,advance:n=>clock+=n};
}
const bodyFor=(state,token,extra={})=>({state,hostId:HOST,clientBuild:OLD,claimToken:token,...extra});
function claim(f,id){return f.service.claim(f.slug,f.pair.deviceId,id,{hostId:HOST,clientBuild:OLD,pid:1001},f.credential());}
function progress(f,id,token,state,extra={}){return f.service.progress(f.slug,f.pair.deviceId,id,bodyFor(state,token,extra),f.credential());}

test('only actual workspace admin can request; unknown commands, URLs, force and mutable targets are rejected',async t=>{
 const f=fixture(t),member=f.auth.register({email:'member@fixture.invalid',password:'fixture-member-password',name:'Member'});
 f.db.prepare('INSERT INTO members(id,workspace_id,user_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('fixture-member',f.repo.getWorkspace(f.slug).id,member.user_id,'Member','member@fixture.invalid','member',new Date().toISOString());
 await assert.rejects(f.service.create(f.slug,f.pair.deviceId,f.input,{actorUserId:member.user_id,actorRole:'owner'}),{code:'CLIENT_UPDATE_FORBIDDEN'});
 await assert.rejects(f.service.create(f.slug,f.pair.deviceId,f.input,{actorUserId:f.owner.user_id,deviceScope:f.pair.deviceId}),{code:'CLIENT_UPDATE_FORBIDDEN'});
 for(const extra of [{source:'https://evil.invalid/update.tgz'},{targetBuild:OLD},{command:'taskkill'},{force:true}])await assert.rejects(f.service.create(f.slug,f.pair.deviceId,{...f.input,...extra},f.context),{code:'CLIENT_UPDATE_INPUT_INVALID'});
 assert.equal(f.db.prepare('SELECT count(*) n FROM device_updates').get().n,0);
});

test('stable idempotency survives manifest change and deduplicates every employee on one host',async t=>{
 const f=fixture(t),a=await f.create();assert.equal(a.request.state,'requested');f.metadata.clientBuild='5'.repeat(64);
 const b=await f.create();assert.equal(b.duplicate,true);assert.equal(b.request.id,a.request.id);assert.equal(b.request.targetBuild,TARGET);
 const c=await f.service.create(f.slug,f.pair.deviceId,{...f.input,idempotencyKey:'other-employee-request'},f.context);assert.equal(c.request.id,a.request.id);assert.equal(f.db.prepare('SELECT count(*) n FROM device_updates').get().n,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM a2a_actions').get().n,0,'maintenance is never an employee execution');
});

test('offline, old client and non-Windows remain explicit and never create requests',async t=>{
 const f=fixture(t);f.heartbeat({runtimeDiscovery:{features:[]}});
 await assert.rejects(f.create(),{code:'REMOTE_UPDATE_CLIENT_REQUIRED'});
 f.heartbeat({os:'Darwin'});await assert.rejects(f.create(),{code:'CLIENT_UPDATE_WINDOWS_REQUIRED'});
 f.heartbeat();f.advance(100_000);await assert.rejects(f.create(),{code:'DEVICE_OFFLINE'});
 assert.equal(f.db.prepare('SELECT count(*) n FROM device_updates').get().n,0);
});

test('same host in another workspace does not expose or claim the first workspace intent',async t=>{
 const f=fixture(t),created=await f.create();f.auth.createWorkspace(f.owner.user_id,{slug:'other-update-workspace',name:'Other',kind:'team'});
 const pair=f.repo.claimDevicePairing({code:f.repo.createDevicePairing('other-update-workspace',{name:'Shared host'}).code});
 f.repo.heartbeatDevice('other-update-workspace',{deviceId:pair.deviceId,os:'Windows',pid:1001,clientBuild:OLD,runtimeDiscovery:{features:[REMOTE_UPDATE_FEATURE],maintenanceHostId:HOST}});
 await assert.rejects(f.service.create('other-update-workspace',pair.deviceId,{...f.input,idempotencyKey:'another-workspace-request'},f.context),{code:'DEVICE_MAINTENANCE_BUSY'});
 const credential=f.repo.authenticateDeviceToken(pair.deviceToken);assert.deepEqual(f.service.pending('other-update-workspace',pair.deviceId,credential),{request:null});
 assert.throws(()=>f.service.claim(f.slug,f.pair.deviceId,created.request.id,{hostId:HOST,clientBuild:OLD,pid:1001},credential),{code:'CLIENT_UPDATE_DEVICE_CREDENTIAL_REQUIRED'});
});

test('polling stays read-only; explicit claim is exact instance, idempotent and secret never appears in admin status',async t=>{
 const f=fixture(t),a=await f.create(),before=f.db.prepare('SELECT * FROM device_updates').get();
 for(let i=0;i<3;i++)assert.equal(f.service.pending(f.slug,f.pair.deviceId,f.credential()).request.state,'requested');
 assert.deepEqual(f.db.prepare('SELECT * FROM device_updates').get(),before);
 assert.throws(()=>f.service.claim(f.slug,f.pair.deviceId,a.request.id,{hostId:HOST,clientBuild:OLD,pid:1002},f.credential()),{code:'CLIENT_UPDATE_INSTANCE_CHANGED'});
 const c=claim(f,a.request.id),d=claim(f,a.request.id);assert.equal(c.claimToken,d.claimToken);assert.equal(c.request.state,'accepted');
 assert.equal(JSON.stringify(await f.service.list(f.slug,f.context)).includes(c.claimToken),false);
 assert.throws(()=>progress(f,a.request.id,'bad-token','waiting_idle'),{code:'CLIENT_UPDATE_PROGRESS_INVALID'});
});

test('completion requires independent new-build heartbeat from new process; progress cannot forge success',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id);
 assert.throws(()=>progress(f,a.request.id,c.claimToken,'succeeded'),{code:'CLIENT_UPDATE_PROGRESS_INVALID'});
 assert.throws(()=>progress(f,a.request.id,c.claimToken,'awaiting_heartbeat'),{code:'CLIENT_UPDATE_PROGRESS_CONFLICT'});
 for(const state of ['waiting_idle','updating','awaiting_heartbeat'])progress(f,a.request.id,c.claimToken,state);
 let read=()=>f.db.prepare('SELECT state FROM device_updates WHERE id=?').get(a.request.id).state;
 f.heartbeat();assert.equal(read(),'awaiting_heartbeat');
 f.heartbeat({clientBuild:TARGET});assert.equal(read(),'awaiting_heartbeat','same original PID is not a new daemon');
 f.heartbeat({clientBuild:TARGET,pid:1002,runtimeDiscovery:{features:[REMOTE_UPDATE_FEATURE],maintenanceHostId:'9'.repeat(64)}});assert.equal(read(),'awaiting_heartbeat');
 f.heartbeat({clientBuild:TARGET,pid:1002});assert.equal(read(),'succeeded');
 const status=await f.service.get(f.slug,f.pair.deviceId,a.request.id,f.context);assert.equal(status.request.heartbeatVerified,true);
});

test('cancel while waiting releases host exclusivity and is visible to daemon; active update cannot be cancelled',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id);progress(f,a.request.id,c.claimToken,'waiting_idle');
 assert.equal(f.service.cancel(f.slug,f.pair.deviceId,a.request.id,f.context).request.state,'cancelled');
 assert.equal(f.service.pending(f.slug,f.pair.deviceId,f.credential()).request.state,'cancelled');
 const b=await f.service.create(f.slug,f.pair.deviceId,{...f.input,idempotencyKey:'fixture-next-request'},f.context),d=claim(f,b.request.id);progress(f,b.request.id,d.claimToken,'waiting_idle');progress(f,b.request.id,d.claimToken,'updating');
 assert.throws(()=>f.service.cancel(f.slug,f.pair.deviceId,b.request.id,f.context),{code:'CLIENT_UPDATE_ALREADY_STARTED'});
});

test('revoked credentials and disabled devices cannot poll or progress',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id),credential=f.credential();f.repo.revokeDeviceCredential(f.pair.deviceId);
 assert.throws(()=>f.service.pending(f.slug,f.pair.deviceId,credential),{code:'CLIENT_UPDATE_DEVICE_CREDENTIAL_REQUIRED'});
 assert.throws(()=>f.service.progress(f.slug,f.pair.deviceId,a.request.id,bodyFor('waiting_idle',c.claimToken),credential),{code:'CLIENT_UPDATE_DEVICE_CREDENTIAL_REQUIRED'});
});

test('official manifest failure is a precise state and never permits arbitrary fallback update source',async t=>{
 const f=fixture(t),service=createDeviceUpdateService(f.repo,{readRelease:async()=>({...f.metadata,url:'https://evil.invalid/latest.tgz'})});
 const list=await service.list(f.slug,f.context);assert.equal(list.release,null);assert.equal(list.releaseError,'CLIENT_UPDATE_RELEASE_INVALID');
 await assert.rejects(service.create(f.slug,f.pair.deviceId,f.input,f.context),{code:'CLIENT_UPDATE_RELEASE_INVALID'});
});

test('device instance changed during official lookup is rejected before intent persistence',async t=>{
 const f=fixture(t),service=createDeviceUpdateService(f.repo,{readRelease:async()=>{f.heartbeat({pid:1002});return f.metadata;}});
 await assert.rejects(service.create(f.slug,f.pair.deviceId,f.input,f.context),{code:'CLIENT_UPDATE_INSTANCE_CHANGED'});
 assert.equal(f.db.prepare('SELECT count(*) n FROM device_updates').get().n,0);
});

function request(app,url,{cookie='',token='',method='GET',body}={}){
 const socket=new Duplex({read(){},write(_chunk,_encoding,done){done();}}),req=new IncomingMessage(socket),res=new ServerResponse(req),chunks=[],bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
 req.method=method;req.url=url;req.headers={host:'updates.fixture',cookie,...(token?{'x-ziwei-device-token':token}:{}),...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
 return new Promise((resolve,reject)=>{res.write=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();return true;};res.end=(chunk,encoding,done)=>{if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));done?.();resolve({status:res.statusCode,json:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null});res.emit('finish');socket.destroy();return res;};req.on('error',reject);res.on('error',reject);app.handle(req,res,error=>reject(error||new Error('Unhandled fixture route')));if(bytes)req.push(bytes);req.push(null);});
}

test('actual browser and device HTTP routes use separate existing auth; no local listener',async t=>{
 const f=fixture(t),app=createApp({memory:true,requireAuth:true,requireDeviceAuth:true,enableScheduler:false,repository:f.repo,auth:f.auth,deviceUpdates:{readRelease:async()=>f.metadata}}),cookie=`ziwei_session=${f.owner.session.token}`,base=`/api/workspaces/${f.slug}/devices/${f.pair.deviceId}/client-updates`;
 assert.equal((await request(app,base,{method:'POST',body:f.input})).status,401);
 const created=await request(app,base,{method:'POST',cookie,body:f.input});assert.equal(created.status,202,JSON.stringify(created.json));
 const query=`?workspace=${f.slug}&deviceId=${f.pair.deviceId}`,poll=await request(app,'/a2a/v1/device-updates'+query,{token:f.pair.deviceToken});assert.equal(poll.status,200);assert.equal(poll.json.request.id,created.json.request.id);
 const claimed=await request(app,`/a2a/v1/device-updates/${created.json.request.id}/claim${query}`,{method:'POST',token:f.pair.deviceToken,body:{hostId:HOST,clientBuild:OLD,pid:1001}});assert.equal(claimed.status,200,JSON.stringify(claimed.json));
 const adminGet=await request(app,base,{cookie});assert.equal(adminGet.status,200);assert.equal(adminGet.json.device.operation.state,'accepted');assert.equal(JSON.stringify(adminGet.json).includes(claimed.json.claimToken),false);
 assert.equal((await request(app,base,{method:'POST',token:f.pair.deviceToken,body:f.input})).status,401);
});

test('replayed awaiting report never shifts verification time or settles a GET',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id);
 progress(f,a.request.id,c.claimToken,'waiting_idle');progress(f,a.request.id,c.claimToken,'updating');progress(f,a.request.id,c.claimToken,'awaiting_heartbeat');
 const before=f.db.prepare('SELECT * FROM device_updates WHERE id=?').get(a.request.id);
 for(let i=0;i<3;i++){f.advance(10_000);progress(f,a.request.id,c.claimToken,'awaiting_heartbeat');}
 assert.deepEqual(f.db.prepare('SELECT * FROM device_updates WHERE id=?').get(a.request.id),before);
 assert.equal((await f.service.get(f.slug,f.pair.deviceId,a.request.id,f.context)).request.state,'awaiting_heartbeat','GET cannot settle the request');
 f.heartbeat({clientBuild:TARGET,pid:1002});assert.equal(f.service.pending(f.slug,f.pair.deviceId,f.credential()).request.state,'succeeded');
});

test('future heartbeat is not permanently online; removing admin authority stops a queued claim',async t=>{
 const f=fixture(t),a=await f.create();f.db.prepare('UPDATE devices SET heartbeat_at=?,last_seen=? WHERE id=?').run(new Date(Date.now()+600_000).toISOString(),new Date(Date.now()+600_000).toISOString(),f.pair.deviceId);
 assert.equal((await f.service.list(f.slug,f.context)).devices[0].reasonCode,'DEVICE_OFFLINE');
 assert.throws(()=>claim(f,a.request.id),{code:'DEVICE_OFFLINE'});
 f.heartbeat();f.db.prepare("UPDATE members SET role='member' WHERE workspace_id=? AND user_id=?").run(f.repo.getWorkspace(f.slug).id,f.owner.user_id);
 assert.throws(()=>claim(f,a.request.id),{code:'CLIENT_UPDATE_AUTHORITY_REVOKED'});
 assert.equal(f.db.prepare('SELECT state FROM device_updates WHERE id=?').get(a.request.id).state,'failed');
});

test('stalled maintenance intent is retained and expires only upon explicit new request, without claiming worker exit',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id);progress(f,a.request.id,c.claimToken,'waiting_idle');progress(f,a.request.id,c.claimToken,'updating');
 f.advance(2*60*60*1000+1_000);
 const stamp=new Date(Date.now()+2*60*60*1000+1_000).toISOString();f.db.prepare('UPDATE devices SET heartbeat_at=?,last_seen=? WHERE id=?').run(stamp,stamp,f.pair.deviceId);
 const before=f.db.prepare('SELECT * FROM device_updates WHERE id=?').get(a.request.id),read=await f.service.get(f.slug,f.pair.deviceId,null,f.context);assert.equal(read.device.operation.stalled,true);assert.deepEqual(f.db.prepare('SELECT * FROM device_updates WHERE id=?').get(a.request.id),before);
 const retried=await f.service.create(f.slug,f.pair.deviceId,{...f.input,idempotencyKey:'explicit-retry-after-timeout'},f.context);assert.notEqual(retried.request.id,a.request.id);
 const old=(await f.service.get(f.slug,f.pair.deviceId,a.request.id,f.context)).request;assert.equal(old.state,'failed');assert.equal(old.code,'CLIENT_UPDATE_UNCONFIRMED_TIMEOUT');assert.equal(old.heartbeatVerified,false);assert.equal(retried.request.state,'requested');
});

test('concurrent same-key requests are stable after release lookup yields',async t=>{
 const f=fixture(t);let resolve;const pending=new Promise(done=>resolve=done),service=createDeviceUpdateService(f.repo,{readRelease:()=>pending});
 const a=service.create(f.slug,f.pair.deviceId,f.input,f.context),b=service.create(f.slug,f.pair.deviceId,f.input,f.context);resolve(f.metadata);
 const result=await Promise.all([a,b]);assert.equal(result[0].request.id,result[1].request.id);assert.equal(f.db.prepare('SELECT count(*) n FROM device_updates').get().n,1);
});

test('device removal remains possible after maintenance history and cascades only its maintenance rows',async t=>{
 const f=fixture(t);await f.create();f.repo.deleteDevice(f.pair.deviceId);assert.equal(f.db.prepare('SELECT count(*) n FROM device_updates').get().n,0);
});


test('actual target heartbeat can satisfy a request before claim or before worker awaiting phase',async t=>{
 const f=fixture(t),a=await f.create();f.heartbeat({clientBuild:TARGET,pid:1002});
 const result=await f.service.get(f.slug,f.pair.deviceId,a.request.id,f.context);assert.equal(result.request.state,'succeeded');assert.equal(result.request.completionSource,'heartbeat');assert.equal(result.request.heartbeatVerified,true);
 assert.equal(f.db.prepare('SELECT claim_token FROM device_updates WHERE id=?').get(a.request.id).claim_token,null,'version observed does not claim this request started a worker');
});

test('an older still-running worker can satisfy a newly requested retry without wedging claim on old source build',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id);progress(f,a.request.id,c.claimToken,'waiting_idle');progress(f,a.request.id,c.claimToken,'updating');
 f.db.prepare('UPDATE device_updates SET updated_at=? WHERE id=?').run(new Date(Date.now()-2*60*60*1000-1_000).toISOString(),a.request.id);
 const b=await f.service.create(f.slug,f.pair.deviceId,{...f.input,idempotencyKey:'retry-while-original-worker-alive'},f.context);assert.equal(b.request.state,'requested');
 f.heartbeat({clientBuild:TARGET,pid:1002});
 assert.equal((await f.service.get(f.slug,f.pair.deviceId,b.request.id,f.context)).request.state,'succeeded');
 assert.equal((await f.service.get(f.slug,f.pair.deviceId,a.request.id,f.context)).request.code,'CLIENT_UPDATE_UNCONFIRMED_TIMEOUT','original unconfirmed timeout stays in history');
});

function secondWorkspaceDevice(f){
 const slug='second-host-workspace';f.auth.createWorkspace(f.owner.user_id,{slug,name:'Second host workspace',kind:'team'});
 const pair=f.repo.claimDevicePairing({code:f.repo.createDevicePairing(slug,{name:'Shared installation'}).code});
 f.repo.heartbeatDevice(slug,{deviceId:pair.deviceId,os:'Windows',pid:1001,clientBuild:OLD,runtimeDiscovery:{features:[REMOTE_UPDATE_FEATURE],maintenanceHostId:HOST}});
 return{slug,pair,input:{idempotencyKey:'new-authorized-host-request',waitForIdle:true}};
}

test('explicit create releases a pre-update intent whose original device authorization was revoked, but GET stays read-only',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id);progress(f,a.request.id,c.claimToken,'waiting_idle');const other=secondWorkspaceDevice(f);
 f.repo.revokeDeviceCredential(f.pair.deviceId);
 const before=f.db.prepare('SELECT * FROM device_updates WHERE id=?').get(a.request.id);await f.service.list(other.slug,f.context);assert.deepEqual(f.db.prepare('SELECT * FROM device_updates WHERE id=?').get(a.request.id),before);
 const next=await f.service.create(other.slug,other.pair.deviceId,other.input,f.context);assert.equal(next.request.state,'requested');
 const old=f.db.prepare('SELECT state,reason_code FROM device_updates WHERE id=?').get(a.request.id);assert.equal(old.state,'failed');assert.equal(old.reason_code,'CLIENT_UPDATE_AUTHORITY_REVOKED');
});

test('a valid replacement credential for the same device preserves its pending intent across token rotation',async t=>{
 const f=fixture(t),a=await f.create(),old=f.credential();
 f.db.prepare("UPDATE device_credentials SET id='rotated-device-credential',token_hash=?,token_prefix=?,revoked_at=NULL WHERE device_id=?").run('8'.repeat(64),'rotated-fixture',f.pair.deviceId);
 const rotated={...old,credentialId:'rotated-device-credential'};
 const retry=await f.service.create(f.slug,f.pair.deviceId,{...f.input,idempotencyKey:'same-device-after-rotation'},f.context);assert.equal(retry.request.id,a.request.id);assert.equal(retry.request.state,'requested');
 const accepted=f.service.claim(f.slug,f.pair.deviceId,a.request.id,{hostId:HOST,clientBuild:OLD,pid:1001},rotated);assert.equal(accepted.request.state,'accepted');
});

test('revocation cannot automatically release an updating worker intent',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id);progress(f,a.request.id,c.claimToken,'waiting_idle');progress(f,a.request.id,c.claimToken,'updating');const other=secondWorkspaceDevice(f);
 f.repo.revokeDeviceCredential(f.pair.deviceId);
 await assert.rejects(f.service.create(other.slug,other.pair.deviceId,other.input,f.context),{code:'DEVICE_MAINTENANCE_BUSY'});
 assert.equal(f.db.prepare('SELECT state FROM device_updates WHERE id=?').get(a.request.id).state,'updating');
});


test('authority removed after claim is checked again immediately before entering updating',async t=>{
 const f=fixture(t),a=await f.create(),c=claim(f,a.request.id);progress(f,a.request.id,c.claimToken,'waiting_idle');
 f.db.prepare("UPDATE members SET role='member' WHERE workspace_id=? AND user_id=?").run(f.repo.getWorkspace(f.slug).id,f.owner.user_id);
 const response=progress(f,a.request.id,c.claimToken,'updating');assert.equal(response.request.state,'failed');assert.equal(response.request.code,'CLIENT_UPDATE_AUTHORITY_REVOKED');
 assert.equal(f.db.prepare('SELECT state FROM device_updates WHERE id=?').get(a.request.id).state,'failed');
});
