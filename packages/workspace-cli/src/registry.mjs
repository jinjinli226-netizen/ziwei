import {toolDefinitions} from '../vendor/native-schemas.mjs';
import {NATIVE_OPERATIONS} from '../vendor/hermes-native-contract.mjs';
import {fail} from './errors.mjs';
export const CLI_VERSION='2.0.0';
export const STANDARD_VERSION='1.3.0';
export const DOCS_URL='https://ziwei.qzelynth.top/docs';
export const DEFAULT_API='https://ziwei.qzelynth.top';
const tools=new Map(toolDefinitions.map(t=>[t.name,t]));
const enc=v=>encodeURIComponent(v);
const actionQuery={command:'ziwei-workspace actions get --id <actionId>',idField:'action.id or id',note:'Use only the original server action ID; a CLI requestId is not a receipt'};
const entries=[
  ['workdirs.inspect','ziwei_inspect_workdir','POST','/devices/{deviceId}/workdir/inspect','/devices/{deviceId}/workdir/inspect',['Inspect remote filesystem; create only when createIfMissing:true'],true,actionQuery],
  ['conversations.create','ziwei_create_conversation','POST','/conversations','/conversations',['Create persistent employee conversation; no message or execution'],true,null],
  ['management.health','ziwei_mcp_health','GET','/health',null,[],false,null],
  ['environment.discover','ziwei_discover_environment','GET','/discovery','/mcp/discovery',[],false,null],
  ['employees.get','ziwei_get_employee','GET','/employees/{id}',null,[],false,null],
  ['employees.mcp-status','ziwei_get_employee_mcp_status','GET','/employees/{id}/mcp/status','/employees/{id}/mcp/status',[],false,null],
  ['employees.capabilities.get','ziwei_get_employee_capabilities','GET','/employees/{id}/capability-inventory','/employees/{id}/capability-inventory',[],false,null],
  ['employees.plugins.get','ziwei_get_employee_plugins','GET','/employees/{id}/plugins','/employees/{id}/plugins',[],false,null],
  ['employees.plugins.refresh','ziwei_refresh_employee_plugins','POST','/employees/{id}/plugins/refresh','/employees/{id}/plugins/refresh',['Queue readonly native plugin discovery on the employee-bound computer; no runtime startup or business execution'],true,actionQuery],
  ['employees.plugins.apply','ziwei_apply_employee_plugins','PUT','/employees/{id}/plugins','/employees/{id}/plugins',['Queue saving the same native Bot bundle selection; next-start effects and actual loading require separate native evidence; no Bot restart'],true,actionQuery],
  ['employees.capabilities.report','ziwei_report_employee_capabilities','POST','/employees/{id}/capability-inventory/reports','/employees/{id}/capability-inventory/reports',['Persist agent_reported entries only; no installation, authorization, runtime verification or business execution'],true,{command:'ziwei-workspace employees capabilities get --id <employeeId>',idField:'id'}],
  ['profiles.create','ziwei_create_hermes_profile','POST','/hermes/profiles/requests','/hermes/profiles/requests',['Create isolated Hermes Profile on the selected computer'],true,actionQuery],
  ['actions.get','ziwei_get_action','GET','/actions/{id}','/actions/{id}',[],false,actionQuery],
  ['tasks.get','ziwei_get_task','GET','/tasks/{id}','@/api/tasks/{id}',[],false,null],
  ['employees.list','ziwei_list_employees','GET','/employees','/employees',[],false,null],
  ['employees.create','ziwei_create_employee','POST','/employees','/employees',['Create employee; may create required management configuration'],true,{command:'ziwei-workspace employees list',idField:'id'}],
  ['employees.update','ziwei_update_employee','PATCH','/employees/{id}','/employees/{id}',['Change employee configuration for future execution'],false,{command:'ziwei-workspace employees list',idField:'id'}],
  ['tasks.list','ziwei_list_tasks','GET','/tasks','/tasks',[],false,null],
  ['tasks.create','ziwei_create_task','POST','/tasks','/tasks',['Create task; execute:true dispatches real employee work and may use paid models'],true,{command:'ziwei-workspace tasks get --id <taskId>',idField:'id'}],
  ['documents.list','ziwei_list_documents','GET','/documents','/documents',[],false,null],
  ['documents.get','ziwei_read_document','GET','/documents/{id}','@/api/documents/{id}',[],false,null],
  ['documents.write','ziwei_write_document','POST','/documents','/documents',['Create or update workspace document'],false,{command:'ziwei-workspace documents get --id <documentId>',idField:'id'}],
  ['phone-mcp.setup','ziwei_phone_mcp_setup','GET','/phone-mcp/setup','/phone-mcp/setup',[],false,null],
  ['skills.install','ziwei_install_skill','POST','/skills/{id}/install','@/api/skills/{id}',['Install/uninstall an existing platform skill, preserving history'],false,null],
  ['phone-mcp.configure','ziwei_configure_phone_mcp','PUT','/employees/{id}/phone-mcp','/employees/{id}/phone-mcp',['Persist exact employee/phone/runtime binding; no device command'],false,{command:'ziwei-workspace phone-mcp status --id <employeeId>',idField:'id'}],
  ['phone-mcp.status','ziwei_get_phone_mcp_status','GET','/employees/{id}/phone-mcp/status','/employees/{id}/phone-mcp/status',[],false,null],
  ['phone-mcp.check','ziwei_check_phone_mcp','POST','/employees/{id}/phone-mcp/check','/employees/{id}/phone-mcp/check',['Create real employee conversation/action and load phone MCP for list/status; may use paid model'],true,actionQuery],
  ['phone-mcp.trial','ziwei_trial_phone_mcp','POST','/employees/{id}/phone-mcp/trial','/employees/{id}/phone-mcp/trial',['Create real employee execution and issue phone health or screenshot; may use paid model and physical device'],true,actionQuery]
];
const botPaths={capabilities:['GET','/bots/capabilities'],list:['GET','/bots'],create:['POST','/bots'],initialize:['POST','/employees/{id}/bot'],get:['GET','/bots/{id}'],update:['PATCH','/bots/{id}'],provision:['POST','/bots/{id}/provision'],validate:['POST','/bots/{id}/validate'],control:['POST','/bots/{id}/control'],runs:['GET','/bots/{id}/runs'],routines:['GET','/bots/{id}/routines'],createRoutine:['POST','/bots/{id}/routines'],updateRoutine:['PATCH','/bots/{id}/routines/{routineId}'],deleteRoutine:['DELETE','/bots/{id}/routines/{routineId}'],runRoutine:['POST','/bots/{id}/routines/{routineId}/run'],native:['POST','/bots/{id}/native/actions'],collaboration:['POST','/bots/{id}/collaboration'],mcpConnections:['GET','/bots/{id}/mcp/connections'],connectMcp:['POST','/bots/{id}/mcp/connections'],cancelMcpConnection:['DELETE','/bots/{id}/mcp/connections/{connectionId}']};
const botEffects={
  capabilities:[],list:[],get:[],runs:[],routines:[],
  create:['Create employee, isolated Profile provisioning action and main conversation'],initialize:['Initialize Bot on the same employee and create main conversation if absent'],update:['Update versioned configuration; deferred update can later validate, reconnect MCP and restore original authorization'],provision:['Queue original employee Profile provisioning/recovery'],validate:['Queue native configuration validation; no model generation'],control:['Activate/resume enables scheduling; pause cancels pending work; stop may request running work and descendant termination; requires revision and control epoch'],createRoutine:['Persist schedule; active schedule can dispatch future paid work'],updateRoutine:['Change schedule and future execution'],deleteRoutine:['Delete original Routine schedule'],runRoutine:['Dispatch real Routine work; may use paid models or configured native driver'],native:['Queue original native operation; effects depend on resource/operation including memory writes, skill install, MCP external calls, goal/heartbeat/group steps, kanban dispatch, gateway messages and voice provider calls'],collaboration:['Dispatch explicitly authorized messages/delegation/group work to employees; may use paid models'],mcpConnections:['May prune expired OAuth relay entries in server process memory; no device action or persisted business write'],connectMcp:['Queue native inspect/authorize on target employee Profile; opens OAuth authorization workflow when required'],cancelMcpConnection:['Cancel the original OAuth connection action; does not promise cancellation of unrelated work']
};
const botIdempotent=new Set(['create','initialize','provision','validate','createRoutine','runRoutine','native','collaboration','connectMcp']);
const string={type:'string'},integer={type:'integer',minimum:0},object={type:'object'},strings={type:'array',items:{type:'string'}};
const botDataProperties={expectedRevision:integer,expectedControlEpoch:integer,idempotencyKey:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,160}$'},name:string,targetDeviceId:string,sourceProfile:string,runtimeProfile:string,runtime:{type:'string',enum:['Hermes']},model:string,persona:string,description:string,instructions:string,visibility:{type:'string',enum:['workspace','personal']},skills:strings,avatar:string,config:object,employee:object,deferUntilIdle:{type:'boolean'},connectMcpServers:strings,operation:string,resource:{type:'string',enum:Object.keys(NATIVE_OPERATIONS)},input:object,server:string,mode:{type:'string',enum:['message','delegate','group']},targetEmployeeIds:strings,content:string,groupId:string,prompt:string,nativeDriver:object,schedule:string,timezone:string,status:string};
const botDataRequirements={create:['name','targetDeviceId','idempotencyKey'],initialize:['idempotencyKey'],update:['expectedRevision'],provision:['expectedRevision','idempotencyKey'],validate:['expectedRevision','idempotencyKey'],control:['expectedRevision','expectedControlEpoch','operation'],createRoutine:['idempotencyKey'],updateRoutine:[],runRoutine:['idempotencyKey'],native:['expectedRevision','expectedControlEpoch','idempotencyKey','resource','operation'],collaboration:['expectedRevision','expectedControlEpoch','idempotencyKey','targetEmployeeIds','content'],connectMcp:['expectedRevision','expectedControlEpoch','idempotencyKey','server']};
function botDataSchema(nativeOperation){
  const data={type:'object',properties:structuredClone(botDataProperties),required:botDataRequirements[nativeOperation]||[]};
  if(nativeOperation==='control')data.properties.operation={type:'string',enum:['activate','pause','resume','stop']};
  if(nativeOperation==='native')data['x-nativeOperations']=structuredClone(NATIVE_OPERATIONS);
  if(nativeOperation==='update')data.description='deferUntilIdle:true additionally requires expectedControlEpoch and idempotencyKey. connectMcpServers is allowed only with deferUntilIdle:true.';
  return data;
}
function nativeSchema(tool){const s=structuredClone(tool.inputSchema);s.additionalProperties=false;return s;}
function unifiedAuthorization(name,method){const requiredRole=name==='phone-mcp.configure'?'admin':method==='GET'?'read':'write';return{requiresAccess:true,requiredRole,requiredScope:requiredRole==='read'?'workspace:read':'workspace:write',nativeOwnerAdmin:requiredRole==='admin',verification:'server every request; issued/current roles and scopes intersect native policy'};}
function permissionDescription(name,authorization){return [`Unified site roles: access AND ${authorization.requiredRole}; issued/current intersection`,`Unified scope: ${authorization.requiredScope}; issued/current intersection`,'Original server workspace membership and role policy',...(authorization.nativeOwnerAdmin?['Original native workspace owner/admin required']:[]),...(name.startsWith('documents.')?['Original document ownership/workspace guard']:[]),...(name.startsWith('bots.')||name.startsWith('employees.')||name.startsWith('phone-mcp.')?['Original employee visibility and device scope checks']:[])];}
function operation({name,tool,method,mcp,human,effects,idempotent,query,nativeOperation,inputSchema}){
  const authorization=unifiedAuthorization(name,method);
  return {name,description:tool.description,nativeTool:tool.name,...(nativeOperation?{nativeOperation}:{}),inputSchema:inputSchema||nativeSchema(tool),readOnly:method==='GET'&&effects.length===0,sideEffects:effects,requiredPermissions:permissionDescription(name,authorization),unifiedAuthorization:authorization,supportsDryRun:false,idempotency:idempotent?'supported':'unsupported',idempotencyScope:idempotent?'Only original endpoint semantics; stable key, same authorized actor/workspace and original resource. Never an automatic retry guarantee.':null,resultQuery:query,transports:{managed:mcp?'supported':'unsupported',native:human?'supported':'unsupported'},routes:{managed:mcp?{method,path:`/mcp/v1/workspaces/{workspace}${mcp}`}:null,native:human?{method,path:human.startsWith('@')?human.slice(1):`/api/workspaces/{workspace}${human}`} :null}};
}
export const operations=entries.map(([name,toolName,method,mcp,human,effects,idempotent,query])=>operation({name,tool:tools.get(toolName),method,mcp,human,effects,idempotent,query}));
for(const entry of operations){
  entry.idempotencyByTransport={managed:entry.idempotency,native:['tasks.create','conversations.create'].includes(entry.name)?'unsupported':entry.idempotency};
  if(['tasks.create','conversations.create'].includes(entry.name)){entry.idempotency='unsupported';entry.idempotencyScope='No transport-independent guarantee: only the managed endpoint supports original persisted keys; native endpoint is unsupported. See idempotencyByTransport.';}
  if(entry.name==='skills.install')entry.routes.native.method='PATCH';
  if(entry.name==='profiles.create')entry.inputNotes='Business profile must come from JSON input. The public --profile flag only selects the credential slot and never supplies this native field.';
}
for(const nativeOperation of tools.get('ziwei_bot').inputSchema.properties.operation.enum){
  const [method,route]=botPaths[nativeOperation],inputSchema=nativeSchema(tools.get('ziwei_bot'));
  delete inputSchema.properties.operation;inputSchema.required=[];
  if(!['capabilities','list','create'].includes(nativeOperation))inputSchema.required.push('id');
  if(['updateRoutine','deleteRoutine','runRoutine'].includes(nativeOperation))inputSchema.required.push('routineId');
  if(nativeOperation==='cancelMcpConnection')inputSchema.required.push('connectionId');
  if(method!=='GET'&&nativeOperation!=='deleteRoutine'&&nativeOperation!=='cancelMcpConnection')inputSchema.required.push('data');
  inputSchema.properties.data=botDataSchema(nativeOperation);
  operations.push(operation({name:`bots.${nativeOperation}`,tool:tools.get('ziwei_bot'),nativeOperation,method,mcp:route,human:route,effects:botEffects[nativeOperation],idempotent:botIdempotent.has(nativeOperation),query:method==='GET'?null:(['createRoutine','updateRoutine','deleteRoutine','runRoutine'].includes(nativeOperation)?{command:'ziwei-workspace bots routines --id <employeeId>',idField:'id',note:'Routine run result appears in original Routine.last_result; do not treat automation run ID as an action ID'}:nativeOperation==='control'?{command:'ziwei-workspace bots get --id <employeeId>',idField:'id'}:actionQuery),inputSchema}));
  const entry=operations.at(-1);entry.idempotencyByTransport={managed:entry.idempotency,native:entry.idempotency};
  if(nativeOperation==='update'){entry.conditionalIdempotency='Only data.deferUntilIdle:true has original persisted idempotency; normal immediate update is unsupported';entry.resultQuery={command:'ziwei-workspace bots get --id <employeeId>',idField:'deferredConfig.id',note:'Deferred configuration ID is not an action ID; read deferredConfig and its original action IDs'};}
}
const waitOperation=structuredClone(operations.find(o=>o.name==='actions.get'));
waitOperation.name='actions.wait';waitOperation.description='Bounded readonly polling of the original actions.get endpoint until a terminal state or the overall --timeout. No action is created and no server wait/cancel endpoint is invented.';
waitOperation.cliImplementation='poll actions.get with one shared deadline; no mutation retry';
operations.push(waitOperation);
// Named unsupported commands are deliberate boundaries; no fabricated cancel API or issuer.
export const unsupportedOperations=Object.freeze({
  'actions.cancel':'The workspace backend has no generic action cancel endpoint. Bot control stop and cancelMcpConnection have their documented, narrower boundaries.',
  'bots.force-abandon':'Privileged failure recovery is not exposed by this CLI version.',
  'bots.failure-finalization':'Privileged failure recovery is not exposed by this CLI version.'
});
export const getOperation=name=>operations.find(o=>o.name===name);
export function getCapabilities(){return{cliVersion:CLI_VERSION,standardVersion:STANDARD_VERSION,contract:'v1',operations:structuredClone(operations),unsupportedOperations:{...unsupportedOperations},authorization:{verification:'offline',grantsVerified:false,note:'Catalog describes implemented endpoints. Installation and local credential presence grant no permission; the backend checks every request.'},identity:{native:'explicit legacy compatibility requires server declaration',managed:'explicit legacy compatibility requires server declaration',unified:'implemented; requires configured ready server and trusted identity provider; production deployment pending',clientId:'ziwei-workspace-cli',audience:'ziwei-workspace-api',requestedScopes:['openid','workspace:read','workspace:write'],flow:'device_authorization',transport:'Public server cliTransports must explicitly allow native or mcp. Prefer the mapped native route; otherwise use the mapped mcp route. Both carry the same current-site access token, never a legacy managed token. Original per-route idempotency applies.',machine:'not_supported; never substitutes shared administrator credentials'}};}
export function createOperationRequest(op,input,{mode,workspace}){
  const route=op.routes[mode];if(!route)fail('NOT_SUPPORTED',`${op.name} has no corresponding ${mode} endpoint in this backend version`,{operation:op.name});
  const values={...input,workspace};
  let method=route.method,requestPath=route.path.replace(/\{(\w+)\}/g,(_,key)=>{if(!values[key])fail('USAGE',`${key} is required`);return enc(values[key]);});
  const body={...input};delete body.workspace;
  for(const match of route.path.matchAll(/\{(\w+)\}/g))delete body[match[1]];
  if(op.nativeOperation){
    if(method==='GET')return{method,path:requestPath,query:input.deviceId?{deviceId:input.deviceId}:{}};
    return{method,path:requestPath,body:input.data||{}};
  }
  if(op.name==='documents.write'&&input.id){method='PATCH';requestPath=mode==='managed'?`/mcp/v1/workspaces/${enc(workspace)}/documents/${enc(input.id)}`:`/api/documents/${enc(input.id)}`;delete body.id;}
  if(op.name==='phone-mcp.setup')delete body.view;
  if(op.name==='skills.install')body.installed=input.installed??true;
  // Human task creation has no native idempotency support, unlike management.createTask.
  return method==='GET'?{method,path:requestPath,query:body}:{method,path:requestPath,body};
}
