import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import * as runtime from '../src/runtime-adapters.mjs';

function testPython() {
  const native = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe');
  if (fs.existsSync(native)) return native;
  for (const command of ['python3', 'python']) {
    const value = spawnSync(command, ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
    if (value.status === 0 && path.isAbsolute(value.stdout.trim())) return value.stdout.trim();
  }
  return null;
}
function fixture(t) {
  const python = testPython(); if (!python) { t.skip('Isolated native bootstrap regression requires Python'); return null; }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-hermes-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'hermes_cli'); fs.mkdirSync(cli);
  fs.writeFileSync(path.join(cli, '__init__.py'), '');
  fs.writeFileSync(path.join(cli, 'managed_scope.py'), 'import os\nHERMES_MANAGED_DIR=os.environ.get("HERMES_MANAGED_DIR")\n');
  fs.writeFileSync(path.join(cli, 'config.py'), `import json,os\nfrom pathlib import Path\ndef read_raw_config():\n return json.loads((Path(os.environ['HERMES_HOME'])/'config.json').read_text())\ndef load_config():\n raw=read_raw_config(); overlay=json.loads((Path(os.environ['HERMES_MANAGED_DIR'])/'config.json').read_text()); raw.update(overlay); return raw\n`);
  fs.writeFileSync(path.join(cli, 'mcp_startup.py'), `def _has_configured_mcp_servers():\n from hermes_cli.config import read_raw_config\n return bool(read_raw_config().get('mcp_servers'))\ndef start_background_mcp_discovery():\n return _has_configured_mcp_servers()\n`);
  fs.writeFileSync(path.join(cli, 'main.py'), `import sys,os,json\nfrom pathlib import Path\ndef main():\n from hermes_cli import config,mcp_startup\n profile=sys.argv[sys.argv.index('--profile')+1]; home=Path(os.environ['HERMES_HOME']); effective=config.load_config(); gate=mcp_startup.start_background_mcp_discovery()\n assert home.name==profile\n (home/'auth.json.tmp').write_text(json.dumps({'marker':'native-rotated'})); (home/'auth.json.tmp').replace(home/'auth.json')\n print(json.dumps({'gateTriggered':gate,'rawMcpEmpty':not config.read_raw_config().get('mcp_servers'),'home':str(home),'profile':profile,'managementVisible':bool(effective['mcp_servers'].get('ziwei_management')),'phoneDisabled':effective['mcp_servers']['ziwei-terminal']['enabled'] is False,'policyPreserved':effective['security']['redact_secrets'],'externalModelCalls':0}))\n return 0\n`);
  const launcher = path.join(directory, 'hermes');
  fs.writeFileSync(launcher, `#!"${python}"\nfrom hermes_cli.main import main\nif __name__ == '__main__':\n main()\n`);
  const home = path.join(directory, 'profiles', 'selected'); fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), '{"mcp_servers":{}}'); fs.writeFileSync(path.join(home, 'auth.json'), '{"marker":"original"}'); fs.writeFileSync(path.join(home, 'SOUL.md'), 'Original fixture persona');
  const managed = path.join(directory, 'execution'); fs.mkdirSync(managed);
  fs.writeFileSync(path.join(managed, 'config.json'), JSON.stringify({ mcp_servers: { ziwei_management: { command: 'fixture' }, 'ziwei-terminal': { enabled: false } }, security: { redact_secrets: true } }));
  const env = { ...process.env, PYTHONPATH: directory, HERMES_HOME: home, HERMES_MANAGED_DIR: managed };
  return { python, launcher, home, directory, env, args: ['--profile', 'selected', '-z', 'fixture without model', '--toolsets', 'all'] };
}

test('Hermes bootstrap invokes native discovery when raw MCP is empty but execution overlay is configured', t => {
  assert.equal(typeof runtime.hermesMcpSpawnSpec, 'function', 'Native Hermes overlay startup compatibility is missing');
  const f = fixture(t); if (!f) return;
  const before = fs.readFileSync(path.join(f.home, 'config.json'), 'utf8');
  const spec = runtime.hermesMcpSpawnSpec(f.launcher, f.args, { env: f.env });
  assert.equal(spec.command, f.python, 'Only the discovered launcher interpreter may run');
  const output = spawnSync(spec.command, spec.args, { env: f.env, encoding: 'utf8', windowsHide: true });
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.equal(result.gateTriggered, true); assert.equal(result.rawMcpEmpty, true);
  assert.equal(result.home, f.home); assert.equal(result.profile, 'selected');
  assert.equal(result.managementVisible, true); assert.equal(result.phoneDisabled, true); assert.equal(result.policyPreserved, true); assert.equal(result.externalModelCalls, 0);
  assert.equal(fs.readFileSync(path.join(f.home, 'config.json'), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(f.home, 'SOUL.md'), 'utf8'), 'Original fixture persona');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'), 'utf8')).marker, 'native-rotated');
  assert.equal(fs.existsSync(path.join(f.directory, 'execution', 'auth.json')), false);
});

