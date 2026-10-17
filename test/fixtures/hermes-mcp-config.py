"""Offline adapter contracts. No real MCP, OAuth, model, listener or token store."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest

PROJECT = Path(sys.argv[1])
SERVERS = json.loads(sys.argv[2])
sys.argv = sys.argv[:1]


def no_external_io(event, args):
    if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.exec'}:
        raise AssertionError('MCP fixture forbids external IO')


sys.addaudithook(no_external_io)


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, filename)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


BOOTSTRAP = module('ziwei_bootstrap_fixture', PROJECT / 'src/hermes-mcp-bootstrap.py')
BRIDGE = module('ziwei_bridge_fixture', PROJECT / 'src/hermes-native-bridge.py')


class Contracts(unittest.TestCase):
    def setUp(self):
        self.servers = json.loads(json.dumps(SERVERS))
        self.registered = []
        self.dispatched = []
        self.shutdowns = []
        BRIDGE.scoped_config = lambda: {'mcp_servers': self.servers}
        tools = types.ModuleType('tools')
        tools.__path__ = []
        discovery = types.ModuleType('tools.mcp_tool_discovery')

        def register(entries):
            self.registered.append(entries)
            return ['fixture_lookup']

        discovery.register_mcp_servers = register
        discovery.get_mcp_status = lambda: [{'name': name, 'connected': True} for entry in self.registered for name in entry]
        lifecycle = types.ModuleType('tools.mcp_tool_lifecycle')
        lifecycle.shutdown_mcp_servers = lambda: self.shutdowns.append(True)
        registry = types.ModuleType('tools.registry')

        def dispatch(name, arguments):
            self.dispatched.append((name, arguments))
            return {'original': arguments, 'fixture': True}

        registry.registry = types.SimpleNamespace(get_schema=lambda name: {'name': name, 'parameters': {'type': 'object'}}, dispatch=dispatch)
        toolsets = types.ModuleType('toolsets')
        toolsets.TOOLSETS = {'browser': {}, 'future_builtin': {}}
        sys.modules.update({'tools': tools, discovery.__name__: discovery, lifecycle.__name__: lifecycle, registry.__name__: registry, 'toolsets': toolsets})

    def test_central_enabled_names_only(self):
        BOOTSTRAP.validate_bot_toolsets(['web', 'oauth_server', 'ziwei_external_legacy', 'ziwei_collaboration'], {'mcp_servers': self.servers}, {'web': {}})
        for name in ['mcp-host_only', 'host_only', 'disabled', 'ziwei_external_oauth_server', 'legacy']:
            with self.assertRaises(BOOTSTRAP.UnsupportedNativeHermes):
                BOOTSTRAP.validate_bot_toolsets([name], {'mcp_servers': self.servers}, {'web': {}})

    def test_effective_host_metadata_cannot_allow_an_unconfigured_or_disabled_server(self):
        for central in [{'mcp_servers': {}}, {'mcp_servers': {'unapproved': {'enabled': False}}}, {'mcp_servers': {'unapproved': {'enabled': 'false'}}}]:
            with self.assertRaises(BOOTSTRAP.UnsupportedNativeHermes):
                BOOTSTRAP.validate_bot_toolsets(['unapproved'], central, {'web': {}})
        with self.assertRaises(BOOTSTRAP.UnsupportedNativeHermes):
            BOOTSTRAP.validate_bot_toolsets('oauth_server', {'mcp_servers': self.servers}, {})
        with self.assertRaises(BOOTSTRAP.UnsupportedNativeHermes):
            BOOTSTRAP.validate_bot_toolsets([], {'mcp_servers': []}, {})
        with self.assertRaises(BOOTSTRAP.UnsupportedNativeHermes):
            BOOTSTRAP.validate_bot_toolsets(['all'], {'mcp_servers': {'all': {'auth': 'oauth'}}}, {'all': {}})

    def test_inspect_oauth_keeps_logical_identity(self):
        result = BRIDGE.mcp('inspect', {'server': 'oauth_server'})
        self.assertEqual(result['server'], 'oauth_server')
        self.assertTrue(result['connected'])
        self.assertEqual(list(self.registered[0]), ['oauth_server'])
        self.assertEqual(self.registered[0]['oauth_server']['auth'], 'oauth')
        self.assertEqual(self.shutdowns, [True])

    def test_call_legacy_keeps_prefix_and_dispatches_only_discovered_tool(self):
        result = BRIDGE.mcp('call', {'server': 'legacy', 'tool': 'fixture_lookup', 'arguments': {'query': 'original'}})
        self.assertEqual(list(self.registered[0]), ['ziwei_external_legacy'])
        self.assertEqual(result['result'], {'original': {'query': 'original'}, 'fixture': True})
        self.assertEqual(self.dispatched, [('fixture_lookup', {'query': 'original'})])
        with self.assertRaises(BRIDGE.NativeOperationError):
            BRIDGE.mcp('call', {'server': 'legacy', 'tool': 'unapproved', 'arguments': {}})

    def test_disabled_reserved_and_foreign_names_fail_before_registration(self):
        for name in ['disabled', 'host_only', 'ziwei_management', 'ziwei-terminal', 'ziwei_external_legacy', '../legacy', 'Legacy']:
            with self.assertRaises(BRIDGE.NativeOperationError):
                BRIDGE.mcp('inspect', {'server': name})
        self.assertEqual(self.registered, [])

    def test_wrong_namespace_and_ambiguous_entries_fail_closed(self):
        for servers in [
            {'legacy': {'command': 'never-start'}},
            {'ziwei_external_oauth_server': {'url': 'https://fixture.invalid', 'auth': 'oauth'}},
            {'oauth_server': SERVERS['oauth_server'], 'ziwei_external_oauth_server': {'command': 'never-start'}},
        ]:
            self.servers = servers
            with self.assertRaises(BRIDGE.NativeOperationError):
                BRIDGE.mcp('inspect', {'server': 'legacy' if 'legacy' in servers else 'oauth_server'})
        self.assertEqual(self.registered, [])
        self.servers = {'all': SERVERS['oauth_server']}
        with self.assertRaises(BRIDGE.NativeOperationError):
            BRIDGE.mcp('inspect', {'server': 'all'})

    def test_authorize_delegates_only_the_resolved_oauth_identity(self):
        original_file = BRIDGE.__file__
        with tempfile.TemporaryDirectory(prefix='ziwei-mcp-delegate-') as temporary:
            script = Path(temporary) / 'hermes-remote-mcp-oauth.py'
            script.write_text("def authorize_mcp(logical, native, config):\n return {'logical':logical,'native':native,'auth':config['auth'],'fixture':True}\n", encoding='utf-8')
            BRIDGE.__file__ = str(Path(temporary) / 'hermes-native-bridge.py')
            try:
                result = BRIDGE.mcp('authorize', {'server': 'oauth_server'})
                self.assertEqual(result, {'logical': 'oauth_server', 'native': 'oauth_server', 'auth': 'oauth', 'fixture': True})
            finally:
                BRIDGE.__file__ = original_file
        self.assertEqual(self.registered, [])
        with self.assertRaisesRegex(BRIDGE.NativeOperationError, 'MCP_OAUTH_REQUIRED'):
            BRIDGE.mcp('authorize', {'server': 'legacy'})

    def test_oauth_builtin_conflict_is_checked_against_the_current_native_version(self):
        for name in ['all', 'browser', 'future_builtin']:
            self.servers = {name: SERVERS['oauth_server']}
            with self.assertRaisesRegex(BOOTSTRAP.UnsupportedNativeHermes, 'BOT_MCP_NAME_CONFLICT'):
                BOOTSTRAP.validate_bot_toolsets([name], {'mcp_servers': self.servers}, {'browser': {}, 'future_builtin': {}})
            for operation in ['inspect', 'call', 'authorize']:
                with self.assertRaisesRegex(BRIDGE.NativeOperationError, 'MCP_OAUTH_NAME_CONFLICT'):
                    BRIDGE.mcp(operation, {'server': name})
        self.assertEqual(self.registered, [])
        self.servers = {'ziwei_external_browser': SERVERS['ziwei_external_legacy']}
        BOOTSTRAP.validate_bot_toolsets(['ziwei_external_browser'], {'mcp_servers': self.servers}, {'browser': {}})
        self.assertTrue(BRIDGE.mcp('inspect', {'server': 'browser'})['connected'])
        self.assertEqual(list(self.registered[0]), ['ziwei_external_browser'])

    def test_oauth_call_uses_the_same_identity_as_inspect_and_authorize(self):
        result = BRIDGE.mcp('call', {'server': 'oauth_server', 'tool': 'fixture_lookup', 'arguments': {'lookup': 'historical'}})
        self.assertEqual(result['server'], 'oauth_server')
        self.assertEqual(list(self.registered[0]), ['oauth_server'])
        self.assertEqual(result['result']['original'], {'lookup': 'historical'})

    def test_authorize_errors_expose_only_public_codes(self):
        original_file = BRIDGE.__file__
        with tempfile.TemporaryDirectory(prefix='ziwei-mcp-errors-') as temporary:
            script = Path(temporary) / 'hermes-remote-mcp-oauth.py'
            BRIDGE.__file__ = str(Path(temporary) / 'hermes-native-bridge.py')
            try:
                for code, expected in [('MCP_OAUTH_CANCELLED', 'MCP_OAUTH_CANCELLED'), ('private-code', 'MCP_OAUTH_FAILED')]:
                    script.write_text("class Failure(RuntimeError):\n code=" + repr(code) + "\ndef authorize_mcp(*args):\n raise Failure('synthetic-private-token-and-url')\n", encoding='utf-8')
                    with self.assertRaises(BRIDGE.NativeOperationError) as caught:
                        BRIDGE.mcp('authorize', {'server': 'oauth_server'})
                    self.assertEqual(str(caught.exception), expected)
                script.unlink()
                with self.assertRaisesRegex(BRIDGE.NativeOperationError, 'MCP_OAUTH_REQUIRES_DEPENDENCY'):
                    BRIDGE.mcp('authorize', {'server': 'oauth_server'})
            finally:
                BRIDGE.__file__ = original_file


if __name__ == '__main__':
    unittest.main()
