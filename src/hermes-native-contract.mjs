import {botFailure} from './hermes-bot-config.mjs';

export const NATIVE_OPERATIONS={
  memory:{read:['scope'],write:['scope','content','expectedHash']},
  sessions:{list:['limit'],search:['query','limit','roleFilter','after','before','sort'],read:['sessionId','aroundMessageId','window']},
  skills:{list:[],read:['name','filePath'],install:['name','content','files'],update:['name','content','files','expectedHash'],remove:['name','expectedHash'],enable:['name'],disable:['name'],hub_search:['query','source','limit'],hub_install:['identifier','name'],check_updates:['name']},
  mcp:{inspect:['server'],authorize:['server'],call:['server','tool','arguments']},
  goals:{status:[],start:['objective','maxTurns','contract'],pause:[],resume:[],stop:[],step:[]},
  heartbeat:{status:[],start:['prompt','intervalSeconds'],pause:[],resume:[],stop:[],step:[]},
  kanban:{list:['status','limit'],create:['title','body','priority','parents','triage','maxTurns'],show:['taskId'],edit:['taskId','result','summary','title','body'],claim:['taskId'],complete:['taskId','runId','result','summary'],block:['taskId','runId','reason'],unblock:['taskId'],dispatch:['taskId']},
  gateway:{status:[],configure:['config'],connect:['platform','durationSeconds'],disconnect:['platform'],inbound:['platform','route','body','headers'],outbound:['platform','chatId','content','replyTo']},
  voice:{status:[],configure:['config'],transcribe:['audioBase64','mimeType','model'],synthesize:['text','speed','instructions','provider']},
  collaboration:{message:['targets','content','mode','groupId'],publish:['groupId','task','status','result']},
  groups:{list:[],read:['groupId'],step:['groupId']},
};
export function normalizeNativeOperation(value={}) {
  const {resource,operation,input={}}=value;
  const allowed=NATIVE_OPERATIONS[resource]?.[operation];
  if(!allowed)throw botFailure('BOT_NATIVE_OPERATION_UNSUPPORTED','原生资源或操作不受支持',400);
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))throw botFailure('BOT_NATIVE_INPUT_INVALID','原生操作含未知参数',400);
  if(JSON.stringify(input).length>7*1024*1024)throw botFailure('BOT_NATIVE_INPUT_INVALID','原生输入超出大小限制',400);
  for(const key of ['name','server','taskId','sessionId','groupId'])if(input[key]!==undefined && (typeof input[key]!=='string'||!input[key]||input[key].length>160||/[\\/\0\r\n]/.test(input[key])||input[key]==='.'||input[key]==='..'))throw botFailure('BOT_NATIVE_INPUT_INVALID',`${key} 必须为本 Bot 范围内的单一标识`,400);
  if(input.expectedHash!==undefined&&!(resource==='skills'?/^(?:[a-f0-9]{64}|sha256:[a-f0-9]{16,64})$/:/^[a-f0-9]{64}$/).test(input.expectedHash))throw botFailure('BOT_NATIVE_INPUT_INVALID','expectedHash 必须是读取所得原生内容 hash',400);
  if(['memory.write','skills.update','skills.remove'].includes(`${resource}.${operation}`)&&!input.expectedHash)throw botFailure('BOT_NATIVE_INPUT_INVALID','修改或删除需要 expectedHash',400);
  if(input.scope!==undefined&&!['memory','user'].includes(input.scope))throw botFailure('BOT_NATIVE_INPUT_INVALID','memory scope 无效',400);
  if(input.content!==undefined&&(typeof input.content!=='string'||input.content.length>200_000))throw botFailure('BOT_NATIVE_INPUT_INVALID','content 无效',400);
  if(resource==='memory'&&operation==='write'&&typeof input.content!=='string')throw botFailure('BOT_NATIVE_INPUT_INVALID','memory write 需要 content',400);
  if(input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>(resource==='sessions'?10:100)))throw botFailure('BOT_NATIVE_INPUT_INVALID','limit 超出范围',400);
  if(input.maxTurns!==undefined&&(!Number.isInteger(input.maxTurns)||input.maxTurns<1||input.maxTurns>100))throw botFailure('BOT_NATIVE_INPUT_INVALID','maxTurns 超出范围',400);
  if(input.intervalSeconds!==undefined&&(!Number.isInteger(input.intervalSeconds)||input.intervalSeconds<60||input.intervalSeconds>86400))throw botFailure('BOT_NATIVE_INPUT_INVALID','heartbeat 间隔须为60–86400秒',400);
  if(input.durationSeconds!==undefined&&(!Number.isInteger(input.durationSeconds)||input.durationSeconds<1||input.durationSeconds>86400))throw botFailure('BOT_NATIVE_INPUT_INVALID','Gateway 连接期限须为1–86400秒',400);
  if(input.window!==undefined&&(!Number.isInteger(input.window)||input.window<1||input.window>20))throw botFailure('BOT_NATIVE_INPUT_INVALID','会话窗口须为1–20',400);
  if(input.runId!==undefined&&(!Number.isInteger(input.runId)||input.runId<1))throw botFailure('BOT_NATIVE_INPUT_INVALID','runId 必须为原生领取所得正整数',400);
  if(input.audioBase64!==undefined&&(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.audioBase64)||input.audioBase64.length>7*1024*1024))throw botFailure('BOT_NATIVE_INPUT_INVALID','audioBase64 无效',400);
  return {schemaVersion:2,resource,operation,input:structuredClone(input)};
}
export function nativeIsExecution(value) {
  return ['goals.step','heartbeat.step','kanban.dispatch','kanban.claim','mcp.call','gateway.connect','gateway.inbound','gateway.outbound','voice.transcribe','voice.synthesize','collaboration.message','collaboration.publish','groups.step'].includes(`${value.resource}.${value.operation}`);
}
export function nativeNeedsTools(value) {return ['mcp','voice','gateway','collaboration'].includes(value.resource)&&!['status','configure','disconnect'].includes(value.operation);}
