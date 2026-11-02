# Workspace CLI 2.0.4 reconciliation

## Scope and approved design

Reconcile the independently installed 2.0.3 authentication behavior with this branch's 49 business operations and mixed Bot schemas. Only this package is changed. The parent chat owns repository documentation, commit/push and publication. No live credentials, business calls, global installation or daemon restart are part of this change.

The authentication baseline is the verified 2.0.3 tarball, not a claimed pure Git snapshot:

- Package SHA256: `2f6401718659f82f0961d6b7d74a87333afea7884f45b2defbc2352e115d3708` (62934 bytes, 23 members).
- Provenance: installed 2.0.2 plus reviewed capability-reporting changes from `8e4f37af60a473ecc2b811fa66d8461c11d66e7d`; pure Git candidate was not published.
- Existing receipt: `D:/AINavtie/ops/ziwei/capability-reporting-rollout-20261028/INSTALLED-COMPATIBLE-CLI-PREPARATION.json`.
- All tarball members matched the current 2.0.3 installation before editing.
- Branch baseline: `a8b3e3194ea94f8ffc65b0a527c47219f7195e07`; this package had no pre-existing changes.

## Implementation plan

1. Migrate the accepted 2.0.3 authentication tests and add focused regressions. Run them against the branch before changing runtime code and record the expected failures.
2. Preserve 2.0.3 authentication behavior in `src/auth.mjs`, `src/config.mjs`, `src/unified.mjs` and the authentication portions of `src/main.mjs`: explicit human long-lived login, selector session locks, durable credential writes, refresh before dispatch, persistence of rotated tokens before API verification and preservation of unresolved refresh state.
3. Retain branch additions in `src/registry.mjs` and `src/transport.mjs`: three DSH plugin operations, mixed runtime Bot schemas and original plugin receipts. Keep machine identity restricted to its registered employee/workspace and a short-lived token without refresh.
4. Set package, registry, help and build banner to 2.0.4. Replace stale capability descriptions with implemented behavior while retaining the distinction between offline catalog information and server-verified authorization.
5. Run the package regression suite and build. Review the final six-source merge and generated vendor output. Prepare an independent candidate only after source verification; installation and publication remain separate authorized steps.

## Six-source merge

| Source | Result |
| --- | --- |
| `src/auth.mjs` | Retain 2.0.3 person-only long-lived validation and logout session lock. |
| `src/config.mjs` | Retain 2.0.3 per-selector session locks, fsync and separate access/refresh/session expiry metadata. |
| `src/unified.mjs` | Retain 2.0.3 automatic renewal, rotated-grant persistence before API verification, unknown-generation fencing and `reauthorization_required` records. Also fix the independently reproduced first-completion verification ordering issue described below. |
| `src/main.mjs` | Retain 2.0.3 flags, refresh-before-dispatch and lock budget; help describes issuer-provided expiry without a fixed duration promise. |
| `src/registry.mjs` | Retain all 49 branch operations and mixed Bot schemas; publish accurate 2.0.4 identity capability descriptions. |
| `src/transport.mjs` | Retain branch plugin request routing and original action/pending receipts unchanged. |

The accepted `auth` and `config` sources match 2.0.3 after newline normalization. `unified` intentionally differs by the verified recovery ordering fix: when first completion has already persisted an issued generation but `/me` temporarily failed, the next call verifies that generation through the existing identity configuration and `/me` path before the ordinary complete-identity assertion. Verification failure still blocks business dispatch and preserves the RT; recovery does not repeat device or refresh exchange. No live credential format or login mode was changed. Runtime and provenance hashes are recorded in `MERGE-PROVENANCE-2.0.4.json`.

## Verification

- TDD: a new long-lived login regression failed with `Unknown option` before runtime changes and passed afterwards. Release metadata checks initially passed 1/4, then passed 4/4.
- Historical 2.0.3 session lifecycle and cross-process worker tests were migrated. Old tests now exercise the actual session-lock and durable-issued-generation semantics rather than expecting logout to bypass the lock.
- Authentication regression subset before the additional recovery case: 86 passed. The first-completion `/me` 503 regression failed with `UNAUTHENTICATED` before the ordering fix and passed afterwards, verifying RT retention, one token exchange and one business call only after successful verification. Full final `npm test`: 111 passed, 0 failed.
- `npm run build`: successful; banner is `workspace-cli 2.0.4`. Generated vendor files remain consistent with the branch sources.
- Final independent candidate: 64124 bytes; SHA256 `666a0e34323b818d14696b4666404e145f2c442cd572f541eda6a195ab60c2c8`. All 23 archived files match package source bytes. Extracted `--version` and offline `capabilities` report 2.0.4 and 49 business operations. No dependency, test, credential or local receipt is in the archive.
- Candidate evidence: `.local/release-2.0.4-recovery-fix/CANDIDATE-ACCEPTANCE.json`. This is an uncommitted working-tree candidate; source commit/push, installation, live acceptance and publication are separate parent-owned steps. The older 64122-byte `564f6323...` archive remains unchanged in `.local/release-2.0.4/` as history only; it lacks the recovery fix and is not the publication candidate.
- Independent source review closed the reproduced P2 and found no remaining blocker. No commit, global installation, credential change, business call or daemon restart has been performed.
