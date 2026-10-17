import crypto from 'node:crypto';

const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;};
export const canonicalHistoricalPrelaunchValue=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const historicalPrelaunchDigest=value=>crypto.createHash('sha256').update(canonicalHistoricalPrelaunchValue(value)).digest('hex');
export const historicalPrelaunchBytesDigest=value=>crypto.createHash('sha256').update(value).digest('hex');
export const HISTORICAL_PRELAUNCH_RECOVERY_KIND='bot.historical_prelaunch_recovery';
export const HISTORICAL_PRELAUNCH_CHALLENGE_TTL_MS=120_000;
// Enabled only after an independent audit pins every historical execution source.
// Neither request data, environment variables nor constructor options can enable it.
export const HISTORICAL_PRELAUNCH_POLICY=freeze({
  schemaVersion:1,
  id:'6666a63-bot-start-admission-prelaunch-v1',
  enabled:true,
  sourceRevision:'6666a63b46cd783d6a6537dd3295b37619ba4afa',
  sourceBuild:'7b4939c27eb485e0a1eff0635a698eb64b088dbff8ced84391ce1e87889bc212',
  sourceFiles:{
    'daemon/ziwei_user.mjs':'e2292c09d4d7bc531750b4d3e6054eed32593a1bb10355bc781b11a01a3a49e5',
    'src/daemon.mjs':'3dfa9902bf340907a4371005a50b8f34ae78489b16ab1561017133c0d1ecbaa2',
    'src/local-action.mjs':'8d87422ac39655ecc2b59abdaf5f11b12afe939ff6b19a96bb12d0bf35ea316b',
    'src/runtime-adapters.mjs':'2a21195b84c5867fa475e55a1acbf3ce95966804e4e1827fb939fe722358fda1',
    'src/runtime-process.mjs':'a48eb40faf66b34108f49bbc216ce700642636c3fa94d8b9875c9c3b29ee3db1',
    'src/daemon-action-delivery.mjs':'5779762e6740f9cfd4f050a4541e7c0a339ab3d845b4ccdb668c9b48bbb3c579',
    'src/daemon-action-scheduler.mjs':'c9a3fd21f2744ce8b49527095ddc668838885c3dac49de0625d8a3a85055240d',
    'src/windows-workdir.mjs':'f85b455c206d608058d7758b7c6ba901b67fdec15b5aa9423603877eed2a4912',
    'src/runtime-launch-evidence.mjs':'1b4d0747c6cf0f29c433beff0c85576b68959badb06561ce0c0b550bc7ea759c',
    'src/execution-admission.mjs':'1c664e5e8b016fde92e1cd95128ea2ee0938281897ff91e566c434a7f1a241be',
    'src/management-bootstrap.mjs':'0051c4f3b925ac82f755337fbed2912cb8c7d5c4590e912986667d483859c202',
    'src/runtime-cli-discovery.mjs':'6fff628addaf8fa06896019bc0f2bedfa4a8ea38cdcb0881de48f2a5801398f9',
    'src/hermes-launcher.mjs':'56f9837d112b46cb8a99534ad4b13b435180e3a31ebd81cfc84254aec7d5564b',
    'src/hermes-mcp-bootstrap.py':'e5fcc41dccc918797178157b68df9b8a3421cf9d820e58794d75213df698e9eb',
    'src/hermes-bot-runtime.mjs':'d5625d6fff43da1cd804e2e0f68d6b1e5d695d418780a73d3936957d404c03c3',
    'src/hermes-bot-config.mjs':'ae1a4726f7205d187fee669bb6b79334f68bb07d409459c963e7adabcd5d8f80',
  },
  auditedSubject:{
    actionId:'action_2805b4da-c082-49a2-b0f1-b43bdeb107fe',workspace:'bigtron',workspaceId:'ws_52fa81da-ddeb-439a-9a74-ab4df4b2636e',deviceId:'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493',employeeId:'employee_5f157a51-a8fa-483c-90df-53d44292b5d2',profile:'bot-e1bf33c85b1543b18ecd3d6a',
    originalRevision:3,originalControlEpoch:5,currentRevision:3,currentControlEpoch:8,
    originalPayloadSha256:'e09ffebdb7d2e775fc3a3712159d2076c26319977b8596f05f22c816c6848448',originalResultSha256:'cd625b824e89339e813ee4c8f9b43e9101076b6af6585d4ed48ab5270f6a372f',failedEventId:'action-event_6c9a3e9aebb7d93cae4358455b7558c393d36d845877dade1ae62ea2d686e6b3',failedEventDataSha256:'bec062593118dae53cfea8df2b533e59e5e6542d68e7e7fef33c37903fb3d857',
  },
  actionTypes:['conversation.execute'],
  error:'执行状态无法安全确认，需人工核实后处理：Bot 配置或控制状态已变化，请重新读取',
  originalResult:{processExit:null,partialEffectsPossible:true,code:'EXECUTION_UNCERTAIN',executionState:'uncertain',reason:'EXECUTOR_WITHOUT_EXIT_EVIDENCE'},
});
export const HISTORICAL_PRELAUNCH_POLICY_DIGEST=historicalPrelaunchDigest(HISTORICAL_PRELAUNCH_POLICY);
export const historicalPrelaunchHex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const historicalPrelaunchExactKeys=(value,keys)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)));
export function historicalPrelaunchPolicyAllows(subject){
  const policy=HISTORICAL_PRELAUNCH_POLICY,pins={...subject,failedEventId:subject?.failedEvent?.id,failedEventDataSha256:subject?.failedEvent?.dataSha256};
  return policy.enabled===true&&policy.auditedSubject&&Object.entries(policy.auditedSubject).every(([key,value])=>pins[key]===value)&&historicalPrelaunchHex(policy.sourceBuild)&&Object.keys(policy.sourceFiles).length>0&&Object.values(policy.sourceFiles).every(historicalPrelaunchHex)
    &&policy.actionTypes.includes(subject?.actionType)&&subject?.originalError===policy.error&&subject?.failedEvent?.error===policy.error
    &&subject?.originalResultDigest===historicalPrelaunchDigest(policy.originalResult)&&subject?.failedEvent?.resultDigest===historicalPrelaunchDigest(policy.originalResult);
}
// The audited ordinary-employee delivery path in 6666a63 strips untrusted
// template fields, then replaces management metadata at the end of the payload.
// The backend separately rejects Creator template instances before using this.
export function historicalPrelaunchDeliveredPayload(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||typeof payload.employeeId!=='string'||!payload.employeeId||typeof payload.hermesBot?.workspace!=='string'||!payload.hermesBot.workspace)return null;
  const {employeeTemplateId:_template,employeePersona:_persona,employeeInstructions:_instructions,employeeDescription:_description,managementMcp:_management,...rest}=payload;
  return{...rest,managementMcp:{enabled:true,workspace:payload.hermesBot.workspace}};
}
export function historicalPrelaunchAdmissionProof(){return{scope:'conversation-runtime-root',phase:'bot-start-admission',launched:false,partialEffectsPossible:true};}
export function validateHistoricalPrelaunchReceipt(receipt,{actionId,subject,evidenceDigest}={}){
  if(!historicalPrelaunchExactKeys(receipt,['schemaVersion','kind','id','policy','sourceBuild','sourcePolicyDigest','subject','subjectDigest','evidenceDigest','localEvidenceDigest','daemonExit','localStartedAt','admissionProof','status','executionState','recordedAt']))return false;
  if(receipt.schemaVersion!==1||receipt.kind!==HISTORICAL_PRELAUNCH_RECOVERY_KIND||receipt.policy!==HISTORICAL_PRELAUNCH_POLICY.id||receipt.sourceBuild!==HISTORICAL_PRELAUNCH_POLICY.sourceBuild||receipt.sourcePolicyDigest!==HISTORICAL_PRELAUNCH_POLICY_DIGEST||!historicalPrelaunchPolicyAllows(receipt.subject)||!historicalPrelaunchHex(receipt.subject.originalDeliveredPayloadDigest)||receipt.subjectDigest!==historicalPrelaunchDigest(receipt.subject)||!historicalPrelaunchHex(receipt.evidenceDigest)||!historicalPrelaunchHex(receipt.localEvidenceDigest)||!historicalPrelaunchHex(receipt.id)||receipt.status!=='failed'||receipt.executionState!=='not_started'||!Number.isFinite(Date.parse(receipt.recordedAt)))return false;
  if(receipt.id!==historicalPrelaunchDigest({actionId:receipt.subject.actionId,subjectDigest:receipt.subjectDigest,evidenceDigest:receipt.evidenceDigest}))return false;
  if(canonicalHistoricalPrelaunchValue(receipt.admissionProof)!==canonicalHistoricalPrelaunchValue(historicalPrelaunchAdmissionProof()))return false;
  if(actionId!==undefined&&receipt.subject.actionId!==actionId||subject!==undefined&&receipt.subjectDigest!==historicalPrelaunchDigest(subject)||evidenceDigest!==undefined&&receipt.evidenceDigest!==evidenceDigest)return false;
  const exit=receipt.daemonExit;
  return historicalPrelaunchExactKeys(exit,['stopped','pid','creationTime','exitedAt'])&&exit.stopped===true&&Number.isSafeInteger(exit.pid)&&exit.pid>0&&Number.isFinite(Date.parse(exit.creationTime))&&Number.isFinite(Date.parse(exit.exitedAt))&&Number.isSafeInteger(receipt.localStartedAt)&&receipt.localStartedAt>=Date.parse(receipt.subject.ackedAt)&&receipt.localStartedAt<=Date.parse(receipt.subject.failedEvent.createdAt)&&Date.parse(exit.creationTime)<=receipt.localStartedAt&&Date.parse(exit.exitedAt)>=Date.parse(receipt.subject.failedEvent.createdAt)&&Date.parse(exit.exitedAt)<=Date.parse(receipt.recordedAt);
}
