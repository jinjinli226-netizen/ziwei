# V2 data-preserving rollback candidate

This is an isolated implementation and rehearsal. It does not authorize a production switch.

## Frozen inputs

- V2 product: `5643d5d36c3cd85d74ab849c77f52b6f69555093`.
- V1 API/frontend protection baseline: `2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b` (verified equal to the published API/frontend layers).
- V1 public client source: `324731e79c6a855fad1f501379630bbfa67e5d34`.
- Candidate branch: `codex/v2-data-preserving-rollback`.

## Contract and implementation

1. `backend/version-preservation.mjs` owns persistent transition intent, exact object snapshots, and a repository guard. Its classifier reads stored Bot identities and relationships, including owned profiles, original action links, remote members, Routine runs and Gateway inbox. V1 compatibility always blocks these identities. Plain V1 employees and Creator retain their native routes.
2. `preparing` freezes new V2 writes/dispatch before inspection. `sealed` is committed only after all original queues and native evidence are safe. Failure leaves an explicit frozen operation. Retrying the same operation is idempotent; a different operation cannot replace it. No whole-DB restore or HOME/auth copying occurs.
3. Native evidence inspection reads the actual client journals and Bot lifecycle files. Pending, ACKed, uncertain, corrupt, unsent results, unknown process trees, resident Gateway workers and unresolved remote member actions reject sealing. No queue expiry or journal cleanup counts as drain.
4. V2 restoration preserves identity, profile binding, HOME, chats, memory and results. Bot and Routine controls remain paused. Explicit versioned resume schedules future work and never replays old actions or missed ticks.
5. `scripts/build-preservation-packages.mjs` exports exact local Git baselines, applies the shared guard and native admission protections, builds frontend and packs clients offline. Manifests distinguish product V1/V2 from npm version and identify every source/overlay/artifact hash.
6. `scripts/v2-preservation.mjs` defaults to read-only inspection/planning. Mutations require explicit operation, DB and isolated root. Native entries remain the original server/client entry points. Local diagnostics persist startup, PID, heartbeat and exit plus an independent observer.
7. A disk-backed, process-backed V1 → V2 → V1 compatibility → V2 rehearsal uses one DB and private HOME fixtures, loopback test execution, authenticated HTTP/MCP, and native client journals. Before/after row and file hashes and failures are retained. No paid provider request or installed Hermes mutation is needed.
8. Q01 rejected candidate `8556aec` for the asynchronous Profile junction window. Both exports now capture one canonical HOME before bootstrap, use it throughout adapter preparation, recheck after the last await at spawn, and bind the execution-scoped native selector to the same HOME while retaining native validation and source auth. Preserve old RED and new GREEN receipts separately. Packaged barrier fixtures use controlled admission/bootstrap responses; they are not evidence for the real server admission chain. Q01 must independently accept the new clean candidate before release is considered.

## Verification sequence

- Add failing tests for trusted classification, every write boundary, failed preparation, idempotence and legacy preservation; run them before implementation.
- Implement and run relevant existing repository, API, A2A, automation, owned profile, delivery and lifecycle tests.
- Produce packages and perform the four-phase rehearsal using registered isolated ports and append-only diagnostics.
- Freeze candidate SHA/contract for Q01 independent QA; address findings in this writer tree only.
- Deliver manifests, logs, field/file preservation evidence, backup/switch manual, stable SHA and explicit remaining limits. Never report production readiness from a local rehearsal alone.

## Protected boundaries

Do not edit original dirty checkout, E03 preview, V1 recovery tree, existing services, installed clients, actual DB/auth/HOMEs, proxy/domain/ports or phones. Do not push, merge, deploy, restart existing services, install globally or call external model providers. Read-only audit agents may inspect source; this E02 tree is the sole writer.
