#!/usr/bin/env node
/** Isolated browser acceptance; serves only built static assets and intercepts every API request. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const dist = resolve(option('--dist', join(root, 'frontend/dist')));
const output = resolve(option('--output', join(root, '.local/employee-modal-ui')));
const mode=option('--mode','fixture');assert.ok(['fixture','live-readonly'].includes(mode));
const live=mode==='live-readonly',liveOrigin='https://qzelynth.top';
const session=live?JSON.parse(await readFile(resolve(option('--session-file','')),'utf8')):null;
const liveWorkspace=option('--workspace',session?.workspace || 'phone_ai');
const liveEmployeeId=option('--employee-id','employee_b723a169-826a-4a27-8cf5-2e50747432ab');
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
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true });
const evidence = { mode: 'isolated-headless-api-fixtures', observedAt: new Date().toISOString(), businessBackendStarted: false, realDeviceActions: 0, tests: [], pageErrors: [], consoleErrors: [], failedRequests: [], screenshots: [] };
evidence.mode=live?'real-https-readonly':'isolated-headless-api-fixtures';evidence.blockedWrites=[];evidence.apiResponses=[];
const ws = { id: 'workspace-fixture', slug: 'test_222', name: 'MCP 隔离测试工作区', kind: 'team', timezone: 'Asia/Shanghai', preferences: {} };
const prefix = '/api/workspaces/test_222';
const ready = { authentication: 'configured', provider: 'configured', ready: true };
function fixture() {
  const state = {
    statusFailure: false, createFailure: false, posts: [], calls: [],
    receipt: { status: 'injected', injected: true, loaded: false, action_id: 'action-ui-injected', tool_calls: [] },
    employees: [{ id: 'builder-fixture', name: 'QA 员工搭建师', runtime: 'Codex', runtime_profile: 'qa-codex', instructions: '构建员工并验证交付', persona: '清楚准确', skills: [], status: 'active', target_device_id: 'pc-ready', management_mcp_enabled: true }],
    devices: [{ id: 'pc-ready', name: 'QA 在线电脑', status: 'online', healthy: true, bridge_name: 'ziwei_user', last_seen: new Date().toISOString(), management_mcp: { managed: true, state: 'ready', configured: true, workspace: ws.slug, supportedRuntimes: ['Codex', 'Hermes'] }, runtimes: [{ name: 'Codex', cli_status: 'available', version: 'fixture-codex', available: true, readiness: ready, profiles: [{ name: 'default', readiness: ready }, { name: 'qa-codex', readiness: ready }] }, { name: 'Hermes', cli_status: 'available', version: 'fixture-hermes', available: true, readiness: ready, profiles: [{ name: 'qa-independent', provider_configured: true, authentication_configured: true, readiness: ready }] }] }, { id: 'pc-offline', name: 'QA 离线电脑', status: 'offline', management_mcp: { managed: true, state: 'pending', configured: false, workspace: ws.slug }, runtimes: [{ name: 'Codex', cli_status: 'offline', available: false, readiness: { ready: false, reason: '电脑离线，等待原 ziwei_user 心跳' } }] }]
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
    if (path === `${prefix}/mcp/status`) return state.statusFailure ? json({ error: '隔离 QA：管理状态暂时不可达' }, 503) : json({ workspace: ws.slug, workspaces: [ws.slug], health: 'healthy', transport: 'stdio', api_endpoint: `https://qzelynth.top/mcp/v1/workspaces/${ws.slug}`, managed: true, default_enabled: true, configured: true, scope_allowed: true, connections: state.devices.map(device => ({ device_id:device.id, name:device.name, status:device.status, ...device.management_mcp })), credential: { configured:true, managed:true, mode:'device-bootstrap', scope_allowed:true, masked:'' }, tools: [{ name: 'ziwei_discover_environment', description: '来自心跳的目标电脑、CLI 和 profile 发现', inputSchema: { type: 'object', properties: {} } }, { name: 'ziwei_create_employee', description: '按明确 runtime 和电脑创建员工', inputSchema: { type: 'object', required: ['name', 'runtime', 'targetDeviceId'] } }], config_template: { mcpServers: { 'ziwei-management': { command: 'node', args: ['C:/Ziwei/scripts/ziwei-mcp.mjs'], env: { ZIWEI_MCP_TOKEN: 'must-never-render-fixture-secret' } } } } });
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
async function open(path, state, width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  if(live){assert.ok(typeof session.token==='string'&&session.token.length>10);const cookie={name:'ziwei_session',value:session.token,url:liveOrigin,httpOnly:true,secure:true,sameSite:'Lax'};if(session.expiresAt)cookie.expires=Math.floor(Date.parse(session.expiresAt)/1000);await context.addCookies([cookie]);}
  await context.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__qaCopied = text; } } }); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if(live){if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){evidence.blockedWrites.push({method:route.request().method(),path:url.pathname});return route.abort();}if(url.origin!==liveOrigin&&!['data:','blob:'].includes(url.protocol))return route.abort();return route.continue();}
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/a2a/')) return route.fulfill(await state.handle(route.request()));
    if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) return route.abort();
    await route.continue();
  });
  if(!live) await context.routeWebSocket('**/*', socket => { socket.send(JSON.stringify({ type: 'ready' })); socket.onMessage(() => {}); });
  const page = await context.newPage(); page.setDefaultTimeout(live?30000:8000);
  page.on('pageerror', error => evidence.pageErrors.push(error.stack));
  page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push({ text: message.text(), expectedHttpFailure: /503/.test(message.text()) }); });
  page.on('requestfailed', request => evidence.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/'))evidence.apiResponses.push({method:response.request().method(),path:url.pathname,status:response.status()});});
  try{await page.goto(`${live?liveOrigin:base}${path}`, {waitUntil:live?'domcontentloaded':'networkidle',timeout:45000});}catch(error){await context.close();throw error;}
  return { page, context };
}
async function run(name, action) { try { await action(); evidence.tests.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); } catch (error) { evidence.tests.push({ name, passed: false, error: error.stack }); process.stderr.write(`FAIL ${name}: ${error.message}\n`); } }
async function screenshot(page, name) {
  const file = join(output, name);
  const privacyStyle = live ? await page.addStyleTag({ content: '.sidebar-account { visibility: hidden !important; }' }) : null;
  try {
    await page.screenshot({ path: file, fullPage: true });
    evidence.screenshots.push(file);
  } finally {
    if (privacyStyle) await privacyStyle.evaluate(node => node.remove());
  }
}
async function chooseDevice(page, label) { await page.getByRole('combobox', { name: '目标电脑', exact: true }).click(); await page.getByRole('option', { name: label, exact: true }).click(); }

