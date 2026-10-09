#!/usr/bin/env node
/** Real HTTPS browser evidence. All business writes are blocked; only existing resources are read. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const origin='https://qzelynth.top';
const session=JSON.parse(await readFile(resolve(option('--session-file','')),'utf8'));
assert.ok(typeof session.token==='string'&&session.token.length>10,'A private QA session file is required');
const workspace=option('--workspace',session.workspace);
assert.ok(workspace,'Explicit workspace required');
const employeeIds=option('--employee-ids','').split(',').map(value=>value.trim()).filter(Boolean);
const output=resolve(option('--output','.local/default-management-live'));
await mkdir(output,{recursive:true});
const require=createRequire(import.meta.url);
const {chromium}=require(option('--playwright','C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser=await chromium.launch({headless:true});
const evidence={mode:'real-https-readonly',origin,workspace,observedAt:new Date().toISOString(),tests:[],screenshots:[],states:[],employeeSnapshots:[],assets:[],blockedWrites:[],apiResponses:[],pageErrors:[],consoleErrors:[],failedRequests:[],realDeviceActions:0};
const safe=value=>String(value).replaceAll(session.token,'[private-session]');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function shot(page,name,subject){
  if(subject)await subject.scrollIntoViewIfNeeded();
  const style=await page.addStyleTag({content:'.sidebar-account { visibility:hidden!important; }'});
  try{const path=join(output,name);await page.screenshot({path,fullPage:true});evidence.screenshots.push(path);}finally{await style.evaluate(node=>node.remove());}
}
async function get(context,path){const response=await context.request.get(origin+path);assert.equal(response.status(),200,`Read-only GET ${path} failed`);return response.json();}
function checkSafe(status){
  assert.equal(status.managed,true);assert.equal(status.default_enabled,true);assert.equal(status.credential?.managed,true);
  assert.equal(status.workspace,workspace);assert.deepEqual(status.workspaces,[workspace]);
  for(const connection of status.connections || []){
    assert.equal(connection.workspace,workspace);assert.ok(['pending','ready','failed','client_required'].includes(connection.state));
    assert.ok(!Object.keys(connection).some(key=>/token|secret|password|credential.?file/i.test(key)),'Private connection values returned to browser');
  }
  assert.ok(!Object.keys(status.credential || {}).some(key=>/^(token|secret|deviceToken|tokenFile|credentialFile)$/i.test(key)),'Private credential returned to browser');
  assert.ok(!JSON.stringify(status).includes(session.token),'Session secret returned by status');
}
async function scene(width,height,employeeId){
  const name=`${employeeId?'employee-'+employeeId:'platform'}-${width}x${height}`;
  const context=await browser.newContext({viewport:{width,height}});
  const cookie={name:'ziwei_session',value:session.token,url:origin,httpOnly:true,secure:true,sameSite:'Lax'};
  if(session.expiresAt)cookie.expires=Math.floor(Date.parse(session.expiresAt)/1000);
  await context.addCookies([cookie]);
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(!['GET','HEAD','OPTIONS'].includes(request.method())){evidence.blockedWrites.push({method:request.method(),path:url.pathname});return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol))return route.abort();return route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>evidence.pageErrors.push(safe(error.message)));
  page.on('console',message=>{if(message.type()==='error')evidence.consoleErrors.push(safe(message.text()));});
  page.on('requestfailed',request=>evidence.failedRequests.push({path:new URL(request.url()).pathname,error:safe(request.failure()?.errorText)}));
  page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/'))evidence.apiResponses.push({path:url.pathname,status:response.status(),method:response.request().method()});});
  let before;
  try{
    const me=await get(context,'/api/auth/me');assert.ok(me.memberships.some(item=>item.slug===workspace),'QA session has no workspace membership');
    before=(await get(context,`/api/workspaces/${encodeURIComponent(workspace)}/employees`)).employees;
    if(employeeId)assert.ok(before.some(item=>item.id===employeeId),'Exact existing employee missing');
    for(const phase of ['initial','refresh','reload']){
      if(phase==='initial'||phase==='reload'){
        if(phase==='initial')await page.goto(`${origin}/${encodeURIComponent(workspace)}/${employeeId?'employee/'+encodeURIComponent(employeeId):'open-platform'}`,{waitUntil:'domcontentloaded',timeout:45000});else await page.reload({waitUntil:'domcontentloaded',timeout:45000});
        if(employeeId)await page.getByRole('tab',{name:'♧ MCP',exact:true}).click();
      }
      const panel=page.getByTestId('management-mcp-panel');
      if(phase==='refresh')await panel.getByRole('button',{name:'刷新真实状态',exact:true}).click();
      await panel.getByTestId('mcp-workspace').getByText(workspace,{exact:true}).waitFor();
      const text=await panel.innerText();assert.match(text,/默认自动接入/);assert.doesNotMatch(text,/由管理员生成|开启员工管理 MCP|关闭员工管理 MCP/);assert.ok(!text.includes(session.token));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal page overflow');
      const status=await get(context,`/api/workspaces/${encodeURIComponent(workspace)}/mcp/status`);checkSafe(status);
      evidence.states.push({scene:name,phase,managed:status.managed,defaultEnabled:status.default_enabled,connections:(status.connections||[]).map(({device_id,state,configured,workspace,reasonCode})=>({device_id,state,configured,workspace,reasonCode}))});
      const assets=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(node=>new URL(node.src).pathname));evidence.assets.push({scene:name,phase,scripts:assets});
      await shot(page,`${name}-${phase}-summary.png`,panel.locator('h3'));
      if(employeeId){
        const employeeStatus=await get(context,`/api/workspaces/${encodeURIComponent(workspace)}/employees/${encodeURIComponent(employeeId)}/mcp/status`);
        assert.equal(employeeStatus.enabled,true,'Existing employee is not effectively managed');
        const receipt=employeeStatus.receipt;const calls=receipt?.tool_calls || [];
        if(receipt?.loaded&&calls.length&&calls.every(call=>call.ok===false))assert.doesNotMatch(await panel.getByTestId('employee-mcp-evidence').innerText(),/已加载并调用工具/);
        evidence.states.push({scene:name,phase,employeeId,enabled:employeeStatus.enabled,runtime:employeeStatus.runtime,profile:employeeStatus.runtime_profile||null,receipt:{status:receipt?.status,loaded:receipt?.loaded,injected:receipt?.injected,actionId:receipt?.action_id,tools:calls.map(call=>({name:call.toolName||call.name||call.tool,ok:call.ok}))}});
        await shot(page,`${name}-${phase}-receipt.png`,panel.getByTestId('employee-mcp-evidence'));
      }else for(const connection of status.connections||[])await shot(page,`${name}-${phase}-${connection.device_id}.png`,panel.locator(`[data-device-id="${connection.device_id}"]`));
    }
  }finally{
    try{if(before){const after=(await get(context,`/api/workspaces/${encodeURIComponent(workspace)}/employees`)).employees;const unchanged=digest(before)===digest(after);evidence.employeeSnapshots.push({scene:name,beforeCount:before.length,afterCount:after.length,beforeHash:digest(before),afterHash:digest(after),unchanged});assert.ok(unchanged,'Read-only inspection changed employee data');}}finally{await context.close();}
  }
}
try{
  for(const[width,height]of[[1440,900],[390,844],[720,450]])for(const employeeId of [null,...employeeIds]){
    const name=`${employeeId||'platform'} ${width}x${height}`;
    try{await scene(width,height,employeeId);evidence.tests.push({name,passed:true});process.stdout.write(`PASS ${name}\n`);}catch(error){evidence.tests.push({name,passed:false,error:safe(error.message)});process.stderr.write(`FAIL ${name}: ${safe(error.message)}\n`);}
  }
}finally{
  await browser.close();
  evidence.passed=evidence.tests.every(test=>test.passed)&&!evidence.blockedWrites.length&&!evidence.pageErrors.length&&!evidence.consoleErrors.length&&!evidence.failedRequests.length;
  await writeFile(join(output,'results.json'),JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify({passed:evidence.passed,tests:evidence.tests.length,screenshots:evidence.screenshots.length,blockedWrites:evidence.blockedWrites.length,pageErrors:evidence.pageErrors.length,consoleErrors:evidence.consoleErrors.length,failedRequests:evidence.failedRequests.length,output})+'\n');if(!evidence.passed)process.exitCode=1;
}
