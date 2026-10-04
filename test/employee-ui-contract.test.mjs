import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const app = fs.readFileSync(new URL('../frontend/src/App.vue', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

test('digital employee configuration UI is wired to real API contracts', () => {
  for (const label of ['环境变量', '自定义参数', 'MCP 管理入口', '本机 ziwei_user 提供']) assert.match(app, new RegExp(label));
  assert.match(app, /正在读取数字员工配置/);
  assert.match(app, /saveEmployeeEnvironment/);
  assert.match(app, /saveEmployeeCustomParams/);
  assert.match(app, /refreshEmployeeMcp/);
  assert.doesNotMatch(app, /环境变量由本机 ziwei_user 运行时提供，当前页面不会暴露密钥。/);
  assert.match(api, /employeeEnvironment:/);
  assert.match(api, /employeeCustomParams:/);
  assert.match(api, /employeeMcp:/);
});
