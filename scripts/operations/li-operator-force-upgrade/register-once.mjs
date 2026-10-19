// One explicit operator recovery for the already-identified Li daemon generation.
// Run only from its paired Creator action. Default mode validates without a task.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const H = b => crypto.createHash('sha256').update(b).digest('hex');
const need = (ok, code) => { if (!ok) throw Error(code); };
const q = s => "'" + String(s).replaceAll("'", "''") + "'";
const source = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] || '--validate', nonce = process.argv[3];
const p = {
  schemaVersion: 1, acceptanceStage: 'operator-force-tree-upgrade-once',
  authorization: 'operator_exact_daemon_tree_stop_once',
  workspace: 'bigtron', deviceId: 'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493',
  userProfile: 'C:\\Users\\25941',
  userDirectory: 'C:\\Users\\25941\\AppData\\Local\\Ziwei\\ziwei_user',
  configPath: 'C:\\Users\\25941\\AppData\\Local\\Ziwei\\ziwei_user\\ziwei_user.json',
  root: 'D:\\work\\nodejs\\node_global\\node_modules\\ziwei',
  ownerSid: 'S-1-5-21-4019069998-341204304-2024549848-1001',
  nodeExe: 'C:\\Program Files\\nodejs\\node.exe',
  sourcePid: 55824, sourceCreationTime: '2026-10-19T09:09:20.3445030Z',
  sourceBuild: 'e0cfb63ee43c3d837a049b9c4f0c6d1362cab64918f8987b35597b9e549c4c18',
  candidateCommit: 'd62d0d36dab1e03d92b55d8198e9fe6bc7c8f1d4',
  targetBuild: '5d7be8976f785d1ced877293da25cba9dbcc25975456852030d1f110c11c181a',
  archiveSha256: '20a1c9c849e70f14291429bf04bd1da7058e369989d51687eb05303bf705cf53',
  archiveUrl: 'https://qzelynth.top/downloads/cli/ziwei-latest.tgz',
};
const assets = [
  ['register-li-force-upgrade-once.ps1', '0b777a682416b19ae21fac24c679eb267e7843c5ef9191e33707ffb41c46e9e3'],
  ['li-force-upgrade-worker.mjs', '52c8416f0170ab4803e3806a086cf33c9ced6d530cc60ebdd4ce0d247aa248c0'],
];
let stage = 'fixed_scope';
try {
  need(process.platform === 'win32' && ['--validate', '--register'].includes(mode) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(nonce || ''), 'ONCE_ARGUMENTS');
  need(process.env.USERPROFILE?.toLowerCase() === p.userProfile.toLowerCase() && process.execPath.toLowerCase() === p.nodeExe.toLowerCase(), 'ONCE_USER');
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const ps = args => execFileSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  function noLink(file) { for (let cur = path.resolve(file);; cur = path.dirname(cur)) { try { need(!fs.lstatSync(cur).isSymbolicLink(), 'ONCE_PATH_LINK'); } catch (e) { if (e.code !== 'ENOENT') throw e; } if (cur === path.dirname(cur)) break; } }
  function put(file, bytes) { noLink(file); if (fs.existsSync(file)) { need(H(fs.readFileSync(file)) === H(bytes), 'ONCE_STAGING_CHANGED'); return; } fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
  for (const file of [p.root, p.configPath, p.nodeExe, source]) noLink(file);
  const sourceBytes = assets.map(([file, hash]) => { const where = path.join(source, file); noLink(where); const b = fs.readFileSync(where); need(H(b) === hash, 'ONCE_ASSET_CHANGED'); return b; });
  stage = 'live_identity';
  const configBytes = fs.readFileSync(p.configPath), cfg = JSON.parse(configBytes);
  p.configSha256 = H(configBytes);
  need(cfg.workspace === p.workspace && cfg.deviceId === p.deviceId && cfg.healthHost === '127.0.0.1' && cfg.healthPort === 20242 && cfg.apiBase === 'https://qzelynth.top', 'ONCE_CONFIG_SCOPE');
  const r = await fetch('http://127.0.0.1:20242/healthz', { redirect: 'error', signal: AbortSignal.timeout(3000) });
  need(r.ok, 'ONCE_HEALTH'); const h = await r.json();
  need(h.service === 'ziwei_user' && h.workspace === p.workspace && h.deviceId === p.deviceId && h.pid === p.sourcePid && h.clientBuild === p.sourceBuild && h.lifecycle?.root?.toLowerCase() === p.root.toLowerCase() && h.lifecycle?.configPath?.toLowerCase() === p.configPath.toLowerCase() && h.lifecycle?.configSha256 === p.configSha256 && /^[A-Za-z0-9_-]{16,128}$/.test(h.lifecycle?.nonce || ''), 'ONCE_HEALTH_SCOPE');
  p.sourceNonce = h.lifecycle.nonce;
  // Only the Creator branch below the daemon is captured. Never wait for daemon,
  // its ancestors, Task Scheduler, maintenance.safe or historical delivery counts.
  const inspect = `$ErrorActionPreference='Stop';$enc=[Text.UTF8Encoding]::new($false);function H([string]$s){$h=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($h.ComputeHash($enc.GetBytes($s))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}};$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;if($sid -cne ${q(p.ownerSid)}){throw 'scope'};$all=@(Get-CimInstance Win32_Process);$root=@($all|Where-Object ProcessId -eq ${p.sourcePid});if($root.Count -ne 1 -or $root[0].CreationDate.ToUniversalTime().ToString('o') -cne ${q(p.sourceCreationTime)} -or $root[0].ExecutablePath -ine ${q(p.nodeExe)}){throw 'root'};$owner=Invoke-CimMethod -InputObject $root[0] -MethodName GetOwnerSid;if($owner.ReturnValue -ne 0 -or $owner.Sid -cne $sid){throw 'owner'};$current=${process.pid};$seen=@{};$rows=@();while($current -ne ${p.sourcePid}){if($rows.Count -ge 24 -or $seen.ContainsKey($current)){throw 'chain'};$n=@($all|Where-Object ProcessId -eq $current);if($n.Count -ne 1){throw 'chain'};$seen[$current]=$true;$parent=@($all|Where-Object ProcessId -eq $n[0].ParentProcessId);if($parent.Count -ne 1 -or $n[0].CreationDate -lt $parent[0].CreationDate){throw 'generation'};$rows+=@{pid=[int]$current;creationTime=$n[0].CreationDate.ToUniversalTime().ToString('o')};$current=[int]$n[0].ParentProcessId};if($rows.Count -lt 2){throw 'shortchain'};[ordered]@{sourceCommandHash=(H $root[0].CommandLine);creatorAncestors=$rows}|ConvertTo-Json -Depth 4 -Compress`;
  const generation = JSON.parse(ps(['-Command', inspect]));
  need(/^[a-f0-9]{64}$/.test(generation.sourceCommandHash || '') && Array.isArray(generation.creatorAncestors) && generation.creatorAncestors.length >= 2 && generation.creatorAncestors.every(a => Number.isSafeInteger(a.pid) && a.pid > 0 && a.pid !== p.sourcePid && typeof a.creationTime === 'string'), 'ONCE_CREATOR_BRANCH');
  p.sourceCommandHash = generation.sourceCommandHash; p.creatorAncestors = generation.creatorAncestors;
  p.nonce = nonce; p.workerSha256 = assets[1][1];
  p.jobDirectory = path.join(p.userDirectory, 'maintenance', 'operator-force-upgrade-' + nonce);
  const stageDir = path.join(p.userDirectory, 'maintenance', 'operator-force-upgrade-source-' + nonce); noLink(stageDir); noLink(p.jobDirectory);
  need(!fs.existsSync(p.jobDirectory), 'ONCE_JOB_EXISTS');
  fs.mkdirSync(stageDir, { recursive: true, mode: 0o700 });
  const reg = path.join(stageDir, assets[0][0]), worker = path.join(stageDir, assets[1][0]), plan = path.join(stageDir, 'operator-plan.json');
  put(reg, sourceBytes[0]); put(worker, sourceBytes[1]); put(plan, Buffer.from(JSON.stringify(p) + '\n'));
  stage = 'native_syntax';
  ps(['-Command', `$t=$null;$e=$null;$null=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText(${q(reg)}),[ref]$t,[ref]$e);if(@($e).Count){exit 1}`]);
  execFileSync(p.nodeExe, ['--check', worker], { windowsHide: true, stdio: 'ignore' });
  const args = ['-File', reg, '-PlanPath', plan, '-WorkerSourcePath', worker, '-Mode'];
  stage = 'validate'; need(JSON.parse(ps([...args, 'Validate'])).state === 'validated', 'ONCE_VALIDATION_FAILED');
  if (mode === '--validate') { console.log(JSON.stringify({ state: 'validated', sourcePid: p.sourcePid, targetBuild: p.targetBuild, scheduled: false })); }
  else { stage = 'register'; const out = JSON.parse(ps([...args, 'Register'])); need(out.state === 'scheduled', 'ONCE_REGISTER_FAILED'); console.log(JSON.stringify({ state: 'scheduled', task: out.task, targetBuild: p.targetBuild, registerCalls: 1, employeeActionsSubmitted: 0 })); }
} catch (e) {
  let detail = null; try { const row = JSON.parse(String(e.stdout || '').trim()); if (/^BOOTSTRAP_[A-Z0-9_]{1,64}$/.test(row.code || '')) detail = { code: row.code, stage: row.stage }; } catch {}
  console.log(JSON.stringify({ state: 'failed', stage, code: /^[A-Z][A-Z0-9_]{0,63}$/.test(e.message) ? e.message : 'ONCE_EXECUTION_FAILED', detail })); process.exitCode = 1;
}
