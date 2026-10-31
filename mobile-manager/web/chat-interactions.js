import {accountId, workspaceId, workspaceDatabaseId, escapeHtml as e, formatTime} from './model.js';
import {sealBrowserAnswer} from './interaction-crypto.js';

const states = new Set(['waiting','answered','delivered','expired','cancelled']);
const statuses = {answered:'已提交，等待员工接收',delivered:'员工已接收',expired:'本次请求已到期',cancelled:'本次请求已取消'};
const choicesLabel = {once:'仅本次允许',session:'本次会话允许',always:'记住此范围',deny:'拒绝'};
const fresh = scope => ({scope,phase:'idle',requests:[],error:'',submitError:'',errorRequestId:'',submittingRequestId:'',unknownRequestIds:[]});
const text = value => typeof value === 'string' && value.length > 0;

export function createChatInteractions({state,api,current = () => ({}),valid = () => true,draw = () => {},fail = () => {},readOptions} = {}) {
  let generation = 0, readEpoch = 0, reading = null;
  // A lost POST acknowledgement is not permission to send another answer.
  // Keep only request IDs across navigation; drafts/envelopes never persist.
  const unknown = new Map();
  state.chatInteractions = fresh('');
  function reset() { generation++; readEpoch++; reading = null; state.chatInteractions = fresh(''); }
  function scope() {
    const employee = state.selectedEmployee, conversation = state.conversation;
    if (state.page !== 'chat' || employee?.runtime !== 'Hermes' || conversation?.employee_id !== employee.id || !conversation.execution?.id || !accountId(state) || !workspaceId(state)) return null;
    return {key:JSON.stringify([accountId(state),workspaceId(state),employee.id,conversation.id,conversation.execution.id]),workspace:workspaceId(state),employeeId:employee.id,actionId:conversation.execution.id,workspaceId:workspaceDatabaseId(state.workspace)};
  }
  function select(subject) {
    if (state.chatInteractions.scope !== subject.key) {
      reset(); state.chatInteractions = fresh(subject.key);
    }
    const data = state.chatInteractions;
    data.unknownRequestIds = [...(unknown.get(subject.key) || [])];
    return data;
  }
  const live = (data, subject, token, visit) => generation === visit && state.chatInteractions === data && valid(token,true) && scope()?.key === subject.key;
  function syncUnknown(data, subject) {
    const ids = unknown.get(subject.key);
    for (const request of data.requests) if (request.state !== 'waiting') ids?.delete(request.requestId);
    if (ids && !ids.size) unknown.delete(subject.key);
    data.unknownRequestIds = [...(unknown.get(subject.key) || [])];
    if (data.requests.some(request => request.requestId === data.errorRequestId && request.state !== 'waiting')) { data.submitError = ''; data.errorRequestId = ''; }
  }
  function refresh() {
    const subject = scope();
    if (!subject || typeof api.botInteractions !== 'function') { reset(); return Promise.resolve(false); }
    const data = select(subject), token = current(), visit = generation;
    if (data.submittingRequestId) return Promise.resolve(false);
    if (reading?.data === data) return reading.promise;
    const epoch = readEpoch, entry = {data};
    data.phase = 'loading'; data.error = ''; draw();
    entry.promise = (async () => {
      try {
        const value = await api.botInteractions(subject.workspace,subject.employeeId,...(readOptions?[readOptions()]:[]));
        if (!live(data,subject,token,visit) || epoch !== readEpoch) return false;
        if (!Array.isArray(value?.requests)) throw new Error('待处理交互返回无效，请刷新核对');
        data.requests = value.requests.filter(request => ['question','approval'].includes(request?.kind) && request.workspace === subject.workspace && request.employeeId === subject.employeeId && request.actionId === subject.actionId).map(request => checkedRequest(request,subject));
        data.phase = 'ready'; syncUnknown(data,subject); return true;
      } catch (error) {
        if (!live(data,subject,token,visit) || epoch !== readEpoch) return false;
        data.phase = 'error'; data.error = error.status === 404 ? '当前服务器尚未提供手机审批与提问接口' : '待处理交互同步失败，请刷新重试';
        if (error.status === 401) fail(error,token);
        return false;
      } finally {
        if (reading === entry) reading = null;
        if (live(data,subject,token,visit) && epoch === readEpoch) draw();
      }
    })();
    reading = entry;
    return entry.promise;
  }
  async function submit(formData) {
    const subject = scope();
    if (!subject || typeof api.answerBotInteraction !== 'function') return false;
    const data = select(subject), token = current(), visit = generation;
    const requestId = formData.get('interactionRequestId'), request = data.requests.find(item => item.requestId === requestId);
    if (!request || request.state !== 'waiting' || data.submittingRequestId || data.unknownRequestIds.includes(requestId)) return false;
    data.submitError = ''; data.errorRequestId = requestId;
    if (request.expiresAt <= Date.now()) { data.submitError = '本次请求已到期，请刷新核对'; draw(); return false; }
    let input;
    try { input = answerInput(request,formData); }
    catch (error) { data.submitError = error.message; draw(); return false; }
    readEpoch++; reading = null; data.submittingRequestId = requestId; draw();
    let posted = false;
    try {
      const envelope = await sealBrowserAnswer(request.devicePublicKey,request.binding,input);
      if (!live(data,subject,token,visit)) return false;
      posted = true;
      if (!unknown.has(subject.key)) unknown.set(subject.key,new Set());
      unknown.get(subject.key).add(requestId);
      const response = await api.answerBotInteraction(subject.workspace,subject.employeeId,requestId,{envelope});
      const receipt = checkedRequest(response,subject);
      if (receipt.requestId !== requestId || !['answered','delivered'].includes(receipt.state)) throw new Error('交互答复回执尚未核实');
      if (!live(data,subject,token,visit)) return false;
      unknown.get(subject.key)?.delete(requestId);
      data.requests = data.requests.map(item => item.requestId === requestId ? receipt : item);
      syncUnknown(data,subject);
      data.submitError = ''; data.errorRequestId = ''; return true;
    } catch (error) {
      const uncertain = posted && (error.uncertain || !error.status || error.status >= 500 || [408,409,429].includes(error.status));
      if (!uncertain) unknown.get(subject.key)?.delete(requestId);
      if (!live(data,subject,token,visit)) return false;
      data.unknownRequestIds = [...(unknown.get(subject.key) || [])];
      data.submitError = uncertain ? '尚未核实这次答复的回执，正在查询原请求；不会重复提交。' : posted ? '本次答复未能保存，请刷新核对请求状态。' : '答复尚未发送，请检查填写内容与安全连接后重试。';
      if (error.status === 401) fail(error,token);
      return false;
    } finally {
      if (input) input.answer = null;
      if (live(data,subject,token,visit)) { data.submittingRequestId = ''; draw(); if (posted) void refresh(); }
    }
  }
  return {refresh,reset,submit,render:() => renderChatInteractions(state)};
}

