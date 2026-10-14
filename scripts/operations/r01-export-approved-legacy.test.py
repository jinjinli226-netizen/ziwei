"""Disposable byte-copy tests; no actual Windows/native/production qualification."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('exporter', Path(__file__).with_name('r01-export-approved-legacy.py'))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

class ExportTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / '.local' / 'release-verification' / 'tmp'
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.root = Path(self.temp.name).resolve()
        self.rows = []
        for index in range(26):
            file = self.root / f'{index}.raw'
            data = f'approved-fixture-{index}\n'.encode()
            file.write_bytes(data)
            self.rows.append({'path': str(file), 'sha256': api.sha(data), 'bytes': len(data)})
    def tearDown(self):
        self.temp.cleanup()
    def assert_code(self, code, function, *args, **kwargs):
        with self.assertRaises(api.Refused) as result:
            function(*args, **kwargs)
        self.assertEqual(result.exception.code, code)
    def test_original_bytes_only_complete_archive_and_immutable_sources(self):
        before = [(Path(row['path']).read_bytes(), api.identity(Path(row['path']).stat())) for row in self.rows]
        output = api.private_directory(str(self.root / 'new-export'))
        handoff = b'{"privateOriginal":"fixture-original-call-input"}'
        report = api.transfer(api.validate_files(self.rows, check_anchors=False), output, handoff)
        self.assertTrue(report['complete'])
        self.assertFalse(report['formalGatePassed'])
        self.assertFalse(report['originalActionProofMinted'])
        self.assertEqual(report['sourceWrites'], 0)
        with zipfile.ZipFile(output / 'private-bundle.zip') as archive:
            self.assertEqual(len(archive.namelist()), 28)
            self.assertEqual(archive.read('handoff.raw.json'), handoff)
            for row, receipt in zip(self.rows, report['files']):
                self.assertEqual(archive.read(receipt['relativeExportPath']), Path(row['path']).read_bytes())
        self.assertEqual(before, [(Path(row['path']).read_bytes(), api.identity(Path(row['path']).stat())) for row in self.rows])
        if os.name != 'nt':
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertTrue(all((p.stat().st_mode & 0o777) == 0o600 for p in output.rglob('*') if p.is_file()))
    def test_missing_ref_retains_partial_report_without_complete_archive(self):
        Path(self.rows[5]['path']).unlink()
        output = api.private_directory(str(self.root / 'partial'))
        result = api.transfer(self.rows, output, b'{}')
        self.assertFalse(result['complete'])
        self.assertEqual(result['verifiedFiles'], 25)
        self.assertEqual(result['missing'], [{'index': 5, 'code': 'REQUIRED_FILE_MISSING'}])
        self.assertFalse((output / 'private-bundle.zip').exists())
        self.assertFalse(json.loads((output / 'export-manifest.json').read_text())['complete'])
    def test_tampered_bytes_are_refused_without_printing_or_copying_body(self):
        Path(self.rows[8]['path']).write_bytes(b'changed-private-body')
        output = api.private_directory(str(self.root / 'changed'))
        result = api.transfer(self.rows, output, b'{}')
        self.assertFalse(result['complete'])
        self.assertEqual(result['missing'], [{'index': 8, 'code': 'HASH_OR_SIZE_MISMATCH'}])
        self.assertNotIn('changed-private-body', json.dumps(result))
    def test_exact_count_unique_and_explicit_descriptor_types(self):
        self.assert_code('APPROVED_26_MANIFEST_INCOMPLETE', api.validate_files, self.rows[:-1], False)
        self.assert_code('APPROVED_26_MANIFEST_DUPLICATE', api.validate_files, self.rows[:-1] + [self.rows[0]], False)
        rows = [dict(row) for row in self.rows]
        rows[0]['bytes'] = True
        self.assert_code('APPROVED_FILE_DESCRIPTOR_INVALID', api.validate_files, rows, False)
        self.assert_code('APPROVED_PRODUCER_MISSING', api.validate_files, self.rows)
    def test_authority_file_and_database_are_refused(self):
        for name in ['auth.json', 'ziwei_user.json', '.env', '.npmrc', 'private.key', 'ziwei.sqlite']:
            rows = [dict(row) for row in self.rows]
            rows[0]['path'] = str(self.root / name)
            self.assert_code('AUTH_HOME_OR_DATABASE_REFUSED', api.validate_files, rows, False)
    def test_symlink_hardlink_and_noncanonical_path_refused(self):
        linked = self.root / 'linked.raw'
        linked.symlink_to(self.rows[0]['path'])
        self.assert_code('PATH_LINKED', api.read_plain, str(linked))
        hard = self.root / 'hard.raw'
        os.link(self.rows[1]['path'], hard)
        self.assert_code('FILE_LINK_OR_SIZE_REFUSED', api.read_plain, str(hard))
        self.assert_code('PATH_NOT_CANONICAL', api.read_plain, str(self.root) + '/unseen/../0.raw')
    def test_pinned_handoff_exact_schema_no_recursive_discovery(self):
        file = self.root / 'handoff.json'
        value = {'schemaVersion': 1, 'kind': 'r01-abi-legacy-qualification-finite-checkpoint', 'commit': api.HANDOFF_COMMIT, 'code': self.rows[:10], 'evidence': self.rows[10:22], 'productBasis': {'code': self.rows[22:24]}, 'approvedGenerationSource': self.rows[24], 'originalCaptureReference': self.rows[25], 'unapproved': {'path': '/outside/auth.json'}}
        raw = json.dumps(value).encode()
        file.write_bytes(raw)
        parsed, copied = api.load_pinned_json(str(file), api.sha(raw), 'HANDOFF_MISSING')
        self.assertEqual(copied, raw)
        self.assertEqual(api.handoff_files(parsed), self.rows)
        foreign = dict(value, commit='another-commit')
        self.assert_code('APPROVED_HANDOFF_IDENTITY_REFUSED', api.handoff_files, foreign)
        foreign = dict(value, code=self.rows[:9])
        self.assert_code('APPROVED_26_MANIFEST_INCOMPLETE', api.handoff_files, foreign)
        self.assert_code('HANDOFF_HASH_MISMATCH', api.load_pinned_json, str(file), '0' * 64, 'HANDOFF_MISSING')
        self.assert_code('HANDOFF_PIN_MISSING', api.load_pinned_json, str(file), None, 'HANDOFF_MISSING')
    def test_path_aliases_cannot_count_as_additional_files(self):
        for suffix in ['/./1.raw', '//1.raw', '/extra/../1.raw']:
            rows = [dict(row) for row in self.rows]
            rows[25]['path'] = str(self.root) + suffix
            self.assert_code('PATH_NOT_CANONICAL', api.validate_files, rows, False)
    def test_plan_reads_only_and_export_refuses_existing_output(self):
        before = set(self.root.iterdir())
        report = api.transfer(self.rows)
        self.assertTrue(report['complete'])
        self.assertEqual(before, set(self.root.iterdir()))
        self.assert_code('EXPORT_ALREADY_EXISTS', api.private_directory, str(self.root))
    def test_local_git_recovers_exact_code_bytes_without_replacing_raw_evidence(self):
        repository = self.root / 'repo'
        repository.mkdir()
        def git(*args):
            result = subprocess.run(['git', '-C', str(repository), *args], capture_output=True, check=True)
            return result.stdout.decode().strip()
        git('init', '-q')
        relative = api.CODE_PATHS[0]
        file = repository / relative
        file.parent.mkdir(parents=True)
        code = b'// finite public code\nexport const fixture = 1;\n'
        file.write_bytes(code)
        git('-c', 'core.autocrlf=false', 'add', relative)
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'fixture')
        commit = git('rev-parse', 'HEAD')
        blob = git('rev-parse', 'HEAD:' + relative)
        pinned = code.replace(b'\n', b'\r\n')
        rows = [dict(row) for row in self.rows]
        rows[0].update(sha256=api.sha(pinned), bytes=len(pinned))
        policy = {rows[0]['path']: {'root': str(repository), 'commit': commit, 'gitPath': relative, 'gitBlob': blob}}
        Path(rows[25]['path']).unlink()
        output = api.private_directory(str(self.root / 'git-recovery'))
        report = api.transfer(rows, output, b'{}', code_recovery=policy)
        self.assertFalse(report['complete'])
        self.assertEqual(report['missing'], [{'index': 25, 'code': 'REQUIRED_FILE_MISSING'}])
        recovered = report['files'][0]
        self.assertEqual(recovered['byteSource'], 'approved-local-git-blob-exact-pin')
        self.assertEqual((output / recovered['relativeExportPath']).read_bytes(), pinned)
        self.assertEqual(file.read_bytes(), code)
        wrong = dict(rows[0], sha256='0' * 64)
        self.assert_code('APPROVED_GIT_BYTE_PIN_MISMATCH', api.git_code_bytes, wrong, policy[rows[0]['path']])
    @unittest.skipIf(os.name == 'nt', 'Only checks explicit non-Windows CLI refusal')
    def test_cli_cannot_claim_windows_export_on_other_platform(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = api.main(['--mode', 'export', '--output', str(self.root / 'never-created')])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(output.getvalue())['code'], 'EXPORT_REQUIRES_ORIGINAL_WINDOWS')
        self.assertFalse((self.root / 'never-created').exists())

if __name__ == '__main__':
    unittest.main()
