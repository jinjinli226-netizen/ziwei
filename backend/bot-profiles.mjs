import {botFailure} from '../src/hermes-bot-config.mjs';
import {ownedProfileProofMatches} from '../src/hermes-profile-proof.mjs';

const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
export const botProfileBinding=row=>parse(row?.profile_binding_json) || {mode:'legacy_private_home'};
const uncertain=value=>Boolean(value&&(value.code==='EXECUTION_UNCERTAIN'||value.executionState==='uncertain'||uncertain(value.result)));

export function botProfileView(db,row,employee){
  const binding=botProfileBinding(row);
  if(binding.mode!=='owned_profile')return{mode:'legacy_private_home',profile:employee.runtime_profile,templateProfile:employee.runtime_profile,home:null,provisioning:null};
  const action=row.provision_action_id?db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(row.provision_action_id):null;
  const result=parse(action?.result_json),receipt=result?.botProvision || result?.result?.botProvision;
  const confirmed=action?.status==='succeeded'&&receipt?.ownershipId===binding.ownershipId;
  const status=confirmed?'provisioned':uncertain(result)||action?.status==='expired'&&action.acked_at?'uncertain':action?.status || 'not_started';
  return{...binding,authMode:'source-native-store',home:confirmed?receipt.home:null,provisioning:{actionId:action?.id || null,status,authentication:confirmed?receipt.authentication:null,error:action?.error || null}};
}

export function assertBotProfileReady(db,row,employee){
  if(botProfileBinding(row).mode==='owned_profile'&&botProfileView(db,row,employee).provisioning.status!=='provisioned')throw botFailure('BOT_PROFILE_NOT_PROVISIONED','Bot 专属 Profile 尚未取得设备创建成功回执，请查询原创建动作');
}

export function verifyBotProvisionReceipt(payload,result){
  const receipt=result?.botProvision || result?.result?.botProvision;
  const exit=result?.processExit || result?.result?.processExit;
  const valid=payload.hermesBot?.employeeId===payload.employeeId&&payload.hermesBot?.deviceId===payload.deviceId
    &&ownedProfileProofMatches(payload.hermesBot,receipt,exit);
  if(!valid)throw botFailure('BOT_PROFILE_RECEIPT_INVALID','专属 Profile 回执缺少匹配身份、实际 HOME 或进程退出证明');
}