function checkedRequest(request, subject) {
  const binding = request?.binding;
  if (!text(request?.requestId) || request.workspace !== subject.workspace || request.employeeId !== subject.employeeId || request.actionId !== subject.actionId || !['question','approval'].includes(request.kind) || request.secure !== false || !states.has(request.state) || !Number.isSafeInteger(request.expiresAt) || !text(request.devicePublicKey) || binding?.purpose !== 'hermes-interaction' || binding.requestId !== request.requestId || binding.kind !== request.kind || binding.employeeId !== subject.employeeId || binding.actionId !== subject.actionId || subject.workspaceId && binding.workspaceId !== subject.workspaceId || binding.expiresAt * 1000 !== request.expiresAt || !request.display || typeof request.display !== 'object') throw new Error('交互绑定或内容无法核对');
  const optionsValid = value => value === undefined || value === null || Array.isArray(value) && value.every(text);
  if (!optionsValid(request.choices)) throw new Error('交互选项无法读取');
  const questions = request.display.questions;
  if (questions !== undefined && (!Array.isArray(questions) || questions.some(question => !text(question?.qid) || !text(question.question) || !optionsValid(question.choices)) || new Set(questions.map(question => question.qid)).size !== questions.length)) throw new Error('问题内容无法读取');
  return request;
}

