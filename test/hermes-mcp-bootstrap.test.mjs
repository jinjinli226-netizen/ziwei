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
  fs.writeFileSync(path.join(managed, 'config.yaml'), '{}');
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

test('ordinary employee bootstrap carries its temporary MCP overlay into native Gateway session creation',t=>{
  const f=fixture(t);if(!f)return;
  const cli=path.join(f.directory,'hermes_cli');
  const servers={ziwei_management:{command:'fixture-node',args:['fixture-management.mjs'],env:{WORKSPACE:'fixture-workspace'}}};
  fs.writeFileSync(path.join(f.env.HERMES_MANAGED_DIR,'config.yaml'),JSON.stringify({mcp_servers:servers}));
  fs.writeFileSync(path.join(f.env.HERMES_MANAGED_DIR,'config.json'),JSON.stringify({mcp_servers:servers}));
  fs.appendFileSync(path.join(cli,'config.py'),`\ndef get_config_path():\n return Path(os.environ['HERMES_HOME'])/'config.yaml'\n`);
  fs.writeFileSync(path.join(cli,'gateway_client.py'),'class GatewayClientError(Exception): pass\n');
  fs.writeFileSync(path.join(cli,'gateway_chat_view.py'),'class GatewayChatView: pass\n');
  fs.writeFileSync(path.join(cli,'gateway_chat.py'),`import contextlib,os\nclass Client:\n async def rpc(self,method,**params):\n  home=os.environ['HERMES_HOME']\n  if method=='runtime.describe':return {'profile_id':home,'authority_epoch':1,'session_create':{'shell_private_mcp_v1':True}}\n  if method in ('session.create','session.resume'):\n   assert params.get('editor',{}).get('mcp_servers',[{}])[0].get('name')=='ziwei_management','EXECUTION_MCP_LOST_AT_GATEWAY'\n   return {'stored_session_id':'ordinary-session','authority_epoch':1,'info':{'profile_id':home}}\n  raise AssertionError(method)\n@contextlib.asynccontextmanager\nasync def connect_gateway():yield Client()\nasync def run_gateway_chat(args):\n async with connect_gateway() as client:\n  await client.rpc('runtime.describe')\n  result=await client.rpc('session.create',source='oneshot',client_env={})\n  return {'privateMcpAtGateway':True,'sessionId':result['stored_session_id'],'externalModelCalls':0}\n`);
  fs.writeFileSync(path.join(cli,'main.py'),`import argparse,asyncio,json\ndef main():\n from hermes_cli.gateway_chat import run_gateway_chat\n print(json.dumps(asyncio.run(run_gateway_chat(argparse.Namespace(resume=None)))))\n return 0\n`);
  const spec=runtime.hermesMcpSpawnSpec(f.launcher,f.args,{env:f.env});
  const output=spawnSync(spec.command,spec.args,{env:f.env,encoding:'utf8',windowsHide:true});
  assert.equal(output.status,0,output.stderr);
  assert.deepEqual(JSON.parse(output.stdout),{privateMcpAtGateway:true,sessionId:'ordinary-session',externalModelCalls:0});
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

test('Bot enabled-tool overlay uses its bound native YAML interface without importing PyYAML', t => {
  const f = fixture(t); if (!f) return;
  const yamlFile = path.join(f.directory, 'hermes_yaml.py');
  fs.writeFileSync(yamlFile, `import json,sys\nclass NoLegacyYaml:\n def find_spec(self, fullname, path=None, target=None):\n  if fullname == 'yaml' or fullname.startswith('yaml.'):\n   raise AssertionError('Legacy PyYAML must not be imported')\nsys.meta_path.insert(0, NoLegacyYaml())\ndef safe_load(value):\n return json.loads(value)\ndef safe_dump(value, **kwargs):\n return json.dumps(value)\n`);
  fs.writeFileSync(path.join(f.directory, 'hermes_cli', 'main.py'), `import hermes_yaml\n` + fs.readFileSync(path.join(f.directory, 'hermes_cli', 'main.py'), 'utf8'));
  fs.writeFileSync(path.join(f.env.HERMES_MANAGED_DIR, 'config.yaml'), JSON.stringify({mcp_servers:{ziwei_management:{},'ziwei-terminal':{}}}));
  f.env.ZIWEI_INSTANCE_KIND = 'hermes-bot';
  const spec = runtime.hermesMcpSpawnSpec(f.launcher, f.args, {env:f.env});
  const output = spawnSync(spec.command, spec.args, {env:f.env,encoding:'utf8',windowsHide:true});
  assert.equal(output.status,0,output.stderr);
  const result=JSON.parse(output.stdout);
  assert.equal(result.managementVisible,true);assert.equal(result.phoneDisabled,true);assert.equal(result.gateTriggered,true);
  fs.appendFileSync(yamlFile,'\n# changed-native-yaml\n');
  const changed=spawnSync(spec.command,spec.args,{env:f.env,encoding:'utf8',windowsHide:true});
  assert.equal(changed.status,125);assert.match(changed.stderr,/changed/);
});

test('Hermes bootstrap fails clearly when native managed overlay or gate support is unavailable', t => {
  assert.equal(typeof runtime.hermesMcpSpawnSpec, 'function');
  const f = fixture(t); if (!f) return;
  fs.writeFileSync(path.join(f.directory, 'hermes_cli', 'mcp_startup.py'), 'def older_startup():\n pass\n');
  assert.throws(() => runtime.hermesMcpSpawnSpec(f.launcher, f.args, { env: f.env }), /Hermes.*更新|Hermes.*兼容/);
});

test('existing owned profiles do not require native profile creation helpers removed in Hermes 0.22.5',t=>{
  const f=fixture(t);if(!f)return;
  const profiles=path.join(f.directory,'hermes_cli','profiles.py');
  fs.writeFileSync(profiles,'def get_profile_dir(name):\n return name\ndef profile_exists(name):\n return True\n');
  const authBefore=fs.readFileSync(path.join(f.home,'auth.json'));
  const spec=runtime.hermesMcpSpawnSpec(f.launcher,f.args,{env:{...f.env,ZIWEI_BOT_PROFILE_MODE:'owned_profile'}});
  const binding=JSON.parse(spec.args[spec.args.indexOf('--binding')+1]);
  assert.equal(binding.paths.profiles,fs.realpathSync(profiles));
  assert.deepEqual(fs.readFileSync(path.join(f.home,'auth.json')),authBefore);
  fs.writeFileSync(profiles,'def profile_exists(name):\n return True\n');
  assert.throws(()=>runtime.hermesMcpSpawnSpec(f.launcher,f.args,{env:{...f.env,ZIWEI_BOT_PROFILE_MODE:'owned_profile'}}),/Hermes/);
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
