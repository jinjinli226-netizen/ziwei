import {executionUncertain} from './bot-presentation.js';

export const forceEmployeeRemovalDetail='仅从团队和 Bot 名册移除员工并禁止新任务。历史执行回执、Profile 和 HOME 保留；这不代表原电脑上的进程已停止。';
export function canForceRemoveEmployee(bot,errorCode='') {return errorCode==='BOT_BUSY'||executionUncertain(bot?.latest_run);}
export function employeeRemovalPrompt(employee,force=false) {return force?`强制移除员工“${employee.name||employee.id}”？${forceEmployeeRemovalDetail}`:`确定删除数字员工“${employee.name||employee.id}”？团队管理与 Bot 视图会同步移除。`;}
export function employeeRemovalNotice(result) {return result?.forced===true?`员工已从团队和 Bot 名册移除，已禁止新任务。历史回执、Profile 和 HOME 已保留；原进程停止状态未确认。`:'数字员工已删除。';}