function answerInput(request, formData) {
  const read = (name, choices, multiple) => {
    const values = multiple ? formData.getAll(name) : [formData.get(name)];
    if (!values.length || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 4000 || choices?.length && !choices.includes(value))) throw new Error('请完整填写答复，或选择原请求提供的选项。');
    return multiple ? values : values[0];
  };
  if (request.display.questions?.length) return {answer:{answers:Object.fromEntries(request.display.questions.map(question => [question.qid,read(`interactionAnswer:${question.qid}`,question.choices,question.multi_select === true)]))}};
  if (request.kind === 'approval' && !request.choices?.length) throw new Error('本次审批未提供有效选项，请在电脑版核对。');
  return {answer:read('interactionAnswer',request.choices,request.options?.multiSelect === true)};
}

export function renderChatInteractions(state) {
  const data = state.chatInteractions;
  if (state.page !== 'chat' || !data?.scope) return '';
  const scope = JSON.stringify([accountId(state),workspaceId(state),state.selectedEmployee?.id,state.conversation?.id,state.conversation?.execution?.id]);
  if (scope !== data.scope) return '';
  const cards = data.requests.map(request => {
    const unknown = data.unknownRequestIds.includes(request.requestId), busy = Boolean(data.submittingRequestId), waiting = request.state === 'waiting' && request.expiresAt > Date.now();
    const locked = busy || unknown, title = request.kind === 'approval' ? '需要你确认' : '员工需要补充信息';
    const description = [request.display.label,request.display.question,request.kind === 'approval' ? request.display.description : '',request.kind === 'approval' ? request.display.command : ''].filter(value => typeof value === 'string' && value.trim()).map(value => `<p>${e(value)}</p>`).join('');
    const form = waiting ? `<form data-form="chat-interaction" data-record-key="${e(request.requestId)}" autocomplete="off"><input type="hidden" name="interactionRequestId" value="${e(request.requestId)}"><fieldset${locked ? ' disabled' : ''}><legend class="sr-only">${title}</legend>${questionFields(request)}<p class="interaction-hint">请勿在此填写密码、密钥或验证码。</p><small>等待答复至 ${e(formatTime(request.expiresAt))}</small></fieldset></form>` : `<p class="interaction-status">${e(statuses[request.state] || '本次请求已到期，请刷新核对')}</p>`;
    return `<section class="chat-interaction panel" id="interaction-${e(request.requestId)}" aria-label="${title}" data-state="${e(request.state)}"><strong>${title}</strong>${description}${unknown ? '<p class="interaction-unknown" role="status">答复回执待核实，仅查询原请求，不重复提交。</p>' : ''}${form}</section>`;
  }).join('');
  return `${cards}${data.unknownRequestIds.length && !data.requests.some(request => data.unknownRequestIds.includes(request.requestId)) ? '<p class="interaction-unknown" role="status">原交互答复回执尚未核实，当前列表未返回该请求；不会重发。</p>' : ''}${data.error ? `<p class="interaction-error" role="status">${e(data.error)}</p>` : ''}${data.submitError ? `<p class="interaction-error" role="alert">${e(data.submitError)}</p>` : ''}`;
}

function questionFields(request) {
  const choiceList = (name, choices, multiple) => choices.map(choice => `<label class="interaction-choice"><input type="${multiple ? 'checkbox' : 'radio'}" name="${e(name)}" value="${e(choice)}"><span>${e(choice)}</span></label>`).join('');
  if (request.display.questions?.length) return request.display.questions.map(question => `<div class="interaction-question"><p>${e(question.question)}</p>${question.choices?.length ? choiceList(`interactionAnswer:${question.qid}`,question.choices,question.multi_select === true) : `<textarea name="interactionAnswer:${e(question.qid)}" aria-label="${e(question.question)}" rows="3" maxlength="4000"></textarea>`}</div>`).join('') + '<button type="submit" class="button secondary">提交答复</button>';
  if (request.choices?.length && !request.options?.multiSelect) return `<div class="interaction-actions">${request.choices.map(choice => `<button type="submit" class="button secondary" name="interactionAnswer" value="${e(choice)}">${e(choicesLabel[choice] || choice)}</button>`).join('')}</div>`;
  if (request.kind === 'approval' && !request.choices?.length) return '<p class="interaction-hint">审批选项暂不可用，请在电脑版核对。</p>';
  return `${request.choices?.length ? choiceList('interactionAnswer',request.choices,true) : '<label>答复<textarea name="interactionAnswer" rows="3" maxlength="4000"></textarea></label>'}<button type="submit" class="button secondary">提交答复</button>`;
}
