#!/usr/bin/env python3
"""Build the real push SDK profile (or explicit minimal fallback), align and internally sign the APK."""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timezone

MODULE = Path(__file__).resolve().parent.parent
REPO = MODULE.parent
CACHE = Path.home() / ".cache/ziwei-manager-android"
REGISTRY = Path("/Users/zhangjie/Documents/Codex/tools/port-registry/registry.py")


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


def registry(*args):
    result = subprocess.run([sys.executable, str(REGISTRY), *map(str, args)], cwd=REPO,
                            capture_output=True, text=True)
    # A failed check deliberately returns status 1 with useful structured diagnostics.
    if result.returncode and (not args or args[0] != "check"):
        raise RuntimeError("Port registry operation failed: " + result.stderr.strip())
    return json.loads(result.stdout)


def listening_pids(record):
    option = "-iTCP:" if record["protocol"] == "tcp" else "-iUDP:"
    command = ["lsof", "-nP", option + str(record["port"])]
    if record["protocol"] == "tcp":
        command += ["-sTCP:LISTEN"]
    command += ["-Fp"]
    result = subprocess.run(command, capture_output=True, text=True)
    return {int(line[1:]) for line in result.stdout.splitlines() if line.startswith("p")}


@contextlib.contextmanager
def registered_gradle(env, local, java):
    """Gradle's internal TCP/UDP listeners use only pre-registered loopback ports on this Mac."""
    if sys.platform != "darwin":
        yield env, []
        return
    if not REGISTRY.is_file():
        raise RuntimeError("Mac push builds require the configured port registry")
    registry("list")
    initial = registry("check", "--project", REPO)
    (local / "last-build-initial-port-check.json").write_text(json.dumps(initial, ensure_ascii=False, indent=2) + "\n")
    if not initial["ok"]:
        raise RuntimeError("Project listener ownership must be repaired before Gradle starts; see last-build-initial-port-check.json")
    records = []
    try:
        for protocol in ("tcp", "udp"):
            for index in (1, 2):
                records.append(registry("allocate", "--project", REPO, "--service",
                                        f"Android系统推送Gradle临时{protocol.upper()}入口{index}", "--kind", "debug",
                                        "--scheme", "none", "--protocol", protocol))
        (local / "last-build-ports.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")
        source = MODULE / "android/tools/gradle-registered-ports.c"
        shim = local / ("gradle-ports-" + sha256(source)[:16] + ".dylib")
        if not shim.is_file():
            run(["clang", "-dynamiclib", "-Wall", "-Wextra", "-Werror", source, "-o", shim])
        controlled = dict(env, DYLD_INSERT_LIBRARIES=str(shim),
                          ZIWEI_GRADLE_TCP_PORTS=",".join(str(r["port"]) for r in records if r["protocol"] == "tcp"),
                          ZIWEI_GRADLE_UDP_PORTS=",".join(str(r["port"]) for r in records if r["protocol"] == "udp"))
        print("Registered temporary Gradle TCP/UDP listeners: " + ", ".join(str(r["id"]) for r in records), flush=True)
        yield controlled, records
    finally:
        deadline = time.monotonic() + 12
        while any(listening_pids(row) for row in records) and time.monotonic() < deadline:
            time.sleep(1)
        for row in records:
            for pid in listening_pids(row):
                command = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True).stdout
                cwd = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True).stdout
                if "org.gradle" not in command or str(local) not in cwd:
                    raise RuntimeError("Registered Gradle port ownership changed; retained registration for inspection")
                os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 10
        while any(listening_pids(row) for row in records) and time.monotonic() < deadline:
            time.sleep(1)
        if any(listening_pids(row) for row in records):
            raise RuntimeError("Gradle listener did not stop; retained registration for inspection")
        for row in records:
            registry("release", row["id"])
        check = registry("check", "--project", REPO)
        (local / "last-build-final-port-check.json").write_text(json.dumps(check, ensure_ascii=False, indent=2) + "\n")
        if not check["ok"]:
            raise RuntimeError("Port registry check failed after Gradle build")


