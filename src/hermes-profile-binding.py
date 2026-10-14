"""Execution-scoped native Profile selection; never modifies installed Hermes."""
import json
import os
from pathlib import Path


def install(value, profiles):
    home = Path(value['home'])
    requested = Path(value['requestedHome'])
    roots = [Path(root).resolve(strict=True) for root in value['protectedHomes']]

    def verify(check_env=False):
        try:
            actual = requested.resolve(strict=True)
            for target in (actual, home.resolve(strict=True)):
                if any(target == root or target.is_relative_to(root) for root in roots):
                    raise ValueError('V2_OBJECT_SEALED')
                for parent in (target, *target.parents):
                    marker = parent / 'ziwei-instance.json'
                    if marker.exists() and json.loads(marker.read_text(encoding='utf-8')).get('templateId') == 'ziwei-hermes-bot':
                        raise ValueError('V2_OBJECT_SEALED')
            current = home.stat()
            if not home.is_absolute() or actual != home or home.resolve(strict=True) != home or str(current.st_dev) != value['identity']['dev'] or str(current.st_ino) != value['identity']['ino']:
                raise ValueError('EXECUTION_RESOURCE_CHANGED')
            if check_env and Path(os.environ.get('HERMES_HOME', '')).resolve(strict=True) != home:
                raise ValueError('EXECUTION_RESOURCE_CHANGED')
        except Exception as error:
            code = 'V2_OBJECT_SEALED' if str(error) == 'V2_OBJECT_SEALED' else 'EXECUTION_RESOURCE_CHANGED'
            # BaseException prevents native main's generic fallback-to-default handler.
            raise SystemExit(code) from None

    verify()
    original = profiles.resolve_profile_env

    def selected(name):
        if name.strip().casefold() != value['profile'].strip().casefold():
            raise SystemExit('EXECUTION_RESOURCE_CHANGED')
        verify()
        previous = os.environ.get('HERMES_HOME')
        try:
            os.environ['HERMES_HOME'] = value['baseHome']
            native_home = original(name)
            if Path(native_home).resolve(strict=True) != home:
                raise SystemExit('EXECUTION_RESOURCE_CHANGED')
        except Exception:
            # Keep native validation/tombstones without its main fallback path.
            raise SystemExit('EXECUTION_RESOURCE_CHANGED') from None
        finally:
            if previous is None:
                os.environ.pop('HERMES_HOME', None)
            else:
                os.environ['HERMES_HOME'] = previous
        return str(home)

    profiles.resolve_profile_env = selected
    return lambda: verify(check_env=True)
