#!/usr/bin/env python3
"""Build an explicitly unsigned or explicitly signed identity candidate without adb/listeners."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone

MODULE = Path(__file__).resolve().parent.parent
REPO = MODULE.parent
CACHE = Path.home() / ".cache/ziwei-manager-android"
ORIGINAL_SIGNER_SHA256 = "507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35"
TOOL_INPUT_DIRECTORIES = ("android/src", "android/res", "web")
TOOL_INPUT_MANIFEST = "android/AndroidManifest.xml"


def run(command, *, env=None, capture=False):
    # Deliberately log tool names only; signing passwords/paths and request data are never echoed.
    print("Running " + Path(command[0]).name, flush=True)
    try:
        result = subprocess.run([str(value) for value in command], check=True, env=env,
                                capture_output=capture, text=True, encoding="utf-8", errors="replace")
    except subprocess.CalledProcessError as error:
        # CalledProcessError.__str__ includes the entire command, including private paths.
        raise RuntimeError("Tool failed: " + Path(command[0]).name + " (exit " + str(error.returncode) + ")") from None
    return result.stdout if capture else ""


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def executable(directory, name):
    for suffix in (".exe", "") if os.name == "nt" else ("", ".exe"):
        path = directory / (name + suffix)
        if path.is_file():
            return path
    raise RuntimeError("Required tool is missing: " + name)


def archive_name(path):
    return path.as_posix()


def tool_input_files(module):
    files = {}
    for directory in TOOL_INPUT_DIRECTORIES:
        root = module / directory
        if not root.is_dir() or root.is_symlink():
            raise RuntimeError("Android tool input directory is missing or symlinked: " + directory)
        for path in sorted(root.rglob("*")):
            relative = path.relative_to(module)
            if path.is_symlink():
                raise RuntimeError("Symlinked Android tool input is forbidden")
            if path.is_file():
                files[archive_name(relative)] = path
    manifest = module / TOOL_INPUT_MANIFEST
    if not manifest.is_file() or manifest.is_symlink():
        raise RuntimeError("Android tool input manifest is missing or symlinked")
    files[TOOL_INPUT_MANIFEST] = manifest
    return files


def verify_staged_inputs(original, staged):
    originals, copies = tool_input_files(original), tool_input_files(staged)
    if originals.keys() != copies.keys() or any(path.read_bytes() != copies[name].read_bytes()
                                               for name, path in originals.items()):
        raise RuntimeError("Original and staged Android tool inputs differ; rebuild the candidate")


def stage_tool_inputs(module, work):
    # Windows aapt2 cannot open the original Unicode checkout path. Keep tool
    # sources, resources, assets and APKs in an ASCII temporary directory.
    if not str(work).isascii():
        raise RuntimeError("Android tools require an ASCII temporary path; set TEMP/TMP to an ASCII directory")
    files = tool_input_files(module)
    staged = work / "inputs"
    for name, path in files.items():
        target = staged / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    verify_staged_inputs(module, staged)
    return staged


def source_provenance(repo=REPO, module=MODULE):
    revision = run(["git", "-C", repo, "rev-parse", "HEAD"], capture=True).strip()
    status = run(["git", "-C", repo, "status", "--porcelain=v1", "--untracked-files=all"], capture=True)
    files = sorted(path for directory in (module / "android", module / "web", module / "scripts")
                   if directory.is_dir() for path in directory.rglob("*")
                   if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc")
    return {"sourceRevision": revision, "sourceDirty": bool(status.strip()),
            "sourceStatus": status.splitlines(),
            "sourceHashes": {archive_name(path.relative_to(repo)): sha256(path) for path in files}}


def verified_signer(verification, expected):
    signers = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})", verification)
    if len(signers) != 1:
        raise RuntimeError("APK signer verification must report exactly one certificate fingerprint")
    fingerprint = signers[0].lower()
    if expected and fingerprint != expected.lower().replace(":", ""):
        raise RuntimeError("APK signing certificate fingerprint does not match the expected identity")
    return fingerprint


def release_readiness(*, signed, expected_signer_verified, original_signer_verified=False):
    blockers = ["android_public_client_not_registered", "backend_native_client_acceptance_pending",
                "real_identity_login_refresh_logout_pending", "physical_device_acceptance_pending"]
    if not signed or not original_signer_verified:
        blockers.append("original_signing_identity_unverified")
    return {"status": "blocked", "blockers": blockers, "installable": signed,
            "updateCompatible": False, "certificateMatchesExpected": expected_signer_verified,
            "originalSigningIdentityVerified": original_signer_verified,
            "productionPublished": False, "deviceVerified": False}


def java_home(args):
    candidates = [args.java_home, os.environ.get("JAVA_HOME"),
                  args.cache / "jdk/jdk-17.0.20.1+1/Contents/Home"]
    for candidate in candidates:
        if candidate:
            try:
                executable(Path(candidate) / "bin", "javac")
                return Path(candidate).resolve()
            except RuntimeError:
                pass
    raise RuntimeError("JDK not found; run with --bootstrap or --java-home")


def sdk_root(args):
    candidates = [args.sdk_root, os.environ.get("ANDROID_SDK_ROOT"),
                  os.environ.get("ANDROID_HOME"), args.cache / "sdk"]
    for candidate in candidates:
        if candidate and (Path(candidate) / "platforms/android-35/android.jar").is_file():
            return Path(candidate).resolve()
    raise RuntimeError("Android SDK 35 not found; run with --bootstrap or --sdk-root")


def ensure_signing(java, cache, env, *, allow_create=False):
    # Missing release material must never silently create a different update identity.
    directory = cache / "signing"
    basename = "ziwei-manager-candidate" if allow_create else "ziwei-manager-internal"
    key = directory / (basename + ".p12")
    password = directory / (basename + ".pass")
    if key.exists() != password.exists():
        raise RuntimeError("Incomplete internal signing identity; restore the matching key and password")
    if not key.exists():
        if not allow_create:
            raise RuntimeError("Original signing identity unavailable; use --unsigned or explicitly --create-candidate-signing")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
        descriptor = os.open(password, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as output:
            output.write(secrets.token_urlsafe(48))
        try:
            run([executable(java / "bin", "keytool"), "-genkeypair", "-storetype", "PKCS12", "-keystore", key,
                 "-storepass:file", password, "-alias", basename, "-keyalg", "RSA",
                 "-keysize", "3072", "-sigalg", "SHA256withRSA", "-validity", "3650",
                 "-dname", "CN=Ziwei Manager Candidate, O=Ziwei", "-noprompt"], env=env, capture=True)
        except BaseException:
            if not key.exists():
                password.unlink(missing_ok=True)
            raise
        key.chmod(0o600)
    return key, password


def signing_options(args, java, env):
    if args.unsigned:
        if args.keystore or args.ks_pass_file or args.key_alias or args.create_candidate_signing or args.expected_signer_sha256:
            raise RuntimeError("--unsigned cannot be combined with signing options")
        return None
    if args.keystore or args.ks_pass_file or args.key_alias:
        if not args.keystore or not args.ks_pass_file or not args.key_alias or args.create_candidate_signing:
            raise RuntimeError("Existing signing requires --keystore, --ks-pass-file and --key-alias together")
        key, password, alias = args.keystore, args.ks_pass_file, args.key_alias
        if not key.is_file() or not password.is_file():
            raise RuntimeError("Existing signing material is incomplete")
    else:
        key, password = ensure_signing(java, args.cache, env, allow_create=args.create_candidate_signing)
        alias = "ziwei-manager-candidate" if args.create_candidate_signing else "ziwei-manager-internal"
    return key, password, alias


def verify_web():
    web = MODULE / "web"
    for name in ("index.html", "app.js", "styles.css", "api.js", "model.js", "reporting.js"):
        if not (web / name).is_file():
            raise RuntimeError("Web UI is not ready; missing " + name)
    files = sorted(path for path in web.rglob("*") if path.is_file())
    for path in files:
        if path.is_symlink() or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", archive_name(path.relative_to(web))):
            raise RuntimeError("Unexpected packaged web asset: " + archive_name(path.relative_to(web)))
    return web, files


def build(args):
    if args.bootstrap:
        spec = importlib.util.spec_from_file_location("android_tools", Path(__file__).with_name("android-tools.py"))
        tools = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tools)
        tools.bootstrap(args.cache)
    java, sdk = java_home(args), sdk_root(args)
    tool = sdk / "build-tools/35.0.0"
    android = sdk / "platforms/android-35/android.jar"
    aapt2, zipalign = executable(tool, "aapt2"), executable(tool, "zipalign")
    javac, java_bin = executable(java / "bin", "javac"), executable(java / "bin", "java")
    for library in ("lib/d8.jar", "lib/apksigner.jar"):
        if not (tool / library).is_file():
            raise RuntimeError("Build-tools 35.0.0 is incomplete: " + library)
    provenance = source_provenance()
    web, assets = verify_web()
    env = dict(os.environ, JAVA_HOME=str(java), ANDROID_SDK_ROOT=str(sdk))
    env["PATH"] = str(java / "bin") + os.pathsep + env.get("PATH", "")
    args.output.mkdir(parents=True, exist_ok=True)
    signing = signing_options(args, java, env)
    with tempfile.TemporaryDirectory(prefix="ziwei-manager-") as temporary:
        work = Path(temporary)
        staged = stage_tool_inputs(MODULE, work)
        staged_web = staged / "web"
        classes, dex = work / "classes", work / "dex"
        classes.mkdir()
        dex.mkdir()
        sources = sorted((staged / "android/src").rglob("*.java"))
        run([javac, "-encoding", "UTF-8", "--release", "8",
             "-classpath", android, "-d", classes, *sources], env=env)
        classjar = work / "classes.jar"
        with zipfile.ZipFile(classjar, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(classes.rglob("*.class")):
                archive.write(path, archive_name(path.relative_to(classes)))
        run([java_bin, "-cp", tool / "lib/d8.jar", "com.android.tools.r8.D8",
             "--release", "--min-api", "26", "--lib", android, "--output", dex, classjar], env=env)
        compiled = work / "resources.zip"
        run([aapt2, "compile", "--dir", staged / "android/res", "-o", compiled], env=env)
        unsigned = work / "unsigned.apk"
        run([aapt2, "link", "-I", android, "--manifest", staged / "android/AndroidManifest.xml",
             "--min-sdk-version", "26", "--target-sdk-version", "35", "--version-code", args.version_code,
             "--version-name", args.version_name, "--replace-version", "-A", staged_web, "-o", unsigned, compiled], env=env)
        with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(dex.glob("*.dex")):
                archive.write(path, path.name)
        aligned = work / "aligned.apk"
        run([zipalign, "-f", "-p", "4", unsigned, aligned], env=env)
        suffix = ".unsigned.apk" if signing is None else ".apk"
        apk_name = f"ziwei-manager-{args.version_name}-code{args.version_code}{suffix}"
        apk = work / apk_name
        output_apk = args.output / apk_name
        signer = None
        if signing is None:
            shutil.copyfile(aligned, apk)
        else:
            key, password, alias = signing
            signed = work / "signed.apk"
            run([java_bin, "-jar", tool / "lib/apksigner.jar", "sign", "--ks", key,
                 "--ks-key-alias", alias, "--ks-pass", "file:" + str(password),
                 "--v1-signing-enabled", "false", "--v2-signing-enabled", "true",
                 "--v3-signing-enabled", "true", "--v4-signing-enabled", "false", "--out", signed, aligned], env=env, capture=True)
            verification = run([java_bin, "-jar", tool / "lib/apksigner.jar", "verify", "--verbose",
                                "--print-certs", signed], env=env, capture=True)
            signer = verified_signer(verification, args.expected_signer_sha256)
            shutil.copyfile(signed, apk)
        badging = run([aapt2, "dump", "badging", apk], env=env, capture=True)
        expected = f"package: name='com.ziwei.manager' versionCode='{args.version_code}' versionName='{args.version_name}'"
        if expected not in badging or not re.search(r"(?:minSdkVersion|sdkVersion):'26'", badging) or "targetSdkVersion:'35'" not in badging:
            raise RuntimeError("APK identity/version/SDK verification failed")
        permissions = re.findall(r"uses-permission: name='([^']+)'", badging)
        if permissions != ["android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS", "android.permission.ACCESS_NETWORK_STATE", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_SPECIAL_USE"]:
            raise RuntimeError("Unexpected APK permissions: " + repr(permissions))
        run([zipalign, "-c", "-p", "4", apk], env=env)
        with zipfile.ZipFile(apk) as archive:
            for path in assets:
                name = archive_name(path.relative_to(web))
                if archive.read("assets/" + name) != path.read_bytes():
                    raise RuntimeError("Packaged UI differs from source: " + name)
        if "application-debuggable" in badging: raise RuntimeError("Debuggable release rejected")
        with zipfile.ZipFile(apk) as archive:
            data=b"".join(archive.read(n) for n in archive.namelist() if re.fullmatch(r"classes\d*\.dex",n))
            if any(marker in data for marker in (b"Lcom/tencent/",b"Lcom/google/firebase/",b"Lcom/huawei/",b"Lcom/xiaomi/",b"Lcom/vivo/",b"Lcom/heytap/",b"Lcom/hihonor/",b"Lcom/meizu/")):
                raise RuntimeError("Third-party notification implementation is forbidden in selfhost profile")
            if any(n.startswith("lib/") for n in archive.namelist()):raise RuntimeError("Unexpected native third-party library")
        if source_provenance()["sourceHashes"] != provenance["sourceHashes"]:
            raise RuntimeError("Build source changed while the APK was being compiled; rebuild the candidate")
        verify_staged_inputs(MODULE, staged)
        manifest = {
            "schemaVersion": 1, "builtAt": datetime.now(timezone.utc).isoformat(),
            "packageName": "com.ziwei.manager", "versionName": args.version_name,
            "versionCode": args.version_code, "minSdk": 26, "targetSdk": 35,
            "buildType": "identity-candidate", "signingIdentity": "unsigned" if signer is None else
                "explicit candidate certificate" if args.create_candidate_signing else "existing certificate",
            "signerSha256": signer, **provenance,
            "buildStaging": {"strategy": "ascii_copy", "originalAndStagedInputsByteVerified": True,
                             "inputFileCount": len(tool_input_files(staged))},
            "apk": apk.name, "sha256": sha256(apk), "bytes": apk.stat().st_size,
            "deviceVerified": False, "apiOrigin": "https://ziwei.qzelynth.top",
            "issuer": "https://auth.qzelynth.top/realms/ziwei", "audience": "ziwei-workspace-api",
            "releaseReadiness": release_readiness(signed=signer is not None,
                expected_signer_verified=bool(signer and args.expected_signer_sha256),
                original_signer_verified=signer == ORIGINAL_SIGNER_SHA256 and not args.create_candidate_signing),
            "nativeProfile": "selfhost", "pushSdk": None, "notificationSchemaVersion": 2,
            "webAssets": {archive_name(path.relative_to(web)): sha256(path) for path in assets},
        }
        shutil.copyfile(apk, output_apk)
        (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (args.output / (apk.name + ".sha256")).write_text(manifest["sha256"] + "  " + apk.name + "\n", encoding="utf-8")
        print(("Verified signed candidate: " if signer else "Verified unsigned candidate (not installable): ") + str(output_apk))
        print("SHA-256: " + manifest["sha256"])
        print("Release blocked: native registration, identity acceptance, original update signing and device checks remain separate.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bootstrap", action="store_true", help="download pinned verified tools for Apple Silicon")
    parser.add_argument("--java-home", type=Path)
    parser.add_argument("--sdk-root", type=Path)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--output", type=Path, default=MODULE / "dist")
    parser.add_argument("--profile", choices=("selfhost",), default="selfhost")
    parser.add_argument("--unsigned", action="store_true", help="emit aligned unsigned APK; cannot install/update")
    parser.add_argument("--create-candidate-signing", action="store_true", help="explicitly create/reuse a separate candidate key; not the original update identity")
    parser.add_argument("--keystore", type=Path, help="existing signing keystore; never printed")
    parser.add_argument("--ks-pass-file", type=Path, help="existing protected password file; never printed")
    parser.add_argument("--key-alias", help="existing keystore alias")
    parser.add_argument("--expected-signer-sha256", help="fail closed unless verified APK certificate matches")
    parser.add_argument("--version-code", type=int, default=17)
    parser.add_argument("--version-name", default="0.6.0-identity-candidate")
    args = parser.parse_args()
    if args.version_code < 1 or not re.fullmatch(r"[A-Za-z0-9._-]+", args.version_name):
        parser.error("Invalid Android version")
    if args.expected_signer_sha256:
        args.expected_signer_sha256 = args.expected_signer_sha256.lower().replace(":", "")
        if not re.fullmatch(r"[0-9a-f]{64}", args.expected_signer_sha256):
            parser.error("Expected signer must be a SHA-256 fingerprint")
    args.cache = args.cache.expanduser().resolve()
    args.output = args.output.expanduser().resolve()
    try:
        build(args)
    except (RuntimeError, subprocess.CalledProcessError, OSError) as exception:
        print("Build failed: " + str(exception), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