def push_unsigned(args, java, sdk, work, env):
    spec = importlib.util.spec_from_file_location("android_tools", Path(__file__).with_name("android-tools.py"))
    tools = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tools)
    gradle = tools.bootstrap_gradle(args.cache)
    local = REPO / ".local/mobile-manager-push-build"
    local.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="project-", dir=local) as temporary:
        project = Path(temporary)
        for name in ("settings.gradle", "build.gradle", "gradle.properties"):
            shutil.copyfile(MODULE / "android" / name, project / name)
        for option, name in ((args.google_services, "google-services.json"), (args.agconnect_services, "agconnect-services.json")):
            if option:
                source = option.expanduser().resolve()
                value = json.loads(source.read_text())
                # Client configuration only. Reject obvious service-account/private-key material.
                if not isinstance(value, dict) or any(key in value for key in ("private_key", "private_key_id", "client_email")):
                    raise RuntimeError("Expected a public Android client SDK configuration file")
                shutil.copyfile(source, project / name)
                (project / name).chmod(0o600)
        (project / "local.properties").write_text("sdk.dir=" + str(sdk) + "\n")
        controlled_env = dict(env, GRADLE_USER_HOME=str(local / "gradle-home"))
        command = [java / "bin/java", "-Xmx64m", "-Xms64m", "-Dorg.gradle.daemon=false", "-Djava.net.preferIPv4Stack=true",
                   "-javaagent:" + str(gradle / "lib/agents/gradle-instrumentation-agent-8.10.2.jar"),
                   "-cp", gradle / "lib/gradle-gradle-cli-main-8.10.2.jar", "org.gradle.launcher.GradleMain",
                   "--no-daemon", "--console=plain", "-p", project, "assembleRelease",
                   "-PziweiModuleRoot=" + str(MODULE), "-PziweiVersionCode=" + str(args.version_code),
                   "-PziweiVersionName=" + args.version_name,
                   "-Pandroid.aapt2FromMavenOverride=" + str(sdk / "build-tools/35.0.0/aapt2")]
        with registered_gradle(controlled_env, local, java) as (gradle_env, records):
            process = subprocess.Popen([str(v) for v in command], env=gradle_env, cwd=REPO, start_new_session=True)
            stop = threading.Event()
            checks = []
            def monitor():
                if not records:
                    return
                while not stop.wait(4):
                    try:
                        check = registry("check", "--project", REPO)
                        checks.append(check)
                        if not check["ok"]:
                            process.terminate()
                            return
                    except (OSError, subprocess.SubprocessError, ValueError) as error:
                        checks.append({"ok": False, "error": str(error)})
                        process.terminate()
                        return
            watcher = threading.Thread(target=monitor, daemon=True)
            watcher.start()
            try:
                code = process.wait()
            finally:
                stop.set()
                watcher.join(timeout=30)
                (local / "last-build-running-port-checks.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n")
            if code:
                raise RuntimeError("Real TPNS Gradle build failed; no minimal-profile fallback was substituted")
        apks = list((project / "build/outputs/apk/release").glob("*.apk"))
        if len(apks) != 1:
            raise RuntimeError("Expected exactly one real push APK")
        merged = list((project / "build/intermediates/merged_manifests").rglob("AndroidManifest.xml"))
        if len(merged) != 1:
            raise RuntimeError("Expected the real merged push manifest")
        # Keep the merged component/permission evidence private, outside public release attachments.
        evidence = local / "last-merged-AndroidManifest.xml"
        shutil.copyfile(merged[0], evidence)
        evidence.chmod(0o600)
        target = work / "unsigned.apk"
        shutil.copyfile(apks[0], target)
        return target


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
        if args.profile == "tpns":
            unsigned = push_unsigned(args, java, sdk, work, env)
        else:
            sources = sorted((MODULE / "android/src").rglob("*.java")) + sorted((MODULE / "android/profiles/minimal").rglob("*.java"))
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
                 "--version-name", args.version_name, "--replace-version", "-A", web, "-o", unsigned, compiled], env=env)
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
        base = {"android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS", "android.permission.ACCESS_NETWORK_STATE"}
        allowed = base | {"android.permission.ACCESS_WIFI_STATE", "android.permission.WAKE_LOCK", "android.permission.VIBRATE",
                          "com.google.android.c2dm.permission.RECEIVE", "com.hihonor.push.permission.READ_PUSH_NOTIFICATION_INFO",
                          "com.coloros.mcs.permission.RECIEVE_MCS_MESSAGE", "com.heytap.mcs.permission.RECIEVE_MCS_MESSAGE",
                          "com.meizu.flyme.permission.PUSH", "com.meizu.flyme.push.permission.RECEIVE", "com.meizu.c2dm.permission.RECEIVE",
                          "com.ziwei.manager.permission.XGPUSH_RECEIVE", "com.ziwei.manager.permission.MIPUSH_RECEIVE",
                          "com.ziwei.manager.push.permission.MESSAGE", "com.ziwei.manager.permission.C2D_MESSAGE",
                          "com.ziwei.manager.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"}
        if not base.issubset(permissions) or set(permissions) - (allowed if args.profile == "tpns" else base):
            raise RuntimeError("Unexpected APK permission boundary: " + repr(permissions))
        run([tool / "zipalign", "-c", "-p", "4", apk], env=env)
        with zipfile.ZipFile(apk) as archive:
            if args.profile == "tpns":
                data = b"".join(archive.read(n) for n in archive.namelist() if re.fullmatch(r"classes\d*\.dex", n))
                markers = ["com/tencent/android/tpush/XGPushManager", "com/tencent/android/tpush/XGPushConfig",
                           "com/xiaomi/mipush/sdk/MiPushClient", "com/meizu/cloud/pushsdk/PushManager",
                           "com/hihonor/push/sdk/HonorPushClient", "com/heytap/msp/push/HeytapPushManager",
                           "com/vivo/push/PushClient", "com/huawei/hms/push/HmsMessaging",
                           "com/google/firebase/messaging/FirebaseMessaging", "com/ziwei/manager/TpnsReceiver"]
                if any(("L" + name + ";").encode() not in data for name in markers):
                    raise RuntimeError("APK does not contain the actual SDK/vendor implementation classes")
                for abi in ("armeabi-v7a", "arm64-v8a", "x86", "x86_64"):
                    if "lib/" + abi + "/libxgVipSecurity.so" not in archive.namelist():
                        raise RuntimeError("Missing official TPNS native security library")
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
            "nativeProfile": args.profile, "pushSdk": "TPNS 1.4.4.12-release" if args.profile == "tpns" else None,
            "pushClientConfigurationProvided": bool(args.google_services or args.agconnect_services or any(k.startswith("ZIWEI_PUSH_") and v for k, v in os.environ.items())),
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
    parser.add_argument("--profile", choices=("tpns", "minimal"), default="tpns")
    parser.add_argument("--google-services", type=Path, help="optional public Android Firebase client JSON; never a service account")
    parser.add_argument("--agconnect-services", type=Path, help="optional public Huawei Android client JSON")
    parser.add_argument("--version-code", type=int, default=11)
    parser.add_argument("--version-name", default="0.4.0-internal")
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
