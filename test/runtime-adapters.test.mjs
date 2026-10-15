import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatRuntimeFailure, hermesProfileHome, normalizeProxyUrl, parseRuntimeStreamLine, proxyUrlForChild, runtimeInvocation, runtimeSpawnSpec, windowsRuntimeCandidates } from '../src/runtime-adapters.mjs';

test('Codex nested agent messages become the runtime response', () => {
  const state = { output: '', response: '', bytes: 0, truncated: false, lineBuffer: '' };
  const diagnostics = [];
  parseRuntimeStreamLine('2026-10-02T00:00:00Z WARN startup', state, text => diagnostics.push(text));
  parseRuntimeStreamLine(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ZIWEI_PIPELINE_OK' } }), state, text => diagnostics.push(text));
  assert.equal(state.response, 'ZIWEI_PIPELINE_OK');
  assert.equal(state.output.includes('ZIWEI_PIPELINE_OK'), true);
  assert.equal(diagnostics.length, 2);
});

test('runtime stream reports safe tool stages without exposing the raw command', () => {
  const state = { output: '', response: '', bytes: 0, truncated: false, lineBuffer: '' };
  const stages = [];
  parseRuntimeStreamLine(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'rg --files' } }), state, () => {}, stage => stages.push(stage));
  parseRuntimeStreamLine(JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call' } }), state, () => {}, stage => stages.push(stage));
  assert.deepEqual(stages.map(stage => stage.stage), ['command', 'tool']);
  assert.deepEqual(stages.map(stage => stage.message), ['运行命令', '调用工具']);
  assert.equal(JSON.stringify(stages).includes('rg --files'), false);
});

test('runtime stream exposes a safe activity summary for visible execution progress', () => {
  const state = { output: '', response: '', bytes: 0, truncated: false, lineBuffer: '' };
  const stages = [];
  parseRuntimeStreamLine(JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'rg --files -g token=secret-value' } }), state, () => {}, stage => stages.push(stage));
  parseRuntimeStreamLine(JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', name: 'browser.search', server: 'web' } }), state, () => {}, stage => stages.push(stage));
  assert.equal(stages[0].detail, '命令：rg · 执行中');
  assert.equal(stages[1].detail, '工具：browser.search · 执行中');
  assert.equal(JSON.stringify(stages).includes('secret-value'), false);
  assert.equal(JSON.stringify(stages).includes('rg --files'), false);
});

test('runtime stream exposes only the provider public reasoning summary', () => {
  const state = { output: '', response: '', bytes: 0, truncated: false, lineBuffer: '' };
  const stages = [];
  parseRuntimeStreamLine(JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: '先检查任务状态，再运行验证。 token=secret-value' }]
    }
  }), state, () => {}, stage => stages.push(stage));
  assert.equal(stages[0].stage, 'reasoning');
  assert.equal(stages[0].message, '思考摘要');
  assert.equal(stages[0].detail, '公开推理摘要');
  assert.equal(stages[0].summary, '先检查任务状态，再运行验证。 token=[REDACTED]');
});

test('Codex invocation opts into provider public reasoning summaries', () => {
  const invocation = runtimeInvocation('Codex', { prompt: '检查状态' });
  assert.equal(invocation.args.includes('--ephemeral'), true);
  assert.equal(invocation.args.includes('model_reasoning_summary="auto"'), true);
  assert.equal(invocation.args.includes('model_supports_reasoning_summaries=true'), false);
});

