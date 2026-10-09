import test from 'node:test';
import assert from 'node:assert/strict';
import { listEmployeeTemplates, getEmployeeTemplate, createTemplateEmployeeConfig } from '../backend/employees/creator-template.mjs';
import { toolDefinitions } from '../scripts/ziwei-mcp.mjs';

const templateId = 'ziwei-employee-creator';

test('Creator catalog separates responsibilities, persona, real skills and executable workflow', () => {
  const templates = listEmployeeTemplates();
  assert.equal(templates.length, 1);
  const template = getEmployeeTemplate(templateId);
  assert.equal(template.id, templateId);
  assert.equal(template.version, '1.0.0');
  assert.equal(template.name, '数字员工·Creator');
  assert.deepEqual(template.supportedRuntimes, ['Codex', 'Hermes']);
  assert.ok(template.responsibilities.length >= 3);
  assert.ok(template.description.length > 30);
  assert.ok(template.persona.length > 30);
  assert.ok(template.instructions.length > 500);
  assert.deepEqual(template.skills, []);
  assert.ok(template.workflow.length >= 5);
  assert.ok(template.workflow.every(step => step.id && step.title && step.instructions && Array.isArray(step.tools)));
  assert.equal(getEmployeeTemplate('unknown'), null);
});

test('every Creator workflow tool and example uses an actual management MCP signature', () => {
  const template = getEmployeeTemplate(templateId);
  const actualTools = new Map(toolDefinitions.map(tool => [tool.name, tool.inputSchema]));
  assert.equal(actualTools.size, 21);
  for (const step of template.workflow) {
    for (const name of step.tools) assert.ok(actualTools.has(name), `unknown workflow tool ${name}`);
  }
  for (const example of template.toolExamples) {
    const schema = actualTools.get(example.tool);
    assert.ok(schema, `unknown example tool ${example.tool}`);
    for (const key of Object.keys(example.arguments)) assert.ok(Object.hasOwn(schema.properties, key), `${example.tool} has no ${key}`);
    for (const key of schema.required || []) assert.ok(Object.hasOwn(example.arguments, key), `${example.tool} requires ${key}`);
  }
  const run = template.toolExamples.find(example => example.tool === 'ziwei_create_task');
  assert.equal(run.arguments.execute, true);
  assert.equal(run.arguments.employeeId, '<回读确认的员工ID>');
  assert.ok(template.workflow.some(step => step.tools.includes('ziwei_get_action') && step.tools.includes('ziwei_get_task')));
  assert.ok(template.workflow.some(step => step.tools.includes('ziwei_update_employee')));
  assert.ok(template.workflow.some(step => step.tools.includes('ziwei_create_hermes_profile')));
  const namesInInstructions = template.instructions.match(/ziwei_[a-z_]+/g) || [];
  for (const name of namesInInstructions) assert.ok(actualTools.has(name), `unknown instruction tool ${name}`);
  assert.ok(!namesInInstructions.some(name => name.startsWith('ziwei_trial_phone') || name.startsWith('ziwei_configure_phone')));
});

test('Creator instructions distinguish discussion, authorized writes, retries and verified outcomes', () => {
  const { instructions } = getEmployeeTemplate(templateId);
  for (const boundary of ['可行性', '直接行动', '关键信息', '未请求', '不静默', '同一 idempotencyKey', '相同参数', 'IDEMPOTENCY_CONFLICT', '不支持 idempotencyKey', 'pending', 'acked', 'succeeded', 'loaded', '真实', '手机号', '模板升级']) {
    assert.ok(instructions.includes(boundary), `missing boundary ${boundary}`);
  }
  assert.ok(instructions.includes('不代表业务目标已达成'));
  assert.ok(instructions.includes('不写入人格、岗位指令、文档或日志'));
});

