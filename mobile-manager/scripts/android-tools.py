#!/usr/bin/env python3
"""Fetch a pinned, verified Android toolchain without installing global tools or daemons."""
import argparse
import hashlib
from pathlib import Path
import platform
import shutil
import tarfile
import tempfile
import urllib.request
import zipfile

CACHE = Path.home() / ".cache/ziwei-manager-android"
GRADLE = ("gradle-8.10.2-bin.zip", "https://services.gradle.org/distributions/gradle-8.10.2-bin.zip",
          "sha256", "31c55713e40233a8303827ceb42ca48a47267a0ad4bab9177123121e71524c26")
ARTIFACTS = (
    ("jdk.tar.gz", "https://github.com/adoptium/temurin17-binaries/releases/download/"
     "jdk-17.0.20.1%2B1/OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz",
     "sha256", "196d13ba5f10414bef7f6a05a9b3f00edacb18ebacef2b99485db9e2ee18f0e8"),
    ("platform-35_r02.zip", "https://dl.google.com/android/repository/platform-35_r02.zip",
     "sha1", "0bb560a90a7a2cbd0dd8348224d518b638fe7949"),
    ("build-tools_r35_macosx.zip", "https://dl.google.com/android/repository/build-tools_r35_macosx.zip",
     "sha1", "93ab8ce91230e067b5add4bfa79919c52b27f072"),
)


def checked_download(cache, spec):
    name, url, algorithm, expected = spec
    target = cache / "downloads" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_suffix(target.suffix + ".part")
        print("Downloading " + name, flush=True)
        try:
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    digest = hashlib.new(algorithm)
    with target.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise RuntimeError("Tool checksum mismatch: " + name + "; remove the cached archive and retry")
    print("Verified " + name, flush=True)
    return target


def safe_zip_extract(archive, target):
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            destination = (target / entry.filename).resolve()
            if not destination.is_relative_to(target.resolve()):
                raise RuntimeError("Unsafe path in SDK archive")
            source.extract(entry, target)
            mode = (entry.external_attr >> 16) & 0o777
            if mode:
                destination.chmod(mode)


def safe_tar_extract(archive, target):
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as source:
        for entry in source.getmembers():
            destination = (target / entry.name).resolve()
            if not destination.is_relative_to(target.resolve()) or entry.isdev():
                raise RuntimeError("Unsafe path in JDK archive")
            if entry.issym() or entry.islnk():
                base = destination.parent if entry.issym() else target
                if not (base / entry.linkname).resolve().is_relative_to(target.resolve()):
                    raise RuntimeError("Unsafe link in JDK archive")
        # The SHA-256 checked archive is official. Manual validation also supports macOS Python 3.9.
        source.extractall(target)


def bootstrap(cache):
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("Automatic tool setup supports Apple Silicon macOS; pass --java-home/--sdk-root elsewhere")
    archives = [checked_download(cache, spec) for spec in ARTIFACTS]
    java = cache / "jdk/jdk-17.0.20.1+1/Contents/Home"
    sdk = cache / "sdk"
    if not (java / "bin/javac").is_file():
        safe_tar_extract(archives[0], cache / "jdk")
    if not (sdk / "platforms/android-35/android.jar").is_file():
        with tempfile.TemporaryDirectory(prefix="platform-", dir=cache) as temporary:
            extracted = Path(temporary)
            safe_zip_extract(archives[1], extracted)
            platforms = list(extracted.glob("*/android.jar"))
            if len(platforms) != 1:
                raise RuntimeError("Unexpected Android platform archive")
            target = sdk / "platforms/android-35"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(platforms[0].parent, target, dirs_exist_ok=True)
    if not (sdk / "build-tools/35.0.0/aapt2").is_file():
        with tempfile.TemporaryDirectory(prefix="build-tools-", dir=cache) as temporary:
            extracted = Path(temporary)
            safe_zip_extract(archives[2], extracted)
            tools = list(extracted.glob("*/aapt2"))
            if len(tools) != 1:
                raise RuntimeError("Unexpected Android build tools archive")
            target = sdk / "build-tools/35.0.0"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(tools[0].parent, target, dirs_exist_ok=True)
    return java, sdk


def bootstrap_gradle(cache):
    """Official distribution, independently fixed to its published SHA-256. Does not start Gradle."""
    archive = checked_download(cache, GRADLE)
    root = cache / "gradle-8.10.2"
    if not (root / "lib/gradle-gradle-cli-main-8.10.2.jar").is_file():
        safe_zip_extract(archive, cache)
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--push", action="store_true", help="also prepare the pinned Gradle distribution for real SDK builds")
    args = parser.parse_args()
    java, sdk = bootstrap(args.cache.expanduser().resolve())
    if args.push:
        print("GRADLE_HOME=" + str(bootstrap_gradle(args.cache.expanduser().resolve())))
    print("JAVA_HOME=" + str(java))
    print("ANDROID_SDK_ROOT=" + str(sdk))


if __name__ == "__main__":
    main()
