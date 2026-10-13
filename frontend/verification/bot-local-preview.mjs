// Run only against the explicitly isolated preview. No network responses are
// mocked. The backend's labelled executor is synthetic and never runs Hermes.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'../..');
const evidence=path.join(root,'.local/e03-ui-evidence');await fs.mkdir(evidence,{recursive:true});
const front='http://127.0.0.1:5283',base='http://127.0.0.1:4283',workspace='preview-bots';
const health=await (await fetch(base+'/__preview/health')).json();
assert.equal(health.preview,true);assert.equal(health.realHermes,false);assert.equal(health.schedulerEnabled,false);
assert.equal(path.resolve(health.database),path.join(root,'.local/bot-preview/data/preview.sqlite'));
const {chromium}=await import(process.env.ZIWEI_PLAYWRIGHT_PATH?pathToFileURL(process.env.ZIWEI_PLAYWRIGHT_PATH).href:'playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[],results=[],created=[];let routineId=null,bot;
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'&&['5283','4283'].includes(url.port)?route.continue():route.abort();});
page.on('dialog',dialog=>dialog.accept());
async function api(route,body,method=body?'POST':'GET'){
  const response=await page.request.fetch(base+route,{method,...(body?{data:body}:{})});
  const data=await response.json();assert.ok(response.ok(),`${method} ${route}: ${response.status()} ${data.error}`);return data;
}
const botPath=id=>`/api/workspaces/${workspace}/bots/${id}`;
async function check(name,fn){await fn();results.push({name,passed:true});console.log('passed: '+name);}
async function poll(read,predicate){for(let i=0;i<45;i++){const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,500));}throw new Error('Timed out waiting for preview receipt');}
const marker=`E03 隔离验收 ${Date.now()}`;
try{
  await page.goto(front+`/${workspace}/bots`);
  await page.getByRole('button',{name:'创建 Bot',exact:true}).waitFor();
  await check('real page displays preview boundary and brand',async()=>{
    await page.getByText('独立本地预览 · 配置保存使用真实 API',{exact:false}).waitFor();
    assert.equal(await page.locator('.product-brand img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    assert.equal(await page.getByRole('dialog').count(),0);
  });
  await check('UI creates one employee with authoritative main chat',async()=>{
    await page.getByRole('button',{name:'创建 Bot',exact:true}).click();
    await page.getByRole('dialog').getByLabel('名称',{exact:true}).fill(marker);
    await page.getByRole('combobox',{name:'新 Bot 运行电脑'}).click();
    await page.getByRole('option',{name:'合成演示设备（未连接真实 Hermes） · 在线',exact:true}).click();
    await page.getByRole('combobox',{name:'新 Bot Hermes profile'}).click();await page.getByRole('option',{name:'preview-fixture',exact:true}).click();
    const saved=page.waitForResponse(response=>response.url()===base+`/api/workspaces/${workspace}/bots`&&response.request().method()==='POST');
    await page.getByRole('button',{name:'创建并配置',exact:true}).click();bot=await (await saved).json();created.push(bot.id);
    await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('heading',{name:marker,exact:true}).waitFor();
    const team=await api(`/api/workspaces/${workspace}/employees`);assert.equal(team.employees.filter(item=>item.id===bot.id).length,1);
    assert.ok(bot.main_conversation_id);
  });
  await check('real save readback matches employee configuration',async()=>{
    await page.getByLabel('人格',{exact:true}).fill('合成资料验收：简洁表达并说明能力边界。');
    await page.getByRole('button',{name:'保存并读回',exact:true}).click();await page.getByText('配置已保存并读回。',{exact:false}).waitFor();
    bot=await api(botPath(bot.id));assert.equal(bot.employee.persona,'合成资料验收：简洁表达并说明能力边界。');assert.equal(bot.revision,2);
  });
  await check('configuration validation and control use actual asynchronous API receipts',async()=>{
    await page.getByRole('button',{name:'运行记录',exact:true}).click();await page.getByRole('button',{name:'检查已保存配置'}).click();
    await page.getByRole('button',{name:'启用 Bot',exact:true}).waitFor();
    await poll(()=>api(botPath(bot.id)),value=>value.validation.status==='succeeded');
    await page.getByRole('button',{name:'刷新回执',exact:true}).click();await page.getByRole('button',{name:'启用 Bot',exact:true}).click();
    await page.getByText('已启用 · 待命',{exact:true}).first().waitFor();bot=await api(botPath(bot.id));assert.equal(bot.control_state,'active');
    const runs=await api(botPath(bot.id)+'/runs');assert.equal(runs.runs[0].result.fixture,true);assert.equal(runs.runs[0].type,'hermes.bot.validate');
    await page.getByRole('button',{name:'能力组合',exact:true}).click();assert.ok(await page.getByText('合成流程已验证',{exact:true}).count()>0);assert.equal(await page.getByText('已接入',{exact:true}).count(),0);
  });
  await check('persistent main chat sends a message and receives a labelled synthetic result',async()=>{
    await page.getByRole('button',{name:'打开长期聊天',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'选择目录',exact:true}).isDisabled(),true);
    await page.getByPlaceholder('告诉数字伙伴要做什么...').fill('只验证隔离消息链，不执行实际业务。');await page.getByRole('button',{name:'发送',exact:true}).click();
    await poll(()=>api('/api/conversations/'+bot.main_conversation_id),value=>value.messages.some(message=>message.content.includes('【合成预览结果】')));
    await page.getByText('【合成预览结果】已收到这次工作。',{exact:false}).waitFor();
    assert.equal((await api('/api/conversations/'+bot.main_conversation_id)).employee_id,bot.id);
    await page.getByRole('button',{name:'Bot 设置',exact:true}).click();await page.getByLabel('人格',{exact:true}).waitFor();
  });
  await check('Routine stores timezone and routes a manual fixture result to the same main chat',async()=>{
    await page.getByRole('button',{name:'例行工作',exact:true}).click();await page.getByText('本地预览已关闭自动调度',{exact:false}).waitFor();
    await page.getByRole('button',{name:'添加计划'}).click();await page.getByRole('dialog').getByLabel('名称',{exact:true}).fill('隔离日报验收');
    await page.getByLabel('工作内容',{exact:true}).fill('仅生成合成预览结果');
    await page.getByRole('button',{name:'保存 Routine',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
    const routine=(await api(botPath(bot.id)+'/routines')).routines[0];routineId=routine.id;assert.equal(routine.employee_id,bot.id);assert.equal(routine.conversation_id,bot.main_conversation_id);assert.equal(routine.timezone,'Asia/Shanghai');assert.ok(routine.next_run);
    await page.getByRole('button',{name:'手动运行',exact:true}).click();
    await poll(()=>api(botPath(bot.id)+'/runs'),value=>value.runs.some(run=>run.type!=='hermes.bot.validate'&&run.status==='succeeded'&&run.payload?.runId));
    await page.getByRole('button',{name:'刷新 Bot 列表与状态'}).click();await page.screenshot({path:path.join(evidence,'local-preview-routine-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByText('计划已暂停',{exact:true}).waitFor();assert.equal((await api(botPath(bot.id)+'/routines')).routines[0].status,'paused');
  });
  await check('Team view and Bot pause refer to the same employee',async()=>{
    await page.getByRole('button',{name:'在团队管理查看',exact:true}).click();await page.locator('.org-employee-card').filter({hasText:marker}).waitFor();
    await page.getByRole('menu',{name:marker+' 操作'}).getByRole('menuitem',{name:'Bot 工作视图',exact:true}).click();await page.getByRole('heading',{name:marker,exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname,`/${workspace}/bots/${bot.id}`);
    await page.getByRole('button',{name:'运行记录',exact:true}).click();await page.getByRole('button',{name:'暂停 Bot',exact:true}).click();
    await poll(()=>api(botPath(bot.id)),value=>value.control_state==='paused');
    assert.equal((await api(`/api/workspaces/${workspace}/employees`)).employees.find(item=>item.id===bot.id).status,'paused');
  });
  await check('an existing Hermes employee initializes in place and keeps its original conversation',async()=>{
    const employee=await api(`/api/workspaces/${workspace}/employees`,{name:marker+' 原员工',runtime:'Hermes',runtimeProfile:'preview-fixture',targetDeviceId:bot.employee.target_device_id,model:'fixture-model'});created.push(employee.id);
    const chat=await api(`/api/workspaces/${workspace}/conversations`,{employeeId:employee.id,title:'原员工聊天'});
    await page.goto(front+`/${workspace}/bots/${employee.id}`);await page.getByRole('button',{name:'能力组合',exact:true}).click();assert.equal(await page.getByRole('button',{name:'保存能力配置并读回',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'初始化此员工的 Bot 能力'}).click();
    await page.getByText('Bot 能力已初始化',{exact:false}).waitFor();
    const initialized=await api(botPath(employee.id));assert.equal(initialized.id,employee.id);assert.equal(initialized.main_conversation_id,chat.id);
  });
  await check('workspace switching clears previous employees and capability catalog stays explicit',async()=>{
    await page.locator('.workspace-picker').click();await page.locator('.workspace-popup').getByRole('button',{name:'preview-alt',exact:false}).click();
    await page.getByRole('button',{name:'Bot 伙伴',exact:true}).click();await page.getByRole('button',{name:'创建 Bot',exact:true}).waitFor();
    assert.equal(await page.locator('.bot-roster-row').filter({hasText:marker}).count(),0);
    await page.locator('.bot-roster-row').first().click();await page.getByRole('button',{name:'能力组合',exact:true}).click();await page.getByText('外部消息 Gateway',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'能力组合',exact:true}).getAttribute('aria-current'),'page');
    await page.screenshot({path:path.join(evidence,'local-preview-capabilities-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:path.join(evidence,'local-preview-mobile.png'),fullPage:true});
  });
  await check('preview blocks native discovery, external URL import and webhook delivery',async()=>{
    for(const [method,route,data] of [['GET',`/api/workspaces/${workspace}/hermes/profiles`],['POST',`/api/workspaces/${workspace}/skills/import`,{url:'https://external.invalid/'}],['POST',botPath(bot.id)+'/routines',{name:'blocked',webhookUrl:'https://external.invalid/'}]]){
      const response=await page.request.fetch(base+route,{method,...(data?{data}:{})});assert.equal(response.status(),503);assert.equal((await response.json()).code,'PREVIEW_EXTERNAL_DISABLED');
    }
  });
  await check('UI employee deletion removes the same identity from both views',async()=>{
    await page.setViewportSize({width:1440,height:1000});await page.goto(front+`/${workspace}/bots/${bot.id}`);
    await page.getByRole('button',{name:'删除员工',exact:true}).click();
    await poll(()=>api(`/api/workspaces/${workspace}/bots`),value=>!value.bots.some(item=>item.id===bot.id));
    assert.equal((await api(`/api/workspaces/${workspace}/employees`)).employees.some(item=>item.id===bot.id),false);
    await page.getByRole('heading',{name:'选择一个长期合作的伙伴'}).waitFor();
    for(const id of created.filter(id=>id!==bot.id))await api(`/api/workspaces/${workspace}/employees/${id}`,null,'DELETE');
    await page.getByRole('button',{name:'刷新 Bot 列表与状态'}).click();
    await page.locator('.bot-roster-row').filter({hasText:'资料研究员'}).click();
    await page.getByRole('heading',{name:'继续与 资料研究员 的对话'}).waitFor();
    await page.screenshot({path:path.join(evidence,'local-preview-roster-desktop.png'),fullPage:true});
  });
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(evidence,'local-preview-result.json'),JSON.stringify({realHttp:true,executorFixture:true,realHermes:false,health,results,consoleErrors:errors},null,2));
  console.log(JSON.stringify({realHttp:true,executorFixture:true,passed:results.length,evidence}));
}catch(error){await page.screenshot({path:path.join(evidence,'local-preview-failure.png'),fullPage:true});await fs.writeFile(path.join(evidence,'local-preview-failure.json'),JSON.stringify({error:error.message,results,consoleErrors:errors},null,2));throw error;}
finally{
  for(const id of created){if(id===bot?.id&&routineId)await api(botPath(id)+'/routines/'+routineId,null,'DELETE').catch(()=>{});await api(`/api/workspaces/${workspace}/employees/${id}`,null,'DELETE').catch(()=>{});}
  await browser.close();
}
