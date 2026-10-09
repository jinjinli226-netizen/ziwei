"""Execution-only compatibility for Hermes' raw-config MCP startup gate.

The native launcher owns profile selection, auth refresh and the agent itself.
Only the cheap discovery gate reads the effective managed configuration here.
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
    sources = [launcher, *(Path(value) for value in paths.values())]
    return {'paths': paths, 'fingerprint': hashlib.sha256(b'\0'.join(p.read_bytes() for p in sources)).hexdigest()}


def binding(launcher):
    try:
        return _binding(launcher)
    except Exception:
        raise UnsupportedNativeHermes('binding') from None


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
    native = importlib.import_module('hermes_cli.main')
    startup = importlib.import_module('hermes_cli.mcp_startup')
    config = importlib.import_module('hermes_cli.config')
    managed = importlib.import_module('hermes_cli.managed_scope')
    for name, module in [('main', native), ('mcp_startup', startup), ('config', config), ('managed_scope', managed)]:
        if str(Path(module.__file__).resolve()) != current['paths'][name]:
            raise UnsupportedNativeHermes('changed')
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
    def fail_safe():
        print('Hermes native MCP bootstrap is incompatible or changed; update Hermes/ziwei_user and retry. Original profile and authentication were preserved.', file=sys.stderr)
        sys.exit(125)

    try:
        outcome = run()
    except Exception:
        # Never expose config bodies, environment values or provider credentials.
        fail_safe()
    try:
        # Native model/provider errors retain the original CLI's behavior.
        sys.exit(outcome() if callable(outcome) else outcome)
    except UnsupportedNativeHermes:
        fail_safe()
