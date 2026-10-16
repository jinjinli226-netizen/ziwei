"""Execution-only compatibility for Hermes' raw-config MCP startup gate.

The native launcher owns profile selection, auth refresh and the agent itself.
The discovery gate reads effective managed configuration. Trusted Creator
executions additionally route native employee state to a persistent private
home while retaining the selected profile's single native auth store.
"""
import ast
import base64
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import zipfile


class UnsupportedNativeHermes(Exception):
    pass


def _binding(launcher, multi_images=False, launcher_binding=None, expected=None):
    launcher = Path(launcher).resolve(strict=True)
    wrapper = None
    if launcher_binding is not None:
        if not isinstance(launcher_binding, dict) or launcher_binding.get('schemaVersion') != 1 or not set(launcher_binding).issubset({'schemaVersion', 'wrapper', 'resource', 'isolated', 'installation'}) or not ({'wrapper', 'resource', 'isolated'} & set(launcher_binding)):
            raise UnsupportedNativeHermes('launcher binding')
        if 'wrapper' in launcher_binding:
            reference = launcher_binding['wrapper']
            if not isinstance(reference, dict) or set(reference) != {'path', 'sha256'} or not Path(reference['path']).is_absolute():
                raise UnsupportedNativeHermes('launcher wrapper')
            wrapper = Path(reference['path']).resolve(strict=True)
            if not wrapper.is_file() or hashlib.sha256(wrapper.read_bytes()).hexdigest() != reference['sha256']:
                raise UnsupportedNativeHermes('launcher wrapper changed')
    launcher_resource = (launcher_binding or {}).get('resource')
    if launcher_resource is not None:
        raw = launcher.read_bytes()
        required = {'kind', 'offset', 'size', 'sha256', 'launcherSha256', 'interpreter'}
        if not isinstance(launcher_resource, dict) or set(launcher_resource) != required or launcher_resource['kind'] != 'uv-pe-resource':
            raise UnsupportedNativeHermes('launcher resource')
        offset, size = launcher_resource['offset'], launcher_resource['size']
        if type(offset) is not int or type(size) is not int or offset < 0 or not 0 < size <= 1024 * 1024 or offset + size > len(raw) or raw[:2] != b'MZ' or hashlib.sha256(raw).hexdigest() != launcher_resource['launcherSha256'] or Path(launcher_resource['interpreter']).resolve(strict=True) != Path(sys.executable).resolve(strict=True):
            raise UnsupportedNativeHermes('launcher resource binding')
        data = raw[offset:offset + size]
        if hashlib.sha256(data).hexdigest() != launcher_resource['sha256']:
            raise UnsupportedNativeHermes('launcher resource changed')
    isolated = (launcher_binding or {}).get('isolated')
    if isolated is not None:
        if not isinstance(isolated, dict) or set(isolated) != {'kind', 'interpreter', 'launcherSha256'} or isolated['kind'] != 'distlib-isolated' or not sys.flags.isolated or hashlib.sha256(launcher.read_bytes()).hexdigest() != isolated['launcherSha256'] or Path(isolated['interpreter']).resolve(strict=True) != Path(sys.executable).resolve(strict=True) or not zipfile.is_zipfile(launcher):
            raise UnsupportedNativeHermes('isolated launcher binding')
    elif (launcher_binding or {}).get('installation') is not None:
        raise UnsupportedNativeHermes('installation binding')
    if zipfile.is_zipfile(launcher):
        with zipfile.ZipFile(launcher) as archive:
            console = archive.read('__main__.py').decode('utf-8')
    else:
        console = launcher.read_text(encoding='utf-8')
    tree = ast.parse(console)
    if not any(isinstance(node, ast.ImportFrom) and node.module == 'hermes_cli.main'
               and any(item.name == 'main' for item in node.names) for node in ast.walk(tree)):
        raise UnsupportedNativeHermes('entrypoint')
    installation = _activate_launcher_installation(tree, launcher, launcher_binding) if isolated is not None else None
    if installation is not None:
        launcher_binding = {**launcher_binding, 'installation': installation}
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
    source_bootstrap = None
    if installation is not None:
        if Path(paths['main']).parent != Path(installation['root']) / 'hermes_cli':
            raise UnsupportedNativeHermes('installation package')
        paths['bootstrap'] = str(Path(installation['root']) / 'hermes_bootstrap.py')
    else:
        root = Path(paths['main']).parent.parent
        if os.path.lexists(root / 'hermes_bootstrap.py'):
            prior = expected.get('sourceBootstrap') if expected is not None else None
            if expected is not None and prior is None:
                raise UnsupportedNativeHermes('installation changed')
            source_bootstrap = _activate_native_installation(root, launcher, prior)
            paths['bootstrap'] = str(root / 'hermes_bootstrap.py')
            # PM may change import paths, but cannot replace the bound native source.
            for name in ('main', 'mcp_startup', 'managed_scope', 'config'):
                spec = importlib.util.find_spec('hermes_cli.' + name)
                if not spec or not spec.origin or str(Path(spec.origin).resolve(strict=True)) != paths[name]:
                    raise UnsupportedNativeHermes('installation package changed')
        elif expected is not None and expected.get('sourceBootstrap') is not None:
            raise UnsupportedNativeHermes('installation changed')
    startup = Path(paths['mcp_startup']).read_text(encoding='utf-8')
    managed = Path(paths['managed_scope']).read_text(encoding='utf-8')
    if '_has_configured_mcp_servers' not in startup or 'HERMES_MANAGED_DIR' not in managed:
        raise UnsupportedNativeHermes('overlay')
    if os.environ.get('ZIWEI_BOT_PROFILE_MODE') == 'owned_profile':
        target = Path(paths['main']).with_name('profiles.py')
        functions = {node.name for node in ast.parse(target.read_text(encoding='utf-8')).body if isinstance(node, ast.FunctionDef)}
        if not {'get_profile_dir', 'profile_exists', '_bootstrap_profile_dir', '_finish_profile_layout'}.issubset(functions):
            raise UnsupportedNativeHermes('owned profile layout')
        paths['profiles'] = str(target.resolve(strict=True))
    if os.environ.get('ZIWEI_EXECUTION_PROFILE_BOUND') == '1':
        target = Path(paths['main']).with_name('profiles.py')
        functions = {node.name for node in ast.parse(target.read_text(encoding='utf-8')).body if isinstance(node, ast.FunctionDef)}
        if 'resolve_profile_env' not in functions:
            raise UnsupportedNativeHermes('profile binding shape')
        paths['profiles'] = str(target.resolve(strict=True))
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
        if os.environ.get('ZIWEI_INSTANCE_KIND') == 'hermes-bot' and os.environ.get('ZIWEI_BOT_PROFILE_MODE') == 'owned_profile':
            spec = importlib.util.find_spec('hermes_state_registry')
            target = Path(spec.origin).resolve(strict=True) if spec and spec.origin else None
            if not target or target.suffix != '.py' or not target.is_relative_to(root):
                raise UnsupportedNativeHermes('owned state registry source')
            functions = {node.name for node in ast.parse(target.read_text(encoding='utf-8')).body if isinstance(node, ast.FunctionDef)}
            if not {'acquire', 'release', 'close_all_under'}.issubset(functions):
                raise UnsupportedNativeHermes('owned state registry shape')
            paths['state_registry'] = str(target)
            spec = importlib.util.find_spec('hermes_cli.sqlite_safe_read')
            target = Path(spec.origin).resolve(strict=True) if spec and spec.origin else None
            if not target or target.suffix != '.py' or not target.is_relative_to(root):
                raise UnsupportedNativeHermes('owned state connection source')
            functions = {node.name for node in ast.parse(target.read_text(encoding='utf-8')).body if isinstance(node, ast.FunctionDef)}
            if 'has_live_connection' not in functions:
                raise UnsupportedNativeHermes('owned state connection shape')
            paths['sqlite_safe_read'] = str(target)
        if '_apply_profile_override()' not in Path(paths['main']).read_text(encoding='utf-8'):
            raise UnsupportedNativeHermes('creator profile')
    if os.environ.get('ZIWEI_BOT_REASONING_EFFORT'):
        for name,module_name,required in [('reasoning_transport','agent.transports.codex',{'_resolve_reasoning'}),
                                          ('reasoning_effort','agent.reasoning_effort',{'codex_supported_efforts','clamp_effort'})]:
            spec=importlib.util.find_spec(module_name)
            target=Path(spec.origin).resolve(strict=True) if spec and spec.origin else None
            if not target or target.suffix!='.py' or not target.is_relative_to(Path(paths['main']).parent.parent):
                raise UnsupportedNativeHermes('bot reasoning binding')
            functions={node.name for node in ast.parse(target.read_text(encoding='utf-8')).body if isinstance(node,ast.FunctionDef)}
            if not required.issubset(functions):raise UnsupportedNativeHermes('bot reasoning shape')
            if name=='reasoning_transport':
                classes=[node for node in ast.parse(target.read_text(encoding='utf-8')).body if isinstance(node,ast.ClassDef) and node.name=='ResponsesApiTransport']
                if not classes or not {'build_kwargs','preflight_kwargs'}.issubset({node.name for node in classes[0].body if isinstance(node,ast.FunctionDef)}):raise UnsupportedNativeHermes('bot reasoning transport shape')
            paths[name]=str(target)
    if multi_images:
        root = Path(paths['main']).parent.parent
        required = [('image_cli', root / 'cli.py', {'_collect_query_images': ['query', 'image_arg'], '_route_single_query_images': ['cli', 'query', 'effective_query', 'single_query_images', 'single_query_image_urls']}),
                    ('image_routing', root / 'agent' / 'image_routing.py', {'decide_image_input_mode': ['provider', 'model', 'cfg'], 'build_native_content_parts': ['user_text', 'image_paths', 'image_urls']})]
        main_tree = ast.parse(Path(paths['main']).read_text(encoding='utf-8'))
        functions = {node.name: node for node in main_tree.body if isinstance(node, ast.FunctionDef)}
        if not {'cmd_chat', '_read_query_file'}.issubset(functions) or not any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == '_read_query_file' for node in ast.walk(functions['cmd_chat'])):
            raise UnsupportedNativeHermes('multi image chat shape')
        for name, target, signatures in required:
            target = target.resolve(strict=True)
            if target.suffix != '.py' or not target.is_relative_to(root):
                raise UnsupportedNativeHermes('multi image package')
            functions = {node.name: node for node in ast.parse(target.read_text(encoding='utf-8')).body if isinstance(node, ast.FunctionDef)}
            if any(key not in functions or [arg.arg for arg in functions[key].args.args] != args for key, args in signatures.items()):
                raise UnsupportedNativeHermes('multi image shape')
            paths[name] = str(target)
    sources = [launcher, *([wrapper] if wrapper is not None else []), *(Path(value) for value in paths.values())]
    return {'paths': paths, 'fingerprint': hashlib.sha256(b'\0'.join(p.read_bytes() for p in sources)).hexdigest(), **({'launcherBinding': launcher_binding} if launcher_binding is not None else {}), **({'sourceBootstrap': source_bootstrap} if source_bootstrap is not None else {})}



