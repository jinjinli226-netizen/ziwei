# E03 Windows kernel restart interface — 2026-10-14

This checkpoint adds `windows-kernel-restart-v1` in the source namespace module. It authenticates a finite old-kernel termination boundary; it does not authorize an OS restart or prove a real restarted Windows host. E02 owns source CLI/product integration, Q reviews the combined wire, and R performs field collection.

## Archive before changing the original entry

Finalize the complete original client object, including install targets, before inspection. Its entire `digestProduction(original)` is pinned; changing targets later invalidates the archive. While the genuine original PID/birth is alive, create a concrete byte-identical code copy and call:

```js
const descriptor = await inspectWindowsCodeArchive({original, sourceRoot});
```

The function accepts no IO callback, uses the default Windows native reader, verifies actual original entry/environment/birth before and after inspection, canonical roots, build equality, every source file's bytes and BigInt device/inode, and the original entry's audited class. It does not stop, move, remove or launch the entry. Save the descriptor as a `legacy-source-archive` file ref with its actual SHA, `bindingDigest: digestProduction(original)`, and `originalInstance: {pid, createdAt}`. Keep exact `legacy-source-code` refs for the archive entry and, for SDK, the seven audited source files.

The kernel `windows-source-audit-v1` uses its existing fields plus `sourceRoot` and `archiveSha256`; entrySource is the matching archive entry. Only the kernel protocol accepts these extra fields. SDK entry/build identity cannot be downgraded to the closed literal program. Ordinary standalone audits also bind the actual original root, entry and actual non-SDK build.

Collect the before namespace with the default native reader while the actual original still exists. Retain its raw `codeArchiveOrigin` and `codeArchiveCapturedAt` inside the signed before capture. The only permitted before unknowns are discovery descendants unrecoverable or kernel restart required. Other unknowns, debt, uncertain actions and worker facts remain blocking.

Archive members are completely rechecked on every observation. Their descriptor is the exact membership proof; only the descriptor/audit/existing exact source refs enter the external file manifest. There is no archive directory scope exemption and no new protected HOME.

## Fence and boundary producer

Both producers accept only JSON input and the original signed fresh prepare request; neither accepts caller boot identities, clocks, process lists or IO callbacks. Select the original through the exact digest of a unique request.binding.clients entry.

```js
const restartFence = await produceWindowsKernelRestartFence({
  sourceRequest, trust, beforeEnvelope, originalBindingDigest
});
const afterNamespace = await produceWindowsKernelRestartBoundary({
  sourceRequest, trust, beforeEnvelope, originalBindingDigest, restartFence
});
```

R performs separately authorized controlled stop and entry fencing before calling Fence. Fence requires the actual old kernel, absent original PID/birth, absent exact original entry with stable parent identity, two identical empty/readable native namespace samples, and final fresh boot/entry checks. It signs domain `ziwei-production-windows-kernel-fence-v1` with the full request/spec/database/freeze/binding/policy/before chain, original binding/instance digests, oldBootId, observedAt, entryFence and **sourceFiles**.

`sourceFiles` is the stopped logger snapshot, collected after original absence rather than copied from before-stop. It is mandatory, including `[]` for the literal program. Each record has the exact closed fields `{path, exists:true, sha256, bytes, identity:{dev,ino}}`; its ordered unique paths must exactly cover approved audit.loggerPaths. SDK parsing still requires the original boot started record and rejects any original-PID action.started. Do not list these mutable live logs as immutable static refs unless their bytes actually remain fixed; per-action immutable references remain independent.

After an actual restart, Boundary requires a different actual bootId, boot start later than before capture and Fence, matching entry absence and two identical empty native scopes. Its return is the **complete namespace**, not just the six-field boundary:

```js
{
  // actual default-native namespace fields,
  sourceFiles: restartFence.payload.sourceFiles,
  terminationBoundary: {
    kind: 'windows-kernel-restart-v1', originalInstanceDigest,
    oldBootId, newBootId, bootStartedAt, observedAt
  },
  restartFence
}
```

