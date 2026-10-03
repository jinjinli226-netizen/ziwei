import test from 'node:test';
import assert from 'node:assert/strict';
import { hermesProfileHome, normalizeProxyUrl, parseRuntimeStreamLine, proxyUrlForChild, runtimeInvocation } from '../src/runtime-adapters.mjs';

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
