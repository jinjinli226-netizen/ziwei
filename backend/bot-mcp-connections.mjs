import crypto from 'node:crypto';
import {botFailure} from '../src/hermes-bot-config.mjs';

export const MCP_OAUTH_RELAY_FEATURE = 'bot_mcp_oauth_relay_v1';
const TTL = 10 * 60_000;
const parse = value => {try {return JSON.parse(value);} catch {return null;}};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code, message, status=409) => {throw botFailure(code,message,status);};
const field = (value, max=8192) => typeof value==='string' && value.length>0 && value.length<=max && !/[\0\r\n]/.test(value);
const errors = {
  MCP_OAUTH_NATIVE_UNAVAILABLE:'目标电脑的 Hermes 尚不支持远程网页授权，需要更新 Hermes。',
  MCP_OAUTH_RELAY_UNAVAILABLE:'员工暂时无法连接授权服务，请检查电脑在线状态后重试。',
  MCP_OAUTH_RELAY_REJECTED:'本次授权已失效、取消或员工配置已变化，请重新连接。',
  MCP_OAUTH_TIMEOUT:'等待授权超时，请重新连接。',
  MCP_OAUTH_CANCELLED:'本次授权已取消。',
  MCP_OAUTH_CALLBACK_UNSUPPORTED:'此服务的客户端只登记了本机回调，尚不能远程授权。',
  MCP_OAUTH_CALLBACK_MISMATCH:'此服务登记的授权回调与紫薇不一致。',
  MCP_OAUTH_TOKEN_NOT_CONFIRMED:'服务连接后仍未确认授权凭据，请检查服务端授权配置。',
  MCP_OAUTH_CONNECTION_FAILED:'员工连接 MCP 失败，请检查服务地址、授权和电脑网络。',
  MCP_OAUTH_REQUIRES_DEPENDENCY:'目标电脑的 Hermes 尚不支持此远程授权方式，需要更新或修复原生依赖。',
  MCP_OAUTH_INVALID_CONFIGURATION:'MCP 授权配置不兼容，请核对服务地址、公开客户端信息及远程回调。',
  MCP_OAUTH_RELAY_FAILED:'员工暂时无法连接授权服务，请检查电脑网络后重试。',
  MCP_OAUTH_RELAY_INVALID_RESPONSE:'授权服务返回的信息与当前员工不匹配，请重新连接。',
  MCP_OAUTH_EXPIRED:'等待授权已到期，请重新连接。',
  MCP_OAUTH_STATE_MISMATCH:'授权回调与本次连接不一致，请重新连接。',
  MCP_OAUTH_DENIED:'授权未获批准，请重新连接并确认服务权限。',
  MCP_OAUTH_NO_TOOLS:'授权后没有发现可用工具，请检查服务权限和工具筛选。',
  MCP_OAUTH_FAILED:'员工未能完成 MCP 授权，请查看本次运行记录。',
  MCP_OAUTH_NAME_CONFLICT:'MCP 名称与 Hermes 内建工具集重名，请换一个连接名称后保存。',
  MCP_OAUTH_REQUIRED:'请先为该连接选择 OAuth 认证并保存。',
  MCP_SERVER_NOT_CONFIGURED:'该员工尚未配置或启用此 MCP。',
  MCP_CONNECTION_NOT_CONFIRMED:'员工未能确认 MCP 连接，请检查地址、认证和电脑网络。',
};