function employeeFixture() {
  const f = fixture(); const original = f.handle;
  const skill = { id:'phone-modal-skill', catalog_id:'ziwei-phone-control', name:'手机 MCP 控制', version:'1.0.0', installed:true, scope:'platform', integration:{kind:'phone_mcp'} };
  const skills = [skill, {id:'long-modal-skill',name:'用于核对窄屏长标签换行与原生控件间距的工作区技能',version:'1.0.0',installed:true,scope:'team'}];
  f.state.devices[0].management_mcp = { managed:true,configured:false,state:'pending',workspace:ws.slug,reason:'等待电脑自动接入' };
  f.state.devices[0].terminal_mcp = { configured:true, workspace:ws.slug, supportedRuntimes:['Codex','Hermes'] };
  f.state.managementRetries = [];
  f.handle = async request => {
    const pathname = new URL(request.url()).pathname, method = request.method();
    const json = value => ({status:200,contentType:'application/json',body:JSON.stringify(value)});
    if(pathname === `${prefix}/mcp/retry` && method === 'POST') {const body=request.postDataJSON();assert.equal(body.deviceId,'pc-ready');f.state.managementRetries.push(body);f.state.devices[0].management_mcp={managed:true,configured:false,state:'pending',workspace:ws.slug};return json({accepted:true,deviceId:body.deviceId,state:'pending',retryRequestedAt:new Date().toISOString()});}
    if(pathname === `${prefix}/skills`) return json({skills});
    if(pathname === `${prefix}/phone-mcp/setup`) return json({workspace:ws.slug,skill,computers:f.state.devices,phones:[{id:'phone-modal-exact',alias:'隔离手机',status:'offline'}],employees:f.state.employees,api:{status:'healthy'}});
    if(/\/employees\/[^/]+\/phone-mcp\/status$/.test(pathname)) return json({configuration:{saved:false,enabled:false},api:{status:'healthy'},receipt:{status:'never_run'},verification:{status:'never_run'}});
    if(pathname === `${prefix}/employees/builder-fixture` && method === 'PATCH') {
      const body = request.postDataJSON();f.state.posts.push(body);Object.assign(f.state.employees[0],body,{runtime_profile:body.runtimeProfile,target_device_id:body.targetDeviceId,management_mcp_enabled:body.managementMcpEnabled});return json(f.state.employees[0]);
    }
    return original(request);
  };
  return f;
}
evidence.geometry = []; evidence.interactions = []; evidence.fixtureWrites = [];

