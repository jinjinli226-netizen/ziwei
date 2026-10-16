// No HTTP listener: Chromium requests are intercepted into a real in-memory
// repository. Device/model receipts below are synthetic and never reach production.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createRepository} from '../../backend/repository.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url))),web=path.join(root,'mobile-manager/web'),out=path.join(root,'.local/mobile-manager-qa');
await fs.mkdir(out,{recursive:true});
const repo=createRepository({memory:true}),slug='test-111',deviceId='manager-qa-pc',origin='https://ziwei-manager.invalid';
repo.heartbeatDevice(slug,{deviceId,name:'隔离验收电脑',workdir:'/qa',runtimes:{Codex:{status:'available',version:'synthetic',profiles:[{name:'default'}]}}});
const first=repo.createEmployee(slug,{name:'闲鱼运营大神 · 验收',description:'闲鱼运营与客户维护',runtime:'Codex',runtimeProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol'});
const second=repo.createEmployee(slug,{name:'TikTokTrendS · 验收',description:'无限爆款探索员',runtime:'Codex',runtimeProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol'});
const employeeIds=new Set([first.id,second.id]);
const task=repo.createTask(slug,{title:'待核对的真实验收记录',description:'这条记录只存在于内存验收数据库。',assignee:first.id,state:'in_progress'});
const requests=[],errors=[],screenshots=[];
let authenticated=true,phoneCommands=0;
const phone={id:'qa-phone',alias:'隔离验收手机',nodes:[{role:'agent',status:'offline',lastSeen:'2026-10-16T12:00:00Z',health:{accessibility:false}}],control:{role:'agent',epoch:1},commands:[],snapshot:null};
const browser=await chromium.launch({executablePath:process.env.ZIWEI_BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:393,height:851},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror',error=>errors.push(error.message));
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method(),body=req.postData()?req.postDataJSON():{};
  if(url.origin!==origin){errors.push(`Unexpected external request ${url.origin}${p}`);return route.abort();}
  if(p.startsWith('/__ziwei_manager__/')){
    const name=p.slice('/__ziwei_manager__/'.length)||'index.html';if(!/^[a-z-]+\.(html|js|css)$/.test(name))return route.abort();
    return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:await fs.readFile(path.join(web,name))});
  }
  requests.push({method,path:p,body});
  try{
    if(p==='/api/auth/me')return json(route,authenticated?{user_id:'qa-user',user:{id:'qa-user',name:'隔离验收',email:'qa@example.test'},memberships:[{slug,name:'隔离验收',role:'owner'}]}:{error:'请登录'},authenticated?200:401);
    if(p==='/api/auth/login'){authenticated=true;return json(route,{user_id:'qa-user',user:{id:'qa-user',name:'隔离验收'}});}
    if(p==='/api/auth/logout'){authenticated=false;return json(route,{ok:true});}
    if(!authenticated)return json(route,{error:'请登录'},401);
    if(p==='/api/workspaces')return json(route,{workspaces:[{slug,name:'隔离验收',role:'owner'}]});
    const base=`/api/workspaces/${slug}`;
    if(p===base+'/employees')return json(route,{employees:repo.listEmployees(slug).filter(e=>employeeIds.has(e.id))});
    if(p===base+'/bots')return json(route,{bots:[]});
    if(p===base+'/tasks'){if(method==='POST')return json(route,repo.createTask(slug,body),201);return json(route,{tasks:repo.listTasks(slug)});}
    const employeeMatch=p.match(new RegExp(`^${base}/employees/([^/]+)$`));
    if(employeeMatch&&method==='PATCH')return json(route,repo.updateEmployee(slug,employeeMatch[1],body));
    if(p===base+'/devices')return json(route,{devices:repo.listDevices(slug)});
    if(p===base+'/conversations'){
      if(method==='POST')return json(route,repo.createConversation(slug,body),201);
      return json(route,{conversations:repo.listConversations(slug,{conversationEmployeeId:url.searchParams.get('employeeId')})});
    }
    const conv=p.match(/^\/api\/conversations\/([^/]+)(\/messages)?$/);
    if(conv){if(method==='POST')return json(route,repo.addConversationMessage(conv[1],body),201);return json(route,repo.getConversation(conv[1]));}
    const taskMatch=p.match(/^\/api\/tasks\/([^/]+)(\/state)?$/);
    if(taskMatch){if(method==='PATCH')return json(route,repo.updateTask(taskMatch[1],body));if(method==='POST')return json(route,repo.transitionTask(taskMatch[1],body.state));return json(route,repo.getTask(taskMatch[1]));}
    if(p===base+'/ziwei-connect/terminal/android-devices')return json(route,{devices:[phone]});
    if(p.endsWith('/qa-phone/status'))return json(route,{device:phone});
    if(p.endsWith('/qa-phone/snapshot'))return json(route,{snapshot:phone.snapshot});
    if(p.endsWith('/qa-phone/commands')){phoneCommands++;const command={id:'qa-command',status:'queued',action:body.action};phone.commands.push(command);return json(route,{command},202);}
    errors.push(`Unhandled ${method} ${p}`);return json(route,{error:'Unimplemented fixture'},404);
  }catch(error){return json(route,{error:error.message,code:error.code},error.status||400);}
});
const capture=async name=>{await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});screenshots.push(name);};
const click=async(action,id)=>{const locator=page.locator(`[data-action="${action}"]${id?`[data-id="${id}"]`:''}`).first();if(action==='refresh'&&!await locator.count())return page.evaluate(()=>window.dispatchEvent(new Event('ziwei:resume')));return locator.click();};
try{
  await page.goto(`${origin}/__ziwei_manager__/index.html`);await page.getByRole('heading',{name:'我的员工',exact:true}).waitFor();await capture('01-employees');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await click('chat',first.id);await page.locator('[name=draft]').fill('这是一条隔离验收消息');await page.locator('[data-form=chat]').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>document.body.innerText.includes('这是一条隔离验收消息'));
  const messageRequest=requests.find(r=>r.method==='POST'&&r.path.endsWith('/messages'));assert.ok(messageRequest.body.clientMessageId);
  const conversation=repo.listConversations(slug,{conversationEmployeeId:first.id})[0],execution=repo.getConversation(conversation.id).execution;
  assert.ok(execution?.id);repo.ackA2AAction(execution.id,{deviceId});repo.resultA2AAction(execution.id,{deviceId,status:'succeeded',result:{output:'收到。这是内存夹具返回的执行结果。'}});
  await click('refresh');await page.getByText('收到。这是内存夹具返回的执行结果。',{exact:true}).waitFor();await capture('02-chat');
  // Photo picker data travels as real base64 bytes through the existing API.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  await page.locator('input[name=images]').setInputFiles({name:'qa.png',mimeType:'image/png',buffer:png});await page.locator('[name=draft]').fill('隔离图片');await page.locator('[data-form=chat]').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>document.querySelector('[name=draft]')?.value==='');
  const photoRequest=requests.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).at(-1);assert.equal(photoRequest.body.attachments[0].content,png.toString('base64'));
  const photoExecution=repo.getConversation(conversation.id).execution;repo.ackA2AAction(photoExecution.id,{deviceId});repo.resultA2AAction(photoExecution.id,{deviceId,status:'succeeded',result:{output:'图片已到达隔离执行器。'}});
  await click('back');await click('report-setup');await click('report-toggle',first.id);await click('report-toggle',second.id);await capture('03-report-queue');
  await click('report-up',second.id);await click('report-start');
  // Second employee has no task/execution evidence; no fabricated report is sent.
  await page.getByText('暂无记录',{exact:true}).first().waitFor();assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length,2);
  await click('report-next');await page.waitForFunction(()=>document.body.innerText.includes('请汇报实际进展'));
  const reportExecution=repo.getConversation(conversation.id).execution;repo.ackA2AAction(reportExecution.id,{deviceId});repo.resultA2AAction(reportExecution.id,{deviceId,status:'succeeded',result:{output:'实际进展：任务进行中。\n成果：尚未完成。\n卡点：无已确认卡点。\n下一步计划：继续核对记录。'}});
  await click('refresh');await page.getByText('实际进展：任务进行中。',{exact:false}).first().waitFor();await capture('04-report');
  await page.locator('[name=draft]').fill('需要我协助什么？');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  const followup=repo.getConversation(conversation.id).execution;repo.ackA2AAction(followup.id,{deviceId});repo.resultA2AAction(followup.id,{deviceId,status:'succeeded',result:{output:'这是一条独立追问回执。'}});
  await click('refresh');await page.getByText('这是一条独立追问回执。',{exact:true}).waitFor();
  const sentBeforeReload=requests.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length;
  await page.reload();await page.getByRole('heading',{name:'我的员工',exact:true}).waitFor();await click('report-setup');await page.getByText('实际进展：任务进行中。',{exact:false}).first().waitFor();
  assert.equal(requests.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length,sentBeforeReload);
  await click('report-next');await page.getByRole('heading',{name:'汇报已整理',exact:true}).waitFor();await capture('05-summary');
  await click('report-todo','0');await page.getByText('已加入',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.method==='POST'&&r.path===`/api/workspaces/${slug}/tasks`).length,1);
  await click('report-home');await page.locator('[data-action=navigate][data-tab=work]').click();await page.getByText(task.title,{exact:true}).waitFor();await capture('06-work');
  await click('task',task.id);await page.locator('[name=title]').fill('修改后的隔离任务');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByText('已保存',{exact:false}).first().waitFor();assert.equal(repo.getTask(task.id).title,'修改后的隔离任务');
  await click('back');await page.locator('[data-action=navigate][data-tab=devices]').click();await page.getByText(phone.alias,{exact:true}).waitFor();await click('phone',phone.id);await capture('07-phone');assert.equal(phoneCommands,0);
  await page.setViewportSize({width:360,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await click('back');await page.locator('[data-action=navigate][data-tab=me]').click();await click('logout');await page.locator('[data-form=login]').waitFor();await capture('08-login');
  assert.deepEqual(errors,[]);
  const result={passed:true,checks:['mobile navigation','existing employee conversation','message idempotency key','photo byte transport','ordered report selection','no-record honesty','exact execution reporting','report followup','resume without redispatch','summary','confirmed planned todo creation','task editing','offline phone state','360px no overflow','logout'],screenshots,requests:requests.length,realDeviceActions:0,externalModelCalls:0,evidence:'real in-memory repository; synthetic receipts; no listeners'};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await capture('failure');await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:error.message,errors,requests,body:await page.locator('body').innerText(),forms:await page.locator('form').evaluateAll(forms=>forms.map(f=>({valid:f.checkValidity(),html:f.outerHTML})))},null,2));throw error;}finally{await browser.close();repo.db.close();}
