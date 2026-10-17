import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from '../../backend/app.mjs';
import {initialState} from '../web/model.js';
import {createDeviceSettings,renderDeviceSettings} from '../web/device-settings.js';

// Exercise Express authentication, role guards and repository contracts without
// creating an HTTP listener, socket connection or a production session.
async function inMemoryRequest(app,method,url,{body,cookie}={}){
  const socket=new Duplex({read(){},write(_chunk,_encoding,callback){callback();}});
  const request=new IncomingMessage(socket),response=new ServerResponse(request);
  const payload=body===undefined?'':JSON.stringify(body);
  request.method=method;request.url=url;request.headers={host:'manager.fixture',cookie:cookie||'',...(body===undefined?{}:{'content-type':'application/json','content-length':String(Buffer.byteLength(payload))})};
  const chunks=[];
  const result=new Promise((resolve,reject)=>{
    response.write=(chunk,encoding,callback)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));callback?.();return true;};
    response.end=(chunk,encoding,callback)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));callback?.();const text=Buffer.concat(chunks).toString();resolve({status:response.statusCode,body:text?JSON.parse(text):{},headers:response.getHeaders()});response.emit('finish');return response;};
    response.on('error',reject);request.on('error',reject);
    app.handle(request,response,error=>reject(error||new Error(`Unhandled fixture route ${method} ${url}`)));
  });
  request.push(payload||null);if(payload)request.push(null);
  try{return await result;}finally{socket.destroy();}
}
const form=value=>{const data=new FormData();for(const [key,item] of Object.entries(value))data.set(key,item);return data;};
const change=(module,formName,name,value)=>module.change({name,value,form:{dataset:{form:formName}}});