async function geometry(page, selector, scene) {
  const metrics = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(), label = node.closest('label');
    const walker = document.createTreeWalker(label,NodeFilter.SHOW_TEXT);let text;
    while(walker.nextNode()) if(walker.currentNode.textContent.trim()) {text=walker.currentNode;break;}
    const range = document.createRange();if(text)range.selectNodeContents(text);const textRect=text?range.getClientRects()[0]:null;
    const style=getComputedStyle(node);return {label:label?.textContent.trim(),width:rect.width,height:rect.height,x:rect.x,y:rect.y,textLeft:textRect?.left,textTop:textRect?.top,textHeight:textRect?.height,gap:textRect?textRect.left-rect.right:null,padding:style.padding,flexShrink:style.flexShrink};
  }));
  evidence.geometry.push({scene,metrics});
  for(const box of metrics) {
    assert.ok(box.width>=16 && box.width<=22, `${scene}: ${box.label} checkbox width ${box.width}`);
    assert.ok(box.height>=16 && box.height<=22, `${scene}: ${box.label} checkbox height ${box.height}`);
    assert.ok(box.gap>=4 && box.gap<=16, `${scene}: ${box.label} label gap ${box.gap}`);
    assert.ok(box.y+box.height/2>=box.textTop-4 && box.y+box.height/2<=box.textTop+box.textHeight+4, `${scene}: ${box.label} vertically detached`);
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Document horizontal overflow');
  return metrics;
}

async function checkboxInteraction(page, checkbox, scene) {
  await checkbox.scrollIntoViewIfNeeded();const before=await checkbox.isChecked();const label=checkbox.locator('xpath=ancestor::label[1]');const bounds=await label.boundingBox();
  await label.click({position:{x:Math.max(1,bounds.width-4),y:bounds.height/2}});assert.equal(await checkbox.isChecked(),!before,'Whole label did not toggle checkbox');
  await checkbox.click();assert.equal(await checkbox.isChecked(),before,'Checkbox click did not toggle back');
  await page.getByLabel('名称',{exact:true}).focus();let reached=false;
  for(let count=0;count<50;count++) {await page.keyboard.press('Tab');if(await checkbox.evaluate(node=>node===document.activeElement)){reached=true;break;}}
  assert.ok(reached,'Checkbox unreachable by Tab');assert.ok(await checkbox.evaluate(node=>node.matches(':focus-visible')),'Keyboard focus not visible');
  assert.ok(await checkbox.evaluate(node=>{const style=getComputedStyle(node);return parseFloat(style.outlineWidth)>0 || style.boxShadow!=='none';}),'Checkbox has no visible keyboard focus indicator');
  await page.keyboard.press('Space');assert.equal(await checkbox.isChecked(),!before,'Space did not toggle checkbox');
  evidence.interactions.push({scene,label:await label.innerText(),wholeLabel:true,checkbox:true,tab:true,focusVisible:true,space:true});
  await checkbox.uncheck();
}

