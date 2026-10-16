#!/usr/bin/env python3
"""Run JVM URL trust/traversal boundary checks. Does not start Android services."""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import tempfile

MODULE = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--java-home", type=Path)
parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/ziwei-manager-android")
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("build_android", Path(__file__).with_name("build-android.py"))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
java = build.java_home(args)
with tempfile.TemporaryDirectory(prefix="ziwei-manager-url-test-") as temporary:
    subprocess.run([str(java / "bin/javac"), "--release", "8", "-encoding", "UTF-8", "-d", temporary,
                    str(MODULE / "android/src/com/ziwei/manager/UrlPolicy.java"),
                    str(MODULE / "android/test/com/ziwei/manager/UrlPolicyTest.java")], check=True)
    subprocess.run([str(java / "bin/java"), "-ea", "-cp", temporary,
                    "com.ziwei.manager.UrlPolicyTest"], check=True)