function fixture(t,{role='owner'}={}){
  const originalFetch=globalThis.fetch,upstreamCalls=[],apiCalls=[];
  const phone={id:'phone-opaque-A',terminalId:'terminal-not-a-computer-id',alias:'原手机',nodes:[{role:'agent',status:'online',health:{accessibility:true,screenOn:true,locked:false}},{role:'updater',status:'online',health:{}}],control:{role:'agent',epoch:7},commands:[],updates:[],unknownPhoneSetting:{keep:true}};
  const provider={phones:[phone],requests:[{id:'enrollment-approve',alias:'待批准手机',role:'agent',versionName:'0.4.4',versionCode:15,status:'pending',expiresAt:new Date(Date.now()+600000).toISOString()},{id:'enrollment-reject',alias:'待拒绝手机',role:'updater',status:'pending',expiresAt:new Date(Date.now()+600000).toISOString()}],failApproval:false};
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://phone-settings.invalid','Only the isolated provider may be requested');
    const path=parsed.pathname.slice('/api'.length),method=init.method||'GET',body=init.body?JSON.parse(init.body):{};upstreamCalls.push({path,method,body});
    const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
    if(method==='GET'&&path==='/android-devices')return json({devices:provider.phones});
    if(method==='GET'&&path==='/android-devices/enrollment-requests')return json({requests:provider.requests});
    const enrollment=path.match(/^\/android-devices\/enrollment-requests\/([^/]+)\/(approve|reject)$/);
    if(enrollment){
      if(provider.failApproval)throw new TypeError('isolated response lost');
      const request=provider.requests.find(item=>item.id===enrollment[1]);
      if(!request||request.status!=='pending')return json({message:'入网申请状态已变化'},409);
      request.status=enrollment[2]==='approve'?'approved':'rejected';
      if(request.status==='approved'){const device={id:'phone-approved',alias:request.alias,nodes:[],control:{role:null,epoch:1}};provider.phones.push(device);return json({request,device});}
      return json({request});
    }
    const control=path.match(/^\/android-devices\/([^/]+)\/control$/);
    if(control){assert.deepEqual(Object.keys(body),['role']);const device=provider.phones.find(item=>item.id===control[1]);if(!device)return json({error:'手机不存在'},404);device.control={...device.control,role:body.role};return json({device});}
    const status=path.match(/^\/android-devices\/([^/]+)\/status$/);
    if(status)return json({device:provider.phones.find(item=>item.id===status[1])});
    throw new Error(`Unexpected isolated provider request ${method} ${path}`);
  };
  const app=createApp({memory:true,requireAuth:true,ziweiConnectApiBase:'https://phone-settings.invalid/api',ziweiConnectCookie:'fixture-only-upstream-cookie'});
  const repo=app.locals.repo,principal=app.locals.auth.setup({email:'device-owner@fixture.test',password:'isolated-fixture-password',name:'隔离设备验收'});
  const slug='device-settings-qa';app.locals.auth.createWorkspace(principal.user_id,{slug,name:'设备设置验收',kind:'team'});
  if(role!=='owner')repo.db.prepare('UPDATE members SET role=? WHERE user_id=? AND workspace_id=(SELECT id FROM workspaces WHERE slug=?)').run(role,principal.user_id,slug);
  const employee=repo.createEmployee(slug,{name:'同一位员工',runtime:'Codex',ownerUserId:principal.user_id});
  const computer=repo.createDevice(slug,{name:'原运行电脑',os:'linux',ownerUserId:principal.user_id});
  const cookie=`ziwei_session=${principal.session.token}`;
  const request=async(method,path,body)=>{
    apiCalls.push({method,path,body});const result=await inMemoryRequest(app,method,path,{body,cookie});
    if(result.status>=400)throw Object.assign(new Error(result.body.error||result.body.message||`HTTP ${result.status}`),{status:result.status,code:result.body.code});
    return result.body;
  };
  const base=workspace=>`/api/workspaces/${encodeURIComponent(workspace)}`,connect=workspace=>`${base(workspace)}/ziwei-connect`,terminal=workspace=>`${connect(workspace)}/terminal/android-devices`;
  const api={
    devices:w=>request('GET',`${base(w)}/devices`),employees:w=>request('GET',`${base(w)}/employees`),connectDevices:w=>request('GET',`${connect(w)}/devices`),phoneBindings:w=>request('GET',`${connect(w)}/bindings`),
    createDevicePairing:(w,body)=>request('POST',`${base(w)}/devices/pairing`,body),
    savePhoneBinding:(w,body)=>request('POST',`${connect(w)}/bindings`,body),deletePhoneBinding:(w,id)=>request('DELETE',`${connect(w)}/bindings/${encodeURIComponent(id)}`),
    phoneEnrollmentRequests:w=>request('GET',`${terminal(w)}/enrollment-requests`),approvePhoneEnrollment:(w,id)=>request('POST',`${terminal(w)}/enrollment-requests/${encodeURIComponent(id)}/approve`,{}),rejectPhoneEnrollment:(w,id)=>request('POST',`${terminal(w)}/enrollment-requests/${encodeURIComponent(id)}/reject`,{}),
    phoneControl:(w,id,body)=>request('POST',`${terminal(w)}/${encodeURIComponent(id)}/control`,body),phone:(w,id)=>request('GET',`${terminal(w)}/${encodeURIComponent(id)}/status`),
  };
  const state={...initialState(),phase:'ready',page:'device-settings',user:{user_id:principal.user_id},workspace:{slug,role}};
  let epoch=0,selection=0;
  const current=()=>({epoch,selection,scope:state.workspace.slug});
  const valid=token=>token.epoch===epoch&&token.selection===selection&&token.scope===state.workspace.slug;
  const failures=[],module=createDeviceSettings({state,api,current,valid,fail:error=>failures.push(error.message)});
  t.after(()=>{globalThis.fetch=originalFetch;repo.db.close();});
  return {app,repo,principal,slug,employee,computer,phone,provider,api,state,module,apiCalls,upstreamCalls,failures,cookie,current,leave:()=>{selection++;state.page='home';},enter:()=>{state.page='device-settings';},switchScope:()=>{epoch++;state.workspace={slug:'different-scope',role};}};
}

