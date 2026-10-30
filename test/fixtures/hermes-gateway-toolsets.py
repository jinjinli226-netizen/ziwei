"""Installed native toolset/schema validation; no Gateway, model, network or real HOME."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import platform
import sys

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
request = json.loads(sys.stdin.read())
root = Path(request['root']).resolve()
platform.uname()
os.environ.update(HERMES_HOME=str(root / 'home'), HERMES_MANAGED_DIR=str(root / 'managed'),
                  HOME=str(root / 'user'), USERPROFILE=str(root / 'user'),
                  LOCALAPPDATA=str(root / 'local'), APPDATA=str(root / 'roaming'))
for key in list(os.environ):
    if key.startswith(('ZIWEI_', 'CONTROL_MCP_')):
        os.environ.pop(key)


def audit(event, args):
    if event.startswith(('socket.connect', 'socket.bind', 'socket.getaddrinfo', 'subprocess.', 'os.exec', 'os.spawn', 'os.system')):
        raise AssertionError('NO_NETWORK_OR_PROCESS')
    if event == 'open' and not isinstance(args[0], int):
        name, mode, flags = args
        target = Path(name).resolve()
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND) and not target.is_relative_to(root):
            raise AssertionError('NO_EXTERNAL_WRITE')
        if not target.is_relative_to(root) and target.name in ('.env', 'auth.json', 'state.db', 'ziwei_user.json'):
            raise AssertionError('NO_PRIVATE_READ')


sys.addaudithook(audit)
sys.path.insert(0, request['nativeRoot'])
from gateway.session_policy import _resolve_toolsets
from gateway.session_local_editor import validate_editor
from gateway.session_local_mcp import fingerprint
from hermes_state_runtime import RuntimeStoreError

spec = importlib.util.spec_from_file_location('gateway_bridge', request['bridge'])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
selected = ['web', 'browser', 'file', 'terminal', 'vision', 'skills', 'todo', 'memory',
            'session_search', 'code_execution', 'ziwei_autonomy', 'ziwei_management']
native_config = {'plugins': {'enabled': [], 'disabled': []}, 'agent': {'disabled_toolsets': []}, 'mcp_servers': {}}


def resolve(names):
    return _resolve_toolsets({'toolsets': names}, copy.deepcopy(native_config), 'oneshot', False)


def refused(names):
    try:
        resolve(names)
    except RuntimeStoreError as error:
        assert error.reason == 'invalid_params' and error.field == 'toolsets'
        return {'reason': error.reason, 'field': error.field, 'detail': error.detail}
    raise AssertionError('native parser accepted an unknown toolset')


raw_refusal = refused(selected)
management_refusal = refused(['ziwei_management'])
home = root / 'home'
home.mkdir(parents=True, exist_ok=True)
overlay = root / 'overlay'
overlay.mkdir()
entry = {'command': 'fixture-node', 'args': ['fixture-management.mjs'], 'env': {'ZIWEI_MCP_TOKEN': 'fixture-management-secret'}}
(overlay / 'config.yaml').write_text(json.dumps({'mcp_servers': {'ziwei_management': entry}}), encoding='utf-8')
effective = {'mcp_servers': {'ziwei_management': entry}, 'platform_toolsets': {'cli': selected}, 'agent': {'disabled_toolsets': []}}
config = type('Config', (), {'load_config': staticmethod(lambda: effective)})
isolation = {'kind': 'hermes-bot', 'employeeId': 'employee-fixture', 'revision': 1}
os.environ.update(ZIWEI_BOT_ACTION_ID='action-first', ZIWEI_BOT_DEVICE_TOKEN='fixture-device-secret', ZIWEI_API_BASE='https://fixture.invalid')
servers = bridge._overlay_servers(config, str(overlay), RuntimeError, isolation)
assert {row['name'] for row in servers} == {'ziwei_management', 'ziwei_autonomy'}
validate_editor('oneshot', {'mcp_servers': servers})
first_fingerprint = fingerprint(servers)
os.environ['ZIWEI_BOT_ACTION_ID'] = 'action-next'
next_servers = bridge._overlay_servers(config, str(overlay), RuntimeError, isolation)
assert first_fingerprint != fingerprint(next_servers), 'new action must rebind the owner-held MCP specification'
assert next(row for row in servers if row['name'] == 'ziwei_autonomy')['env'][0]['value'] == 'action-first'
state = bridge._Session(home, 'fixture', 'custom', None, servers, isolation, RuntimeError)
state.describe({'profile_id': str(home), 'authority_epoch': 1, 'session_create': {'shell_private_mcp_v1': True}})
sent = []


class Native:
    async def rpc(self, method, **params):
        if method == 'session.create':
            resolve(params['toolsets'])
            validate_editor(params['source'], params['editor'])
            assert params['toolsets'] == selected[:-2]
            assert params['client_env'] == {'PATH': 'fixture-path'}
            sent.append(params)
        elif method == 'session.resume':
            validate_editor('oneshot', params['editor'])
        else:
            raise AssertionError(method)
        return {'stored_session_id': 'session-fixture', 'authority_epoch': 1, 'info': {'profile_id': str(home)}}


client = bridge._Client(Native(), state, RuntimeError)
coroutine = client.rpc('session.create', source='oneshot', toolsets=selected,
                       client_env={'PATH': 'fixture-path', 'ZIWEI_MCP_TOKEN': 'fixture-management-secret',
                                   'ZIWEI_BOT_ACTION_ID': 'action-first', 'ZIWEI_BOT_DEVICE_TOKEN': 'fixture-device-secret',
                                   'ZIWEI_API_BASE': 'https://fixture.invalid'})
try:
    coroutine.send(None)
except StopIteration:
    pass
assert len(sent) == 1
unknown_refusal = refused(['custom-unmapped'])
effective['agent']['disabled_toolsets'] = ['all']
effective['mcp_servers'] = {}
assert bridge._overlay_servers(config, str(overlay), RuntimeError, isolation) == []
effective['agent']['disabled_toolsets'] = []
os.environ.pop('ZIWEI_BOT_DEVICE_TOKEN')
assert bridge._overlay_servers(config, str(overlay), RuntimeError, isolation) == []
print(json.dumps({'rawRefusal': raw_refusal, 'managementRefusal': management_refusal,
                  'adapted': True, 'nativeToolsets': sorted(resolve(selected[:-2])),
                  'privateServers': sorted(row['name'] for row in servers),
                  'unknownRefusal': unknown_refusal, 'scopeChanged': True, 'externalCalls': 0}))
