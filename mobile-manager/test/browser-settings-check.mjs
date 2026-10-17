// Real session/role/CAS and phone-MCP contracts in memory, routed into Express
// directly. No HTTP listener, production request, model call or device action.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createApp} from '../../backend/app.mjs';
import {createManagementService} from '../../backend/management.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const web=path.join(root,'mobile-manager/web'),out=path.join(root,'.local/mobile-manager-settings-qa');
await fs.mkdir(out,{recursive:true});
const origin='https://ziwei-settings.invalid',providerOrigin='https://phone-settings.invalid';
const slug='settings-qa',base=`/api/workspaces/${slug}`,connect=`${base}/ziwei-connect`,terminal=`${connect}/terminal/android-devices`;
const requests=[],upstreamCalls=[],errors=[],checks=[],screenshots=[],contexts=[],ownerResponses={};
const originalFetch=globalThis.fetch;
const phone=(id,alias)=>({id,terminalId:`opaque-terminal-${id}`,alias,nodes:['agent','updater'].map(role=>({role,status:'online',versionCode:15,versionName:'fixture',lastSeen:new Date().toISOString(),health:{accessibility:true,screenOn:true,locked:false,peerBound:true}})),control:{role:'agent',epoch:4,draining:false},commands:[],updates:[],snapshot:null});
const provider={phones:[phone('phone-catalog-A','隔离手机 A'),phone('phone-catalog-B','隔离手机 B')],requests:['approve','reject'].map(kind=>({id:`request-${kind}`,alias:`隔离待${kind==='approve'?'批准':'拒绝'}手机`,role:kind==='approve'?'agent':'updater',status:'pending',versionCode:15,versionName:'fixture',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()}))};
const clone=value=>structuredClone(value);
globalThis.fetch=async(value,init={})=>{
  const url=new URL(value);assert.equal(url.origin,providerOrigin,'All upstream traffic must remain isolated');
  const p=url.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):{};
  upstreamCalls.push({method,path:p,body:clone(body)});
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  if(method==='GET'&&p==='/api/android-devices')return json({devices:provider.phones});
  if(method==='GET'&&p==='/api/android-devices/enrollment-requests')return json({requests:provider.requests.filter(item=>item.status==='pending')});
  const enrollment=p.match(/^\/api\/android-devices\/enrollment-requests\/([^/]+)\/(approve|reject)$/);
  if(method==='POST'&&enrollment){
    assert.deepEqual(body,{});const request=provider.requests.find(item=>item.id===enrollment[1]);
    if(!request||request.status!=='pending')return json({message:'申请状态已变化'},409);
    request.status=enrollment[2]==='approve'?'approved':'rejected';
    if(request.status==='rejected')return json({request});
    const device=phone('phone-approved','隔离批准后的手机');provider.phones.push(device);request.deviceId=device.id;return json({request,device});
  }
  const control=p.match(/^\/api\/android-devices\/([^/]+)\/control$/);
  if(method==='POST'&&control){
    assert.deepEqual(Object.keys(body),['role']);assert.ok(['agent','updater',null].includes(body.role));
    const device=provider.phones.find(item=>item.id===control[1]);if(!device)return json({message:'手机不存在'},404);
    device.control={...device.control,role:body.role,epoch:device.control.epoch+1};return json({device});
  }
  const detail=p.match(/^\/api\/android-devices\/([^/]+)(?:\/status)?$/);
  if(method==='GET'&&detail)return json({device:provider.phones.find(item=>item.id===detail[1])});
  throw new Error(`Blocked isolated upstream operation ${method} ${p}`);
};
const app=createApp({memory:true,requireAuth:true,enableScheduler:false,ziweiConnectApiBase:`${providerOrigin}/api`,ziweiConnectCookie:'fixture-only-session'});
const repo=app.locals.repo,management=createManagementService(repo),bots=management.bots;
const principal=app.locals.auth.setup({name:'设置隔离验收',email:'settings-owner@fixture.test',password:'fixture-private-password'});
app.locals.auth.createWorkspace(principal.user_id,{slug,name:'设置隔离工作区',kind:'team'});
const actor={actorUserId:principal.user_id,actorRole:'owner',enforceEmployeeVisibility:true,enforceDeviceOwnership:true};
const ready=name=>({name,provider_configured:true,authentication_configured:true,readiness:{ready:true,authentication:'configured',provider:'configured'}});
for(const [id,name] of [['settings-pc-A','隔离运行电脑 A'],['settings-pc-B','隔离运行电脑 B']])repo.heartbeatDevice(slug,{deviceId:id,name,ownerUserId:principal.user_id,terminalMcp:{configured:true,workspace:slug,supportedRuntimes:['Hermes','Codex']},runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[ready('default'),ready('settings-profile')],models:[{id:'fixture-model-A'},{id:'fixture-model-B'}],readiness:{ready:true,authentication:'configured',provider:'configured'}},Codex:{status:'available',version:'1.0.0',profiles:[],models:[{id:'fixture-codex-model'}],readiness:{ready:true,authentication:'configured',provider:'configured'}}}});
const hermes=repo.createEmployee(slug,{name:'设置验收 Hermes 员工',runtime:'Hermes',runtimeProfile:'settings-profile',targetDeviceId:'settings-pc-A',model:'fixture-model-A',ownerUserId:principal.user_id,visibility:'workspace'});
const unedited={gateway:{platforms:{telegram:{enabled:false,tokenEnv:'FIXTURE_GATEWAY_TOKEN',extra:{fixtureFlag:'preserved'},allowedUsers:['fixture-user']}},profileRoutes:[]},voice:{tts:{enabled:false,provider:'fixture',model:'voice-fixture'}},collaboration:{enabled:false,targetEmployeeIds:[]}};
bots.initialize(slug,hermes.id,{idempotencyKey:'browser-settings-init',config:unedited},actor);
const ordinary=repo.createEmployee(slug,{name:'设置验收普通 Codex 员工',runtime:'Codex',targetDeviceId:'settings-pc-A',model:'fixture-codex-model',ownerUserId:principal.user_id,visibility:'workspace'});
const extraSkill=repo.createSkill(slug,{name:'隔离工作区技能',description:'仅内存仓库'});repo.setSkillInstalled(extraSkill.id,true);
const phoneSkill=repo.listSkills(slug).find(item=>item.catalog_id==='ziwei-phone-control');repo.setSkillInstalled(phoneSkill.id,true);
const cookie=`ziwei_session=${principal.session.token}`;

