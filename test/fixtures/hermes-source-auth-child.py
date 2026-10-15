"""Installed native auth against synthetic stores; every socket operation is forbidden."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sqlite3
import sys
import time
from unittest.mock import patch
from urllib.parse import parse_qs


def no_network(*args, **kwargs):
    raise AssertionError('Native auth fixture must not use a network or listener')


for method in ('connect', 'connect_ex', 'bind', 'listen'):
    setattr(socket.socket, method, no_network)
socket.create_connection = no_network

request = json.loads(sys.argv[2])
spec = importlib.util.spec_from_file_location('bootstrap', sys.argv[1])
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)
launcher = Path(sys.executable).with_name('hermes.exe' if os.name == 'nt' else 'hermes')
current = bootstrap.binding(launcher)
bootstrap.prepare_creator_home(current)

from hermes_cli import auth, auth_codex, config
from hermes_constants import get_hermes_home
import hermes_state
from tools.memory_tool import get_memory_dir
import httpx

home = Path(os.environ['ZIWEI_CREATOR_HOME']).resolve()
source = Path(os.environ['ZIWEI_CREATOR_SOURCE_HOME']).resolve()
assert auth._auth_file_path() == source / 'auth.json'
assert Path(auth._save_auth_store.__code__.co_filename).resolve() == Path(current['paths']['auth'])
assert Path(auth_codex._save_codex_tokens.__code__.co_filename).resolve() == Path(current['paths']['auth_codex'])
assert config.get_config_path().resolve() == home / 'config.yaml'
assert get_hermes_home().resolve() == home
assert hermes_state._default_db_path().resolve() == home / 'state.db'
assert get_memory_dir().resolve() == home / 'memories'
assert os.environ.get('HTTP_PROXY') == 'http://127.0.0.1:19001'
assert os.environ.get('HTTPS_PROXY') == 'http://127.0.0.1:19001'
with sqlite3.connect(hermes_state._default_db_path()) as database:
    database.execute('CREATE TABLE IF NOT EXISTS fixture_identity (name TEXT PRIMARY KEY)')
    database.execute('INSERT OR IGNORE INTO fixture_identity VALUES (?)', (home.name,))
(get_memory_dir() / 'MEMORY.md').write_text('MEMORY ' + home.name)

calls = []
source_before = (source / 'auth.json').read_bytes()
failure = None


def endpoint(http_request):
    assert str(http_request.url) == auth_codex.CODEX_OAUTH_TOKEN_URL
    params = parse_qs(http_request.content.decode())
    assert params['grant_type'] == ['refresh_token']
    assert params['refresh_token'] == [request['oldTokens']['refresh_token']]
    calls.append('refresh')
    with Path(request['journal']).open('a') as journal:
        journal.write('refresh\n')
    time.sleep(0.1)  # A peer must wait on Hermes's actual source-store lock.
    if request['mode'] == 'invalid_grant':
        return httpx.Response(401, request=http_request, json={
            'error': 'invalid_grant', 'error_description': 'Synthetic refresh credential is invalid.'})
    return httpx.Response(200, request=http_request, json=request['freshTokens'])


def mock_client(**kwargs):
    return httpx.Client(transport=httpx.MockTransport(endpoint), **kwargs)


with patch.object(auth_codex, '_codex_http_client', mock_client), \
        patch.object(auth, '_kernel_lock', wraps=auth._kernel_lock) as kernel_lock, \
        patch.object(auth, 'atomic_json_write', wraps=auth.atomic_json_write) as atomic_write, \
        patch.object(auth, '_import_codex_cli_tokens', return_value=None) as external_login:
    if request['mode'] == 'write':
        with auth._auth_store_lock():
            store = auth._load_auth_store()
            store['fixture_native_write'] = True
            assert auth._save_auth_store(store) == source / 'auth.json'
        auth_codex._save_codex_tokens(request['freshTokens'])
        result = auth.resolve_codex_runtime_credentials()
        assert auth._load_auth_store()['fixture_native_write'] is True
    elif request['mode'] == 'stale':
        stale = dict(auth_codex._read_codex_tokens()['tokens'])
        assert stale == request['oldTokens']
        Path(request['ready']).touch()
        deadline = time.monotonic() + 15
        while not Path(request['go']).exists():
            assert time.monotonic() < deadline, 'Parent did not release synthetic refresh barrier'
            time.sleep(0.01)
        tokens = auth_codex._refresh_codex_auth_tokens(stale, 5)
        result = {'api_key': tokens['access_token']}
    elif request['mode'] == 'invalid_grant':
        try:
            auth.resolve_codex_runtime_credentials()
        except auth.AuthError as error:
            assert error.code == 'invalid_grant'
            assert error.relogin_required is True
            failure = {'code': error.code, 'relogin_required': error.relogin_required}
        else:
            raise AssertionError('Rejected native refresh must not become successful credentials')
        # Exercise native failure/recovery selection, but never open another real app's store.
        assert external_login.call_count == 1
        assert (source / 'auth.json').read_bytes() == source_before
        result = None
    else:
        assert request['mode'] == 'resolve'
        result = auth.resolve_codex_runtime_credentials()
    saved = auth_codex._read_codex_tokens()['tokens']
    if failure:
        assert saved == request['oldTokens']
        assert atomic_write.call_count == 0
    else:
        assert result['api_key'] == request['freshTokens']['access_token']
        assert saved == request['freshTokens']
    assert kernel_lock.call_count > 0
    writes = [str(Path(call.args[0]).resolve()) for call in atomic_write.call_args_list]
    assert all(target == str(source / 'auth.json') for target in writes)
    if not failure and (request['mode'] == 'write' or calls):
        assert writes, 'Native atomic source-store persistence was not used'

assert not (home / 'auth.json').exists()
assert not (home / 'auth.lock').exists()
assert (source / 'auth.lock').exists()
assert not (source / 'state.db').exists()
assert not (source / 'memories' / 'MEMORY.md').exists()
print(json.dumps({'refreshCalls': len(calls), 'source': str(source), 'home': str(home),
                  'nativeLockCalls': kernel_lock.call_count, 'atomicWritePaths': writes,
                  'externalLoginProbeCalls': external_login.call_count, 'failure': failure,
                  'credentialsResolved': result is not None,
                  'accessDigest': hashlib.sha256(result['api_key'].encode()).hexdigest() if result else None}))