test('device settings load uses existing identities, never creates codes, approves, binds or controls automatically',async t=>{
  const f=fixture(t);await f.module.load();
  assert.equal(f.state.deviceSettings.computers[0].id,f.computer.id);assert.equal(f.state.deviceSettings.phones[0].id,f.phone.id);
  assert.equal(f.state.deviceSettings.requests.length,2);assert.equal(f.state.deviceSettings.pairing,null);
  assert(f.apiCalls.every(call=>call.method==='GET'));assert(f.upstreamCalls.every(call=>call.method==='GET'));
  const html=renderDeviceSettings(f.state);assert(!html.includes('href='));assert(!html.includes('fixture-only-upstream-cookie'));assert(!html.includes('terminal-not-a-computer-id'));
  assert.equal((html.match(/data-state-fields/g)||[]).length,3);
});

test('explicit computer pairing preserves selected target OS, remains in memory, and does not consume the code',async t=>{
  const f=fixture(t,{role:'member'});await f.module.load();
  change(f.module,'device-pairing','name','目标 Mac');change(f.module,'device-pairing','os','darwin');
  await f.module.submit('device-pairing',form({name:'目标 Mac',os:'darwin'}));
  const code=f.state.deviceSettings.pairing.code;assert.match(code,/^zwi-/);assert.equal(f.state.deviceSettings.pairing.workspace,f.slug);
  const row=f.repo.db.prepare('SELECT * FROM device_pairing_codes WHERE workspace_id=(SELECT id FROM workspaces WHERE slug=?)').get(f.slug);
  assert.equal(row.device_os,'darwin');assert.equal(row.device_name,'目标 Mac');assert.equal(row.consumed_at,null);
  assert.equal(f.repo.listDevices(f.slug).length,1);assert(!f.apiCalls.some(call=>call.path.includes('/daemon/pair')));
  await f.module.load();assert.equal(f.state.deviceSettings.pairing.code,code);assert.equal(f.state.deviceSettings.pairDraft.os,'darwin');
  await f.module.actions['device-pairing-hide']();assert.equal(f.state.deviceSettings.pairing,null);
});

test('members may read mappings and pair computers but cannot access terminal or mutate phone settings',async t=>{
  const f=fixture(t,{role:'member'});await f.module.load();
  assert(!f.apiCalls.some(call=>call.path.includes('/terminal/')));
  await f.module.submit('device-binding',form({employeeId:f.employee.id,deviceId:f.phone.id}));
  await f.module.actions['device-enrollment-approve']({id:'enrollment-approve'});
  await f.module.submit('device-phone-control',form({deviceId:f.phone.id,role:'updater'}));
  assert(f.apiCalls.every(call=>call.method==='GET'));assert.match(f.failures.join(' '),/管理员/);
  const denied=await inMemoryRequest(f.app,'POST',`/api/workspaces/${f.slug}/ziwei-connect/terminal/android-devices/enrollment-requests/enrollment-approve/approve`,{body:{},cookie:f.cookie});
  assert.equal(denied.status,403);
});

test('binding upsert uses phone.id, retains original account fields and unknown cached fields, and unbind preserves both identities',async t=>{
  const f=fixture(t);const original=await f.api.savePhoneBinding(f.slug,{employeeId:f.employee.id,deviceId:f.phone.id,accountId:'store-1',accountLabel:'原账号备注'});await f.module.load();
  f.state.deviceSettings.bindings[0].futureField={preserve:true};
  await f.module.actions['device-binding-edit']({id:original.id});
  await f.module.submit('device-binding',form({employeeId:f.employee.id,deviceId:f.phone.id}));
  const saved=f.state.deviceSettings.bindings[0];assert.equal(saved.id,original.id);assert.equal(saved.accountId,'store-1');assert.equal(saved.accountLabel,'原账号备注');assert.deepEqual(saved.futureField,{preserve:true});
  const call=f.apiCalls.filter(call=>call.method==='POST'&&call.path.endsWith('/bindings')).at(-1);assert.equal(call.body.deviceId,f.phone.id);assert.notEqual(call.body.deviceId,f.computer.id);assert.notEqual(call.body.deviceId,f.phone.terminalId);
  assert.match(renderDeviceSettings(f.state),/不会|单独开启/);
  await f.module.actions['device-binding-unbind']({id:saved.id});assert.deepEqual(f.state.deviceSettings.bindings,[]);assert(f.repo.getEmployee(f.employee.id));assert.equal(f.provider.phones.length,1);
});

