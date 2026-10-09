"""Execution-only compatibility for Hermes' raw-config MCP startup gate.

The native launcher owns profile selection, auth refresh and the agent itself.
The discovery gate reads effective managed configuration. Trusted Creator
executions additionally route native employee state to a persistent private
home while retaining the selected profile's single native auth store.
"""
import ast
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import zipfile


class UnsupportedNativeHermes(Exception):
    pass


def _binding(launcher):
    launcher = Path(launcher).resolve(strict=True)
    if zipfile.is_zipfile(launcher):
        with zipfile.ZipFile(launcher) as archive:
            console = archive.read('__main__.py').decode('utf-8')
    else:
        console = launcher.read_text(encoding='utf-8')
    tree = ast.parse(console)
    if not any(isinstance(node, ast.ImportFrom) and node.module == 'hermes_cli.main'
               and any(item.name == 'main' for item in node.names) for node in ast.walk(tree)):
        raise UnsupportedNativeHermes('entrypoint')
    paths = {}
    for name in ('main', 'mcp_startup', 'managed_scope', 'config'):
        spec = importlib.util.find_spec('hermes_cli.' + name)
        if not spec or not spec.origin:
            raise UnsupportedNativeHermes('module')
        target = Path(spec.origin).resolve(strict=True)
        if target.suffix != '.py':
            raise UnsupportedNativeHermes('source')
        paths[name] = str(target)
    if len({str(Path(value).parent) for value in paths.values()}) != 1:
        raise UnsupportedNativeHermes('package')
    startup = Path(paths['mcp_startup']).read_text(encoding='utf-8')
    managed = Path(paths['managed_scope']).read_text(encoding='utf-8')
    if '_has_configured_mcp_servers' not in startup or 'HERMES_MANAGED_DIR' not in managed:
        raise UnsupportedNativeHermes('overlay')
    if os.environ.get('ZIWEI_CREATOR_HOME'):
        root = Path(paths['main']).parent.parent
        isolated_sources = {'auth': 'hermes_cli.auth', 'auth_codex': 'hermes_cli.auth_codex',
                            'constants': 'hermes_constants', 'state': 'hermes_state',
                            'memory': 'tools.memory_tool', 'prompt': 'agent.prompt_builder',
                            'logging': 'hermes_logging'}
        for name, module_name in isolated_sources.items():
            spec = importlib.util.find_spec(module_name)
            target = Path(spec.origin).resolve(strict=True) if spec and spec.origin else None
            if not target or target.suffix != '.py' or not target.is_relative_to(root):
                raise UnsupportedNativeHermes('creator source')
            paths[name] = str(target)
        # Bound source paths and shape, not a separately discovered Python/package.
        required = {'auth': ('_auth_file_path', '_load_auth_store', '_save_auth_store', '_auth_store_lock'),
                    'auth_codex': ('_read_codex_tokens', '_save_codex_tokens'),
                    'constants': ('get_hermes_home', 'set_hermes_home_override'),
                    'state': ('_default_db_path',), 'memory': ('get_memory_dir',),
                    'prompt': ('load_soul_md',), 'logging': ('setup_logging',)}
        for name, functions in required.items():
            tree = ast.parse(Path(paths[name]).read_text(encoding='utf-8'))
            found = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
            if not set(functions).issubset(found):
                raise UnsupportedNativeHermes('creator shape')
        if '_apply_profile_override()' not in Path(paths['main']).read_text(encoding='utf-8'):
            raise UnsupportedNativeHermes('creator profile')
    sources = [launcher, *(Path(value) for value in paths.values())]
    return {'paths': paths, 'fingerprint': hashlib.sha256(b'\0'.join(p.read_bytes() for p in sources)).hexdigest()}


def binding(launcher):
    try:
        return _binding(launcher)
    except Exception:
        raise UnsupportedNativeHermes('binding') from None


