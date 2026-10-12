import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const module=await import('./diagnostics.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
test('preview observer preserves abnormal exit, PID, heartbeat and redacted output independently of child',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ziwei-preview-logs-'));
  const log=module.createPreviewLog(directory,'isolated-test');
  const observed=module.observeProcess({name:'isolated-exit',command:process.execPath,args:['-e',"console.log('token=SHOULD_NOT_LOG');setTimeout(()=>process.exit(17),90)"],log,intervalMs:20});
  const result=await observed.done;assert.equal(result.code,17);
  const text=await fs.readFile(log.file,'utf8');const events=text.trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(events.some(row=>row.event==='started'&&row.childPid===observed.child.pid));
  assert.ok(events.some(row=>row.event==='observer_heartbeat'));
  assert.ok(events.some(row=>row.event==='exited'&&row.code===17));
  assert.doesNotMatch(text,/SHOULD_NOT_LOG/);
});
test('forced termination of an isolated child remains in observer logs',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ziwei-preview-force-'));
  const log=module.createPreviewLog(directory,'isolated-force');
  const observed=module.observeProcess({name:'isolated-force',command:process.execPath,args:['-e','setInterval(()=>{},1000)'],log,intervalMs:20});
  await new Promise(resolve=>setTimeout(resolve,70));observed.child.kill('SIGKILL');await observed.done;
  const events=(await fs.readFile(log.file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(events.some(row=>row.event==='exited'&&row.childPid===observed.child.pid));
});
test('structured secrets and split JSON stdout are redacted without corrupting JSONL',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ziwei-preview-redaction-'));
  const log=module.createPreviewLog(directory,'structured');log.write('structured',{password:'PRIVATE_PASSWORD',details:{token:'PRIVATE_TOKEN'}});
  const source="process.stdout.write('{\"token\":\"SPLIT');setTimeout(()=>{process.stdout.write('_VALUE\"}\\n');process.exit(0)},50)";
  const observed=module.observeProcess({name:'structured',command:process.execPath,args:['-e',source],log,intervalMs:20});await observed.done;
  const text=await fs.readFile(log.file,'utf8');assert.doesNotMatch(text,/PRIVATE_PASSWORD|PRIVATE_TOKEN|SPLIT_VALUE/);assert.ok(text.trim().split('\n').every(line=>Boolean(JSON.parse(line))));
});
