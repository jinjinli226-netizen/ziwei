// The complete App runs against an authenticated in-memory Express application.
// Chromium requests enter app.handle directly; there is no HTTP listener, real
// account data, model call, device command or production write.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
import {createHash} from 'node:crypto';
import {createApp} from '../../backend/app.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url))),web=path.join(root,'mobile-manager/web'),out=path.join(root,'.local/mobile-manager-forwarding-qa');
await fs.mkdir(out,{recursive:true});
const origin='https://ziwei-forwarding.invalid',slug='forwarding-qa',deviceId='forwarding-fixture-pc';
const requests=[],errors=[],checks=[],screenshots=[],navigations=[],externalCalls=[],realTouchChecks=[],servedAssets={};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(value,init={})=>{externalCalls.push({url:String(value),method:init.method||'GET'});throw new Error('External requests are disabled in this fixture');};
const app=createApp({memory:true,requireAuth:true,enableScheduler:false}),repo=app.locals.repo;
const principal=app.locals.auth.setup({name:'转发隔离验收',email:'forwarding-owner@fixture.test',password:'fixture-private-password'});
app.locals.auth.createWorkspace(principal.user_id,{slug,name:'转发隔离工作区',kind:'team'});
const cookie=`ziwei_session=${principal.session.token}`;
const readiness={ready:true,authentication:'configured',provider:'configured'};
repo.heartbeatDevice(slug,{deviceId,name:'隔离运行电脑',ownerUserId:principal.user_id,runtimes:{Codex:{status:'available',version:'synthetic',profiles:[{name:'default',provider_configured:true,authentication_configured:true,readiness}],models:[{id:'fixture-model'}],readiness}}});
const sourceEmployee=repo.createEmployee(slug,{name:'闲鱼运营大神 · 转发隔离验收',description:'原员工身份',runtime:'Codex',runtimeProfile:'default',targetDeviceId:deviceId,model:'fixture-model',ownerUserId:principal.user_id,visibility:'workspace'});
const targetEmployee=repo.createEmployee(slug,{name:'InsTrendS · 转发隔离验收',description:'另一位原员工',runtime:'Codex',runtimeProfile:'default',targetDeviceId:deviceId,model:'fixture-model',ownerUserId:principal.user_id,visibility:'workspace'});
const source=repo.createConversation(slug,{employeeId:sourceEmployee.id,title:'源员工 · 原长期聊天'}),target=repo.createConversation(slug,{employeeId:targetEmployee.id,title:'目标员工 · 原长期聊天'});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const add=(conversation,body)=>repo.addConversationMessage(conversation.id,{...body,dispatch:false});
add(target,{role:'assistant',content:'目标员工原来就有的历史 TARGET-ORIGINAL'});
const userMessage=add(source,{role:'user',content:'请把原讨论交给另一位员工参考 SOURCE-ORIGINAL'});
const photoMessage=add(source,{role:'assistant',content:'原文 <img src=x onerror="window.__snapshotUnsafe=1"> & 保留发送者',attachments:[{name:'original.png',mimeType:'image/png',size:Buffer.from(png,'base64').length,contentEncoding:'base64',content:png}]});
add(source,{role:'assistant',content:'长聊天记录，用来验证可见区域的已读游标。\n'+'保留原文的一行。\n'.repeat(150)});
const originalLatest=add(source,{role:'system',content:'原系统消息也进入已读游标 SYSTEM-ORIGINAL'});
const originalConversationIds=repo.listConversations(slug).map(item=>item.id).sort();
let loseNextForwardReceipt=false,lostReceipts=0,popupCount=0;

