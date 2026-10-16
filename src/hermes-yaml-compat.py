"""Use the bound Hermes source's YAML policy; legacy releases used PyYAML."""
import ast
import importlib
import importlib.util
from pathlib import Path


def load_native_yaml():
    main = importlib.util.find_spec('hermes_cli.main')
    if main is None or not main.origin:
        raise ImportError('Hermes YAML source is not bound')
    root = Path(main.origin).resolve(strict=True).parent.parent
    target = root / 'hermes_yaml.py'
    if target.exists() or target.is_symlink():
        resolved = target.resolve(strict=True)
        if not resolved.is_file() or resolved.parent != root:
            raise ImportError('Hermes YAML source is outside the bound installation')
        spec = importlib.util.find_spec('hermes_yaml')
        if spec is None or not spec.origin or Path(spec.origin).resolve(strict=True) != resolved:
            raise ImportError('Hermes YAML source does not match the bound installation')
        # An internal dependency error belongs to this installation. It must not
        # be mistaken for an older release and silently fall back to PyYAML.
        module = importlib.import_module('hermes_yaml')
        if Path(module.__file__).resolve(strict=True) != resolved or not all(callable(getattr(module, name, None)) for name in ('safe_load', 'safe_dump')):
            raise ImportError('Hermes YAML interface is unsupported')
        return module
    config = root / 'hermes_cli' / 'config.py'
    if not config.is_file() or config.resolve(strict=True).parent != root / 'hermes_cli':
        raise ImportError('Hermes legacy YAML source is not bound')
    tree = ast.parse(config.read_text(encoding='utf-8'))
    imports = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    imports.update(node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom))
    if 'hermes_yaml' in imports or 'yaml' not in imports:
        raise ModuleNotFoundError('Hermes native YAML module is missing', name='hermes_yaml')
    return importlib.import_module('yaml')