test('Hermes bootstrap refuses missing/unbound interpreters and foreign console entrypoints', t => {
  assert.equal(typeof runtime.hermesMcpSpawnSpec, 'function');
  const f = fixture(t); if (!f) return;
  assert.throws(() => runtime.hermesMcpSpawnSpec(path.join(f.directory, 'missing'), [], { env: f.env }), /Hermes.*解释器|Hermes.*入口/);
  fs.writeFileSync(f.launcher, '#!/usr/bin/env python3\nfrom hermes_cli.main import main\n');
  assert.throws(() => runtime.hermesMcpSpawnSpec(f.launcher, [], { env: f.env }), /解释器|入口/);
  fs.writeFileSync(f.launcher, `#!"${f.python}"\nfrom another_agent.main import main\nmain()\n`);
  assert.throws(() => runtime.hermesMcpSpawnSpec(f.launcher, [], { env: f.env }), /入口/);
});

test('Hermes bootstrap fails clearly when native managed overlay or gate support is unavailable', t => {
  assert.equal(typeof runtime.hermesMcpSpawnSpec, 'function');
  const f = fixture(t); if (!f) return;
  fs.writeFileSync(path.join(f.directory, 'hermes_cli', 'mcp_startup.py'), 'def older_startup():\n pass\n');
  assert.throws(() => runtime.hermesMcpSpawnSpec(f.launcher, f.args, { env: f.env }), /Hermes.*更新|Hermes.*兼容/);
});

test('Hermes bootstrap revalidates native source binding before execution and preserves auth on refusal', t => {
  const f = fixture(t); if (!f) return;
  const spec = runtime.hermesMcpSpawnSpec(f.launcher, f.args, { env: f.env });
  fs.appendFileSync(path.join(f.directory, 'hermes_cli', 'main.py'), '\n# changed-native-binding-private-fixture\n');
  const output = spawnSync(spec.command, spec.args, { env: f.env, encoding: 'utf8', windowsHide: true });
  assert.equal(output.status, 125);
  assert.match(output.stderr, /incompatible or changed/);
  assert.doesNotMatch(output.stdout + output.stderr, /changed-native-binding-private-fixture|original.*marker/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, 'auth.json'), 'utf8')).marker, 'original');
});

test('Hermes bootstrap requires an explicit overlay and safely handles damaged config loaders', t => {
  const f = fixture(t); if (!f) return;
  const spec = runtime.hermesMcpSpawnSpec(f.launcher, f.args, { env: f.env });
  const missing = { ...f.env }; delete missing.HERMES_MANAGED_DIR;
  const absent = spawnSync(spec.command, spec.args, { env: missing, cwd: f.directory, encoding: 'utf8', windowsHide: true });
  assert.equal(absent.status, 125);
  assert.doesNotMatch(absent.stderr, /Traceback|KeyError|fixture without model/);
  fs.writeFileSync(path.join(f.directory, 'hermes_cli', 'config.py'), `def read_raw_config():\n return {}\ndef load_config():\n raise RuntimeError('private-config-fixture-never-output')\n`);
  const main = path.join(f.directory, 'hermes_cli', 'main.py');
  fs.writeFileSync(main, fs.readFileSync(main, 'utf8').replace('effective=config.load_config(); gate=mcp_startup.start_background_mcp_discovery()', 'gate=mcp_startup.start_background_mcp_discovery(); effective=config.load_config()'));
  const updated = runtime.hermesMcpSpawnSpec(f.launcher, f.args, { env: f.env });
  const damaged = spawnSync(updated.command, updated.args, { env: f.env, encoding: 'utf8', windowsHide: true });
  assert.equal(damaged.status, 125);
  assert.doesNotMatch(damaged.stdout + damaged.stderr, /Traceback|private-config-fixture-never-output/);
});
