import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { hermesMcpSpawnSpec, prepareManagementMcpLaunch, prepareTerminalMcpLaunch } from '../src/runtime-adapters.mjs';

const helperUrl = new URL('../src/creator-runtime-home.mjs', import.meta.url);
const nativeRoot = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent');
const python = path.join(nativeRoot, 'venv', 'Scripts', 'python.exe');
const launcher = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'bin', 'hermes.exe');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-creator-home-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceHome = path.join(directory, 'source'); fs.mkdirSync(sourceHome);
  fs.writeFileSync(path.join(sourceHome, 'config.yaml'), 'model:\n  provider: openai-codex\n  default: fixture-model\nmemory:\n  provider: ""\nsecurity:\n  redact_secrets: true\n');
  fs.writeFileSync(path.join(sourceHome, 'SOUL.md'), 'source-persona-must-not-change');
  fs.writeFileSync(path.join(sourceHome, 'auth.json'), '{"active_provider":"openai-codex","fixture":"initial"}');
  const privateDirectory = path.join(directory, 'instances');
  const context = { templateId: 'ziwei-employee-creator', employeeId: 'employee_fixture_a', workspace: 'phone_ai', apiBase: 'https://fixture.invalid', persona: 'Employee A persona', instructions: 'Employee A instructions', description: 'fixture responsibilities' };
  const options = { context, sourceHome, profile: 'default', privateDirectory, workspace: context.workspace, apiBase: context.apiBase };
  return { directory, sourceHome, context, options };
}

test('Creator homes bind origin/workspace/employee and preserve private memory/config during role updates', async t => {
  const { prepareCreatorRuntimeHome } = await import(helperUrl);
  const f = fixture(t); const first = prepareCreatorRuntimeHome(f.options);
  assert.notEqual(first.home, f.sourceHome);
  assert.equal(fs.existsSync(path.join(first.home, 'auth.json')), false);
  assert.equal(fs.existsSync(path.join(first.home, '.env')), false);
  assert.match(fs.readFileSync(path.join(first.home, 'SOUL.md'), 'utf8'), /Employee A persona/);
  fs.mkdirSync(path.join(first.home, 'memories'), { recursive: true });
  fs.writeFileSync(path.join(first.home, 'memories', 'MEMORY.md'), 'private memory A');
  fs.writeFileSync(path.join(first.home, 'state.db'), 'private-state-A');
  fs.appendFileSync(path.join(first.home, 'config.yaml'), 'display:\n  compact: true\n');
  const again = prepareCreatorRuntimeHome({ ...f.options, context: { ...f.context, persona: 'Updated saved persona' } });
  assert.equal(again.home, first.home);
  assert.match(fs.readFileSync(path.join(first.home, 'SOUL.md'), 'utf8'), /Updated saved persona/);
  assert.equal(fs.readFileSync(path.join(first.home, 'memories', 'MEMORY.md'), 'utf8'), 'private memory A');
  assert.equal(fs.readFileSync(path.join(first.home, 'state.db'), 'utf8'), 'private-state-A');
  assert.equal(parseYaml(fs.readFileSync(path.join(first.home, 'config.yaml'), 'utf8')).display.compact, true);
  for (const context of [{ ...f.context, employeeId: 'employee_fixture_b' }, { ...f.context, workspace: 'other' }, { ...f.context, apiBase: 'https://other.invalid' }]) {
    const next = prepareCreatorRuntimeHome({ ...f.options, context, workspace: context.workspace, apiBase: context.apiBase });
    assert.notEqual(next.home, first.home);
    assert.equal(fs.existsSync(path.join(next.home, 'state.db')), false);
  }
  assert.equal(fs.readFileSync(path.join(f.sourceHome, 'SOUL.md'), 'utf8'), 'source-persona-must-not-change');
});