def _activate_launcher_installation(tree, launcher, launcher_binding):
    """Restore the published store launcher's native bootstrap without executing its script."""
    roots, pins = [], []
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if isinstance(call.func, ast.Attribute) and call.func.attr == 'insert' and isinstance(call.func.value, ast.Attribute) and call.func.value.attr == 'path' and isinstance(call.func.value.value, ast.Name) and call.func.value.value.id == 'sys':
                if len(call.args) != 2 or call.keywords or not isinstance(call.args[0], ast.Constant) or type(call.args[0].value) is not int or call.args[0].value != 0 or not isinstance(call.args[1], ast.Constant) or not isinstance(call.args[1].value, str):
                    raise UnsupportedNativeHermes('installation path shape')
                roots.append((call.args[1].value, node.lineno))
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Attribute) and isinstance(node.targets[0].value, ast.Name) and node.targets[0].value.id == 'sys' and node.targets[0].attr == '_hermes_pin_default_home' and isinstance(node.value, ast.Constant) and node.value.value is True:
            pins.append(node.lineno)
    imports = [node.lineno for node in ast.walk(tree) if isinstance(node, ast.Import) and any(item.name == 'hermes_bootstrap' and item.asname is None for item in node.names)]
    if len(roots) != 1 or len(pins) != 1 or len(imports) != 1 or not roots[0][1] < pins[0] < imports[0] or not Path(roots[0][0]).is_absolute():
        raise UnsupportedNativeHermes('installation bootstrap shape')
    root = Path(roots[0][0]).resolve(strict=True)
    return _activate_native_installation(root, launcher, launcher_binding.get('installation'))


