// Real repository + intercepted browser requests. No listeners or live account/device actions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
import {openSecret} from '../../src/bot-secret-crypto.mjs';
import {createRepository} from '../../backend/repository.mjs';
import {createAuthService} from '../../backend/auth.mjs';
import {createConversationReadService} from '../../backend/conversation-read-state.mjs';
import {createMobileReadView} from '../../backend/mobile-read-view.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url))),web=path.join(root,'mobile-manager/web'),out=path.join(root,'.local/mobile-cockpit-qa');
await fs.mkdir(out,{recursive:true});
const repo=createRepository({memory:true}),slug='test-111',deviceId='cockpit-fixture-pc',origin='https://mobile-cockpit.invalid';
const principal=createAuthService(repo.db).setup({name:'手机体验验收',email:'mobile@example.test',password:'isolated-fixture-password'}),userId=principal.user_id;
const actor={actorUserId:userId,actorRole:'owner',enforceEmployeeVisibility:true};
repo.db.prepare('INSERT INTO members(id,user_id,workspace_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?,?)').run('mobile-owner',userId,repo.getWorkspace(slug).id,'手机体验验收','mobile@example.test','owner',new Date().toISOString());
repo.heartbeatDevice(slug,{deviceId,name:'工作电脑',workdir:'D:/Work',runtimes:{Codex:{status:'available',profiles:[{name:'default'}]}}});
const employees=[['内容策划','选题、脚本与品牌内容','grok:bean:blue'],['跨境研究员','市场趋势与出海资料','grok:cloud:orange'],['运营伙伴','每天的工作与复盘','grok:squircle:green']].map(([name,description,avatar])=>repo.createEmployee(slug,{name,description,avatar,runtime:'Codex',runtimeProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol'}));
const chats=employees.map(employee=>repo.createConversation(slug,{employeeId:employee.id,title:`${employee.name} · 长期会话`,...actor}));
const first=chats[0],second=repo.createConversation(slug,{employeeId:employees[0].id,title:'新品发布 · 专项会话',...actor});
repo.addConversationMessage(second.id,{role:'assistant',content:'这里单独整理新品发布的素材与排期。',...actor});
for(let index=0;index<34;index++)repo.addConversationMessage(first.id,{role:'assistant',content:index===33?'## 今天的内容安排\n\n已经整理好三个方向，可以从第一条开始。\n\n- **品牌故事**：让用户先认识我们\n- **产品场景**：用真实问题讲清价值\n- **经验分享**：记录今天学到的一件事\n\n| 任务 | 状态 |\n| --- | --- |\n| 选题整理 | 已完成 |\n| 口播脚本 | 待你确认 |\n\n```js\nconst next = "继续打磨第一条脚本";\n```':`第 ${index+1} 条工作记录\n${'关于选题的材料、执行记录与下一步安排。'.repeat(7)}`,...actor});
const reads=createConversationReadService(repo),mobile=createMobileReadView(repo),requests=[],errors=[],screenshots=[],checks=[];
let interactionMode=false, interactionRequest=null, interactionKeys=null, interactionPosts=0;
const fixtureBot=()=>({id:employees[0].id,employee_id:employees[0].id,employee:{...employees[0],runtime:'Hermes'},configuration_state:'initialized',control_state:'active',main_conversation_id:first.id,latest_run:repo.getConversation(first.id,actor).execution});
const browser=await chromium.launch({headless:true,executablePath:process.env.ZIWEI_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'}),page=await context.newPage();
page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method(),body=request.postData()?request.postDataJSON():{};
 const avatar=p.match(/^\/api\/workspaces\/test-111\/employees\/([^/]+)\/avatar$/);
 if(avatar && [origin,'https://qzelynth.top'].includes(url.origin)){const source=mobile.avatar(slug,avatar[1],actor);return route.fulfill({status:source?200:404,contentType:source?.mimeType||'text/plain',body:source?.bytes||''});}
 if(url.origin!==origin){errors.push('Unexpected external request');return route.abort();}
 if(p.startsWith('/__ziwei_manager__/')){const asset=p.slice('/__ziwei_manager__/'.length)||'index.html';if(!/^[a-z-]+\.(html|m?js|css|png)$/.test(asset))return route.abort();return route.fulfill({contentType:/\.m?js$/.test(asset)?'application/javascript':asset.endsWith('.css')?'text/css':asset.endsWith('.png')?'image/png':'text/html',body:await fs.readFile(path.join(web,asset))});}
 requests.push({method,path:p,query:url.search});
 try{
  if(p==='/api/auth/me')return json(route,{user_id:userId,user:{id:userId,name:'手机体验验收'}});
  if(p==='/api/workspaces')return json(route,{workspaces:[{slug,name:'紫薇映界',role:'owner'}]});
  const base=`/api/workspaces/${slug}`;
  if(p===base+'/chats')return json(route,reads.list(slug,actor));
  if(p===base+'/employees')return json(route,{employees:mobile.employees(slug,repo.listEmployees(slug).filter(row=>employees.some(employee=>employee.id===row.id))).map(row=>interactionMode&&row.id===employees[0].id?{...row,runtime:'Hermes'}:row)});
  if(p===base+'/bots')return json(route,{bots:interactionMode?[fixtureBot()]:[]});
  if(interactionMode && p===`${base}/bots/${employees[0].id}`)return json(route,fixtureBot());
  if(interactionMode && p===`${base}/bots/${employees[0].id}/runs`)return json(route,{runs:[repo.getA2AAction(interactionRequest.actionId)]});
  if(interactionMode && p===`${base}/bots/${employees[0].id}/routines`)return json(route,{routines:[]});
  if(interactionMode && p===`${base}/bots/${employees[0].id}/interactions`)return json(route,{requests:[interactionRequest]});
  if(interactionMode && p===`${base}/bots/${employees[0].id}/interactions/${interactionRequest.requestId}`){
   assert.deepEqual(Object.keys(body),['envelope']);assert.deepEqual(JSON.parse(openSecret(interactionKeys.privateKey,interactionRequest.binding,body.envelope)),{answer:'once'});
   assert(!JSON.stringify(body).includes('once'));interactionPosts++;interactionRequest={...interactionRequest,state:'answered'};return json(route,interactionRequest);
  }
  if(p===base+'/tasks')return json(route,{tasks:[]});
  if(p===base+'/devices')return json(route,{devices:repo.listDevices(slug)});
  if(p===base+'/conversations')return json(route,{conversations:repo.listConversations(slug,{...actor,conversationEmployeeId:url.searchParams.get('employeeId')})});
  const action=p.match(new RegExp(`^${base}/actions/([^/]+)$`));if(action)return json(route,repo.getA2AAction(action[1]));
  const conv=p.match(/^\/api\/conversations\/([^/]+)$/);if(conv)return json(route,repo.getConversation(conv[1],actor,Object.fromEntries(url.searchParams)));
  const read=p.match(/^\/api\/conversations\/([^/]+)\/read$/);if(read)return json(route,reads.read(read[1],body,actor));
  const message=p.match(/^\/api\/conversations\/([^/]+)\/messages$/);if(message)return json(route,repo.addConversationMessage(message[1],{...body,...actor}),201);
  const queue=p.match(/^\/api\/conversations\/([^/]+)\/queue\/(.+)$/);if(queue)return json(route,method==='DELETE'?repo.removeConversationQueueItem(queue[1],queue[2],actor):queue[2]==='pause'?repo.pauseConversationQueue(queue[1],actor):repo.resumeConversationQueue(queue[1],actor));
  errors.push(`Unhandled ${method} ${p}`);return json(route,{error:'Unhandled fixture'},404);
 }catch(error){return json(route,{error:error.message,code:error.code},error.status||400);}
});
const click=(action,id)=>page.locator(`[data-action="${action}"]${id?`[data-id="${id}"]`:''}`).first().click();
const refresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('ziwei:resume')));
const raf=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const capture=async name=>{await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode().catch(()=>{}))));await page.screenshot({path:path.join(out,`${name}.png`)});screenshots.push(name);};
const bounds=async()=>{
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert(await page.locator('.composer').evaluate(node=>{const box=node.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight+1;}));
};
try{
 await page.goto(`${origin}/__ziwei_manager__/index.html`);await page.locator('.thread-row').first().waitFor();await capture('01-inbox-390');
 await click('chat',employees[0].id);await page.locator('.markdown table').waitFor();
 assert.equal(await page.locator('.message').count(),10);assert(requests.some(request=>request.path===`/api/conversations/${first.id}`&&request.query.includes('view=thread')));
 await bounds();await capture('02-chat-390');
 const timeline=page.locator('.chat-timeline');await timeline.evaluate(node=>node.scrollTop=0);await raf();
 const anchor=await page.locator('[data-message-id]').first().getAttribute('data-message-id');
 await click('chat-history');await page.waitForFunction(()=>document.querySelectorAll('.message').length===20);await raf();
 assert(await page.locator(`[data-message-id="${anchor}"]`).evaluate(node=>{const box=node.getBoundingClientRect(),parent=node.closest('.chat-timeline').getBoundingClientRect();return box.bottom>parent.top;}));
 assert(await page.locator('[data-action=chat-latest]').isVisible());await click('chat-latest');
 assert(await timeline.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop<=1));
 checks.push('10-row real thread pagination, prepend anchor, jump-to-latest');
 await page.locator('[name=draft]').fill('主会话草稿');await click('chat-sessions');await page.getByRole('button',{name:/新品发布 · 专项会话/}).waitFor();await capture('03-sessions-390');
 await click('chat-session-open',second.id);await page.getByText('这里单独整理新品发布的素材与排期。',{exact:true}).waitFor();assert.equal(await page.locator('[name=draft]').inputValue(),'');
 await page.locator('[name=draft]').fill('专项会话草稿');await click('chat-sessions');await click('chat-session-open',first.id);await page.locator('.markdown table').waitFor();assert.equal(await page.locator('[name=draft]').inputValue(),'主会话草稿');checks.push('canonical employee sessions and independent drafts');
 await page.locator('[name=draft]').fill('先整理第一条脚本');await page.locator('[data-form=chat]').evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>document.querySelector('[name=draft]')?.value==='');
 const execution=repo.getConversation(first.id,actor).execution;repo.ackA2AAction(execution.id,{deviceId});
 repo.recordA2AEvent(execution.id,{type:'action.progress',message:'正在整理选题材料',data:{stage:'tool',detail:'读取工作资料'}});
 await refresh();await page.getByText('读取工作资料',{exact:true}).waitFor();
 await page.locator('[name=draft]').fill('完成后，再补一条简短版');await page.locator('[data-form=chat]').evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>document.querySelector('[name=draft]')?.value==='');
 assert.equal(repo.getA2AAction(execution.id).status,'acked');assert.equal(requests.filter(request=>request.method==='POST'&&request.path.endsWith('/messages')).length,2);
 await page.locator('.chat-queue > summary').click();await click('queue-pause');await page.getByText(/待发消息 · 1 条 · 已暂停/).waitFor();await capture('04-queue-390');
 const queued=repo.getConversation(first.id,actor).queue.items[0];await click('queue-remove',queued.id);await page.getByText(/待发消息 · 0 条 · 已暂停/).waitFor();assert.equal(repo.getA2AAction(execution.id).status,'acked');checks.push('continuous sends enqueue without interrupting active action; pause/remove preserve running action');
 for(const width of [320,360,430]){await page.setViewportSize({width,height:844});await raf();await bounds();await capture(`05-chat-${width}`);}
 await page.setViewportSize({width:390,height:430});await page.locator('[name=draft]').fill('键盘弹出后的草稿\n仍然可以继续输入');await raf();await bounds();await capture('06-keyboard-viewport');checks.push('320/360/390/430 widths and 430px keyboard viewport: composer visible, no page overflow');
 interactionKeys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const expiresAt=Math.floor(Date.now()/1000)+300;
 interactionRequest={requestId:'fixture-approval',workspace:slug,employeeId:employees[0].id,actionId:execution.id,kind:'approval',secure:false,state:'waiting',expiresAt:expiresAt*1000,display:{description:'将本次确认的脚本写入当前工作目录'},choices:['once','deny'],devicePublicKey:interactionKeys.publicKey,binding:{purpose:'hermes-interaction',requestId:'fixture-approval',kind:'approval',expiresAt,workspaceId:repo.getWorkspace(slug).id,employeeId:employees[0].id,actionId:execution.id,deviceId,profile:'default',revision:1,controlEpoch:1,keyId:'fixture-device-key'}};
 interactionMode=true;await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('.thread-row').first().waitFor();await click('chat',employees[0].id);
 await page.getByRole('button',{name:'仅本次允许',exact:true}).waitFor();assert.equal(interactionPosts,0);await capture('07-approval-390');
 await page.getByRole('button',{name:'仅本次允许',exact:true}).click();await page.getByText('已提交，等待员工接收',{exact:true}).waitFor();assert.equal(interactionPosts,1);checks.push('explicit Hermes approval click includes submitter value and sends only a device-compatible encrypted envelope');
 assert.deepEqual(errors,[]);
 const result={passed:true,checks,screenshots,externalRequests:0,localListeners:0,realDeviceActions:0,productionWrites:0,evidence:'Real in-memory repository; browser route interception; synthetic execution receipts; viewport is not a native Android keyboard'};
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();repo.db.close();}