test('Creator isolation refuses invalid scope, unknown provider, remote memory and foreign home bindings', async t => {
  const { prepareCreatorRuntimeHome } = await import(helperUrl); const f = fixture(t);
  assert.equal(prepareCreatorRuntimeHome({ ...f.options, context: undefined }), null);
  assert.equal(prepareCreatorRuntimeHome({ ...f.options, context: { ...f.context, templateId: 'ordinary' } }), null);
  assert.throws(() => prepareCreatorRuntimeHome({ ...f.options, context: { ...f.context, workspace: 'other' } }), /工作区/);
  assert.throws(() => prepareCreatorRuntimeHome({ ...f.options, context: { ...f.context, employeeId: '../outside' } }), /员工/);
  assert.throws(() => prepareCreatorRuntimeHome({ ...f.options, context: { ...f.context, apiBase: 'https://user:private@fixture.invalid' } }), /地址/);
  fs.writeFileSync(path.join(f.sourceHome, 'config.yaml'), 'model:\n  provider: unsupported-private-provider\n');
  assert.throws(() => prepareCreatorRuntimeHome(f.options), error => error.code === 'creator_provider_unsupported' && !error.message.includes('unsupported-private-provider'));
  fs.writeFileSync(path.join(f.sourceHome, 'config.yaml'), 'model:\n  provider: openai-codex\nmemory:\n  provider: remote-private-provider\n');
  assert.throws(() => prepareCreatorRuntimeHome(f.options), error => error.code === 'creator_memory_provider_unsupported' && !error.message.includes('remote-private-provider'));
  fs.writeFileSync(path.join(f.sourceHome, 'config.yaml'), 'model:\n  provider: openai-codex\n  default: fixture-model\n');
  const first = prepareCreatorRuntimeHome(f.options);
  const source2 = path.join(f.directory, 'source2'); fs.mkdirSync(source2); fs.writeFileSync(path.join(source2, 'config.yaml'), 'model:\n  provider: openai-codex\n  default: fixture-model\n');
  assert.throws(() => prepareCreatorRuntimeHome({ ...f.options, sourceHome: source2, profile: 'other' }), /绑定/);
  assert.equal(fs.existsSync(path.join(first.home, 'auth.json')), false);
});

test('Creator config uses a data whitelist and never copies source provider/MCP secrets or auth', async t => {
  const { prepareCreatorRuntimeHome } = await import(helperUrl); const f = fixture(t);
  const original = 'model:\n  provider: openai-codex\n  default: fixture-model\n  api_key: synthetic-model-private-key\ncustom_providers:\n  fixture:\n    api_key: synthetic-custom-private-key\nmcp_servers:\n  other:\n    headers:\n      X-Custom-Auth: synthetic-header-private-key\n    env:\n      API_KEY: synthetic-mcp-private-key\n      CUSTOM_CREDENTIAL: synthetic-arbitrary-private-key\n';
  fs.writeFileSync(path.join(f.sourceHome, 'config.yaml'), original);
  fs.writeFileSync(path.join(f.sourceHome, '.env'), 'OPENAI_API_KEY=synthetic-source-env-private-key\n');
  const home = prepareCreatorRuntimeHome(f.options);
  assert.deepEqual(parseYaml(fs.readFileSync(path.join(home.home, 'config.yaml'), 'utf8')), { model: { provider: 'openai-codex', default: 'fixture-model' }, memory: { provider: '', memory_enabled: true, user_profile_enabled: true } });
  assert.doesNotMatch(JSON.stringify(home.receipt) + fs.readFileSync(path.join(home.home, 'config.yaml'), 'utf8'), /synthetic-.*private-key/);
  assert.equal(fs.readFileSync(path.join(f.sourceHome, 'config.yaml'), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(home.home, 'auth.json')), false); assert.equal(fs.existsSync(path.join(home.home, '.env')), false);
});

test('Creator rejects existing memory/state/session aliases into another home', async t => {
  const { prepareCreatorRuntimeHome } = await import(helperUrl); const f = fixture(t);
  for (const [index, relative] of ['memories', 'state.db', 'sessions', 'SOUL.md'].entries()) {
    const context = { ...f.context, employeeId: `employee_alias_${index}` };
    const options = { ...f.options, context }; const first = prepareCreatorRuntimeHome(options);
    const target = path.join(first.home, relative); const directory = ['memories', 'sessions'].includes(relative);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    const destination = directory ? f.sourceHome : path.join(f.sourceHome, 'SOUL.md');
    try { fs.symlinkSync(destination, target, directory && process.platform === 'win32' ? 'junction' : directory ? 'dir' : 'file'); }
    catch (error) { if (error.code === 'EPERM' && !directory) continue; throw error; }
    assert.throws(() => prepareCreatorRuntimeHome(options), /指向外部路径/);
  }
  assert.equal(fs.readFileSync(path.join(f.sourceHome, 'SOUL.md'), 'utf8'), 'source-persona-must-not-change');
});

