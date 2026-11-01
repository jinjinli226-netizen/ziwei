# Device Attachment Transfers Implementation Plan

> Execute in the existing isolated worktree with test-first changes and independent review.

**Goal:** Transfer up to 500 MiB of action attachments without embedding file contents in action JSON or repeating model execution.

**Architecture:** Shared policy limits file count, per-file/combined size and 8 MiB chunks. Device-authenticated transfers stream inputs into the original action directory. Runtime manifests produce hashed local descriptors; durable delivery uploads them using persisted offsets and sends completed references in the existing small result envelope.

**Tech Stack:** Node.js streams, filesystem, fetch, existing A2A device authentication and journal.

---

### Task 1: Transfer protocol

- Create `src/conversation-attachment-transfer.mjs` and `test/conversation-attachment-transfer.test.mjs`.
- Fail-first tests cover streamed download, size/hash validation, chunk upload, interrupted transfer/resume and duplicate completion.
- Verify 500 MiB and limit+1 using local files and a no-model transport fixture; measure bounded chunk memory without production traffic.

### Task 2: Runtime inputs and outputs

- Update `src/local-action.mjs`, `src/runtime-adapters.mjs` and `src/conversation-image-artifacts.mjs`.
- Test reference downloads into approved action directories, path-only large files in Codex/Hermes/DSH, legacy inline inputs and manifest descriptor hashing.
- Keep native image/text limits separate from the file transfer limit. Add output manifests to reference-enabled DSH turns while preserving session receipts.

### Task 3: Durable result delivery

- Update `src/daemon-action-delivery.mjs` and wire its transfer dependency in `daemon/ziwei_user.mjs`.
- Persist descriptors and upload checkpoints before transport. Build only reference-sized wire results.
- Test interrupted upload and response loss followed by recovery with the same action, original digest and one execution. Retain all original receipt-retry regressions.

### Task 4: Integration handoff

- Copy the backend-owned shared policy byte-for-byte after its export contract is available; do not edit backend/web/mobile files.
- Run focused transfer, runtime, delivery and preservation tests plus syntax/diff checks.
- Update `docs/FEATURE_MAP.md`, commit and push reviewable source. Parent coordinates backend/frontend integration and rollout; no production 500 MiB load test or model call in this task.
