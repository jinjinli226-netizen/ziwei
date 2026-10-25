import importlib.util
import logging
import os
from pathlib import Path
import sys
import types
import unittest

SPEC = importlib.util.spec_from_file_location('bot_provider_key', Path(__file__).parents[1] / 'src/hermes-provider-key.py')
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class ExplicitProviderTests(unittest.TestCase):
    def setUp(self):
        self.old_message = logging.LogRecord.getMessage
        self.old_format = logging.Formatter.format
        self.package = sys.modules.get('hermes_cli')
        self.module = sys.modules.get('hermes_cli.runtime_provider')
        sys.modules['hermes_cli'] = types.ModuleType('hermes_cli')
        self.native = types.ModuleType('hermes_cli.runtime_provider')
        sys.modules['hermes_cli.runtime_provider'] = self.native
        os.environ.update(ZIWEI_BOT_PROVIDER_KEY='synthetic-local-key', ZIWEI_BOT_KEY_PROVIDER='deepseek', ZIWEI_BOT_KEY_ENDPOINT='https://api.deepseek.com')

    def tearDown(self):
        logging.LogRecord.getMessage = self.old_message
        logging.Formatter.format = self.old_format
        for key, previous in [('hermes_cli', self.package), ('hermes_cli.runtime_provider', self.module)]:
            if previous is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = previous
        for key in ['ZIWEI_BOT_PROVIDER_KEY', 'ZIWEI_BOT_KEY_PROVIDER', 'ZIWEI_BOT_KEY_ENDPOINT']:
            os.environ.pop(key, None)

    def test_explicit_credentials_override_shared_source(self):
        def resolve(*, requested=None, explicit_api_key=None, explicit_base_url=None, target_model=None):
            return dict(provider=requested, api_key=explicit_api_key or 'shared-key', base_url=explicit_base_url or 'https://wrong.example')
        self.native.resolve_runtime_provider = resolve
        bridge.install(RuntimeError)
        result = self.native.resolve_runtime_provider(requested='deepseek')
        self.assertEqual(result['api_key'], 'synthetic-local-key')
        self.assertNotIn('ZIWEI_BOT_PROVIDER_KEY', os.environ)
        with self.assertRaisesRegex(RuntimeError, 'binding changed'):
            self.native.resolve_runtime_provider(requested='openai')
        record = logging.LogRecord('test', 30, '', 1, 'failure synthetic-local-key', (), None)
        self.assertNotIn('synthetic-local-key', record.getMessage())
        try:
            raise ValueError('synthetic-local-key')
        except ValueError:
            record = logging.LogRecord('test', 40, '', 1, 'provider failure', (), sys.exc_info())
            self.assertNotIn('synthetic-local-key', logging.Formatter().format(record))

    def test_unsupported_native_signature_fails_before_model(self):
        self.native.resolve_runtime_provider = lambda: None
        with self.assertRaisesRegex(RuntimeError, 'protocol unsupported'):
            bridge.install(RuntimeError)

    def test_native_fallback_key_is_rejected(self):
        def resolve(*, requested=None, explicit_api_key=None, explicit_base_url=None):
            return dict(api_key='shared-key', base_url=explicit_base_url)
        self.native.resolve_runtime_provider = resolve
        bridge.install(RuntimeError)
        with self.assertRaisesRegex(RuntimeError, 'route mismatch'):
            self.native.resolve_runtime_provider(requested='deepseek')


if __name__ == '__main__':
    unittest.main()