test('phone approval and rejection require explicit actions and keep server receipt states',async t=>{
  const f=fixture(t);await f.module.load();assert.equal(f.provider.requests[0].status,'pending');
  await f.module.actions['device-enrollment-approve']({id:'enrollment-approve'});
  assert.equal(f.state.deviceSettings.requests[0].status,'approved');assert(f.state.deviceSettings.phones.some(phone=>phone.id==='phone-approved'));
  await f.module.actions['device-enrollment-reject']({id:'enrollment-reject'});assert.equal(f.state.deviceSettings.requests[1].status,'rejected');
  const count=f.upstreamCalls.filter(call=>call.method==='POST').length;await f.module.actions['device-enrollment-approve']({id:'enrollment-approve'});assert.equal(f.upstreamCalls.filter(call=>call.method==='POST').length,count);
});

test('control saves only role and then reads original phone status without retrying or changing epoch/unknown settings',async t=>{
  const f=fixture(t);await f.module.load();await f.module.submit('device-phone-control',form({deviceId:f.phone.id,role:''}));
  const writes=f.upstreamCalls.filter(call=>call.method==='POST');assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{role:null});
  assert(f.upstreamCalls.some(call=>call.path===`/android-devices/${f.phone.id}/status`));assert.equal(f.phone.control.epoch,7);assert.deepEqual(f.phone.unknownPhoneSetting,{keep:true});
  assert.match(f.state.deviceSettings.notice,/实际状态/);
});

test('refresh preserves edited fields and known bindings when a read fails; a validation error permits correcting the draft',async t=>{
  const f=fixture(t);await f.api.savePhoneBinding(f.slug,{employeeId:f.employee.id,deviceId:f.phone.id,accountId:'original'});await f.module.load();
  change(f.module,'device-binding','accountLabel','尚未保存的备注');
  f.api.phoneBindings=async()=>{throw new Error('绑定读取暂时失败');};await f.module.load();
  assert.equal(f.state.deviceSettings.bindings.length,1);assert.equal(f.state.deviceSettings.binding.accountLabel,'尚未保存的备注');assert.match(f.state.deviceSettings.errors.bindings,/读取/);
  await f.module.submit('device-binding',form({employeeId:f.employee.id,deviceId:'not-a-phone'}));assert.equal(f.state.deviceSettings.needsReview,false);
  await f.module.submit('device-binding',form({employeeId:f.employee.id,deviceId:f.phone.id,accountLabel:'修正后的备注'}));assert.equal(f.state.deviceSettings.bindings[0].accountLabel,'修正后的备注');
});

