# E03 focused Bot main chat

2026-10-13, Asia/Shanghai. Base profile fix `882b92a6df0a8e064113367a818bec30495696af`; Profile dialog reentry fix `bbe457e8c58d0d7827ba6eb34dbbe0f6af0c0c46`. Managed worktree `C:\Users\25941\.codex\worktrees\v2-e03-profile-chat\灵光爸爸拆解`, branch `codex/v2-e03-profile-chat`.

## Result and scope

The two existing Bot chat buttons continue to open the same employee and existing `main_conversation_id`. A verified main-chat route now uses a focused light interface: compact avatar/name/state header, wide conversation, fixed composer, small model/computer/directory controls and a collapsible work drawer. Website topbar/sidebar, ordinary Inbox lists and global floating launchers are absent. Return, Bot settings, Routine and original run/control remain reachable in the same browser window; no fullscreen API or new conversation/data is introduced.

Focus requires the actual workspace/Bot/employee/main-conversation response. A pending entry renders only a loading shell. Query parameters alone do not authorize the focused content. Direct URL, refresh, back/forward and return were tested; ordinary `/inbox` and a forged Bot query retain ordinary navigation. CSS and shell flags apply only to this verified route.

Directory uses the original real inspector and save path. Actual testing exposed two existing integration omissions: WorkdirPicker did not send Bot revision/controlEpoch, and repeated chat metadata refresh cleared the trusted binding, invalidating an otherwise successful directory check. The picker now sends the existing required fields and invalidates on real version changes; same-scope metadata refresh retains the previous trusted binding during the read. The directory save changes only the current conversation path and preserves runtime/profile/model/device binding.

Original composer state, message API, uploads, preview/download, stream updates, original stop operation and unknown-result gates are reused. Execution details are compact and expandable; times explicitly use Asia/Shanghai. The work drawer reads real Bot runs/Routines/tasks and actual conversation attachments. It does not create report/task/file samples from the reference image. At narrow widths the drawer starts closed, internal widths shrink, and model/device/more popovers are clamped to the viewport.

The Bot configuration and chat's more menu expose the existing `PhoneSkillSetup` entry with the same real employee/workspace. **Phone admission/profile rules are unchanged and remain paused at the user's request.** Preview entries are disabled with an explicit unavailable message; no phone business action, fabricated online state or new runtime binding is introduced. Named source Profile creation is optional and separate from the per-Bot private HOME initialized on validation/run. The first fix adds the explicit named-Profile API flow, not a claim that `createBot` automatically registers a named Hermes Profile.

## Verification

- Before implementation, built-UI reproduction failed because global navigation remained present. `.local/e03-chat-red.log`.
- Latest actual product UI/API/official worker/installed Hermes combined acceptance: **12/12**, `.local/e03-profile-native-1791868434861/receipt.json`, `cleanup.json`. All cleanup checks passed, source config/auth/.env unchanged, console page errors 0, external account calls 0. Model provider is an owned loopback test service.
- Actual tests cover both entries and same employee/main ID; URL/reload/back/forward; ordinary Inbox/forged query; real directory inspection/save; Shift+Enter and Enter; image upload/preview/download; installed Hermes reply; 390px inner timeline/composer/editor/chips and all popover bounds; real held-model stop with root/tree confirmed and activeProcesses:0.
- Real screenshots: same evidence directory `profile-new-desktop.png`, `profile-selected-desktop.png`, `main-chat-desktop.png`, `main-chat-mobile.png`. They contain only the test's actual messages and local-provider output.
- Synthetic browser regression: original interface **15/15**, native panels **21/21**, no page errors. Fixtures are marked and do not prove real providers. Latest real flow above separately proves execution.
- Whole-repository regression after Profile reentry fix: `node --test --test-concurrency=4`, **857/857**, zero failures/cancellations/skips, **68.79 seconds**; final log `.local/e03-profile-chat-full-final.log`. The earlier complete run was **856/856**, zero failures/skips, 68.67 seconds, before the one added reentry test.
- Build **1785 modules**, lint **114 source files**, diff check pass. Existing main chunk warning is about 508kB.

Earlier harness selector/setup failures and directory failures remain in `.local` and are not counted as passing. Directory inspection returned actual success before the binding-refresh invalidation was corrected; the final successful UI readback/save is the acceptance evidence.

## Persistent preview update

The coordinator supplied Q's safe checkpoint. Update uses only the one existing 5283/4283 preview, with fresh commandline/PID/port/pending checks, a consistent SQLite backup and original state-root preservation. State root remains `C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview`; private HOME/auth/objects/journals/logs stay there. Final instance and fresh health are recorded in the machine handoff after update.

The update is now complete. Instance `2026-10-13T05-30-54-291Z-968`, Shanghai **13:30:54**, runs candidate `beac160a030c2385d1bbe51378915085ada80165` from this managed tree. Supervisor PID968, API PID15152, Vite PID47680, `windows-independent`. Fresh current-health proof executes actual native memory read at version0.21.3 with root/tree confirmed; both HTTP endpoints return200. Supervisor and API logs continue appending 15-second health/heartbeat records. The old instance50996 has recorded ended/exits and remains in history.

Before update, pending/acked was empty and a consistent full SQLite backup was saved at `stateRoot/backups/before-profile-chat-1791869354705.sqlite`. The old baseline2 employees/14 conversations/22 messages and account fields were reverified after update. All additional current rows remain in the same original SQLite; only the code root changed. Original opaque encryption key, objects, access credentials, native HOME, journals/outbox, instances and logs remain in their existing paths. Registry ID498622e5bdf9d880 and original ports/cwd are retained; note now identifies this code tree and actual diagnostic paths/status.

The updated persistent Vite page was separately inspected at desktop and390px: direct new-Profile input and actual native-device create button are enabled; the existing seed Bot's same main conversation uses the focused shell with website navigation absent. Inner containers have zero measured horizontal overflow and page errors are0. Screenshots and `.local/e03-native-preview-evidence/live-profile-chat-layout.json` record this live inspection. It did not submit profile creation or add employees/messages to user data; real creation/execution proof remains the isolated12-case acceptance above.

Runtime backend remains the prior integrated `7db1d8e` until a separate clean E02 patch is supplied. Q's known Slack receive-health issue is not claimed fixed here; external Gateway listeners remain closed in this preview. Formal services, database, domain, clients and phones are outside this update.
