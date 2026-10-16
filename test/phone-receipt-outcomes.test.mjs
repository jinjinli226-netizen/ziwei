import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createTerminalMcpClient, handleTerminalJsonRpc, runTerminalStdio } from '../scripts/ziwei-terminal-mcp.mjs';
import { terminalMcpReceipt, terminalMcpExecutionFailure, executeRuntime, resetRuntimeDiscovery } from '../src/runtime-adapters.mjs';
import { createRepository } from '../backend/repository.mjs';
import { ActionDispatcher } from '../src/daemon.mjs';

const summary = '已截图并打开搜索页；输入没有取得验证回执，没有发送消息或发布商品。';
const request = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-phone-outcomes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scope = { token: 'private-fixture-phone-capability', workspace: 'phone_ai', employeeId: 'employee_phone', deviceId: 'android_phone', actionId: 'action_phone', expiresAt: new Date(Date.now() + 60_000).toISOString(), baseUrl: 'https://fixture.invalid/terminal-mcp/v1/workspaces/phone_ai/employees/employee_phone' };
  const tokenFile = path.join(root, 'capability.json');
  fs.writeFileSync(tokenFile, JSON.stringify(scope), { mode: 0o600 });
  return { root, scope, tokenFile, auditFile: path.join(root, 'audit.jsonl') };
}
async function audit(t, messages, call) {
  const f = fixture(t), input = new PassThrough(), output = new PassThrough(); output.resume();
  input.end([{ jsonrpc: '2.0', id: 0, method: 'initialize' }, ...messages].map(JSON.stringify).join('\n') + '\n');
  await runTerminalStdio({ client: { call }, input, output, auditFile: f.auditFile });
  return { ...f, receipt: terminalMcpReceipt({ runtime: 'Hermes', auditFile: f.auditFile }) };
}

test('HTTP success distinguishes uncertain phone effects and declared not-started failures', async () => {
  for (const [status, executionState] of [['uncertain', 'uncertain'], ['failed', 'not_started']]) {
    const response = await handleTerminalJsonRpc(request('ziwei_phone_action', { deviceId: 'android_phone', action: 'text', args: { text: '刘娜娜688' } }), { call: async () => ({ command: { id: 'command_text', status, executing_confirmed: 1, error: '输入框拒绝文本', result: { executionState, errorCode: 'TEXT_REJECTED' } } }) });
    assert.equal(response.result.isError, false, 'the API request succeeded; the phone action has its own outcome');
    assert.equal(response.result.structuredContent.phoneExecution.state, executionState);
    assert.equal(response.result.structuredContent.phoneExecution.errorCode, 'TEXT_REJECTED');
    assert.equal(response.result.structuredContent.phoneExecution.executingConfirmed, true, 'an executing ACK cannot override explicit not-started evidence');
    assert.match(response.result.content[0].text, /输入框拒绝文本/);
  }
});

test('original cause and execution evidence survive submit, wait audit and runtime aggregation without action bodies', async t => {
  const f = await audit(t, [request('ziwei_phone_action', { action: 'text', args: { text: 'private-business-text' } }), request('ziwei_phone_wait')], async name => name === 'ziwei_phone_action'
    ? { command: { id: 'command_text', status: 'queued' } }
    : { id: 'android_phone', commands: [{ id: 'command_text', status: 'failed', executing_confirmed: 1, error: '请先聚焦可编辑输入框 token=private-secret', result: { executionState: 'not_started', errorCode: 'TEXT_INPUT_NOT_FOUND', rawText: 'private-business-text', data: 'private-image-bytes' } }] });
  const entry = f.receipt.toolCalls.at(-1).receipts[0];
  assert.equal(entry.executionState, 'not_started'); assert.equal(entry.executingConfirmed, true); assert.equal(entry.errorCode, 'TEXT_INPUT_NOT_FOUND');
  const failure = terminalMcpExecutionFailure(f.receipt);
  assert.equal(failure.phoneExecutionState, 'not_started'); assert.equal(failure.retryAllowed, false);
  assert.match(failure.error, /command_text: 未执行，请先聚焦可编辑输入框/);
  assert.doesNotMatch(fs.readFileSync(f.auditFile, 'utf8') + JSON.stringify(f.receipt), /private-business-text|private-image-bytes|private-secret/);
});

test('a confirmed failed command cannot hide another uncertain command', () => {
  const failure = terminalMcpExecutionFailure({ runtime: 'Codex', loaded: true, toolCalls: [
    { toolName: 'ziwei_phone_action', ok: true, commandId: 'command_failed', status: 'failed', commandExecutionState: 'not_started', commandError: '请先聚焦可编辑输入框' },
    { toolName: 'ziwei_phone_action', ok: true, commandId: 'command_unknown', status: 'uncertain', commandError: '文本已提交但读回未确认' },
  ] });
  assert.equal(failure.code, 'terminal_mcp_receipt_incomplete'); assert.equal(failure.phoneExecutionState, 'uncertain');
  assert.deepEqual(failure.commandIds, ['command_failed', 'command_unknown']);
  assert.match(failure.error, /请先聚焦可编辑输入框/); assert.match(failure.error, /文本已提交但读回未确认/);
  assert.match(failure.error, /不要重放动作/);
});