test('new Creator config preserves explicit runtime selection without fabricated environment or owner', () => {
  const config = createTemplateEmployeeConfig(templateId, {
    runtime: 'Codex', targetDeviceId: 'device_actual', modelId: 'model_actual',
    ownerUserId: 'forged-owner', actorRole: 'owner', skills: ['fake-skill'],
    managementMcpEnabled: false, readiness: { ready: true }
  });
  assert.equal(config.name, '数字员工·Creator');
  assert.equal(config.runtime, 'Codex');
  assert.equal(config.targetDeviceId, 'device_actual');
  assert.equal(config.runtimeProfile, null);
  assert.equal(config.modelId, 'model_actual');
  assert.equal(config.visibility, 'personal');
  assert.equal(config.managementMcpEnabled, true);
  assert.equal(config.templateId, templateId);
  assert.equal(config.templateVersion, '1.0.0');
  assert.deepEqual(config.skills, []);
  for (const key of ['ownerUserId', 'actorRole', 'readiness', 'verified', 'workflow', 'toolExamples', 'capabilities', 'phoneMcpEnabled']) assert.ok(!Object.hasOwn(config, key), `unexpected employee field ${key}`);
  assert.ok(!Object.hasOwn(createTemplateEmployeeConfig(templateId, { runtime: 'Codex', targetDeviceId: 'device_actual' }), 'modelId'));
});

test('explicit Hermes default and independent profiles are preserved, never guessed', () => {
  for (const runtimeProfile of ['default', 'ziwei-creator-authorized']) {
    const config = createTemplateEmployeeConfig(templateId, { name: '我的搭建师', runtime: 'Hermes', targetDeviceId: 'device_actual', runtimeProfile, visibility: 'workspace' });
    assert.equal(config.runtime, 'Hermes');
    assert.equal(config.runtimeProfile, runtimeProfile);
    assert.equal(config.visibility, 'workspace');
    assert.equal(config.name, '我的搭建师');
  }
  assert.throws(() => createTemplateEmployeeConfig(templateId, { runtime: 'Hermes', targetDeviceId: 'device_actual' }), error => error.code === 'PROFILE_REQUIRED');
});

test('Creator factory rejects missing selection and unsupported runtimes without fallback', () => {
  const create = options => createTemplateEmployeeConfig(templateId, options);
  assert.throws(() => create({ targetDeviceId: 'device_actual' }), error => error.code === 'RUNTIME_REQUIRED');
  assert.throws(() => create({ runtime: 'Claude Code', targetDeviceId: 'device_actual' }), error => error.code === 'TEMPLATE_RUNTIME_UNSUPPORTED');
  assert.throws(() => create({ runtime: 'Codex' }), error => error.code === 'DEVICE_REQUIRED');
  assert.throws(() => create({ runtime: 'Codex', targetDeviceId: 'device\nsecret' }), error => error.code === 'DEVICE_INVALID');
  assert.throws(() => create({ runtime: 'Hermes', targetDeviceId: 'device_actual', runtimeProfile: '../main' }), error => error.code === 'PROFILE_INVALID');
  assert.throws(() => create({ runtime: 'Codex', targetDeviceId: 'device_actual', name: ' ' }), error => error.code === 'NAME_INVALID');
  assert.throws(() => create({ runtime: 'Codex', targetDeviceId: 'device_actual', visibility: 'public' }), error => error.code === 'VISIBILITY_INVALID');
  assert.throws(() => createTemplateEmployeeConfig('unknown', { runtime: 'Codex', targetDeviceId: 'device_actual' }), error => error.code === 'EMPLOYEE_TEMPLATE_NOT_FOUND');
});

test('catalog reads and later template creations cannot overwrite or mutate existing instances', () => {
  const config = createTemplateEmployeeConfig(templateId, { runtime: 'Codex', targetDeviceId: 'device_actual' });
  const existing = { ...config, name: '用户修改的员工', persona: '用户自定义人格', instructions: '用户自定义指令', skills: ['actual-skill'], templateVersion: '0.9.0' };
  const snapshot = structuredClone(existing);
  const template = getEmployeeTemplate(templateId);
  template.name = 'external mutation';
  template.skills.push('fake-skill');
  template.workflow[0].tools.push('fake_tool');
  listEmployeeTemplates()[0].supportedRuntimes.push('fake-runtime');
  const next = createTemplateEmployeeConfig(templateId, { runtime: 'Codex', targetDeviceId: 'device_other' });
  next.skills.push('external mutation');
  assert.deepEqual(existing, snapshot);
  assert.equal(getEmployeeTemplate(templateId).name, '数字员工·Creator');
  assert.deepEqual(getEmployeeTemplate(templateId).supportedRuntimes, ['Codex', 'Hermes']);
  assert.deepEqual(getEmployeeTemplate(templateId).skills, []);
  assert.deepEqual(config.skills, []);
  assert.ok(!getEmployeeTemplate(templateId).workflow[0].tools.includes('fake_tool'));
});
