import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSupervisedRuntime } from '../src/runtime-process.mjs';

// Exercise the actual Windows receipt reader without creating an OS process.
test('Windows receipt reader retains only explicit, consistent background handoff evidence', async t => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalSpawn = childProcess.spawn;
  const directories = [];
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  });
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  let host, directory, nonce;
  childProcess.spawn = (_command, args) => {
    directory = args[args.indexOf('-ReceiptDirectory') + 1];
    nonce = args[args.indexOf('-Nonce') + 1];
    directories.push(directory);
    host = Object.assign(new EventEmitter(), {
      pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill() { assert.fail('receipt fixture must complete without a supervisor kill'); },
    });
    return host;
  };
  syncBuiltinESMExports();
  const cases = [
    { name: 'successful root with retained background', expected: true },
    { name: 'ordinary nonzero CLI exit with retained background', patch: { rootExitCode: 23 }, expected: true },
    { name: 'legacy receipt does not infer retention', patch: { backgroundProcessesRetained: undefined } },
    { name: 'explicit false remains false', patch: { backgroundProcessesRetained: false } },
    { name: 'string marker is not evidence', patch: { backgroundProcessesRetained: 'true' } },
    { name: 'cancelled receipt', patch: { cancelled: true } },
    { name: 'local cancellation already requested', stop: true },
    { name: 'supervisor failure', patch: { failureCode: 'RUNTIME_RELEASE_COMPLETED_JOB_5' } },
    { name: 'root not confirmed', patch: { rootConfirmed: false } },
    { name: 'root PID absent', patch: { rootPid: null } },
    { name: 'root PID invalid', patch: { rootPid: 0 } },
    { name: 'missing failure field', patch: { failureCode: undefined } },
    { name: 'root exit code absent', patch: { rootExitCode: null } },
    { name: 'runtime did not launch', patch: { launched: false } },
    { name: 'empty job', patch: { activeProcesses: 0 } },
    { name: 'unknown job accounting', patch: { activeProcesses: null } },
    { name: 'contradictory tree exit', patch: { treeConfirmed: true } },
    { name: 'unknown cancellation', patch: { cancelled: undefined } },
    { name: 'abnormal host exit', hostCode: 121 },
    { name: 'host killed', hostSignal: 'SIGTERM' },
  ];
  for (const item of cases) {
    const runtime = spawnSupervisedRuntime({ command: process.execPath, args: [], env: {} });
    runtime.child.on('error', () => {});
    const receipt = {
      schema: 1, nonce, jobName: `Local\\Ziwei.Runtime.${nonce}`, hostPid: host.pid,
      launched: true, rootPid: 23456, rootConfirmed: true, rootExitCode: 0,
      treeConfirmed: false, activeProcesses: 1, cancelled: false, failureCode: null,
      streamsComplete: true, backgroundProcessesRetained: true, ...item.patch,
    };
    if (item.stop) void runtime.stop();
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(receipt));
    host.emit('close', item.hostCode ?? 0, item.hostSignal ?? null);
    const result = await runtime.completionEvidence;
    assert.equal(result.backgroundProcessesRetained, item.expected === true, item.name);
    assert.equal(result.activeProcesses, receipt.activeProcesses, item.name);
    assert.equal(result.treeConfirmed, receipt.treeConfirmed && receipt.activeProcesses === 0, item.name);
    host.stdin.destroy(); host.stdout.destroy(); host.stderr.destroy();
    runtime.child.stdout.destroy(); runtime.child.stderr.destroy();
  }
});