async function modalScene(width,height,editing) {
  const f=employeeFixture();const originalEmployee=JSON.stringify(f.state.employees[0]);const {page,context}=await open(editing?'/test_222/employee/builder-fixture':'/test_222/members',f,width,height);const scene=`${editing?'edit':'create'}-${width}x${height}`;
  try {
    await page.getByRole('button',{name:editing?'编辑伙伴':'添加数字员工',exact:true}).first().click();const modal=page.locator('.employee-create-modal');await modal.waitFor();
    assert.match(await modal.locator('.employee-create-modal__header').innerText(),editing?/编辑数字伙伴/:/创建数字伙伴/);
    const body=modal.locator('.employee-create-modal__body');await body.evaluate(node=>node.scrollTop=0);await screenshot(page,`${scene}-top.png`);
    if(!editing) {await page.getByLabel('名称',{exact:true}).fill(`QA 原生勾选 ${width}`);await chooseDevice(page,'QA 在线电脑 · 在线');}
    await modal.getByRole('button',{name:/从工作区添加 skill|已选择.*skill/}).click();await modal.locator('.employee-skills-list input[type=checkbox]').first().waitFor();
    assert.equal(await page.getByLabel('启用紫薇管理 MCP',{exact:true}).count(),0);
    const phone=page.getByLabel('保存后配置手机技能',{exact:true});
    if(editing) assert.equal(await phone.count(),0,'Editing must not show create-only phone continuation');
    else {assert.equal(await phone.count(),1);assert.ok(await phone.evaluate(node=>Boolean(node.closest('.employee-create-modal__body'))),'Phone continuation must be inside scrollable form body');await phone.check();}
    await body.evaluate(node=>node.scrollTop=node.scrollHeight);await screenshot(page,`${scene}-bottom-auto-pending.png`);
    await geometry(page,'.employee-create-modal input[type=checkbox]',scene);
    const submit=modal.getByRole('button',{name:editing?'保存':'创建',exact:true});await page.getByTestId('employee-ready').waitFor();assert.ok(await submit.isEnabled());assert.match(await modal.innerText(),/正在自动接入/);assert.equal(f.state.posts.length,0);
    for(const checkbox of await modal.locator('input[type=checkbox]').all()) await checkboxInteraction(page,checkbox,scene);
    await page.getByTestId('employee-ready').waitFor();assert.ok(await submit.isEnabled(),'Automatic management preparation must not block saving a valid employee');
    if(!editing){await phone.check();await modal.locator('.employee-skills-list input[type=checkbox]').first().check();}await body.evaluate(node=>node.scrollTop=node.scrollHeight);await screenshot(page,`${scene}-bottom-ready.png`);
    assert.ok(await modal.evaluate(node=>node.scrollWidth<=node.clientWidth),'Modal horizontal overflow');
    const hit=await submit.evaluate(node=>{const r=node.getBoundingClientRect();return {withinViewport:r.bottom<=innerHeight+1 && r.left>=0 && r.right<=innerWidth,clickable:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===node};});assert.ok(hit.withinViewport && hit.clickable,'Footer submit inaccessible');
    if(editing){await modal.getByRole('button',{name:'取消',exact:true}).click();await modal.waitFor({state:'hidden'});assert.equal(f.state.posts.length,0);assert.equal(JSON.stringify(f.state.employees[0]),originalEmployee,'Cancel must preserve original employee data');}
    else{await submit.click();await modal.waitFor({state:'hidden'});assert.equal(f.state.posts.length,1);assert.equal(f.state.posts[0].managementMcpEnabled,true);assert.equal(f.state.posts[0].runtime,'Codex');assert.equal(f.state.posts[0].targetDeviceId,'pc-ready');assert.ok(f.state.posts[0].skills.includes('phone-modal-skill'),'Checked skill must persist in fixture employee payload');}
    if(!editing) {const wizard=page.getByTestId('phone-skill-setup');await wizard.waitFor();await wizard.getByRole('combobox',{name:'数字员工',exact:true}).getByText(`QA 原生勾选 ${width}`,{exact:true}).waitFor();await screenshot(page,`${scene}-continued-phone-wizard.png`);}
    else assert.equal(await page.getByTestId('phone-skill-setup').count(),0);
    evidence.fixtureWrites.push({scene,count:f.state.posts.length,managementMcpEnabled:editing?f.state.employees[0].management_mcp_enabled:true,targetDeviceId:editing?f.state.employees[0].target_device_id:f.state.posts[0].targetDeviceId,runtime:editing?f.state.employees[0].runtime:f.state.posts[0].runtime,phoneWizard:!editing,originalDataPreserved:editing});
  } finally {await context.close();}
}

