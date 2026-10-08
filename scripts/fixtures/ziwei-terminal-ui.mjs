/** Isolated browser fixture. All identities, screenshots and receipts are synthetic. */
export const fixtureSession = 'terminal-ui-isolated-session';
export const workspace = { id: 'workspace-ui', slug: 'phone_ai', name: '手机工作区', kind: 'team', timezone: 'Asia/Shanghai', preferences: {} };
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF3sAAAAASUVORK5CYII=';
const timestamp = () => new Date().toISOString();
export function phone(id = 'phone-fixture-1', alias = '验收手机 01') {
  return {
    id, terminalId: `terminal-${id}`, alias,
    nodes: ['agent', 'updater'].map(role => ({ role, status: 'online', versionCode: 15, versionName: '0.4.4', lastSeen: timestamp(), health: { accessibility: true, screenOn: true, locked: false, peerBound: true, canInstall: true, installerPackage: `com.ziwei.device.${role}`, lastError: role === 'updater' ? '测试诊断：此前网络中断，已恢复' : null } })),
    control: { role: 'agent', epoch: 1, draining: false },
    commands: [], updates: [], snapshot: { data: pixel, mime: 'image/png', width: 1080, height: 1920, capturedAt: timestamp() },
  };
}
export function enrollment(id = 'request-agent', alias = '待审手机', role = 'agent', expired = false) {
  return { id, alias, role, status: expired ? 'expired' : 'pending', versionCode: 15, versionName: '0.4.4', createdAt: timestamp(), expiresAt: new Date(Date.now() + (expired ? -60000 : 600000)).toISOString() };
}
export function createFixture() {
  const state = {
    devices: [], requests: [], bindings: [], runs: [], calls: [], rejectedRequests: [],
    enrollmentFailure: false, holdEnrollment: false, releaseEnrollment: null,
    listFailure: false, nextUpdateStatus: 'planned', screenshotStatus: 'succeeded', sequence: 0,
  };
  const employee = { id: 'employee-fixture-1', name: '已有手机数字员工', runtime: 'codex', status: 'ready', description: '隔离验收员工' };
  const releases = { releases: [{ versionName: '0.4.5-fixture', versionCode: 16, buildType: 'fixture', packages: Object.fromEntries(['agent','updater'].map(role => [role, { packageName: `com.ziwei.device.${role}`, file: `${role}.apk`, path: `/downloads/android/fixture/${role}.apk`, sha256: 'a'.repeat(64), signerSha256: 'b'.repeat(64) }])) }] };
  function response(body, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }
  async function handle(request) {
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.() || {};
    const path = url.pathname;
    const hasSession = (request.headers().cookie || '').includes(`ziwei_session=${fixtureSession}`);
    state.calls.push({ path, method, body, hasSession, at: timestamp() });
    if (path === '/downloads/android/index.json') return response(releases);
    if (!hasSession) return response({ error: '隔离测试需要主站会话' }, 401);
    if (path === '/api/auth/status' || path === '/api/auth/me') return response({ authenticated: true, setup_required: false, user: { id: 'user-ui', name: '隔离验收管理员', email: 'ui@example.test' }, role: 'owner', memberships: [{ ...workspace, workspace_slug: workspace.slug, role: 'owner' }] });
    if (path === '/a2a/v1/agents') return response({ agents: [] });
    const prefix = '/api/workspaces/phone_ai';
    if (path === `${prefix}/summary`) return response({ workspace, counts: { tasks: 0, runtimes: 0, members: 1, documents: 0, automations: 0 }, taskStates: {}, device: { name: 'fixture', status: 'offline' } });
    if (path === `${prefix}/settings`) return response({ workspace });
    if (path === `${prefix}/employees`) return response({ employees: [employee] });
    if (path === `${prefix}/ziwei-connect/status`) return response({ source: { product: '紫薇·互联', provider: 'fixture', accessMode: 'proxy', apiBase: 'https://qzelynth.top/api' }, devices: state.devices, diagnostics: [{ id: 'fixture', name: '隔离验收控制 API', status: 'ok', message: '全部为模拟数据' }], bindings: state.bindings });
    if (path === `${prefix}/ziwei-connect/devices`) return response({ devices: state.devices });
    if (path === `${prefix}/ziwei-connect/bindings`) {
      if (method === 'POST') { const binding = { ...body, id: `binding-${++state.sequence}` }; state.bindings.push(binding); return response({ binding }); }
      return response({ bindings: state.bindings });
    }
    if (path.startsWith(`${prefix}/ziwei-connect/bindings/`) && method === 'DELETE') { state.bindings = state.bindings.filter(row => row.id !== path.split('/').at(-1)); return response({ deleted: true }); }
    if (path === `${prefix}/ziwei-connect/runs`) return response({ runs: state.runs });
    const terminal = `${prefix}/ziwei-connect/terminal/android-devices`;
    if (path === terminal && method === 'GET') {
      const devices = state.devices.map(device => {
        const { snapshot: _snapshot, ...summary } = device;
        return { ...summary, commands: device.commands.filter(command => ['queued', 'delivered', 'executing', 'uncertain'].includes(command.status)).map(({ result: _result, ...command }) => command), updates: device.updates.filter(update => !['committed', 'cancelled', 'superseded'].includes(update.status)) };
      });
      return state.listFailure ? response({ error: '隔离模拟：控制服务暂时不可达', message: '隔离模拟：控制服务暂时不可达' }, 503) : response({ devices });
    }
    if (path === terminal && method === 'POST') { const device = phone(`registered-${++state.sequence}`, body.alias); device.nodes.forEach(node => { node.status = 'offline'; }); state.devices.push(device); return response({ device, tokens: { agent: 'fixture-agent-token-only', updater: 'fixture-updater-token-only' } }); }
    if (path === `${terminal}/enrollment-requests`) return response({ requests: state.requests });
    const approval = path.match(new RegExp(`^${terminal}/enrollment-requests/([^/]+)/(approve|reject)$`));
    if (approval && method === 'POST') {
      if (state.holdEnrollment) await new Promise(resolve => { state.releaseEnrollment = resolve; });
      if (state.enrollmentFailure) return response({ error: '隔离模拟：审批服务暂时不可达，请重试', message: '隔离模拟：审批服务暂时不可达，请重试' }, 503);
      const entry = state.requests.find(row => row.id === approval[1]);
      if (!entry) return response({ error: '申请不存在', message: '申请不存在' }, 404);
      entry.status = approval[2] === 'approve' ? 'approved' : 'rejected';
      state.requests = state.requests.filter(row => row.id !== entry.id);
      if (approval[2] === 'reject') return response({ request: entry });
      const device = phone('enrolled-fixture', entry.alias); state.devices.push(device);
      return response({ request: { ...entry, deviceId: device.id }, device });
    }
    if (path.startsWith(`${terminal}/`)) {
      const parts = path.slice(terminal.length + 1).split('/');
      const device = state.devices.find(row => row.id === parts[0]);
      if (!device) return response({ error: '手机不存在', message: '手机不存在' }, 404);
      if (method === 'GET') return parts[1] === 'snapshot' ? response({ deviceId: device.id, snapshot: device.snapshot }) : response({ device });
      if (parts[1] === 'archive') { state.devices = state.devices.filter(row => row.id !== device.id); return response({ deviceId: device.id, terminalId: device.terminalId, archivedAt: timestamp() }); }
      if (parts[1] === 'control') { device.control = { role: body.role, epoch: device.control.epoch + 1, draining: false }; return response({ device }); }
      if (parts[1] === 'commands' && parts[3] === 'resolve') { const command = device.commands.find(row => row.id === parts[2]); Object.assign(command, { status: 'acknowledged', resolutionNote: body.note, resolvedAt: timestamp() }); return response({ command }); }
      if (parts[1] === 'commands') {
        const command = { id: `command-${++state.sequence}`, deviceId: device.id, role: device.control.role, action: body.action, args: body.args, epoch: device.control.epoch, status: body.action === 'screenshot' ? state.screenshotStatus : 'succeeded', createdAt: timestamp(), expiresAt: new Date(Date.now() + 30000).toISOString(), result: { fixture: true, accepted: true } };
        device.commands.unshift(command);
        if (body.action === 'screenshot') device.snapshot.capturedAt = timestamp();
        return response({ command });
      }
      if (parts[1] === 'updates' && parts[3] === 'resolve') { const update = device.updates.find(row => row.id === parts[2]); update.status = body.resolution === 'cancel' ? 'cancelled' : 'committed'; return response({ update }); }
      if (parts[1] === 'updates') { const update = { ...body, id: `update-${++state.sequence}`, deviceId: device.id, installerRole: body.targetRole === 'agent' ? 'updater' : 'agent', status: state.nextUpdateStatus, createdAt: timestamp() }; device.updates.unshift(update); return response({ update }); }
    }
    const defaults = { tasks: [], runtimes: [], models: [], skills: [], documents: [], automations: [], members: [], devices: [], calendars: [], notifications: [], stats: {}, conversations: [], permissions: { role: 'owner', capabilities: ['*'] } };
    if (path.startsWith(prefix) || path === '/api/workspaces') return response(defaults);
    state.rejectedRequests.push({ path, method });
    return response({ error: `未预期的接口：${method} ${path}` }, 404);
  }
  return { state, handle, employee };
}