def _activate_native_installation(root, launcher, expected_installation=None):
    """Use this source's native bootstrap to select its committed dependencies."""
    git = root / '.git'
    if git.is_file():
        raw = git.read_bytes()
        if len(raw) > 16384 or not raw.decode('utf-8-sig').strip().startswith('gitdir:'):
            raise UnsupportedNativeHermes('installation git directory')
        git = root / raw.decode('utf-8-sig').strip()[7:].strip()
    if os.path.lexists(root / '.hermes-update-zip-swap') or os.path.lexists(git / 'hermes-update-pull'):
        raise UnsupportedNativeHermes('installation update incomplete')
    bootstrap = (root / 'hermes_bootstrap.py').resolve(strict=True)
    if not root.is_dir() or bootstrap.parent != root or not bootstrap.is_file():
        raise UnsupportedNativeHermes('installation bootstrap source')
    installation = {'root': str(root), 'bootstrapSha256': hashlib.sha256(bootstrap.read_bytes()).hexdigest()}
    if expected_installation is not None and expected_installation != installation:
        raise UnsupportedNativeHermes('installation changed')
    for name in ('PYTHONHOME', 'PYTHONPATH'):
        os.environ.pop(name, None)
    sys.path.insert(0, str(root))
    spec = importlib.util.find_spec('hermes_bootstrap')
    if not spec or not spec.origin or Path(spec.origin).resolve(strict=True) != bootstrap:
        raise UnsupportedNativeHermes('installation bootstrap module')
    sys._hermes_pin_default_home = True
    original_argv, original_home = sys.argv, os.environ.get('HERMES_HOME')
    original_lazy = os.environ.get('HERMES_DISABLE_LAZY_INSTALLS')
    native_args = original_argv[original_argv.index('--', 5) + 1:] if len(original_argv) > 5 and '--' in original_argv[5:] else ['--version']
    sys.argv = [str(launcher), *(native_args or ['--version'])]
    # The controller must retain this supervised root; an installation repair may
    # request a native restart, but cannot replace it or launch an unbound child.
    import subprocess
    class NativeRelaunchRequired(BaseException):
        pass
    def reject_relaunch(*args, **kwargs):
        raise NativeRelaunchRequired()
    original_execv, original_call = os.execv, subprocess.call
    os.execv, subprocess.call = reject_relaunch, reject_relaunch
    os.environ['HERMES_DISABLE_LAZY_INSTALLS'] = '1'
    try:
        native = importlib.import_module('hermes_bootstrap')
    except NativeRelaunchRequired:
        raise UnsupportedNativeHermes('installation restart required') from None
    finally:
        sys.argv = original_argv
        os.execv, subprocess.call = original_execv, original_call
        if original_lazy is None:
            os.environ.pop('HERMES_DISABLE_LAZY_INSTALLS', None)
        else:
            os.environ['HERMES_DISABLE_LAZY_INSTALLS'] = original_lazy
    if Path(native.__file__).resolve(strict=True) != bootstrap or original_home and os.environ.get('HERMES_HOME') != original_home:
        raise UnsupportedNativeHermes('installation home binding')
    return installation


