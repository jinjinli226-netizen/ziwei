import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const helper = fileURLToPath(new URL('./runtime-process.ps1', import.meta.url));
const START_TIMEOUT_MS = 30000;
const STOP_TIMEOUT_MS = 15000;
const baseEvidence = () => ({ platform: process.platform, supervisor: process.platform === 'win32' ? 'windows-job' : 'direct', launched: null, rootPid: null, rootConfirmed: false, rootExitCode: null, treeConfirmed: false, activeProcesses: null, cancelled: false, failureCode: null, hostExitCode: null });

function nativeCommand(command, cwd, env) {
  if (typeof command !== 'string' || !command || command.includes('\0')) throw new TypeError('Runtime command must be a nonempty executable path');
  if (path.isAbsolute(command) || /[\\/]/.test(command)) return path.resolve(cwd, command);
  const environmentPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const directory of String(environmentPath).split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of path.extname(command) ? [''] : ['', '.exe', '.com']) {
      const candidate = path.resolve(directory.replace(/^"|"$/g, ''), command + extension);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return path.resolve(cwd, command);
}

/** Spawn one owned runtime. Windows evidence refers to its Job, never a PID search. */
export function spawnSupervisedRuntime({ command, args = [], cwd = process.cwd(), env = process.env } = {}) {
  cwd = path.resolve(cwd);
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || value.includes('\0'))) throw new TypeError('Runtime arguments must be strings without NUL');
  if (!env || typeof env !== 'object') throw new TypeError('Runtime environment must be an object');
  if (process.platform !== 'win32') {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const evidence = baseEvidence();
    let stopPromise;
    const completionEvidence = new Promise(resolve => {
      child.once('spawn', () => { evidence.launched = true; evidence.rootPid = child.pid; });
      child.once('error', error => { evidence.failureCode = error.code || 'RUNTIME_SPAWN_FAILED'; if (evidence.launched === null) evidence.launched = false; });
      child.once('close', (code, signal) => resolve(Object.freeze({ ...evidence, rootConfirmed: evidence.launched === true, rootExitCode: code, signal: signal || null })));
    });
    const stop = () => {
      if (!stopPromise) { evidence.cancelled = true; if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); stopPromise = completionEvidence; }
      return stopPromise;
    };
    return { child, stop, completionEvidence };
  }

  const executable = nativeCommand(command, cwd, env);
  const environment = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  for (const [key, value] of Object.entries(environment)) if (!key || key.includes('=') || key.includes('\0') || value.includes('\0')) throw new TypeError('Invalid runtime environment entry');
  const nonce = randomUUID();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-runtime-'));
  const startPath = path.join(directory, 'started.json');
  const resultPath = path.join(directory, 'result.json');
  const cancelPath = path.join(directory, 'cancel');
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = undefined;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  let evidence = baseEvidence(), settled = false, startSeen = false, stopPromise, stopTimer, startupTimer, poller;
  let resolveCompletion;
  const completionEvidence = new Promise(resolve => { resolveCompletion = resolve; });
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const host = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', helper, '-Nonce', nonce, '-ReceiptDirectory', directory], { cwd, env: process.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  child.supervisorPid = host.pid;
  // The first frame stays in the pipe; secrets in env and stdin are never written to disk.
  host.stdin.on('error', () => {});
  child.stdin.on('error', () => {});
  host.stdout.pipe(child.stdout);
  host.stderr.pipe(child.stderr);
  host.stdin.write(JSON.stringify({ command: executable, args, cwd, env: environment, parentPid: process.pid }) + '\n');
  child.stdin.pipe(host.stdin);

  function readReceipt(file) {
    try {
      if (fs.statSync(file).size > 16384) return null;
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value.schema !== 1 || value.nonce !== nonce || value.jobName !== `Local\\Ziwei.Runtime.${nonce}` || value.hostPid !== host.pid) return null;
      return value;
    } catch { return null; }
  }
  function observeStart() {
    const value = readReceipt(startPath);
    if (!startSeen && value?.launched === true && Number.isSafeInteger(value.rootPid) && value.rootPid > 0) {
      startSeen = true; clearTimeout(startupTimer);
      child.pid = value.rootPid;
      evidence = { ...evidence, launched: true, rootPid: value.rootPid };
      child.emit('spawn');
    }
  }
  function finish(hostCode, hostSignal, failure = null) {
    if (settled) return;
    settled = true;
    observeStart();
    clearInterval(poller); clearTimeout(startupTimer); clearTimeout(stopTimer);
    const receipt = readReceipt(resultPath);
    if (receipt && typeof receipt.launched === 'boolean' && typeof receipt.rootConfirmed === 'boolean' && typeof receipt.treeConfirmed === 'boolean' && (receipt.rootExitCode === null || Number.isSafeInteger(receipt.rootExitCode)) && (receipt.activeProcesses === null || Number.isSafeInteger(receipt.activeProcesses))) {
      evidence = { ...evidence, launched: receipt.launched, rootPid: receipt.rootPid, rootConfirmed: receipt.rootConfirmed, rootExitCode: receipt.rootExitCode, treeConfirmed: receipt.treeConfirmed && receipt.activeProcesses === 0, activeProcesses: receipt.activeProcesses, cancelled: evidence.cancelled || receipt.cancelled, failureCode: receipt.failureCode || null, streamsComplete: receipt.streamsComplete === true };
    } else evidence.failureCode = failure || evidence.failureCode || 'RUNTIME_SUPERVISOR_UNCONFIRMED';
    evidence.hostExitCode = hostCode;
    evidence.hostSignal = hostSignal || null;
    child.stdin.unpipe(host.stdin);
    child.stdin.destroy();
    child.exitCode = evidence.rootExitCode;
    child.signalCode = evidence.cancelled ? 'SIGTERM' : null;
    if (evidence.failureCode) {
      const error = new Error(`Runtime supervision failed: ${evidence.failureCode}`);
      error.code = evidence.failureCode;
      child.emit('error', error);
    }
    child.emit('exit', child.exitCode, child.signalCode);
    child.emit('close', child.exitCode, child.signalCode);
    const final = Object.freeze({ ...evidence });
    resolveCompletion(final);
    // The directory has no prompt, env, or output. Keep unknown evidence for diagnosis.
    if (receipt && !evidence.failureCode) try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  }
  host.once('error', error => {
    // Node gives no PID when the OS never created the supervisor. Only that
    // case proves no CLI tree exists; errors after host creation stay unknown.
    if (!Number.isSafeInteger(host.pid) || host.pid <= 0) evidence = { ...evidence, launched: false, treeConfirmed: true, activeProcesses: 0 };
    finish(null, null, error.code || 'RUNTIME_SUPERVISOR_SPAWN_FAILED');
  });
  host.once('close', (code, signal) => finish(code, signal));
  poller = setInterval(observeStart, 30);
  startupTimer = setTimeout(() => { evidence.failureCode = 'RUNTIME_SUPERVISOR_START_TIMEOUT'; host.kill(); }, START_TIMEOUT_MS);
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = completionEvidence;
    if (settled) return stopPromise;
    if (readReceipt(resultPath)) return stopPromise;
    evidence.cancelled = true; child.killed = true;
    try { fs.writeFileSync(cancelPath, nonce, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') { evidence.failureCode = 'RUNTIME_CANCEL_REQUEST_FAILED'; host.kill(); } }
    stopTimer = setTimeout(() => { evidence.failureCode = 'RUNTIME_SUPERVISOR_STOP_UNCONFIRMED'; host.kill(); }, STOP_TIMEOUT_MS);
    return stopPromise;
  };
  child.kill = () => { void stop(); return !settled; };
  return { child, stop, completionEvidence };
}
