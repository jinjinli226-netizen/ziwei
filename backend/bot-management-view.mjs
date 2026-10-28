// Management replies carry current configuration and bounded execution facts.
// Full prompts, output, event bodies and native content stay on their original
// action endpoints. Project in SQLite so historical blobs are not parsed into
// the API process merely to answer a configuration read or acknowledgement.
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const payload=['runtime','employeeId','deviceId','profile','conversationId','messageId','actionId'];
const binding=['schemaVersion','employeeId','workspace','revision','controlEpoch','sourceProfile','deviceId','instance'];
const request=['resource','operation','requestId'];
const requestInput=['server','tool','platform','mode','id'];
const result=['runtime','model','profile','code','status','executionState','reason','partialEffectsPossible','stopConfirmed','configurationRevision','nativeSessionId','processAlive','processExit','prelaunch','fixture','executionSource','turnLimit','botIsolation','reasoning','externalModelCalls'];
const validation=['schemaVersion','valid','employeeId','revision','externalModelCalls','code'];
const effective=['provider','model','maxTurns','turnLimit','reasoning','runtimeProfile','profile','home','sourceProfile','deviceId','workspace','permissions','memory','toolsets','mcpServers','mcpServerNames'];
const native=['schemaVersion','resource','operation','employeeId','revision','nativeVersion','status','code'];
const data=['connected','authorized','persisted','success','requires_authorization','session_id','message_count','truncated','executionSource','fixture','requestedScopes','grantedScopes','scopeConfirmed'];
const scopeTokens=value=>{
  if(!Array.isArray(value)||value.length>128)return null;
  let length=Math.max(0,value.length-1);
  for(const token of value){
    if(typeof token!=='string'||!/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(token))return null;
    length+=token.length;if(length>4000)return null;
  }
  return [...new Set(value)];
};
export function projectMcpScopeEvidence(data){
  const requestedScopes=scopeTokens(data?.requestedScopes),grantedScopes=scopeTokens(data?.grantedScopes);
  const scopeConfirmed=data?.scopeConfirmed===true&&requestedScopes!==null&&requestedScopes.length>0&&grantedScopes!==null&&requestedScopes.every(scope=>grantedScopes.includes(scope));
  return {requestedScopes,grantedScopes,scopeConfirmed};
}
const paths=[
  ...payload.map(key=>['p',key,['payload',key]]),
  ...binding.map(key=>['p',`hermesBot.${key}`,['payload','hermesBot',key]]),
  ...request.map(key=>['p',`nativeOperation.${key}`,['payload','nativeOperation',key]]),
  ...requestInput.map(key=>['p',`nativeOperation.input.${key}`,['payload','nativeOperation','input',key]]),
  ...result.map(key=>['r',key,['result',key]]),
  ...validation.map(key=>['r',`botValidation.${key}`,['result','botValidation',key]]),
  ...effective.map(key=>['r',`botValidation.effective.${key}`,['result','botValidation','effective',key]]),
  ...native.map(key=>['r',`nativeOperation.${key}`,['result','nativeOperation',key]]),
  ...data.map(key=>['r',`nativeOperation.data.${key}`,['result','nativeOperation','data',key]]),
];
const valueSql=(column,path)=>{
  const value=column==='r'?`CASE WHEN json_type(r,'$.${path}') IS NOT NULL THEN r -> '$.${path}' ELSE r -> '$.result.${path}' END`:`p -> '$.${path}'`;
  // A legacy error can put arbitrary content in reason. It is a short display
  // detail here, never a place to embed another complete management response.
  if(column==='r'&&['nativeOperation.data.requestedScopes','nativeOperation.data.grantedScopes'].includes(path))return `CASE WHEN json_type(${value})='array' AND json_array_length(${value})<=128 AND length(${value})<=25000 THEN ${value} END`;
  if(column==='r'&&path==='nativeOperation.data.scopeConfirmed')return `CASE WHEN json_type(${value}) IN ('true','false') THEN ${value} END`;
  return column==='r'&&path==='reason'?`CASE WHEN json_type(${value})='text' THEN json_quote(substr(json_extract(${value},'$'),1,2000)) END`:value;
};
const put=(target,path,value)=>{for(const key of path.slice(0,-1))target=target[key]??=(Object.create(null));target[path.at(-1)]=value;};
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};

