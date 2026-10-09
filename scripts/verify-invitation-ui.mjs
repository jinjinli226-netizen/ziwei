// Real recipient browser flows. Default: isolated in-memory API + built frontend.
// --base https://... --private-fixture <ignored file> exercises dedicated live QA resources.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../backend/app.mjs';
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const output=resolve(option('--output','.local/invite-ui'));
await mkdir(output,{recursive:true});
let base=option('--base',''); let server;
let fixture;
if (!base) {
  const app=createApp({memory:true,requireAuth:true,enableScheduler:false});
  server=createServer(async(req,res)=>{
    if (/^\/(api|a2a)\//.test(req.url)) return app(req,res);
    const path=new URL(req.url,'http://fixture.test').pathname;
    try {const file=resolve('frontend/dist',path.startsWith('/assets/')?`.${path}`:path==='/ziwei-logo.png'?'.'+path:'index.html'); const bytes=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream'}).end(bytes);}
    catch {res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  const repo=app.locals.repo;
  const owner=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'QA Owner',email:'ui-owner@example.test',password:crypto.randomBytes(24).toString('base64url')})});
  const cookie=owner.headers.get('set-cookie').split(';')[0];
  for (const [slug,kind] of [['ui-personal','personal'],['ui-team','team']]) await fetch(base+'/api/workspaces',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({name:'QA Invitations',slug,kind})});
  fixture={password:crypto.randomBytes(24).toString('base64url'),links:{},emails:{link:'ui-link@example.test',bound:'ui-bound@example.test',existing:'ui-existing@example.test'}};
  const add=(key,slug='ui-team',body={})=>{const i=repo.createInvitation(slug,body);fixture.links[key]={code:i.code,workspace:slug};return i;};
  add('link','ui-personal');add('bound','ui-team',{email:fixture.emails.bound});add('existing');
  const revoked=add('revoked');repo.revokeInvitation(revoked.id);
  const expired=add('expired');repo.db.prepare("UPDATE invitations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(expired.id);
  fixture.links.invalid={code:crypto.randomBytes(12).toString('base64url'),workspace:'ui-team'};
  await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'QA Existing',email:fixture.emails.existing,password:fixture.password})});
} else {fixture=JSON.parse(await readFile(option('--private-fixture',''),'utf8'));}
const require=createRequire(import.meta.url);
const {chromium}=require(option('--playwright','C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({headless:true});
const results={mode:server?'isolated-real-api':'live-real-domain',base,observedAt:new Date().toISOString(),checks:[],pageErrors:0,unexpectedResponses:0};
const contexts=[];
const url=key=>`${base}/invite?${new URLSearchParams(fixture.links[key])}`;
async function open(key,viewport={width:850,height:620}) {
  const context=await browser.newContext({viewport,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'});contexts.push(context);
  const page=await context.newPage();page.on('pageerror',()=>results.pageErrors++);
  page.on('response',r=>{if(r.status()>=500)results.unexpectedResponses++;});
  await page.goto(url(key)); await page.getByRole('button',{name:'创建账号并登录',exact:true}).waitFor();
  assert.equal(await context.cookies().then(c=>c.some(x=>x.name==='ziwei_session')),false);
  return page;
}
async function fill(page,email,confirm=fixture.password) {
  await page.getByPlaceholder('你的姓名',{exact:true}).fill('QA Recipient');
  await page.getByPlaceholder('name@example.com',{exact:true}).fill(email);
  await page.getByPlaceholder('至少 8 位',{exact:true}).fill(fixture.password);
  await page.locator('input[type=password]').nth(1).fill(confirm);
}
async function submit(page) {await page.getByRole('button',{name:'创建账号并登录',exact:true}).click();}
async function visibleError(page,pattern) {
  const error=page.locator('[data-auth-error]'); await error.waitFor(); assert.match(await error.innerText(),pattern);
  const box=await error.boundingBox(),viewport=page.viewportSize(); assert.ok(box.y>=0&&box.y+box.height<=viewport.height,'error in current viewport');
  const style=await error.evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));assert.equal(style.color,'rgb(169, 46, 46)');
  await page.waitForTimeout(3400); assert.equal(await error.isVisible(),true,'persistent error');
}
async function member(page,slug,email) {
  await page.waitForURL(`**/${slug}/home`);
  const status=await page.evaluate(()=>fetch('/api/auth/status').then(r=>r.json()));assert.equal(status.authenticated,true);
  const m=status.memberships.find(m=>m.slug===slug);assert.ok(m);assert.equal(m.role,'member');assert.equal(status.user.email,email);
  assert.equal(await page.evaluate(slug=>fetch(`/api/workspaces/${slug}/summary`).then(r=>r.status),slug),200);
  assert.equal(await page.evaluate(slug=>fetch(`/api/workspaces/${slug}/settings`).then(r=>r.status),slug),403);
  await page.reload();await page.locator('.workspace-picker').waitFor();assert.equal(new URL(page.url()).pathname,`/${slug}/home`);
}
async function check(name,fn){try{await fn();results.checks.push({name,passed:true});process.stdout.write(`PASS ${name}\n`);}catch(e){results.checks.push({name,passed:false,error:e.message.replace(/(?:code|password)=[^&\s]+/gi,'$1=[redacted]')});process.stderr.write(`FAIL ${name}: ${results.checks.at(-1).error}\n`);}}
try {
  await check('personal link: narrow Mac Chrome, visible mismatch, retry, automatic login, correct membership and refresh',async()=>{
    const page=await open('link');await fill(page,fixture.emails.link,'incorrect-confirmation');await submit(page);await visibleError(page,/两次密码不一致/);
    await page.screenshot({path:resolve(output,'narrow-error.png'),mask:[page.locator('input')]});
    await page.locator('input[type=password]').nth(1).fill(fixture.password);await submit(page);await member(page,fixture.links.link.workspace,fixture.emails.link);
  });
  await check('email invitation: mismatch stays visible, corrected email registers and refreshes',async()=>{
    const page=await open('bound',{width:1440,height:1000});await fill(page,'wrong-'+fixture.emails.bound);await submit(page);await visibleError(page,/邮箱.*不匹配/);
    await page.getByPlaceholder('name@example.com',{exact:true}).fill(fixture.emails.bound);await submit(page);await member(page,fixture.links.bound.workspace,fixture.emails.bound);
  });
  await check('existing account: explicit login then accept immediately grants current session access',async()=>{
    const page=await open('existing');await fill(page,fixture.emails.existing);await submit(page);await visibleError(page,/已注册/);
    await page.getByRole('button',{name:'已有账号，登录',exact:true}).click();
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.getByRole('button',{name:'接受邀请',exact:true}).waitFor();
    await page.getByRole('button',{name:'接受邀请',exact:true}).click();await member(page,fixture.links.existing.workspace,fixture.emails.existing);
  });
  for(const [key,pattern] of [['invalid',/无效/],['expired',/过期/],['revoked',/撤销/]]) await check(`${key}: specific persistent error at 390px`,async()=>{
    const page=await open(key,{width:390,height:680});await fill(page,`${key}-`+fixture.emails.link);await submit(page);await visibleError(page,pattern);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:resolve(output,`${key}-390.png`),mask:[page.locator('input')]});
  });
} finally {for(const c of contexts)await c.close();await browser.close();if(server)await new Promise(r=>server.close(r));await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2)+'\n');}
assert.equal(results.pageErrors,0);assert.equal(results.unexpectedResponses,0);assert.ok(results.checks.every(c=>c.passed),'recipient browser acceptance failed');
