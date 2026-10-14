"""Copy the exact approved one-subject legacy bytes; never collect or mint proof.

Run locally on the original Windows host. The pinned original handoff must
bind the exact historical 26-file set. The schema and SHA come from the
original handoff writer/recheck records. JSON references are never discovered
recursively; caller pins and fields cannot select another set.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import zipfile

ACTION = 'action_8668054e-e2e9-476b-acb1-d20f561eb661'
COUNT = 26
HANDOFF_SHA256 = 'a74064567961cffab88e60ac5857f93a3a4adf9d8613d16ceb8a7301d048ab45'
HANDOFF_PATH = r'C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解\.local\r01-abi-legacy-qualification-20261014\handoff-abi-legacy-qualification-01.json'
HANDOFF_COMMIT = 'af6d95e6947affb6275f9ab89d30ef5bde6d637e'
MAX_FILE = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
# These are independently documented existing source bytes, not new evidence.
ANCHORS = {
    '8c4fb3952a5f03c09c66b53c8263c7bddad9dd7f2fd55b2af5655dcd91802636': ('producer', 3036),
    '6e5dce6563e61f71109a4b963784a3b22cc535ad6ed92c315d87df1ca1359d06': ('capture', None),
    '447bf1c4db2b8a51f15f71e433803e030ec84ba3124b407987e1f3bd53c02403': ('loggerStart', 5245726),
    '4794319aa2c10cab415febc45305e29e3b1c5dd13400b1dc92e4e8b6ba248456': ('loggerEnd', 5243346),
}

class Refused(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

def require(condition, code):
    if not condition:
        raise Refused(code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)

def plain_path(value, directory=False):
    p = Path(value)
    require(isinstance(value, str) and str(p) == value and p.is_absolute() and os.path.normpath(value) == value, 'PATH_NOT_CANONICAL')
    require(not str(p).startswith('\\\\'), 'PATH_REMOTE_REFUSED')
    for item in [p, *p.parents]:
        try:
            info = item.lstat()
        except FileNotFoundError:
            raise Refused('REQUIRED_FILE_MISSING') from None
        require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400), 'PATH_LINKED')
    require(os.path.normcase(str(p.resolve(strict=True))) == os.path.normcase(str(p)), 'PATH_REDIRECTED')
    require(p.is_dir() if directory else p.is_file(), 'PATH_NOT_REGULAR')
    return p

def verify_native_final_path(stream, expected):
    if os.name != 'nt':
        return
    import ctypes
    from ctypes import wintypes
    import msvcrt
    get_final = ctypes.WinDLL('kernel32', use_last_error=True).GetFinalPathNameByHandleW
    get_final.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    get_final.restype = wintypes.DWORD
    handle = msvcrt.get_osfhandle(stream.fileno())
    length = get_final(handle, None, 0, 0)
    require(0 < length < 32768, 'NATIVE_FINAL_PATH_REFUSED')
    buffer = ctypes.create_unicode_buffer(length + 1)
    returned = get_final(handle, buffer, len(buffer), 0)
    require(0 < returned < len(buffer), 'NATIVE_FINAL_PATH_REFUSED')
    final = buffer.value
    if final.startswith('\\\\?\\'):
        final = final[4:]
    require(os.path.normcase(final) == os.path.normcase(str(expected)), 'NATIVE_PATH_REDIRECTED')

def read_plain(value, expected=None):
    p = plain_path(value)
    before = p.lstat()
    require(before.st_nlink == 1 and before.st_size <= MAX_FILE, 'FILE_LINK_OR_SIZE_REFUSED')
    with p.open('rb') as stream:
        verify_native_final_path(stream, p)
        require(identity(os.fstat(stream.fileno())) == identity(before), 'SOURCE_CHANGED')
        data = stream.read(MAX_FILE + 1)
        require(identity(os.fstat(stream.fileno())) == identity(before), 'SOURCE_CHANGED')
    require(identity(p.lstat()) == identity(before), 'SOURCE_CHANGED')
    require(len(data) == before.st_size and len(data) <= MAX_FILE, 'SOURCE_CHANGED')
    if expected:
        require(len(data) == expected['bytes'] and sha(data) == expected['sha256'], 'HASH_OR_SIZE_MISMATCH')
    return data

def load_pinned_json(file, pin, missing_code):
    require(bool(file), missing_code)
    require(isinstance(pin, str) and re.fullmatch(r'[a-f0-9]{64}', pin), 'HANDOFF_PIN_MISSING' if missing_code == 'HANDOFF_MISSING' else 'MANIFEST_PIN_MISSING')
    data = read_plain(file)
    require(sha(data) == pin, 'HANDOFF_HASH_MISMATCH' if missing_code == 'HANDOFF_MISSING' else 'MANIFEST_HASH_MISMATCH')
    try:
        parsed = json.loads(data.decode('utf-8-sig'))
    except (UnicodeError, json.JSONDecodeError):
        raise Refused('MANIFEST_JSON_INVALID') from None
    return parsed, data

def handoff_files(handoff):
    require(isinstance(handoff, dict) and handoff.get('schemaVersion') == 1 and handoff.get('kind') == 'r01-abi-legacy-qualification-finite-checkpoint' and handoff.get('commit') == HANDOFF_COMMIT, 'APPROVED_HANDOFF_IDENTITY_REFUSED')
    require(isinstance(handoff.get('code'), list) and len(handoff['code']) == 10 and isinstance(handoff.get('evidence'), list) and len(handoff['evidence']) == 12 and isinstance(handoff.get('productBasis'), dict) and isinstance(handoff['productBasis'].get('code'), list) and len(handoff['productBasis']['code']) == 2, 'APPROVED_26_MANIFEST_INCOMPLETE')
    # Exact composition recovered from the original already approved recheck.
    # It is 10 + 12 + 2 + 1 + 1, not an invented single array or 11-file policy.
    return [*handoff['code'], *handoff['evidence'], *handoff['productBasis']['code'], handoff.get('approvedGenerationSource'), handoff.get('originalCaptureReference')]

def validate_files(rows, check_anchors=True):
    require(isinstance(rows, list) and len(rows) == COUNT, 'APPROVED_26_MANIFEST_INCOMPLETE')
    seen = set()
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get('path'), str) and isinstance(row.get('sha256'), str) and re.fullmatch(r'[a-f0-9]{64}', row['sha256']) and type(row.get('bytes')) is int and 0 < row['bytes'] <= MAX_FILE, 'APPROVED_FILE_DESCRIPTOR_INVALID')
        require(str(Path(row['path'])) == row['path'] and os.path.normpath(row['path']) == row['path'], 'PATH_NOT_CANONICAL')
        key = os.path.normcase(os.path.normpath(row['path']))
        require(key not in seen, 'APPROVED_26_MANIFEST_DUPLICATE')
        seen.add(key)
        name = Path(row['path']).name.lower()
        require(name not in ['auth.json', 'ziwei_user.json', '.env', '.npmrc', '.netrc', '.git-credentials', 'credentials.json', 'id_rsa', 'id_ed25519'] and not name.endswith(('.sqlite', '.sqlite-wal', '.sqlite-shm', '.db', '.pem', '.key', '.pfx', '.p12')) and not name.startswith('.env.'), 'AUTH_HOME_OR_DATABASE_REFUSED')
    require(sum(row['bytes'] for row in rows) <= MAX_TOTAL, 'EXPORT_BYTE_LIMIT')
    if check_anchors:
        for digest, (role, size) in ANCHORS.items():
            matches = [row for row in rows if row['sha256'] == digest]
            require(len(matches) == 1 and (size is None or matches[0]['bytes'] == size), 'APPROVED_' + role.upper() + '_MISSING')
    return rows

CODE_PATHS = [
    'scripts/operations/r01-production-wire.mjs',
    'scripts/operations/r01-production-wire.test.mjs',
    'scripts/operations/r01-legacy-logger-qualification.mjs',
    'scripts/operations/r01-legacy-logger-qualification.test.mjs',
    'scripts/operations/r01-legacy-native-bytes-readonly.py',
    'scripts/operations/r01-linux-source-readonly.py',
    'scripts/operations/r01-proof-provider.mjs',
    'scripts/operations/r01-phase-controller.mjs',
    'scripts/operations/r01-finite-source-capture.mjs',
    'docs/operations/2026-10-14-r01-abi-logger-qualification-checkpoint.md',
]

def code_recovery_policy(handoff):
    policies = {}
    require([row.get('gitPath') for row in handoff['code']] == CODE_PATHS, 'APPROVED_CODE_SET_REFUSED')
    for row in handoff['code']:
        require(re.fullmatch(r'[a-f0-9]{40}', row.get('gitBlob', '')) is not None, 'APPROVED_GIT_BLOB_REFUSED')
        policies[row['path']] = {'root': handoff['tree'], 'commit': HANDOFF_COMMIT, 'gitPath': row['gitPath'], 'gitBlob': row['gitBlob']}
    require(handoff['productBasis'].get('commit') == '2ea61b6a5ff748c9a22502ba1df3f177cee7c693', 'APPROVED_PRODUCT_BASIS_REFUSED')
    for row, relative in zip(handoff['productBasis']['code'], ['backend/production-preservation.mjs', 'backend/preservation-source-namespace.mjs']):
        require(os.path.normcase(str(Path(handoff['productBasis']['tree']) / Path(relative))) == os.path.normcase(row['path']), 'APPROVED_PRODUCT_CODE_REFUSED')
        policies[row['path']] = {'root': handoff['productBasis']['tree'], 'commit': handoff['productBasis']['commit'], 'gitPath': relative}
    return policies

def git_code_bytes(row, policy):
    # Local object reads only: no checkout, install, external filters or network.
    root = plain_path(policy['root'], directory=True)
    require(re.fullmatch(r'[a-f0-9]{40}', policy['commit']) is not None and policy['gitPath'] in CODE_PATHS + ['backend/production-preservation.mjs', 'backend/preservation-source-namespace.mjs'], 'APPROVED_GIT_REFERENCE_REFUSED')
    def git(*args):
        result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, timeout=10)
        require(result.returncode == 0, 'APPROVED_GIT_BLOB_MISSING')
        return result.stdout
    blob = git('rev-parse', '--verify', policy['commit'] + ':' + policy['gitPath']).decode('ascii').strip()
    require(re.fullmatch(r'[a-f0-9]{40}', blob) is not None and ('gitBlob' not in policy or policy['gitBlob'] == blob), 'APPROVED_GIT_BLOB_REFUSED')
    size = git('cat-file', '-s', blob).decode('ascii').strip()
    require(size.isdigit() and int(size) <= MAX_FILE, 'APPROVED_GIT_BLOB_SIZE_REFUSED')
    raw = git('cat-file', 'blob', blob)
    require(len(raw) == int(size), 'APPROVED_GIT_BLOB_CHANGED')
    # Git checkout newline conversion is accepted only if it recovers the exact
    # independently pinned historical bytes. No raw evidence may use this path.
    lf = raw.replace(b'\r\n', b'\n')
    for data in [raw, lf, lf.replace(b'\n', b'\r\n')]:
        if len(data) == row['bytes'] and sha(data) == row['sha256']:
            return data, {'byteSource': 'approved-local-git-blob-exact-pin', 'gitCommit': policy['commit'], 'gitBlob': blob}
    raise Refused('APPROVED_GIT_BYTE_PIN_MISMATCH')

def private_directory(value):
    p = Path(value)
    require(p.is_absolute() and os.path.normpath(str(p)) == str(p), 'EXPORT_PATH_INVALID')
    plain_path(str(p.parent), directory=True)
    require(not p.exists() and not p.is_symlink(), 'EXPORT_ALREADY_EXISTS')
    p.mkdir(mode=0o700)
    if os.name == 'nt':
        script = r"""$ErrorActionPreference='Stop';$p=$env:R01_EXPORT_DIRECTORY;$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18');$acl=New-Object System.Security.AccessControl.DirectorySecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($id in @($sid,$system)){$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)};Set-Acl -LiteralPath $p -AclObject $acl;$actual=Get-Acl -LiteralPath $p;$rules=@($actual.Access);if(-not $actual.AreAccessRulesProtected -or $rules.Count -ne 2){throw 'ACL_REFUSED'};foreach($r in $rules){$id=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;if($id -notin @($sid.Value,'S-1-5-18') -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne 'FullControl'){throw 'ACL_REFUSED'}};'ACL_OK'"""
        env = dict(os.environ, R01_EXPORT_DIRECTORY=str(p))
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', base64.b64encode(script.encode('utf-16le')).decode()], env=env, capture_output=True, timeout=20)
        require(result.returncode == 0 and result.stdout.decode('utf-8', errors='replace').strip() == 'ACL_OK', 'EXPORT_ACL_REFUSED')
    else:
        p.chmod(0o700)
    return p

