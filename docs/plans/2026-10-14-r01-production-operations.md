# R01 Production Operations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build reviewable operations adapters that reject untrusted/missing production evidence and preserve current data, without changing E02 product files or production state.

**Architecture:** An independent operator trust file pins transports and source collectors; spec cannot provide its own key or executable. A trusted proofProvider forwards fresh product requests to every required host and returns original signed envelopes unchanged. A phase controller delegates spec validation/state changes exclusively to E02's delivered API; it has no alternative apply path. Backup/restore-read uses explicit private fixture roots and offline SQLite copies, verifies current rows/objects/HOME and rejects changes or missing stopped-writer proof.

**Tech Stack:** Node24 standard libraries and node:sqlite; Python standard libraries/Paramiko only for the prepared SSH transport. No dependency installation or business instances.

## Design choices and boundaries

- Select an independent transport adapter around E02's product interface. Embedding the product guard here would duplicate ownership and could bypass QA scope; inventing a new remote HTTP endpoint would change deployed services. Neither is needed.
- HMAC source-only secret versus server verifier is an explicit E02 dependency: symmetric verification requires approved verifier key reference/copy or a separately pinned remote verification interface. Only isolated fixture keys are generated now. No production key provisioning.
- Do not infer native claims, safe state, instance exit, absent roots or product fields from counters. Unknown schema/signature/envelope/transport/role refuses.
- Production mutation commands remain disabled until exact E02 source/spec/backup APIs, final accepted SHA/manifests and Q formal-entry gates are supplied. CLI plan and isolated preparation can be executed now.

## Task 1: Independent trust and pinned transport

Files: `scripts/operations/r01-proof-provider.mjs`, `scripts/operations/r01-proof-provider.test.mjs`.

Write and run failing tests for missing host, transport not independently pinned, different challenge/spec/operation, replay, unknown envelope shape, key in peer/spec, collector tamper and oversized/malformed output. Implement strict trusted-host selection and no-silent-retry collect/recheck. The adapter forwards exact requests and unchanged signed proof; final envelope verification belongs to the pinned E02 verifier. A process transport uses trusted command/root/hash plus stdin JSON; Linux never scans Windows path.

## Task 2: Private backup and offline restore-read

Files: `scripts/operations/r01-offline-backup.mjs`, `scripts/operations/r01-offline-backup.test.mjs`.

Write failing real SQLite/file tests for inconsistent/still-running writer evidence, wrong operation/DB identity, symlink/outside root, missing source/WAL/native state, changed source manifest and corrupt backup. Implement explicit private root, complete manifests, fresh output, SQLite backup API, whole source inventory, integrity/FK and byte/row/PK verification after isolated restore-read. Read data locally only on its owning host. Do not start restored data; no whole-production-DB restoration API is offered.

## Task 3: Phase controller and executable readonly plan

Files: `scripts/operations/r01-phase-controller.mjs`, `scripts/operations/r01-phase-controller.test.mjs`.

Write failing tests for missing E02 adapter, wrong module pin, apply without exact release gate, compat restore, mismatched operation/spec, unknown/uncertain prior result and backup proof absence. Implement delegated validation and inspect-first recovery; preserve immutable request/outcome evidence, never change key to retry. Do not implement schema/guard writes or native pause/stop fallback; these calls require the delivered product lifecycle and source-proof contract.

## Task 4: Handoff and verification

Run only the new isolated ops suites and syntax/diff checks. Retain red/green outputs and safe manifests in R tree `.local`. Commit safe ops code/tests/docs only. Record exact commands, dependencies that remain unavailable, native V1 stop proof/production HMAC deployment NOT_RUN and current zero production mutation status. Report to E02/root then idle for Q.