def prepare_creator_home(current):
    """Process-only routing; preserve the native lock/atomic refresh implementation."""
    home_value = os.environ.get('ZIWEI_CREATOR_HOME', '').strip()
    if not home_value:
        return None
    source_value = os.environ.get('ZIWEI_CREATOR_SOURCE_HOME', '').strip()
    if not source_value or not Path(home_value).is_absolute() or not Path(source_value).is_absolute():
        raise UnsupportedNativeHermes('creator home')
    home, source = Path(home_value).resolve(strict=True), Path(source_value).resolve(strict=True)
    if home == source or home.is_symlink() or Path(home_value).is_symlink():
        raise UnsupportedNativeHermes('creator home')
    metadata = json.loads((home / 'ziwei-instance.json').read_text(encoding='utf-8'))
    expected = {'templateId': 'ziwei-employee-creator', 'key': os.environ.get('ZIWEI_CREATOR_KEY'),
                'workspace': os.environ.get('ZIWEI_CREATOR_WORKSPACE'),
                'employeeId': os.environ.get('ZIWEI_CREATOR_EMPLOYEE_ID'),
                'sourceProfile': os.environ.get('ZIWEI_CREATOR_PROFILE')}
    if any(metadata.get(key) != value for key, value in expected.items()) or Path(metadata.get('sourceHome', '')).resolve() != source:
        raise UnsupportedNativeHermes('creator binding')
    if (home / 'auth.json').exists() or (home / '.env').exists():
        raise UnsupportedNativeHermes('creator cloned auth')
    # Preserve only the authoritative runtime scope. The native dotenv loader
    # intentionally uses process HERMES_HOME while selecting the source profile,
    # and may otherwise reintroduce an old phone/controller bearer afterwards.
    routing_keys = {'ZIWEI_API_BASE', 'ZIWEI_MCP_WORKSPACE', 'ZIWEI_MCP_TOKEN_FILE',
                    'ZIWEI_MCP_TOKEN', 'ZIWEI_MCP_AUDIT_FILE',
                    'ZIWEI_TERMINAL_API_BASE', 'ZIWEI_TERMINAL_WORKSPACE',
                    'ZIWEI_TERMINAL_TOKEN_FILE', 'ZIWEI_TERMINAL_AUDIT_FILE',
                    'ZIWEI_TERMINAL_EMPLOYEE_ID', 'ZIWEI_TERMINAL_DEVICE_ID',
                    'ZIWEI_CREATOR_HOME', 'ZIWEI_CREATOR_SOURCE_HOME', 'ZIWEI_CREATOR_KEY',
                    'ZIWEI_CREATOR_WORKSPACE', 'ZIWEI_CREATOR_EMPLOYEE_ID', 'ZIWEI_CREATOR_PROFILE'}
    routing_env = {key: os.environ[key] for key in routing_keys if key in os.environ}
    constants = importlib.import_module('hermes_constants')
    if str(Path(constants.__file__).resolve()) != current['paths']['constants']:
        raise UnsupportedNativeHermes('changed')
    # Context override routes all native config/state reads during main import.
    # HERMES_HOME stays at source until the actual native --profile selector has
    # run; its selector uses the launch environment, not this context override.
    constants.set_hermes_home_override(home)
    auth = importlib.import_module('hermes_cli.auth')
    for name, module in [('auth', auth)]:
        if str(Path(module.__file__).resolve()) != current['paths'][name]:
            raise UnsupportedNativeHermes('changed')
    # Only the file selector is replaced. Hermes still owns locks, transactions,
    # atomic writes and OAuth refresh; no refresh token is cloned into the instance.
    auth._auth_file_path = lambda: source / 'auth.json'
    # Load the selected profile's .env into this execution's memory only. Never
    # persist it or allow it to replace trusted scope/home/MCP routing values.
    from dotenv import dotenv_values
    reserved = {'HERMES_HOME', 'HERMES_MANAGED_DIR', 'PYTHONPATH', 'PYTHONHOME',
                'CONTROL_MCP_API_URL', 'CONTROL_MCP_AUTH'}
    for key, value in dotenv_values(source / '.env').items():
        if value is not None and key not in reserved and not key.startswith(('ZIWEI_', 'HERMES_CREATOR_')):
            os.environ[key] = value
    return (home, source, expected, routing_env)


def confirm_creator_home(current, config, prepared):
    if not prepared:
        return None
    home, source, expected, routing_env = prepared
    # main's import consumed --profile using the native selector. Never silently
    # accept another profile or state/tool caches already initialized elsewhere.
    if Path(os.environ.get('HERMES_HOME', '')).resolve() != source or 'cli' in sys.modules:
        raise UnsupportedNativeHermes('creator profile')
    os.environ['HERMES_HOME'] = str(home)
    for key in tuple(os.environ):
        if key.startswith('ZIWEI_') or key in {'CONTROL_MCP_API_URL', 'CONTROL_MCP_AUTH'}:
            os.environ.pop(key, None)
    os.environ.update(routing_env)
    constants = importlib.import_module('hermes_constants')
    auth = importlib.import_module('hermes_cli.auth')
    effective = config.load_config()
    provider = effective.get('model', {})
    if not isinstance(provider, dict) or provider.get('provider') != 'openai-codex':
        raise UnsupportedNativeHermes('creator provider unsupported')
    memory = effective.get('memory', {})
    if not isinstance(memory, dict) or str(memory.get('provider') or '').strip():
        raise UnsupportedNativeHermes('creator memory provider unsupported')
    if config.get_config_path().resolve() != home / 'config.yaml' or constants.get_hermes_home().resolve() != home or auth._auth_file_path() != source / 'auth.json':
        raise UnsupportedNativeHermes('creator route')
    memory_module = importlib.import_module('tools.memory_tool')
    state_module = importlib.import_module('hermes_state')
    prompt_module = importlib.import_module('agent.prompt_builder')
    for name, module in [('memory', memory_module), ('state', state_module), ('prompt', prompt_module)]:
        if str(Path(module.__file__).resolve()) != current['paths'][name]:
            raise UnsupportedNativeHermes('changed')
    if memory_module.get_memory_dir().resolve() != home / 'memories' or state_module._default_db_path().resolve() != home / 'state.db':
        raise UnsupportedNativeHermes('creator route')
    # Confirm that SOUL uses the same home, without printing its private body.
    soul = (home / 'SOUL.md').read_text(encoding='utf-8').strip()
    if not soul or soul not in (prompt_module.load_soul_md() or ''):
        raise UnsupportedNativeHermes('creator route')
    # The context override was active before main imports logging/config; worker
    # threads additionally inherit the now-isolated HERMES_HOME environment.
    return {'enabled': True, **{key: expected[key] for key in ('key', 'workspace', 'employeeId', 'sourceProfile')}, 'authMode': 'source-native-store'}