test('Windows Codex discovery includes the current OpenAI app executable outside PATH', () => {
  if (process.platform !== 'win32') return;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-codex-home-'));
  try {
    const versioned = path.join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'current-build');
    fs.mkdirSync(versioned, { recursive: true });
    const executable = path.join(versioned, 'codex.exe');
    fs.writeFileSync(executable, 'test');
    assert.deepEqual(windowsRuntimeCandidates('Codex', { home }), [executable]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Windows Codex wrappers bypass PowerShell when stdin marker is required', () => {
  if (process.platform !== 'win32') return;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-codex-wrapper-'));
  try {
    const binary = path.join(home, 'codex.ps1');
    const entrypoint = path.join(home, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(binary, '# test wrapper');
    fs.writeFileSync(entrypoint, '// test entrypoint');
    const spec = runtimeSpawnSpec(binary, ['exec', '-']);
    assert.equal(spec.command, process.execPath);
    assert.deepEqual(spec.args, [entrypoint, 'exec', '-']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('proxy settings normalize the Windows host:port and protocol-map forms', () => {
  assert.equal(normalizeProxyUrl('127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(normalizeProxyUrl('http=127.0.0.1:7890;https=127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(normalizeProxyUrl('https://proxy.example.test:8443'), 'https://proxy.example.test:8443');
  assert.equal(normalizeProxyUrl('DIRECT'), null);
});

test('explicit proxy environment wins over machine discovery', () => {
  assert.equal(proxyUrlForChild({ HTTPS_PROXY: 'http://127.0.0.1:9988' }), 'http://127.0.0.1:9988');
});

test('Hermes profile home is isolated beneath the configured Hermes home', () => {
  assert.equal(hermesProfileHome('default', { baseHome: 'C:\\hermes' }), 'C:\\hermes');
  assert.equal(hermesProfileHome('ziwei-aigc', { baseHome: 'C:\\hermes' }), 'C:\\hermes\\profiles\\ziwei-aigc');
  assert.throws(() => hermesProfileHome('../outside', { baseHome: 'C:\\hermes' }), /profile 名称无效/);
});

test('runtime failures preserve a safe actionable CLI diagnostic', () => {
  const message = formatRuntimeFailure('Hermes', 1, "Profile 'test333' is not connected to any AI provider yet.\nOPENROUTER_API_KEY=secret-value");
  assert.match(message, /Hermes CLI exited with code 1: Profile 'test333' is not connected/);
  assert.doesNotMatch(message, /secret-value/);
});

test('Hermes failure skips session resume notices and selects the bootstrap rejection', () => {
  const message = formatRuntimeFailure('Hermes', 125, [
    '\u001b[32mResumed session: xiangyu-main\u001b[0m',
    'Preparing local runtime',
    'Hermes Bot bootstrap rejected: bot source authentication refresh required',
    'session_id: native-session-123'
  ].join('\n'));
  assert.equal(message, 'Hermes CLI exited with code 125: Hermes Bot bootstrap rejected: bot source authentication refresh required');
  assert.equal(formatRuntimeFailure('Hermes', 125, 'Resumed session: xiangyu-main\n'), 'Hermes CLI exited with code 125');
  assert.equal(formatRuntimeFailure('Hermes', 125, '↻ Resumed session xiangyu-main\nsession_id: native-session-123'), 'Hermes CLI exited with code 125');
});

test('explicit bootstrap or provider rejection outranks assistant Error examples', () => {
  for (const rejection of [
    'Hermes Bot bootstrap rejected: bot source authentication refresh required',
    "Profile 'test333' is not connected to any AI provider yet.",
    'Provider error: authentication rejected'
  ]) {
    const state = { output: '', response: '', bytes: 0, truncated: false };
    parseRuntimeStreamLine('↻ Resumed session xiangyu-main', state);
    parseRuntimeStreamLine(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Error: example quoted by assistant\nValueError: another example' } }), state);
    assert.equal(state.runtimeError, undefined);
    parseRuntimeStreamLine(rejection, state);
    parseRuntimeStreamLine('session_id: native-session-123', state);
    assert.equal(formatRuntimeFailure('Hermes', 125, state.output, state.runtimeError), `Hermes CLI exited with code 125: ${rejection}`);
  }
});

test('known bootstrap and provider failures outrank ordinary startup diagnostics', () => {
  for (const detail of [
    'Hermes native multi-image input rejected: invalid input',
    'Hermes Creator isolation was not confirmed',
    'Hermes native MCP bootstrap is incompatible or changed',
    "Profile 'test333' is not connected to any AI provider yet.",
    'litellm.AuthenticationError: provider rejected credentials',
    'Provider error: service unavailable'
  ]) {
    assert.equal(formatRuntimeFailure('Hermes', 1, `Starting runtime\n${detail}\nsession_id: ignored`), `Hermes CLI exited with code 1: ${detail}`);
  }
});

test('structured runtime failures outrank text and do not stringify error objects', () => {
  for (const event of [
    { type: 'result', text: 'Partial assistant output', error: 'Provider rejected request token=secret-value' },
    { type: 'turn.failed', error: { message: 'Provider rejected request token=secret-value' } },
    { type: 'error', message: 'Provider rejected request token=secret-value' }
  ]) {
    const state = { output: '', response: '', bytes: 0, truncated: false };
    parseRuntimeStreamLine(JSON.stringify(event), state);
    assert.match(state.output, /\[error\] Provider rejected request token=\[REDACTED\]/);
    assert.doesNotMatch(state.output, /secret-value|\[object Object\]/);
    assert.equal(formatRuntimeFailure('Hermes', 1, state.output, state.runtimeError), 'Hermes CLI exited with code 1: Provider rejected request token=[REDACTED]');
    if (event.text) {
      assert.equal(state.response, event.text);
      assert.match(state.output, /Partial assistant output\n\[error\]/);
    }
    assert.equal(formatRuntimeFailure('Hermes', 1, `Resumed session: test\n${JSON.stringify(event)}\nsession_id: ignored`), 'Hermes CLI exited with code 1: Provider rejected request token=[REDACTED]');
  }
});

test('a single tool error does not replace the actual runtime failure', () => {
  const state = { output: '', response: '', bytes: 0, truncated: false };
  parseRuntimeStreamLine(JSON.stringify({ type: 'tool_result', is_error: true, text: 'recoverable tool failure' }), state);
  assert.equal(state.runtimeError, undefined);
  parseRuntimeStreamLine(JSON.stringify({ type: 'result', text: 'Partial answer', error: 'Provider error: final request failed' }), state);
  assert.equal(formatRuntimeFailure('Hermes', 1, state.output, state.runtimeError), 'Hermes CLI exited with code 1: Provider error: final request failed');
});

test('terminal runtime errors override recoverable errors and resist later nonterminal noise', () => {
  for (const terminal of [
    { type: 'result', text: 'Partial answer', error: 'Provider error: final request failed' },
    { type: 'turn.failed', error: { message: 'Provider error: final request failed' } }
  ]) {
    const state = { output: '', response: '', bytes: 0, truncated: false };
    parseRuntimeStreamLine(JSON.stringify({ type: 'error', message: 'Reconnecting after a temporary transport error' }), state);
    assert.equal(state.runtimeError, 'Reconnecting after a temporary transport error');
    parseRuntimeStreamLine(JSON.stringify(terminal), state);
    parseRuntimeStreamLine(JSON.stringify({ type: 'error', message: 'Cleanup diagnostic' }), state);
    assert.equal(state.runtimeErrorTerminal, true);
    assert.equal(formatRuntimeFailure('Hermes', 1, state.output, state.runtimeError), 'Hermes CLI exited with code 1: Provider error: final request failed');
  }
});

test('runtime error summary survives output truncation and remains redacted and bounded', () => {
  const state = { output: 'earlier output', response: '', bytes: 4 * 1024 * 1024, truncated: true };
  parseRuntimeStreamLine(JSON.stringify({ type: 'result', text: 'partial', error: { message: `Error: token=secret-value ${'x'.repeat(1000)}` } }), state);
  const message = formatRuntimeFailure('Codex', 1, state.output, state.runtimeError);
  assert.match(message, /^Codex CLI exited with code 1: Error: token=\[REDACTED\]/);
  assert.equal(message.length, 'Codex CLI exited with code 1: '.length + 600);
  assert.doesNotMatch(message, /secret-value/);
});

test('other runtime diagnostics retain the first meaningful line rather than the last line', () => {
  assert.equal(formatRuntimeFailure('Gemini', 1, 'First useful diagnostic\nordinary final output'), 'Gemini CLI exited with code 1: First useful diagnostic');
});
