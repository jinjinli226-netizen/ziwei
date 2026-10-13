# E03 Windows source and private client identity ABI

This phase implements a native Windows source reader and a private client identity factory/verifier. It does not authorize stopping/updating the original SDK, provisioning production keys, running a launcher/model/device, pushing, deploying, or asserting the production gate passed. E02 owns the existing daemon/API routes, native scanners, legacy interpreter and package integration; E03 owns the new source module, narrow helper and dedicated qualification tests.

## E02 client route contract

`createProductionClientIdentityHandler({trust, hostId, boot, readState})` is constructed once in the real daemon startup. The optional second argument is a code-only unit-test seam; production routes do not accept callbacks in request JSON.

`boot` has exactly these fields:

```js
{
  nonce: lifecycleNonce,
  startedAt: lifecycleStartedAt,
  clientBuild: CLIENT_BUILD,
  configPath,
  runtimeDir,
  loadedConfigSha256,
  connections: actualConnectionProjection
}
```

`loadedConfigSha256` is SHA256 of the same byte buffer passed to `JSON.parse` for the daemon's actual startup config. A later `lifecycleConfigurationHash()` read is not this value. Pass the genuine immutable startup constants. Derive `connections` from the already installed actual connections Map, including every enabled primary/shared connection. The factory independently compares that projection with the loaded config bytes and the default actual module ROOT, entry, PRODUCT_ROLE, CLIENT_BUILD and complete checked source closure.

Each connection has exactly `{workspace, deviceId, apiBase, hermesHome, runtimeDir, primary}`. `apiBase` is a canonical origin without credentials; workspace/device are single directory components. Primary runtime is `userHome/runtime`; shared runtime is `runtime/shared-workspaces/<workspace>/<deviceId>`. Exactly one primary is required. All runtime/HOME directories must exist, be physical/canonical, and have no symlink/junction ancestors. The factory checks them at construction and on every signature.

`readState()` synchronously returns exactly:

```js
{
  connectionState: 'draining',
  connections: actualCompleteLiveProjection,
  issues: [],
  activeActionCount,
  pollingCount,
  quarantinedActionCount,
  pendingDeliveryCount,
  blockedDeliveryCount,
  managedAuxiliaryCount,
  gatewayPendingCount,
  gatewayInFlightCount,
  gatewayInboundCount
}
```

All nine counters must be actual finite safe integers equal to zero; absent/unknown/throwing getters must not become zero. The draining value is the real daemon state. Aggregate connection errors, corrupt journals, unknown workers and native file issues into `issues`. Health JSON is insufficient: its connection rows omit the required HOME/runtime/origin scope, and `managedAuxiliaryCount:0` does not prove discovery descendants closed.

The route accepts only loopback POST bodies signed with the independent approved source-host key. `createClientIdentityRequest({sourceRequest, trust, target})` derives the private request from the fresh approved source request. Handler responses set `Cache-Control: no-store`; refusal is 403 with finite `SOURCE_CLIENT_IDENTITY_REFUSED`. The proof binds the request digest, host binding, operation/spec, challenge/time/freeze, approved installed/target/source digests, actual PID/startup nonce/time/root/entry/role/build, both loaded/current config hashes, and the complete connection/drain snapshot. It contains no server DB identity or fence state.

`verifyClientIdentityProof` is pure with respect to the source filesystem. It also runs on the Linux API host, so it never opens a remote Windows config/runtime/HOME path. It validates the authenticated factory proof against the approved hashes, complete signed connections and source request. Local source collection separately reads the actual config and files. Windows path construction uses `path.win32` even when verification runs on Linux.

The runtime-capture `instances[]` row for a client has exactly `{kind, bindingDigest, targetDigest, root, entryPath, productRole, buildDigest, pid, nativeBirth, nonceDigest, clientIdentity}`. The outer source capture and inner private proof must agree on PID/nonce/target. The default source observer independently checks native birth, entry, namespace members and exact loopback listener owner. A client proof cannot establish the Linux API's same-mainDB sealed identity; actual API proof and aggregate validation retain that responsibility. Client-only `observations.runningV2` now contains only `productRole` and `instances`; DB/fence/build fields are emitted only from an actually verified local API identity, never copied from request pins. The coordinator separately authorized E03's finite `production-preservation.mjs` validateObservations/aggregate correction: permit this honest client-only shape, require every expected runtime capture and at least one actual matching API runtime target globally, and reject client API labels. E02/R must merge both checkpoints together. A spec with only clients cannot authorize full production restore.

## Native Windows scope

