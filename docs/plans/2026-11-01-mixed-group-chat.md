# Mixed Runtime Group Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one workspace group protocol that can contain Hermes, DSH, and Codex employees while preserving each runtime's profile, device, session, and execution isolation, and expose the same protocol to the web UI, CLI, and mobile manager.

**Architecture:** Keep DSH native groups and Hermes collaboration as runtime adapters behind a new workspace mixed-group coordinator. The coordinator owns the frozen roster, message/event history, per-member action references, and cancellation state; it fans out to DSH native group dispatch, Hermes collaboration dispatch, or Codex conversation actions and only reports terminal state from member receipts. CLI and mobile consume the coordinator's projection rather than reimplementing routing.

**Tech Stack:** Node.js ESM backend, SQLite repository, existing A2A/action dispatcher, Vue web frontend, workspace CLI contracts, mobile-manager web projection, Node test runner.

---

### Task 1: Define the mixed-group contract and failing backend tests

**Files:**
- Create: `backend/mixed-groups.mjs`
- Create: `backend/mixed-groups.test.mjs`
- Modify: `docs/FEATURE_MAP.md`

**Step 1: Write failing tests**

Cover a frozen roster with Hermes, DSH, and Codex members; runtime/profile/device validation; duplicate and ambiguous member rejection; @target/all routing; attachment limits; per-member result projection; partial/unknown status; and cancellation binding.

**Step 2: Run the focused test**

Run: `node --test backend/mixed-groups.test.mjs`

Expected: FAIL because the coordinator and contract do not exist.

**Step 3: Implement the contract only**

Implement normalization, roster freezing, mention parsing, member binding, event/result shapes, and cancellation validation without wiring dispatch yet.

**Step 4: Run the focused test**

Run: `node --test backend/mixed-groups.test.mjs`

Expected: PASS for pure contract behavior.

### Task 2: Wire repository and HTTP routes

**Files:**
- Modify: `backend/repository.mjs`
- Modify: `backend/app.mjs`
- Create: `backend/mixed-group-dispatch.mjs`
- Create: `backend/mixed-group-dispatch.test.mjs`

**Step 1: Write failing dispatch tests**

Use real repository fixtures to create a mixed group, fan out one message to all/mentions, verify each action has the exact employee/runtime/profile/device binding, and verify the parent action never becomes a member success. Cover workspace permissions and idempotency.

**Step 2: Run tests to verify failure**

Run: `node --test backend/mixed-group-dispatch.test.mjs`

Expected: FAIL on missing routes/dispatch.

**Step 3: Implement dispatch adapters**

Reuse existing Hermes `dispatchBotCollaboration`, DSH `dsh-native-group-dispatch`, and Codex `conversation.execute` creation. Persist group events and member action links. Add `groups.list/get/create/update/delete/send/cancel` routes under the workspace API without changing the DSH Hub `/api/groups` protocol.

**Step 4: Run tests to verify success**

Run: `node --test backend/mixed-group-dispatch.test.mjs backend/dsh-native-group-dispatch.test.mjs`

Expected: PASS with existing DSH behavior unchanged.

### Task 3: Add result aggregation, cancellation, history paging, and attachment projection

**Files:**
- Modify: `backend/mixed-group-dispatch.mjs`
- Modify: `backend/repository.mjs`
- Create: `backend/mixed-group-history.test.mjs`
- Modify: `backend/mobile-group-action.mjs`
- Modify: `backend/mobile-group-action.test.mjs`

**Step 1: Write failing tests**

Cover member result updates, unknown and partial parent states, per-member cancellation, paged history, and 300 large events projected below the mobile payload budget.

**Step 2: Run tests to verify failure**

Run: `node --test backend/mixed-group-history.test.mjs backend/mobile-group-action.test.mjs`

Expected: FAIL for missing mixed aggregation and oversized mobile projection.

**Step 3: Implement minimal aggregation/projection**

Persist only bounded summaries in list/detail projections, keep full history behind paging, retain attachment metadata with separate fetch references, and make cancellation issue one bound action per member.

**Step 4: Run tests to verify success**

