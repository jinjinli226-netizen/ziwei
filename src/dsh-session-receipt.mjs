import {dshBotNameForAction} from './dsh-session-evidence.mjs';

export const isDshAction=action=>String(action?.payload?.runtime||action?.payload?.agent||action?.payload?.runtimeName||'').toLowerCase()==='dsh';
const text=value=>typeof value==='string'&&value.trim().length>0;
const keys=['actionId','employeeId','conversationId','botName','sessionId','requestId'];
export const sameDshSessionBinding=(left,right)=>Boolean(left&&right&&keys.every(key=>left[key]===right[key]));
export function matchesDshSessionBinding(action,binding){
 if(!isDshAction(action)||!binding||typeof binding!=='object'||Array.isArray(binding))return false;
 const p=action.payload,requested=p.runtimeSessionId||p.runtime_session_id||p.sessionId||p.session_id;
 return binding.actionId===action.id&&binding.employeeId===(p.employeeId||null)&&binding.conversationId===(p.conversationId||null)&&binding.botName===dshBotNameForAction(action)&&text(binding.sessionId)&&text(binding.requestId)&&(!requested||requested===binding.sessionId);
}
export function confirmedDshSessionExit(action,delivery,binding=action?.payload?.dshSessionBinding){
 const result=delivery?.result,exit=result?.sessionExit;
 if(!matchesDshSessionBinding(action,binding)||!['succeeded','failed'].includes(delivery?.status)||!result||result.processExit!==undefined||result.code==='EXECUTION_UNCERTAIN'||result.executionState==='uncertain')return null;
 if(exit?.schemaVersion!==1||exit.source!=='dsh-native-session'||exit.terminalConfirmed!==true||!Number.isSafeInteger(exit.turn)||exit.turn<0||!text(exit.reason)||result.sessionId!==binding.sessionId||!sameDshSessionBinding(exit,binding))return null;
 return delivery.status==='succeeded'&&exit.reason!=='completed'?null:exit;
}

export function confirmedDshPrePromptFailure(action,delivery,{workspace,deviceId,binding=action?.payload?.dshSessionBinding}={}){
 const result=delivery?.result,proof=result?.prelaunch,exit=result?.processExit,p=action?.payload;
 if(!isDshAction(action)||delivery?.status!=='failed'||result?.code!=='DSH_PROMPT_NOT_SENT'||result.executionState==='uncertain'||result.sessionExit||proof?.schemaVersion!==1||proof.source!=='dsh-native-adapter'||proof.phase!=='before-session-prompt'||proof.promptSent!==false)return null;
 if(proof.actionId!==action.id||proof.employeeId!==(p.employeeId||null)||proof.conversationId!==(p.conversationId||null)||proof.botName!==dshBotNameForAction(action)||!text(proof.workspace)||!text(proof.deviceId)||workspace!==undefined&&proof.workspace!==workspace||proof.deviceId!==(deviceId||p.deviceId||p.device_id||p.targetDeviceId||p.target_device_id))return null;
 if(binding&&(!matchesDshSessionBinding(action,binding)||!sameDshSessionBinding(proof,binding)))return null;
 if(!binding&&(proof.sessionId!==null||proof.requestId!==null))return null;
 return exit?.supervisor==='runtime-prelaunch'&&exit.launched===false&&exit.rootPid===null&&exit.rootConfirmed===false&&exit.rootExitCode===null&&exit.treeConfirmed===true&&exit.activeProcesses===0&&exit.cancelled===false&&!exit.failureCode?proof:null;
}