def run():
    if len(sys.argv) == 3 and sys.argv[1] == '--probe':
        print(json.dumps(binding(sys.argv[2])))
        return 0
    if len(sys.argv) < 5 or sys.argv[1] != '--launcher' or sys.argv[3] != '--binding':
        raise UnsupportedNativeHermes('arguments')
    launcher = sys.argv[2]
    expected = json.loads(sys.argv[4])
    current = binding(launcher)
    if current != expected:
        raise UnsupportedNativeHermes('changed')
    native_args = sys.argv[5:]
    discover_only = bool(native_args and native_args[0] == '--discover-only')
    if discover_only:
        native_args = native_args[1:]
    if not native_args or native_args[0] != '--':
        raise UnsupportedNativeHermes('arguments')
    overlay = os.environ.get('HERMES_MANAGED_DIR', '').strip()
    if not overlay or not Path(overlay).is_absolute() or not Path(overlay).is_dir():
        raise UnsupportedNativeHermes('overlay')
    sys.argv = [launcher, *native_args[1:]]
    prepared_isolation = prepare_creator_home(current)
    native = importlib.import_module('hermes_cli.main')
    startup = importlib.import_module('hermes_cli.mcp_startup')
    config = importlib.import_module('hermes_cli.config')
    managed = importlib.import_module('hermes_cli.managed_scope')
    for name, module in [('main', native), ('mcp_startup', startup), ('config', config), ('managed_scope', managed)]:
        if str(Path(module.__file__).resolve()) != current['paths'][name]:
            raise UnsupportedNativeHermes('changed')
    isolation = confirm_creator_home(current, config, prepared_isolation)
    if isolation:
        print('ZIWEI_CREATOR_ISOLATION:' + json.dumps(isolation), file=sys.stderr, flush=True)
    original_gate = startup._has_configured_mcp_servers

    def effective_mcp_gate():
        try:
            servers = config.load_config().get('mcp_servers')
            return bool(isinstance(servers, dict) and servers) or original_gate()
        except Exception:
            raise UnsupportedNativeHermes('effective config') from None

    startup._has_configured_mcp_servers = effective_mcp_gate
    if discover_only:
        import logging
        startup.set_mcp_server_filter('all')
        startup.start_background_mcp_discovery(logger=logging.getLogger(__name__), thread_name='ziwei-native-gate-probe')
        startup.wait_for_mcp_discovery(timeout=45, single_query=True)
        from tools.mcp_tool_discovery import get_mcp_status
        statuses = get_mcp_status() or []
        print(json.dumps({'effectiveGate': effective_mcp_gate(),
                          'rawMcpConfigured': bool(config.read_raw_config().get('mcp_servers')),
                          'servers': [{'name': item.get('name'), 'connected': item.get('connected') is True,
                                       'status': item.get('status')} for item in statuses],
                          'externalModelCalls': 0}))
        return 0
    return native.main


if __name__ == '__main__':
    def fail_safe(reason=None):
        if os.environ.get('ZIWEI_CREATOR_HOME'):
            safe_reasons = {'creator provider unsupported': 'The effective provider is not supported for isolated native authentication.',
                            'creator memory provider unsupported': 'The external memory provider has no verified employee namespace.',
                            'creator profile': 'Native profile selection did not match the requested source profile.',
                            'creator binding': 'The persistent instance identity does not match this employee.',
                            'creator cloned auth': 'A cloned authentication file was found in the instance home.'}
            print('Hermes Creator isolation was not confirmed; no model was started. ' + safe_reasons.get(str(reason), 'Update the bound Hermes/ziwei_user adapter; original profile and authentication were preserved.'), file=sys.stderr)
            sys.exit(125)
        print('Hermes native MCP bootstrap is incompatible or changed; update Hermes/ziwei_user and retry. Original profile and authentication were preserved.', file=sys.stderr)
        sys.exit(125)

    try:
        outcome = run()
    except Exception as error:
        # Never expose config bodies, environment values or provider credentials.
        fail_safe(error)
    try:
        # Native model/provider errors retain the original CLI's behavior.
        sys.exit(outcome() if callable(outcome) else outcome)
    except UnsupportedNativeHermes as error:
        fail_safe(error)