`inspectWindowsSourceProcess({pid, createdAt?, entryPath?})` and `defaultNativeSourceIO.readProcess(pid)` use the pinned `preservation-source-native-windows.ps1` helper, hidden native PowerShell, same-user SID, native 64-bit/no-WOW64 and empty package identity for both caller/target. Both helper and inventory/listener calls use the actual canonical system executable `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, SHA256 `8bb6fa8c283b4d92120b1ef249a9b311b0f804d4cabbe9981159976c8be76a5e`, not cwd/PATH resolution. Linked/changed images and other architectures refuse; other Windows installations require separate native qualification rather than accepting arbitrary replacement executables. No system file was modified. A held process handle supplies creation FILETIME; PEB command/cwd and native CIM birth/command must remain consistent before and after reading. Process disappearance is returned as null, not as a complete empty worker namespace.

The environment reader streams bounded memory blocks, discards unselected values, clears buffers and emits only the explicit path allowlist: HOME, USERPROFILE, HOMEDRIVE, HOMEPATH, LOCALAPPDATA, APPDATA, ZIWEI_CONFIG, ZIWEI_USER_HOME, ZIWEI_RUNTIME_DIR, ZIWEI_SDK_ROOT, HERMES_HOME, HERMES_MANAGED_DIR. It checks NODE_OPTIONS only for nonempty presence and rejects that execution override without retaining its value, so the closed-source interpretation cannot be bypassed through Node preloads. No arbitrary environment, PATH, auth or key values are printed/cached. The [execution-time module correction](2026-10-14-e03-powershell-module-startup.md) overrides startup's reconstructed PSModulePath inside every helper/inventory/listener script before JSON, CIM or absent handling, disables autoload, explicitly imports protected system manifests, and verifies each actual command's provenance before using module-qualified commands. Merely passing the system Modules path in the child environment did not ensure this invariant. Ancillary inventory returns only PID/parent and a related-to-approved-roots boolean; arbitrary process command lines stay inside the native query and are not emitted. The collector's own native query process/children are excluded by its actual native PID, not by a caller-supplied safe flag. An ordinary parent is not automatically excluded.

Native Node on this machine creates a conhost.exe child even for the closed no-worker test program. The namespace keeps this PID in members. For an authenticated restored runtime only, a narrow native console-host proof verifies same-user/native/package context and held birth/kernel image, real parent PID/birth, canonical system conhost image with valid Microsoft Authenticode signature and actual SHA256, fixed hexadecimal console-server arguments (no --headless/program launch), native CIM command/birth stability, and no children. It reads no console-host environment. Windows' protected console host uses a limited query handle; the business Node process still requires PEB memory command/path checks. Unknown or changed children remain members and refuse. These volatile facts are retained in the signed restored instance's consoleHosts array; the observer does not drop arbitrary descendants by name. Signature validation imports only the explicit Windows built-in Security module path, without relying on the inherited PSModulePath or replacing any module.

The default `readNamespace({kind:'windows-source'}, context)` reads this real native inventory and approved immutable source audit. `context` is supplied internally by the source observer: `{binding, original, request, nativeRefs, before, after}`. It checks original birth plus exact original config/runtime/HOME paths. It never treats vanished PID, synchronous `spawnSync` return, zero runtime counter, JSON `safe:true` or an absent old Job as proof of complete old workers.

New static `nativeSourceRefs` kind: `windows-source-audit-v1`, with ordinary `{kind,canonicalPath,sha256,bindingDigest}`. Its JSON has exactly `{schemaVersion,kind,bindingDigest,originalInstance,clientBuild,entrySource,entrySha256,protocol,spawnSites,loggerPaths,maintenanceRoot}`. Two finite interpretations exist:

- `standalone-no-worker-v1` accepts only the literal exported `WINDOWS_NO_WORKER_PROGRAM`, no imports/evaluation/IO/spawn, empty spawnSites/loggerPaths and null maintenanceRoot. This is a real native qualification case, not SDK capability.
- `ziwei-sdk-current-boot-v1` checks the exact audited installed SDK CLIENT_BUILD and seven known source SHA256s, actual PEB scope, complete approved same-boot logger files and no action.started. It excludes the unentered action executor branches. It refuses with `SOURCE_WINDOWS_DISCOVERY_DESCENDANTS_UNRECOVERABLE` for the unrecorded recurring bootstrap/heartbeat discovery process history. No generic caller-authored spawn-site ledger is accepted as a substitute for this historical fact.

## Actual original read-only findings and finite remaining gap

The real default helper observed PID 12132, held creation FILETIME `134362739932908779`, birth `2026-10-12T10:19:53.290Z`, PPID 1848, entry `D:\work\nodejs\node_global\node_modules\ziwei\daemon\ziwei_user.mjs`, config `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`, userHome `C:\Users\25941\AppData\Local\Ziwei\ziwei_user`, Hermes HOME `C:\Users\25941\AppData\Local\hermes`, and absent NODE_OPTIONS execution override. Its final selected path-only artifact is `.local/preservation-native-qualification/windows-12132-origin.json`, SHA256 `3a47e3ef618d54130fbff52854e234287f95c16112623ce1d16a6c89e5ff381c`. The helper did not stop or change the process. Original-PID probes now compare held native birth before reading a reused PID's memory; unrelated reuse is not the original, while the separate complete scope inventory still retains any related new writer.

Exact SDK audit: ActionDispatcher durably marks and synchronously emits action.started before invoking the executor; logger append is synchronous. The two complete currentboot logger rotations have no action.started, so model/action/native-MCP/Creator/phone/raw command/automation/profile execution paths were not entered in this boot. `createManagementBootstrap().status()/prepare()` performs state/HTTP/cache work and does not spawn. `terminalMcpStatus` performs URL/filesystem status checks and does not spawn. Historical action cache entries are not assigned to this boot.

Read-only GET `/healthz` uses cached `healthPayload()` and performs no discovery. It recovered the latest selected launchers (checkedAt 2026-10-13T21:52:17.752Z through 21:52:19.166Z):

| Runtime | Physical selected entry | SHA256 | Retained result |
|---|---|---|---|
| Claude | `C:\Users\25941\.local\bin\claude.exe` | `121fc8151ed40bd9c144d68aa1cea23427803628ffab65e23da1cceda155697e` | CLI 2.1.285 |
| Codex | `C:\Users\25941\AppData\Local\OpenAI\Codex\bin\2e5e00daee91c61d\codex.exe` | `d13914ced6c7af174d8d638db938284231227312104b06a25e9608c632a7daec` | CLI 0.162.0-alpha.17.2 |
| Gemini | `D:\work\nodejs\node_global\gemini.ps1` | `4af406a78afad63f4c20b9bb18f386b2daf59040941474ea02b91942e995e7a3` | CLI 0.63.0 |
| Hermes | `C:\Users\25941\AppData\Local\hermes\bin\hermes.exe` | `9ae757274ede0174c9702c84c30a26176a3c6dd9e59e64d718b28429354b73ca` | cli_version_timeout; 0.21.3 from installed_metadata |

Static inspection executed none of these launchers. Claude/Codex PE bytes fix current identity but cannot prove old --version child behavior. Gemini PS shim selects adjacent Node or PATH Node; the bundle can relaunch one Node child, waits child close, then the main --version branch exits before model initialization. Current adjacent Node is absent; the original PATH/interpreter and every earlier selection were not recorded. Hermes distlib launcher binds `hermes-agent/venv/Scripts/python.exe` and imports `hermes_cli.main`. Before version early return, `_early_recovery` may invoke uv/pip without a subprocess timeout; fast version/banner/update checks may invoke git with 5/10-second waits, longer than SDK's 3-second probe timeout. Actual marker/settings/auth/update data were not read.

SDK discovery runs at boot and on heartbeat with 30-second cache expiry. Only the latest chosen binary/version/detection remains in memory/full health; normal logs retain just version or reasonCode. It never persisted each probe's command/argv, PID/birth or descendant exits. Last selection and current canonical hashes cannot reconstruct all earlier selections or timeout descendants. This is the precise irrecoverable historical gap; neither the nonexistent old global worker ledger nor current PID inventory can close it.

Minimum safe handling for R is to retain this unknown state and the recovered physical/source evidence. A finite next check is existing OS process-creation/exit telemetry, if it already covered the full original boot: correlate original PID+birth, each locator/probe PID+birth and every recursive descendant exit, including any reparented processes. Enabling logging now cannot repair earlier missing events. Current matching PID inventory is useful negative evidence but cannot alone establish this complete historical graph.

The remaining impossibility is concrete. Claude/Codex are opaque native PE executables whose complete --version child behavior is not established by canonical file/hash. Gemini's earlier PATH-selected Node identities and source selections were not persisted. Hermes' original recovery marker, profile/container branch and Python startup module inputs were not captured per probe; interpreter startup can also load site/venv .pth/sitecustomize/PYTHONPATH modules before the audited main/version branch. Neither the exact root input nor a bounded list of all historical possible child executables is available. Matching only today's git/uv/pip/python/launcher paths therefore cannot rule out all earlier detached children. This phase does not read arbitrary HOME/config/auth to manufacture that missing provenance.

The user has authorized deployment of the server and matching client after acceptance, including controlled stops of precisely identified original clients and related descendants, native boundary verification and updating. R01 may use that authorization for the exact known processes at release time. Missing historical telemetry is a present evidence gap, not a claim that deployment can never become acceptable. If R01 obtains a complete native current scope with independently established coverage of every possible surviving original descendant, it can stop those identified processes and verify their PID+birth absence before fresh signed collect/recheck. The current reader alone does not establish that coverage: it filters the real inventory by approved path matches and current parent chains, so an earlier detached/reparented descendant whose current command contains no approved root can be omitted. Stopping every current returned member and observing `absent` therefore cannot alone close this particular historical gap.

If no complete telemetry or other independent finite scope proof is available, the smallest general kernel termination boundary established here is a restart of the **Windows original-client host**. This does not require restarting the Linux API/server host. Its native local entry is `C:\Windows\System32\shutdown.exe /r /t 0`; Microsoft's [shutdown reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/shutdown) defines `/r` as shutdown followed by restart. This is a proposed operator operation, not an executed command. It interrupts all processes/apps on that Windows host, so it needs an arranged host maintenance point and the coordinator's explicit authorization for that wider impact. No forced-close option or application-restart option is proposed.

Before that operation, R retains the approved durable data and original PID/birth/native boot identity, and verifies that the exact old daemon/updater launch entries cannot automatically restart. After an actual restart, the required observable result is a different native OS boot identity (`Win32_OperatingSystem.LastBootUpTime`, sampled through the fixed system CIM prelude), no original entry/updater writers in a complete new inventory, and fresh signed source captures bound to that new boot and the retained approved original data. A new boot establishes exit of every prior kernel process regardless of lost ancestry; PID reuse is evaluated by birth and cannot impersonate the original. New automatic writers would still refuse. The existing SDK audit branch deliberately does not yet consume a post-restart boundary proof: R/E02/Q must add and review the finite authenticated boot-boundary input/collect/recheck path if this handling is chosen. They must not relabel an old capture, a caller-authored `safe` flag or an absent PID as that proof. This phase implements only the PowerShell module correction and performs no formal stop, unknown-process kill, restart or SDK update.

## Qualification and integration status

Dedicated tests cover real native Windows handles/birth/selected path memory, wrong birth, no secret output, positive actual no-worker exit, changed environment/source, private client signature/config/scope/nonce/role/challenge failures, remote pure verification and live junction replacement. Linux WSL qualification uses the already approved private Node archive and genuine Linux `/tmp` SQLite files. Both actual JS tests pass: held transaction FD observer preserves locks; default private API factory reads its actual open DB/sealed row, boot/root/entry and native listener without file writes or IO callbacks.

The dual-host default Windows source CLI qualification uses two actual isolated no-worker original processes, then two real default client factory servers and native birth/listener queries. Ports 46091/46092/46093 were checked against the port registry and live Windows listeners before qualification. Persistent independent supervisor diagnostics append per-instance JSONL under E03 `.local/preservation-native-qualification/diagnostics`, recording PID/start, heartbeat and exit code/signal; no business project service is started or stopped.

The default dual-host CLI execution exposed an existing E02 scanner precision bug: Number stat dev/ino lost real NTFS ID bits (observed `19984723350203829` vs `19984723350203828`), yielding SOURCE_DIRECTORY_CHANGED. The coordinator explicitly transferred this limited correction to E03 while E02 was idle. Separate commit `bc77674a3d9e2edfce45b9696ddfcc95edd1c230` switches the three identity-producing stat sites to BigInt and bigint nlink checks, without changing scope/debt rules or weakening recheck; the new actual-ID regression and eight existing native evidence tests pass.

Final Windows validation: 89 tests, 87 passed, zero failed, two Linux-only skips; lint checks 127 source files. The real default dual-host fixture passes prepare collect/recheck and restore collect/recheck with fresh private client responses and independently verified listener/birth/console-host facts, then refuses an actual extra isolated process in the original scope even while the private client counters remain zero. Windows test ports have no listeners after cleanup. Final native Linux rerun separately passes 2/2 with zero skips: the held SQLite lock regression and real default private API factory/open-DB/listener proof. Production lifecycle and aggregate signature tests pass with actual private API factory identity fixtures rather than borrowed client DB/fence labels.

These are component/synthetic qualification results. No formal production stop/update/restore or key provisioning occurred; actual Windows discovery history remains the stated gap. Overall production gate is not PASS.
