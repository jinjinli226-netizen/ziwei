"""Actual native dashboard state checks, synthetic SDK/relay; no sockets or real credentials."""
import asyncio
from contextlib import contextmanager
import contextvars
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlencode

ROOT, SOURCE = map(Path, sys.argv[1:3])
sys.argv = sys.argv[:1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


helper = load('isolated_remote_mcp', ROOT / 'src/hermes-remote-mcp-oauth.py')
native = load('isolated_native_dashboard', SOURCE / 'tools/mcp_dashboard_oauth.py')


def no_network(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system'):
        raise AssertionError('TEST_EXTERNAL_IO_DENIED')
sys.addaudithook(no_network)


@contextmanager
def noop():
    yield


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = (Path(self.tmp.name) / 'owned-profile').resolve()
        self.home.mkdir()
        self.tokens = self.home / 'mcp-tokens' / 'reports.json'
        self.current_home = contextvars.ContextVar('home', default=str(self.home))
        self.secret_scope = contextvars.ContextVar('secret', default=None)
        self.calls, self.evictions = [], []
        self.mode = 'new'
        self.callback = {'code': 'SYNTHETIC_CODE', 'state': 'sdk-state', 'iss': 'https://issuer.example'}
        self.polls = []
        self.tools = [('read_report', 'Read the selected report')]
        self.authorization_url = 'https://issuer.example/authorize?' + urlencode({
            'state': 'sdk-state', 'redirect_uri': 'https://relay.example/api/mcp-oauth/callback',
            'code_challenge': 'SDK_GENERATED_PKCE', 'code_challenge_method': 'S256'})
        self.env = patch.dict(os.environ, {'HERMES_HOME': str(self.home),
            'ZIWEI_MCP_OAUTH_API_BASE': 'https://relay.example',
            'ZIWEI_MCP_OAUTH_DEVICE_TOKEN': 'SYNTHETIC_DEVICE_CREDENTIAL',
            'ZIWEI_MCP_OAUTH_ACTION_ID': 'action_isolated'}, clear=True)
        self.env.start(); self.addCleanup(self.env.stop)
        constants = types.ModuleType('hermes_constants')
        constants.get_hermes_home = lambda: Path(self.current_home.get())
        constants.set_hermes_home_override = self.current_home.set
        constants.reset_hermes_home_override = self.current_home.reset
        secrets = types.ModuleType('agent.secret_scope')
        secrets.build_profile_secret_scope = lambda home: {'scope': str(home)}
        secrets.set_secret_scope, secrets.reset_secret_scope = self.secret_scope.set, self.secret_scope.reset
        owner = self
        class Storage:
            def __init__(self, name, *, hermes_home=None):
                owner.assertEqual(name, 'reports')
                owner.assertEqual(Path(hermes_home or owner.current_home.get()), owner.home)
            def has_cached_tokens(self):
                return owner.tokens.exists()
            async def get_tokens(self):
                value = json.loads(owner.tokens.read_text())
                return types.SimpleNamespace(**value)
            def remove(self):
                raise AssertionError('TOKEN_REMOVAL_FORBIDDEN')
        oauth = types.ModuleType('tools.mcp_oauth')
        oauth.HermesTokenStorage = Storage
        oauth.force_interactive_oauth = noop
        oauth.apply_oauth_provider_defaults = lambda cfg, **kwargs: None
        self.oauth = oauth
        manager = types.ModuleType('tools.mcp_oauth_manager')
        def evict(name, *, hermes_home):
            self.evictions.append((name, hermes_home))
        manager.get_manager = lambda: types.SimpleNamespace(evict=evict)
        config = types.ModuleType('hermes_cli.mcp_config')
        config._probe_single_server = self.probe
        self.modules = patch.dict(sys.modules, {'hermes_constants': constants,
            'agent': types.ModuleType('agent'), 'agent.secret_scope': secrets,
            'tools': types.ModuleType('tools'), 'tools.mcp_dashboard_oauth': native,
            'tools.mcp_oauth': oauth, 'tools.mcp_oauth_manager': manager,
            'hermes_cli': types.ModuleType('hermes_cli'), 'hermes_cli.mcp_config': config})
        self.modules.start(); self.addCleanup(self.modules.stop)
        self.wire = patch.object(helper, 'build_opener', return_value=types.SimpleNamespace(open=self.open))
        self.wire.start(); self.addCleanup(self.wire.stop)
        self.config = {'url': 'https://mcp.example/mcp', 'auth': 'oauth', 'enabled': True, 'oauth': {'scope': 'reports:read'}}

    def save_token(self, value='SYNTHETIC_ACCESS_TOKEN'):
        self.tokens.parent.mkdir(exist_ok=True)
        self.tokens.write_text(json.dumps({'access_token': value}))

    def probe(self, name, config, connect_timeout):
        self.assertEqual(name, 'reports')
        self.assertEqual(self.current_home.get(), str(self.home))
        self.assertEqual(self.secret_scope.get(), {'scope': str(self.home)})
        self.assertEqual(config['oauth']['scope'], 'reports:read')
        self.assertEqual(config['oauth']['redirect_uri'], 'https://relay.example/api/mcp-oauth/callback')
        self.assertEqual(config['oauth']['timeout'], helper.CALLBACK_SECONDS)
        self.assertFalse(any(key in os.environ for key in ('ZIWEI_MCP_OAUTH_API_BASE', 'ZIWEI_MCP_OAUTH_DEVICE_TOKEN', 'ZIWEI_MCP_OAUTH_ACTION_ID')))
        self.assertEqual(connect_timeout, 315)
        if self.mode == 'fail':
            print('SECRET_FROM_NATIVE_DIAGNOSTIC', file=sys.stderr)
            logging.error('SECRET_FROM_NATIVE_LOG')
            raise RuntimeError('SECRET_TOKEN_AND_URL')
        if self.mode == 'bind':
            sys.audit('socket.bind', None, ('127.0.0.1', 0))
        if self.mode == 'refresh':
            self.save_token('SYNTHETIC_NATIVE_REFRESHED')
        if self.mode in ('new', 'missing-token'):
            flow = native.get_dashboard_oauth_flow()
            self.assertEqual(flow.hermes_home, str(self.home))
            async def authorize():
                await flow.publish_authorization_url(self.authorization_url)
                callback = await flow.wait_for_callback()
                self.assertEqual(callback, (self.callback.get('code'), self.callback.get('state'), self.callback.get('iss')))
            asyncio.run(authorize())
            if self.mode != 'missing-token':
                self.save_token()
        return self.tools

    def open(self, request, timeout):
        self.assertEqual(request.get_header('X-ziwei-device-token'), 'SYNTHETIC_DEVICE_CREDENTIAL')
        self.assertLessEqual(timeout, 10)
        self.assertTrue(request.full_url.startswith('https://relay.example/a2a/v1/actions/action_isolated/mcp-oauth/'))
        operation = request.full_url.rsplit('/', 1)[1]
        body = None if request.data is None else json.loads(request.data)
        self.calls.append((operation, request.method, body))
        if operation == 'start':
            self.assertEqual(body, {})
            value = {'redirectUri': 'https://relay.example/api/mcp-oauth/callback',
                     'expiresAt': (datetime.now(timezone.utc) + timedelta(minutes=6)).isoformat()}
        elif operation == 'authorization':
            self.assertEqual(body, {'authorizationUrl': self.authorization_url})
            value = {'ok': True}
        else:
            self.assertEqual(request.method, 'GET')
            value = self.polls.pop(0) if self.polls else {'status': 'callback', 'callback': self.callback}
        return self.response(value)

    def response(self, value):
        response = io.BytesIO(json.dumps(value).encode())
        response.status = 200
        return response

    def run_helper(self):
        os.environ.setdefault('ZIWEI_MCP_OAUTH_API_BASE', 'https://relay.example')
        os.environ.setdefault('ZIWEI_MCP_OAUTH_DEVICE_TOKEN', 'SYNTHETIC_DEVICE_CREDENTIAL')
        os.environ.setdefault('ZIWEI_MCP_OAUTH_ACTION_ID', 'action_isolated')
        return helper.authorize_mcp('reports', 'reports', self.config)

    def expect_code(self, code):
        with self.assertRaises(helper.NativeOperationError) as error:
            self.run_helper()
        self.assertEqual(error.exception.code, code)
        self.assertEqual(str(error.exception), code)
        self.assertEqual(self.current_home.get(), str(self.home))
        self.assertIsNone(self.secret_scope.get())

    def test_new_auth_uses_original_native_state_and_issuer_without_mutating_config(self):
        original = json.loads(json.dumps(self.config))
        value = self.run_helper()
        self.assertEqual(value, {'server': 'reports', 'connected': True,
            'tools': [{'name': 'read_report', 'description': 'Read the selected report'}], 'toolsCount': 1,
            'credentialLocation': 'target_profile', 'loadedForNextRun': True})
        self.assertEqual([row[0] for row in self.calls], ['start', 'authorization', 'callback'])
        self.assertEqual(self.config, original)
        self.assertEqual(self.evictions, [('reports', str(self.home))])

    def test_valid_native_grant_is_reused_without_starting_relay(self):
        self.save_token(); before = self.tokens.read_bytes(); self.mode = 'cached'
        self.assertTrue(self.run_helper()['connected'])
        self.assertEqual(self.tokens.read_bytes(), before)
        self.assertEqual(self.calls, [])

    def test_native_refresh_is_preserved_without_browser_reauth(self):
        self.save_token(); self.mode = 'refresh'
        self.assertTrue(self.run_helper()['connected'])
        self.assertIn('SYNTHETIC_NATIVE_REFRESHED', self.tokens.read_text())
        self.assertEqual(self.calls, [])

    def test_failed_probe_keeps_existing_grant_and_redacts_all_diagnostics(self):
        self.save_token(); before = self.tokens.read_bytes(); self.mode = 'fail'
        output = io.StringIO()
        with patch('sys.stderr', output):
            self.expect_code('MCP_OAUTH_CONNECTION_FAILED')
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(self.tokens.read_bytes(), before)

    def test_native_bind_fallback_is_denied_before_any_listener(self):
        self.mode = 'bind'
        self.expect_code('MCP_OAUTH_REQUIRES_DEPENDENCY')

    def test_wrong_state_is_rejected_by_native_flow(self):
        self.callback['state'] = 'attacker-state'
        self.expect_code('MCP_OAUTH_STATE_MISMATCH')
        self.assertFalse(self.tokens.exists())

    def test_provider_denial_never_returns_provider_error_details(self):
        self.callback = {'error': 'PROVIDER_SECRET_ERROR', 'state': 'sdk-state'}
        self.expect_code('MCP_OAUTH_DENIED')

    def test_cancellation_and_expiry_are_terminal(self):
        for status, code in [('cancelled', 'MCP_OAUTH_CANCELLED'), ('expired', 'MCP_OAUTH_EXPIRED')]:
            with self.subTest(status=status):
                self.polls = [{'status': status}]
                self.expect_code(code)

    def test_waiting_polls_until_callback(self):
        self.polls = [{'status': 'waiting'}]
        with patch.object(helper, 'POLL_SECONDS', 0):
            self.assertTrue(self.run_helper()['connected'])
        self.assertEqual(sum(row[0] == 'callback' for row in self.calls), 2)

    def test_callback_wait_is_bounded(self):
        with patch.object(helper, 'CALLBACK_SECONDS', 0):
            self.expect_code('MCP_OAUTH_EXPIRED')

    def test_network_failure_does_not_remove_existing_grant(self):
        self.save_token(); before = self.tokens.read_bytes()
        with patch.object(helper.Relay, 'request', side_effect=helper.NativeOperationError('MCP_OAUTH_RELAY_FAILED')):
            self.expect_code('MCP_OAUTH_RELAY_FAILED')
        self.assertEqual(self.tokens.read_bytes(), before)

    def test_wrong_relay_redirect_is_rejected(self):
        with patch.object(helper.Relay, 'request', return_value={'redirectUri': 'https://attacker.example/callback'}):
            self.expect_code('MCP_OAUTH_RELAY_INVALID_RESPONSE')

    def test_wrong_authorization_redirect_never_reaches_relay(self):
        self.authorization_url = 'https://issuer.example/authorize?state=s&redirect_uri=http://127.0.0.1/callback'
        self.expect_code('MCP_OAUTH_REQUIRES_DEPENDENCY')
        self.assertEqual(self.calls, [])

    def test_pinned_loopback_and_explicit_foreign_redirect_are_dependencies(self):
        for oauth in [{'client_id': 'fixture', 'redirect_port': 12345}, {'redirect_uri': 'https://other.example/callback'}, {'flow': 'device'}]:
            with self.subTest(oauth=oauth):
                self.config['oauth'] = oauth
                self.expect_code('MCP_OAUTH_REQUIRES_DEPENDENCY')
        self.assertEqual(self.calls, [])

    def test_provider_defaults_cannot_silently_add_loopback(self):
        self.oauth.apply_oauth_provider_defaults = lambda cfg, **kwargs: cfg.update(client_id='fixture', redirect_port=12345)
        self.expect_code('MCP_OAUTH_REQUIRES_DEPENDENCY')
        self.assertEqual(self.calls, [])

    def test_missing_native_dashboard_is_an_explicit_dependency(self):
        with patch.dict(sys.modules, {'tools.mcp_dashboard_oauth': None}):
            self.expect_code('MCP_OAUTH_REQUIRES_DEPENDENCY')

    def test_no_token_or_empty_tools_cannot_claim_connected(self):
        self.mode = 'missing-token'
        self.expect_code('MCP_OAUTH_TOKEN_NOT_CONFIRMED')
        self.save_token(); self.mode = 'cached'; self.tools = []
        self.expect_code('MCP_OAUTH_NO_TOOLS')

    def test_invalid_token_file_is_not_enough(self):
        self.save_token(''); self.mode = 'cached'
        self.expect_code('MCP_OAUTH_TOKEN_NOT_CONFIRMED')

    def test_http_relay_and_stdio_are_rejected(self):
        with patch.dict(os.environ, {'ZIWEI_MCP_OAUTH_API_BASE': 'http://relay.example'}):
            self.expect_code('MCP_OAUTH_INVALID_CONFIGURATION')
        self.config['command'] = 'untrusted-stdio'
        self.expect_code('MCP_OAUTH_INVALID_CONFIGURATION')

    def test_device_header_is_not_forwarded_on_redirect_or_http_error(self):
        self.assertIsNone(helper.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://attacker.example'))
        with patch.object(helper, 'build_opener', return_value=types.SimpleNamespace(open=lambda *a, **k: (_ for _ in ()).throw(HTTPError('https://relay.example/SECRET', 302, 'SECRET', {}, None)))):
            self.expect_code('MCP_OAUTH_RELAY_FAILED')

    def test_relay_json_is_bounded_and_malformed_data_is_redacted(self):
        for raw in [b'not-json SECRET', b'x' * 65537, b'[]']:
            response = io.BytesIO(raw); response.status = 200
            with patch.object(helper, 'build_opener', return_value=types.SimpleNamespace(open=lambda *a, **k: response)):
                self.expect_code('MCP_OAUTH_RELAY_INVALID_RESPONSE')


if __name__ == '__main__':
    unittest.main()
