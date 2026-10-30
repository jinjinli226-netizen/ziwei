import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {toolDefinitions} from '../vendor/native-schemas.mjs';
const main = await import('../src/main.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const registry = await import('../src/registry.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
async function invoke(args, options={}) {
  assert.equal(typeof main.runCli, 'function', 'CLI must expose an injectable runner');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-contract-'));
  let stdout='', stderr='';
  try {
    const result=await main.runCli(args,{env:{ZIWEI_WORKSPACE_CONFIG_DIR:root},stdout:s=>{stdout+=s;},stderr:s=>{stderr+=s;},readStdin:async()=>'',...options});
    return {...result,stdout,stderr,json:stdout.startsWith('{')?JSON.parse(stdout):null};
  } finally {await fs.rm(root,{recursive:true,force:true});}
}
test('employee capabilities expose three-part get/report commands with both transports',async()=>{
 const get=registry.getOperation('employees.capabilities.get'),report=registry.getOperation('employees.capabilities.report');
 assert.ok(get);assert.ok(report);assert.equal(report.readOnly,false);assert.equal(report.idempotency,'supported');
 assert.match(report.routes.managed.path,/capability-inventory\/reports$/);assert.match(report.routes.native.path,/capability-inventory\/reports$/);
 const help=await invoke(['employees','capabilities','report','--help']);assert.equal(help.exitCode,0);assert.match(help.stdout,/employees capabilities report/);assert.match(help.stdout,/agent_reported/);
});

test('public flags work before and after commands and ordinary output is one v1 envelope', async()=>{
  const a=await invoke(['--json','--contract','v1','capabilities','--profile','test','--non-interactive']);
  assert.equal(a.exitCode,0); assert.equal(a.json.schemaVersion,1); assert.equal(a.json.service,'workspace'); assert.equal(a.json.ok,true);
  assert.match(a.json.requestId,/^[\w-]+$/); assert.equal(a.stdout.trim().split('\n').length,1); assert.equal(a.stderr,'');
  assert.ok(a.json.data.operations.length>=40); assert.equal(a.json.data.authorization.verification,'offline');
});
test('help and version are text, include real docs and do not need credentials',async()=>{
  const h=await invoke(['bots','create','--help']); assert.equal(h.exitCode,0); assert.match(h.stdout,/https:\/\/ziwei.qzelynth.top\/docs/);
  const v=await invoke(['--version']); assert.equal(v.stdout.trim(),'2.0.0');
});
for(const args of [ ['--no-such-flag'],['capabilities','--profile'],['capabilities','--json','--json'],['capabilities','--timeout','99'],['capabilities','--timeout','300001'],['capabilities','--timeout','1.5'],['capabilities','--contract','legacy'],['capabilities','extra'] ]) {
  test(`strict usage rejects ${args.join(' ')}`,async()=>{ const r=await invoke(args); assert.equal(r.exitCode,2);assert.equal(r.json.error.code,'USAGE'); });
}
test('non-interactive missing identity fails immediately without any transport',async()=>{
  let calls=0; const r=await invoke(['employees','list','--non-interactive'],{fetchImpl:async()=>{calls++; throw Error('must not fetch');}});
  assert.equal(r.exitCode,3);assert.equal(calls,0);assert.equal(r.json.error.code,'UNAUTHENTICATED');
});
test('input sources, duplicate fields, unknown fields and unsafe numeric IDs fail before submission',async()=>{
  for(const args of [
    ['tasks','create','--input','{"title":"x"}','--input-stdin'],
    ['tasks','create','--input','{"title":"x"}','--title','other'],
    ['tasks','create','--input','{"title":"x","title":"y"}'],
    ['tasks','create','--input','{"title":"x","unknown":true}'],
    ['employees','get','--input','{"id":9007199254740993}'],
    ['bots','create','--input','{"data":{"config":{"apiKey":"raw-secret"}}}']
  ]) {const r=await invoke(args,{fetchImpl:async()=>assert.fail('input error must precede transport')});assert.equal(r.exitCode,2,args.join(' '));}
});
test('catalog covers all native tools and every Bot operation without cross-site device commands',()=>{
  assert.equal(typeof registry.getCapabilities,'function');
  const c=registry.getCapabilities();
  for(const o of c.operations) for(const field of ['name','inputSchema','readOnly','sideEffects','requiredPermissions','supportsDryRun','idempotency','resultQuery']) assert.ok(Object.hasOwn(o,field),`${o.name}.${field}`);
  assert.deepEqual(new Set(c.operations.map(o=>o.nativeTool)),new Set(toolDefinitions.map(tool=>tool.name)));
  assert.ok(c.operations.some(o=>o.name==='bots.cancelMcpConnection'));
  assert.ok(c.operations.some(o=>o.name==='actions.wait'&&o.readOnly));
  assert.ok(c.operations.find(o=>o.name==='phone-mcp.check').sideEffects.length>0);
  assert.equal(c.operations.find(o=>o.name==='bots.runs').readOnly,true);
  assert.deepEqual(c.operations.find(o=>o.name==='tasks.create').idempotencyByTransport,{managed:'supported',native:'unsupported'});
  assert.equal(c.operations.find(o=>o.name==='tasks.create').idempotency,'unsupported');
  assert.equal(c.operations.find(o=>o.name==='bots.update').idempotency,'unsupported');
  assert.match(c.operations.find(o=>o.name==='bots.update').conditionalIdempotency,/deferUntilIdle/);
  assert.match(c.identity.unified,/implemented/);
});