async function inMemoryRequest(method,url,body){
  const socket=new Duplex({read(){},write(_chunk,_encoding,callback){callback();}}),request=new IncomingMessage(socket),response=new ServerResponse(request),payload=body===undefined?'':JSON.stringify(body);
  request.method=method;request.url=url;request.headers={host:'ziwei-forwarding.invalid',cookie,...(body===undefined?{}:{'content-type':'application/json','content-length':String(Buffer.byteLength(payload))})};
  const chunks=[],result=new Promise((resolve,reject)=>{
    response.write=(chunk,encoding,callback)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding));callback?.();return true;};
    response.end=(chunk,encoding,callback)=>{if(chunk)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));callback?.();const text=Buffer.concat(chunks).toString();resolve({status:response.statusCode,body:text?JSON.parse(text):{}});response.emit('finish');return response;};
    response.on('error',reject);request.on('error',reject);app.handle(request,response,error=>reject(error||new Error(`Unhandled ${method} ${url}`)));
  });
  request.push(payload||null);if(payload)request.push(null);
  try{return await result;}finally{socket.destroy();}
}
const browser=await chromium.launch({executablePath:process.env.ZIWEI_BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:393,height:851},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
page.setDefaultTimeout(8000);
context.on('page',opened=>{if(opened!==page)popupCount++;});page.on('pageerror',error=>errors.push(error.message));
page.on('framenavigated',frame=>{if(frame===page.mainFrame()){navigations.push(frame.url());if(frame.url()!==`${origin}/__ziwei_manager__/index.html`)errors.push(`Unexpected navigation ${frame.url()}`);}});
await page.addInitScript(({userId,workspace})=>localStorage.setItem(`ziwei.mobile.workspace:${userId}`,workspace),{userId:principal.user_id,workspace:slug});
await page.addInitScript(()=>{
  window.__gestureMeta=[];window.__gestureStart=performance.now();
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel','contextmenu','mousedown','mouseup','click','scroll'])document.addEventListener(type,event=>{
    if(window.__gestureMeta.length>=160)return;
    const anchor=event.target?.closest?.('[data-forwardable-message]')?.closest('[data-message-id]');
    window.__gestureMeta.push({type,ms:Math.round(performance.now()-window.__gestureStart),isTrusted:event.isTrusted,button:event.button??null,isPrimary:event.isPrimary??null,pointerType:event.pointerType||null,pointerId:event.pointerId??null,cancelable:event.cancelable,defaultPrevented:event.defaultPrevented,x:event.clientX??event.touches?.[0]?.clientX??null,y:event.clientY??event.touches?.[0]?.clientY??null,target:event.target?.tagName||'#document',anchorId:anchor?.dataset.messageId||null,scrollTop:document.querySelector('.chat-timeline')?.scrollTop??null});
  },{capture:true,passive:true});
});
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
  if(url.origin!==origin){errors.push(`External browser request ${url.origin}${p}`);return route.abort();}
  try{
    if(p.startsWith('/__ziwei_manager__/')){
      const asset=p.slice('/__ziwei_manager__/'.length)||'index.html';assert.match(asset,/^[a-z-]+\.(html|m?js|css|png)$/);
      const bytes=await fs.readFile(path.join(web,asset));servedAssets[asset]=createHash('sha256').update(bytes).digest('hex');
      return route.fulfill({contentType:/\.m?js$/.test(asset)?'text/javascript':asset.endsWith('.css')?'text/css':asset.endsWith('.png')?'image/png':'text/html',body:bytes});
    }
    assert.ok(method==='GET'||method==='POST'&&/^\/api\/conversations\/[^/]+\/(read|forwards)$/.test(p),`Blocked unrelated write ${method} ${p}`);
    const body=request.postData()?request.postDataJSON():undefined,entry={method,path:p,...(body===undefined?{}:{body})};requests.push(entry);
    const result=await inMemoryRequest(method,p+url.search,body);entry.status=result.status;
    if(p.endsWith('/forwards'))entry.receipt=result.body;
    if(method==='POST'&&p.endsWith('/forwards')&&loseNextForwardReceipt&&result.status>=200&&result.status<300){loseNextForwardReceipt=false;lostReceipts++;entry.receiptLost=true;return route.abort('failed');}
    return route.fulfill({status:result.status,contentType:'application/json',body:JSON.stringify(result.body)});
  }catch(error){errors.push(error.stack||error.message);return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:error.message})});}
});
const action=(name,id)=>page.locator(`${['forward-cancel','forward-detail-close'].includes(name)?'.forward-sheet > header ':''}[data-action="${name}"]${id?`[data-id="${id}"]`:''}`).first();
const forwardRequests=()=>requests.filter(request=>request.method==='POST'&&request.path.endsWith('/forwards'));
const readRequests=()=>requests.filter(request=>request.method==='POST'&&request.path.endsWith('/read'));
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function until(predicate,label){for(let attempt=0;attempt<100;attempt++){if(predicate())return;await page.waitForTimeout(40);}throw new Error(`Timed out: ${label}`);}
async function capture(name){await frame();await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});screenshots.push(name);}
async function resume(){const response=page.waitForResponse(result=>new URL(result.url()).pathname===`/api/conversations/${source.id}`&&result.request().method()==='GET');await page.evaluate(()=>window.dispatchEvent(new Event('ziwei:resume')));await response;await frame();}
async function sourceHome(){
  if(await page.locator('.app-shell').getAttribute('data-page')!=='home')await action('back').click();
  await page.locator('[data-action=navigate][data-tab=chat]').click();await action('chat',sourceEmployee.id).click();
  await page.getByRole('heading',{name:sourceEmployee.name,exact:true}).waitFor();await page.locator(`[data-message-id="${originalLatest.id}"]`).waitFor();
}
async function singleForward(messageId,note){await action('message-menu',messageId).click();await action('forward-single').click();await action('forward-target',targetEmployee.id).click();await page.locator('[name=forward-note]').fill(note);}
async function submitForward(){await page.locator('[data-form=forward] button[type=submit]').click();}
async function complete(){await page.getByRole('heading',{name:'转发已送达',exact:true}).waitFor();}
async function pointer(locator,type,{pointerId=71,dx=0,dy=0}={}){const box=await locator.boundingBox();assert.ok(box,'Gesture target is visible');await locator.dispatchEvent(type,{pointerId,pointerType:'touch',isPrimary:true,button:0,clientX:box.x+Math.min(20,box.width/2)+dx,clientY:box.y+Math.min(20,box.height/2)+dy});}
async function realTouchHold(locator,durationMs){
  await locator.scrollIntoViewIfNeeded();await frame();
  const box=await locator.boundingBox();assert.ok(box,'Real touch target is visible');
  const point={x:box.x+Math.min(30,box.width/2),y:box.y+Math.min(25,box.height/2)};
  const hit=await page.evaluate(({x,y})=>{window.__gestureMeta=[];window.__gestureStart=performance.now();const target=document.elementFromPoint(x,y),anchor=target?.closest?.('[data-forwardable-message]')?.closest('[data-message-id]');return{tag:target?.tagName||null,anchorId:anchor?.dataset.messageId||null};},point);
  const cdp=await context.newCDPSession(page);
  let openedWhileHeld=false;
  try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,radiusX:1,radiusY:1,force:1}]});await page.waitForTimeout(durationMs);openedWhileHeld=await page.locator('.forward-sheet').count()>0;await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);}
  finally{await cdp.detach();}
  const observed=await page.evaluate(()=>({events:window.__gestureMeta,selectionType:window.getSelection()?.type||null,selectionRangeCount:window.getSelection()?.rangeCount||0,opened:!!document.querySelector('.forward-sheet')}));
  const evidence={durationMs,point,hit,openedWhileHeld,...observed,sourceHashes:{gestures:servedAssets['message-gestures.js'],styles:servedAssets['styles.css'],app:servedAssets['app.js']},driver:'Playwright-owned Chromium CDP Input.dispatchTouchEvent; trusted browser input, no user-browser access'};
  realTouchChecks.push(evidence);const text=JSON.stringify({observedAt:new Date().toISOString(),checks:realTouchChecks},null,2)+'\n';await fs.writeFile(path.join(out,'real-touch-evidence.json'),text);await fs.writeFile(path.join(out,`real-touch-evidence-${Date.now()}.json`),text);
  assert.equal(openedWhileHeld,true,`Real Chromium ${durationMs}ms touch hold must open message operations before release; see real-touch-evidence.json`);
  assert.equal(observed.opened,true,`Real Chromium ${durationMs}ms touch hold must keep message operations open after release; see real-touch-evidence.json`);
  assert.ok(observed.events.some(event=>event.type==='pointerdown'&&event.isTrusted&&event.pointerType==='touch'),'Real touch must produce a trusted touch pointer event');
  await action('forward-cancel').tap();await page.locator('.forward-sheet').waitFor({state:'detached'});
}

