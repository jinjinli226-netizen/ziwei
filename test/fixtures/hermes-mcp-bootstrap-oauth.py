"""Run the real bootstrap and bridge with a synthetic, owned native installation.

Only the installation-binding probe and external native dependencies are doubles.
prepare/confirm, request identity checks and bridge delegation are production code.
No sockets, subprocesses, actual credentials, OAuth or MCP servers are permitted.
"""
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

PROJECT = Path(sys.argv[1])
sys.argv = sys.argv[:1]
RELAY = {'ZIWEI_MCP_OAUTH_API_BASE': 'https://relay.fixture.invalid',
         'ZIWEI_MCP_OAUTH_DEVICE_TOKEN': 'SYNTHETIC_DEVICE_ONLY',
         'ZIWEI_MCP_OAUTH_ACTION_ID': 'action_fixture'}


def no_external_io(event, args):
    if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.exec'}:
        raise AssertionError('BOOTSTRAP_TEST_EXTERNAL_IO_DENIED')


sys.addaudithook(no_external_io)


class CountingInput(io.StringIO):
    reads = 0

    def readline(self, *args):
        self.reads += 1
        return super().readline(*args)


class Bootstrap(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ziwei-bootstrap-relay-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.home, self.source, self.overlay = [self.root / name for name in ['owned', 'source', 'overlay']]
        for directory in [self.home, self.source, self.overlay]:
            directory.mkdir()
        self.overlay.joinpath('config.yaml').write_text('{}')
        self.home.joinpath('config.yaml').write_text('{}')
        self.home.joinpath('SOUL.md').write_text('Synthetic isolated persona')
        self.context = {'employeeId': 'employee_fixture', 'workspace': 'fixture', 'revision': 2, 'config': {}}
        metadata = {'templateId': 'ziwei-hermes-bot', 'key': 'fixture-key', 'workspace': 'fixture',
                    'employeeId': 'employee_fixture', 'sourceProfile': 'fixture-owned',
                    'sourceHome': str(self.source), 'mode': 'owned_profile'}
        self.home.joinpath('ziwei-instance.json').write_text(json.dumps(metadata))
        env = {'HERMES_HOME': str(self.home), 'HERMES_MANAGED_DIR': str(self.overlay),
               'ZIWEI_CREATOR_HOME': str(self.home), 'ZIWEI_CREATOR_SOURCE_HOME': str(self.source),
               'ZIWEI_CREATOR_KEY': metadata['key'], 'ZIWEI_CREATOR_WORKSPACE': 'fixture',
               'ZIWEI_CREATOR_EMPLOYEE_ID': 'employee_fixture', 'ZIWEI_CREATOR_PROFILE': 'fixture-owned',
               'ZIWEI_INSTANCE_KIND': 'hermes-bot', 'ZIWEI_BOT_PROFILE_MODE': 'owned_profile',
               'ZIWEI_BOT_REVISION': '2', **RELAY}
        self.env_patch = patch.dict(os.environ, env, clear=True)
        self.env_patch.start(); self.addCleanup(self.env_patch.stop)
        self.modules = {}
        self.paths = {}
        self.closed, self.registered = [], []

        def fake(name, path=None, **values):
            target = self.root / (path or name.replace('.', '/') + '.py')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('# synthetic native module\n')
            value = types.ModuleType(name)
            value.__file__, value.__spec__ = str(target), importlib.util.spec_from_file_location(name, target)
            for key, item in values.items():
                setattr(value, key, item)
            self.modules[name] = value
            return value

        for package in ['hermes_cli', 'tools', 'agent']:
            fake(package, package + '/__init__.py', __path__=[str(self.root / package)])
        self.modules['hermes_cli'].__version__ = 'offline-fixture'
        self.current_home = self.home
        def set_home(home):
            self.current_home = Path(home)
        constants = fake('hermes_constants', get_hermes_home=lambda: self.current_home, set_hermes_home_override=set_home)
        auth = fake('hermes_cli.auth', _auth_file_path=lambda: self.source / 'auth.json')
        fake('hermes_cli.profiles', get_profile_dir=lambda name: self.home)
        fake('dotenv', dotenv_values=lambda file: {'ZIWEI_MCP_OAUTH_DEVICE_TOKEN': 'DOTENV_MUST_NOT_OVERRIDE', 'PUBLIC_FIXTURE': 'ok'})
        raw = {'model': {'provider': 'fixture', 'default': 'no-model'}, 'platform_toolsets': {'cli': ['reports']},
               'mcp_servers': {'reports': {'auth': 'oauth', 'url': 'https://mcp.fixture.invalid/mcp'}}, 'skills': {'disabled': []}}
        config = fake('hermes_cli.config', read_raw_config=lambda: json.loads(json.dumps(raw)),
                      load_config=lambda: json.loads(json.dumps(raw)), get_config_path=lambda: self.home / 'config.yaml')
        main = fake('hermes_cli.main', main=lambda: self.assert_relay_absent())
        startup = fake('hermes_cli.mcp_startup', _has_configured_mcp_servers=lambda: False)
        managed = fake('hermes_cli.managed_scope')
        fake('hermes_cli.skills_config', get_disabled_skills=lambda conf, platform: set())
        memory = fake('tools.memory_tool', get_memory_dir=lambda: self.current_home / 'memories')
        state = fake('hermes_state', _default_db_path=lambda: self.current_home / 'state.db')
        prompt = fake('agent.prompt_builder', load_soul_md=lambda: self.home.joinpath('SOUL.md').read_text())
        registry = fake('hermes_state_registry', close_all_under=lambda home: self.closed.append(home))
        safe = fake('hermes_cli.sqlite_safe_read', has_live_connection=lambda file: False)
        fake('hermes_yaml', safe_load=json.loads, safe_dump=json.dumps)
        fake('toolsets', TOOLSETS={'browser': {}})

        def register(entries):
            self.assert_relay_absent()
            self.registered.append(entries)
            return ['fixture_tool']
        fake('tools.mcp_tool_discovery', register_mcp_servers=register,
             get_mcp_status=lambda: [{'name': 'reports', 'connected': True}])
        fake('tools.mcp_tool_lifecycle', shutdown_mcp_servers=lambda: None)
        fake('tools.registry', registry=types.SimpleNamespace(get_schema=lambda name: {'name': name}, dispatch=lambda name, args: {}))
        self.module_patch = patch.dict(sys.modules, self.modules)
        self.module_patch.start(); self.addCleanup(self.module_patch.stop)
        for key, value in [('constants', constants), ('auth', auth), ('main', main), ('mcp_startup', startup),
                           ('config', config), ('managed_scope', managed), ('memory', memory), ('state', state),
                           ('prompt', prompt), ('state_registry', registry), ('sqlite_safe_read', safe),
                           ('profiles', self.modules['hermes_cli.profiles'])]:
            self.paths[key] = value.__file__
        spec = importlib.util.spec_from_file_location('bootstrap_relay_fixture', PROJECT / 'src/hermes-mcp-bootstrap.py')
        self.bootstrap = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.bootstrap)
        self.bootstrap.binding = lambda *args: {'paths': self.paths, 'fingerprint': 'fixture'}
        # Companions are the actual bridge/YAML adapter, with only the external
        # OAuth SDK helper substituted by a credential-consuming offline double.
        self.bootstrap.__file__ = str(self.root / 'hermes-mcp-bootstrap.py')
        for filename in ['hermes-native-bridge.py', 'hermes-yaml-compat.py']:
            self.root.joinpath(filename).write_bytes((PROJECT / 'src' / filename).read_bytes())
        with self.root.joinpath('hermes-native-bridge.py').open('a') as companion:
            companion.write("\ndef run_gateway_worker(request, context):\n assert not any(k.startswith('ZIWEI_MCP_OAUTH_') for k in os.environ)\n")
        helper = """import os
def authorize_mcp(logical, server, config):
 expected={relay!r}
 assert all(os.environ.pop(key,None)==value for key,value in expected.items())
 assert os.environ['PUBLIC_FIXTURE']=='ok'
 return {{'connected':True,'server':logical,'tools':[],'relayConsumed':True}}
""".format(relay=RELAY)
        self.root.joinpath('hermes-remote-mcp-oauth.py').write_text(helper)

    def assert_relay_absent(self):
        self.assertFalse(any(key.startswith('ZIWEI_MCP_OAUTH_') for key in os.environ))
        return 0

    def run_bootstrap(self, mode='--native-operation', operation='authorize', context=None):
        request = {'resource': 'mcp', 'operation': operation, 'input': {'server': 'reports'},
                   'context': context or self.context}
        if operation == 'call':
            request['input'].update({'tool': 'fixture_tool', 'arguments': {}})
        stdin, stdout, stderr = CountingInput(json.dumps(request) + '\n'), io.StringIO(), io.StringIO()
        argv = ['bootstrap', '--launcher', str(self.root / 'hermes'), '--binding',
                json.dumps({'paths': self.paths, 'fingerprint': 'fixture'}), *([mode] if mode else []), '--']
        with patch.object(sys, 'argv', argv), patch.object(sys, 'stdin', stdin), redirect_stdout(stdout), redirect_stderr(stderr):
            outcome = self.bootstrap.run()
            if callable(outcome):
                outcome = outcome()
        self.assertEqual(outcome, 0)
        self.assertNotIn(RELAY['ZIWEI_MCP_OAUTH_DEVICE_TOKEN'], stdout.getvalue() + stderr.getvalue())
        return stdin, stdout.getvalue()

    def test_authorize_traverses_owned_home_sanitization_and_reads_request_once(self):
        stdin, output = self.run_bootstrap()
        result = json.loads(output.split('ZIWEI_NATIVE_RESULT:')[1])
        self.assertTrue(result['data']['relayConsumed'])
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(stdin.reads, 1)
        self.assertEqual(self.closed, [str(self.home)])
        self.assert_relay_absent()

    def test_inspect_never_inherits_relay_credentials(self):
        stdin, output = self.run_bootstrap(operation='inspect')
        self.assertEqual(stdin.reads, 1)
        self.assertTrue(self.registered)
        self.assert_relay_absent()

    def test_chat_config_and_gateway_modes_do_not_preserve_relay_credentials(self):
        # Each mode gets a fresh synthetic process environment/config wrapper.
        for mode in [None, '--config-only', '--gateway-worker']:
            with self.subTest(mode=mode):
                os.environ.update(RELAY)
                self.run_bootstrap(mode=mode)
                self.assert_relay_absent()

    def test_mismatched_employee_cannot_reach_authorize_helper(self):
        context = {**self.context, 'employeeId': 'foreign_employee'}
        with self.assertRaisesRegex(self.bootstrap.UnsupportedNativeHermes, 'bot native operation identity'):
            self.run_bootstrap(context=context)
        self.assertEqual(self.closed, [])

    def test_call_is_not_an_authorize_relay_scope(self):
        self.run_bootstrap(operation='call')
        self.assert_relay_absent()
        self.assertTrue(self.registered)


if __name__ == '__main__':
    unittest.main()
