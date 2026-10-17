#!/usr/bin/env python3
"""Run JVM URL trust/traversal and notification safety boundary checks. Does not start Android services."""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

MODULE = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--java-home", type=Path)
parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/ziwei-manager-android")
args = parser.parse_args()
android = "{http://schemas.android.com/apk/res/android}"
manifest = ET.parse(MODULE / "android/AndroidManifest.xml").getroot()
permissions = [item.get(android + "name") for item in manifest.findall("uses-permission")]
assert permissions == ["android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS",
                       "android.permission.ACCESS_NETWORK_STATE"], "Unexpected native permissions"
application = manifest.find("application")
services = application.findall("service")
assert len(services) == 1 and services[0].get(android + "name") == ".NotificationJobService"
assert services[0].get(android + "exported") == "false"
assert services[0].get(android + "permission") == "android.permission.BIND_JOB_SERVICE"
assert not application.findall("receiver") and not application.findall("provider")
print("Native manifest permission/service boundary passed")
spec = importlib.util.spec_from_file_location("build_android", Path(__file__).with_name("build-android.py"))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
java = build.java_home(args)
with tempfile.TemporaryDirectory(prefix="ziwei-manager-url-test-") as temporary:
    subprocess.run([str(java / "bin/javac"), "--release", "8", "-encoding", "UTF-8", "-d", temporary,
                    str(MODULE / "android/src/com/ziwei/manager/UrlPolicy.java"),
                    str(MODULE / "android/test/com/ziwei/manager/UrlPolicyTest.java"),
                    str(MODULE / "android/src/com/ziwei/manager/NotificationRules.java"),
                    str(MODULE / "android/test/com/ziwei/manager/NotificationRulesTest.java")], check=True)
    subprocess.run([str(java / "bin/java"), "-ea", "-cp", temporary,
                    "com.ziwei.manager.UrlPolicyTest"], check=True)

    subprocess.run([str(java / "bin/java"), "-ea", "-cp", temporary,
                    "com.ziwei.manager.NotificationRulesTest"], check=True)
