// Isolated Chromium IME/DOM regression. Every request is fulfilled in memory;
// no listener, production account, real business write or Android keyboard claim.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/zhangjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url))),web=path.join(root,'mobile-manager/web');
const baseline=process.env.ZIWEI_EDITOR_BASELINE||'';
if(baseline&&!/^[a-f0-9]{40}$/.test(baseline))throw new Error('Baseline must be an exact Git revision');
const out=path.join(root,`.local/mobile-manager-input-composition-qa${baseline?`-baseline-${baseline.slice(0,7)}`:''}`);
await fs.mkdir(out,{recursive:true});
const origin='https://ziwei-editor.invalid',slug='editor-fixture',userId='editor-user',employeeId='editor-employee',conversationId='editor-conversation';
const secondId='editor-second',secondConversation='editor-second-conversation',otherSlug='editor-other-workspace',otherConversation='editor-other-conversation';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const employee={id:employeeId,name:'隔离输入验收员工',runtime:'Hermes',status:'active',main_conversation_id:conversationId};
const bot={id:employeeId,employee,workspace:slug,configuration_state:'initialized',control_state:'idle',main_conversation_id:conversationId};
employee.bot=structuredClone(bot);
const secondEmployee={id:secondId,name:'第二位隔离员工',runtime:'Codex',status:'active',main_conversation_id:secondConversation};
const otherEmployee={id:employeeId,name:'另一个工作区的隔离员工',runtime:'Codex',status:'active',main_conversation_id:otherConversation};
const message=(id,content,extra={})=>({id,role:'assistant',content,created_at:'2026-10-18T01:00:00.000Z',...extra});
const control={runs:[],runsFailure:false,heldSends:[],messages:Array.from({length:140},(_,i)=>message(`message-${i}`,`历史 ${i} ${'长聊天内容用于校验刷新期间不重建已解码节点。'.repeat(20)}`))};
control.messages[139]=message('image-message','保留的图片',{attachments:[{name:'kept.png',mimeType:'image/png',contentEncoding:'base64',content:png}]});
const requests=[],errors=[],checks=[];
const browser=await chromium.launch({executablePath:process.env.ZIWEI_BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(8000);
page.on('pageerror',error=>errors.push(error.message));
const json=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
  if(url.origin!==origin){errors.push(`Unexpected external request ${url.origin}${p}`);return route.abort();}
  if(p.startsWith('/__ziwei_manager__/')){
    const asset=p.slice('/__ziwei_manager__/'.length)||'index.html';
    if(!/^[a-z-]+\.(html|m?js|css|png)$/.test(asset))return route.abort();
    return route.fulfill({contentType:/\.m?js$/.test(asset)?'application/javascript':asset.endsWith('.css')?'text/css':asset.endsWith('.png')?'image/png':'text/html',body:baseline?execFileSync('git',['show',`${baseline}:mobile-manager/web/${asset}`],{cwd:root}):await fs.readFile(path.join(web,asset))});
  }
  requests.push({method,path:p});
  const reading=p.match(/^\/api\/conversations\/([^/]+)\/read$/);
  if(reading&&method==='POST')return json(route,{conversationId:reading[1],lastReadMessageId:request.postDataJSON().messageId,unreadCount:0});
  if(p===`/api/conversations/${conversationId}/messages`&&method==='POST'){
    control.heldSends.push({body:request.postDataJSON(),release:async()=>{
      control.messages.push(message(`user-${control.heldSends.length}`,request.postDataJSON().content,{role:'user'}));
      await json(route,{message:{id:`user-${control.heldSends.length}`},duplicate:false});
    }});return;
  }
  if(method!=='GET'){errors.push(`Unexpected write ${method} ${p}`);return json(route,{error:'No real writes'},405);}
  const workspace={id:'editor-member',workspace_id:'editor-workspace',slug,name:'隔离输入验收',role:'owner'};
  const otherWorkspace={id:'editor-other-member',workspace_id:'editor-other-id',slug:otherSlug,name:'第二个隔离工作区',role:'owner'};
  if(p==='/api/auth/me')return json(route,{user_id:userId,user:{id:userId,name:'隔离输入验收'},memberships:[workspace,otherWorkspace]});
  if(p==='/api/workspaces')return json(route,{workspaces:[workspace,otherWorkspace]});
  const thread=(person,conversation,messages)=>({conversationId:conversation,employeeId:person.id,employee:person,title:'原聊天',preview:'历史',updatedAt:'2026-10-18T01:00:00.000Z',unreadCount:0,latestMessageId:messages.at(-1).id,messageCount:messages.length});
  const otherBase=`/api/workspaces/${otherSlug}`,otherMessages=[message('other-message','第二个工作区的独立历史')];
  if(p===`${otherBase}/chats`)return json(route,{chats:[thread(otherEmployee,otherConversation,otherMessages)],unreadCount:0});
  if(p===`${otherBase}/employees`)return json(route,{employees:[otherEmployee]});
  if(p===`${otherBase}/bots`)return json(route,{bots:[]});
  if(p===`${otherBase}/mobile/notifications-v2`)return json(route,{schemaVersion:2,accountId:userId,workspaceId:otherWorkspace.workspace_id,workspaceSlug:otherSlug,items:[],nextCursor:'other_cursor',hasMore:false});
  const base=`/api/workspaces/${slug}`;
  if(p===`${base}/mobile/notifications-v2`)return json(route,{schemaVersion:2,accountId:userId,workspaceId:workspace.workspace_id,workspaceSlug:slug,items:[],nextCursor:'editor_cursor',hasMore:false});
  if(p===`${base}/chats`)return json(route,{chats:[thread(employee,conversationId,control.messages),thread(secondEmployee,secondConversation,[message('second-message','第二位员工历史')])],unreadCount:0});
  if(p===`${base}/employees`)return json(route,{employees:[employee,secondEmployee]});
  if(p===`${base}/bots`)return json(route,{bots:[bot]});
  if(p===`${base}/bots/${employeeId}`)return json(route,bot);
  if(p===`${base}/bots/${employeeId}/runs`)return control.runsFailure?json(route,{error:'隔离运行记录暂时不可用'},503):json(route,{runs:control.runs});
  if(p===`${base}/bots/${employeeId}/routines`)return json(route,{routines:[]});
  if(p===`${base}/tasks`)return json(route,{tasks:[]});
  if(p===`${base}/devices`)return json(route,{devices:[]});
  if(p===`/api/conversations/${conversationId}`)return json(route,{id:conversationId,employee_id:employeeId,workspace:slug,messages:control.messages});
  if(p===`/api/conversations/${secondConversation}`)return json(route,{id:secondConversation,employee_id:secondId,workspace:slug,messages:[message('second-message','第二位员工历史')]});
  if(p===`/api/conversations/${otherConversation}`)return json(route,{id:otherConversation,employee_id:employeeId,workspace:otherSlug,messages:otherMessages});
  errors.push(`Unhandled ${method} ${p}`);return json(route,{error:'Unhandled fixture'},404);
});
const raf=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const refresh=async()=>{
  const history=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/conversations/${conversationId}`);
  const runs=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/workspaces/${slug}/bots/${employeeId}/runs`);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ziwei:resume')));await Promise.all([history,runs]);await raf();
};
const editor=page.locator('textarea[name=draft]');
try{
  await page.goto(`${origin}/__ziwei_manager__/index.html`);
  await page.locator(`.thread-row[data-id="${employeeId}"]`).click();await page.locator('[data-message-id=image-message]').waitFor();await raf();
  await page.locator('.chat-timeline').evaluate(node=>{node.scrollTop=node.scrollHeight;});
  await page.locator('[data-message-id=image-message] img').evaluate(img=>img.decode());
  await editor.fill('前缀 ');await editor.focus();
  await editor.evaluate(field=>{
    const protectedNodes=[];for(let node=field;node&&node.id!=='app';node=node.parentElement)protectedNodes.push(node);
    window.__editorProof={field,form:field.form,timeline:document.querySelector('.chat-timeline'),image:document.querySelector('[data-message-id=image-message] img'),removed:0,focusCalls:0,selectionCalls:0,blurEvents:0};
    const proof=window.__editorProof,focus=field.focus.bind(field),selection=field.setSelectionRange.bind(field);
    field.focus=(...args)=>{proof.focusCalls++;return focus(...args);};field.setSelectionRange=(...args)=>{proof.selectionCalls++;return selection(...args);};
    field.addEventListener('blur',()=>proof.blurEvents++);
    new MutationObserver(records=>{for(const record of records)for(const removed of record.removedNodes)if(protectedNodes.some(node=>removed===node||removed.contains?.(node)))proof.removed++;}).observe(document.getElementById('app'),{childList:true,subtree:true});
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition',{text:'nihao',selectionStart:5,selectionEnd:5});
  assert.equal(await editor.inputValue(),'前缀 nihao');
  control.runs=[{id:'live-run',employee_id:employeeId,workspace:slug,status:'running'}];await refresh();await page.locator('.run-panel').waitFor();
  control.runsFailure=true;await refresh();await page.getByText('运行记录更新失败：隔离运行记录暂时不可用',{exact:false}).waitFor();
  control.runs=[];control.runsFailure=false;control.messages.push(message('new-message','轮询收到的新消息'));await refresh();
  await page.locator('.run-panel').waitFor({state:'detached'});await page.locator('[data-message-id=new-message]').waitFor();
  for(let i=0;i<8;i++)await refresh();
  const proof=await page.evaluate(()=>{
    const p=window.__editorProof;return{sameEditor:p.field===document.querySelector('[name=draft]'),sameForm:p.form===document.querySelector('[data-form=chat]'),sameTimeline:p.timeline===document.querySelector('.chat-timeline'),sameImage:p.image===document.querySelector('[data-message-id=image-message] img'),focused:document.activeElement===p.field,value:p.field.value,removed:p.removed,focusCalls:p.focusCalls,selectionCalls:p.selectionCalls,blurEvents:p.blurEvents};
  });
  if(baseline){
    assert.equal(proof.sameEditor,false);assert.ok(proof.removed>0);assert.ok(proof.blurEvents>0);
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:false,expectedBaselineFailure:true,sourceRevision:baseline,scope:'isolated Chromium, no Android keyboard claim or production writes',proof},null,2)+'\n');
    console.log(JSON.stringify({expectedBaselineFailure:true,sourceRevision:baseline,proof,evidence:path.join(out,'result.json')},null,2));
  }else{
  assert.deepEqual(proof,{sameEditor:true,sameForm:true,sameTimeline:true,sameImage:true,focused:true,value:'前缀 nihao',removed:0,focusCalls:0,selectionCalls:0,blurEvents:0});
  await cdp.send('Input.insertText',{text:'你好'});assert.equal(await editor.inputValue(),'前缀 你好');
  checks.push('real Chromium composition survives run-panel insertion/removal, auxiliary error/recovery, new history and repeated refreshes with no editor/ancestor disconnect, focus call or selection reset');
  checks.push('composition commits once without duplicate text; decoded history image and timeline retain their original nodes');
  await page.screenshot({path:path.join(out,'01-composition-after-refresh.png')});

  await page.locator('.send-button').click();await page.waitForFunction(()=>document.querySelector('.send-button').disabled);
  while(!control.heldSends.length)await raf();
  assert.equal(control.heldSends[0].body.content,'前缀 你好');
  assert.ok(control.heldSends[0].body.clientMessageId);
  await editor.focus();await cdp.send('Input.imeSetComposition',{text:'新的草稿',selectionStart:4,selectionEnd:4});
  const pendingValue=await editor.inputValue();await control.heldSends[0].release();
  await page.waitForFunction(()=>!document.querySelector('.send-button').disabled);await raf();
  assert.equal(await editor.inputValue(),pendingValue,'accepted old send must not swallow a new composition');
  await cdp.send('Input.insertText',{text:'新的草稿'});await editor.fill('只发送这一条');
  await page.locator('.send-button').click();while(control.heldSends.length<2)await raf();await control.heldSends[1].release();
  await page.waitForFunction(()=>document.querySelector('[name=draft]').value==='');
  assert.equal(await editor.evaluate(field=>field===window.__editorProof.field),true);
  assert.equal(control.heldSends.length,2);assert.notEqual(control.heldSends[0].body.clientMessageId,control.heldSends[1].body.clientMessageId);
  checks.push('accepted send clears the same editor when unchanged, preserves newer IME draft, and makes exactly one isolated send per distinct submit');
  // Programmatic delegated actions preserve the outgoing editor's focus until
  // navigation itself, as a native notification/deep link can do. A pointer
  // click on a button would blur first and hide a cross-screen focus leak.
  const jump=async(action,id)=>{
    await page.evaluate(({action,id})=>{const button=document.createElement('button');button.dataset.action=action;button.dataset.id=id;document.getElementById('app').append(button);button.click();button.remove();},{action,id});await raf();
  };
  const unfocused=async()=>assert.equal(await editor.evaluate(field=>document.activeElement===field),false,'a new screen must not inherit the old editor focus');
  await jump('chat',secondId);await page.locator('[data-message-id=second-message]').waitFor();await unfocused();
  await editor.fill('乙聊天专用草稿');await editor.evaluate(field=>field.setSelectionRange(2,2));await cdp.send('Input.imeSetComposition',{text:'待转换',selectionStart:3,selectionEnd:3});
  const secondDraft=await editor.inputValue();
  await jump('chat',employeeId);await page.locator('[data-message-id=image-message]').waitFor();await unfocused();assert.equal(await editor.inputValue(),'');
  await editor.fill('甲聊天单独保留');await editor.evaluate(field=>field.setSelectionRange(1,1));await cdp.send('Input.imeSetComposition',{text:'未提交',selectionStart:3,selectionEnd:3});
  const firstDraft=await editor.inputValue();
  await jump('chat',secondId);await page.locator('[data-message-id=second-message]').waitFor();await unfocused();
  assert.equal(await editor.inputValue(),secondDraft);assert.equal(await editor.evaluate(field=>field.selectionStart),0,'new editor does not inherit another chat caret');
  await editor.focus();await cdp.send('Input.imeSetComposition',{text:'跨区',selectionStart:2,selectionEnd:2});
  const finalSecondDraft=await editor.inputValue();
  await jump('select-workspace',otherSlug);await page.locator(`.thread-row[data-id="${employeeId}"]`).waitFor();await jump('chat',employeeId);
  await page.locator('[data-message-id=other-message]').waitFor();await unfocused();assert.equal(await editor.inputValue(),'');assert.equal(await editor.evaluate(field=>field.selectionStart),0);
  await editor.fill('第二工作区专用草稿');await editor.evaluate(field=>field.setSelectionRange(3,3));await cdp.send('Input.imeSetComposition',{text:'独立',selectionStart:2,selectionEnd:2});
  const otherDraft=await editor.inputValue();
  await jump('select-workspace',slug);await page.locator(`.thread-row[data-id="${employeeId}"]`).waitFor();await jump('chat',employeeId);
  await page.locator('[data-message-id=image-message]').waitFor();await unfocused();assert.equal(await editor.inputValue(),firstDraft);assert.equal(await editor.evaluate(field=>field.selectionStart),0);
  await jump('chat',secondId);await page.locator('[data-message-id=second-message]').waitFor();assert.equal(await editor.inputValue(),finalSecondDraft);await unfocused();
  await jump('select-workspace',otherSlug);await page.locator(`.thread-row[data-id="${employeeId}"]`).waitFor();await jump('chat',employeeId);
  await page.locator('[data-message-id=other-message]').waitFor();await unfocused();assert.equal(await editor.inputValue(),otherDraft);
  checks.push('A/B chat and workspace navigation saves the outgoing live composition to its own draft and never restores its focus or caret onto a different editor');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,scope:'isolated Chromium, no Android keyboard claim or production writes',checks,proof,requestCount:requests.length,sends:control.heldSends.map(({body})=>({clientMessageId:body.clientMessageId,content:body.content}))},null,2)+'\n');
  console.log(JSON.stringify({passed:true,checks,evidence:path.join(out,'result.json')},null,2));
  }
}finally{await context.close();await browser.close();}