def write_private(path, data):
    with path.open('xb') as stream:
        stream.write(data)
    if os.name != 'nt':
        path.chmod(0o600)
    require(sha(path.read_bytes()) == sha(data), 'EXPORT_READBACK_MISMATCH')

def transfer(rows, output=None, handoff_bytes=None, manifest_bytes=None, code_recovery=None):
    copied = []
    missing = []
    if output:
        (output / 'files').mkdir(mode=0o700)
        write_private(output / 'handoff.raw.json', handoff_bytes)
        if manifest_bytes is not None:
            write_private(output / 'approved-manifest.raw.json', manifest_bytes)
    for index, row in enumerate(rows):
        try:
            byte_source = {'byteSource': 'original-pinned-file'}
            try:
                data = read_plain(row['path'], row)
            except Refused as error:
                if error.code not in ['REQUIRED_FILE_MISSING', 'HASH_OR_SIZE_MISMATCH'] or not code_recovery or row['path'] not in code_recovery:
                    raise
                data, byte_source = git_code_bytes(row, code_recovery[row['path']])
            relative = f'files/{index:02d}-{row["sha256"][:16]}.bin'
            if output:
                write_private(output / relative, data)
            copied.append({'index': index, 'originalPath': row['path'], 'relativeExportPath': relative, 'sha256': row['sha256'], 'bytes': row['bytes'], **byte_source, **({'sourcePath': row['sourcePath']} if 'sourcePath' in row else {})})
        except Refused as error:
            missing.append({'index': index, 'code': error.code})
        except OSError:
            missing.append({'index': index, 'code': 'REQUIRED_FILE_READ_REFUSED'})
    report = {'schemaVersion': 1, 'kind': 'r01-one-subject-approved-byte-export', 'actionId': ACTION, 'complete': len(copied) == COUNT and not missing, 'expectedFiles': COUNT, 'verifiedFiles': len(copied), 'files': copied, 'missing': missing, 'sourceWrites': 0, 'serviceActions': 0, 'modelCalls': 0, 'phoneActions': 0, 'collectorsExecuted': 0, 'originalActionProofMinted': False, 'namespaceComplete': None, 'formalGatePassed': False, 'createdUTC': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if output:
        report['handoffSha256'] = sha(handoff_bytes)
        if manifest_bytes is not None:
            report['approvedManifestSha256'] = sha(manifest_bytes)
        write_private(output / 'export-manifest.json', (json.dumps(report, ensure_ascii=True, indent=2) + '\n').encode())
        if report['complete']:
            bundle = output / 'private-bundle.zip'
            with zipfile.ZipFile(bundle, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
                for relative in ['handoff.raw.json', 'export-manifest.json', *(['approved-manifest.raw.json'] if manifest_bytes is not None else []), *[row['relativeExportPath'] for row in copied]]:
                    archive.write(output / relative, relative)
            if os.name != 'nt':
                bundle.chmod(0o600)
            with zipfile.ZipFile(bundle) as archive:
                require(archive.testzip() is None, 'EXPORT_ARCHIVE_READBACK_REFUSED')
                require(archive.read('handoff.raw.json') == handoff_bytes, 'EXPORT_ARCHIVE_READBACK_REFUSED')
                require(archive.read('export-manifest.json') == (output / 'export-manifest.json').read_bytes(), 'EXPORT_ARCHIVE_READBACK_REFUSED')
                for row in copied:
                    data = archive.read(row['relativeExportPath'])
                    require(len(data) == row['bytes'] and sha(data) == row['sha256'], 'EXPORT_ARCHIVE_READBACK_REFUSED')
            report['bundleSha256'] = sha(bundle.read_bytes())
            report['bundleBytes'] = bundle.stat().st_size
            write_private(output / 'bundle-receipt.json', (json.dumps({'actionId': ACTION, 'bundleSha256': report['bundleSha256'], 'bundleBytes': report['bundleBytes'], 'complete': True, 'formalGatePassed': False}, indent=2) + '\n').encode())
    return report

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--handoff')
    parser.add_argument('--handoff-sha256')
    parser.add_argument('--output', help='Fresh absolute private output directory, export mode only')
    parser.add_argument('--mode', choices=['plan', 'export'], default='plan')
    args = parser.parse_args(argv)
    try:
        require(os.name == 'nt', 'EXPORT_REQUIRES_ORIGINAL_WINDOWS')
        require(args.handoff is None or os.path.normcase(args.handoff) == os.path.normcase(HANDOFF_PATH), 'FOREIGN_HANDOFF_PATH_REFUSED')
        require(args.handoff_sha256 is None or args.handoff_sha256 == HANDOFF_SHA256, 'FOREIGN_HANDOFF_PIN_REFUSED')
        handoff, handoff_bytes = load_pinned_json(HANDOFF_PATH, HANDOFF_SHA256, 'HANDOFF_MISSING')
        rows = validate_files(handoff_files(handoff))
        manifest_bytes = None
        require(args.mode == 'export' or args.output is None, 'PLAN_OUTPUT_REFUSED')
        require(args.mode != 'export' or args.output is not None, 'EXPORT_OUTPUT_REQUIRED')
        output = private_directory(args.output) if args.mode == 'export' else None
        report = transfer(rows, output, handoff_bytes, manifest_bytes, code_recovery_policy(handoff))
        result = {key: report[key] for key in ['actionId', 'complete', 'expectedFiles', 'verifiedFiles', 'missing', 'sourceWrites', 'serviceActions', 'collectorsExecuted', 'originalActionProofMinted', 'formalGatePassed']}
        result['mode'] = args.mode
        if 'bundleSha256' in report:
            result.update(bundleSha256=report['bundleSha256'], bundleBytes=report['bundleBytes'])
        print(json.dumps(result, ensure_ascii=True))
        return 0 if report['complete'] else 1
    except Refused as error:
        print(json.dumps({'actionId': ACTION, 'complete': False, 'code': error.code, 'sourceWrites': 0, 'serviceActions': 0, 'originalActionProofMinted': False, 'formalGatePassed': False}))
        return 1
    except (OSError, subprocess.SubprocessError, zipfile.BadZipFile):
        print(json.dumps({'actionId': ACTION, 'complete': False, 'code': 'EXPORT_IO_REFUSED', 'sourceWrites': 0, 'serviceActions': 0, 'originalActionProofMinted': False, 'formalGatePassed': False}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