Run: `node --test backend/mixed-group-history.test.mjs backend/mobile-group-action.test.mjs`

Expected: PASS.

### Task 4: Add web mixed-group UI and shared event rendering

**Files:**
- Create: `frontend/src/components/MixedGroupPanel.vue`
- Create: `frontend/src/mixed-group.js`
- Create: `frontend/src/mixed-group.test.mjs`
- Modify: `frontend/src/components/DshNativeManagement.vue`
- Modify: `frontend/src/components/BotWorkbench.vue`

**Step 1: Write failing UI/controller tests**

Cover mixed roster display, runtime badges, mention/all composer, per-member progress, unknown/partial status, cancel, history paging, and attachments.

**Step 2: Run tests to verify failure**

Run: `node --test frontend/src/mixed-group.test.mjs`

Expected: FAIL because the shared panel/controller does not exist.

**Step 3: Implement the panel and controller**

Use the workspace mixed-group routes, preserve DSH native groups as a separate native section, and render member results from real action references.

**Step 4: Run tests and build**

Run: `node --test frontend/src/mixed-group.test.mjs frontend/src/dsh-groups.test.mjs && npm run build`

Expected: PASS and production frontend build succeeds.

### Task 5: Synchronize CLI contract and mobile manager

**Files:**
- Modify: `packages/workspace-cli/src/registry.mjs`
- Modify: `packages/workspace-cli/src/vendor/native-schemas.mjs`
- Create: `packages/workspace-cli/test/mixed-groups.test.mjs`
- Modify: `mobile-manager/web/api.js`
- Modify: `mobile-manager/web/controller.js`
- Modify: `mobile-manager/web/mobile-groups.js`
- Modify: `mobile-manager/web/mobile-groups-view.js`
- Create: `mobile-manager/test/mixed-groups.test.mjs`

**Step 1: Write failing CLI/mobile tests**

Cover the shared member descriptor (`runtime`, `employeeId`, `profile`, `deviceId`, `conversationId`, `sessionId`), mixed send/cancel requests, and bounded mobile projections.

**Step 2: Run tests to verify failure**

Run: `node --test packages/workspace-cli/test/mixed-groups.test.mjs mobile-manager/test/mixed-groups.test.mjs`

Expected: FAIL because current clients assume Hermes-only collaboration.

**Step 3: Implement projection and submission support**

Keep routing server-side; CLI/mobile only validate and render the shared protocol. Preserve existing mobile pagination and fix the large-history projection regression.

**Step 4: Run tests to verify success**

Run: `node --test packages/workspace-cli/test/mixed-groups.test.mjs mobile-manager/test/mixed-groups.test.mjs backend/mobile-group-action.test.mjs`

Expected: PASS.

### Task 6: Regression, documentation, deployment, and live acceptance

**Files:**
- Modify: `docs/FEATURE_MAP.md`
- Create: `docs/operations/2026-11-01-mixed-group-chat.md`

**Step 1: Run the full affected suite**

Run: `node --test backend/mixed-groups*.test.mjs backend/dsh-native-group*.test.mjs test/dsh-native-group*.test.mjs test/hermes-driver-runtime.test.mjs frontend/src/mixed-group.test.mjs packages/workspace-cli/test/mixed-groups.test.mjs mobile-manager/test/mixed-groups.test.mjs backend/mobile-group-action.test.mjs`

Expected: all tests pass.

**Step 2: Run repository checks**

Run: `npm run lint && npm run build && git diff --check`

Expected: all checks pass.

**Step 3: Commit and push**

Commit the mixed-group changes without staging the user's existing mobile-manager work unrelated to this feature. Push the branch and build the CLI candidate from the pushed commit.

**Step 4: Deploy through official paths**

Deploy the API/web source, install the CLI through the official updater, and update mobile artifacts only through the existing mobile release path. Do not edit production SQLite or action journals manually.

**Step 5: Live acceptance**

Verify API health, CLI readyz, DSH Hub readiness, mixed group create/list/send/cancel, per-member receipts for Hermes/DSH/Codex, and mobile bounded projection. Record the commit, package hash, build, PID, and remaining diagnostics.
