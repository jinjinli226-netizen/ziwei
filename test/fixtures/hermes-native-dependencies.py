"""Offline official PM activation, with an initially package-free interpreter."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile


PROJECT, OFFICIAL_SOURCE, RUAMEL_SOURCE = map(lambda value: Path(value).resolve(), sys.argv[1:4])
sys.argv = sys.argv[:1]
GUARD = r'''
import atexit,importlib.util,json,os,runpy,sys
from pathlib import Path
private=Path(os.environ['FIXTURE_PRIVATE']).resolve()
source=Path(os.environ['FIXTURE_SOURCE']).resolve()
def audit(event,args):
    if event.startswith('socket.') or event in ('subprocess.Popen','os.system','os.posix_spawn','os.exec'):
        raise RuntimeError('OFFLINE_NATIVE_DEPENDENCIES_EXTERNAL_IO_DENIED')
    if event=='open' and args and isinstance(args[0],(str,bytes)):
        target=Path(os.fsdecode(args[0])).resolve()
        if target.name in ('auth.json','.env','credentials.json') and not target.is_relative_to(private):
            raise RuntimeError('OFFLINE_NATIVE_DEPENDENCIES_EXTERNAL_AUTH_DENIED')
sys.addaudithook(audit)
sys.path[:]=[entry for entry in sys.path if Path(entry).name not in ('site-packages','dist-packages')]
assert importlib.util.find_spec('yaml') is None, 'The initial interpreter must not carry PyYAML'
sys.path.insert(0,str(source))
calls=[]
def profile(frame,event,arg):
    if event=='call' and frame.f_code.co_name=='activate_dependencies':
        file=Path(frame.f_code.co_filename).resolve()
        assert file==source/'pm/environments.py'
        calls.append(str(file))
sys.setprofile(profile)
@atexit.register
def report():
    yaml=sys.modules.get('hermes_yaml')
    ruamel=sys.modules.get('ruamel.yaml')
    marker=importlib.util.find_spec('native_generation_marker')
    config=private/'home/profiles/bot-native-pm/config.yaml'
    Path(os.environ['FIXTURE_AUDIT']).write_text(json.dumps({
        'initialYamlAbsent':True,'activateDependenciesCalls':calls,
        'yamlFile':getattr(yaml,'__file__',None),
        'ruamelFile':getattr(ruamel,'__file__',None),
        'pyYamlAvailable':importlib.util.find_spec('yaml') is not None,
        'readBack':yaml.safe_load(config.read_text(encoding='utf-8')) if yaml and config.is_file() else None,
        'pthModule':marker.origin if marker else None,
        'home':os.environ.get('HERMES_HOME'),'lazy':os.environ.get('HERMES_DISABLE_LAZY_INSTALLS'),
        'pmSource':getattr(sys.modules.get('pm.environments'),'__file__',None),
    }),encoding='utf-8')
sys.argv=sys.argv[1:]
runpy.run_path(sys.argv[0],run_name='__main__')
'''


class NativeDependencies(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='official-hermes-pm-')
        self.addCleanup(self.temporary.cleanup)
        self.private = Path(self.temporary.name).resolve()
        self.source = self.private / 'hermes-agent-current'
        shutil.copytree(OFFICIAL_SOURCE, self.source, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.git'))
        self.home = self.private / 'home'
        self.home.mkdir()
        (self.home / 'config.yaml').write_text('model:\n  provider: openai-codex\n  default: synthetic-no-model\n', encoding='utf-8')
        (self.home / 'auth.json').write_text('{"fixture":"not-a-real-credential"}', encoding='utf-8')
        (self.home / '.env').write_text('# no real credentials\n', encoding='utf-8')
        key = hashlib.sha256(str(self.source).encode('utf-8')).hexdigest()[:16]
        self.state = self.home / 'installs' / key
        self.generation = self.state / 'environments' / 'committed-fixture'
        self.generation.mkdir(parents=True)
        (self.generation / 'pyvenv.cfg').write_text('version = %s.%s.%s\n' % sys.version_info[:3], encoding='utf-8')
        self.site = self.generation / ('Lib/site-packages' if os.name == 'nt' else 'lib/python%s.%s/site-packages' % sys.version_info[:2])
        self.site.mkdir(parents=True)
        shutil.copytree(RUAMEL_SOURCE, self.site / 'ruamel', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        extra = self.site / 'native-extra'
        extra.mkdir()
        (extra / 'native_generation_marker.py').write_text('SELECTED = True\n', encoding='utf-8')
        (self.site / 'native-generation.pth').write_text('native-extra\n', encoding='utf-8')
        self.facts = self.state / 'facts.json'
        self.facts.write_text(json.dumps({'schema': 1, 'packages': {'venv': {'environment': str(self.generation)}}}), encoding='utf-8')
        self.guard = self.private / 'guard.py'
        self.guard.write_text(GUARD, encoding='utf-8')
        self.python = Path(getattr(sys, '_base_executable', sys.executable)).resolve()
        self.launcher = self.private / 'hermes'
        self.launcher.write_text('#!"' + str(self.python) + '"\nfrom hermes_cli.main import main\n', encoding='utf-8')
        self.launcher_binding = None
        self.env = {key: os.environ[key] for key in ('PATH', 'LANG', 'SystemRoot', 'SYSTEMROOT', 'WINDIR') if key in os.environ}
        self.env.update({'HERMES_HOME': str(self.home), 'HOME': str(self.private / 'user'), 'USERPROFILE': str(self.private / 'user'),
                         'CODEX_HOME': str(self.private / 'empty-codex'), 'HERMES_DISABLE_LAZY_INSTALLS': '0',
                         'PYTHONDONTWRITEBYTECODE': '1', 'ZIWEI_BOT_PROFILE_MODE': 'owned_profile',
                         'FIXTURE_PRIVATE': str(self.private), 'FIXTURE_SOURCE': str(self.source)})
        for key in ('HOME', 'CODEX_HOME'):
            Path(self.env[key]).mkdir(exist_ok=True)
        name = 'bot-native-pm'
        self.request = {
            'context': {'employeeId': 'employee_fixture', 'workspace': 'fixture', 'deviceId': 'fixture-pc', 'name': '原生依赖创建',
                        'sourceProfile': name, 'config': {}, 'instance': {'mode': 'owned_profile', 'profile': name,
                        'templateProfile': 'default', 'ownershipId': 'owner-fixture', 'provisionActionId': 'action_fixture'}},
            'metadata': {'version': 1, 'templateId': 'ziwei-hermes-bot', 'key': 'owner-fixture', 'origin': 'https://fixture.invalid',
                         'workspace': 'fixture', 'employeeId': 'employee_fixture', 'deviceId': 'fixture-pc', 'profile': name,
                         'sourceProfile': name, 'templateProfile': 'default', 'mode': 'owned_profile',
                         'sourceHome': str(self.home), 'provisionActionId': 'action_fixture'},
            'seedConfig': {'model': {'provider': 'openai-codex', 'default': 'synthetic-no-model'}, 'updates': {'check': False}},
            'authentication': 'required',
        }
        self.source_before = {name: (self.home / name).read_bytes() for name in ('config.yaml', 'auth.json', '.env')}

    def run_native(self, name, args, request=None):
        audit = self.private / (name + '.audit.json')
        output = subprocess.run([str(self.python), '-I', '-B', str(self.guard), str(PROJECT / 'src/hermes-mcp-bootstrap.py'), *args],
                                env={**self.env, 'FIXTURE_AUDIT': str(audit)}, cwd=self.private,
                                input=(json.dumps(request, ensure_ascii=False) + '\n').encode('utf-8') if request is not None else None,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        proof = json.loads(audit.read_text(encoding='utf-8'))
        self.assertTrue(proof['initialYamlAbsent'])
        for relative, before in self.source_before.items():
            self.assertEqual((self.home / relative).read_bytes(), before)
        return output, proof

    def probe(self):
        args = ['--probe', str(self.launcher)]
        if self.launcher_binding is not None:
            args += ['--launcher-binding', json.dumps(self.launcher_binding)]
        output, audit = self.run_native('probe', args)
        self.assertEqual(output.returncode, 0, output.stderr.decode())
        proof = json.loads(output.stdout)
        self.assertEqual(proof['paths']['bootstrap'], str(self.source / 'hermes_bootstrap.py'))
        installation = proof['launcherBinding']['installation'] if self.launcher_binding else proof['sourceBootstrap']
        self.assertEqual(installation['bootstrapSha256'], hashlib.sha256((self.source / 'hermes_bootstrap.py').read_bytes()).hexdigest())
        self.assertEqual(proof['paths']['native_yaml'], str(self.source / 'hermes_yaml.py'))
        self.assertTrue(audit['activateDependenciesCalls'])
        self.assertEqual(Path(audit['pthModule']), self.site / 'native-extra/native_generation_marker.py')
        return proof

    def create_and_duplicate(self):
        proof = self.probe()
        args = ['--launcher', str(self.launcher), '--binding', json.dumps(proof), '--owned-profile-provision', '--']
        output, audit = self.run_native('create', args, self.request)
        self.assertEqual(output.returncode, 0, output.stderr.decode())
        receipt = json.loads(next(line.split(b':', 1)[1] for line in output.stdout.splitlines() if line.startswith(b'ZIWEI_BOT_PROVISION:')))
        self.assertEqual(receipt['status'], 'succeeded', receipt)
        self.assertTrue(audit['activateDependenciesCalls'])
        self.assertEqual(Path(audit['yamlFile']), self.source / 'hermes_yaml.py')
        self.assertEqual(Path(audit['ruamelFile']), self.site / 'ruamel/yaml/__init__.py')
        self.assertFalse(audit['pyYamlAvailable'])
        self.assertEqual(audit['readBack']['model'], self.request['seedConfig']['model'])
        self.assertEqual(audit['home'], str(self.home))
        self.assertEqual(audit['lazy'], '0')
        home = Path(receipt['botProvision']['home'])
        self.assertEqual(home, self.home / 'profiles/bot-native-pm')
        self.assertFalse((home / 'auth.json').exists())
        memory = home / 'memories/MEMORY.md'
        memory.write_text('persistent memory', encoding='utf-8')
        original_config = (home / 'config.yaml').read_bytes()
        output, audit = self.run_native('duplicate', args, self.request)
        self.assertEqual(output.returncode, 0, output.stderr.decode())
        duplicate = json.loads(next(line.split(b':', 1)[1] for line in output.stdout.splitlines() if line.startswith(b'ZIWEI_BOT_PROVISION:')))
        self.assertTrue(duplicate['botProvision']['duplicate'])
        self.assertEqual(memory.read_text(), 'persistent memory')
        self.assertEqual((home / 'config.yaml').read_bytes(), original_config)
        self.assertEqual(Path(audit['ruamelFile']), self.site / 'ruamel/yaml/__init__.py')
        self.assertFalse(audit['pyYamlAvailable'])
        self.assertEqual(audit['readBack']['model'], self.request['seedConfig']['model'])

    def test_real_official_pm_selects_only_ruamel_before_create_and_duplicate(self):
        self.create_and_duplicate()

    def test_isolated_store_launcher_creates_and_reloads_without_pyyaml(self):
        self.launcher = self.private / 'hermes.exe'
        script = ('import sys\nsys.path.insert(0, ' + repr(str(self.source)) + ')\n'
                  'sys._hermes_pin_default_home = True\nimport hermes_bootstrap\nfrom hermes_cli.main import main\n')
        with self.launcher.open('wb') as stream:
            stream.write(b'MZ' + b'\0' * 62)
            stream.write(('#!"' + str(self.python) + '" -I\r\n').encode('utf-8'))
            with zipfile.ZipFile(stream, 'w') as archive:
                archive.writestr('__main__.py', script)
        self.launcher_binding = {'schemaVersion': 1, 'isolated': {'kind': 'distlib-isolated',
                                'interpreter': str(self.python), 'launcherSha256': hashlib.sha256(self.launcher.read_bytes()).hexdigest()}}
        self.create_and_duplicate()

    def test_missing_native_ruamel_does_not_fall_back_to_available_pyyaml(self):
        proof = self.probe()
        shutil.rmtree(self.site / 'ruamel')
        trap = self.site / 'yaml'
        trap.mkdir()
        marker = self.private / 'forbidden-pyyaml-fallback'
        (trap / '__init__.py').write_text('from pathlib import Path\nPath(' + repr(str(marker)) + ').write_text("wrong fallback")\n', encoding='utf-8')
        args = ['--launcher', str(self.launcher), '--binding', json.dumps(proof), '--owned-profile-provision', '--']
        output, audit = self.run_native('missing-ruamel', args, self.request)
        self.assertEqual(output.returncode, 0, output.stderr.decode())
        receipt = json.loads(next(line.split(b':', 1)[1] for line in output.stdout.splitlines() if line.startswith(b'ZIWEI_BOT_PROVISION:')))
        self.assertEqual(receipt['status'], 'failed')
        self.assertEqual(receipt['diagnostic']['missingModule'], 'ruamel')
        self.assertFalse(marker.exists())
        self.assertFalse((self.home / 'profiles/bot-native-pm').exists())

    def test_bootstrap_change_is_rejected_before_its_new_code_runs(self):
        proof = self.probe()
        marker = self.private / 'tampered-bootstrap-ran'
        with (self.source / 'hermes_bootstrap.py').open('a', encoding='utf-8') as stream:
            stream.write('\nPath(' + repr(str(marker)) + ').write_text("must not run")\n')
        output, audit = self.run_native('tamper', ['--launcher', str(self.launcher), '--binding', json.dumps(proof), '--owned-profile-provision'], self.request)
        self.assertEqual(output.returncode, 125)
        self.assertFalse(marker.exists())
        self.assertEqual(audit['activateDependenciesCalls'], [])
        self.assertNotIn(b'ZIWEI_BOT_PROVISION:', output.stdout)
        self.assertFalse((self.home / 'profiles/bot-native-pm').exists())

    def test_official_pm_rejects_an_environment_outside_its_install(self):
        self.facts.write_text(json.dumps({'schema': 1, 'packages': {'venv': {'environment': str(self.private / 'other-install')}}}), encoding='utf-8')
        output, audit = self.run_native('foreign', ['--probe', str(self.launcher)])
        self.assertNotEqual(output.returncode, 0)
        self.assertTrue(audit['activateDependenciesCalls'])
        self.assertIsNone(audit['yamlFile'])
        self.assertFalse((self.home / 'profiles/bot-native-pm').exists())


if __name__ == '__main__':
    unittest.main()
