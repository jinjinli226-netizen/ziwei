"""Owned native profile layout. No clone, alias, gateway notification or login."""
import json
import importlib.util
import os
from pathlib import Path
import re
import shutil
import tempfile


_DIAGNOSTIC_STAGES = frozenset({
    'read_request', 'native_imports', 'identity', 'reasoning', 'source', 'target',
    'create_parent', 'verify', 'create_staging', 'native_bootstrap', 'native_layout',
    'write_config', 'write_soul', 'write_profile', 'write_metadata', 'publish',
    'cleanup', 'receipt',
})
_DIAGNOSTIC_EXCEPTIONS = frozenset({
    ('builtins', name) for name in (
        'OSError', 'PermissionError', 'FileNotFoundError', 'FileExistsError',
        'NotADirectoryError', 'IsADirectoryError', 'ImportError', 'ModuleNotFoundError',
        'AttributeError', 'TypeError', 'KeyError', 'ValueError', 'UnicodeDecodeError',
        'UnicodeEncodeError', 'RuntimeError', 'AssertionError', 'RecursionError', 'MemoryError',
    )
}) | frozenset({
    ('json.decoder', 'JSONDecodeError'), ('yaml.representer', 'RepresenterError'),
    ('yaml.parser', 'ParserError'), ('yaml.scanner', 'ScannerError'), ('yaml.reader', 'ReaderError'),
    ('ruamel.yaml.representer', 'RepresenterError'), ('ruamel.yaml.parser', 'ParserError'),
    ('ruamel.yaml.scanner', 'ScannerError'), ('ruamel.yaml.reader', 'ReaderError'),
})
_DIAGNOSTIC_SOURCES = {
    'hermes-owned-profile.py': frozenset({'provision', '_provision', 'verify'}),
    'profiles.py': frozenset({
        'get_profile_dir', 'profile_exists', '_get_profiles_root', '_get_default_hermes_home',
        '_bootstrap_profile_dir', '_seed_model_config', '_seed_file_if_missing',
    }),
    'profiles_initialization.py': frozenset({'finish_profile_layout'}),
}
_failure_record = None


def _make_failure_diagnostic(error, stage):
    """A bounded code-location hint, never exception text or filesystem paths."""
    kind = type(error)
    result = {'schemaVersion': 1, 'stage': stage if stage in _DIAGNOSTIC_STAGES else 'receipt',
              'exception': kind.__name__ if (kind.__module__, kind.__name__) in _DIAGNOSTIC_EXCEPTIONS else 'OtherError'}
    for key, maximum in (('errno', 255), ('winerror', 65535)):
        value = getattr(error, key, None)
        if type(value) is int and 0 <= value <= maximum:
            result[key] = value
    if type(error) is ModuleNotFoundError:
        name = getattr(error, 'name', None)
        if isinstance(name, str) and len(name) <= 120 and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*', name):
            result['missingModule'] = name
    frame = error.__traceback__
    remaining = 64
    while frame is not None and remaining:
        code = frame.tb_frame.f_code
        file = Path(code.co_filename).name
        if code.co_name in _DIAGNOSTIC_SOURCES.get(file, ()) and 1 <= frame.tb_lineno <= 100000:
            result['source'] = {'file': file, 'function': code.co_name, 'line': frame.tb_lineno}
        frame = frame.tb_next
        remaining -= 1
    return result


def failure_diagnostic(error):
    global _failure_record
    saved, _failure_record = _failure_record, None
    if saved is not None and saved[0] is error:
        return saved[1]
    return _make_failure_diagnostic(error, 'read_request')


def provision(request):
    global _failure_record
    _failure_record = None
    state = {'stage': 'native_imports'}
    try:
        return _provision(request, state)
    except Exception as error:
        diagnostic = _make_failure_diagnostic(error, state['stage'])
        if state.get('cleanupFailed'):
            diagnostic['cleanupFailed'] = True
        _failure_record = (error, diagnostic)
        raise