test('a later success on the original command resolves its earlier uncertainty', () => {
  assert.equal(terminalMcpExecutionFailure({ runtime: 'Hermes', loaded: true, toolCalls: [
    { toolName: 'ziwei_phone_action', ok: true, commandId: 'command_text', status: 'uncertain', commandExecutionState: 'uncertain' },
    { toolName: 'ziwei_phone_receipt', ok: true, commandId: 'command_text', status: 'succeeded', commandExecutionState: 'succeeded' },
  ] }), null);
});

test('a lost action response with no command ID remains uncertain and is never resubmitted', async t => {
  const f = fixture(t); let calls = 0;
  const client = createTerminalMcpClient({ tokenFile: f.tokenFile, fetchImpl: async () => { calls++; throw new Error('offline'); } });
  const recorded = await audit(t, [request('ziwei_phone_action', { deviceId: f.scope.deviceId, action: 'tap', args: {} })], (...args) => client.call(...args));
  assert.equal(calls, 1);
  const failure = terminalMcpExecutionFailure(recorded.receipt);
  assert.equal(failure.phoneExecutionState, 'uncertain'); assert.match(failure.error, /连接中断或超时/);
});

test('pre-request action rejection and read-only transport errors do not imply phone effects', async t => {
  const f = fixture(t); let calls = 0;
  const client = createTerminalMcpClient({ tokenFile: f.tokenFile, fetchImpl: async () => { calls++; throw new Error('offline'); } });
  const rejected = await audit(t, [request('ziwei_phone_action', { deviceId: 'foreign-phone', action: 'tap' })], (...args) => client.call(...args));
  assert.equal(calls, 0); assert.equal(terminalMcpExecutionFailure(rejected.receipt).phoneExecutionState, 'not_started');
  const readOnly = await audit(t, [request('ziwei_phone_status', { deviceId: f.scope.deviceId })], (...args) => client.call(...args));
  assert.equal(calls, 1); assert.equal(terminalMcpExecutionFailure(readOnly.receipt).code, 'terminal_mcp_tools_failed');
});

for (const [state, label] of [['uncertain', '执行结果待核实'], ['not_started', '手机动作未执行'], ['failed', '执行失败']]) test(`chat preserves detailed employee summary and readable error for ${state}`, () => {
  const repo = createRepository({ memory: true }), conversation = repo.createConversation('test-111', { title: '手机回执' });
  const submitted = repo.addConversationMessage(conversation.id, { role: 'user', content: '检查手机', runtime: 'Codex' });
  const result = { output: summary, terminalMcp: { executionState: state }, ...(state === 'uncertain' ? { executionState: state } : {}) };
  repo.resultA2AAction(submitted.execution.id, { status: 'failed', error: '输入框拒绝文本', result });
  const content = repo.getConversation(conversation.id).messages.at(-1).content;
  assert.match(content, new RegExp('^' + label)); assert.ok(content.includes(summary)); assert.match(content, /输入框拒绝文本/);
  assert.equal(repo.getA2AAction(submitted.execution.id).status, 'failed', 'A2A wire protocol remains compatible');
});

test('task failure keeps the employee summary as well as receipt details', () => {
  const repo = createRepository({ memory: true }), task = repo.createTask('test-111', { title: '手机检查', runtime: 'Codex', execute: true });
  const action = repo.listA2AActions('test-111', { status: 'pending' }).find(row => row.task_id === task.id);
  repo.resultA2AAction(action.id, { status: 'failed', error: '结果待核实', result: { executionState: 'uncertain', output: summary } });
  const content = repo.getTaskMessages(task.id).at(-1).content;
  assert.match(content, /执行结果待核实/); assert.ok(content.includes(summary)); assert.equal(repo.getTask(task.id).state, 'blocked');
});

for (const state of ['uncertain', 'not_started', 'failed']) test(`automation cannot replay the whole phone workflow after ${state}`, () => {
  const repo = createRepository({ memory: true }), automation = repo.createAutomation('test-111', { name: '手机检查', prompt: '检查手机', maxRetries: 3 });
  const run = repo.runAutomation(automation.id), count = repo.listA2AActions('test-111', { status: 'all' }).length;
  const result = { output: summary, terminalMcp: { executionState: state, failure: { retryAllowed: false } }, ...(state === 'uncertain' ? { executionState: state } : {}) };
  const completed = repo.completeAutomationRun(run.id, { status: 'failed', error: '输入未完成', result });
  assert.equal(completed.status, state === 'uncertain' ? 'uncertain' : 'failed');
  assert.equal(repo.listA2AActions('test-111', { status: 'all' }).length, count);
  assert.throws(() => repo.queueAutomationRetry(run.id), /原回执|原结果|重放/);
});

