# E02: offline dependency closure packaging fix — 2026-10-14

The independently rejected `7467eed` batch bundled Express/ws/yaml but omitted Express transitive dependencies. A successful offline npm installation and client build hash did not establish a runnable API. Preserve the Q01 failure report and old archive pins; do not deploy those archives.

## Change

After frontend build, the builder removes only its own staging node_modules link and executes `npm ci --omit=dev --offline --ignore-scripts --no-audit --no-fund` against that role's frozen lockfile. npm pack then sees a real production dependency tree, including nested conflicting versions. The original project dependency directory is unchanged. A cache miss fails construction rather than fetching different packages or declaring success.

The new verifier installs the actual client TGZ into an external disposable prefix with a fresh empty npm cache, offline mode, scripts disabled, blank user/global npm configs, and a minimal environment without NODE_OPTIONS, NODE_PATH or product/private config variables. It recursively resolves every required dependency and peer constraint, enforces physical prefix containment and semver ranges, retains nested versions, and permits genuinely optional absent ws peers. Optional peer metadata cannot remove a same-name required dependency or override its range.

The verifier links extracted API node_modules to **the installed client's node_modules**, namely `<prefix>/node_modules/ziwei/node_modules`. It actually loads Express/ws/yaml and extracted backend/app.mjs, instantiates createApp with memory:true, scheduler disabled, explicit disposable encryption key and object path, and closes that in-memory DB. A process guard rejects listen, outbound sockets/fetch and helper processes. No runtime service is started and no formal data or HOME/config/auth is used. This is package runtime verification, not Mac adaptation or actual server/Windows deployment acceptance.

Only after this succeeds does the builder write offlineDependenciesBundled and offlineRuntimeClosure metadata into each manifest. The receipts pin both archives, installed source build, dependency package JSON hashes/versions/edges and the actual API factory result. Client source and installed source identities remain separate; the verifier does not normalize arbitrary source bytes to make identities match.

## Observed evidence and reproduction

The five initial focused closure cases passed (nested positive plus missing transitive, ancestor fallback, wrong hoisted version and escaping link negatives). The existing two `7467eed` TGZ files were then independently cold-installed by the new verifier and both refused as OFFLINE_DEPENDENCY_MISSING, express -> accepts. These are real old-archive negatives, not fixture-only checks.

The first clean fix `a25a94d9415f80b5e1e58911289b303ffdf4f45b` generated a fresh six-archive/two-manifest batch in E02 private `.local/preservation-offline-closure-01`. Both roles passed the cold-cache graph and actual extracted API factory gate. An additional finite peer-overlap bug found during review is corrected in the following increment and has its own missing/wrong-version negative regression. Final publication should use the subsequent clean checkpoint's fresh batch and actual pins; do not reuse the old 7467eed or first diagnostic batch as final candidate artifacts.

Commands from a clean source checkpoint:

```text
node --test test/preservation-runtime-closure.test.mjs
node scripts/build-preservation-packages.mjs --output .local/<fresh-batch>
node scripts/verify-preservation-runtime-closure.mjs .local/<fresh-batch>
node scripts/verify-preservation-api-entry.mjs .local/<fresh-batch>
```

The standalone closure command rechecks both manifests/artifact hashes and cold-installs both TGZ again, compares exact installed source members/builds, then writes private offline-runtime-proof.json only after both pass. The separate API entry verifier retains its narrower maintenance-plan, DB/WAL/SHM preservation and first-write refusal coverage. Neither result is a listening API boot, provider call, actual Windows install/reboot, or G1–G5 acceptance.

R01 remains the sole publisher/deployer. Q01 independently verifies the new final archives. No R01 operations file, main user worktree or formal runtime is modified by this fix. Only source, this focused test and safe instructions enter Git; packages, dependency trees, caches, temporary keys/configs and raw receipts stay private. The first rejected batch and its independent failure remain evidence of the packaging defect.
