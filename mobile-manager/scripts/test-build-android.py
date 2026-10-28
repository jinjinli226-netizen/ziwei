#!/usr/bin/env python3
"""Offline build safety/provenance regressions; no Android services or key creation."""
import argparse
import importlib.util
from pathlib import Path, PureWindowsPath
import tempfile
import subprocess
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("manager_build", Path(__file__).with_name("build-android.py"))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BuildSafetyTests(unittest.TestCase):
    def input_fixture(self, root):
        for relative, data in {"android/src/com/example/Main.java": b"class Main {}",
                               "android/res/values/strings.xml": b"<resources />",
                               "android/AndroidManifest.xml": b"<manifest />",
                               "web/index.html": b"<!doctype html>",
                               "web/assets/logo.png": b"fixture pixels"}.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def test_unicode_sources_are_staged_byte_identically_into_ascii_tool_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original, work = root / "原始 sources", root / "ascii-build"
            self.input_fixture(original)
            work.mkdir()
            staged = build.stage_tool_inputs(original, work)
            self.assertTrue(str(staged).isascii())
            for path in original.rglob("*"):
                if path.is_file():
                    self.assertEqual((staged / path.relative_to(original)).read_bytes(), path.read_bytes())
            build.verify_staged_inputs(original, staged)

    def test_staging_rejects_unicode_temporary_root_before_copying(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original, work = root / "original", root / "临时"
            self.input_fixture(original)
            work.mkdir()
            with self.assertRaisesRegex(RuntimeError, "ASCII"):
                build.stage_tool_inputs(original, work)
            self.assertFalse((work / "inputs").exists())

    def test_staging_detects_modified_original_or_staged_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original, work = root / "原始", root / "ascii-build"
            self.input_fixture(original)
            work.mkdir()
            staged = build.stage_tool_inputs(original, work)
            target = staged / "web/index.html"
            target.write_bytes(b"changed staged bytes")
            with self.assertRaisesRegex(RuntimeError, "staged"):
                build.verify_staged_inputs(original, staged)
            target.write_bytes((original / "web/index.html").read_bytes())
            (original / "web/index.html").write_bytes(b"changed original bytes")
            with self.assertRaisesRegex(RuntimeError, "staged"):
                build.verify_staged_inputs(original, staged)

    def test_staging_detects_added_or_removed_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original, work = root / "原始", root / "ascii-build"
            self.input_fixture(original)
            work.mkdir()
            staged = build.stage_tool_inputs(original, work)
            (original / "web/extra.js").write_bytes(b"new input")
            with self.assertRaisesRegex(RuntimeError, "staged"):
                build.verify_staged_inputs(original, staged)

    def test_windows_executable_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "javac.exe").touch()
            self.assertEqual(build.executable(root, "javac"), root / "javac.exe")

    def test_archive_paths_are_posix(self):
        self.assertEqual(build.archive_name(PureWindowsPath("web/assets/logo.png")), "web/assets/logo.png")

    def test_missing_signing_identity_never_creates_one_implicitly(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(build, "run") as command:
            with self.assertRaisesRegex(RuntimeError, "--unsigned"):
                build.ensure_signing(Path(directory), Path(directory), {})
            command.assert_not_called()
            self.assertFalse((Path(directory) / "signing").exists())

    def test_fingerprint_mismatch_fails_closed(self):
        verification = "Signer #1 certificate SHA-256 digest: " + "a" * 64
        with self.assertRaisesRegex(RuntimeError, "fingerprint"):
            build.verified_signer(verification, "b" * 64)
        self.assertEqual(build.verified_signer(verification, "a" * 64), "a" * 64)

    def test_no_signer_or_multiple_signers_fail_closed(self):
        for verification in ("", "Signer #1 certificate SHA-256 digest: " + "a" * 64 +
                             "\nSigner #2 certificate SHA-256 digest: " + "a" * 64):
            with self.assertRaises(RuntimeError):
                build.verified_signer(verification, None)

    def test_unsigned_mode_never_resolves_or_creates_signing_material(self):
        args = argparse.Namespace(unsigned=True, keystore=None, ks_pass_file=None,
                                  key_alias=None, create_candidate_signing=False,
                                  expected_signer_sha256=None)
        with mock.patch.object(build, "ensure_signing") as signing:
            self.assertIsNone(build.signing_options(args, Path("unused"), {}))
            signing.assert_not_called()

    def test_source_manifest_records_dirty_inputs_and_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            module = repo / "mobile-manager"
            source = module / "web/app.js"
            source.parent.mkdir(parents=True)
            source.write_text("export const candidate = true;", encoding="utf-8")
            with mock.patch.object(build, "run", side_effect=["a" * 40 + "\n", " M mobile-manager/web/app.js\n"]):
                provenance = build.source_provenance(repo, module)
            self.assertTrue(provenance["sourceDirty"])
            self.assertEqual(provenance["sourceRevision"], "a" * 40)
            self.assertEqual(provenance["sourceHashes"]["mobile-manager/web/app.js"], build.sha256(source))

    def test_candidate_readiness_does_not_claim_release_or_update_acceptance(self):
        readiness = build.release_readiness(signed=False, expected_signer_verified=False)
        self.assertEqual(readiness["status"], "blocked")
        self.assertFalse(readiness["installable"])
        self.assertFalse(readiness["updateCompatible"])
        self.assertIn("original_signing_identity_unverified", readiness["blockers"])

    def test_matching_arbitrary_expected_certificate_is_not_original_identity_proof(self):
        readiness = build.release_readiness(signed=True, expected_signer_verified=True)
        self.assertIn("original_signing_identity_unverified", readiness["blockers"])
        self.assertTrue(readiness["certificateMatchesExpected"])
        self.assertFalse(readiness["originalSigningIdentityVerified"])

    def test_signing_errors_do_not_echo_secret_arguments(self):
        with mock.patch.object(build.subprocess, "run", side_effect=subprocess.CalledProcessError(1, ["java", "private-value"])):
            with self.assertRaises(RuntimeError) as raised:
                build.run(["java", "private-value"])
        self.assertNotIn("private-value", str(raised.exception))

    def test_existing_cached_identity_is_reused_without_command(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(build, "run") as command:
            cache = Path(directory)
            signing = cache / "signing"
            signing.mkdir()
            key, password = signing / "ziwei-manager-internal.p12", signing / "ziwei-manager-internal.pass"
            key.write_bytes(b"existing opaque keystore fixture")
            password.write_bytes(b"existing fixture")
            self.assertEqual(build.ensure_signing(cache, cache, {}), (key, password))
            command.assert_not_called()

    def test_incomplete_existing_identity_fails_without_candidate_creation(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(build, "run") as command:
            cache = Path(directory)
            (cache / "signing").mkdir()
            (cache / "signing/ziwei-manager-internal.p12").touch()
            with self.assertRaisesRegex(RuntimeError, "Incomplete"):
                build.ensure_signing(cache, cache, {})
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
