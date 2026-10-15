// Built Vue UI, real in-memory repository, synthetic device/validation only.
// ClipboardEvent/DataTransfer stay inside Chromium; no system clipboard, server,
// real device, model, production endpoint or listener is used.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createRepository} from '../../backend/repository.mjs';
import {createManagementService} from '../../backend/management.mjs';
import {completeOwnedProfile} from '../../test-support/owned-profile.mjs';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url))),dist=path.join(root,'frontend/dist');
const output=path.join(root,'.local/conversation-paste-ui-verification');await fs.mkdir(output,{recursive:true});await fs.access(path.join(dist,'index.html'));
const require=createRequire(import.meta.url);let playwright;
for(const candidate of [process.env.PLAYWRIGHT_MODULE,'playwright','/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean))try{playwright=require(candidate);break;}catch{}
assert.ok(playwright,'Preinstalled Playwright is required');
const executablePath=process.env.ZIWEI_BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const origin='https://ziwei-paste-fixture.invalid',slug='test-111',deviceId='paste-fixture-pc';
function imagePng(name){
  // Distinct valid PNG pixels make byte/order verification meaningful.
  let color=0;for(const char of name)color=(color*31+char.charCodeAt(0))>>>0;
  const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,body,checksum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,color&255,(color>>>8)&255,(color>>>16)&255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const repo=createRepository({memory:true}),management=createManagementService(repo),bots=management.bots;
const requests=[],pageErrors=[],unexpectedRequests=[],expectedApiRejections=[],blockedExternal=[],results=[],screenshots=[],clipboardEvents=[];
let browser,context,page;
function heartbeat(profiles=['default']){repo.heartbeatDevice(slug,{deviceId,name:'合成粘贴验收电脑',workdir:'C:\\fixture',runtimes:{Hermes:{status:'available',version:'0.21.3',profiles:profiles.map(name=>({name,provider_configured:true,authentication_configured:true}))},Codex:{status:'available',version:'synthetic-only',profiles:[{name:'default'}]}}});}
heartbeat();let bot=bots.create(slug,{name:'图片粘贴 Bot',sourceProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol',idempotencyKey:'paste-fixture-bot',config:{permissions:{mode:'read_only'},toolsets:[]}});completeOwnedProfile(repo,bot);heartbeat(['default',bot.instance.profile]);
const validation=bots.validate(slug,bot.id,{expectedRevision:bot.revision,idempotencyKey:'paste-fixture-validation'}).action;
repo.ackA2AAction(validation.id,{deviceId});repo.resultA2AAction(validation.id,{deviceId,status:'succeeded',result:{botValidation:{schemaVersion:1,valid:true,employeeId:bot.id,revision:bot.revision},processExit:{platform:'win32',supervisor:'windows-job',launched:true,rootPid:1234,rootConfirmed:true,rootExitCode:0,treeConfirmed:true,activeProcesses:0,cancelled:false},externalModelCalls:0}});
bot=bots.control(slug,bot.id,{expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch,operation:'activate'});
const ordinary=repo.createEmployee(slug,{name:'Codex 图片粘贴员工',runtime:'Codex',runtimeProfile:'default',targetDeviceId:deviceId,model:'gpt-6.1-sol'});
const ordinaryConversation=repo.createConversation(slug,{employeeId:ordinary.id,title:'Codex 粘贴验收会话'});
const json=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
async function facade(route){
  const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
  if(url.origin!==origin){blockedExternal.push(url.origin+url.pathname);return route.abort();}
  const body=method!=='GET'&&request.postData()?request.postDataJSON():null;
  if(p.startsWith('/api/')||p.startsWith('/a2a/'))requests.push({method,path:p,...(body?{body}:{}),at:new Date().toISOString()});
  try{
    if(p.startsWith('/assets/')){const target=path.resolve(dist,'.'+p);assert.ok(target.startsWith(dist+path.sep));return route.fulfill({body:await fs.readFile(target),contentType:p.endsWith('.css')?'text/css':p.endsWith('.js')?'application/javascript':'application/octet-stream'});}
    if(p==='/api/auth/status')return json(route,{setup_required:false,authenticated:true,user:{id:'paste-fixture-user',name:'合成粘贴验收',role:'owner'},memberships:[{slug,name:'图片粘贴验收',role:'owner'}]});
    if(p==='/api/workspaces')return json(route,{workspaces:[{...repo.getWorkspace(slug),role:'owner'}]});
    if(p.includes('/notifications/stream'))return route.fulfill({contentType:'text/event-stream',body:': isolated paste fixture\n\n'});
    if(p===`/api/workspaces/${slug}/mcp/discovery`)return json(route,management.discovery(slug,{}));
    if(p===`/api/workspaces/${slug}/bots`)return json(route,{bots:bots.list(slug)});
    const b=p.match(new RegExp(`^/api/workspaces/${slug}/bots/([^/]+)(.*)$`));
    if(b&&method==='GET'){if(!b[2])return json(route,bots.get(slug,b[1]));if(b[2]==='/runs')return json(route,{runs:bots.runs(slug,b[1])});if(b[2]==='/routines')return json(route,{routines:bots.routines(slug,b[1])});}
    if(p===`/api/workspaces/${slug}/conversations`)return json(route,{conversations:repo.listConversations(slug,{conversationEmployeeId:url.searchParams.get('employeeId')||undefined})});
    const c=p.match(/^\/api\/conversations\/([^/]+)(.*)$/);
    if(c){
      if(method==='GET'&&!c[2])return json(route,repo.getConversation(c[1]));
      if(method==='POST'&&c[2]==='/messages')return json(route,repo.addConversationMessage(c[1],body),201);
      throw new Error('Unexpected conversation route '+method+' '+p);
    }
    if(p===`/api/workspaces/${slug}/summary`)return json(route,repo.getSummary(slug));
    if(p===`/api/workspaces/${slug}/settings`)return json(route,{workspace:{...repo.getWorkspace(slug),preferences:{}}});
    if(p===`/api/workspaces/${slug}/employees`)return json(route,{employees:repo.listEmployees(slug)});
    if(p===`/api/workspaces/${slug}/devices`)return json(route,{devices:repo.listDevices(slug)});
    if(p===`/api/workspaces/${slug}/runtimes`)return json(route,{runtimes:repo.listRuntimes(slug)});
    if((p.startsWith('/api/')||p.startsWith('/a2a/'))&&method==='GET')return json(route,{tasks:[],runtimes:[],models:[{id:'gpt-6.1-sol',label:'合成模型'}],skills:[],documents:[],automations:[],members:[],devices:repo.listDevices(slug),employees:repo.listEmployees(slug),calendars:[],agents:[],conversations:repo.listConversations(slug),notifications:[],stats:{unread:0}});
    if(p.startsWith('/api/')||p.startsWith('/a2a/'))throw new Error('Unexpected mutation '+method+' '+p);
    if(p==='/ziwei-logo.png')return route.fulfill({contentType:'image/png',body:await fs.readFile(path.join(dist,'ziwei-logo.png'))});
    if(/\.(ico|png|svg)$/.test(p))return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:'text/html',body:await fs.readFile(path.join(dist,'index.html'),'utf8')});
  }catch(error){const errors=error.code==='BOT_RUNTIME_UNSUPPORTED'&&method==='GET'&&p===`/api/workspaces/${slug}/bots/${ordinary.id}`?expectedApiRejections:unexpectedRequests;errors.push({method,path:p,error:error.message,code:error.code});return json(route,{error:error.message,code:error.code||'FIXTURE_REQUEST_FAILED'},error.status||409);}
}
async function waitFor(predicate,message){for(let i=0;i<100;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,75));}assert.fail(message);}
async function check(name,fn){await fn();results.push({name,passed:true});console.log('passed: '+name);}
const drafts=()=>page.locator('button[aria-label^="查看待发送图片："]');
const removes=()=>page.locator('button[aria-label^="移除图片："]');
async function snapshot(name){const target=path.join(output,name+'.png');await page.screenshot({path:target,fullPage:true});screenshots.push(target);}
async function paste(textarea,{names=[],text='',html='',size=0}={}){
  const event=await textarea.evaluate((node,{names,text,html,images,size})=>{
    const transfer=new DataTransfer();if(text)transfer.setData('text/plain',text);if(html)transfer.setData('text/html',html);
    for(const [index,name]of names.entries()){const original=Uint8Array.from(atob(images[index]),char=>char.charCodeAt(0)),bytes=size?new Uint8Array(size):original;if(size)bytes.set(original);transfer.items.add(new File([bytes],name,{type:'image/png'}));}
    const event=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});node.dispatchEvent(event);
    return{defaultPrevented:event.defaultPrevented,imageFiles:names.length,hasText:Boolean(text),hasHtml:Boolean(html)};
  },{names,text,html,images:names.map(imagePng),size});clipboardEvents.push(event);return event;
}
async function rejectedPaste(textarea,options,expectedCount,error){
  const event=await paste(textarea,options);assert.equal(event.defaultPrevented,true);
  await page.getByRole('alert').filter({hasText:error}).first().waitFor();assert.equal(await drafts().count(),expectedCount);
}
async function verifySaved(conversationId,text,names){
  await waitFor(()=>repo.getConversation(conversationId).messages.some(message=>message.role==='user'&&message.content===text),'Message was not persisted to the real repository');
  const message=repo.getConversation(conversationId).messages.find(message=>message.role==='user'&&message.content===text);
  assert.deepEqual(message.attachments.map(image=>image.name),names);assert.deepEqual(message.attachments.map(image=>image.content),names.map(imagePng));assert.ok(message.attachments.every(image=>image.mimeType==='image/png'));
  const posts=requests.filter(row=>row.method==='POST'&&row.path===`/api/conversations/${conversationId}/messages`);assert.equal(posts.length,1,'All images must share one submission');const post=posts[0];assert.deepEqual(post.body.attachments.map(image=>image.name),names);assert.deepEqual(post.body.attachments.map(image=>image.content),names.map(imagePng));assert.equal(post.body.content,text);assert.ok(post.body.clientMessageId);
  // The conversation's public execution view omits input bytes; verify those in
  // the repository's original action rather than expecting its UI projection.
  const action=repo.getA2AAction(repo.getConversation(conversationId).execution.id,{workspaceSlug:slug});assert.equal(action.payload.conversationId,conversationId);assert.deepEqual(action.payload.attachments.map(image=>image.name),names);assert.deepEqual(action.payload.attachments.map(image=>image.content),names.map(imagePng));assert.equal(action.payload.employeeId,repo.getConversation(conversationId).employee_id);
  await waitFor(async()=>await drafts().count()===0,'Accepted attachment did not clear from its draft');
}
try{
  browser=await playwright.chromium.launch({headless:true,executablePath,args:['--disable-background-networking']});
  context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,serviceWorkers:'block'});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/*',facade);assert.equal(typeof page.routeWebSocket,'function');await page.routeWebSocket('**/*',socket=>socket.close());
  await page.goto(`${origin}/${slug}/inbox/${bot.main_conversation_id}?employee=${bot.id}&bot=${bot.id}`);
  let textarea=page.getByRole('textbox',{name:'主聊天消息',exact:true});await textarea.waitFor();await textarea.fill('Bot 保留文字');
  await check('Bot plain-text paste keeps native default handling',async()=>{const event=await paste(textarea,{text:'plain-text-only'});assert.equal(event.defaultPrevented,false);assert.equal(await textarea.inputValue(),'Bot 保留文字');assert.equal(await drafts().count(),0);});
  await check('Bot simultaneous images plus text and HTML add ordered previews without replacing the draft',async()=>{
    const event=await paste(textarea,{names:['bot-clipboard.png','bot-second.png'],text:'https://remote.invalid/no-fetch.png',html:'<img src="https://remote.invalid/no-fetch.png">'});assert.equal(event.defaultPrevented,true);
    await waitFor(async()=>await drafts().count()===2,'Bot multi-image paste previews are missing');assert.equal(await textarea.inputValue(),'Bot 保留文字');for(const image of await drafts().locator('img').all())assert.equal(await image.evaluate(node=>node.complete&&node.naturalWidth>0),true);
    await drafts().first().click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.locator('img').evaluate(node=>node.complete&&node.naturalWidth>0),true);await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'detached'});await snapshot('01-bot-pasted-preview');
  });
  await check('Hermes accumulates a third image and rejects only shared byte and count limits without losing previews',async()=>{
    await paste(textarea,{names:['bot-third.png']});await waitFor(async()=>await drafts().count()===3,'Hermes should accumulate its third image');await rejectedPaste(textarea,{names:['bot-limit-size.png'],size:10*1024*1024},3,/10\s*(?:MB|MiB)/);await rejectedPaste(textarea,{names:Array.from({length:18},(_,index)=>`bot-limit-count-${index}.png`)},3,/20.*张/);assert.equal(await textarea.inputValue(),'Bot 保留文字');
  });
  await check('Bot removes one image and sends all remaining original bytes in order in one action',async()=>{
    await removes().nth(1).click();assert.equal(await drafts().count(),2);await paste(textarea,{names:['bot-send.png']});await waitFor(async()=>await drafts().count()===3,'Replacement Bot preview is missing');await page.getByRole('button',{name:'发送',exact:true}).click();await verifySaved(bot.main_conversation_id,'Bot 保留文字',['bot-clipboard.png','bot-third.png','bot-send.png']);await snapshot('02-bot-sent-attachment');
  });
  await page.goto(`${origin}/${slug}/inbox/${ordinaryConversation.id}?employee=${ordinary.id}`);textarea=page.getByPlaceholder('告诉数字伙伴要做什么...', {exact:true});await textarea.waitFor();await textarea.fill('Codex 保留文字');
  await check('ordinary Codex inbox accepts a pasted image and leaves plain text paste untouched',async()=>{
    assert.equal((await paste(textarea,{text:'ordinary text'})).defaultPrevented,false);assert.equal((await paste(textarea,{names:['codex-first.png'],text:'ignored alongside image',html:'<img src="https://remote.invalid/also-no-fetch.png">'})).defaultPrevented,true);
    await waitFor(async()=>await drafts().count()===1,'Ordinary inbox preview is missing');assert.equal(await textarea.inputValue(),'Codex 保留文字');await snapshot('03-codex-pasted-preview');
  });
  await check('Codex allows multiple images but accumulated byte and count limits preserve existing previews',async()=>{
    await paste(textarea,{names:['codex-second.png']});await waitFor(async()=>await drafts().count()===2,'Codex should allow its second image');
    await rejectedPaste(textarea,{names:['limit-size.png'],size:10*1024*1024},2,/10\s*(?:MB|MiB)/);
    await rejectedPaste(textarea,{names:Array.from({length:19},(_,index)=>`limit-count-${index}.png`)},2,/20.*张/);assert.equal(await textarea.inputValue(),'Codex 保留文字');await snapshot('04-codex-accumulated-limit');
  });
  await check('ordinary Codex removal and multi-image send persist the remaining originals in one action',async()=>{
    await removes().first().click();assert.equal(await drafts().count(),1);await paste(textarea,{names:['codex-third.png']});await waitFor(async()=>await drafts().count()===2,'Codex replacement preview is missing');await page.locator('.conversation-compose-actions').getByRole('button',{name:'发送',exact:true}).click();await verifySaved(ordinaryConversation.id,'Codex 保留文字',['codex-second.png','codex-third.png']);await snapshot('05-codex-sent-attachment');
  });
  assert.deepEqual(pageErrors,[]);assert.deepEqual(unexpectedRequests,[]);assert.deepEqual(blockedExternal,[]);
}catch(error){results.push({name:'fixture failure',passed:false,error:error.message,stack:error.stack});if(page)try{await snapshot('failure');}catch{}process.exitCode=1;}
finally{
  const report={kind:'real-built-ui-and-in-memory-repository-with-synthetic-clipboard-events',listenerStarted:false,systemClipboardUsed:false,realDeviceConnected:false,externalModelCalls:0,syntheticValidationActionId:validation.id,results,pageErrors,unexpectedRequests,expectedApiRejections,blockedExternal,clipboardEvents,requests,screenshots,messages:{bot:repo.getConversation(bot.main_conversation_id).messages,ordinary:repo.getConversation(ordinaryConversation.id).messages},generatedAt:new Date().toISOString()};
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser?.close();repo.db.close();console.log(JSON.stringify({report:path.join(output,'report.json'),passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,pageErrors}));
}
