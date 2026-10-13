"""Owned native profile layout. No clone, alias, gateway notification or login."""
import json
import os
from pathlib import Path
import re
import shutil
import tempfile


def provision(request):
    from hermes_cli import __version__
    from hermes_cli import profiles
    import yaml
    context, metadata = request['context'], request['metadata']
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
    source = profiles.get_profile_dir(instance['templateProfile']).resolve(strict=True)
    if (source / 'ziwei-instance.json').exists() and json.loads((source / 'ziwei-instance.json').read_text(encoding='utf-8')).get('mode') == 'owned_profile':
        raise RuntimeError('BOT_PROFILE_TEMPLATE_UNSUPPORTED')
    if Path(metadata['sourceHome']).resolve(strict=True) != source or context['sourceProfile'] != name:
        raise RuntimeError('BOT_PROFILE_SOURCE_MISMATCH')
    target = profiles.get_profile_dir(name)
    parent = target.parent
    if parent.is_symlink() or target.is_symlink() or target.resolve() == source:
        raise RuntimeError('BOT_PROFILE_PATH_INVALID')
    parent.mkdir(parents=True, exist_ok=True)
    if target.resolve().parent != parent.resolve():
        raise RuntimeError('BOT_PROFILE_PATH_INVALID')

    def verify():
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
        stage = Path(tempfile.mkdtemp(prefix='.' + name + '.owned-', dir=parent))
        try:
            # Native fresh-profile functions, without create_profile's gateway
            # notifications. Nothing is cloned from the template environment.
            profiles._bootstrap_profile_dir(stage, None)
            profiles._finish_profile_layout(stage, no_skills=True, clone_all=False, description=None)
            (stage / 'config.yaml').write_text(yaml.safe_dump(request['seedConfig'], allow_unicode=True), encoding='utf-8')
            (stage / 'SOUL.md').write_text(context.get('name', name) + '\n', encoding='utf-8')
            (stage / 'profile.yaml').write_text(yaml.safe_dump({'display_name': context.get('name', name)}, allow_unicode=True), encoding='utf-8')
            (stage / 'ziwei-instance.json').write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
            try:
                os.rename(stage, target)
            except FileExistsError:
                verify(); duplicate = True
        finally:
            if stage.exists() and stage.parent.resolve() == parent.resolve() and stage.name.startswith('.' + name + '.owned-'):
                shutil.rmtree(stage)
        verify()
    home = str(target.resolve())
    return {'schemaVersion': 1, 'mode': 'owned_profile', 'workspace': context['workspace'],
            'employeeId': context['employeeId'], 'deviceId': context['deviceId'],
            'ownershipId': instance['ownershipId'], 'profile': name, 'home': home,
            'profileHome': str(profiles.get_profile_dir(name).resolve()), 'nativeVersion': __version__,
            'authentication': request['authentication'], 'authMode': 'source-native-store',
            'templateProfile': instance['templateProfile'], 'duplicate': duplicate,
            'provisionActionId': instance['provisionActionId']}