test('Creator rejects dangling memory/database links before native writers can create external state', async t => {
  const { prepareCreatorRuntimeHome } = await import(helperUrl); const f = fixture(t);
  for (const [index, relative] of ['state.db', 'memories/MEMORY.md', 'memories/USER.md'].entries()) {
    const options = { ...f.options, context: { ...f.context, employeeId: `employee_dangling_${index}` } };
    const first = prepareCreatorRuntimeHome(options);
    const target = path.join(first.home, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    const destination = path.join(f.sourceHome, `external-${index}-must-not-exist`);
    try { fs.symlinkSync(destination, target, 'file'); }
    catch (error) { if (error.code === 'EPERM' && process.platform === 'win32') fs.symlinkSync(destination, target, 'junction'); else throw error; }
    assert.equal(fs.existsSync(target), false, 'Regression specifically covers dangling aliases');
    assert.throws(() => prepareCreatorRuntimeHome(options), /指向外部路径/);
    assert.equal(fs.existsSync(destination), false);
  }
});

test('Creator inherits current selected profile model each execution without overwriting persisted instance config', async t => {
  const { prepareCreatorRuntimeHome } = await import(helperUrl); const f = fixture(t);
  const first = prepareCreatorRuntimeHome(f.options); const config = fs.readFileSync(path.join(first.home, 'config.yaml'), 'utf8');
  fs.writeFileSync(path.join(f.sourceHome, 'config.yaml'), 'model:\n  provider: openai-codex\n  default: fixture-new-default\n');
  const inherited = prepareCreatorRuntimeHome(f.options); assert.equal(inherited.effectiveModel, 'fixture-new-default');
  assert.equal(fs.readFileSync(path.join(first.home, 'config.yaml'), 'utf8'), config);
  assert.equal(prepareCreatorRuntimeHome({ ...f.options, model: 'explicit-fixture-model' }).effectiveModel, 'explicit-fixture-model');
  fs.writeFileSync(path.join(f.sourceHome, 'config.yaml'), 'model:\n  provider: openai-codex\n');
  assert.throws(() => prepareCreatorRuntimeHome(f.options), /model/);
  const explicit = prepareCreatorRuntimeHome({ ...f.options, model: 'explicit-only-model', context: { ...f.context, employeeId: 'employee_explicit_only' } });
  assert.equal(explicit.effectiveModel, 'explicit-only-model');
  assert.equal(parseYaml(fs.readFileSync(path.join(explicit.home, 'config.yaml'), 'utf8')).model.default, 'explicit-only-model');
});

test('Only trusted Creator context sets native isolation env and disabled phone preparation preserves it', async t => {
  const f = fixture(t); const tokenFile = path.join(f.directory, 'managed.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ token: 'synthetic-local-private-capability', workspaces: ['phone_ai'] }));
  const options = { runtime: 'Hermes', profile: 'default', config: { enabled: true, tokenFile }, workspace: 'phone_ai', apiBase: f.context.apiBase, auditDirectory: f.directory, invocation: { args: [] }, env: { HERMES_HOME: f.sourceHome, ZIWEI_CREATOR_HOME: 'forged-home', ZIWEI_CREATOR_SOURCE_HOME: 'forged-source' } };
  const ordinary = prepareManagementMcpLaunch(options); t.after(ordinary.cleanup);
  assert.equal(ordinary.creatorPrepared, null); assert.equal(ordinary.env.ZIWEI_CREATOR_HOME, undefined);
  const creator = prepareManagementMcpLaunch({ ...options, creatorInstance: f.context, creatorInstanceDirectory: f.options.privateDirectory }); t.after(creator.cleanup);
  assert.notEqual(creator.env.ZIWEI_CREATOR_HOME, 'forged-home');
  assert.equal(creator.invocation.args[creator.invocation.args.indexOf('--model') + 1], 'fixture-model');
  assert.deepEqual(creator.creatorPrepared, { enabled: true, key: creator.env.ZIWEI_CREATOR_KEY, workspace: 'phone_ai', employeeId: f.context.employeeId, sourceProfile: 'default', authMode: 'source-native-store' });
  const phone = prepareTerminalMcpLaunch({ runtime: 'Hermes', profile: 'default', invocation: creator.invocation, env: creator.env, profileBaseHome: f.sourceHome, hermesOverlayHome: creator.overlayHome, workspace: 'phone_ai', request: { enabled: false } });
  assert.equal(phone.env.ZIWEI_CREATOR_HOME, creator.env.ZIWEI_CREATOR_HOME);
  assert.equal(parseYaml(fs.readFileSync(path.join(creator.overlayHome, 'config.yaml'), 'utf8')).mcp_servers['ziwei-terminal'].enabled, false);
  assert.doesNotMatch(JSON.stringify(creator.creatorPrepared) + JSON.stringify(creator.invocation), /synthetic-local-private-capability/);
});

const nativeProbe = String.raw`
import importlib.util,json,os,sys
from pathlib import Path
sys.dont_write_bytecode=True
args=json.loads(sys.argv[1]); helper=args.pop(0)
spec=importlib.util.spec_from_file_location('ziwei_bootstrap',helper); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sys.argv=[helper,*args]; result=module.run(); assert callable(result), 'native main was never called'
from hermes_constants import get_hermes_home
from tools.memory_tool import get_memory_dir
from hermes_state import _default_db_path,SessionDB
from agent.prompt_builder import load_soul_md
from hermes_cli import auth,config
home=get_hermes_home(); memory=get_memory_dir();memory.mkdir(parents=True,exist_ok=True)
(memory/'MEMORY.md').write_text(os.environ['FIXTURE_MEMORY'],encoding='utf-8')
db=SessionDB(); db.close()
auth._save_auth_store({'active_provider':'openai-codex','fixture':'native-rotated'})
print(json.dumps({'home':str(home),'memory':str(memory),'state':str(_default_db_path()),'soul':load_soul_md(),'authPath':str(auth._auth_file_path()),'provider':config.load_config()['model']['provider'],'phoneDisabled':config.load_config()['mcp_servers']['ziwei-terminal']['enabled'] is False,'policyPreserved':config.load_config()['security']['redact_secrets'],'sourceEnvLoaded':os.environ.get('SYNTHETIC_PROVIDER_TOKEN')=='synthetic-fixture-provider-value','legacyPhoneCredentialPresent':'CONTROL_MCP_AUTH' in os.environ,'deviceCredentialPresent':'ZIWEI_DEVICE_TOKEN' in os.environ,'runtimeScopePreserved':os.environ.get('ZIWEI_MCP_WORKSPACE')==os.environ['ZIWEI_CREATOR_WORKSPACE'],'managedDirectoryPreserved':os.environ.get('HERMES_MANAGED_DIR')==os.environ['FIXTURE_MANAGED_DIR'],'pythonPathPreserved':os.environ.get('PYTHONPATH')==os.environ['FIXTURE_PYTHONPATH'],'pythonHomeAbsent':'PYTHONHOME' not in os.environ,'models':0}))
`;

test('Installed Hermes native memory/state/SOUL isolate two Creator instances while auth refresh stays in selected source', async t => {
  if (!fs.existsSync(python) || !fs.existsSync(launcher)) return t.skip('Installed native Hermes is required for the no-model integration fixture');
  const { prepareCreatorRuntimeHome } = await import(helperUrl); const f = fixture(t);
  fs.writeFileSync(path.join(f.sourceHome, '.env'), 'SYNTHETIC_PROVIDER_TOKEN=synthetic-fixture-provider-value\nCONTROL_MCP_AUTH=synthetic-legacy-private-capability\nZIWEI_DEVICE_TOKEN=synthetic-daemon-identity-private\nZIWEI_MCP_WORKSPACE=foreign-source-workspace\nHERMES_MANAGED_DIR=/foreign-source-overlay\nPYTHONPATH=/foreign-source-python\nPYTHONHOME=/foreign-source-pythonhome\n');
  const sourceConfig = fs.readFileSync(path.join(f.sourceHome, 'config.yaml'));
  const managed = path.join(f.directory, 'managed'); fs.mkdirSync(managed);
  fs.writeFileSync(path.join(managed, 'config.yaml'), 'security:\n  redact_secrets: true\nmcp_servers:\n  ziwei_management:\n    enabled: true\n    command: fixture-no-discovery\n  ziwei-terminal:\n    enabled: false\n');
  const outputs = [];
  for (const [index, identity] of [{ name: 'a', workspace: 'phone_ai', profile: 'default' }, { name: 'b', workspace: 'phone_ai', profile: 'default' }, { name: 'a', workspace: 'other', profile: 'selected' }].entries()) {
    const { name, workspace, profile } = identity;
    let sourceHome = f.sourceHome;
    if (profile !== 'default') {
      sourceHome = path.join(f.sourceHome, 'profiles', profile); fs.mkdirSync(sourceHome, { recursive: true });
      fs.copyFileSync(path.join(f.sourceHome, 'config.yaml'), path.join(sourceHome, 'config.yaml'));
      fs.copyFileSync(path.join(f.sourceHome, 'auth.json'), path.join(sourceHome, 'auth.json'));
      fs.copyFileSync(path.join(f.sourceHome, '.env'), path.join(sourceHome, '.env'));
      fs.writeFileSync(path.join(sourceHome, 'SOUL.md'), 'source-profile-original');
    }
    const context = { ...f.context, workspace, employeeId: `employee_fixture_${name}`, persona: `Private persona ${index}`, instructions: `Private instructions ${index}` };
    const home = prepareCreatorRuntimeHome({ ...f.options, context, workspace, sourceHome, profile });
    const env = { ...process.env, PYTHONPATH: nativeRoot, HERMES_HOME: sourceHome, HERMES_MANAGED_DIR: managed, ...home.env, ZIWEI_MCP_WORKSPACE: workspace, FIXTURE_MEMORY: `native memory ${index}`, FIXTURE_MANAGED_DIR: managed, FIXTURE_PYTHONPATH: nativeRoot }; delete env.PYTHONHOME;
    const spec = hermesMcpSpawnSpec(launcher, ['--profile', profile, '-z', 'no model fixture', '--toolsets', 'all'], { env });
    const output = spawnSync(spec.command, ['-c', nativeProbe, JSON.stringify(spec.args)], { env, cwd: f.directory, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(output.status, 0, output.stderr);
    const receiptLine = output.stderr.split(/\r?\n/).find(line => line.startsWith('ZIWEI_CREATOR_ISOLATION:'));
    assert.ok(receiptLine, 'Native bootstrap must confirm the bound instance before a model can run');
    assert.deepEqual(JSON.parse(receiptLine.slice('ZIWEI_CREATOR_ISOLATION:'.length)), home.receipt);
    const result = JSON.parse(output.stdout.trim().split(/\r?\n/).at(-1)); outputs.push({ ...result, expectedHome: home.home });
    assert.equal(path.resolve(result.home), path.resolve(home.home));
    assert.equal(path.resolve(result.authPath), path.resolve(sourceHome, 'auth.json'));
    assert.equal(path.resolve(result.memory), path.resolve(home.home, 'memories'));
    assert.equal(path.resolve(result.state), path.resolve(home.home, 'state.db'));
    assert.match(result.soul, new RegExp(`Private persona ${index}`));
    assert.equal(result.provider, 'openai-codex'); assert.equal(result.phoneDisabled, true); assert.equal(result.policyPreserved, true); assert.equal(result.models, 0);
    assert.equal(result.sourceEnvLoaded, true); assert.equal(result.legacyPhoneCredentialPresent, false); assert.equal(result.deviceCredentialPresent, false); assert.equal(result.runtimeScopePreserved, true);
    assert.equal(result.managedDirectoryPreserved, true); assert.equal(result.pythonPathPreserved, true); assert.equal(result.pythonHomeAbsent, true);
    assert.equal(fs.existsSync(path.join(home.home, 'auth.json')), false);
    assert.equal(fs.readFileSync(path.join(home.home, 'memories', 'MEMORY.md'), 'utf8'), `native memory ${index}`);
    assert.equal(fs.existsSync(path.join(sourceHome, 'state.db')), false); assert.equal(fs.existsSync(path.join(sourceHome, 'memories')), false);
  }
  assert.notEqual(outputs[0].home, outputs[1].home);
  assert.notEqual(outputs[0].home, outputs[2].home);
  assert.doesNotMatch(outputs[0].soul, /Private persona 1/);
  assert.deepEqual(fs.readFileSync(path.join(f.sourceHome, 'config.yaml')), sourceConfig);
  assert.equal(fs.readFileSync(path.join(f.sourceHome, 'SOUL.md'), 'utf8'), 'source-persona-must-not-change');
  assert.equal(fs.existsSync(path.join(f.sourceHome, 'state.db')), false);
  assert.equal(fs.existsSync(path.join(f.sourceHome, 'memories')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.sourceHome, 'auth.json'), 'utf8')).fixture, 'native-rotated');
});

test('Installed Hermes refuses changed profile, external memory overlay and metadata mismatch before model invocation', async t => {
  if (!fs.existsSync(python) || !fs.existsSync(launcher)) return t.skip('Installed native Hermes is required for the no-model refusal fixture');
  const { prepareCreatorRuntimeHome } = await import(helperUrl); const f = fixture(t);
  const managed = path.join(f.directory, 'managed'); fs.mkdirSync(managed);
  fs.writeFileSync(path.join(managed, 'config.yaml'), 'mcp_servers:\n  ziwei_management:\n    enabled: true\n    command: fixture\nmemory:\n  provider: private-external-provider-not-printed\n');
  const home = prepareCreatorRuntimeHome(f.options);
  const env = { ...process.env, PYTHONPATH: nativeRoot, HERMES_HOME: f.sourceHome, HERMES_MANAGED_DIR: managed, ...home.env };
  const spec = hermesMcpSpawnSpec(launcher, ['--profile', 'default', '-z', 'MODEL_MUST_NOT_BE_STARTED'], { env });
  const refused = spawnSync(spec.command, spec.args, { env, cwd: f.directory, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(refused.status, 125); assert.match(refused.stderr, /external memory provider/);
  assert.doesNotMatch(refused.stdout + refused.stderr, /Traceback|private-external-provider-not-printed|MODEL_MUST_NOT_BE_STARTED|ZIWEI_CREATOR_ISOLATION:/);
  fs.writeFileSync(path.join(managed, 'config.yaml'), 'mcp_servers: {}\n');
  const mismatched = spawnSync(spec.command, spec.args, { env: { ...env, ZIWEI_CREATOR_WORKSPACE: 'foreign' }, cwd: f.directory, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(mismatched.status, 125); assert.match(mismatched.stderr, /instance identity/);
  assert.doesNotMatch(mismatched.stdout + mismatched.stderr, /Traceback|MODEL_MUST_NOT_BE_STARTED|ZIWEI_CREATOR_ISOLATION:/);
  const selected = path.join(f.sourceHome, 'profiles', 'selected'); fs.mkdirSync(selected, { recursive: true });
  fs.copyFileSync(path.join(f.sourceHome, 'config.yaml'), path.join(selected, 'config.yaml'));
  fs.copyFileSync(path.join(f.sourceHome, 'auth.json'), path.join(selected, 'auth.json'));
  const selectedHome = prepareCreatorRuntimeHome({ ...f.options, sourceHome: selected, profile: 'selected', context: { ...f.context, employeeId: 'employee_profile_mismatch' } });
  const selectedEnv = { ...env, HERMES_HOME: selected, ...selectedHome.env };
  const wrongProfile = hermesMcpSpawnSpec(launcher, ['--profile', 'default', '-z', 'MODEL_MUST_NOT_BE_STARTED'], { env: selectedEnv });
  const wrong = spawnSync(wrongProfile.command, wrongProfile.args, { env: selectedEnv, cwd: f.directory, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(wrong.status, 125); assert.match(wrong.stderr, /profile selection/);
  assert.doesNotMatch(wrong.stdout + wrong.stderr, /Traceback|MODEL_MUST_NOT_BE_STARTED|ZIWEI_CREATOR_ISOLATION:/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.sourceHome, 'auth.json'), 'utf8')).fixture, 'initial');
});
