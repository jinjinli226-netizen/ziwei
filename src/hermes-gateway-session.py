"""Execution-only bridge to the native owner's private MCP and SDK receipts."""
import argparse
import contextlib
import contextvars
import importlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import sys

_EFFORTS = frozenset({'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'})
_BINDING = ('profile_id', 'session_id', 'admission_id', 'execution_generation', 'authority_epoch')


def _check(condition, reject, code):
    if not condition:
        raise reject(code)


def _identifier(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', value))


def _profile(value):
    return isinstance(value, str) and 0 < len(value) <= 1024 and all(ord(c) >= 32 and ord(c) != 127 for c in value)


def _overlay_servers(config, overlay, reject):
    if not overlay:
        return []
    path = Path(overlay) / 'config.yaml'
    try:
        text = path.read_text(encoding='utf-8')
        try:
            policy = json.loads(text)
        except ValueError:
            spec = importlib.util.spec_from_file_location('ziwei_gateway_yaml', Path(__file__).with_name('hermes-yaml-compat.py'))
            bridge = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(bridge)
            policy = bridge.load_native_yaml().safe_load(text)
        configured = (policy or {}).get('mcp_servers', {})
        effective = config.load_config().get('mcp_servers', {})
        _check(isinstance(configured, dict) and isinstance(effective, dict), reject, 'BOT_GATEWAY_MCP_CONFIG_INVALID')
        servers = []
        for name in ('ziwei_management', 'ziwei-terminal'):
            declaration, entry = configured.get(name), effective.get(name)
            if not declaration or declaration.get('enabled') is False or not entry or entry.get('enabled') is False:
                continue
            _check(isinstance(declaration, dict) and isinstance(entry, dict), reject, 'BOT_GATEWAY_MCP_CONFIG_INVALID')
            def literal(value):
                _check(isinstance(value, str) and '${' not in value, reject, 'BOT_GATEWAY_MCP_ARGUMENT_REFERENCE')
                return value
            def fields(value):
                _check(isinstance(value, dict), reject, 'BOT_GATEWAY_MCP_CONFIG_INVALID')
                result = []
                for key, item in sorted(value.items()):
                    _check(isinstance(key, str) and isinstance(item, str), reject, 'BOT_GATEWAY_MCP_CONFIG_INVALID')
                    def expand(match):
                        variable = match.group(1)
                        _check(variable in os.environ, reject, 'BOT_GATEWAY_MCP_REFERENCE_MISSING')
                        return os.environ[variable]
                    expanded = re.sub(r'\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}', expand, item)
                    _check('${' not in expanded, reject, 'BOT_GATEWAY_MCP_REFERENCE_INVALID')
                    result.append({'name': key, 'value': expanded})
                return result
            # Native effective loading may already expand references. Reject them at the untouched
            # execution layer too, so a credential can never migrate into command/argv/URL.
            for value in [declaration.get('command', ''), declaration.get('url', ''), *declaration.get('args', [])]:
                literal(value)
            if entry.get('url'):
                kind = entry.get('transport', 'http')
                _check(kind in ('http', 'sse', 'streamable-http', 'streamable_http'), reject, 'BOT_GATEWAY_MCP_TRANSPORT_UNSUPPORTED')
                servers.append({'name': name, 'type': 'sse' if kind == 'sse' else 'http',
                                'url': literal(entry['url']), 'headers': fields(entry.get('headers', {}))})
            else:
                args = entry.get('args', [])
                _check(isinstance(args, list), reject, 'BOT_GATEWAY_MCP_CONFIG_INVALID')
                servers.append({'name': name, 'type': 'stdio', 'command': literal(entry.get('command')),
                                'args': [literal(arg) for arg in args], 'env': fields(entry.get('env', {}))})
        secrets = [item['value'] for server in servers for item in server.get('env', []) + server.get('headers', [])
                   if re.search(r'token|secret|password|api.?key|authorization', item['name'], re.I) and item['value']]
        for server in servers:
            for value in [server.get('command', ''), server.get('url', ''), *server.get('args', [])]:
                _check(not any(secret in value for secret in secrets), reject, 'BOT_GATEWAY_MCP_ARGUMENT_SECRET')
        return servers
    except Exception as error:
        if isinstance(error, reject):
            raise
        raise reject('BOT_GATEWAY_MCP_CONFIG_INVALID') from None


class _Session:
    def __init__(self, home, model, provider, effort, servers, isolation, reject):
        self.home, self.model, self.provider, self.effort = home, model, provider, effort
        self.servers, self.isolation, self.reject = servers, isolation, reject
        self.description = None
        self.snapshots, self.admissions = {}, {}
        self.receipts = 0

    def check_home(self):
        _check(Path(os.environ.get('HERMES_HOME', '')).resolve() == self.home,
               self.reject, 'BOT_GATEWAY_HOME_CHANGED')

    def describe(self, result):
        self.check_home()
        contract = result.get('session_create', {})
        _check(contract.get('shell_private_mcp_v1') is True and contract.get('strict_reasoning_receipts_v1') is True,
               self.reject, 'BOT_GATEWAY_CAPABILITY_UNSUPPORTED')
        profile = result.get('profile_id')
        _check(_profile(profile) and Path(profile).resolve() == self.home,
               self.reject, 'BOT_GATEWAY_PROFILE_MISMATCH')
        epoch = result.get('authority_epoch')
        _check(type(epoch) is int and 0 <= epoch <= 2**53 - 1, self.reject, 'BOT_GATEWAY_BINDING_INVALID')
        self.description = result

    def snapshot(self, result):
        _check(self.description is not None, self.reject, 'BOT_GATEWAY_CAPABILITY_UNCONFIRMED')
        sid, profile = result.get('stored_session_id'), result.get('profile_id')
        _check(_identifier(sid) and profile == self.description['profile_id'], self.reject, 'BOT_GATEWAY_SESSION_MISMATCH')
        self.snapshots[sid] = result

    def receipt(self, payload, binding, snapshot):
        reject = self.reject
        _check(isinstance(payload, dict) and isinstance(binding, dict), reject, 'BOT_REASONING_GATEWAY_RECEIPT_INVALID')
        _check(self.effort and payload.get('schemaVersion') == 1 and payload.get('phase') == 'request',
               reject, 'BOT_REASONING_GATEWAY_RECEIPT_INVALID')
        sid, aid = binding.get('session_id'), binding.get('admission_id')
        _check(sid == snapshot.get('stored_session_id') and sid in self.snapshots and _identifier(sid)
               and _identifier(aid) and (sid, aid) in self.admissions,
               reject, 'BOT_REASONING_GATEWAY_BINDING_MISMATCH')
        _check(binding.get('profile_id') == self.description['profile_id'] == snapshot.get('profile_id')
               and binding.get('authority_epoch') == self.description['authority_epoch'],
               reject, 'BOT_REASONING_GATEWAY_BINDING_MISMATCH')
        for field in _BINDING:
            _check(payload.get(field) == binding.get(field), reject, 'BOT_REASONING_GATEWAY_BINDING_MISMATCH')
        for field in ('execution_generation', 'authority_epoch'):
            _check(type(binding.get(field)) is int and 0 <= binding[field] <= 2**53 - 1,
                   reject, 'BOT_REASONING_GATEWAY_BINDING_INVALID')
        generation = self.admissions[(sid, aid)].get('execution_generation')
        if self.admissions[(sid, aid)].get('status') == 'started' and generation is not None:
            _check(binding['execution_generation'] == generation, reject, 'BOT_REASONING_GATEWAY_BINDING_MISMATCH')
        request_id = payload.get('api_request_id')
        _check(isinstance(request_id, str) and re.fullmatch(r'[0-9a-f]{32}', request_id)
               and binding.get('api_request_id', request_id) == request_id,
               reject, 'BOT_REASONING_GATEWAY_REQUEST_ID_INVALID')
        _check(payload.get('model') == self.model and payload.get('provider') == self.provider
               and payload.get('requested') == self.effort, reject, 'BOT_REASONING_GATEWAY_ROUTE_MISMATCH')
        actual, native_actual, status, mode = (payload.get(key) for key in ('actual', 'nativeActual', 'status', 'mode'))
        _check((actual is None or isinstance(actual, str) and actual in _EFFORTS)
               and (native_actual is None or isinstance(native_actual, str) and native_actual in _EFFORTS)
               and status in ('matched', 'mismatch', 'unsupported') and mode in ('native', 'verified_gpt61_sol_max'),
               reject, 'BOT_REASONING_GATEWAY_RECEIPT_INVALID')
        _check(status != 'matched' or actual == self.effort, reject, 'BOT_REASONING_GATEWAY_RECEIPT_INVALID')
        _check(mode != 'verified_gpt61_sol_max' or (self.model == 'gpt-6.1-sol' and self.provider == 'openai-codex'
               and self.effort == 'max'), reject, 'BOT_REASONING_GATEWAY_RECEIPT_INVALID')
        proof = {'schemaVersion': 1, 'employeeId': self.isolation['employeeId'], 'revision': self.isolation['revision'],
                 'provider': self.provider, 'model': self.model, 'requested': self.effort, 'effective': self.effort,
                 'actual': actual, 'nativeActual': native_actual, 'mode': mode, 'actualModel': self.model,
                 'status': status, 'phase': 'request', 'evidence': 'native_gateway_sdk', 'api_request_id': request_id,
                 **{key: binding[key] for key in _BINDING}}
        print('ZIWEI_BOT_REASONING:' + json.dumps(proof), file=sys.stderr, flush=True)
        self.receipts += 1


class _Client:
    def __init__(self, native, state, client_error):
        self.native, self.state, self.client_error = native, state, client_error

    def __getattr__(self, name):
        return getattr(self.native, name)

    async def _resume(self, params):
        try:
            return await self.native.rpc('session.resume', **params)
        except self.client_error as error:
            if str(error) != 'acp_mcp_policy_conflict' or not self.state.servers:
                raise
            # Native CAS/idle/authorization gates, with credentials retained only in owner memory.
            from hermes_cli.gateway_mutations import PreparedMutations
            mutations = PreparedMutations()
            sid = params.get('session_id')
            if not sid:
                plain = {key: value for key, value in params.items() if key != 'editor'}
                sid = (await self.native.rpc('session.resume', **plain))['stored_session_id']
            payload = {'mcp_servers': self.state.servers}
            await mutations.apply(self.native, sid, 'editor_mcp', payload)
            mutations.acknowledge(sid, 'editor_mcp', payload)
            return await self.native.rpc('session.resume', **params)

    async def rpc(self, method, **params):
        state = self.state
        state.check_home()
        if method == 'runtime.describe':
            result = await self.native.rpc(method, **params)
            state.describe(result)
            return result
        _check(state.description is not None, state.reject, 'BOT_GATEWAY_CAPABILITY_UNCONFIRMED')
        params = dict(params)
        if method in ('session.create', 'session.resume'):
            if state.servers:
                _check('editor' not in params, state.reject, 'BOT_GATEWAY_MCP_OVERRIDE_REFUSED')
                params['editor'] = {'mcp_servers': state.servers}
            if method == 'session.create':
                if state.effort:
                    _check(params.get('reasoning') in (None, state.effort), state.reject, 'BOT_REASONING_GATEWAY_CONFLICT')
                    params['reasoning'] = state.effort
                if 'client_env' in params:
                    private_names = {item['name'] for server in state.servers for item in server.get('env', [])}
                    params['client_env'] = {key: value for key, value in params['client_env'].items() if key not in private_names}
                    secrets = [item['value'] for server in state.servers for item in server.get('env', []) + server.get('headers', [])
                               if re.search(r'token|secret|password|api.?key|authorization', item['name'], re.I) and item['value']]
                    _check(not any(secret in value for value in params['client_env'].values() if isinstance(value, str)
                                   for secret in secrets), state.reject, 'BOT_GATEWAY_MCP_CLIENT_ENV_SECRET')
                result = await self.native.rpc(method, **params)
                # A titled create can return an existing session without consuming creation fields.
                # Explicit attach guarantees the current private transport is checked/rebound.
                if state.servers:
                    resume = {'session_id': result['stored_session_id'], 'editor': {'mcp_servers': state.servers}}
                    if params.get('api_key'):
                        resume['api_key'] = params['api_key']
                    result = await self._resume(resume)
            else:
                result = await self._resume(params)
            state.snapshot(result)
            return result
        if method == 'prompt.submit' and state.effort:
            _check(params.get('session_id') in state.snapshots, state.reject, 'BOT_GATEWAY_SESSION_MISMATCH')
            for key, value in {'strict_reasoning_effort': state.effort, 'strict_reasoning_model': state.model,
                               'strict_reasoning_provider': state.provider}.items():
                _check(params.get(key) in (None, value), state.reject, 'BOT_REASONING_GATEWAY_CONFLICT')
                params[key] = value
            result = await self.native.rpc(method, **params)
            aid = result.get('admission_id')
            if aid:
                _check(_identifier(aid), state.reject, 'BOT_GATEWAY_ADMISSION_INVALID')
                state.admissions[(params['session_id'], aid)] = result
            return result
        return await self.native.rpc(method, **params)


def install(config, isolation, *, overlay='', reject=RuntimeError, active=True):
    if not active or not isolation or isolation.get('kind') != 'hermes-bot':
        return False
    try:
        gateway = importlib.import_module('hermes_cli.gateway_chat')
    except ModuleNotFoundError as error:
        if error.name == 'hermes_cli.gateway_chat':
            return False  # Legacy Hermes retains its existing in-process transport guards.
        raise reject('BOT_GATEWAY_SESSION_PROTOCOL_UNSUPPORTED') from None
    original = getattr(gateway, 'run_gateway_chat', None)
    connect = getattr(gateway, 'connect_gateway', None)
    _check(inspect.iscoroutinefunction(original) and callable(connect), reject, 'BOT_GATEWAY_SESSION_PROTOCOL_UNSUPPORTED')
    view_module = importlib.import_module('hermes_cli.gateway_chat_view')
    native_view = view_module.GatewayChatView
    baseline = config.load_config().get('model', {})
    home = Path(os.environ.get('HERMES_HOME', '')).resolve()
    _check(home == Path(os.environ.get('ZIWEI_CREATOR_HOME', '')).resolve()
           and home == Path(config.get_config_path()).resolve().parent, reject, 'BOT_GATEWAY_HOME_MISMATCH')
    model, provider = baseline.get('default'), baseline.get('provider')
    _check(isinstance(model, str) and isinstance(provider, str), reject, 'BOT_GATEWAY_ROUTE_INVALID')
    servers = _overlay_servers(config, overlay, reject)
    effort = os.environ.get('ZIWEI_BOT_REASONING_EFFORT')
    _check(effort is None or effort in _EFFORTS, reject, 'BOT_REASONING_INVALID')
    if not servers and not effort:
        return False
    context = contextvars.ContextVar('ziwei_gateway_execution', default=None)

    class View(native_view):
        def __init__(self, client, snapshot, **kwargs):
            super().__init__(client, snapshot, **kwargs)
            state = context.get()
            if state is not None and state.effort:
                _check(hasattr(self, 'inference_request_callback'), reject, 'BOT_REASONING_GATEWAY_VIEW_UNSUPPORTED')
                self.inference_request_callback = lambda payload, binding: state.receipt(payload, binding, snapshot)

    @contextlib.asynccontextmanager
    async def connect_gateway(*args, **kwargs):
        state = context.get()
        async with connect(*args, **kwargs) as client:
            yield _Client(client, state, importlib.import_module('hermes_cli.gateway_client').GatewayClientError) if state else client

    async def run_gateway_chat(args, *positional, **kwargs):
        # Preserve caller Namespace/argv and all native resume-policy comparisons.
        scoped = argparse.Namespace(**vars(args))
        state = _Session(home, model, provider, effort, servers, isolation, reject)
        token = context.set(state)
        try:
            result = await original(scoped, *positional, **kwargs)
            _check(not effort or state.receipts > 0, reject, 'BOT_REASONING_GATEWAY_RECEIPT_MISSING')
            return result
        finally:
            context.reset(token)

    gateway.connect_gateway = connect_gateway
    gateway.run_gateway_chat = run_gateway_chat
    view_module.GatewayChatView = View
    return True
