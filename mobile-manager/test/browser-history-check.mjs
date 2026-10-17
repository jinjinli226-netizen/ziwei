// No HTTP listener or production requests: real in-memory repository shapes,
// including initialized Hermes Bots, are served through Playwright routes.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createRepository} from '../../backend/repository.mjs';
import {createManagementService} from '../../backend/management.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const web=path.join(root,'mobile-manager/web'),out=path.join(root,'.local/mobile-manager-history-qa');
await fs.mkdir(out,{recursive:true});
const origin='https://ziwei-history.invalid',slug='test-111',deviceId='history-qa-pc';
const repo=createRepository({memory:true}),bots=createManagementService(repo).bots;
repo.heartbeatDevice(slug,{deviceId,name:'隔离历史验收电脑',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:[{name:'default'}],models:[{id:'history-qa-model'}]}}});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const marker='原主会话历史 HERMES-HISTORY-ORIGINAL';
const secondMarker='第二位员工的独立历史 HERMES-HISTORY-SECOND';
const longHistory=`${marker}\n${'这是一段来自原主会话的长期工作记录，包含真实格式的文字与换行。\n'.repeat(160)}`;
const createEmployee=(name,text)=>{
  const employee=repo.createEmployee(slug,{name,runtime:'Hermes',runtimeProfile:'default',targetDeviceId:deviceId,model:'history-qa-model'});
  const conversation=repo.createConversation(slug,{employeeId:employee.id,title:`${name} · 原长期聊天`});
  repo.addConversationMessage(conversation.id,{role:'assistant',content:text,dispatch:false});
  const bot=bots.initialize(slug,employee.id,{idempotencyKey:`history-qa:${employee.id}`});
  assert.equal(bot.configuration_state,'initialized');
  assert.equal(bot.main_conversation_id,conversation.id);
  return {employee,conversation,bot};
};
const first=createEmployee('闲鱼运营大神 · 隔离历史验收',longHistory);
repo.addConversationMessage(first.conversation.id,{role:'assistant',content:'原聊天图片 HERMES-HISTORY-IMAGE',attachments:[{name:'original.png',mimeType:'image/png',size:Buffer.from(png,'base64').length,contentEncoding:'base64',content:png}],dispatch:false});
const second=createEmployee('TikTokTrendS · 隔离历史验收',secondMarker);
const employeeIds=new Set([first.employee.id,second.employee.id]);
const requests=[],errors=[],screenshots=[],checks=[],sessions=[];
const browser=await chromium.launch({executablePath:process.env.ZIWEI_BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let activePage;

async function fixture(name,{botMode='ok',auxMode='ok',firstHistoryFailures=0,holdFirstHistory=false}={}){
  const context=await browser.newContext({viewport:{width:393,height:851},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage(),pending=[];
  activePage=page;page.setDefaultTimeout(6000);
  page.on('pageerror',error=>errors.push({scenario:name,message:error.message}));
  const control={botMode,auxMode,firstHistoryFailures,holdFirstHistory};
  const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  const gated=async(route,kind,data)=>{
    let mode=control[kind];
    if(mode==='hang')mode=await new Promise(resolve=>pending.push({kind,resolve}));
    return mode==='fail'?json(route,{error:`辅助读取失败：${kind}`},503):json(route,data);
  };
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
    if(url.origin!==origin){errors.push({scenario:name,message:`Unexpected external request ${url.origin}${p}`});return route.abort();}
    if(p.startsWith('/__ziwei_manager__/')){
      const asset=p.slice('/__ziwei_manager__/'.length)||'index.html';
      if(!/^[a-z-]+\.(html|js|css|png)$/.test(asset))return route.abort();
      return route.fulfill({contentType:asset.endsWith('.js')?'application/javascript':asset.endsWith('.css')?'text/css':asset.endsWith('.png')?'image/png':'text/html',body:await fs.readFile(path.join(web,asset))});
    }
    const entry={scenario:name,method,path:p};requests.push(entry);
    try{
      if(method!=='GET')throw new Error(`Unexpected write ${method} ${p}`);
      if(p==='/api/auth/me')return json(route,{user_id:'history-qa-user',user:{id:'history-qa-user',name:'隔离历史验收'},memberships:[{slug,name:'隔离历史验收',role:'owner'}]});
      if(p==='/api/workspaces')return json(route,{workspaces:[{slug,name:'隔离历史验收',role:'owner'}]});
      const base=`/api/workspaces/${slug}`;
      if(p===`${base}/employees`)return json(route,{employees:repo.listEmployees(slug).filter(employee=>employeeIds.has(employee.id))});
      if(p===`${base}/bots`)return json(route,{bots:bots.list(slug).filter(bot=>employeeIds.has(bot.id))});
      if(p===`${base}/tasks`)return json(route,{tasks:repo.listTasks(slug)});
      if(p===`${base}/devices`)return json(route,{devices:repo.listDevices(slug)});
      if(p===`${base}/conversations`)return json(route,{conversations:repo.listConversations(slug,{conversationEmployeeId:url.searchParams.get('employeeId')})});
      const bot=p.match(new RegExp(`^${base}/bots/([^/]+)(?:/(runs|routines))?$`));
      if(bot){
        if(bot[2]==='runs')return gated(route,'auxMode',{runs:bots.runs(slug,bot[1])});
        if(bot[2]==='routines')return gated(route,'auxMode',{routines:bots.routines(slug,bot[1])});
        return gated(route,'botMode',bots.get(slug,bot[1]));
      }
      const conversation=p.match(/^\/api\/conversations\/([^/]+)$/);
      if(conversation){
        if(conversation[1]===first.conversation.id){
          if(control.firstHistoryFailures>0){control.firstHistoryFailures--;entry.status=503;return json(route,{error:'原主聊天暂时不可用（隔离 503）'},503);}
          if(control.holdFirstHistory)await new Promise(resolve=>pending.push({kind:'history',resolve}));
        }
        entry.status=200;return json(route,repo.getConversation(conversation[1]));
      }
      throw new Error(`Unhandled ${method} ${p}`);
    }catch(error){errors.push({scenario:name,message:error.message});return json(route,{error:error.message},500);}
  });
  const release=(kind,mode='ok')=>{
    if(kind==='history')control.holdFirstHistory=false;else control[kind]=mode;
    for(let index=pending.length-1;index>=0;index--)if(pending[index].kind===kind)pending.splice(index,1)[0].resolve(mode);
  };
  const close=async()=>{release('history');release('botMode');release('auxMode');await context.close();};
  const session={page,control,pending,release,close};sessions.push(session);
  await page.goto(`${origin}/__ziwei_manager__/index.html`);
  await page.getByRole('heading',{name:'我的员工',exact:true}).waitFor();
  return session;
}
const chat=(page,id)=>page.locator(`[data-action=chat][data-id="${id}"]`).first().click();
const capture=async(page,name)=>{await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});screenshots.push(name);};
const showHistory=async page=>page.getByText(marker,{exact:false}).first().waitFor({state:'visible',timeout:3000});