def _provision(request, state):
    from hermes_cli import __version__
    from hermes_cli import profiles
    from hermes_cli.profiles_initialization import finish_profile_layout
    yaml_spec = importlib.util.spec_from_file_location('ziwei_yaml_compat', Path(__file__).with_name('hermes-yaml-compat.py'))
    yaml_bridge = importlib.util.module_from_spec(yaml_spec)
    yaml_spec.loader.exec_module(yaml_bridge)
    yaml = yaml_bridge.load_native_yaml()
    state['stage'] = 'identity'
    context, metadata = request['context'], request['metadata']
    requested_effort=context.get('config',{}).get('reasoningEffort')
    if requested_effort:
        state['stage'] = 'reasoning'
        from hermes_constants import VALID_REASONING_EFFORTS
        if requested_effort not in VALID_REASONING_EFFORTS or request['seedConfig'].get('agent',{}).get('reasoning_effort')!=requested_effort:
            raise RuntimeError('BOT_PROFILE_REASONING_INVALID')
    state['stage'] = 'identity'
    instance = context.get('instance', {})
    name = instance.get('profile', '')
    if instance.get('mode') != 'owned_profile' or not re.fullmatch(r'bot-[a-z0-9_-]{1,58}', name):
        raise RuntimeError('BOT_PROFILE_IDENTITY_INVALID')
    expected = {'version': 1, 'templateId': 'ziwei-hermes-bot', 'key': instance['ownershipId'],
                'workspace': context['workspace'], 'employeeId': context['employeeId'],
                'deviceId': context['deviceId'], 'profile': name, 'sourceProfile': name,
                'templateProfile': instance['templateProfile'], 'mode': 'owned_profile',
                'provisionActionId': instance['provisionActionId']}
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise RuntimeError('BOT_PROFILE_IDENTITY_INVALID')
    state['stage'] = 'source'
    source = profiles.get_profile_dir(instance['templateProfile']).resolve(strict=True)
    if (source / 'ziwei-instance.json').exists() and json.loads((source / 'ziwei-instance.json').read_text(encoding='utf-8')).get('mode') == 'owned_profile':
        raise RuntimeError('BOT_PROFILE_TEMPLATE_UNSUPPORTED')
    if Path(metadata['sourceHome']).resolve(strict=True) != source or context['sourceProfile'] != name:
        raise RuntimeError('BOT_PROFILE_SOURCE_MISMATCH')
    state['stage'] = 'target'
    target = profiles.get_profile_dir(name)
    parent = target.parent
    if parent.is_symlink() or target.is_symlink() or target.resolve() == source:
        raise RuntimeError('BOT_PROFILE_PATH_INVALID')
    state['stage'] = 'create_parent'
    parent.mkdir(parents=True, exist_ok=True)
    state['stage'] = 'target'
    if target.resolve().parent != parent.resolve():
        raise RuntimeError('BOT_PROFILE_PATH_INVALID')

    def verify():
        state['stage'] = 'verify'
        for relative in ('ziwei-instance.json', 'config.yaml', 'profile.yaml', 'memories', 'sessions'):
            if (target / relative).is_symlink() or not (target / relative).exists():
                raise RuntimeError('BOT_PROFILE_OWNERSHIP_CONFLICT')
        if json.loads((target / 'ziwei-instance.json').read_text(encoding='utf-8')) != metadata:
            raise RuntimeError('BOT_PROFILE_OWNERSHIP_CONFLICT')
        if not profiles.profile_exists(name) or profiles.get_profile_dir(name).resolve() != target.resolve():
            raise RuntimeError('BOT_PROFILE_RESOLVER_MISMATCH')

    duplicate = target.exists()
    if duplicate:
        verify()
    else:
        state['stage'] = 'create_staging'
        stage = Path(tempfile.mkdtemp(prefix='.' + name + '.owned-', dir=parent))
        primary_failure = False
        try:
            # Native fresh-profile functions, without create_profile's gateway
            # notifications. Nothing is cloned from the template environment.
            state['stage'] = 'native_bootstrap'
            profiles._bootstrap_profile_dir(stage, None)
            state['stage'] = 'native_layout'
            finish_profile_layout(stage, no_skills=True, clone_all=False, description=None)
            state['stage'] = 'write_config'
            (stage / 'config.yaml').write_text(yaml.safe_dump(request['seedConfig'], allow_unicode=True), encoding='utf-8')
            state['stage'] = 'write_soul'
            (stage / 'SOUL.md').write_text(context.get('name', name) + '\n', encoding='utf-8')
            state['stage'] = 'write_profile'
            (stage / 'profile.yaml').write_text(yaml.safe_dump({'display_name': context.get('name', name)}, allow_unicode=True), encoding='utf-8')
            state['stage'] = 'write_metadata'
            (stage / 'ziwei-instance.json').write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
            state['stage'] = 'publish'
            try:
                os.rename(stage, target)
            except FileExistsError:
                verify(); duplicate = True
        except BaseException:
            primary_failure = True
            raise
        finally:
            try:
                if stage.exists() and stage.parent.resolve() == parent.resolve() and stage.name.startswith('.' + name + '.owned-'):
                    shutil.rmtree(stage)
            except Exception:
                if primary_failure:
                    state['cleanupFailed'] = True
                else:
                    state['stage'] = 'cleanup'
                    raise
        verify()
    state['stage'] = 'receipt'
    home = str(target.resolve())
    return {'schemaVersion': 1, 'mode': 'owned_profile', 'workspace': context['workspace'],
            'employeeId': context['employeeId'], 'deviceId': context['deviceId'],
            'ownershipId': instance['ownershipId'], 'profile': name, 'home': home,
            'profileHome': str(profiles.get_profile_dir(name).resolve()), 'nativeVersion': __version__,
            'authentication': request['authentication'], 'authMode': 'source-native-store',
            'templateProfile': instance['templateProfile'], 'duplicate': duplicate,
            'provisionActionId': instance['provisionActionId'],
            **({'reasoning':{'requested':requested_effort,'actual':None,'status':'configured'}} if requested_effort else {})}
