#!/usr/bin/env python3
"""Compile, align and internally sign the management APK without Gradle/adb/listeners."""
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


def run(command, *, env=None, capture=False):
    # Deliberately log tool names only; signing passwords/paths and request data are never echoed.
    print("Running " + Path(command[0]).name, flush=True)
    result = subprocess.run([str(value) for value in command], check=True, env=env,
                            capture_output=capture, text=True)
    return result.stdout if capture else ""


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def java_home(args):
    candidates = [args.java_home, os.environ.get("JAVA_HOME"),
                  args.cache / "jdk/jdk-17.0.20.1+1/Contents/Home"]
    for candidate in candidates:
        if candidate and (Path(candidate) / "bin/javac").is_file():
            return Path(candidate).resolve()
    raise RuntimeError("JDK not found; run with --bootstrap or --java-home")


def sdk_root(args):
    candidates = [args.sdk_root, os.environ.get("ANDROID_SDK_ROOT"),
                  os.environ.get("ANDROID_HOME"), args.cache / "sdk"]
    for candidate in candidates:
        if candidate and (Path(candidate) / "platforms/android-35/android.jar").is_file():
            return Path(candidate).resolve()
    raise RuntimeError("Android SDK 35 not found; run with --bootstrap or --sdk-root")


def ensure_signing(java, cache, env):
    # This app has an independent, persistent internal-test identity. Never use device Agent keys.
    directory = cache / "signing"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    key = directory / "ziwei-manager-internal.p12"
    password = directory / "ziwei-manager-internal.pass"
    if key.exists() != password.exists():
        raise RuntimeError("Incomplete internal signing identity; restore the matching key and password")
    if not key.exists():
        descriptor = os.open(password, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as output:
            output.write(secrets.token_urlsafe(48))
        try:
            run([java / "bin/keytool", "-genkeypair", "-storetype", "PKCS12", "-keystore", key,
                 "-storepass:file", password, "-alias", "ziwei-manager-internal", "-keyalg", "RSA",
                 "-keysize", "3072", "-sigalg", "SHA256withRSA", "-validity", "3650",
                 "-dname", "CN=Ziwei Manager Internal, O=Ziwei", "-noprompt"], env=env)
        except BaseException:
            if not key.exists():
                password.unlink(missing_ok=True)
            raise
        key.chmod(0o600)
    return key, password


def verify_web():
    web = MODULE / "web"
    for name in ("index.html", "app.js", "styles.css", "api.js", "model.js", "reporting.js"):
        if not (web / name).is_file():
            raise RuntimeError("Web UI is not ready; missing " + name)
    files = sorted(path for path in web.rglob("*") if path.is_file())
    for path in files:
        if path.is_symlink() or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", str(path.relative_to(web))):
            raise RuntimeError("Unexpected packaged web asset: " + str(path.relative_to(web)))
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
    for executable in ("aapt2", "zipalign", "lib/d8.jar", "lib/apksigner.jar"):
        if not (tool / executable).is_file():
            raise RuntimeError("Build-tools 35.0.0 is incomplete: " + executable)
    web, assets = verify_web()
    env = dict(os.environ, JAVA_HOME=str(java), ANDROID_SDK_ROOT=str(sdk))
    env["PATH"] = str(java / "bin") + os.pathsep + env.get("PATH", "")
    args.output.mkdir(parents=True, exist_ok=True)
    key, password = ensure_signing(java, args.cache, env)
    with tempfile.TemporaryDirectory(prefix="ziwei-manager-") as temporary:
        work = Path(temporary)
        classes, dex = work / "classes", work / "dex"
        classes.mkdir()
        dex.mkdir()
        sources = sorted((MODULE / "android/src").rglob("*.java"))
        run([java / "bin/javac", "-encoding", "UTF-8", "--release", "8",
             "-classpath", android, "-d", classes, *sources], env=env)
        classjar = work / "classes.jar"
        with zipfile.ZipFile(classjar, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(classes.rglob("*.class")):
                archive.write(path, str(path.relative_to(classes)))
        run([java / "bin/java", "-cp", tool / "lib/d8.jar", "com.android.tools.r8.D8",
             "--release", "--min-api", "26", "--lib", android, "--output", dex, classjar], env=env)
        compiled = work / "resources.zip"
        run([tool / "aapt2", "compile", "--dir", MODULE / "android/res", "-o", compiled], env=env)
        unsigned = work / "unsigned.apk"
        run([tool / "aapt2", "link", "-I", android, "--manifest", MODULE / "android/AndroidManifest.xml",
             "--min-sdk-version", "26", "--target-sdk-version", "35", "--version-code", args.version_code,
             "--version-name", args.version_name, "-A", web, "-o", unsigned, compiled], env=env)
        with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(dex.glob("*.dex")):
                archive.write(path, path.name)
        aligned = work / "aligned.apk"
        run([tool / "zipalign", "-f", "-p", "4", unsigned, aligned], env=env)
        apk = args.output / f"ziwei-manager-{args.version_name}-code{args.version_code}.apk"
        run([java / "bin/java", "-jar", tool / "lib/apksigner.jar", "sign", "--ks", key,
             "--ks-key-alias", "ziwei-manager-internal", "--ks-pass", "file:" + str(password),
             "--v1-signing-enabled", "false", "--v2-signing-enabled", "true",
             "--v3-signing-enabled", "true", "--v4-signing-enabled", "false", "--out", apk, aligned], env=env)
        Path(str(apk) + ".idsig").unlink(missing_ok=True)
        verification = run([java / "bin/java", "-jar", tool / "lib/apksigner.jar", "verify", "--verbose",
                            "--print-certs", apk], env=env, capture=True)
        signer = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-f]+)", verification)
        if not signer:
            raise RuntimeError("APK signer verification did not report a certificate fingerprint")
        badging = run([tool / "aapt2", "dump", "badging", apk], env=env, capture=True)
        expected = f"package: name='com.ziwei.manager' versionCode='{args.version_code}' versionName='{args.version_name}'"
        if expected not in badging or not re.search(r"(?:minSdkVersion|sdkVersion):'26'", badging) or "targetSdkVersion:'35'" not in badging:
            raise RuntimeError("APK identity/version/SDK verification failed")
        permissions = re.findall(r"uses-permission: name='([^']+)'", badging)
        if permissions != ["android.permission.INTERNET"]:
            raise RuntimeError("Unexpected APK permissions: " + repr(permissions))
        run([tool / "zipalign", "-c", "-p", "4", apk], env=env)
        with zipfile.ZipFile(apk) as archive:
            for path in assets:
                name = str(path.relative_to(web))
                if archive.read("assets/" + name) != path.read_bytes():
                    raise RuntimeError("Packaged UI differs from source: " + name)
        revision = run(["git", "-C", REPO, "rev-parse", "HEAD"], capture=True).strip()
        manifest = {
            "schemaVersion": 1, "builtAt": datetime.now(timezone.utc).isoformat(),
            "packageName": "com.ziwei.manager", "versionName": args.version_name,
            "versionCode": args.version_code, "minSdk": 26, "targetSdk": 35,
            "buildType": "internal", "signingIdentity": "independent internal test certificate",
            "signerSha256": signer.group(1), "sourceRevision": revision,
            "apk": apk.name, "sha256": sha256(apk), "bytes": apk.stat().st_size,
            "deviceVerified": False, "apiOrigin": "https://qzelynth.top",
            "webAssets": {str(path.relative_to(web)): sha256(path) for path in assets},
        }
        (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        (args.output / (apk.name + ".sha256")).write_text(manifest["sha256"] + "  " + apk.name + "\n")
        print("Verified APK: " + str(apk))
        print("SHA-256: " + manifest["sha256"])
        print("Physical device installation and behavior remain unverified.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bootstrap", action="store_true", help="download pinned verified tools for Apple Silicon")
    parser.add_argument("--java-home", type=Path)
    parser.add_argument("--sdk-root", type=Path)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--output", type=Path, default=MODULE / "dist")
    parser.add_argument("--version-code", type=int, default=1)
    parser.add_argument("--version-name", default="0.1.0-internal")
    args = parser.parse_args()
    if args.version_code < 1 or not re.fullmatch(r"[A-Za-z0-9._-]+", args.version_name):
        parser.error("Invalid Android version")
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
