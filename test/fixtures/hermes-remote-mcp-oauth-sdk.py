"""Offline end-to-end native MCP SDK test: only HTTP transports/relay are simulated."""
import asyncio
import base64
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

ROOT, SOURCE = map(Path, sys.argv[1:3])


def no_external_io(event, args):
    if event in ('socket.connect', 'socket.bind', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system'):
        raise AssertionError('TEST_EXTERNAL_IO_DENIED')


sys.addaudithook(no_external_io)

with tempfile.TemporaryDirectory(prefix='ziwei-oauth-sdk-') as temp:
    home = Path(temp).resolve() / 'target-profile'
    home.mkdir()
    os.environ.clear()
    os.environ.update({'HOME': str(home), 'HERMES_HOME': str(home), 'PATH': '/usr/bin:/bin'})
    sys.path.insert(0, str(SOURCE))
    spec = importlib.util.spec_from_file_location('isolated_remote_mcp', ROOT / 'src/hermes-remote-mcp-oauth.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)

    # Real Hermes imports, real SDK session/provider, real native storage, and
    # real native cross-thread context propagation. No native function is stubbed.
    import httpx
    import httpx2
    from tools.mcp_oauth import HermesTokenStorage
    from hermes_cli.mcp_config import _probe_single_server
    from tools.mcp_oauth_manager import get_manager

    origin = 'https://oauth.example'
    resource = 'https://mcp.example/mcp'
    callback = 'https://relay.example/api/mcp-oauth/callback'
    requests = []
    relay_calls = []
    state = {}
    mode = ['new']
    granted_access = ['SYNTHETIC_ACCESS_ONE']
    configured = {'url': resource, 'auth': 'oauth', 'oauth': {'scope': 'reports:read'}}

    def transport_for(module):
        def respond(request):
            url = str(request.url)
            requests.append((request.method, url))
            assert 'x-ziwei-device-token' not in request.headers
            assert 'ZIWEI_MCP_OAUTH_DEVICE_TOKEN' not in os.environ
            if mode[0] == 'network-failure':
                raise module.ConnectError('SYNTHETIC_PRIVATE_NETWORK_DIAGNOSTIC', request=request)
            if '.well-known/oauth-protected-resource' in url:
                return module.Response(200, json={'resource': resource, 'authorization_servers': [origin], 'scopes_supported': ['reports:read']})
            if '.well-known/oauth-authorization-server' in url or '.well-known/openid-configuration' in url:
                return module.Response(200, json={'issuer': origin, 'authorization_endpoint': origin + '/authorize',
                    'token_endpoint': origin + '/token', 'registration_endpoint': origin + '/register',
                    'response_types_supported': ['code'], 'grant_types_supported': ['authorization_code', 'refresh_token'],
                    'token_endpoint_auth_methods_supported': ['none'], 'code_challenge_methods_supported': ['S256'],
                    'authorization_response_iss_parameter_supported': True, 'scopes_supported': ['reports:read']})
            if url == origin + '/register':
                body = json.loads(request.content)
                assert body['redirect_uris'] == [callback]
                assert body['token_endpoint_auth_method'] == 'none'
                return module.Response(201, json={**body, 'client_id': 'SYNTHETIC_DCR_CLIENT'})
            if url == origin + '/token':
                body = parse_qs(request.content.decode())
                assert body['client_id'] == ['SYNTHETIC_DCR_CLIENT']
                if body['grant_type'] == ['authorization_code']:
                    assert body['code'] == ['SYNTHETIC_CODE']
                    assert body['redirect_uri'] == [callback]
                    verifier = body['code_verifier'][0]
                    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
                    assert state['code_challenge'] == [challenge]
                    assert state['code_challenge_method'] == ['S256']
                else:
                    assert mode[0] == 'refresh'
                    assert body['grant_type'] == ['refresh_token']
                    assert body['refresh_token'] == ['SYNTHETIC_REFRESH_ONE']
                    granted_access[0] = 'SYNTHETIC_ACCESS_TWO'
                return module.Response(200, json={'access_token': granted_access[0], 'token_type': 'Bearer',
                    'refresh_token': 'SYNTHETIC_REFRESH_ONE', 'scope': 'reports:read', 'expires_in': 3600})
            assert url == resource, 'Unexpected synthetic endpoint'
            if request.headers.get('authorization') != 'Bearer ' + granted_access[0]:
                return module.Response(401, headers={'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"'})
            if request.method in ('GET', 'DELETE'):
                return module.Response(405)
            body = json.loads(request.content)
            if body.get('method') == 'initialize':
                result = {'protocolVersion': body['params']['protocolVersion'], 'capabilities': {'tools': {}},
                    'serverInfo': {'name': 'isolated-reports', 'version': '1'}}
            elif body.get('method') == 'tools/list':
                result = {'tools': [{'name': 'read_report', 'description': 'Read an authorized report', 'inputSchema': {'type': 'object'}}]}
            elif 'id' not in body:
                return module.Response(202)
            else:
                raise AssertionError('Unexpected MCP method')
            return module.Response(200, json={'jsonrpc': '2.0', 'id': body['id'], 'result': result})
        return module.MockTransport(respond)

    class RelayResponse(io.BytesIO):
        status = 200

    class RelayOpener:
        def open(self, request, timeout):
            assert request.get_header('X-ziwei-device-token') == 'SYNTHETIC_DEVICE'
            operation = request.full_url.rsplit('/', 1)[1]
            relay_calls.append(operation)
            if operation == 'start':
                result = {'redirectUri': callback, 'expiresAt': (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()}
            elif operation == 'authorization':
                url = json.loads(request.data)['authorizationUrl']
                assert urlsplit(url).netloc == 'oauth.example'
                state.update(parse_qs(urlsplit(url).query))
                assert state['redirect_uri'] == [callback]
                result = {'ok': True}
            else:
                assert operation == 'callback'
                result = {'status': 'callback', 'callback': {'code': 'SYNTHETIC_CODE', 'state': state['state'][0], 'iss': origin}}
            return RelayResponse(json.dumps(result).encode())

    def run():
        os.environ.update({'ZIWEI_MCP_OAUTH_API_BASE': 'https://relay.example',
            'ZIWEI_MCP_OAUTH_DEVICE_TOKEN': 'SYNTHETIC_DEVICE', 'ZIWEI_MCP_OAUTH_ACTION_ID': 'synthetic_action'})
        return helper.authorize_mcp('reports', 'reports', configured)

    with ExitStack() as patches:
        patches.enter_context(patch.object(helper, 'build_opener', return_value=RelayOpener()))
        for module in (httpx, httpx2):
            original_init = module.AsyncClient.__init__
            transport = transport_for(module)
            def patched_init(self, *args, _original=original_init, _transport=transport, **kwargs):
                kwargs.update(transport=_transport, mounts={}, trust_env=False)
                return _original(self, *args, **kwargs)
            patches.enter_context(patch.object(module.AsyncClient, '__init__', patched_init))

        result = run()
        assert result == {'server': 'reports', 'connected': True,
            'tools': [{'name': 'read_report', 'description': 'Read an authorized report'}], 'toolsCount': 1,
            'credentialLocation': 'target_profile', 'loadedForNextRun': True}
        assert relay_calls == ['start', 'authorization', 'callback']
        storage = HermesTokenStorage('reports', hermes_home=str(home))
        assert asyncio.run(storage.get_tokens()).access_token == 'SYNTHETIC_ACCESS_ONE'
        files = list((home / 'mcp-tokens').glob('*'))
        assert files and all(p.resolve().is_relative_to(home) for p in files)
        original = {p.name: p.read_bytes() for p in files if p.is_file()}

        relay_calls.clear()
        requests.clear()
        mode[0] = 'cached'
        assert run()['connected']
        assert relay_calls == []
        assert not any(url.endswith(('/register', '/token')) for _, url in requests)
        assert all((home / 'mcp-tokens' / name).read_bytes() == value for name, value in original.items())

        # Persist expiry using the native store, then let the unmodified SDK
        # refresh it and verify the next run never enters the browser relay.
        tokens = asyncio.run(storage.get_tokens())
        tokens.expires_in = -60
        asyncio.run(storage.set_tokens(tokens))
        mode[0] = 'refresh'
        requests.clear()
        assert run()['connected']
        assert relay_calls == []
        assert ('POST', origin + '/token') in requests
        assert asyncio.run(storage.get_tokens()).access_token == 'SYNTHETIC_ACCESS_TWO'

        before_failure = {p.name: p.read_bytes() for p in (home / 'mcp-tokens').glob('*') if p.is_file()}
        mode[0] = 'network-failure'
        try:
            run()
        except helper.NativeOperationError as error:
            assert error.code == 'MCP_OAUTH_CONNECTION_FAILED'
            assert str(error) == error.code
        else:
            raise AssertionError('Network failure unexpectedly connected')
        assert relay_calls == []
        assert all((home / 'mcp-tokens' / name).read_bytes() == value for name, value in before_failure.items())

    print('Native SDK integration passed: DCR + PKCE + callback + MCP tools + target HOME + cached reuse + refresh + failure retention; no sockets or subprocesses')