Place this exact result into the selected `after.instances[].namespace`, then sign the full after capture with existing `createNamespaceCaptureEnvelope`. Retain unchanged workerFacts/actions and chain after.previousCaptureDigest to the whole signed before envelope. Evidence signature time is checked at Fence.observedAt; current collect/recheck/restore requests must each still be fresh.

Default native IO additionally exports `readWindowsBootIdentity()` -> `{bootId, startedAt}` and `readWindowsEntryFence(entryPath)` -> absent entry/parent identity or a present file identity/hash. The PowerShell helper's LF-normalized SHA is `3e4f6b41ed21a9d4fefccb69ad2acf4d7e1284e69bc70a9002bf4531fd42b658`; boot hashing uses the same underlying LastBootUpTime format as native process birth.

## E02 consumer integration

Pass the original authenticated envelope at **both** source observer calls:

```js
const observed = await observePreservationSourceNamespace({
  binding: payload.binding, request: payload, trust, sourceRequest: request
}, native);
const archive = getQualifiedWindowsKernelArchive(
  observed.observations, digestProduction(client)
);
```

Only a fully successful observation/result has the WeakMap mapping `{root, entryPath}`. JSON copies, caller flags, failed observations and ordinary protocols return null. Resolve the original code build/entry from this mapping for prepare/seal, after complete safe observation, while keeping original config path/bytes/SHA, runtime/base/user HOME, complete connections, native writer/debt/legacy checks and final guard. Restore still binds the actual exact approved V2 target and private identity/nonce, native birth, listener owner, namespace members, API proof and pending/inflight/uncertain checks. Do not use raw JSON to choose archive roots.

Consumer authenticates the signed fresh source request and before/fence/after chain, checks actual current new kernel twice and fresh entry state, performs full static archive/audit verification independently of the native test seam, and only then brands the result. Old PID numeric ancestry is not reused across kernels. Prepare/seal require old entry absence. Restore may admit reappearance only for the exact approved actual V2 target with new-kernel runtime proof.

After.namespace.sourceFiles must equal the authenticated Fence array. Prepare/seal/boundary require logger bytes and identity unchanged. Restore may append to the same file only when its signed byte prefix SHA remains exact; the whole current JSONL is parsed again and original action.started still refuses. Rotation, truncation, replacement, PID-number reuse producing original-PID action records, or changes to the full live manifest between collect/recheck can conservatively refuse. The raw `verifyWindowsBootLoggerSnapshot` helper verifies files only and grants no trusted brand.

## Observed validation and limits

On macOS with Node v24.14.0, the final command `node --test test/preservation-windows-kernel-boundary.test.mjs test/preservation-windows-native-source.test.mjs` returned **10 tests: 6 passed, 4 Windows native tests skipped, 0 failures**. Coverage includes POSIX/drive/UNC ref/capture/runtime paths; authenticated simulated new-kernel collect/recheck; bad signatures, chronology, source, fence, writers and repeated epoch changes; signed Fence/after logger mismatch and malformed snapshot fields; archive provenance and SDK-to-literal refusal; raw stopped logger prefix/full JSONL rules. Fixture temp roots are canonicalized; product symlink rejection remains intact. `node scripts/lint.mjs`: 127 checked, passed. `git diff --check`: passed.

The new ordinary-protocol actual-entry/SDK negative checks are in the isolated Windows-native case and were skipped on this Mac. Earlier Windows runs observed native boot agreement, real isolated no-worker stop, signed entry-absence Fence and same-kernel Boundary refusal, plus earlier pure negatives. Those runs predate this final logger/path/ordinary fix and are historical transcript evidence only: the migration did not restore `.local` native artifacts, so they are not presented as rereadable current-checkpoint evidence.

Actual SDK positive full chain, actual host restart positive, real subscription/proxy/model invocation and Windows field deployment have not been executed here. The simulated positive is not a field restart result. User will perform Windows field acceptance after release; this document does not impose an additional publication approval or falsely claim that acceptance.
