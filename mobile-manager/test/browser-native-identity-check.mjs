// Packaged-document integration with a synthetic native bridge. All requests are
// routed in memory; no listener, token, production request or device action.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url))),web=path.join(root,'mobile-manager/web'),out=path.join(root,'.local/mobile-manager-identity-qa');
await fs.mkdir(out,{recursive:true});
const origin='https://qzelynth.top',documentUrl=`${origin}/__ziwei_manager__/index.html`,network=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.ZIWEI_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin||!url.pathname.startsWith('/__ziwei_manager__/')){network.push(`${route.request().method()} ${url.origin}${url.pathname}`);return route.abort();}
    const name=url.pathname.slice('/__ziwei_manager__/'.length);
    if(!/^[a-z-]+\.(html|m?js|css|png)$/.test(name))return route.abort();
    return route.fulfill({contentType:/\.m?js$/.test(name)?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await fs.readFile(path.join(web,name))});
  });
  await context.addInitScript(()=>{
    let status={available:true,mode:'oidc',configured:false,authenticated:false,message:'Android 客户端尚未注册'},account='native-one';
    const calls=[];globalThis.identityFixture={calls,set(next,nextAccount){status={...status,...next};if(nextAccount)account=nextAccount;window.dispatchEvent(new CustomEvent('ziwei:identity',{detail:{...status}}));}};
    const employee={id:'original-employee',name:'原数字员工',runtime:'Other'},workspace={slug:'original-workspace',workspace_id:'original-db',role:'owner',name:'原工作区'};
    globalThis.ZiweiIdentity={
      getStatus:()=>JSON.stringify(status),
      login:()=>{calls.push({kind:'login'});status.message='请在系统浏览器完成统一登录';return JSON.stringify(status);},
      logout:()=>{calls.push({kind:'logout'});status={...status,authenticated:false};window.dispatchEvent(new CustomEvent('ziwei:identity',{detail:{...status}}));return JSON.stringify(status);},
      request(id,path,method,headersJson,body){
        calls.push({kind:'request',id,path,method,headers:JSON.parse(headersJson),body});
        let result={};
        if(path==='/api/auth/me')result={user_id:account,user:{id:account,name:'服务端映射账号'}};
        else if(path==='/api/workspaces')result={workspaces:[workspace]};
        else if(path.endsWith('/chats'))result={chats:[{conversationId:'original-main',employeeId:employee.id,employee,title:'原长期聊天',preview:'原历史',unreadCount:0,messageCount:1,latestMessageId:'original-message',updatedAt:'2026-10-23T00:00:00Z'}],unreadCount:0};
        else if(path.includes('/employees?'))result={employees:[employee]};
        else if(path.includes('/bots?'))result={bots:[]};
        else if(path.startsWith('/api/conversations/original-main?'))result={id:'original-main',employee_id:employee.id,messages:[{id:'original-message',role:'assistant',content:'这是原有聊天记录'}]};
        else if(path.endsWith('/read'))result={conversationId:'original-main',lastReadMessageId:'original-message',unreadCount:0};
        setTimeout(()=>window.dispatchEvent(new CustomEvent('ziwei:identity-response',{detail:{id,status:200,headers:{'content-type':'application/json'},body:JSON.stringify(result)}})),0);
      }
    };
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(documentUrl);
  const login=page.locator('[data-action="unified-login"]');await login.waitFor();assert.equal(await login.isDisabled(),true);assert.equal(await page.locator('[name=password],[name=username]').count(),0);
  await page.screenshot({path:path.join(out,'01-client-unregistered.png'),fullPage:true});
  await page.evaluate(()=>identityFixture.set({configured:true,authenticated:false,message:''}));await page.waitForFunction(()=>!document.querySelector('[data-action="unified-login"]')?.disabled);
  await login.click();assert.equal(await page.evaluate(()=>identityFixture.calls.filter(call=>call.kind==='login').length),1);assert.equal(await page.locator('[data-form=login]').count(),0);
  await page.evaluate(()=>identityFixture.set({authenticated:true,message:''}));await page.locator('[data-action=chat][data-id=original-employee]').first().waitFor();
  await page.locator('[data-action=chat][data-id=original-employee]').first().click();await page.getByText('这是原有聊天记录',{exact:true}).waitFor();
  await page.locator('[name=draft]').fill('原账号未发送草稿');
  await page.evaluate(()=>identityFixture.set({authenticated:true}));await page.locator('[data-action=chat][data-id=original-employee]').first().waitFor();await page.locator('[data-action=chat][data-id=original-employee]').first().click();assert.equal(await page.locator('[name=draft]').inputValue(),'原账号未发送草稿');
  await page.screenshot({path:path.join(out,'02-original-history-draft.png'),fullPage:true});
  await page.evaluate(()=>identityFixture.set({authenticated:true},'native-two'));await page.locator('[data-action=chat][data-id=original-employee]').first().waitFor();await page.locator('[data-action=chat][data-id=original-employee]').first().click();assert.equal(await page.locator('[name=draft]').inputValue(),'');
  await page.locator('[data-action=back]').first().click();await page.locator('[data-action=navigate][data-tab=me]').click();await page.locator('[data-action=logout]').click();await login.waitFor();assert.equal(await page.locator('[name=draft]').count(),0);
  const calls=await page.evaluate(()=>identityFixture.calls);assert(calls.some(call=>call.path==='/api/auth/me'));assert(!calls.some(call=>call.path==='/api/auth/login'||call.path==='/api/auth/logout'));assert(calls.filter(call=>call.kind==='request'&&call.method!=='GET').every(call=>call.path.endsWith('/read')));
  assert.equal(network.length,0,JSON.stringify(network));assert.equal(errors.length,0,JSON.stringify(errors));
  const result={passed:true,checks:['unregistered Android fails closed','no legacy credentials or cookie API fallback','unified login action','server native principal mapping','original history','same-account draft restored','other-account draft isolation','local logout'],nativeCalls:calls.length,externalRequests:0,listeners:0,realDeviceActions:0,productionRequests:0,screenshots:[path.join(out,'01-client-unregistered.png'),path.join(out,'02-original-history-draft.png')],limitation:'Synthetic bridge UI integration; no real provider, token, APK, keyboard or physical-device claim'};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally { await browser.close(); }
