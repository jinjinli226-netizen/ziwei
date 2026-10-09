#!/usr/bin/env node
/** Isolated browser acceptance; serves only built static assets and intercepts every API request. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const dist = resolve(option('--dist', join(root, 'frontend/dist')));
const output = resolve(option('--output', join(root, '.local/phone-skill-ui')));
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'C:/Users/25941/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) { try { playwright = require(candidate); break; } catch {} }
if (!playwright) throw new Error('Preinstalled Playwright unavailable.');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://fixture.test').pathname);
    let file = resolve(dist, `.${pathname}`);
    if (file !== dist && !file.startsWith(`${dist}${sep}`)) return response.writeHead(403).end();
    if (pathname.startsWith('/api/') || pathname.startsWith('/a2a/')) return response.writeHead(500).end('API escaped fixture');
    if (!extname(file)) file = join(dist, 'index.html');
    const content=await readFile(file);
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true });
const evidence = { mode: 'isolated-headless-api-fixtures', observedAt: new Date().toISOString(), businessBackendStarted: false, realDeviceActions: 0, tests: [], pageErrors: [], consoleErrors: [], failedRequests: [], expectedHttpErrors: [], screenshots: [] };
const ws = { id: 'workspace-fixture', slug: 'phone_ai', name: 'MCP 隔离测试工作区', kind: 'team', timezone: 'Asia/Shanghai', preferences: {} };
const prefix = '/api/workspaces/phone_ai';
const ready = { authentication: 'configured', provider: 'configured', ready: true };
function fixture() {
  const state = {
    statusFailure: false, createFailure: false, posts: [], calls: [],
    receipt: { status: 'injected', injected: true, loaded: false, action_id: 'action-ui-injected', tool_calls: [] },
    employees: [{ id: 'builder-fixture', name: 'QA 员工搭建师', runtime: 'Codex', runtime_profile: 'qa-codex', instructions: '构建员工并验证交付', persona: '清楚准确', skills: [], status: 'active', target_device_id: 'pc-ready', management_mcp_enabled: true }],
    devices: [{ id: 'pc-ready', name: 'QA 在线电脑', status: 'online', healthy: true, bridge_name: 'ziwei_user', last_seen: new Date().toISOString(), management_mcp: { configured: true, workspace: ws.slug, supportedRuntimes: ['Codex', 'Hermes'] }, runtimes: [{ name: 'Codex', cli_status: 'available', version: 'fixture-codex', available: true, readiness: ready, profiles: [{ name: 'default', readiness: ready }, { name: 'qa-codex', readiness: ready }] }, { name: 'Hermes', cli_status: 'available', version: 'fixture-hermes', available: true, readiness: ready, profiles: [{ name: 'qa-independent', provider_configured: true, authentication_configured: true, readiness: ready }] }] }, { id: 'pc-offline', name: 'QA 离线电脑', status: 'offline', management_mcp: { configured: false }, runtimes: [{ name: 'Codex', cli_status: 'offline', available: false, readiness: { ready: false, reason: '电脑离线，等待原 ziwei_user 心跳' } }] }]
  };
  const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  async function handle(request) {
    const path = new URL(request.url()).pathname; const method = request.method(); const body = request.postDataJSON?.() || {};
    state.calls.push({ path, method });
    if (path === '/api/auth/status' || path === '/api/auth/me') return json({ authenticated: true, configured: true, user: { id: 'qa-owner', name: '隔离 QA', email: 'qa@example.test' }, role: 'owner', memberships: [{ ...ws, role: 'owner' }] });
    if (path === `${prefix}/summary`) return json({ workspace: ws, counts: {}, taskStates: {}, device: { status: 'online', name: 'fixture' } });
    if (path === `${prefix}/settings`) return json({ workspace: ws });
    if (path === `${prefix}/devices`) return json({ devices: state.devices });
    if (path === `${prefix}/runtimes`) return json({ runtimes: state.devices[0].runtimes.map(runtime => ({ ...runtime, id: runtime.name })) });
    if (path === `${prefix}/employees`) {
      if (method === 'POST') {
        state.posts.push(body);
        if (state.createFailure) return json({ error: '隔离 QA：暂时不可用，请重试' }, 503);
        let employee = state.employees.find(row => row.idempotencyKey === body.idempotencyKey);
        if (!employee) { employee = { ...body, id: `employee-ui-${state.employees.length}`, target_device_id: body.targetDeviceId, runtime_profile: body.runtimeProfile }; state.employees.push(employee); }
        return json(employee, 201);
      }
      return json({ employees: state.employees });
    }
    if (path === `${prefix}/employees/builder-fixture` && method === 'PATCH') { state.posts.push(body); Object.assign(state.employees[0], body, { runtime_profile: body.runtimeProfile, target_device_id: body.targetDeviceId }); return json(state.employees[0]); }
    if (path === `${prefix}/mcp/status`) return state.statusFailure ? json({ error: '隔离 QA：管理状态暂时不可达' }, 503) : json({ workspace: ws.slug, workspaces: [ws.slug], health: 'healthy', transport: 'stdio', api_endpoint: `https://qzelynth.top/mcp/v1/workspaces/${ws.slug}`, credential: { configured: true, scope_allowed: true, masked: '••••••••' }, tools: [{ name: 'ziwei_discover_environment', description: '来自心跳的目标电脑、CLI 和 profile 发现', inputSchema: { type: 'object', properties: {} } }, { name: 'ziwei_create_employee', description: '按明确 runtime 和电脑创建员工', inputSchema: { type: 'object', required: ['name', 'runtime', 'targetDeviceId'] } }], config_template: { mcpServers: { 'ziwei-management': { command: 'node', args: ['C:/Ziwei/scripts/ziwei-mcp.mjs'], env: { ZIWEI_MCP_TOKEN: 'must-never-render-fixture-secret' } } } } });
    if (path === `${prefix}/mcp/discovery`) return json({ workspace: ws.slug, source: 'device_heartbeat', devices: state.devices });
    if (/\/employees\/[^/]+\/mcp\/status$/.test(path)) return json({ employee_id: 'builder-fixture', enabled: true, target_device_id: 'pc-ready', runtime: 'Codex', receipt: state.receipt });
    if (path.endsWith('/environment')) return json({ variables: [], local_source: { source: 'ziwei_user', variables: [] } });
    if (path.endsWith('/custom-params')) return json({ values: {} });
    if (path === `${prefix}/hermes/profiles`) return json({ profiles: state.devices[0].runtimes[1].profiles });
    if (path === `${prefix}/hermes/profiles/requests` && method === 'POST') { state.posts.push(body); state.devices[0].runtimes[1].profiles.push({ name: body.profile, provider_configured: true, authentication_configured: true, readiness: ready }); return json({ action: { id: 'profile-action-ui', status: 'succeeded', result: { profile: body.profile } } }); }
    if (path === '/a2a/v1/agents') return json({ agents: [] });
    return json({ tasks: [], models: [], skills: [], documents: [], automations: [], members: [], calendars: [], notifications: [], stats: {}, conversations: [], keys: [] });
  }
  return { state, handle };
}
async function open(path, state, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__qaCopied = text; } } }); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if(url.pathname === '/downloads/android/index.json') return route.fulfill({status:200,contentType:'application/json',body:'{"releases":[]}'});
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/a2a/')) return route.fulfill(await state.handle(route.request()));
    if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
    await route.continue();
  });
  await context.routeWebSocket('**/*', socket => { socket.send(JSON.stringify({ type: 'ready' })); socket.onMessage(() => {}); });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => evidence.pageErrors.push(error.stack));
  page.on('console', message => { if (message.type() === 'error') { const entry={text:message.text()};if(state.state.expected503 && /503/.test(message.text()))evidence.expectedHttpErrors.push(entry);else evidence.consoleErrors.push(entry); } });
  page.on('requestfailed', request => evidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  return { page, context };
}
async function run(name, action) { try { await action(); evidence.tests.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); } catch (error) { evidence.tests.push({ name, passed: false, error: error.stack }); process.stderr.write(`FAIL ${name}: ${error.message}\n`); } }
async function screenshot(page, name) { const file = join(output, name); await page.screenshot({ path: file, fullPage: true,mask:[page.locator('.sidebar-account')] }); evidence.screenshots.push(file); }
async function chooseDevice(page, label) { await page.getByRole('combobox', { name: '目标电脑', exact: true }).click(); await page.getByRole('option', { name: label, exact: true }).click(); }
function phoneFixture() {
 const f=fixture(); const previous=f.handle;
 const skill={id:'phone-skill',catalog_id:'ziwei-phone-control',name:'手机 MCP 控制',description:'为精确绑定的手机提供受控 MCP 工具与实机验收。',scope:'platform',category:'automation',version:'1.0.0',installed:false,integration:{kind:'phone_mcp'},tags:['手机','MCP']};
 const phone={id:'phone-exact',terminalId:'terminal-exact',alias:'隔离验收手机',online:true,status:'online',nodes:[{role:'agent',status:'online',lastSeenAt:new Date().toISOString(),health:{accessibility:true}}],control:{role:'agent',epoch:1},commands:[],updates:[],snapshot:null};
 Object.assign(f.state,{skill,phones:[phone],phonePosts:[],grants:[],sourceReads:[],polls:0,apiStatus:{status:'healthy'},phoneStatus:{configuration:{saved:false,enabled:false},api:{status:'healthy'},receipt:{status:'never_run',loaded:false,injected:false,tool_calls:[]},verification:{status:'never_run'}}});
 f.state.devices=[{...f.state.devices[0],terminal_mcp:{configured:true,workspace:ws.slug,transport:'stdio',serverName:'ziwei-terminal',supportedRuntimes:['Codex','Hermes']}}]; f.state.employees[0].skills=[];
 f.handle=async request=>{
  const p=new URL(request.url()).pathname,m=request.method(),body=request.postDataJSON?.()||{};
  if(p.startsWith(prefix+'/phone-mcp')||p.includes('/phone-mcp')||p.includes('device-workspace-grants')||p.startsWith('/api/skills/phone-skill'))f.state.phonePosts.push({path:p,method:m,body});
  const json=(data,status=200)=>({status,contentType:'application/json',body:JSON.stringify(data)});
  if(p==='/api/auth/status'||p==='/api/auth/me')return json({authenticated:true,configured:true,user:{id:'qa-owner',name:'隔离 QA'},role:'owner',memberships:[{...ws,role:f.state.role||'owner'},{id:'source-ws',slug:'test_222',name:'已有电脑工作区',role:'owner'},{slug:'not-owner',name:'非Owner工作区',role:'member'}]});
  if(p===prefix+'/skills')return json({skills:[skill]});
  if(p===prefix+'/runtimes')return json({runtimes:(f.state.devices[0]?.runtimes||[]).map(runtime=>({...runtime,id:runtime.name}))});
  if(p==='/api/skills/phone-skill/versions')return json({versions:[{id:'phone-version',version:'1.0.0',created_at:'2026-10-09T00:00:00Z'}]});
  if(p==='/api/skills/phone-skill/uninstall'&&m==='POST'){skill.installed=false;f.state.employees[0].skills=f.state.employees[0].skills.filter(id=>id!==skill.id);f.state.phoneStatus.configuration.enabled=false;return json({uninstalled:true});}
  if(p==='/api/skills/phone-skill'&&m==='PATCH'){skill.installed=body.installed;return json(skill);}
  if(p===prefix+'/phone-mcp/setup')return json({workspace:ws.slug,skill,computers:f.state.devices,phones:f.state.phones,employees:f.state.employees,api:f.state.apiStatus});
  if(p===prefix+'/employees/builder-fixture/phone-mcp'&&m==='PUT'){
   assert.equal(skill.installed,true,'must install catalog skill before mounting');if(f.state.saveDelay)await new Promise(resolve=>setTimeout(resolve,f.state.saveDelay));
   f.state.phoneStatus={configuration:{saved:true,enabled:body.enabled,revision:'revision-1',skill_id:skill.id,skill_version:skill.version,target_device_id:body.targetDeviceId,runtime:body.runtime,runtime_profile:body.runtimeProfile,phone_device_id:body.phoneDeviceId,binding:{id:'binding-exact',deviceId:body.phoneDeviceId,employeeId:'builder-fixture',accountId:body.accountId||null,accountLabel:body.accountLabel||null},credential:{configured:body.enabled,managed:true,mode:'execution_capability',token:'must-never-render-fixture-secret'}},api:f.state.apiStatus,receipt:{status:'never_run',loaded:false,injected:false,tool_calls:[]},verification:{status:'never_run'}};return json({configuration:f.state.phoneStatus.configuration});
  }
  if(p===prefix+'/employees/builder-fixture/phone-mcp/status')return json(f.state.phoneStatus);
  if(p.startsWith(prefix+'/employees/')&&p.endsWith('/phone-mcp/status'))return json({configuration:{saved:false,enabled:false},api:{status:'healthy'},receipt:{status:'never_run'},verification:{status:'never_run'}});
  if(p===prefix+'/employees/builder-fixture/phone-mcp/check'&&m==='POST'){f.state.polls=0;f.state.actionType='check';f.state.phoneStatus.receipt={status:'pending',loaded:false,injected:false,action_id:'phone-check',tool_calls:[]};return json({action:{id:'phone-check',status:'pending'}},202);}
  if(p===prefix+'/employees/builder-fixture/phone-mcp/trial'&&m==='POST'){assert.equal(body.action,'health');assert.ok(body.idempotencyKey);if(f.state.trialKey!==body.idempotencyKey){f.state.trialKey=body.idempotencyKey;f.state.trialExecutions=(f.state.trialExecutions||0)+1;f.state.polls=0;f.state.actionType='trial';f.state.phoneStatus.verification={status:'pending',device_id:'phone-exact',configuration_revision:'revision-1'};}if(f.state.trialResponseFailures){f.state.trialResponseFailures--;return json({error:'隔离验收：提交响应暂时不可用'},503);}return json({action:{id:'phone-trial',status:'pending'}},202);}
  if(p.startsWith(prefix+'/phone-mcp/actions/')){
   f.state.polls++;if(f.state.polls===1)return json({action:{id:p.split('/').at(-1),status:'pending'}});
   f.state.phoneStatus.receipt={status:'loaded',injected:true,loaded:true,action_id:p.split('/').at(-1),tool_calls:f.state.actionType==='trial'?[{toolName:'ziwei_terminal_health',ok:true,deviceId:'phone-exact',commandId:'command-exact',status:'succeeded'}]:[]};
   if(f.state.actionType==='trial')f.state.phoneStatus.verification={status:'succeeded',command_id:'command-exact',device_id:'phone-exact',configuration_revision:'revision-1',result:{status:'succeeded'}};
   return json({action:{id:p.split('/').at(-1),status:'succeeded',result:{terminalMcp:{loaded:true}}}});
  }
  if(p==='/api/workspaces/test_222/mcp/discovery'){f.state.sourceReads.push('test_222');return json({workspace:'test_222',devices:[{...f.state.sourceDevice||fixture().state.devices[0],id:'source-pc',name:'已连接的原电脑'}]});}
  if(p===prefix+'/device-workspace-grants'&&m==='POST'){f.state.grants=[{id:'grant-exact',status:'connected',target_device_id:'pc-ready',source_workspace:body.sourceWorkspace,source_device_id:body.sourceDeviceId,action:{id:'grant-action',status:'pending'}}];return json({grant:f.state.grants[0],action:f.state.grants[0].action},202);}
  if(p===prefix+'/device-workspace-grants')return json({grants:f.state.grants});
  if(p===prefix+'/ziwei-connect/status')return json({devices:f.state.phones,bindings:[],diagnostics:[]});
  if(p===prefix+'/ziwei-connect/terminal/android-devices')return json({devices:f.state.phones});
  if(p.startsWith(prefix+'/ziwei-connect/terminal/android-devices/'))return json(p.endsWith('/enrollment-requests')?{requests:[]}:{device:phone});
  return previous(request);
 };
 return f;
}
async function select(page,name,optionName){await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:optionName,exact:true}).click();}
async function wizardFromCatalog(page){const card=page.getByTestId('phone-platform-skill');await card.getByRole('button',{name:/安装并配置|配置手机技能/}).click();await page.getByTestId('phone-skill-setup').waitFor();}
async function chooseEmployee(page){await select(page,'数字员工','QA 员工搭建师');}
async function saveSetup(page){await chooseEmployee(page);await select(page,'绑定手机','隔离验收手机 · 在线');await page.getByRole('button',{name:'保存安全配置',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('已保存，待检测',{exact:true}).waitFor();}
try {
 await run('phone platform skill opens secure configuration and shows actual version',async()=>{
  const f=phoneFixture();const{page,context}=await open('/phone_ai/skills',f);try{
   const card=page.getByTestId('phone-platform-skill');await card.getByText('1.0.0',{exact:false}).waitFor();await wizardFromCatalog(page);
   assert.match(await page.getByTestId('phone-setup-stage').innerText(),/未配置/);assert(await page.getByRole('button',{name:'检测 MCP 加载',exact:true}).isDisabled());
   await saveSetup(page);const saved=f.state.phonePosts.find(row=>row.method==='PUT');assert.equal(saved.body.targetDeviceId,'pc-ready');assert.equal(saved.body.runtime,'Codex');assert.equal(saved.body.runtimeProfile,'qa-codex');assert.equal(saved.body.phoneDeviceId,'phone-exact');
   assert.doesNotMatch(JSON.stringify(saved.body),/token|secret|password|TOML/);await page.getByTestId('phone-credential-evidence').getByText(/已配置执行时短期凭据.*平台托管/).waitFor();assert.doesNotMatch(await page.getByTestId('phone-setup-stage').innerText(),/实机通过/);assert.doesNotMatch(await page.getByTestId('phone-skill-setup').innerText(),/must-never-render-fixture-secret/);
   await screenshot(page,'phone-saved-1440.png');
  }finally{await context.close();}
 });
 await run('check waits for actual MCP receipt and trial waits for exact phone command receipt',async()=>{
  const f=phoneFixture();const{page,context}=await open('/phone_ai/skills',f);try{
   await wizardFromCatalog(page);await saveSetup(page);await page.getByRole('button',{name:'检测 MCP 加载',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('等待加载回执',{exact:true}).waitFor();assert.doesNotMatch(await page.getByTestId('phone-setup-stage').innerText(),/实机通过/);
   await page.getByTestId('phone-setup-stage').getByText('MCP 已加载',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'只读试运行',exact:true}).isDisabled());
   await page.getByLabel('允许在所选手机执行只读健康检查',{exact:true}).check();await page.getByRole('button',{name:'只读试运行',exact:true}).click();assert.doesNotMatch(await page.getByTestId('phone-setup-stage').innerText(),/实机通过/);
   await page.getByTestId('phone-setup-stage').getByText('实机通过',{exact:true}).waitFor();assert.match(await page.getByTestId('phone-verification-evidence').innerText(),/command-exact/);assert.match(await page.getByTestId('phone-verification-evidence').innerText(),/phone-exact/);await page.getByTestId('phone-verification-evidence').scrollIntoViewIfNeeded();await screenshot(page,'phone-verified-1440.png');
  }finally{await context.close();}
 });
 await run('offline and authentication stages are truthful and old success cannot validate changed selection',async()=>{
  const f=phoneFixture();const{page,context}=await open('/phone_ai/skills',f,390);try{
   await wizardFromCatalog(page);await saveSetup(page);f.state.devices[0].status='offline';await page.getByRole('button',{name:'刷新配置状态',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('等待电脑',{exact:true}).waitFor();
   f.state.devices[0].status='online';f.state.phones[0].online=false;f.state.phones[0].status='offline';f.state.phones[0].nodes[0].status='offline';await page.getByRole('button',{name:'刷新配置状态',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('等待手机',{exact:true}).waitFor();
   f.state.phones[0].online=true;f.state.phones[0].status='online';f.state.phones[0].nodes[0].status='online';f.state.phoneStatus.receipt={status:'failed',error:{code:'authentication_failed',message:'手机 MCP 认证失败'},loaded:false,tool_calls:[]};await page.getByRole('button',{name:'刷新配置状态',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('认证失败',{exact:true}).waitFor();
   f.state.phoneStatus.receipt={status:'loaded',loaded:true,tool_calls:[]};f.state.phoneStatus.verification={status:'succeeded',device_id:'wrong-phone',command_id:'old-command',configuration_revision:'old-revision'};await page.getByRole('button',{name:'刷新配置状态',exact:true}).click();assert.doesNotMatch(await page.getByTestId('phone-setup-stage').innerText(),/实机通过/);
   await select(page,'运行时','Hermes');assert.match(await page.getByTestId('phone-setup-stage').innerText(),/待保存/);assert(await page.getByRole('button',{name:'检测 MCP 加载',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'只读试运行',exact:true}).isDisabled());
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await screenshot(page,'phone-stages-390.png');
  }finally{await context.close();}
 });
 await run('Owner explicitly authorizes existing source computer and waits for real target heartbeat',async()=>{
  const f=phoneFixture();f.state.devices=[];const{page,context}=await open('/phone_ai/skills',f);try{
   await wizardFromCatalog(page);await select(page,'来源工作区','已有电脑工作区 · test_222');await select(page,'来源电脑','已连接的原电脑 · 在线');await page.getByRole('button',{name:'授权此电脑连接当前工作区',exact:true}).click();
   await page.getByTestId('phone-computer-grant').getByText(/等待电脑真正连接/).waitFor();assert.doesNotMatch(await page.getByRole('combobox',{name:'目标电脑',exact:true}).innerText(),/已连接的原电脑/);const grant=f.state.phonePosts.find(row=>row.method==='POST'&&row.path.endsWith('/device-workspace-grants'));assert.deepEqual(grant.body,{sourceWorkspace:'test_222',sourceDeviceId:'source-pc'});assert.deepEqual(f.state.sourceReads,['test_222']);assert.ok(!f.state.phonePosts.some(row=>row.path.includes('not-owner')));
   f.state.devices=phoneFixture().state.devices.slice(0,1);await page.getByRole('button',{name:'刷新配置状态',exact:true}).click();await page.getByRole('combobox',{name:'目标电脑',exact:true}).click();await page.getByRole('option',{name:'QA 在线电脑 · 在线',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByTestId('phone-computer-grant').getByText(/当前工作区已收到此电脑真实心跳/).waitFor();await screenshot(page,'phone-grant-1440.png');
  }finally{await context.close();}
 });
 await run('Hermes requires explicit independent profile and preserves exact selection after reload',async()=>{
  const f=phoneFixture();f.state.devices[0].runtimes[1].readiness={ready:false,authentication:'missing',provider:'missing',reason:'主配置未配置'};const{page,context}=await open('/phone_ai/skills',f,390);try{
   await wizardFromCatalog(page);await chooseEmployee(page);await select(page,'绑定手机','隔离验收手机 · 在线');await select(page,'运行时','Hermes');assert(await page.getByRole('button',{name:'保存安全配置',exact:true}).isDisabled());
   await page.getByRole('combobox',{name:'运行配置 Profile',exact:true}).click();assert.equal(await page.getByRole('option',{name:'默认 CLI 配置',exact:true}).count(),0);await page.getByRole('option',{name:'qa-independent',exact:true}).click();await page.getByRole('button',{name:'保存安全配置',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('已保存，待检测',{exact:true}).waitFor();
   const save=f.state.phonePosts.filter(row=>row.method==='PUT').at(-1);assert.equal(save.body.runtime,'Hermes');assert.equal(save.body.runtimeProfile,'qa-independent');await page.getByRole('button',{name:'刷新配置状态',exact:true}).click();assert.match(await page.getByRole('combobox',{name:'运行配置 Profile',exact:true}).innerText(),/qa-independent/);
   await select(page,'运行时','Codex');assert(await page.getByRole('button',{name:'保存安全配置',exact:true}).isDisabled());await select(page,'运行配置 Profile','qa-codex');assert(await page.getByRole('button',{name:'保存安全配置',exact:true}).isEnabled());await screenshot(page,'phone-profile-390.png');
  }finally{await context.close();}
 });
 await run('API and adapter failures block detection and a pending save locks the exact target',async()=>{
  const f=phoneFixture();const{page,context}=await open('/phone_ai/skills',f);try{
   await wizardFromCatalog(page);await chooseEmployee(page);await select(page,'绑定手机','隔离验收手机 · 在线');f.state.saveDelay=600;await page.getByRole('button',{name:'保存安全配置',exact:true}).click();for(const name of ['工作区','数字员工','目标电脑','运行时','运行配置 Profile','绑定手机'])assert(await page.getByRole('combobox',{name,exact:true}).isDisabled(),`${name} must stay fixed during save`);await page.getByTestId('phone-setup-stage').getByText('已保存，待检测',{exact:true}).waitFor();
   f.state.phoneStatus.api={status:'unavailable',error:'隔离手机API暂时不可达'};await page.getByRole('button',{name:'刷新配置状态',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('API 不可用',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'检测 MCP 加载',exact:true}).isDisabled());
   f.state.phoneStatus.api={status:'healthy'};f.state.devices[0].terminal_mcp={configured:false,workspace:ws.slug,reason:'当前电脑客户端尚未支持手机 MCP'};await page.getByRole('button',{name:'刷新配置状态',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('等待电脑配置',{exact:true}).waitFor();assert.match(await page.getByTestId('phone-setup-stage').innerText(),/尚未支持手机 MCP/);assert(await page.getByRole('button',{name:'检测 MCP 加载',exact:true}).isDisabled());await screenshot(page,'phone-adapter-1440.png');
  }finally{await context.close();}
 });
 await run('interconnect binding uses the selected exact phone without submitting any action',async()=>{
  const f=phoneFixture();const{page,context}=await open('/phone_ai/ziwei-connect',f);try{
   const binding=page.getByTestId('terminal-employee-binding');await binding.waitFor();await binding.getByRole('button',{name:'配置手机技能',exact:true}).click();const wizard=page.getByTestId('phone-skill-setup');await wizard.waitFor();await wizard.getByRole('combobox',{name:'数字员工',exact:true}).getByText('QA 员工搭建师',{exact:true}).waitFor();assert.match(await wizard.getByRole('combobox',{name:'绑定手机',exact:true}).innerText(),/隔离验收手机/);assert.equal(f.state.phonePosts.filter(row=>row.method!=='GET').length,0);await screenshot(page,'phone-interconnect-1440.png');
  }finally{await context.close();}
 });
 await run('lost trial response retries with one stable idempotency key and one phone execution',async()=>{
  const f=phoneFixture();f.state.expected503=true;const{page,context}=await open('/phone_ai/skills',f);try{
   await wizardFromCatalog(page);await saveSetup(page);await page.getByRole('button',{name:'检测 MCP 加载',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('MCP 已加载',{exact:true}).waitFor();await page.getByLabel('允许在所选手机执行只读健康检查',{exact:true}).check();f.state.trialResponseFailures=1;await page.getByRole('button',{name:'只读试运行',exact:true}).click();await page.getByRole('alert').filter({hasText:'同一幂等键'}).waitFor();assert.doesNotMatch(await page.getByTestId('phone-setup-stage').innerText(),/实机通过/);await page.getByRole('button',{name:'只读试运行',exact:true}).click();await page.getByTestId('phone-setup-stage').getByText('实机通过',{exact:true}).waitFor();const posts=f.state.phonePosts.filter(row=>row.method==='POST'&&row.path.endsWith('/trial'));assert.equal(posts.length,2);assert.equal(posts[0].body.idempotencyKey,posts[1].body.idempotencyKey);assert.equal(f.state.trialExecutions,1);assert.equal(evidence.expectedHttpErrors.length,1);
  }finally{await context.close();}
 });
 await run('read-only member can inspect setup without installing, granting or dispatching',async()=>{
  const f=phoneFixture();f.state.role='member';const{page,context}=await open('/phone_ai/skills',f,390);try{
   await wizardFromCatalog(page);await chooseEmployee(page);await page.getByText('当前为只读访问，配置需由工作区管理员保存。',{exact:true}).waitFor();for(const name of ['保存安全配置','检测 MCP 加载','只读试运行'])assert(await page.getByRole('button',{name,exact:true}).isDisabled());assert.equal(await page.getByTestId('phone-computer-grant').count(),0);assert.equal(f.state.phonePosts.filter(row=>row.method!=='GET').length,0);await screenshot(page,'phone-readonly-390.png');
  }finally{await context.close();}
 });
 await run('platform versions and uninstall refresh configuration without changing employee role or runtime',async()=>{
  const f=phoneFixture();const{page,context}=await open('/phone_ai/skills',f);try{
   const original={instructions:f.state.employees[0].instructions,runtime:f.state.employees[0].runtime};await page.getByTestId('phone-platform-skill').getByRole('button',{name:'版本',exact:true}).click();await page.getByRole('heading',{name:'技能版本',exact:true}).waitFor();await page.getByText('2026-10-09T00:00:00Z',{exact:true}).waitFor();await page.keyboard.press('Escape');await wizardFromCatalog(page);await saveSetup(page);await page.getByRole('button',{name:'关闭配置向导',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByTestId('phone-platform-skill').getByRole('button',{name:'卸载',exact:true}).click();await page.getByTestId('phone-platform-skill').getByRole('button',{name:'安装并配置',exact:true}).waitFor();await wizardFromCatalog(page);await chooseEmployee(page);await page.getByTestId('phone-setup-stage').getByText('未配置',{exact:true}).waitFor();assert.equal(f.state.employees[0].instructions,original.instructions);assert.equal(f.state.employees[0].runtime,original.runtime);assert.equal(f.state.phoneStatus.configuration.binding.deviceId,'phone-exact');assert(await page.getByRole('button',{name:'检测 MCP 加载',exact:true}).isDisabled());
  }finally{await context.close();}
 });
 await run('empty workspace opens existing employee form and continues setup for the newly created employee',async()=>{
  const f=phoneFixture();f.state.employees=[];const{page,context}=await open('/phone_ai/skills',f);try{
   await wizardFromCatalog(page);await page.getByRole('button',{name:'创建新员工',exact:true}).click();const modal=page.locator('.employee-create-modal');await modal.waitFor();assert(await page.getByLabel('保存后配置手机技能',{exact:true}).isChecked());await page.getByLabel('名称',{exact:true}).fill('新的手机员工');await page.getByRole('combobox',{name:'目标电脑',exact:true}).click();await page.getByRole('option',{name:'QA 在线电脑 · 在线',exact:true}).click();await page.getByTestId('employee-ready').waitFor();await modal.getByRole('button',{name:'创建',exact:true}).click();const wizard=page.getByTestId('phone-skill-setup');await wizard.waitFor();await wizard.getByRole('combobox',{name:'数字员工',exact:true}).getByText('新的手机员工',{exact:true}).waitFor();assert.equal(f.state.employees.length,1);assert.ok(f.state.phonePosts.some(row=>row.path.includes(`/employees/${f.state.employees[0].id}/phone-mcp/status`)));assert.equal(f.state.phonePosts.filter(row=>row.method==='POST').length,0);await screenshot(page,'phone-new-employee-1440.png');
  }finally{await context.close();}
 });
 await run('employee skill and MCP tabs reuse exact employee setup entry',async()=>{
  const f=phoneFixture();const{page,context}=await open('/phone_ai/employee/builder-fixture',f);try{
   for(const tab of ['▥ 技能','♧ MCP']){await page.getByRole('tab',{name:tab,exact:true}).click();await page.getByRole('button',{name:'配置手机技能',exact:true}).click();const wizard=page.getByTestId('phone-skill-setup');await wizard.waitFor();await wizard.getByRole('combobox',{name:'数字员工',exact:true}).getByText('QA 员工搭建师',{exact:true}).waitFor();await wizard.getByRole('button',{name:'关闭配置向导',exact:true}).click();}
  }finally{await context.close();}
 });
} finally {
 await browser.close();await new Promise(resolve=>server.close(resolve));evidence.passed=evidence.tests.every(test=>test.passed)&&!evidence.pageErrors.length&&!evidence.consoleErrors.length&&!evidence.failedRequests.length;await writeFile(join(output,'results.json'),`${JSON.stringify(evidence,null,2)}\n`);process.stdout.write(`${JSON.stringify({passed:evidence.passed,tests:evidence.tests.length,pageErrors:evidence.pageErrors.length,consoleErrors:evidence.consoleErrors.length,failedRequests:evidence.failedRequests.length,output})}\n`);if(!evidence.passed)process.exitCode=1;
}