// Tokens and PKCE verifiers stay in the target Hermes profile. This bounded,
// process-local relay holds only the browser handoff. A server restart expires
// unfinished handoffs; it never clears or migrates the employee's OAuth store.
export function createBotMcpConnections(repo,bots,{apiBase,now=Date.now,maxFlows=500}={}) {
  const origin=new URL(apiBase);
  if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))throw new Error('MCP OAuth requires a trusted public API origin');
  const redirectUri=origin.origin+'/api/mcp-oauth/callback',flows=new Map(),states=new Map();
  function retire(flow,status) {
    if(flow.stateHash)states.delete(flow.stateHash);
    Object.assign(flow,{status,authorizationUrl:null,callback:null,stateHash:null});
  }
  function prune() {
    for(const [id,flow] of flows) {
      if(now()>=flow.expiresAt && !['cancelled','expired'].includes(flow.status))retire(flow,'expired');
      if(now()>=flow.expiresAt+TTL){retire(flow,'expired');flows.delete(id);}
    }
  }
  function flowFor(action,{create=false}={}) {
    prune();let flow=flows.get(action.id);
    if(!flow&&create) {
      if(flows.size>=maxFlows)fail('MCP_OAUTH_RELAY_BUSY','授权服务正在处理较多连接，请稍后重试。',503);
      flow={id:action.id,status:'connecting',expiresAt:now()+TTL,authorizationUrl:null,stateHash:null,callback:null};flows.set(action.id,flow);
    }
    return flow;
  }
  function actionFor(id) {return repo.getA2AAction(id,{eventView:'none'});}
  function isConnection(action) {const op=action?.payload?.nativeOperation;return action?.type==='hermes.bot.native'&&op?.resource==='mcp'&&['authorize','inspect'].includes(op.operation);}
  function browserAction(slug,id,actionId,context) {
    const bot=bots.get(slug,id,context,{view:'mobile'}),action=actionFor(actionId);
    if(!isConnection(action)||action.payload.hermesBot?.workspace!==slug||action.payload.hermesBot.employeeId!==id)fail('MCP_CONNECTION_NOT_FOUND','未找到此员工的连接。',404);
    return {bot,action};
  }
  function snapshot(action,bot) {
    const binding=action.payload.hermesBot,op=action.payload.nativeOperation,flow=flowFor(action),receipt=action.result?.nativeOperation;
    let status=action.status==='pending'?'queued':action.status==='acked'?'connecting':action.status==='expired'?'expired':'failed';
    let error=null,tools=[];
    if(binding.revision!==bot.revision||binding.controlEpoch!==bot.control_epoch) {status='failed';error='员工配置或控制状态已变化，请按当前配置重新连接。';}
    else if(action.status==='succeeded'&&receipt?.schemaVersion===2&&receipt.employeeId===bot.id&&receipt.revision===binding.revision&&receipt.resource==='mcp'&&receipt.operation===op.operation&&receipt.status==='succeeded'&&receipt.data?.connected===true) {
      status='connected';tools=(receipt.data.tools||[]).slice(0,200).map(tool=>({name:String(tool.name||'').slice(0,200),description:String(tool.description||tool.schema?.description||'').slice(0,500)}));
    } else if(['failed','succeeded'].includes(action.status)) {
      const code=receipt?.code||action.result?.code||action.error;
      error=errors[code]||'连接验证未通过，请查看本次运行记录。';
    } else if(flow&&['authorization_required','cancelled','expired'].includes(flow.status))status=flow.status;
    return {id:action.id,idempotencyKey:op.requestId,workspace:binding.workspace,employeeId:binding.employeeId,server:op.input.server,deviceId:binding.deviceId,profile:binding.instance?.profile||binding.sourceProfile,revision:binding.revision,controlEpoch:binding.controlEpoch,status,authorizationUrl:status==='authorization_required'?flow.authorizationUrl:null,toolsCount:tools.length,...(tools.length?{tools}:{}),error,expiresAt:flow?new Date(flow.expiresAt).toISOString():action.expires_at,loadedForNextRun:status==='connected'};
  }
  function start(slug,id,input={},context={}) {
    if(Object.keys(input).some(key=>!['server','expectedRevision','expectedControlEpoch','idempotencyKey','workspace'].includes(key)))fail('BOT_NATIVE_INPUT_INVALID','连接请求包含未知字段。',400);
    if(input.workspace!==undefined&&input.workspace!==slug)fail('BOT_WORKSPACE_CONFLICT','连接请求与当前工作区不一致。',403);
    const bot=bots.get(slug,id,context,{view:'mobile'});
    const server=typeof input.server==='string'&&Object.hasOwn(bot.config.mcpServers||{},input.server)?bot.config.mcpServers[input.server]:null;
    if(!server||server.enabled===false)fail('MCP_SERVER_NOT_CONFIGURED','请先保存并启用此员工的 MCP 配置。',400);
    const device=repo.listDevices(slug).find(item=>item.id===bot.employee.target_device_id);
    if(!device||device.status!=='online')fail('BOT_DEVICE_OFFLINE','目标员工电脑离线，请等电脑恢复在线后连接。');
    const oauth=server.auth==='oauth';
    const discovery=parse(device.runtime_discovery_json)||{};
    if(oauth&&!discovery.features?.includes(MCP_OAUTH_RELAY_FEATURE))fail('BOT_MCP_CLIENT_REQUIRED','目标电脑的紫薇客户端尚不支持远程 MCP 授权，需要先更新客户端。');
    const {action}=bots.native(slug,id,{expectedRevision:input.expectedRevision,expectedControlEpoch:input.expectedControlEpoch,idempotencyKey:input.idempotencyKey,resource:'mcp',operation:oauth?'authorize':'inspect',input:{server:input.server}},context);
    return {connection:snapshot(action,bot)};
  }
  function list(slug,id,context={}) {
    const bot=bots.get(slug,id,context,{view:'mobile'}),seen=new Set(),connections=[];
    const rows=repo.db.prepare("SELECT id FROM a2a_actions WHERE rowid IN (SELECT max(rowid) FROM a2a_actions WHERE workspace_id=(SELECT id FROM workspaces WHERE slug=?) AND type='hermes.bot.native' AND json_extract(payload_json,'$.employeeId')=? AND json_extract(payload_json,'$.nativeOperation.resource')='mcp' AND json_extract(payload_json,'$.nativeOperation.operation') IN ('inspect','authorize') GROUP BY json_extract(payload_json,'$.nativeOperation.input.server')) ORDER BY rowid DESC").all(slug,id);
    for(const row of rows) {const action=actionFor(row.id),name=action.payload.nativeOperation.input.server;if(seen.has(name)||!Object.hasOwn(bot.config.mcpServers,name))continue;seen.add(name);connections.push(snapshot(action,bot));}
    return {connections};
  }
  function read(slug,id,actionId,context={}) {
    const {bot,action}=browserAction(slug,id,actionId,context);
    return {connection:snapshot(action,bot)};
  }
  // The durable configuration runner owns when a connection may start. These
  // synchronous callbacks only reuse the normal scoped connection admission and
  // read its exact native action; they never wait inside the Bot's active slot.
  const deferredHandlers=Object.freeze({
    connectMcp({workspace,employeeId,server,idempotencyKey,context={}}) {
      if(typeof idempotencyKey!=='string'||!/^[A-Za-z0-9._:-]{1,160}$/.test(idempotencyKey))fail('IDEMPOTENCY_KEY_REQUIRED','必须提供稳定 idempotencyKey',400);
      const bot=bots.get(workspace,employeeId,context,{view:'mobile'});
      const owner=context.actorUserId||context.deviceCredentialDeviceId||'authorized-mcp';
      const saved=repo.db.prepare('SELECT resource_id FROM management_requests WHERE workspace_id=(SELECT id FROM workspaces WHERE slug=?) AND kind=? AND request_key=?')
        .get(workspace,`bot:native:${employeeId}:${owner}`,idempotencyKey);
      if(saved) {
        // A response can be lost between native admission and the runner's own
        // checkpoint. Recover before online checks or new revision defaults.
        const action=actionFor(saved.resource_id),operation=action?.payload?.nativeOperation;
        if(!isConnection(action)||action.payload.hermesBot?.workspace!==workspace||action.payload.hermesBot.employeeId!==employeeId||operation.requestId!==idempotencyKey||operation.input.server!==server)
          fail('IDEMPOTENCY_CONFLICT','原请求不是此员工和服务的 MCP 连接。');
        return snapshot(action,bot);
      }
      return start(workspace,employeeId,{server,idempotencyKey,expectedRevision:bot.revision,expectedControlEpoch:bot.control_epoch},context).connection;
    },
    readMcp({workspace,employeeId,actionId,server,context={}}) {
      const {connection}=read(workspace,employeeId,actionId,context);
      if(connection.server!==server)fail('MCP_CONNECTION_NOT_FOUND','原连接不属于指定 MCP 服务。',404);
      return connection;
    },
  });
  function cancel(slug,id,actionId,context={}) {
    const {action,bot}=browserAction(slug,id,actionId,context);
    if(action.payload.nativeOperation.operation!=='authorize'||!['pending','acked'].includes(action.status))return {connection:snapshot(action,bot)};
    retire(flowFor(action,{create:true}),'cancelled');return {connection:snapshot(action,bot)};
  }
  function deviceAction(actionId,credential) {
    const deviceId=credential?.deviceId;
    if(!deviceId)fail('MCP_OAUTH_DEVICE_REQUIRED','授权回调只接受已配对电脑。',401);
    const action=repo.deviceAction(actionId,{deviceId});
    if(action?.payload.hermesBot?.workspace!==credential.workspace)fail('MCP_OAUTH_DEVICE_SCOPE','授权不属于当前电脑连接的工作区。',403);
    if(!isConnection(action)||action.payload.nativeOperation.operation!=='authorize')fail('MCP_CONNECTION_NOT_FOUND','原动作不是 MCP 网页授权。',404);
    repo.authorizeBotStart(actionId,{deviceId});
    const server=action.payload.hermesBot.config.mcpServers?.[action.payload.nativeOperation.input.server];
    if(server?.auth!=='oauth'||server.enabled===false)fail('MCP_SERVER_NOT_CONFIGURED','原动作没有启用的 OAuth 连接。');
    return action;
  }
  function begin(actionId,credential) {
    const flow=flowFor(deviceAction(actionId,credential),{create:true});
    if(['expired','cancelled'].includes(flow.status))fail('MCP_OAUTH_RELAY_EXPIRED','本次授权已到期或取消。',410);
    flow.credentialId=credential.credentialId;
    return {redirectUri,expiresAt:new Date(flow.expiresAt).toISOString()};
  }
  function publish(actionId,credential,input={}) {
    const action=deviceAction(actionId,credential),flow=flowFor(action);
    if(!flow||flow.credentialId!==credential.credentialId)fail('MCP_OAUTH_RELAY_LOST','请由原授权连接重新开始。',410);
    if(!['connecting','authorization_required'].includes(flow.status))fail('MCP_OAUTH_RELAY_EXPIRED','本次授权不可再次发布。',410);
    if(Object.keys(input).some(key=>key!=='authorizationUrl')||!field(input.authorizationUrl,16384))fail('MCP_OAUTH_URL_INVALID','授权地址无效。',400);
    let url;try {url=new URL(input.authorizationUrl);}catch {fail('MCP_OAUTH_URL_INVALID','授权地址无效。',400);}
    const state=url.searchParams.get('state');
    if(url.protocol!=='https:'||url.username||url.password||url.hash||!field(state,1024)||url.searchParams.get('redirect_uri')!==redirectUri||[...url.searchParams.keys()].some(key=>/^(access_token|refresh_token|client_secret|code)$/i.test(key)))fail('MCP_OAUTH_URL_INVALID','授权地址或回调与当前连接不匹配。',400);
    const hash=sha(state),existing=states.get(hash);
    if(existing&&existing!==actionId)fail('MCP_OAUTH_STATE_CONFLICT','授权标识已被其他连接使用。');
    if(flow.stateHash&&flow.stateHash!==hash)fail('MCP_OAUTH_STATE_CONFLICT','当前连接已发布不同的授权标识。');
    states.set(hash,actionId);Object.assign(flow,{authorizationUrl:url.href,stateHash:hash,status:'authorization_required'});return {ok:true};
  }
  function deliver(query={}) {
    prune();const {state,code,error,iss}=query;
    if(!field(state,1024))fail('MCP_OAUTH_CALLBACK_INVALID','授权回调缺少有效标识。',400);
    const hash=sha(state),flow=flows.get(states.get(hash));
    if(!flow||flow.status!=='authorization_required'||flow.stateHash!==hash||now()>=flow.expiresAt)fail('MCP_OAUTH_CALLBACK_EXPIRED','此授权已失效、取消或已经处理，请返回员工页面。',410);
    // Recheck the exact employee/config/control/paired-device authority before
    // accepting a code; a removed employee cannot finish an outstanding flow.
    const action=actionFor(flow.id),binding=action?.payload.hermesBot;
    const credential=repo.db.prepare('SELECT c.id,c.revoked_at,d.status,w.slug,c.device_id FROM device_credentials c JOIN devices d ON d.id=c.device_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=?').get(flow.credentialId);
    if(!credential||credential.revoked_at||credential.status==='disabled'||credential.device_id!==binding?.deviceId||credential.slug!==binding?.workspace)fail('MCP_OAUTH_DEVICE_REVOKED','原电脑连接已失效，请返回员工页面。',403);
    deviceAction(flow.id,{deviceId:credential.device_id,workspace:credential.slug,credentialId:credential.id});
    if((code!==undefined)===(error!==undefined)||code!==undefined&&!field(code)||error!==undefined&&!field(error,100)||iss!==undefined&&!field(iss,2048))fail('MCP_OAUTH_CALLBACK_INVALID','授权回调参数不完整。',400);
    if(error!==undefined&&!/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(error))fail('MCP_OAUTH_CALLBACK_INVALID','授权回调错误类型无效。',400);
    flow.callback={code:code||null,state,error:error||null,iss:iss||null};flow.status='callback';flow.authorizationUrl=null;states.delete(hash);return {ok:true};
  }
  function callback(actionId,credential) {
    const flow=flowFor(deviceAction(actionId,credential));
    if(!flow)fail('MCP_OAUTH_RELAY_LOST','授权服务已重启或本次授权失效，请重新连接。',410);
    if(flow.credentialId!==credential.credentialId)fail('MCP_OAUTH_DEVICE_SCOPE','请使用原电脑授权连接。',403);
    return {status:flow.status==='callback'?'callback':['cancelled','expired'].includes(flow.status)?flow.status:'waiting',...(flow.status==='callback'?{callback:flow.callback}:{})};
  }
  return {start,list,read,deferredHandlers,cancel,begin,publish,deliver,callback};
}