def binding(launcher, multi_images=False, launcher_binding=None, expected=None):
    try:
        return _binding(launcher, multi_images, launcher_binding, expected)
    except Exception:
        raise UnsupportedNativeHermes('binding') from None


def install_multi_image_input(native, current, descriptors):
    """Execution-local attachment transport; the installed native builder owns vision parts."""
    if not isinstance(descriptors, list) or not 2 <= len(descriptors) <= 20:
        raise UnsupportedNativeHermes('multi image count')
    if any(not isinstance(item, dict) or set(item) != {'path', 'size', 'sha256'} or not isinstance(item['path'], str) or not Path(item['path']).is_absolute() or type(item['size']) is not int or not 0 < item['size'] <= 10 * 1024 * 1024 or not isinstance(item['sha256'], str) or len(item['sha256']) != 64 or any(ch not in '0123456789abcdef' for ch in item['sha256']) for item in descriptors):
        raise UnsupportedNativeHermes('multi image manifest')
    if sum(item['size'] for item in descriptors) > 10 * 1024 * 1024:
        raise UnsupportedNativeHermes('multi image size')

    def checked_paths():
        paths = []
        for item in descriptors:
            target = Path(item['path'])
            try:
                if target.is_symlink() or not target.is_file() or target.stat().st_size != item['size']:
                    raise ValueError()
                raw = target.read_bytes()
                if len(raw) != item['size'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
                    raise ValueError()
            except (OSError, ValueError):
                raise UnsupportedNativeHermes('multi image input changed') from None
            paths.append(target)
        return paths

    original_read = native._read_query_file

    def read_query_file(args):
        original_read(args)
        if getattr(args, 'output_format', None) != 'stream-json' or not getattr(args, 'query', None) or getattr(args, 'image', None) or getattr(args, 'tui', False):
            raise UnsupportedNativeHermes('multi image query route')
        checked_paths()
        # This is the native cmd_chat import point, after profile/query setup.
        cli_module = importlib.import_module('cli')
        routing = importlib.import_module('agent.image_routing')
        if str(Path(cli_module.__file__).resolve()) != current['paths'].get('image_cli') or str(Path(routing.__file__).resolve()) != current['paths'].get('image_routing'):
            raise UnsupportedNativeHermes('multi image module changed')

        def collect(query, image_arg=None):
            if image_arg:
                raise UnsupportedNativeHermes('multi image duplicate CLI flags')
            return query or '', checked_paths()

        def route(cli, query, effective_query, single_query_images, single_query_image_urls):
            paths = checked_paths()
            if not isinstance(single_query_images, (list, tuple)) or list(single_query_images) != paths or single_query_image_urls:
                raise UnsupportedNativeHermes('multi image attachment mismatch')
            cfg = importlib.import_module('hermes_cli.config').load_config()
            mode = routing.decide_image_input_mode((cli.provider or '').strip(), (cli.model or '').strip(), cfg, requested_provider=(cli.requested_provider or '').strip())
            if mode != 'native':
                raise UnsupportedNativeHermes('multi image model requires native vision')
            parts, skipped = routing.build_native_content_parts(query if isinstance(query, str) else '', [str(item) for item in paths])
            images = [part for part in parts if isinstance(part, dict) and part.get('type') == 'image_url'] if isinstance(parts, list) else []
            if skipped or len(images) != len(descriptors):
                raise UnsupportedNativeHermes('multi image incomplete native content')
            # Fail before agent startup on dropped, reordered, changed or text-only images.
            for item, part in zip(descriptors, images):
                try:
                    url = part.get('image_url', {}).get('url', '')
                    prefix, encoded = url.split(',', 1)
                    raw = base64.b64decode(encoded, validate=True)
                    if not prefix.startswith('data:image/') or not prefix.endswith(';base64') or len(raw) != item['size'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
                        raise ValueError()
                except (AttributeError, TypeError, ValueError):
                    raise UnsupportedNativeHermes('multi image native bytes or order changed') from None
            return parts

        cli_module._collect_query_images = collect
        cli_module._route_single_query_images = route

    native._read_query_file = read_query_file


def finalize_owned_storage(current, isolation):
    registry = importlib.import_module('hermes_state_registry')
    if str(Path(registry.__file__).resolve()) != current['paths']['state_registry']:
        raise UnsupportedNativeHermes('owned state registry changed')
    # Use normal SDK close after this owned child has finished its work. This
    # releases process-local caches, never opens a database for cleanup, and is
    # not a claim that the later independent WAL/claim/tree checks will pass.
    registry.close_all_under(isolation['home'])
    safe_read = importlib.import_module('hermes_cli.sqlite_safe_read')
    if str(Path(safe_read.__file__).resolve()) != current['paths']['sqlite_safe_read']:
        raise UnsupportedNativeHermes('owned state connection changed')
    # SDK registry teardown may log and swallow a failed close. Detect its
    # still-tracked handles without opening any database or reading its body.
    if any(safe_read.has_live_connection(Path(isolation['home']) / name)
           for name in ('state.db', 'kanban.db')):
        raise UnsupportedNativeHermes('owned state storage remains open')


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
    is_bot = os.environ.get('ZIWEI_INSTANCE_KIND') == 'hermes-bot'
    owned = is_bot and os.environ.get('ZIWEI_BOT_PROFILE_MODE') == 'owned_profile'
    expected = {'templateId': 'ziwei-hermes-bot' if is_bot else 'ziwei-employee-creator', 'key': os.environ.get('ZIWEI_CREATOR_KEY'),
                'workspace': os.environ.get('ZIWEI_CREATOR_WORKSPACE'),
                'employeeId': os.environ.get('ZIWEI_CREATOR_EMPLOYEE_ID'),
                'sourceProfile': os.environ.get('ZIWEI_CREATOR_PROFILE')}
    if any(metadata.get(key) != value for key, value in expected.items()) or Path(metadata.get('sourceHome', '')).resolve() != source:
        raise UnsupportedNativeHermes('creator binding')
    if owned:
        profiles = importlib.import_module('hermes_cli.profiles')
        if str(Path(profiles.__file__).resolve()) != current['paths']['profiles'] or metadata.get('mode') != 'owned_profile' or profiles.get_profile_dir(expected['sourceProfile']).resolve() != home:
            raise UnsupportedNativeHermes('owned profile home')
    if not owned and ((home / 'auth.json').exists() or (home / '.env').exists()):
        raise UnsupportedNativeHermes('creator cloned auth')
    # Preserve only the authoritative runtime scope. The native dotenv loader
    # intentionally uses process HERMES_HOME while selecting the source profile,
    # and may otherwise reintroduce an old phone/controller bearer afterwards.
    routing_keys = {'HERMES_MANAGED_DIR', 'PYTHONPATH', 'PYTHONHOME',
                    'ZIWEI_API_BASE', 'ZIWEI_MCP_WORKSPACE', 'ZIWEI_MCP_TOKEN_FILE',
                    'ZIWEI_MCP_TOKEN', 'ZIWEI_MCP_AUDIT_FILE',
                    'ZIWEI_TERMINAL_API_BASE', 'ZIWEI_TERMINAL_WORKSPACE',
                    'ZIWEI_TERMINAL_TOKEN_FILE', 'ZIWEI_TERMINAL_AUDIT_FILE',
                    'ZIWEI_TERMINAL_EMPLOYEE_ID', 'ZIWEI_TERMINAL_DEVICE_ID',
                    'ZIWEI_CREATOR_HOME', 'ZIWEI_CREATOR_SOURCE_HOME', 'ZIWEI_CREATOR_KEY',
                    'ZIWEI_CREATOR_WORKSPACE', 'ZIWEI_CREATOR_EMPLOYEE_ID', 'ZIWEI_CREATOR_PROFILE',
                    'ZIWEI_INSTANCE_KIND', 'ZIWEI_BOT_REVISION', 'ZIWEI_BOT_ACTION_ID', 'ZIWEI_BOT_DEVICE_TOKEN', 'ZIWEI_BOT_PROFILE_MODE', 'ZIWEI_BOT_REASONING_EFFORT',
                    'HERMES_KANBAN_HOME', 'HERMES_KANBAN_DB'}
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
    # All instances referencing this source share one native authentication store.
    # Hermes owns its per-path lock, refresh transaction and atomic write-back;
    # no refresh token is cloned into the isolated instance. Never block the save
    # after OAuth refresh: rotation may already have consumed the previous token.
    auth._auth_file_path = lambda: source / 'auth.json'
    # Load the selected profile's .env into this execution's memory only. Never
    # persist it or allow it to replace trusted scope/home/MCP routing values.
    from dotenv import dotenv_values
    reserved = {'HERMES_HOME', 'HERMES_MANAGED_DIR', 'PYTHONPATH', 'PYTHONHOME',
                'CONTROL_MCP_API_URL', 'CONTROL_MCP_AUTH'}
    if is_bot:
        reserved.update({'TERMINAL_CWD', 'HERMES_TOOLSETS', 'HERMES_MAX_TURNS','HERMES_KANBAN_HOME','HERMES_KANBAN_DB'})
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
    owned = os.environ.get('ZIWEI_BOT_PROFILE_MODE') == 'owned_profile'
    if Path(os.environ.get('HERMES_HOME', '')).resolve() != (home if owned else source) or 'cli' in sys.modules:
        raise UnsupportedNativeHermes('creator profile')
    os.environ['HERMES_HOME'] = str(home)
    for key in tuple(os.environ):
        if key.startswith('ZIWEI_') or key in {'CONTROL_MCP_API_URL', 'CONTROL_MCP_AUTH', 'HERMES_MANAGED_DIR', 'PYTHONPATH', 'PYTHONHOME'}:
            os.environ.pop(key, None)
    os.environ.update(routing_env)
    constants = importlib.import_module('hermes_constants')
    auth = importlib.import_module('hermes_cli.auth')
    effective = config.load_config()
    provider = effective.get('model', {})
    is_bot = expected['templateId'] == 'ziwei-hermes-bot'
    if not isinstance(provider, dict) or not provider.get('provider') or (not is_bot and provider.get('provider') != 'openai-codex'):
        raise UnsupportedNativeHermes('creator provider unsupported')
    memory = effective.get('memory', {})
    if not isinstance(memory, dict) or str(memory.get('provider') or '').strip():
        raise UnsupportedNativeHermes('creator memory provider unsupported')
    if is_bot:
        raw = config.read_raw_config()
        # Native managed policy has final precedence. Refuse expansion or silent
        # rewriting of the saved Bot permission/configuration at that boundary.
        for section, names in {'model': ('provider', 'default'),
                               'agent': ('max_turns', 'disabled_toolsets', 'bot_mode_protocol'),
                               'memory': ('memory_enabled', 'user_profile_enabled'),
                               'platform_toolsets': ('cli',),
                               'skills': ('disabled', 'project_discovery', 'external_dirs', 'create_dir', 'auto_load'),
                               'security': ('allow_lazy_installs',)}.items():
            for name in names:
                if effective.get(section, {}).get(name) != raw.get(section, {}).get(name):
                    raise UnsupportedNativeHermes('bot managed config conflict:' + section + '.' + name)
        from hermes_cli.skills_config import get_disabled_skills
        if set(raw.get('skills', {}).get('disabled', [])) - get_disabled_skills(effective, 'cli'):
            raise UnsupportedNativeHermes('bot essential skill cannot be disabled')
        if raw.get('agent', {}).get('disabled_toolsets') == ['all'] and effective.get('mcp_servers'):
            raise UnsupportedNativeHermes('bot read only mcp conflict')
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
    return {'enabled': True, **{key: expected[key] for key in ('key', 'workspace', 'employeeId', 'sourceProfile')}, 'authMode': 'source-native-store',
            **({'kind': 'hermes-bot', 'revision': int(os.environ['ZIWEI_BOT_REVISION'])} if is_bot else {}),
            **({'mode': 'owned_profile', 'profile': expected['sourceProfile'], 'home': str(home), 'profileHome': str(home)} if owned else {}),
            **({'reasoning':{'requested':os.environ['ZIWEI_BOT_REASONING_EFFORT'],'actual':None,'status':'configured'}} if is_bot and os.environ.get('ZIWEI_BOT_REASONING_EFFORT') else {})}


def run():
    probe_resource = None
    if len(sys.argv) == 5 and sys.argv[1] in {'--version-probe', '--probe', '--probe-images'}:
        if sys.argv[3] != '--launcher-binding':
            raise UnsupportedNativeHermes('arguments')
        probe_resource = json.loads(sys.argv[4])
    if len(sys.argv) in {3, 5} and sys.argv[1] == '--version-probe':
        current = binding(sys.argv[2], launcher_binding=probe_resource)
        import hermes_cli
        if Path(hermes_cli.__file__).resolve().parent != Path(current['paths']['main']).parent:
            raise UnsupportedNativeHermes('version package')
        print('Hermes ' + hermes_cli.__version__)
        return 0
    if len(sys.argv) in {3, 5} and sys.argv[1] in {'--probe', '--probe-images'}:
        print(json.dumps(binding(sys.argv[2], sys.argv[1] == '--probe-images', probe_resource)))
        return 0
    if len(sys.argv) < 5 or sys.argv[1] != '--launcher' or sys.argv[3] != '--binding':
        raise UnsupportedNativeHermes('arguments')
    launcher = sys.argv[2]
    expected = json.loads(sys.argv[4])
    multi_images = isinstance(expected, dict) and 'image_cli' in expected.get('paths', {})
    current = binding(launcher, multi_images, expected.get('launcherBinding'), expected)
    if current != expected:
        raise UnsupportedNativeHermes('changed')
    native_args = sys.argv[5:]
    bound_profile = None
    if native_args and native_args[0] == '--bound-profile':
        bound_profile = json.loads(native_args[1])
        native_args = native_args[2:]
    input_images = None
    if native_args and native_args[0] == '--input-images':
        input_images = json.loads(native_args[1])
        native_args = native_args[2:]
    if multi_images != (input_images is not None):
        raise UnsupportedNativeHermes('multi image binding')
    if native_args and native_args[0] == '--owned-profile-provision':
        profiles = importlib.import_module('hermes_cli.profiles')
        if str(Path(profiles.__file__).resolve()) != current['paths'].get('profiles'):
            raise UnsupportedNativeHermes('owned profile package')
        module = importlib.util.spec_from_file_location('ziwei_owned_profile', Path(__file__).with_name('hermes-owned-profile.py'))
        bridge = importlib.util.module_from_spec(module); module.loader.exec_module(bridge)
        try:
            # The controller writes UTF-8 JSON, independently of the host locale
            # and the isolated interpreter's ignored PYTHONIOENCODING setting.
            raw = getattr(sys.stdin, 'buffer', sys.stdin).readline()
            request = json.loads(raw.decode('utf-8') if isinstance(raw, bytes) else raw)
            receipt = bridge.provision(request)
            print('ZIWEI_BOT_PROVISION:' + json.dumps({'status': 'succeeded', 'botProvision': receipt}), flush=True)
        except Exception as error:
            message = str(error)
            code = message if re.fullmatch(r'BOT_PROFILE_[A-Z0-9_]{1,64}', message) else 'BOT_PROFILE_CREATE_FAILED'
            print('ZIWEI_BOT_PROVISION:' + json.dumps({'status': 'failed', 'code': code, 'diagnostic': bridge.failure_diagnostic(error)}), flush=True)
        return 0
    discover_only = bool(native_args and native_args[0] == '--discover-only')
    config_only = bool(native_args and native_args[0] == '--config-only')
    native_operation = bool(native_args and native_args[0] == '--native-operation')
    gateway_worker = bool(native_args and native_args[0] == '--gateway-worker')
    if discover_only or config_only or native_operation or gateway_worker:
        native_args = native_args[1:]
    if not native_args or native_args[0] != '--':
        raise UnsupportedNativeHermes('arguments')
    overlay = os.environ.get('HERMES_MANAGED_DIR', '').strip()
    if not overlay or not Path(overlay).is_absolute() or not Path(overlay).is_dir():
        raise UnsupportedNativeHermes('overlay')
    sys.argv = [launcher, *native_args[1:]]
    verify_profile = None
    if bound_profile is not None:
        profiles = importlib.import_module('hermes_cli.profiles')
        if str(Path(profiles.__file__).resolve()) != current['paths'].get('profiles'):
            raise UnsupportedNativeHermes('profile binding package')
        spec = importlib.util.spec_from_file_location('ziwei_profile_binding', Path(__file__).with_name('hermes-profile-binding.py'))
        bridge = importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)
        verify_profile = bridge.install(bound_profile, profiles)
    prepared_isolation = prepare_creator_home(current)
    native = importlib.import_module('hermes_cli.main')
    if verify_profile is not None:
        verify_profile()
    startup = importlib.import_module('hermes_cli.mcp_startup')
    config = importlib.import_module('hermes_cli.config')
    managed = importlib.import_module('hermes_cli.managed_scope')
    for name, module in [('main', native), ('mcp_startup', startup), ('config', config), ('managed_scope', managed)]:
        if str(Path(module.__file__).resolve()) != current['paths'][name]:
            raise UnsupportedNativeHermes('changed')
    if os.environ.get('ZIWEI_INSTANCE_KIND') == 'hermes-bot':
        original_load_config = config.load_config

        def isolated_bot_config(*args, **kwargs):
            raw = config.read_raw_config()
            # Hermes expands both embedded ${VAR} and ${env:VAR} during load.
            # Validate the untouched instance config before internal route
            # credentials could be substituted into an external command/URL.
            import re
            def check_refs(value, path=()):
                if isinstance(value, dict):
                    for key, item in value.items(): check_refs(item, (*path, key))
                elif isinstance(value, list):
                    for index, item in enumerate(value): check_refs(item, (*path, index))
                elif isinstance(value, str) and '${' in value:
                    credential = (len(path) >= 4 and path[0] == 'mcp_servers' and path[2] in {'env', 'headers'}) or (path and path[0] == 'gateway' and ('envRefs' in path or 'extra' in path and re.search(r'(secret|token|password|api_key|authorization|app_id)$', str(path[-1]), re.I))) or (path and path[0] in {'stt', 'tts'} and path[-1] == 'api_key')
                    match = re.fullmatch(r'\$\{([A-Z][A-Z0-9_]*)\}', value)
                    if not credential or not match or re.match(r'ZIWEI_|CONTROL_MCP_|HERMES_|PYTHON|NODE_OPTIONS$|HOME$|USERPROFILE$', match.group(1)):
                        raise UnsupportedNativeHermes('credential-reference')
            check_refs(raw)
            effective = original_load_config(*args, **kwargs)
            # Approved Bot plugins only. Global managed/plugin discovery cannot
            # add arbitrary host hooks to a Bot process.
            effective['plugins'] = raw.get('plugins', {'enabled': [], 'disabled': []})
            requested = set(raw.get('mcp_servers', {}))
            # Allow only this execution's explicit Bot servers and scoped Ziwei
            # transports. Native global/plugin discovery must not add host MCPs.
            if raw.get('agent', {}).get('disabled_toolsets') == ['all']:
                effective['mcp_servers'] = {}
            else:
                import yaml
                policy = yaml.safe_load((Path(overlay) / 'config.yaml').read_text(encoding='utf-8')) or {}
                requested.update(name for name in policy.get('mcp_servers', {}) if name in {'ziwei_management', 'ziwei-terminal'})
                effective['mcp_servers'] = {name: value for name, value in effective.get('mcp_servers', {}).items() if name in requested}
            # Audio credentials expand in memory only. The persisted config
            # continues to contain ${ENV} references and never provider keys.
            def refs(value):
                import re
                if isinstance(value, dict): return {k: refs(v) for k, v in value.items()}
                if isinstance(value, list): return [refs(v) for v in value]
                if isinstance(value, str) and re.fullmatch(r'\$\{[A-Z][A-Z0-9_]*\}', value):
                    return os.environ.get(value[2:-1], '')
                return value
            for section in ('stt', 'tts'):
                if section in raw: effective[section] = refs(raw[section])
            return effective

        config.load_config = isolated_bot_config
    isolation = confirm_creator_home(current, config, prepared_isolation)
    if isolation:
        print('ZIWEI_CREATOR_ISOLATION:' + json.dumps(isolation), file=sys.stderr, flush=True)
    reasoning_proof=None
    if isolation and isolation.get('kind')=='hermes-bot' and os.environ.get('ZIWEI_BOT_REASONING_EFFORT'):
        module=importlib.util.spec_from_file_location('ziwei_bot_reasoning',Path(__file__).with_name('hermes-bot-reasoning.py'))
        bridge=importlib.util.module_from_spec(module);module.loader.exec_module(bridge)
        reasoning_proof=bridge.install(current,config,isolation,preflight=not(native_operation or gateway_worker),reject=UnsupportedNativeHermes)
    if native_operation or gateway_worker:
        if not isolation or isolation.get('kind') != 'hermes-bot':
            raise UnsupportedNativeHermes('bot native operation scope')
        request = json.loads(sys.stdin.readline())
        context = request.pop('context')
        if context.get('employeeId') != isolation['employeeId'] or context.get('revision') != isolation['revision'] or context.get('workspace') != isolation['workspace']:
            raise UnsupportedNativeHermes('bot native operation identity')
        module_path = Path(__file__).with_name('hermes-native-bridge.py')
        spec = importlib.util.spec_from_file_location('ziwei_native_bridge', module_path)
        bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bridge)
        try:
            if gateway_worker:
                bridge.run_gateway_worker(request, context)
            else:
                try:
                    result = bridge.run_operation(request, context)
                except bridge.NativeOperationError as error:
                    import hermes_cli
                    result = {'schemaVersion': 2, 'resource': request['resource'], 'operation': request['operation'],
                              'employeeId': context['employeeId'], 'revision': context['revision'],
                              'nativeVersion': hermes_cli.__version__, 'status': 'failed', 'code': str(error), 'data': None}
        finally:
            if isolation.get('mode') == 'owned_profile':
                # The bridge is finished, including the Gateway adapter's async
                # disconnect, before its owned connections are released.
                finalize_owned_storage(current, isolation)
        if not gateway_worker:
            print('ZIWEI_NATIVE_RESULT:' + json.dumps(result, ensure_ascii=False), flush=True)
        return 0
    if config_only:
        if not isolation or isolation.get('kind') != 'hermes-bot':
            raise UnsupportedNativeHermes('bot check')
        effective = config.load_config()
        selected = effective.get('platform_toolsets', {}).get('cli', [])
        from toolsets import TOOLSETS
        if any(name not in TOOLSETS and name != 'ziwei_collaboration' and not name.startswith('mcp-') for name in selected):
            raise UnsupportedNativeHermes('bot toolset unknown')
        import hermes_cli
        print(json.dumps({'botValidation': {'valid': True, 'schemaVersion': 1,
              'employeeId': isolation['employeeId'], 'revision': isolation['revision'],
              'sourceProfile': isolation['sourceProfile'], 'nativeVersion': hermes_cli.__version__,
              'nativeFingerprint': current['fingerprint'], 'isolation': isolation,
              'effective': {'provider': effective.get('model', {}).get('provider'),
                            'model': effective.get('model', {}).get('default'),
                            'maxTurns': effective.get('agent', {}).get('max_turns'),
                            **({'reasoning':reasoning_proof} if reasoning_proof else {}),
                            'memory': effective.get('memory', {}).get('memory_enabled'),
                            'toolsets': selected}}, 'externalModelCalls': 0}))
        return 0
    if isolation and isolation.get('kind') == 'hermes-bot' and 'ziwei_collaboration' in config.load_config().get('platform_toolsets', {}).get('cli', []):
        spec = importlib.util.spec_from_file_location('ziwei_native_bridge', Path(__file__).with_name('hermes-native-bridge.py'))
        bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bridge)
        bridge.install_collaboration_tools(isolation)
    original_gate = startup._has_configured_mcp_servers

    def effective_mcp_gate():
        try:
            servers = config.load_config().get('mcp_servers')
            return bool(isinstance(servers, dict) and servers) or original_gate()
        except Exception:
            raise UnsupportedNativeHermes('effective config') from None

    startup._has_configured_mcp_servers = effective_mcp_gate
    if input_images is not None:
        if discover_only or config_only or native_operation or gateway_worker:
            raise UnsupportedNativeHermes('multi image execution route')
        install_multi_image_input(native, current, input_images)
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
    if isolation and isolation.get('kind') == 'hermes-bot' and isolation.get('mode') == 'owned_profile':
        def owned_main():
            try:
                return native.main()
            finally:
                # The Bot chat/query-file route raises SystemExit after native
                # single-query cleanup. Its SDK storage cache still needs the
                # owned child's explicit close before the process exits.
                finalize_owned_storage(current, isolation)
        return owned_main
    return native.main


if __name__ == '__main__':
    def fail_safe(reason=None):
        if isinstance(reason, UnsupportedNativeHermes) and str(reason).startswith('multi image'):
            print('Hermes native multi-image input rejected: ' + str(reason) + '; all images must be attached natively, with no text-only fallback.', file=sys.stderr)
            sys.exit(125)
        if os.environ.get('ZIWEI_INSTANCE_KIND') == 'hermes-bot':
            code = str(reason) if isinstance(reason, UnsupportedNativeHermes) else type(reason).__name__
            stage = ' before model startup' if code.startswith('BOT_REASONING_') else ''
            print('Hermes Bot bootstrap rejected' + stage + ': ' + code, file=sys.stderr)
            sys.exit(125)
        if isinstance(reason, UnsupportedNativeHermes) and str(reason).startswith('bot managed config conflict:'):
            print('Hermes Bot effective configuration conflicts at ' + str(reason).split(':', 1)[1] + '; no model was started.', file=sys.stderr)
            sys.exit(125)
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