try{
  await page.goto(`${origin}/__ziwei_manager__/index.html`);await page.getByRole('heading',{name:'聊天',exact:true}).waitFor();await action('chat',sourceEmployee.id).waitFor();
  assert.equal(await page.locator('.nav-item.active').getAttribute('data-tab'),'chat');assert.ok(await page.locator('.nav-unread').count());await capture('01-recent-chats');
  await action('chat',sourceEmployee.id).click();await page.locator(`[data-message-id="${originalLatest.id}"]`).waitFor();
  await until(()=>readRequests().some(request=>request.body.messageId===originalLatest.id&&request.status===200),'latest visible persisted system message was acknowledged read');
  checks.push('real authenticated inbox opens the original main; visible persisted system message is read');
  const timeline=page.locator('.chat-timeline');await timeline.evaluate(element=>element.scrollTop=0);await frame();
  const hiddenLatest=add(source,{role:'system',content:'尚未进入可见区域的新系统消息 HIDDEN-LATEST'});await resume();await page.waitForTimeout(120);
  assert.equal(readRequests().some(request=>request.body.messageId===hiddenLatest.id),false,'An appended off-screen message must not be marked read');
  await timeline.evaluate(element=>element.scrollTop=element.scrollHeight);await until(()=>readRequests().some(request=>request.body.messageId===hiddenLatest.id&&request.status===200),'new message became visible and was acknowledged read');
  const cursorWrites=readRequests().filter(request=>request.body.messageId===hiddenLatest.id).length;await resume();await page.waitForTimeout(120);assert.equal(readRequests().filter(request=>request.body.messageId===hiddenLatest.id).length,cursorWrites,'Repeated polls cannot resend the same read cursor');
  checks.push('only visible latest IDs advance read state; an off-screen appended message waits for scrolling; polls deduplicate');

  await page.locator('[name=draft]').fill('原聊天草稿必须保留 SOURCE-DRAFT');
  const bubble=page.locator(`[data-message-id="${userMessage.id}"] .message-bubble`).first();await bubble.scrollIntoViewIfNeeded();
  await realTouchHold(bubble,800);await realTouchHold(bubble,1200);checks.push('trusted Chromium800ms/1200ms holds keep the menu open through release; an immediate new intentional touch closes it normally');
  await pointer(bubble,'pointerdown');await pointer(bubble,'pointermove',{dx:22});await page.waitForTimeout(560);await pointer(bubble,'pointerup',{dx:22});assert.equal(await page.locator('.forward-sheet').count(),0,'Moving over10px cancels a long press');
  await pointer(bubble,'pointerdown',{pointerId:72});await timeline.evaluate(element=>{element.scrollTop+=20;element.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(560);await pointer(bubble,'pointerup',{pointerId:72});assert.equal(await page.locator('.forward-sheet').count(),0,'Scrolling cancels a long press');
  await bubble.scrollIntoViewIfNeeded();await pointer(bubble,'pointerdown',{pointerId:73});await page.waitForTimeout(560);await pointer(bubble,'pointerup',{pointerId:73});await page.getByRole('heading',{name:'消息操作',exact:true}).waitFor();await action('forward-cancel').click();
  const image=page.locator(`[data-message-id="${photoMessage.id}"] .message-image`).first();await image.tap();await page.locator('.image-overlay img').evaluate(element=>element.decode());assert.equal(await page.locator('.image-overlay img').evaluate(element=>element.naturalWidth),1);assert.equal(await page.locator('.forward-sheet').count(),0);await action('close-image').click();
  checks.push('DOM touch pointer long-press opens menu; movement/scroll cancel; short real touch tap still previews images');

  await action('message-menu',photoMessage.id).click();
  const overlayLatest=add(source,{role:'system',content:'转发面板遮挡时不记已读 OVERLAY-LATEST'});await resume();await page.waitForTimeout(120);assert.equal(readRequests().some(request=>request.body.messageId===overlayLatest.id),false,'A forwarding overlay blocks read marking');
  await action('forward-select').click();await action('forward-toggle',userMessage.id).click();assert.match(await page.locator('.forward-selection-bar').innerText(),/已选 2 \/ 20 条/);await capture('02-multi-select');
  await action('forward-next').click();assert.equal(await page.locator(`[data-action=forward-target][data-id="${sourceEmployee.id}"]`).count(),0);await action('forward-target',targetEmployee.id).click();
  assert.equal(await page.locator('[name=forward-mode][value=reference]').isChecked(),true);await page.locator('[name=forward-note]').fill('请参考这段讨论，不启动执行');await capture('03-reference-confirm');
  const sourceIds=repo.getConversation(source.id).messages.map(message=>message.id),targetBefore=repo.getConversation(target.id).messages.length,actionsBefore=repo.listA2AActions(slug,{status:'all'}).length;
  await submitForward();await complete();
  const reference=forwardRequests()[0];assert.deepEqual(reference.body.messageIds,[userMessage.id,photoMessage.id]);assert.equal(reference.body.mode,'reference');assert.equal(repo.listA2AActions(slug,{status:'all'}).length,actionsBefore);assert.equal(repo.getConversation(target.id).messages.length,targetBefore+1);assert.deepEqual(repo.getConversation(source.id).messages.map(message=>message.id),sourceIds);assert.equal(await page.locator('[name=draft]').inputValue(),'原聊天草稿必须保留 SOURCE-DRAFT');
  assert.deepEqual(repo.listConversations(slug).map(item=>item.id).sort(),originalConversationIds);checks.push('multi-select sends source order once; record-only is default, dispatches nothing and preserves source draft/history and target identity');
  await action('forward-open-target').click();await page.getByRole('heading',{name:targetEmployee.name,exact:true}).waitFor();await page.getByText('目标员工原来就有的历史 TARGET-ORIGINAL',{exact:true}).waitFor();
  const forwardedId=reference.receipt.message.id,record=page.locator(`[data-action=forward-detail][data-id="${forwardedId}"]`);await record.waitFor();assert.equal(await page.locator(`[data-message-id="${forwardedId}"] > .message-body > .message-bubble > .prose`).count(),1,'Only the note is shown beside the compact snapshot card');
  await record.click();await page.locator('.forward-detail-messages').waitFor();await page.getByText(photoMessage.content,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>typeof window.__snapshotUnsafe),'undefined');
  const snapshotImage=page.locator('.forward-detail-messages .message-image img');await snapshotImage.evaluate(element=>element.decode());assert.equal(await snapshotImage.getAttribute('src'),`data:image/png;base64,${png}`);await capture('04-forward-record-detail');await snapshotImage.locator('..').tap();await page.locator('.image-overlay').waitFor();await action('close-image').click();await action('forward-detail-close').click();
  checks.push('server v1 card renders a compact snapshot; detail escapes original text and decodes the original image entirely in App');

  await sourceHome();await singleForward(userMessage.id,'');const emptyNoteBefore=repo.getConversation(target.id).messages.length;await submitForward();await complete();
  const emptyNote=forwardRequests().at(-1);assert.equal(emptyNote.body.note,'');assert.equal(emptyNote.body.mode,'reference');assert.equal(emptyNote.receipt.message.forward.note||'','');assert.equal(repo.getConversation(target.id).messages.length,emptyNoteBefore+1);assert.equal(repo.listA2AActions(slug,{status:'all'}).length,actionsBefore);await action('forward-cancel').click();
  checks.push('an omitted optional note completes a real record-only forward without an uncertain receipt or execution');

  await sourceHome();await singleForward(photoMessage.id,'未知回执隔离验收');const beforeLost=repo.getConversation(target.id).messages.length;loseNextForwardReceipt=true;await submitForward();await page.getByRole('heading',{name:'转发回执待确认',exact:true}).waitFor();
  assert.equal(await page.locator('[name=forward-note],[name=forward-mode]').count(),0);const lost=forwardRequests().at(-1);assert.equal(lost.receiptLost,true);await capture('05-uncertain-receipt');await action('forward-retry').click();await complete();const retried=forwardRequests().at(-1);assert.deepEqual(retried.body,lost.body);assert.equal(repo.getConversation(target.id).messages.length,beforeLost+1);assert.equal(repo.listA2AActions(slug,{status:'all'}).length,actionsBefore);await action('forward-cancel').click();
  checks.push('a committed but lost receipt shows uncertainty; explicit same-payload/key retry produces one record and no execution');

  await singleForward(userMessage.id,'隔离验收：请根据这段记录继续整理方案');assert.equal(await page.locator('[name=forward-mode][value=reference]').isChecked(),true);await page.locator('[name=forward-mode][value=execute]').check();assert.equal(await page.locator('[name=forward-mode][value=execute]').isChecked(),true);await capture('06-execute-explicit');await submitForward();await complete();
  const execution=forwardRequests().at(-1);assert.equal(execution.body.mode,'execute');assert.ok(execution.receipt.execution?.id);assert.equal(repo.listA2AActions(slug,{status:'all'}).length,actionsBefore+1);await action('forward-cancel').click();assert.equal(await page.locator('[name=draft]').inputValue(),'原聊天草稿必须保留 SOURCE-DRAFT');
  checks.push('execute requires a separate explicit radio choice and creates exactly one queued in-memory action');

  await page.setViewportSize({width:360,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(context.pages().length,1);assert.equal(popupCount,0);assert.deepEqual(errors,[]);assert.deepEqual(externalCalls,[]);assert.equal(lostReceipts,1);assert.ok(readRequests().every(request=>request.status===200),'All visible read cursors require a successful server receipt');assert.ok(requests.every(request=>request.method==='GET'||/^\/api\/conversations\/[^/]+\/(read|forwards)$/.test(request.path)));checks.push('360px layout stays in one App document with no popup, external call or standalone message dispatch');
  const result={passed:true,observedAt:new Date().toISOString(),checks,screenshots,requests:requests.length,forwardPosts:forwardRequests().length,lostReceipts,readCursorPosts:readRequests().length,popupCount,externalCalls,queuedFixtureActions:1,realDeviceActions:0,externalModelCalls:0,listenerCount:0,navigations,realTouchChecks,evidence:'Complete App DOM and authenticated real in-memory Express/repository. Long holds use trusted Chromium touch input through a Playwright-owned CDP pipe; movement/scroll isolation also uses synthetic PointerEvents. One server receipt is deliberately lost after commit; no production, user browser or HTTP listener.'};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(error){
  await capture('failure').catch(()=>{});await fs.writeFile(path.join(out,`failure-${Date.now()}.json`),JSON.stringify({passed:false,error:error.stack||error.message,errors,checks,requests,externalCalls,realTouchChecks,body:await page.locator('body').innerText().catch(()=>null)},null,2)+'\n');throw error;
}finally{await context.close();await browser.close();globalThis.fetch=originalFetch;repo.db.close();}