export function createBotManagementActionReader(repo){
  const db=repo.db;
  const select=db.prepare(`WITH selected AS (
    SELECT id,task_id,agent_id,type,status,dedupe_key,created_at,acked_at,completed_at,workspace_id,
      substr(error,1,2000) error,length(error) error_length,length(payload_json) payload_length,length(result_json) result_length,
      CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END p,
      CASE WHEN json_valid(result_json) THEN result_json ELSE '{}' END r
    FROM a2a_actions WHERE id=? AND workspace_id=?
  ) SELECT id,task_id,agent_id,type,status,dedupe_key,created_at,acked_at,completed_at,workspace_id,error,error_length,payload_length,result_length,
    ${paths.map(([column,path],index)=>`${valueSql(column,path)} AS field_${index}`).join(',\n')},
    EXISTS(SELECT 1 FROM json_tree(r) WHERE key IN ('code','executionState','status') AND atom IN ('EXECUTION_UNCERTAIN','uncertain')) uncertain,
    (SELECT json_group_array(CASE WHEN json_valid(value) THEN substr(json_extract(value,'$.name'),1,200) END) FROM (
      SELECT value FROM json_each(COALESCE(NULLIF(r -> '$.nativeOperation.data.tools','null'),r -> '$.result.nativeOperation.data.tools','[]')) LIMIT 200
    )) tool_names
    FROM selected`);
  return(actionId,workspaceId)=>{
    const row=select.get(actionId,workspaceId);if(!row)return null;
    const view=Object.fromEntries(['id','task_id','agent_id','type','status','dedupe_key','created_at','acked_at','completed_at','workspace_id','error'].map(key=>[key,row[key]]));
    view.payload={};view.result={};
    for(const [index,[,,path]] of paths.entries())if(row[`field_${index}`]!==null)put(view,path,parse(row[`field_${index}`]));
    if(row.uncertain&&!['uncertain'].includes(view.result.executionState))view.result.executionState='uncertain';
    if(view.result.nativeOperation){
      const names=(parse(row.tool_names)||[]).filter(value=>typeof value==='string');
      if(names.length){view.result.nativeOperation.data??={};view.result.nativeOperation.data.tools=names.map(name=>({name}));}
      const receipt=view.result.nativeOperation,scopeData=receipt.data;
      if(scopeData&&['requestedScopes','grantedScopes','scopeConfirmed'].some(key=>Object.hasOwn(scopeData,key))){
        const bound=view.status==='succeeded'&&receipt.status==='succeeded'&&receipt.schemaVersion===2&&receipt.resource==='mcp'&&view.payload.nativeOperation?.resource==='mcp'&&receipt.employeeId===view.payload.employeeId&&receipt.revision===view.payload.hermesBot?.revision&&receipt.operation===view.payload.nativeOperation?.operation;
        Object.assign(scopeData,projectMcpScopeEvidence(bound?scopeData:null));
      }
    }
    // These rare historical dispositions must retain their verified, complete
    // original binding. A marker alone is never projected as recovery authority.
    const marker=db.prepare("SELECT 1 FROM management_requests WHERE workspace_id=? AND request_key=? AND kind IN ('bot-historical-prelaunch-recovery-v1','bot-force-abandon-recovery-v1','bot-failure-finalization-v1') LIMIT 1").get(workspaceId,actionId);
    if(marker){
      const original=repo.getA2AAction(actionId,{eventView:'none'});
      for(const key of ['prelaunchRecovery','forceAbandonRecovery','failureFinalization'])if(original?.[key])view[key]=original[key];
      // The pinned force-abandon validator requires exactly the original result.
      // Its committed original body is small and server verified, never output.
      if(original?.forceAbandonRecovery&&canonical(original.result).length<8192)view.result=original.result;
    }
    view.managementSummary={detailsOmitted:true,eventsIncluded:false,payloadBytes:row.payload_length||0,resultBytes:row.result_length||0,errorTruncated:row.error_length>2000,fullActionOperation:'ziwei_get_action'};
    return view;
  };
}
