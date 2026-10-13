# E03 direct Profile creation fix

2026-10-13, Asia/Shanghai. Base `06c507b8f20b34e2dbe213ef0c9b1763433c52c9`; managed worktree `C:\Users\25941\.codex\worktrees\v2-e03-profile-chat\灵光爸爸拆解`, branch `codex/v2-e03-profile-chat`. This is the first, separately reviewable fix; focused main chat follows it.

## Cause and behavior

The existing Team form can create a named Hermes Profile through the original API and device action. BotWorkbench omitted that entry and exposed only discovered profiles. The isolated native-preview worker also rejected profile actions and reported only `default`.

The Bot dialog now defaults to **new independent Profile**, with an editable name and the existing device creation API. **Use existing Profile** preserves the prior selection path. After a successful original action, the controller reads profiles and management discovery for that exact workspace/device, then selects the name. A successful file creation does not imply provider readiness: Bot creation remains guarded by real discovery/readiness, then configuration validation and activation.

The request freezes workspace/device/name and deterministic initial `# name` SOUL. Persona and role remain in the Bot's existing draft and overlay. Provider/config/auth inheritance stays inside the official device executor; the frontend never reads keys. Existing Team callers are compatible, with optional explicit workspace parameters added to the three frontend API methods.

Request recovery is scoped by account, workspace and device. Storage contains only name, original request key, action ID and phase. A known action is queried via GET. If the first response was lost, the exact same deterministic body and request key use the existing API's dedupe to recover the original action; this is not a new creation intent. Pending, unknown and discovery-pending requests remain fenced. A changed device/workspace, closed dialog or refreshed module cannot let a late response select a profile in another scope. Definitive first-request rejection and known terminal failure are shown separately; a later admission rejection cannot discard an earlier unresolved request.

## Evidence

- Before edits, actual built UI browser reproduction failed `0 !== 1`: no direct new-profile input even with an online device and no existing profiles. `.local/e03-profile-red.log`, `.local/e03-profile-ui/before.png`.
- Targeted existing/new Node checks: **34/34**; `.local/e03-profile-targeted.log`. Includes 11 scoped request tests, explicit API workspace/old-call compatibility, workbench, original profile action/non-overwrite tests and isolated preview policy.
- Synthetic UI flow: passes; `.local/e03-profile-ui/result.json`. It proves wiring only.
- **Actual UI/product API/official worker/file discovery/installed Hermes: 6/6**; `.local/e03-profile-native-1791864408323/receipt.json`, `cleanup.json`. The UI writes an independent `actual-direct` Profile, receives the true action result, discovers/selects it, creates exactly one employee and its main conversation, and successfully executes native memory read on that profile with a confirmed Windows execution tree.
- Actual same-name/different-SOUL request fails without overwrite. Known repeated GETs create no action. A real HTTP response is deliberately dropped after server acceptance; fresh-page recovery uses the same original key, with one action and one directory. Default and offline requests reject in the original product API. Source config/auth/.env hashes remain unchanged.
- Actual screenshots: same directory `profile-new-desktop.png`, `profile-selected-desktop.png`. Console page errors: 0.
- Build **1782 modules** and lint **111 source files** pass; prior ~502kB main chunk warning remains. Whole-repository regression will be run after the separate focused-chat implementation, without treating these targeted checks as full regression.

The actual harness uses a transient loopback server, an in-memory product DB and a newly created local HOME. It uses the installed Hermes and local test provider, does not read the persistent preview or formal HOME, and closes its server/browser/worker before writing passed evidence. Historical dispatcher started entries are retained by design; cleanup checks each has a matching known completed receipt and native trees are confirmed, rather than mistaking history for running work. Harness setup/cleanup failures are retained in earlier evidence folders and are not counted as passing.

## Preview boundary

Only native-preview Profile API paths are added. Profile actions must match its exact native device/workspace, cannot use default, and remain under the owned source HOME. Bot source profiles must exist under that same HOME; path resolution rejects escapes. Real `listHermesProfiles` updates metadata after the official delivery success and each heartbeat. Synthetic devices still reject this action through the existing fixture worker; no success is fabricated. Arbitrary stdio, external sockets, external Gateway listeners and formal account/device use remain closed.

The original full-ui tree and current 5283/4283 instance have not been changed by this commit. The coordinator has now supplied Q's safe checkpoint; update will follow both authorized frontend fixes and fresh process/port/pending/data checks. Persistent state remains `C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview`.
