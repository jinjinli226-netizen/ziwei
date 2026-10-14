# E02 final source CLI checkpoint — 2026-10-14

This finite checkpoint integrates E03 `eb2ee64fcc2605e723d01bdb834b1666d2ebd3af` as E02 `f332083` over the historical Windows-validated `794ba7f`. R01 remains the only GitHub publisher and server deployment executor. The user explicitly authorized publication after acceptance and requested no Mac runtime adaptation.

## Resulting behavior

Both native source observer calls receive the original signed `sourceRequest`. The collector obtains the complete original observation before selecting code paths. For prepare/seal, only `getQualifiedWindowsKernelArchive(observation, digestProduction(client))` may substitute the original code root/entry; a copied observation, caller JSON flag, foreign binding or failed qualification grants no substitution. Original config SHA/path, runtime/user/base HOME, complete connection scopes, native scans, legacy interpretation, debt checks and final recheck remain bound to the original client. Restore still selects the exact actual installed V2 target and its existing private/native proof requirements.

POSIX paths are selected before Windows paths in production target validation, legacy required-file validation, native gateway DB matching and owned profile proof matching. `path.win32.isAbsolute('/srv/...')` is true and was incorrectly selecting Windows joins on Linux. Native source CLI validation now relies on the actual host path implementation; Linux accepts actual absolute POSIX paths and rejects drive paths. Supported native source platforms remain Windows and Linux.

The package builder supports the current runtime's adjacent Windows npm CLI or POSIX lib location and refuses tracked WIP before freezing packages. The API archive verifier canonicalizes disposable temp paths and the cleanup parent. These are minimal publication build/verification adjustments, not Mac product runtime support. No Mac test framework or port preload is part of this checkpoint.

## Actual verification

On macOS / Node v24.14.0:

- `node --check scripts/production-source-proof.mjs` and builder syntax check passed.
- `node --test test/preservation-windows-kernel-boundary.test.mjs test/preservation-windows-native-source.test.mjs`: 10 tests, 6 passed, 4 Windows-native tests skipped, 0 failed. The positives use explicit injected finite native facts and actual disposable files; they are not actual Windows reboot/SDK results.
- `node scripts/lint.mjs`: 132 source files checked, passed.
- `git diff --check`: passed.

The source CLI's live Windows collect/recheck/restore chain has not been rerun from this Mac. Historical `794ba7f` Windows whole-suite evidence was 1237 tests / 1235 pass / 0 fail / 2 Linux-native skips; it predates this final kernel/CLI/path checkpoint and is not represented as current final-chain acceptance. Earlier e0a7474 package/native rehearsal failed with rounded NTFS identity; that failure was fixed before 794ba7f and is not a final accepted package receipt.

Exploratory broad Mac tests before the final E03 import exposed the POSIX path issue and unsupported Darwin observation contracts; the exploratory logs are not accepted full-suite receipts. Their temporary listeners were registered in the local port center, all owned leases were released, and the final project check reported no conflicts/unregistered ports. The user then stopped Mac adaptation; the temporary test framework was removed. No formal service, original SDK/config/HOME, phone or paid provider was operated.

## Handoff and remaining field acceptance

R may publish this clean finite source checkpoint under the user's existing authorization; six archives/two manifests must label a clean exact candidate commit if generated. Do not mark an uncommitted copied source as its old HEAD. Private `.local` logs, dependency installations, artifact directories, fixture trust/config/key material and production evidence are excluded from Git. Safe tracked scope is source, tests and operations/plans docs only.

Actual Windows SDK positive full chain, controlled host restart positive, subscription/proxy/model use and field client upgrade remain unexecuted here. The user will perform Windows acceptance after release. Unknown Windows evidence continues to refuse that local preservation action; it is not a global gate for independently approved Linux server deployment. User publication authorization does not itself authorize the separately disruptive host restart described in the E03 ABI document.
