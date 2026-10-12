// Build first. This is an explicitly synthetic browser UI test, not a Hermes
// connection test. All HTTP requests are fulfilled locally; no service starts.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {defaultBotConfig} from '../src/bot-workbench.js';

const root=path.resolve(import.meta.dirname,'../..'),dist=path.join(root,'frontend/dist');
const evidence=path.join(root,'.local/e03-ui-evidence');await fs.mkdir(evidence,{recursive:true});
const {chromium}=await import(process.env.ZIWEI_PLAYWRIGHT_PATH?pathToFileURL(process.env.ZIWEI_PLAYWRIGHT_PATH).href:'playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
const capabilities=[['bot_identity','Bot 身份与岗位'],['persistent_chat','持久主聊天'],['profile_memory','独立原生记忆'],['model_provider','模型与服务商'],['skills','技能'],['tools_mcp','工具与 MCP'],['routines','定时 Routine'],['groups_mentions','群聊与 @提及'],['delegation','Bot 委派'],['gateway','外部消息 Gateway'],['voice','语音'],['multimodal','多模态'],['session_search','会话检索'],['goals','Goals'],['heartbeat','Heartbeat'],['kanban','Kanban'],['observability','运行记录']].map(([id,label],i)=>({id,label,configurable:i<7,status:i<7?'requires_configuration':'not_integrated',reason:i<7?'隔离 UI fixture：需要配置与实际设备回执。':'此能力尚未接入控制与结果链。',evidence:['fixture=true','ziwei.bot.schema:1']}));
const makeBot=(id,name)=>({id,employee_id:id,workspace:'qa',employee:{id,name,description:'隔离界面演示 · 未连接真实设备',persona:'简洁、认真',instructions:'整理合成资料并提供来源。',runtime:'Hermes',runtime_profile:'fixture',target_device_id:'fixture-device',skills:[],model_id:null},config:defaultBotConfig(),revision:1,control_state:'draft',control_epoch:1,main_conversation_id:`chat-${id}`,scheduler_authority:'ziwei',validation:{status:'not_checked',revision:null},latest_run:null,capabilities});
let bots=[makeBot('bot-a','资料研究员'),makeBot('bot-b','内容编辑')],routines=[],conflict=false;
const device={id:'fixture-device',name:'隔离演示电脑（fixture）',status:'online',runtimes:[{name:'Hermes',available:true,cli_status:'available',version:'fixture-only',authenticated:true,readiness:{ready:true},profiles:[{name:'fixture',ready:true,hasProvider:true,authentication_configured:true}]}]};
const conversation=id=>({id,title:'资料研究员 · 主聊天',employee_id:'bot-a',employee:bots[0].employee,device_id:device.id,messages:[{id:'message-fixture',role:'assistant',content:'这是隔离 fixture 对话，尚未调用真实 Hermes。'}],execution:null});
async function json(route,data,status=200){return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});}
await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  if(url.host!=='ziwei-fixture.invalid')return route.abort();
  if(p.startsWith('/assets/')){const file=path.join(dist,p);return route.fulfill({body:await fs.readFile(file),contentType:p.endsWith('.css')?'text/css':'application/javascript'});}
  if(p==='/api/auth/status')return json(route,{setup_required:false,authenticated:true,user:{id:'fixture-user',name:'隔离预览',role:'owner'},memberships:[{slug:'qa',name:'隔离 QA',role:'owner'}]});
  if(p.includes('/mcp/discovery'))return json(route,{workspace:'qa',devices:[device]});
  if(p==='/api/workspaces/qa/bots'&&req.method()==='POST'){const body=req.postDataJSON();requests.push({method:'POST',path:p,body});const bot=makeBot('bot-created',body.name);bot.employee={...bot.employee,...body,runtime_profile:body.runtimeProfile,target_device_id:body.targetDeviceId};bot.config=body.config;bots.push(bot);return json(route,bot,201);}
  if(p==='/api/workspaces/qa/bots')return json(route,{bots});
  const match=p.match(/^\/api\/workspaces\/qa\/bots\/([^/]+)(.*)$/);
  if(match){const bot=bots.find(item=>item.id===match[1]),suffix=match[2],body=req.method()==='GET'?null:req.postDataJSON();if(!bot)return json(route,{error:'not found'},404);
    if(body)requests.push({method:req.method(),path:p,body});
    if(!suffix&&req.method()==='PATCH'){if(conflict){conflict=false;return json(route,{error:'配置版本冲突',code:'BOT_REVISION_CONFLICT'},409);}bot.revision++;bot.employee={...bot.employee,...body.employee,model_id:body.employee?.model??bot.employee.model_id};bot.config=body.config;bot.validation={status:'stale'};return json(route,bot);}
    if(suffix==='/runs')return json(route,{runs:bot.latest_run?[bot.latest_run]:[]});
    if(suffix==='/routines'&&body){const routine={id:'routine-fixture',...body,status:'active',next_run:'2026-10-13T01:00:00Z',employee_id:bot.id,conversation_id:bot.main_conversation_id,authority:'ziwei'};routines.push(routine);return json(route,routine,201);}
    if(suffix==='/routines')return json(route,{routines});
    if(suffix==='/validate'){bot.validation={status:'succeeded',revision:bot.revision,action_id:'validation-fixture'};bot.latest_run={id:'validation-fixture',type:'hermes.bot.validate',status:'succeeded'};return json(route,{action:bot.latest_run},202);}
    if(suffix==='/control'){bot.control_state=['activate','resume'].includes(body.operation)?'active':'paused';bot.control_epoch++;return json(route,bot);}
    return json(route,bot);
  }
  if(p.startsWith('/api/conversations/'))return json(route,conversation(p.split('/')[3]));
  if(p.includes('/notifications/stream'))return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
  if(p.startsWith('/api/')||p.startsWith('/a2a/')){
    const blank={workspace:{slug:'qa',name:'隔离 QA',timezone:'Asia/Shanghai',preferences:{}},tasks:[],runtimes:[],models:[{id:'fixture-model',label:'合成模型（fixture）'}],skills:[],documents:[],automations:[],members:[],devices:[device],employees:bots.map(bot=>bot.employee),calendars:[],agents:[],conversations:[conversation('chat-bot-a')],notifications:[],stats:{unread:0}};
    return json(route,blank);
  }
  if(p==='/ziwei-logo.png')return route.fulfill({contentType:'image/png',body:await fs.readFile(path.join(dist,'ziwei-logo.png'))});
  if(p.endsWith('.png')||p.endsWith('.ico'))return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:'text/html',body:await fs.readFile(path.join(dist,'index.html'),'utf8')});
});
const results=[];
async function check(name,fn){await fn();results.push({name,passed:true});}
try{
  await page.goto('https://ziwei-fixture.invalid/qa/bots/bot-a');
  await page.getByRole('heading',{name:'与你的 Bot 一起工作'}).waitFor();
  await page.getByRole('heading',{name:'继续与 资料研究员 的对话'}).waitFor();
  await check('initial roster has no unintended modal',async()=>assert.equal(await page.getByRole('dialog').count(),0));
  await page.screenshot({path:path.join(evidence,'fixture-bot-roster-desktop.png'),fullPage:true});
  await check('capability catalog displays unsupported states',async()=>{await page.getByRole('button',{name:'能力组合',exact:true}).click();await page.getByText('外部消息 Gateway',{exact:true}).waitFor();assert.equal(await page.getByText('尚未接入',{exact:true}).count(),10);});
  await page.screenshot({path:path.join(evidence,'fixture-bot-capabilities.png'),fullPage:true});
  await check('saving config persists and reads the new revision',async()=>{await page.getByRole('button',{name:'基础配置',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('已改名研究员');await page.getByRole('button',{name:'保存并读回',exact:true}).click();await page.getByText('配置已保存并读回。',{exact:false}).waitFor();assert.equal(bots[0].revision,2);assert.equal(bots[0].employee.name,'已改名研究员');});
  await check('409 retains user draft',async()=>{conflict=true;await page.getByLabel('名称',{exact:true}).fill('冲突时保留的草稿');await page.getByRole('button',{name:'保存并读回',exact:true}).click();await page.getByText('草稿保留在本页',{exact:false}).waitFor();assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'冲突时保留的草稿');await page.getByRole('button',{name:'放弃草稿并采用最新配置'}).click();});
  await check('Routine creation uses selected Bot and timezone',async()=>{await page.getByRole('button',{name:'例行工作',exact:true}).click();await page.getByRole('button',{name:'添加计划'}).click();await page.getByRole('dialog').getByLabel('名称',{exact:true}).fill('合成日报');await page.getByLabel('工作内容',{exact:true}).fill('整理 fixture 内容，不调用真实模型');await page.getByRole('button',{name:'保存 Routine',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('heading',{name:'合成日报'}).waitFor();assert.equal(routines[0].employee_id,'bot-a');assert.equal(routines[0].timezone,'Asia/Shanghai');});
  await check('configuration validation is not labelled business completion',async()=>{await page.getByRole('button',{name:'运行记录',exact:true}).click();await page.getByRole('button',{name:'检查已保存配置'}).click();await page.getByRole('button',{name:'启用 Bot',exact:true}).click();await page.getByText('已启用 · 待命',{exact:true}).first().waitFor();assert.equal(await page.getByText('上次已完成',{exact:true}).count(),0);});
  await check('Bot main chat and settings stay connected',async()=>{await page.getByRole('button',{name:'打开长期聊天',exact:true}).click();await page.getByText('这是隔离 fixture 对话，尚未调用真实 Hermes。',{exact:true}).waitFor();await page.getByRole('button',{name:'Bot 设置',exact:true}).click();await page.getByLabel('名称',{exact:true}).waitFor();});
  await check('create dialog opens and closes through real ZiModal events',async()=>{await page.getByRole('button',{name:'创建 Bot',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),1);await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});});
  await check('unadded MCP input cannot transfer through roster selection',async()=>{
    await page.getByRole('button',{name:'能力组合',exact:true}).click();await page.getByText('MCP 与高级连接',{exact:true}).click();await page.getByLabel('MCP 名称',{exact:true}).fill('only-on-a');
    await page.locator('.bot-roster-row').filter({hasText:'内容编辑'}).click();await page.getByRole('button',{name:'能力组合',exact:true}).click();
    await page.getByText('MCP 与高级连接',{exact:true}).click();assert.equal(await page.getByLabel('MCP 名称',{exact:true}).inputValue(),'');
    await page.locator('.bot-roster-row').filter({hasText:'已改名研究员'}).click();
  });
  await check('history navigation closes a Routine editor and cannot transfer its draft to another Bot',async()=>{
    await page.locator('.bot-roster-row').filter({hasText:'内容编辑'}).click();await page.getByRole('heading',{name:'内容编辑',exact:true}).waitFor();
    await page.getByRole('button',{name:'例行工作',exact:true}).click();await page.getByRole('button',{name:'添加计划'}).click();await page.getByRole('dialog').getByLabel('名称',{exact:true}).fill('只属于 B 的未保存草稿');
    const before=routines.length;await page.goBack();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(routines.length,before);
  });
  await check('brand asset renders actual pixels',async()=>assert.equal(await page.locator('.product-brand img').evaluate(image=>image.complete&&image.naturalWidth>0),true));
  await check('creating in Bot view appears as the same employee in Team',async()=>{
    await page.getByRole('button',{name:'创建 Bot',exact:true}).click();
    await page.getByRole('dialog').getByLabel('名称',{exact:true}).fill('同一位数字员工');
    await page.getByRole('combobox',{name:'新 Bot 运行电脑'}).click();await page.getByRole('option',{name:'隔离演示电脑（fixture） · 在线',exact:true}).click();
    await page.getByRole('combobox',{name:'新 Bot Hermes profile'}).click();await page.getByRole('option',{name:'fixture',exact:true}).click();
    await page.getByRole('button',{name:'创建并配置',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
    await page.getByRole('button',{name:'在团队管理查看',exact:true}).click();await page.locator('.org-employee-card').filter({hasText:'同一位数字员工'}).waitFor();
    assert.equal(bots.filter(bot=>bot.id==='bot-created').length,1);
    await page.getByRole('menu',{name:'同一位数字员工 操作'}).getByRole('menuitem',{name:'Bot 工作视图',exact:true}).click();
    await page.getByRole('heading',{name:'同一位数字员工',exact:true}).waitFor();assert.ok(page.url().endsWith('/qa/bots/bot-created'));
  });
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(evidence,'fixture-bot-mobile.png'),fullPage:true});
  await check('390px layout has no horizontal document overflow',async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true));
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(evidence,'browser-fixture-result.json'),JSON.stringify({fixture:true,realHermes:false,results,consoleErrors:errors,requests},null,2));
  console.log(JSON.stringify({fixture:true,passed:results.length,evidence}));
}catch(error){await page.screenshot({path:path.join(evidence,'fixture-failure.png'),fullPage:true});await fs.writeFile(path.join(evidence,'browser-fixture-failure.json'),JSON.stringify({fixture:true,error:error.message,results,consoleErrors:errors},null,2));throw error;}
finally{await browser.close();}
