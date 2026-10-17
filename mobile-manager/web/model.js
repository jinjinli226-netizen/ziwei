// Shared presentation uses the same receipt rules as the desktop product.
import {botPresence, botStopPresentation, executionUncertain} from './bot-presentation.js';

export {executionUncertain, botStopPresentation};
export const list = (value, key) => Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : [];
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const employeeName = value => value?.employee?.name || value?.name || '数字员工';
export function avatarUrl(value) {
  const candidate = value?.employee?.avatar || value?.employee?.avatar_url || value?.avatar || value?.avatar_url || '';
  if (/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(candidate)) return candidate;
  try { const url = new URL(candidate, 'https://qzelynth.top'); return url.protocol === 'https:' && (candidate.startsWith('https:') || candidate.startsWith('/')) ? url.href : ''; } catch { return ''; }
}
export function presence(value) {
  const bot = value?.bot || value;
  if (bot?.control_state || bot?.configuration_state) return botPresence(bot);
  const execution = value?.execution || value?.latest_run;
  if (executionUncertain(execution)) return {label:'执行待核实',tone:'warning'};
  if (['pending','queued','acked','running'].includes(execution?.status)) return {label:execution.status==='pending'?'等待执行':'正在执行',tone:'running'};
  if (value?.status === 'paused' || value?.status === 'disabled') return {label:'已暂停',tone:'muted'};
  if (execution?.status==='failed') return {label:'上次执行失败',tone:'error'};
  if (execution?.status==='succeeded') return {label:'上次已完成',tone:'success'};
  return {label:'状态待确认',tone:'muted'};
}
export function messageText(message) { return String(message?.content ?? message?.text ?? ''); }
export function formatTime(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
export function initialResources() {
  return Object.fromEntries(['employees','bots','tasks','devices','phones'].map(name=>[name,{phase:'idle',error:'',lastUpdated:null}]));
}
export function initialState() {
  return {phase:'boot',user:null,workspaces:[],workspace:null,tab:'employees',page:'home',employees:[],bots:[],tasks:[],devices:[],phones:[],resources:initialResources(),selectedEmployee:null,bot:null,conversation:null,messages:[],runs:[],routines:[],report:null,phone:null,draft:'',attachments:[],busy:false,chatLoading:false,error:'',notice:'',filter:'all',search:'',imagePreview:null,task:null,reportSelection:[],botSettings:null,deviceSettings:null,settingsTrail:[]};
}
export const id = () => globalThis.crypto?.randomUUID?.() || `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function accountId(state) { return String(state.user?.user_id || state.user?.user?.id || state.user?.id || ''); }
export function workspaceId(state) { return String(typeof state.workspace === 'string' ? state.workspace : state.workspace?.slug || ''); }
export function scopeKey(state) { return `${accountId(state)}:${workspaceId(state)}`; }
export function resultText(run) {
  const result=run?.result;
  for (const value of [typeof result==='string'?result:null,result?.output,result?.stdout,result?.message,result?.summary,result?.text,result?.result?.output,result?.result?.stdout,result?.result?.text,result?.result?.message]) if(typeof value==='string' && value.trim()) return value.trim();
  return '';
}
