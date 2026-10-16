"""Actual provision/receipt code with private files and no model or network."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


def deny_external_io(event, args):
    if event in {'socket.bind', 'socket.connect', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system'}:
        raise AssertionError('External IO is forbidden in this fixture')


sys.addaudithook(deny_external_io)
PROJECT = Path(__file__).resolve().parents[2]
SECRET = 'PRIVATE-CREDENTIAL-REQUEST-MESSAGE'
PROOF_RECEIPTS = []


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class OwnedDiagnostics(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='owned-diagnostic-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / 'source'
        self.home.mkdir()
        (self.home / 'config.yaml').write_text('fixture source config', encoding='utf-8')
        (self.home / 'auth.json').write_text(SECRET, encoding='utf-8')
        profiles_file = self.root / 'profiles.py'
        profiles_file.write_text('''from pathlib import Path
ROOT = None
def get_profile_dir(name):
    return ROOT if name == 'default' else ROOT / 'profiles' / name
def profile_exists(name):
    return get_profile_dir(name).is_dir()
def _bootstrap_profile_dir(profile_dir, source_dir):
    for name in ('memories', 'sessions'):
        (profile_dir / name).mkdir(parents=True, exist_ok=True)
def _finish_profile_layout(profile_dir, *, no_skills, clone_all, description):
    (profile_dir / '.env').write_text('# empty native profile', encoding='utf-8')
''', encoding='utf-8')
        self.profiles = load('fixture_profiles', profiles_file)
        self.profiles.ROOT = self.home
        package = types.ModuleType('hermes_cli')
        package.__version__ = '0.22.0'
        package.__path__ = [str(self.root)]
        package.profiles = self.profiles
        yaml = types.ModuleType('yaml')
        yaml.safe_dump = lambda value, **kwargs: json.dumps(value, ensure_ascii=False)
        constants = types.ModuleType('hermes_constants')
        constants.VALID_REASONING_EFFORTS = ('low', 'max')
        modules = patch.dict(sys.modules, {'hermes_cli': package, 'hermes_cli.profiles': self.profiles,
                                          'yaml': yaml, 'hermes_constants': constants})
        modules.start()
        self.addCleanup(modules.stop)
        self.bootstrap = load('fixture_bootstrap', PROJECT / 'src/hermes-mcp-bootstrap.py')
        self.proof = {'paths': {'profiles': str(profiles_file.resolve())}}
        self.request = {
            'context': {'workspace': 'fixture', 'employeeId': 'employee_fixture', 'deviceId': 'device_fixture',
                        'name': '公司中文机器人🖼', 'sourceProfile': 'bot-fixture', 'config': {},
                        'instance': {'mode': 'owned_profile', 'profile': 'bot-fixture', 'templateProfile': 'default',
                                     'ownershipId': 'fixture-owner', 'provisionActionId': 'action_fixture'}},
            'metadata': {'version': 1, 'templateId': 'ziwei-hermes-bot', 'key': 'fixture-owner',
                         'workspace': 'fixture', 'employeeId': 'employee_fixture', 'deviceId': 'device_fixture',
                         'profile': 'bot-fixture', 'sourceProfile': 'bot-fixture', 'templateProfile': 'default',
                         'mode': 'owned_profile', 'provisionActionId': 'action_fixture', 'sourceHome': str(self.home)},
            'seedConfig': {'model': {'provider': 'fixture', 'default': SECRET}}, 'authentication': 'required',
        }

    def execute(self, raw=None):
        raw = raw if raw is not None else json.dumps(self.request, ensure_ascii=False).encode('utf-8')
        stdin = io.TextIOWrapper(io.BytesIO(raw + b'\n'), encoding='cp936', errors='strict')
        stdout = io.StringIO()
        argv = ['bootstrap.py', '--launcher', 'private-fixture-launcher', '--binding', json.dumps(self.proof),
                '--owned-profile-provision']
        with patch.object(self.bootstrap, 'binding', return_value=self.proof), patch.object(sys, 'argv', argv), \
                patch.object(sys, 'stdin', stdin), contextlib.redirect_stdout(stdout):
            self.assertEqual(self.bootstrap.run(), 0)
        lines = stdout.getvalue().splitlines()
        self.assertEqual(len(lines), 1, stdout.getvalue())
        self.assertTrue(lines[0].startswith('ZIWEI_BOT_PROVISION:'))
        return json.loads(lines[0].split(':', 1)[1])

    def diagnostic(self, receipt, stage, exception):
        self.assertEqual(receipt['status'], 'failed')
        self.assertEqual(receipt['code'], 'BOT_PROFILE_CREATE_FAILED')
        diagnostic = receipt['diagnostic']
        self.assertEqual(diagnostic['schemaVersion'], 1)
        self.assertEqual(diagnostic['stage'], stage)
        self.assertEqual(diagnostic['exception'], exception)
        self.assertLessEqual(set(diagnostic), {'schemaVersion', 'stage', 'exception', 'errno', 'winerror',
                                               'source', 'cleanupFailed'})
        if 'source' in diagnostic:
            source = diagnostic['source']
            self.assertEqual(set(source), {'file', 'function', 'line'})
            self.assertIn(source['file'], {'profiles.py', 'hermes-owned-profile.py'})
            self.assertIs(type(source['line']), int)
            self.assertTrue(1 <= source['line'] <= 100000)
        encoded = json.dumps(receipt)
        for forbidden in (SECRET, str(self.root), 'Traceback', '"filename":', '"message":', '"request":', '"environment":'):
            self.assertNotIn(forbidden, encoded)
        self.assertEqual((self.home / 'auth.json').read_text(), SECRET)
        self.assertEqual((self.home / 'config.yaml').read_text(), 'fixture source config')
        return diagnostic

    def test_cp936_stdin_still_reads_exact_utf8_protocol_and_preserves_duplicate(self):
        raw = json.dumps(self.request, ensure_ascii=False).encode('utf-8')
        with self.assertRaises(UnicodeDecodeError):
            raw.decode('cp936')
        first = self.execute(raw)
        self.assertEqual(first['status'], 'succeeded')
        self.assertNotIn('diagnostic', first)
        target = self.home / 'profiles' / 'bot-fixture'
        self.assertEqual((target / 'SOUL.md').read_text(encoding='utf-8'), '公司中文机器人🖼\n')
        (target / 'memories' / 'MEMORY.md').write_text('owned memory', encoding='utf-8')
        duplicate = self.execute(raw)
        self.assertTrue(duplicate['botProvision']['duplicate'])
        self.assertEqual((target / 'memories' / 'MEMORY.md').read_text(), 'owned memory')
        self.assertFalse((target / 'auth.json').exists())
        self.assertEqual((self.home / 'auth.json').read_text(), SECRET)

    def test_bad_json_has_bounded_read_request_diagnostic(self):
        self.diagnostic(self.execute(b'{"private":"' + SECRET.encode()), 'read_request', 'JSONDecodeError')

    def test_bad_utf8_is_reported_without_replacement_or_raw_bytes(self):
        self.diagnostic(self.execute(b'\xff' + SECRET.encode()), 'read_request', 'UnicodeDecodeError')

    def test_native_bootstrap_permission_error_has_errno_and_winerror_without_message(self):
        error = PermissionError(13, SECRET, str(self.root / SECRET))
        error.winerror = 5
        with patch.object(self.profiles, '_bootstrap_profile_dir', side_effect=error):
            receipt = self.execute()
            diagnostic = self.diagnostic(receipt, 'native_bootstrap', 'PermissionError')
        PROOF_RECEIPTS.append(receipt)
        self.assertEqual(diagnostic['errno'], 13)
        self.assertEqual(diagnostic['winerror'], 5)
        self.assertFalse((self.home / 'profiles' / 'bot-fixture').exists())
        self.assertEqual(list((self.home / 'profiles').iterdir()), [])

    def test_actual_native_helper_signature_error_is_identified_without_its_text(self):
        with patch.object(self.profiles, '_finish_profile_layout', lambda: None):
            self.diagnostic(self.execute(), 'native_layout', 'TypeError')

    def test_config_serialization_failure_keeps_its_write_stage(self):
        with patch.object(sys.modules['yaml'], 'safe_dump', side_effect=ValueError(SECRET)):
            self.diagnostic(self.execute(), 'write_config', 'ValueError')

    def test_cleanup_failure_does_not_replace_publish_error(self):
        error = PermissionError(13, SECRET, str(self.root / SECRET))
        error.winerror = 32
        with patch('os.rename', side_effect=error), patch('shutil.rmtree', side_effect=RuntimeError(SECRET)):
            diagnostic = self.diagnostic(self.execute(), 'publish', 'PermissionError')
        self.assertEqual(diagnostic['winerror'], 32)
        self.assertIs(diagnostic['cleanupFailed'], True)
        self.assertFalse((self.home / 'profiles' / 'bot-fixture').exists())

    def test_cleanup_only_failure_has_its_own_stage(self):
        import shutil
        def published_elsewhere(stage, target):
            shutil.copytree(stage, target)
            raise FileExistsError(SECRET)
        with patch('os.rename', side_effect=published_elsewhere), \
                patch('shutil.rmtree', side_effect=PermissionError(13, SECRET)):
            diagnostic = self.diagnostic(self.execute(), 'cleanup', 'PermissionError')
        self.assertNotIn('cleanupFailed', diagnostic)

    def test_unknown_exception_and_forged_diagnostic_fields_cannot_leak(self):
        class CustomerPrivateException(Exception):
            pass
        error = CustomerPrivateException(SECRET)
        error._ziwei_profile_diagnostic = {'message': SECRET, 'stage': SECRET}
        with patch.object(self.profiles, '_bootstrap_profile_dir', side_effect=error):
            diagnostic = self.diagnostic(self.execute(), 'native_bootstrap', 'OtherError')
        self.assertNotIn('CustomerPrivateException', json.dumps(diagnostic))

    def test_error_numbers_are_strict_bounded_integers(self):
        for errno, winerror in ((True, False), (-1, -1), (256, 65536), ('13', '5')):
            with self.subTest(errno=errno, winerror=winerror):
                error = ValueError(SECRET)
                error.errno, error.winerror = errno, winerror
                with patch.object(self.profiles, '_bootstrap_profile_dir', side_effect=error):
                    diagnostic = self.diagnostic(self.execute(), 'native_bootstrap', 'ValueError')
                self.assertNotIn('errno', diagnostic)
                self.assertNotIn('winerror', diagnostic)

    def test_explicit_profile_identity_code_is_preserved(self):
        self.request['metadata']['deviceId'] = SECRET
        receipt = self.execute()
        self.assertEqual(receipt['status'], 'failed')
        self.assertEqual(receipt['code'], 'BOT_PROFILE_IDENTITY_INVALID')
        self.assertEqual(receipt['diagnostic']['stage'], 'identity')
        self.assertEqual(receipt['diagnostic']['exception'], 'RuntimeError')
        self.assertNotIn(SECRET, json.dumps(receipt))

    def test_profile_prefix_cannot_turn_private_error_text_into_a_public_code(self):
        with patch.object(self.profiles, '_bootstrap_profile_dir', side_effect=RuntimeError('BOT_PROFILE_' + SECRET)):
            self.diagnostic(self.execute(), 'native_bootstrap', 'RuntimeError')


if __name__ == '__main__':
    outcome = unittest.main(exit=False)
    if outcome.result.wasSuccessful():
        print('ZIWEI_DIAGNOSTIC_RECEIPTS:' + json.dumps(PROOF_RECEIPTS))
    sys.exit(0 if outcome.result.wasSuccessful() else 1)