test('remote phone uncertainty preserves the original summary without quarantining an exited workstation', async t => {
  const f = fixture(t), tree = { platform: 'win32', supervisor: 'windows-job', launched: true, rootPid: 12345, rootConfirmed: true, rootExitCode: 0, treeConfirmed: true, activeProcesses: 0, cancelled: false };
  let calls = 0;
  const dispatcher = new ActionDispatcher({ workspace: f.scope.workspace, deviceId: 'pc_fixture', stateFile: path.join(f.root, 'state.json'), execute: async (_action, context) => {
    calls++; context.onSupervision({ completionEvidence: Promise.resolve(tree), stop: async () => tree });
    return { status: 'failed', code: 'terminal_mcp_receipt_incomplete', phoneExecutionState: 'uncertain', error: '文本已提交但读回未确认', result: { executionState: 'uncertain', output: summary, processExit: tree } };
  } });
  const action = { id: 'action_phone', workspace: f.scope.workspace, type: 'conversation.execute', payload: { runtime: 'Codex', deviceId: 'pc_fixture' } };
  const outcome = await dispatcher.dispatch(action);
  assert.equal(outcome.result.output, summary); assert.equal(outcome.result.executionState, 'uncertain'); assert.equal(outcome.result.processExit.treeConfirmed, true);
  assert.equal(dispatcher.quarantined, false); assert.equal(outcome.executionState, undefined);
  assert.equal((await dispatcher.dispatch(action)).status, 'duplicate'); assert.equal(calls, 1);
});

test('CLI exit zero cannot turn an uncertain phone receipt into success or lose its summary', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t), bin = path.join(f.root, 'bin'), codexHome = path.join(f.root, 'codex');
  fs.mkdirSync(bin); fs.mkdirSync(codexHome); fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fixture-private-only' }));
  const entry = path.join(f.root, 'fixture-cli.cjs');
  fs.writeFileSync(entry, `const fs=require('node:fs');let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.writeFileSync(process.env.ZIWEI_TERMINAL_AUDIT_FILE,[{method:'initialize',ok:true},{method:'tools/call',toolName:'ziwei_phone_action',ok:true,commandId:'command_text',status:process.env.ZIWEI_FIXTURE_PHONE_STATUS || 'uncertain',commandError:'文本已提交但读回未确认'}].map(JSON.stringify).join('\\n'));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(summary)}}}));process.exitCode=Number(process.env.ZIWEI_FIXTURE_CLI_EXIT || 0);});`);
  const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'codex-cli 0.162.0'\n  exit 0\nfi\nexec ${quote(process.execPath)} ${quote(entry)} \"$@\"\n`, { mode: 0o700 });
  const env = { PATH: `${bin}:/usr/bin:/bin`, CODEX_HOME: codexHome, HERMES_HOME: path.join(f.root, 'hermes') }, previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env); t.mock.method(os, 'homedir', () => f.root); resetRuntimeDiscovery();
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } resetRuntimeDiscovery(); });
  for (const [exitCode, phoneStatus] of [[0, 'uncertain'], [7, 'uncertain'], [7, 'succeeded']]) {
  const outcome = await executeRuntime({ runtime: 'Codex', env: { ZIWEI_FIXTURE_CLI_EXIT: String(exitCode), ZIWEI_FIXTURE_PHONE_STATUS: phoneStatus }, prompt: 'isolated fixture', cwd: f.root, terminalMcp: { runtime: 'Codex', config: { enabled: true, tokenFile: f.tokenFile, baseUrl: f.scope.baseUrl }, workspace: f.scope.workspace, request: { enabled: true, workspace: f.scope.workspace, employeeId: f.scope.employeeId, deviceId: f.scope.deviceId }, actionId: f.scope.actionId, auditDirectory: f.root } });
  assert.equal(outcome.status, 'failed'); assert.equal(outcome.code, exitCode === 0 ? 'terminal_mcp_receipt_incomplete' : 'runtime_failed'); assert.equal(outcome.executionState, undefined);
  assert.equal(outcome.result.output, summary); assert.equal(outcome.result.executionState, phoneStatus === 'uncertain' ? 'uncertain' : undefined); assert.equal(outcome.result.terminalMcp.retryAllowed, false);
  assert.equal(outcome.result.processExit.rootExitCode, exitCode); if (phoneStatus === 'uncertain') assert.match(outcome.error, /文本已提交但读回未确认/);
  }
});


test('a later CLI failure cannot replay phone actions that already succeeded', () => {
  const repo = createRepository({ memory: true }), automation = repo.createAutomation('test-111', { name: '手机检查', prompt: '检查手机', maxRetries: 3 });
  const run = repo.runAutomation(automation.id), count = repo.listA2AActions('test-111', { status: 'all' }).length;
  const result = { output: summary, terminalMcp: { retryAllowed: false, toolCalls: [{ toolName: 'ziwei_phone_action', commandId: 'command_done', status: 'succeeded', ok: true }] } };
  const completed = repo.completeAutomationRun(run.id, { status: 'failed', error: 'CLI exited with code 7', result });
  assert.equal(completed.status, 'failed'); assert.equal(repo.listA2AActions('test-111', { status: 'all' }).length, count);
});