async function inMemoryRequest(method,url,body){
  const socket=new Duplex({read(){},write(_chunk,_encoding,callback){callback();}});
  const request=new IncomingMessage(socket),response=new ServerResponse(request),payload=body===undefined?'':JSON.stringify(body);
  request.method=method;request.url=url;request.headers={host:'ziwei-settings.invalid',cookie,...(body===undefined?{}:{'content-type':'application/json','content-length':String(Buffer.byteLength(payload))})};
  const chunks=[];
  const result=new Promise((resolve,reject)=>{
    response.write=(chunk,encoding,callback)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));callback?.();return true;};
    response.end=(chunk,encoding,callback)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));callback?.();const text=Buffer.concat(chunks).toString();resolve({status:response.statusCode,body:text?JSON.parse(text):{}});response.emit('finish');return response;};
    response.on('error',reject);request.on('error',reject);
    app.handle(request,response,error=>reject(error||new Error(`Unhandled ${method} ${url}`)));
  });
  request.push(payload||null);if(payload)request.push(null);
  try{return await result;}finally{socket.destroy();}
}
const browser=await chromium.launch({executablePath:process.env.ZIWEI_BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let activePage,popupCount=0;
async function session(role){
  repo.db.prepare('UPDATE members SET role=? WHERE user_id=? AND workspace_id=(SELECT id FROM workspaces WHERE slug=?)').run(role,principal.user_id,slug);
  const context=await browser.newContext({viewport:{width:393,height:851},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'});contexts.push(context);
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(7000);
  context.on('page',opened=>{if(opened!==page){popupCount++;errors.push({role,message:'Unexpected new browser page'});}});
  page.on('pageerror',error=>errors.push({role,message:error.message}));
  await page.addInitScript(({userId,workspace})=>localStorage.setItem(`ziwei.mobile.workspace:${userId}`,workspace),{userId:principal.user_id,workspace:slug});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method(),p=url.pathname;
    if(url.origin!==origin){errors.push({role,message:`External request ${url.origin}${p}`});return route.abort();}
    try{
      if(p.startsWith('/__ziwei_manager__/')){
        const asset=p.slice('/__ziwei_manager__/'.length)||'index.html';assert.match(asset,/^[a-z-]+\.(html|js|css|png)$/);
        return route.fulfill({contentType:asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':asset.endsWith('.png')?'image/png':'text/html',body:await fs.readFile(path.join(web,asset))});
      }
      if(method!=='GET'){
        const allowed=method==='PATCH'&&[`${base}/bots/${hermes.id}`,`${base}/employees/${ordinary.id}`].includes(p)
          ||method==='PUT'&&p===`${base}/employees/${hermes.id}/phone-mcp`
          ||method==='POST'&&[`${base}/devices/pairing`,`${connect}/bindings`,`${terminal}/phone-catalog-B/control`,`${terminal}/enrollment-requests/request-approve/approve`,`${terminal}/enrollment-requests/request-reject/reject`].includes(p);
        assert.ok(allowed,`Blocked non-settings operation ${method} ${p}`);
      }
      const body=request.postData()?JSON.parse(request.postData()):undefined,entry={role,method,path:p,body:body===undefined?undefined:clone(body)};requests.push(entry);
      const result=await inMemoryRequest(method,p+url.search,body);entry.status=result.status;
      if(role==='owner'&&method==='GET'&&result.status===200)ownerResponses[p+url.search]=clone(result.body);
      return route.fulfill({status:result.status,contentType:'application/json',body:JSON.stringify(result.body)});
    }catch(error){errors.push({role,message:error.stack||error.message});return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:error.message})});}
  });
  await page.goto(`${origin}/__ziwei_manager__/index.html`);await page.getByRole('heading',{name:'我的员工',exact:true}).waitFor();
  await page.locator('[data-action=navigate][data-tab=me]').click();
  await page.locator('[data-action=settings]').click();await page.getByRole('heading',{name:'管理与设置',exact:true}).waitFor();
  return {page,context};
}
const field=(page,name)=>page.locator(`[name="${name}"]`);
const action=(page,name,id)=>page.locator(`[data-action="${name}"]${id?`[data-id="${id}"]`:''}`).first();
async function expand(page,label){const summary=page.locator('summary').filter({hasText:label}).first();if(await summary.count()&&(await summary.locator('..').getAttribute('open'))===null)await summary.click();}
async function capture(page,name,focus){if(focus)await focus.evaluate(element=>element.scrollIntoView({block:'center'}));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const file=`${name}.png`;await page.screenshot({path:path.join(out,file),fullPage:true});screenshots.push(file);}
async function submit(page,formName,pathSuffix,method='POST',status=200){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===pathSuffix&&r.request().method()===method);
  await page.locator(`[data-form="${formName}"] button[type=submit]`).click();
  const r=await response;assert.equal(r.status(),status,JSON.stringify(await r.json()));return r.json();
}
async function openEmployee(page,id){await action(page,'bot-settings',id).click();await field(page,'bot.model').waitFor();await page.waitForFunction(()=>!document.body.innerText.includes('正在同步最新配置'));}
async function hub(page){await action(page,'back').click();await page.getByRole('heading',{name:'管理与设置',exact:true}).waitFor();}

