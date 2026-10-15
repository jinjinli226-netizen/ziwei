// Real built Vue UI + real in-memory repository/management service. All HTTP
// is fulfilled in Playwright: no listener, real device, Hermes or model starts.
// Device discovery and validation receipts below are explicitly synthetic.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createRepository} from '../../backend/repository.mjs';
import {createManagementService} from '../../backend/management.mjs';
import {completeOwnedProfile} from '../../test-support/owned-profile.mjs';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url))),dist=path.join(root,'frontend/dist');
const output=path.join(root,'.local/capability-ui-verification');await fs.mkdir(output,{recursive:true});
await fs.access(path.join(dist,'index.html'));
const require=createRequire(import.meta.url);let playwright;
for(const candidate of [process.env.PLAYWRIGHT_MODULE,'playwright','/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)){
  try{playwright=require(candidate);break;}catch{}
}
assert.ok(playwright,'Preinstalled Playwright is required');
const executablePath=process.env.ZIWEI_BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const origin='https://ziwei-capability-fixture.invalid',slug='test-111',deviceId='capability-fixture-online',offlineId='capability-fixture-offline';
const repo=createRepository({memory:true}),management=createManagementService(repo),bots=management.bots;
const requests=[],pageErrors=[],unexpectedRequests=[],blockedExternal=[],results=[],screenshots=[];
const syntheticReceipts=[];let browser,context,page;
const proof={platform:'win32',supervisor:'windows-job',launched:true,rootPid:12345,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false};
function heartbeat(id,profiles=['default']){
  repo.heartbeatDevice(slug,{deviceId:id,name:id===deviceId?'合成在线电脑':'合成离线电脑',runtimes:{Hermes:{status:'available',available:true,cli_status:'available',version:'0.21.3',authenticated:true,profiles:profiles.map(name=>({name,ready:true,provider_configured:true,authentication_configured:true}))}}});
}
function validation(action,{failed=false}={}){
  repo.ackA2AAction(action.id,{deviceId:action.payload.deviceId});
  const p=action.payload.hermesBot;
  syntheticReceipts.push({actionId:action.id,kind:'synthetic-config-only-receipt',revision:p.revision,failed,externalModelCalls:0});
  return repo.resultA2AAction(action.id,{deviceId:action.payload.deviceId,status:failed?'failed':'succeeded',...(failed?{error:'合成配置检查失败：模型设置尚未通过检查'}:{}),result:{...(failed?{}:{botValidation:{schemaVersion:1,valid:true,employeeId:p.employeeId,revision:p.revision,effective:{provider:'openai-codex',model:'gpt-6.1-sol'}}}),processExit:proof,externalModelCalls:0}});
}
function seed(name,{device=deviceId,failed=false}={}){
  const bot=bots.create(slug,{name,sourceProfile:'default',targetDeviceId:device,model:'gpt-6.1-sol',persona:'合成浏览器验证员工',idempotencyKey:'capability-ui-'+(device===deviceId?(failed?'failed':'primary'):'offline'),config:{memory:{enabled:false,userProfile:true},permissions:{mode:'read_only'}}});
  completeOwnedProfile(repo,bot);
  const action=bots.validate(slug,bot.id,{expectedRevision:bot.revision,idempotencyKey:'initial-'+bot.id}).action;
  validation(action,{failed});
  return failed?bots.get(slug,bot.id):bots.control(slug,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'});
}
heartbeat(deviceId);heartbeat(offlineId);
const primary=seed('能力操作验证'),failed=seed('检查失败验证',{failed:true}),offline=seed('电脑离线验证',{device:offlineId});
heartbeat(deviceId,['default',primary.instance.profile,failed.instance.profile]);heartbeat(offlineId,['default',offline.instance.profile]);
repo.db.prepare("UPDATE devices SET status='offline',last_seen=?,heartbeat_at=? WHERE id=?").run('2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z',offlineId);
const fresh=()=>bots.get(slug,primary.id);
const initial=fresh();
assert.ok(initial.capabilities.some(cap=>cap.id==='profile_memory'&&cap.state),'Build the new capability helper before running this fixture');
const json=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
async function facade(route){
  const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
  if(url.origin!==origin){blockedExternal.push(url.origin+url.pathname);return route.abort();}
  let body=null;if(method!=='GET'&&request.postData())body=request.postDataJSON();
  if(p.startsWith('/api/')||p.startsWith('/a2a/'))requests.push({method,path:p,...(body?{body}:{}),at:new Date().toISOString()});
  try{
    if(p.startsWith('/assets/')){
      const target=path.resolve(dist,'.'+p);assert.ok(target.startsWith(dist+path.sep));
      return route.fulfill({body:await fs.readFile(target),contentType:p.endsWith('.css')?'text/css':p.endsWith('.js')?'application/javascript':p.endsWith('.woff2')?'font/woff2':'application/octet-stream'});
    }
    if(p==='/api/auth/status')return json(route,{setup_required:false,authenticated:true,user:{id:'capability-fixture-user',name:'合成浏览器验收',role:'owner'},memberships:[{slug,name:'合成能力验收',role:'owner'}]});
    if(p==='/api/workspaces')return json(route,{workspaces:[{...repo.getWorkspace(slug),role:'owner'}]});
    if(p.includes('/notifications/stream'))return route.fulfill({contentType:'text/event-stream',body:': isolated fixture\n\n'});
    if(p===`/api/workspaces/${slug}/mcp/discovery`)return json(route,management.discovery(slug,{}));
    if(p===`/api/workspaces/${slug}/bots`)return json(route,{bots:bots.list(slug)});
    const botPath=p.match(new RegExp(`^/api/workspaces/${slug}/bots/([^/]+)(.*)$`));
    if(botPath){
      const [,id,suffix]=botPath;
      if(!suffix&&method==='GET')return json(route,bots.get(slug,id));
      if(!suffix&&method==='PATCH')return json(route,bots.update(slug,id,body));
      if(suffix==='/runs')return json(route,{runs:bots.runs(slug,id)});
      if(suffix==='/routines')return json(route,{routines:bots.routines(slug,id)});
      if(suffix==='/validate'&&method==='POST'){const receipt=bots.validate(slug,id,body);validation(receipt.action);return json(route,receipt,202);}
      if(suffix==='/control'&&method==='POST')return json(route,bots.control(slug,id,body));
      throw Object.assign(new Error('Unsupported fixture Bot route: '+method+' '+suffix),{status:404});
    }
    if(p===`/api/workspaces/${slug}/summary`)return json(route,repo.getSummary(slug));
    if(p===`/api/workspaces/${slug}/settings`)return json(route,{workspace:{...repo.getWorkspace(slug),preferences:{}}});
    if(p===`/api/workspaces/${slug}/employees`)return json(route,{employees:repo.listEmployees(slug)});
    if(p===`/api/workspaces/${slug}/devices`)return json(route,{devices:repo.listDevices(slug)});
    if(p===`/api/workspaces/${slug}/runtimes`)return json(route,{runtimes:repo.listRuntimes(slug)});
    if(p===`/api/workspaces/${slug}/conversations`)return json(route,{conversations:repo.listConversations(slug)});
    if(p.startsWith('/api/conversations/')&&method==='GET')return json(route,repo.getConversation(p.split('/')[3]));
    if((p.startsWith('/api/')||p.startsWith('/a2a/'))&&method==='GET')return json(route,{tasks:[],runtimes:[],models:[{id:'gpt-6.1-sol',label:'合成模型配置'}],skills:[],documents:[],automations:[],members:[],devices:repo.listDevices(slug),employees:repo.listEmployees(slug),calendars:[],agents:[],conversations:repo.listConversations(slug),notifications:[],stats:{unread:0}});
    if(p.startsWith('/api/')||p.startsWith('/a2a/'))throw Object.assign(new Error('Unexpected mutation '+method+' '+p),{status:404});
    if(p==='/ziwei-logo.png')return route.fulfill({contentType:'image/png',body:await fs.readFile(path.join(dist,'ziwei-logo.png'))});
    if(/\.(ico|png|svg)$/.test(p))return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:'text/html',body:await fs.readFile(path.join(dist,'index.html'),'utf8')});
  }catch(error){
    if(!error.code||!/^(BOT_|EMPLOYEE_|IDEMPOTENCY_)/.test(error.code))unexpectedRequests.push({method,path:p,error:error.message});
    return json(route,{error:error.message,code:error.code||'FIXTURE_REQUEST_FAILED'},error.status||409);
  }
}
const card=id=>page.locator(`[data-capability-id="${id}"]`);
const action=id=>card(id).locator('[data-capability-action]');
const mutations=()=>requests.filter(row=>row.method!=='GET');
async function waitFor(predicate,message){for(let i=0;i<80;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail(message);}
async function openBot(id=primary.id){await page.goto(`${origin}/${slug}/bots/${id}?section=capabilities`);await card('profile_memory').waitFor();}
async function snapshot(name,{fullPage=true}={}){const target=path.join(output,name+'.png');await page.screenshot({path:target,fullPage});screenshots.push(target);}
async function noOverflow(){const widths=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(Math.max(widths.document,widths.body)<=widths.viewport+1,JSON.stringify(widths));}
async function check(name,fn){await fn();results.push({name,passed:true});console.log('passed: '+name);}
function verifyEnableOrder(start,key){
  const writes=mutations().slice(start),patch=writes.findIndex(row=>row.method==='PATCH'&&row.path.endsWith('/'+primary.id)),validate=writes.findIndex(row=>row.path.endsWith('/validate')),control=writes.findIndex(row=>row.path.endsWith('/control'));
  assert.ok(patch>=0&&validate>patch&&control>validate,JSON.stringify(writes));
  assert.equal(writes[validate].body.expectedRevision,fresh().revision);assert.equal(writes[control].body.expectedRevision,fresh().revision);
  assert.equal(writes[control].body.expectedControlEpoch,fresh().control_epoch-1);
  assert.equal(writes[control].body.operation,'activate');
  assert.equal(key==='memory'?writes[patch].body.config.memory.enabled:writes[patch].body.config.permissions.mode,key==='memory'?true:'execute');
}
try{
  browser=await playwright.chromium.launch({headless:true,executablePath,args:['--disable-background-networking']});
  context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,serviceWorkers:'block'});
  page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));page.setDefaultTimeout(15000);
  await page.route('**/*',facade);
  assert.equal(typeof page.routeWebSocket,'function','Playwright WebSocket routing is required to prevent real network connections');
  await page.routeWebSocket('**/*',socket=>socket.close());
  await openBot();
  await check('desktop uses real derived disabled/configuration cards with compact explanations',async()=>{
    assert.equal(await card('profile_memory').getAttribute('data-state'),'disabled');
    assert.equal(await card('voice').getAttribute('data-state'),'needs_configuration');
    for(const detail of await page.locator('details').all())assert.equal(await detail.getAttribute('open'),null,'advanced details are collapsed by default');
    await noOverflow();await snapshot('01-desktop-disabled');
  });
  await check('dirty draft cannot be overwritten by a capability enable action',async()=>{
    await page.getByRole('button',{name:'基础配置',exact:true}).click();await page.getByLabel('人格',{exact:true}).fill('尚未保存的合成草稿');
    await page.getByRole('button',{name:'能力组合',exact:true}).click();const before=mutations().length;
    if(!await action('profile_memory').isDisabled()){await action('profile_memory').click();await page.getByText(/^有未保存的修改，请先保存当前草稿/).waitFor();}
    assert.equal(mutations().length,before);assert.equal(fresh().config.memory.enabled,false);
    await openBot();
  });
  await check('memory enable persists, validates and restores an originally active Bot in that order',async()=>{
    const before=mutations().length,revision=fresh().revision;await action('profile_memory').click();
    await waitFor(()=>fresh().revision>revision&&fresh().config.memory.enabled===true&&fresh().control_state==='active','Memory configuration and active state did not settle');
    await waitFor(async()=>['enabled','ready'].includes(await card('profile_memory').getAttribute('data-state')),'Memory card did not read back its enabled state');
    verifyEnableOrder(before,'memory');assert.equal(fresh().config.permissions.mode,'read_only');await snapshot('02-memory-enabled');
  });
  await check('tool permission requires an explicit labelled user action',async()=>{
    assert.equal(fresh().config.permissions.mode,'read_only');await card('tools_mcp').getByRole('button',{name:'允许使用工具',exact:true}).waitFor();
    const before=mutations().length,revision=fresh().revision;await action('tools_mcp').click();
    await waitFor(()=>fresh().revision>revision&&fresh().config.permissions.mode==='execute'&&fresh().control_state==='active','Tool permission did not settle');
    verifyEnableOrder(before,'tools_permission');
  });
  await check('unconfigured capabilities navigate and focus their exact configuration regions',async()=>{
    for(const [id,region,section] of [['voice','原生语音与音频','channels'],['gateway','Gateway 渠道','channels'],['tools_mcp','原生 MCP 与工具','knowledge']]){
      await page.getByRole('button',{name:'能力组合',exact:true}).click();await card(id).waitFor();
      assert.ok((await card(id).locator('p').first().innerText()).trim().length>5);await action(id).click();
      const target=page.getByRole('region',{name:region,exact:true});await target.waitFor();
      assert.equal(new URL(page.url()).searchParams.get('section'),section);
      await waitFor(()=>target.evaluate(node=>node.contains(document.activeElement)),'Configuration target did not receive focus: '+id);
    }
    await snapshot('03-specific-configuration');
  });
  await check('failed and offline gates retain actionable capability guidance',async()=>{
    for(const [botId,state,name] of [[failed.id,'failed','04-check-failed'],[offline.id,'offline','05-device-offline']]){
      await openBot(botId);await waitFor(async()=>await card('observability').getAttribute('data-state')===state,'Expected capability gate '+state);
      const gate=page.locator('[data-capability-gate]');assert.ok((await gate.innerText()).trim().length>8);
      assert.ok(await gate.locator('button').count()>0);assert.equal(await page.locator('[data-capability-id][data-state="ready"],[data-capability-id][data-state="enabled"]').count(),0);
      await noOverflow();await snapshot(name);
    }
  });
  await check('390px layout keeps capability cards and specific configuration within the viewport',async()=>{
    await page.setViewportSize({width:390,height:844});await openBot();await noOverflow();
    const creatorButton=page.getByRole('button',{name:'伙伴市场 Creator',exact:true});await creatorButton.evaluate(node=>node.scrollIntoView({block:'start'}));
    assert.ok(await creatorButton.evaluate(node=>{const box=node.getBoundingClientRect(),parent=node.parentElement.getBoundingClientRect();return box.left>=parent.left-1&&box.right<=parent.right+1&&box.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1;}),'Creator button must fit its mobile roster container without clipped text');
    await snapshot('08-mobile-roster',{fullPage:false});await card('profile_memory').evaluate(node=>node.scrollIntoView({block:'start'}));await snapshot('06-mobile-capabilities',{fullPage:false});
    await action('voice').click();const voiceRegion=page.getByRole('region',{name:'原生语音与音频',exact:true});await voiceRegion.waitFor();await noOverflow();await voiceRegion.evaluate(node=>node.scrollIntoView({block:'start'}));await snapshot('07-mobile-voice-configuration',{fullPage:false});
  });
  assert.deepEqual(pageErrors,[]);assert.deepEqual(unexpectedRequests,[]);
}catch(error){
  results.push({name:'fixture failure',passed:false,error:error.message});
  if(page)try{await snapshot('failure');}catch{}
  process.exitCode=1;
}finally{
  const report={kind:'real-built-ui-with-in-memory-repository-and-synthetic-device-receipts',listenerStarted:false,externalModelCalls:0,realDeviceConnected:false,results,pageErrors,unexpectedRequests,blockedExternal,requests,syntheticReceipts,screenshots,finalPrimaryBot:fresh(),generatedAt:new Date().toISOString()};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  await context?.close();await browser?.close();repo.db.close();
  console.log(JSON.stringify({report:path.join(output,'report.json'),passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,pageErrors,screenshots}));
}