test('first partial load cannot clear unknown account fields, while unrelated reads never block computer pairing',async t=>{
  const f=fixture(t);const original=await f.api.savePhoneBinding(f.slug,{employeeId:f.employee.id,deviceId:f.phone.id,accountId:'keep-original-account',accountLabel:'保留原账号备注'});
  let finishBindings,finishRequests;
  f.api.phoneBindings=()=>new Promise(resolve=>finishBindings=resolve);
  f.api.phoneEnrollmentRequests=()=>new Promise(resolve=>finishRequests=resolve);
  const loading=f.module.load();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(f.state.deviceSettings.loaded.phones,true);assert.equal(f.state.deviceSettings.loaded.bindings,undefined);assert.equal(f.state.deviceSettings.loading,true);
  change(f.module,'device-binding','employeeId',f.employee.id);change(f.module,'device-binding','deviceId',f.phone.id);
  const writes=f.apiCalls.filter(call=>call.method==='POST'&&call.path.endsWith('/bindings')).length;
  await f.module.submit('device-binding',form({employeeId:f.employee.id,deviceId:f.phone.id}));
  assert.equal(f.apiCalls.filter(call=>call.method==='POST'&&call.path.endsWith('/bindings')).length,writes);
  assert.match(renderDeviceSettings(f.state),/<button[^>]+disabled>保存手机绑定/);
  await f.module.submit('device-pairing',form({name:'不等待手机服务的电脑',os:'linux'}));
  const pairingCode=f.state.deviceSettings.pairing.code;assert.match(pairingCode,/^zwi-/);assert.equal(f.state.deviceSettings.loading,true);
  finishBindings({bindings:[original]});finishRequests({requests:[]});await loading;
  assert.equal(f.state.deviceSettings.loading,false);assert.equal(f.state.deviceSettings.loaded.bindings,true);assert.equal(f.state.deviceSettings.loaded.requests,true);assert.equal(f.state.deviceSettings.pairing.code,pairingCode);
  assert.equal(f.state.deviceSettings.binding.accountId,'keep-original-account');assert.equal(f.state.deviceSettings.binding.accountLabel,'保留原账号备注');
  await f.module.submit('device-binding',form({employeeId:f.employee.id,deviceId:f.phone.id}));
  assert.equal(f.state.deviceSettings.bindings[0].accountId,'keep-original-account');
});

test('a catalog read crossing a binding save re-reads only that catalog and cannot restore stale bindings',async t=>{
  const f=fixture(t);await f.module.load();
  const actualBindings=f.api.phoneBindings;let releaseOldRead,reads=0;
  f.api.phoneBindings=async workspace=>{reads++;if(reads===1)return new Promise(resolve=>releaseOldRead=resolve);return actualBindings(workspace);};
  const refresh=f.module.load();await new Promise(resolve=>setTimeout(resolve,0));
  await f.module.submit('device-binding',form({employeeId:f.employee.id,deviceId:f.phone.id,accountId:'new-account'}));
  releaseOldRead({bindings:[]});await refresh;
  assert.equal(reads,2);assert.equal(f.state.deviceSettings.bindings[0].accountId,'new-account');assert.equal(f.state.deviceSettings.loading,false);
  assert.equal(f.apiCalls.filter(call=>call.method==='POST'&&call.path.endsWith('/bindings')).length,1);
});

test('lost approval response is never automatically retried and requires a read before another mutation',async t=>{
  const f=fixture(t);await f.module.load();f.provider.failApproval=true;
  await f.module.actions['device-enrollment-approve']({id:'enrollment-approve'});assert.equal(f.state.deviceSettings.needsReview,true);
  const count=f.upstreamCalls.filter(call=>call.method==='POST').length;
  await f.module.actions['device-enrollment-approve']({id:'enrollment-approve'});assert.equal(f.upstreamCalls.filter(call=>call.method==='POST').length,count);
  f.provider.failApproval=false;await f.module.load();assert.equal(f.state.deviceSettings.needsReview,false);assert.equal(f.provider.requests[0].status,'pending');
});

test('late responses after leaving the settings page cannot install pairing credentials or overwrite another scope',async t=>{
  const f=fixture(t);await f.module.load();let resolve;
  f.api.createDevicePairing=()=>new Promise(done=>resolve=done);
  const pending=f.module.submit('device-pairing',form({name:'晚到电脑',os:'linux'}));f.leave();
  resolve({workspace:f.slug,code:'zwi-12345678-12345678',expires_at:new Date(Date.now()+60000).toISOString()});await pending;
  assert.equal(f.state.deviceSettings.pairing,null);assert.equal(f.state.deviceSettings.pending,'');
  f.enter();f.state.deviceSettings.pairDraft.name='原草稿';await f.module.load();assert.equal(f.state.deviceSettings.pairDraft.name,'原草稿');
  f.switchScope();f.enter();await f.module.load();assert.equal(f.state.deviceSettings.pairing,null);assert.equal(f.state.deviceSettings.pairDraft.name,'');
});