try{
  const owner=await session('owner'),page=owner.page;checks.push('我的→管理与设置 stays in the App');
  await openEmployee(page,hermes.id);
  assert.equal(await field(page,'bot.targetDeviceId').count(),0,'Initialized Bot computer binding must stay read-only');
  const original=bots.get(slug,hermes.id,actor);await field(page,'bot.model').fill('fixture-model-B');
  await field(page,'bot.provider').fill('fixture-provider');await field(page,'bot.reasoningEffort').selectOption('high');
  await field(page,'bot.permission').selectOption('execute');await field(page,'bot.management').uncheck();
  await field(page,'bot.memory.enabled').uncheck();await field(page,'bot.memory.userProfile').check();await field(page,'bot.memory.charLimit').fill('4200');
  await expand(page,'工具集与原生技能');await page.locator('[name="bot.toolsets"][value="web"]').uncheck();
  await page.locator('[name="bot.toolsets"][value="vision"]').check();await field(page,'bot.skills.autoLoad').fill('fixture_native_skill');
  await expand(page,'工作区技能');await page.locator(`[name="bot.skills"][value="${extraSkill.id}"]`).check();
  await expand(page,'外部工具与 MCP');await field(page,'bot.newMcpName').fill('fixture-tools');await action(page,'bot-settings-mcp-add').click();
  await expand(page,'fixture-tools');await field(page,'bot.mcp.fixture-tools.command').fill('fixture-no-execution');await field(page,'bot.mcp.fixture-tools.args').fill('--synthetic');await field(page,'bot.mcp.fixture-tools.env').fill('{"API_TOKEN":"${FIXTURE_API_TOKEN}"}');await field(page,'bot.mcp.fixture-tools.enabled').check();
  const saved=await submit(page,'bot-settings',`${base}/bots/${hermes.id}`,'PATCH');
  assert.equal(saved.revision,original.revision+1);assert.equal(saved.employee.model_id,'fixture-model-B');assert.equal(saved.config.provider,'fixture-provider');assert.equal(saved.config.reasoningEffort,'high');assert.equal(saved.config.permissions.mode,'execute');assert.equal(saved.config.permissions.management,false);assert.equal(saved.config.memory.enabled,false);assert.equal(saved.config.memory.charLimit,4200);assert.ok(saved.config.toolsets.includes('vision'));assert.ok(!saved.config.toolsets.includes('web'));assert.deepEqual(saved.config.skills.autoLoad,['fixture_native_skill']);assert.ok(saved.employee.skills.includes(extraSkill.id));assert.deepEqual(saved.config.mcpServers['fixture-tools'].env,{API_TOKEN:'${FIXTURE_API_TOKEN}'});
  for(const key of Object.keys(unedited))assert.deepEqual(saved.config[key],original.config[key],`Unedited ${key} must survive the full config write`);
  assert.deepEqual(bots.get(slug,hermes.id,actor).config,saved.config);await capture(page,'01-bot-settings-saved',field(page,'bot.model'));checks.push('real initialized Hermes Bot model/permissions/toolsets/memory/skills/MCP save uses CAS and preserves unedited gateway/voice/collaboration');

  await field(page,'bot.persona').fill('DIRTY-DRAFT-PRESERVED');const reads=requests.length,refreshed=page.waitForResponse(r=>new URL(r.url()).pathname===`${base}/bots/${hermes.id}`);await action(page,'bot-settings-refresh').click();await refreshed;assert.equal(await field(page,'bot.persona').inputValue(),'DIRTY-DRAFT-PRESERVED');assert.ok(requests.length>reads);
  const current=bots.get(slug,hermes.id,actor);bots.update(slug,hermes.id,{expectedRevision:current.revision,config:{...current.config,maxTurns:current.config.maxTurns+1}},actor);
  const conflict=await submit(page,'bot-settings',`${base}/bots/${hermes.id}`,'PATCH',409);assert.equal(conflict.code,'BOT_REVISION_CONFLICT');await page.getByText('配置版本已变化，草稿仍保留。',{exact:true}).waitFor();assert.equal(await field(page,'bot.persona').inputValue(),'DIRTY-DRAFT-PRESERVED');assert.equal(await page.locator('[data-form=bot-settings] button[type=submit]').isDisabled(),true);await capture(page,'02-cas-conflict-keeps-draft',page.getByText('配置版本已变化，草稿仍保留。',{exact:true}));
  await action(page,'bot-settings-reload').click();await page.waitForFunction(()=>!document.body.innerText.includes('配置版本已变化，草稿仍保留。'));assert.equal(await field(page,'bot.persona').inputValue(),bots.get(slug,hermes.id,actor).employee.persona);checks.push('refresh preserves dirty values; real stale revision returns409 and retains draft until explicit reload');

  await field(page,'bot.phone.enabled').check();await field(page,'bot.phone.phoneDeviceId').selectOption(provider.phones[0].id);await expand(page,'业务账号');await field(page,'bot.phone.accountId').fill('fixture-account');await field(page,'bot.phone.accountLabel').fill('原账号备注');
  const phoneSaved=await submit(page,'bot-phone-mcp',`${base}/employees/${hermes.id}/phone-mcp`,'PUT');assert.equal(phoneSaved.configuration.enabled,true);assert.equal(phoneSaved.configuration.target_device_id,'settings-pc-A');assert.equal(phoneSaved.configuration.phone_device_id,'phone-catalog-A');assert.equal(phoneSaved.configuration.binding.accountId,'fixture-account');assert.equal(app.locals.phoneMcp.configuration(slug,hermes.id,actor).enabled,true);assert.equal(repo.listA2AActions(slug,{status:'all'}).length,0);await capture(page,'03-phone-mcp-real-contract',field(page,'bot.phone.enabled'));checks.push('phone MCP real setup/save atomically binds phone and attaches skill without dispatching check/trial');

  await hub(page);await openEmployee(page,ordinary.id);await field(page,'bot.model').fill('fixture-codex-model-new');await field(page,'bot.targetDeviceId').selectOption('settings-pc-B');
  const ordinarySaved=await submit(page,'bot-settings',`${base}/employees/${ordinary.id}`,'PATCH');assert.equal(ordinarySaved.target_device_id,'settings-pc-B');assert.equal(ordinarySaved.model_id,'fixture-codex-model-new');assert.equal(repo.getEmployee(ordinary.id).target_device_id,'settings-pc-B');checks.push('ordinary employee saves real computer/model without initializing a Bot');

  await hub(page);await action(page,'device-settings').click();await page.locator('[data-form=device-binding]').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-form=device-binding] button[type=submit]')?.disabled);await expand(page,'连接一台电脑');await page.locator('[data-form=device-pairing] [name=name]').fill('隔离新电脑');await page.locator('[data-form=device-pairing] [name=os]').selectOption('darwin');
  const paired=await submit(page,'device-pairing',`${base}/devices/pairing`,'POST',201);assert.match(paired.code,/^zwi-/);assert.equal(paired.workspace,slug);assert.ok(Date.parse(paired.expires_at)>Date.now());assert.equal(repo.listDevices(slug).length,2,'Generating a code must not claim a computer');await action(page,'device-pairing-hide').click();checks.push('explicit computer pairing creates a real short-lived code without claiming a device');
  const binding=app.locals.ziweiConnect.listBindings(slug).find(item=>item.employeeId===hermes.id);await action(page,'device-binding-edit',binding.id).click();assert.equal(await page.locator('[data-form=device-binding] [name=accountId]').inputValue(),'fixture-account');assert.equal(await page.locator('[data-form=device-binding] [name=accountLabel]').inputValue(),'原账号备注');
  await page.locator('[data-form=device-binding] [name=deviceId]').selectOption('phone-catalog-B');const rebound=await submit(page,'device-binding',`${connect}/bindings`,'POST',201);assert.equal(rebound.accountId,'fixture-account');assert.equal(rebound.accountLabel,'原账号备注');assert.equal(rebound.deviceId,'phone-catalog-B');assert.equal(rebound.id,binding.id);await capture(page,'04-binding-account-retained',page.locator('[data-form=device-binding]'));checks.push('editing a phone binding preserves account ID/label and uses catalog phone ID');
  for(const kind of ['approve','reject']){const response=page.waitForResponse(r=>new URL(r.url()).pathname===`${terminal}/enrollment-requests/request-${kind}/${kind}`);await action(page,`device-enrollment-${kind}`,`request-${kind}`).click();assert.equal((await response).status(),200);await action(page,`device-enrollment-${kind}`,`request-${kind}`).waitFor({state:'detached'});assert.equal(provider.requests.find(item=>item.id===`request-${kind}`).status,kind==='approve'?'approved':'rejected');}
  assert.equal(provider.requests.find(item=>item.id==='request-approve').status,'approved');assert.equal(provider.requests.find(item=>item.id==='request-reject').status,'rejected');checks.push('approval/rejection use original enrollment response contract and refresh state');
  await action(page,'device-control-select','phone-catalog-B').click();
  for(const role of ['updater','']){
    await page.locator('[data-form=device-phone-control] [name=role]').selectOption(role);
    const readback=page.waitForResponse(r=>new URL(r.url()).pathname===`${terminal}/phone-catalog-B/status`);
    await submit(page,'device-phone-control',`${terminal}/phone-catalog-B/control`);await readback;
    await page.waitForFunction(()=>{const button=document.querySelector('[data-form=device-phone-control] button[type=submit]');return button&&!button.disabled;});
    assert.equal(provider.phones[1].control.role,role||null);assert.equal(await page.locator('[data-form=device-phone-control] [name=role]').inputValue(),role);
  }
  await capture(page,'04-device-settings');checks.push('control selection and pause submit role only, read back status, no host/terminal ID confusion');
  await openEmployee(page,hermes.id);await action(page,'back').click();await page.locator('.app-shell[data-page="device-settings"]').waitFor();
  await action(page,'back').click();await page.getByRole('heading',{name:'管理与设置',exact:true}).waitFor();
  await action(page,'back').click();await page.locator('[data-action=navigate][data-tab=employees]').click();
  await action(page,'employee-detail',hermes.id).click();await page.locator('.app-shell[data-page="detail"]').waitFor();
  await openEmployee(page,hermes.id);await action(page,'back').click();await page.locator('.app-shell[data-page="detail"]').waitFor();
  assert.equal(await page.locator('.employee-profile h2').innerText(),hermes.name);await capture(page,'05-nested-back-to-employee',page.locator('.employee-profile'));
  checks.push('nested Back restores device settings/hub and the original employee detail, retaining the same employee identity');
  assert.equal(owner.context.pages().length,1);await owner.context.close();

  const member=await session('member');activePage=member.page;await action(member.page,'device-settings').click();await member.page.getByText('手机入网审批、绑定修改和控制端设置需要工作区 Owner 或管理员权限。',{exact:true}).waitFor();assert.equal(await member.page.locator('[data-form=device-binding],[data-form=device-phone-control],[data-action^=device-enrollment-]').count(),0);assert.equal(requests.filter(item=>item.role==='member'&&item.path.startsWith(terminal)).length,0,'Member UI must not load admin terminal APIs');
  await expand(member.page,'连接一台电脑');await member.page.locator('[data-form=device-pairing] [name=name]').fill('成员的隔离电脑');await submit(member.page,'device-pairing',`${base}/devices/pairing`,'POST',201);
  const denied=await member.page.evaluate(async({path,employeeId})=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId,deviceId:'phone-catalog-A'})});return r.status;},{path:`${connect}/bindings`,employeeId:ordinary.id});assert.equal(denied,403,'Actual backend must reject a member write even if called directly');await capture(member.page,'05-member-permissions');checks.push('member sees read-only phone settings, backend denies phone writes, and PC pairing still succeeds');
  assert.equal(member.context.pages().length,1);assert.equal(popupCount,0);assert.deepEqual(errors,[]);assert.equal(repo.listA2AActions(slug,{status:'all'}).length,0);assert.ok(upstreamCalls.every(item=>item.method==='GET'||/\/(approve|reject|control)$/.test(item.path)));checks.push('all settings stay in one browser page; no popup/external navigation/model or device commands');
  const result={passed:true,observedAt:new Date().toISOString(),checks,screenshots,requests,upstreamCalls,popupCount,realDeviceActions:0,externalModelCalls:0,listenerCount:0,evidence:'Real in-memory repository, auth/role middleware, initialized Hermes Bot/CAS and phone-MCP service via Express app.handle; only synthetic upstream phone state is mocked.'};
  // Read-only synthetic responses can also drive a later isolated native smoke
  // package. They contain no production identities, cookies or device tokens.
  await fs.writeFile(path.join(out,'native-fixture-owner.json'),JSON.stringify({origin,slug,employeeId:hermes.id,responses:ownerResponses},null,2)+'\n');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,requests:requests.length,upstreamCalls:upstreamCalls.length},null,2));
}catch(error){
  const evidence={passed:false,observedAt:new Date().toISOString(),error:error.stack||error.message,errors,checks,requests,upstreamCalls};
  if(activePage&&!activePage.isClosed()){await capture(activePage,'failure').catch(()=>{});evidence.body=await activePage.locator('body').innerText().catch(()=>null);}
  await fs.writeFile(path.join(out,`failure-${Date.now()}.json`),JSON.stringify(evidence,null,2)+'\n');throw error;
}finally{
  for(const context of contexts)await context.close().catch(()=>{});await browser.close();globalThis.fetch=originalFetch;repo.db.close();
}
