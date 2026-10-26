# Employee capability inventory implementation plan

**Goal:** Extend the existing employee capability and knowledge panels with truthful, scoped Skill, MCP and business CLI metadata.

**Architecture:** Reuse employee identity, existing A2A actions and native configuration entry points. A dedicated read-only inspection collects bounded metadata without importing runtimes or invoking models. Persist snapshots in existing action receipts, bind them to workspace/employee/device/runtime/profile/configuration fingerprint and reject late or mismatched evidence. GET and overview render cached evidence; explicit refresh coalesces a bounded inspection. Machine installation, employee visibility, authorization and actual loading remain separate states.

**Tech stack:** Node ESM, existing SQLite repository/action queue, Vue 3, node:test.

The user supplied the implementation scope and explicitly requested parallel implementation and independent review. No homepage redesign, service launch, installation, production publish, client upgrade or Hermes version investigation is included.

## 1. Client collector

- Add `src/employee-capability-inventory.mjs` and `test/employee-capability-inventory.test.mjs`.
- Read only trusted runtime HOME/cwd and registered installation metadata. Read bounded Skill metadata, no full body in receipts. Do not execute unknown binaries. Never return environment, credentials or credential-bearing URLs.
- Cover two profiles with same names, absent/unreadable roots, unsupported runtime, shared installation with different authorization, bounded data and secret redaction.
- Command: `node --test test/employee-capability-inventory.test.mjs`.

## 2. Platform snapshots

- Add `backend/employee-capability-inventory.mjs` and its test.
- Reuse repository visibility/ownership checks and persistent A2A receipts. Refresh creates only `employee.capabilities.inspect`, with immutable subject and configuration digest. Duplicate current refreshes coalesce; stale, offline, old-client, timeout and revoked access remain explicit.
- Cover permission boundaries, bindings, config changes, late receipts, duplicate refresh and cached GET without actions.
- Command: `node --test backend/employee-capability-inventory.test.mjs`.

## 3. Existing frontend panels

- Extend `BotWorkbench.vue`, `BotKnowledgePanel.vue`, `BotMcpPanel.vue` and add a reusable inventory panel/controller with focused tests.
- Use existing employee selection and settings routes for mixed runtime employees; do not initialize Hermes to display inventory. Fetch only the selected detail, fence delayed replies by complete subject and generation. Show unknown instead of empty when no successful directory read exists.
- Add API methods and minimal App wiring only if necessary for the existing employee detail.
- Preserve native configuration/install/connect/authorize entry points; describe state and point to the applicable next step.

## 4. Integration and capability status

- Integrate service routes in `backend/app.mjs`, inspection dispatch in `src/local-action.mjs` and advertise support in `daemon/ziwei_user.mjs`.
- Preserve the existing execution admission guard. Capability cards gain saved/observed status and current runtime barrier without overwriting saved or historical success.
- Write regression tests before changes to guard display status and non-model dispatch behavior.

## 5. Verification and delivery

- Run focused node tests, lint and frontend build; inspect the resulting UI using a controlled preview only under port-manager rules (or an artifact-only harness where no listener is needed).
- Independent review checks specification first, then security/code quality. Fix findings and rerun affected checks.
- Update `docs/FEATURE_MAP.md` and operational documentation with exact evidence boundaries. Read-only target-computer acceptance must distinguish currently installed client support from candidate collector results.
- Commit and push source, verify remote SHA. Production release and real client upgrade remain separate authorization steps.