async function liveGet(context,pathname){const response=await context.request.get(liveOrigin+pathname);assert.equal(response.status(),200,`Read-only GET ${pathname} ${response.status()}`);return response.json();}
const employeeHash=employees=>createHash('sha256').update(JSON.stringify(employees.map(({id,name,runtime,runtime_profile,target_device_id,management_mcp_enabled,model_id,instructions,persona,skills})=>({id,name,runtime,runtime_profile,target_device_id,management_mcp_enabled,model_id,instructions,persona,skills})).sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
async function liveScene(width,height,editing){
  const scene=`live-${editing?'edit':'create'}-${width}x${height}`,pathname=editing?`/${liveWorkspace}/employee/${liveEmployeeId}`:`/${liveWorkspace}/members`;
  const {page,context}=await open(pathname,null,width,height);let before;
  try {
    const auth=await liveGet(context,'/api/auth/me');assert.ok(auth.memberships.some(item=>item.slug===liveWorkspace&&['owner','admin'].includes(item.role)),'Authorized workspace missing');before=(await liveGet(context,`/api/workspaces/${liveWorkspace}/employees`)).employees;assert.ok(before.some(item=>item.id===liveEmployeeId),'Exact existing employee missing');
    evidence.scriptHashes ??= await page.locator('script[src]').evaluateAll(nodes=>nodes.map(node=>new URL(node.src).pathname));
    await page.getByRole('button',{name:editing?'编辑伙伴':'添加数字员工',exact:true}).first().click();const modal=page.locator('.employee-create-modal');await modal.waitFor();await modal.getByRole('button',{name:'刷新电脑与 CLI',exact:true}).waitFor();const body=modal.locator('.employee-create-modal__body');await body.evaluate(node=>node.scrollTop=0);await screenshot(page,`${scene}-top.png`);
    if(!editing){await page.getByLabel('名称',{exact:true}).fill('只读布局核验（不保存）');await chooseDevice(page,'zheng · 在线');}
    assert.equal(await page.getByLabel('启用紫薇管理 MCP',{exact:true}).count(),0);const phone=page.getByLabel('保存后配置手机技能',{exact:true});if(!editing)await phone.check();else assert.equal(await phone.count(),0);
    await body.evaluate(node=>node.scrollTop=node.scrollHeight);await screenshot(page,`${scene}-bottom-auto-management.png`);
    await geometry(page,'.employee-create-modal input[type=checkbox]',scene);
    const submit=modal.getByRole('button',{name:editing?'保存':'创建',exact:true});await page.getByTestId('employee-ready').waitFor();assert.ok(await submit.isEnabled(),'Valid device and runtime may save while automatic management preparation is pending');assert.match(await modal.innerText(),/默认自动接入/);assert.match(await modal.locator('.employee-create-modal__header').innerText(),editing?/编辑数字伙伴/:/创建数字伙伴/);
    if(!editing)assert.ok(await phone.evaluate(node=>Boolean(node.closest('.employee-create-modal__body'))));
    for(const checkbox of await modal.locator('input[type=checkbox]').all())await checkboxInteraction(page,checkbox,scene);
    await page.getByTestId('employee-ready').waitFor();assert.ok(await submit.isEnabled());await body.evaluate(node=>node.scrollTop=node.scrollHeight);await screenshot(page,`${scene}-bottom-ready.png`);await modal.getByRole('button',{name:'取消',exact:true}).click();await modal.waitFor({state:'hidden'});
  } finally {
    if(before){const after=(await liveGet(context,`/api/workspaces/${liveWorkspace}/employees`)).employees;const beforeHash=employeeHash(before),afterHash=employeeHash(after);evidence.fixtureWrites.push({scene,beforeCount:before.length,afterCount:after.length,beforeHash,afterHash,unchanged:beforeHash===afterHash,writes:0});assert.equal(afterHash,beforeHash,'Read-only browser changed employee data');}
    await context.close();
  }
}

try {
  if(live){for(const [width,height]of[[1250,882],[1440,900],[1280,720],[720,450],[390,844]])for(const editing of[false,true])await run(`production readonly ${editing?'edit':'create'} ${width}x${height}`,()=>liveScene(width,height,editing));}
  else {
  for(const [width,height] of [[1250,882],[1440,900],[1280,720],[720,450],[390,844]]) for(const editing of [false,true]) await run(`${editing?'edit':'create'} ${width}x${height}: geometry, scrolling, label/click/keyboard and readiness`,()=>modalScene(width,height,editing));
  await run('phone continuation off creates normally; environment sensitivity checkbox retains native geometry',async()=>{
    const f=employeeFixture();const {page,context}=await open('/test_222/members',f,1440,900);try{
      await page.getByRole('button',{name:'添加数字员工',exact:true}).first().click();const modal=page.locator('.employee-create-modal');await page.getByLabel('名称',{exact:true}).fill('QA 无手机继续');await chooseDevice(page,'QA 在线电脑 · 在线');assert.equal(await page.getByLabel('启用紫薇管理 MCP',{exact:true}).count(),0);await page.getByLabel('保存后配置手机技能',{exact:true}).uncheck();await page.getByTestId('employee-ready').waitFor();await modal.getByRole('button',{name:'创建',exact:true}).click();await modal.waitFor({state:'hidden'});assert.equal(await page.getByTestId('phone-skill-setup').count(),0);assert.equal(f.state.posts.length,1);
      await page.goto(`${base}/test_222/employee/builder-fixture`,{waitUntil:'networkidle'});await page.getByRole('tab',{name:'⌘ 环境变量',exact:true}).click();const sensitive=page.getByLabel('敏感值（默认开启，仅显示掩码）',{exact:true});await sensitive.waitFor();await geometry(page,'.employee-config-editor input[type=checkbox]','environment-sensitive');const before=await sensitive.isChecked();await sensitive.locator('xpath=ancestor::label[1]').click();assert.equal(await sensitive.isChecked(),!before);await screenshot(page,'environment-sensitive-native.png');
    }finally{await context.close();}
  });
  await run('old disabled employee can save during automatic preparation, failure and client upgrade; retry only refreshes connection',async()=>{
    for(const state of ['pending','failed','client_required']) {
      const f=employeeFixture();f.state.employees[0].management_mcp_enabled=state==='pending'?null:false;f.state.devices[0].management_mcp={managed:true,configured:false,state,workspace:ws.slug,reason:state==='failed'?'隔离 QA：连接暂时不可达':state==='client_required'?'请更新原客户端':'等待自动接入'};const original=JSON.stringify(f.state.employees[0]);const {page,context}=await open('/test_222/employee/builder-fixture',f,720,450);
      try{await page.getByRole('button',{name:'编辑伙伴',exact:true}).click();const modal=page.locator('.employee-create-modal');await page.getByTestId('employee-ready').waitFor();assert.ok(await modal.getByRole('button',{name:'保存',exact:true}).isEnabled());assert.equal(await page.getByLabel('启用紫薇管理 MCP',{exact:true}).count(),0);assert.match(await modal.getByTestId('employee-management-default').innerText(),/默认自动接入/);if(state==='failed'){await modal.getByRole('button',{name:'重试自动接入',exact:true}).click();await modal.getByText('正在自动接入',{exact:true}).waitFor();assert.deepEqual(f.state.managementRetries,[{deviceId:'pc-ready'}]);f.state.devices[0].management_mcp={managed:true,configured:true,state:'ready',workspace:ws.slug};await modal.getByRole('button',{name:'刷新电脑与 CLI',exact:true}).click();await modal.getByText('自动接入已准备',{exact:true}).waitFor();}else if(state==='client_required'){await modal.locator('summary').filter({hasText:'更新 ziwei_user'}).click();assert.match(await modal.innerText(),/原安装方式/);}assert.equal(f.state.posts.length,0);await modal.locator('.employee-create-modal__body').evaluate(node=>node.scrollTop=node.scrollHeight);await screenshot(page,`legacy-modal-${state}-720x450.png`);await modal.getByRole('button',{name:'取消',exact:true}).click();assert.equal(JSON.stringify(f.state.employees[0]),original);assert.equal(f.state.posts.length,0);}finally{await context.close();}
    }
  });
  }
} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
  evidence.passed=evidence.tests.every(test=>test.passed)&&!evidence.pageErrors.length&&!evidence.consoleErrors.length&&!evidence.failedRequests.length&&!evidence.blockedWrites.length;
  await writeFile(join(output,'results.json'),`${JSON.stringify(evidence,null,2)}\n`);
  console.log(JSON.stringify({passed:evidence.passed,tests:evidence.tests.length,geometryScenes:evidence.geometry.length,interactionCheckboxes:evidence.interactions.length,pageErrors:evidence.pageErrors.length,consoleErrors:evidence.consoleErrors.length,failedRequests:evidence.failedRequests.length,output}));if(!evidence.passed)process.exitCode=1;
}