try{
  const slow=await fixture('slow-auxiliary',{botMode:'hang',auxMode:'hang'});
  await chat(slow.page,first.employee.id);await showHistory(slow.page);
  assert.ok(slow.pending.some(item=>item.kind==='botMode'),'Bot detail must actually remain in flight');
  assert.ok(slow.pending.some(item=>item.kind==='auxMode'),'Runs/routines must actually remain in flight');
  const draft=slow.page.locator('textarea[name=draft]');
  assert.equal(await draft.isEnabled(),true);await draft.fill('辅助接口仍在等待时，可以编辑草稿。');
  const image=slow.page.locator('.message-image img').first();
  await image.evaluate(img=>img.decode());
  assert.equal(await image.evaluate(img=>img.naturalWidth),1);
  assert.equal(await image.getAttribute('src'),`data:image/png;base64,${png}`);
  const bounds=await slow.page.locator('.chat-history').evaluate(element=>({height:element.clientHeight,scrollHeight:element.scrollHeight,width:element.clientWidth}));
  assert.ok(bounds.height>100&&bounds.width>100&&bounds.scrollHeight>bounds.height,'Long history must have a usable scroll container');
  await capture(slow.page,'01-history-visible-with-aux-pending');
  checks.push('cached initialized Hermes main history renders before hanging Bot/runs/routines','long text scrolls and original base64 image decodes','draft editable during auxiliary requests');

  slow.release('botMode','fail');slow.release('auxMode','fail');
  await slow.page.getByText('辅助读取失败：',{exact:false}).first().waitFor();
  await showHistory(slow.page);assert.equal(await draft.inputValue(),'辅助接口仍在等待时，可以编辑草稿。');
  checks.push('auxiliary failures show an error without clearing history or draft');

  repo.addConversationMessage(first.conversation.id,{role:'assistant',content:'刷新新增历史 HERMES-HISTORY-REFRESH',dispatch:false});
  slow.control.botMode='hang';slow.control.auxMode='hang';
  await slow.page.evaluate(()=>window.dispatchEvent(new CustomEvent('ziwei:resume')));
  await slow.page.getByText('刷新新增历史 HERMES-HISTORY-REFRESH',{exact:true}).waitFor({state:'visible',timeout:3000});
  assert.equal(await draft.inputValue(),'辅助接口仍在等待时，可以编辑草稿。');
  assert.ok(slow.pending.length>0,'Refreshed history must render before auxiliary completion');
  await capture(slow.page,'02-refresh-visible-with-aux-pending');checks.push('refresh paints new history before auxiliary completion');
  await slow.close();

  const retry=await fixture('original-main-retry',{firstHistoryFailures:1});
  await chat(retry.page,first.employee.id);
  await retry.page.getByText('原主聊天暂时不可用（隔离 503）',{exact:false}).first().waitFor();
  assert.equal(await retry.page.locator('.message').count(),0);
  await capture(retry.page,'03-original-main-read-failure');
  await retry.page.locator('.banner.error [data-action=refresh]').first().click();
  await showHistory(retry.page);
  const retryReads=requests.filter(entry=>entry.scenario==='original-main-retry'&&entry.path===`/api/conversations/${first.conversation.id}`);
  assert.equal(retryReads[0].status,503);assert.ok(retryReads.some(entry=>entry.status===200));
  await capture(retry.page,'04-original-main-retry-success');checks.push('first history GET 503 is explicit and refresh retries the same main conversation');
  await retry.close();

  const late=await fixture('employee-switch-isolation',{holdFirstHistory:true});
  const historyRequested=late.page.waitForRequest(request=>new URL(request.url()).pathname===`/api/conversations/${first.conversation.id}`);
  await chat(late.page,first.employee.id);await historyRequested;
  await late.page.locator('[data-action=back]').first().click();
  await chat(late.page,second.employee.id);
  await late.page.getByText(secondMarker,{exact:true}).waitFor();
  const oldResponse=late.page.waitForResponse(response=>new URL(response.url()).pathname===`/api/conversations/${first.conversation.id}`);
  late.release('history');await oldResponse;
  await late.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await late.page.getByRole('heading',{name:second.employee.name,exact:true}).count(),1);
  assert.equal(await late.page.getByText(secondMarker,{exact:true}).count(),1);
  assert.equal(await late.page.getByText(marker,{exact:false}).count(),0);
  await capture(late.page,'05-late-history-isolated');checks.push('late original history cannot overwrite another employee chat');
  await late.close();

  assert.deepEqual(errors,[]);
  assert.ok(requests.every(request=>request.method==='GET'),'History checks must never write through an API');
  const result={passed:true,checks,screenshots,requests:requests.length,conversationCreates:0,realDeviceActions:0,externalModelCalls:0,evidence:'real in-memory initialized Hermes Bot and conversation shapes; routed HTTP only; no listeners'};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(error){
  const evidence={passed:false,error:error.stack||error.message,errors,requests,checks};
  if(activePage&&!activePage.isClosed()){
    await capture(activePage,'failure').catch(()=>{});
    evidence.body=await activePage.locator('body').innerText().catch(()=>null);
    evidence.layout=await activePage.locator('.app-shell,.chat-main,.chat-history,.composer-area').evaluateAll(elements=>elements.map(element=>({className:element.className,rect:element.getBoundingClientRect().toJSON(),text:element.innerText.slice(0,400)}))).catch(()=>null);
  }
  await fs.writeFile(path.join(out,'failure.json'),JSON.stringify(evidence,null,2)+'\n');throw error;
}finally{
  for(const session of sessions)await session.close().catch(()=>{});
  await browser.close();repo.db.close();
}
