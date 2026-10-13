# E03 owned Profile frontend candidate

This candidate connects the E02 published owned-profile API shape. It is a frontend candidate, not yet proof of installed-Hermes owned provisioning or an updated persistent preview. The stable E02 implementation must be cherry-picked and checked before either claim.

The ordinary create dialog now submits one Bot request with an initialization `sourceProfile`. The service chooses the dedicated name and device resolves HOME. The dialog collects only name, computer and advanced source/model/visibility; role/persona remain editable on the same Bot after provisioning. This makes response-loss recovery deterministic without storing private role text.

The create controller retains original identifiers, key and `defaultsVersion:1`, namespaced by API base and actor. Version 1 defaults remain fixed independently of later editor defaults. A known Bot is queried with GET; unknown acceptance reuses exactly the same create body/key. Initial HTTP 408 remains unknown. Same-workspace wrong Bot/employee responses are rejected before changing the saved identity. Closing/reentry, actor and workspace changes cannot transfer a late result.

`BotInstancePanel` presents the confirmed dedicated Profile/HOME, initialization source, original provisioning action and failure/unknown recovery. Queue acceptance and unconfirmed HOME are not called ready. Actual device discovery is checked separately from receipt authentication (`configured`, `required`, `source_reference`). Source-reference copy explicitly says OAuth is read-only and requires source reauthorization after expiry. The existing validate/activate sequence is available as one explicit button. Legacy source + private-instance mode stays labelled and keeps original state.

The focused main chat keeps its same employee/conversation, composer and execution controls. An owned Bot without confirmed provisioning, model-auth evidence, activation or current validation retains draft text and blocks Enter/button sends with a settings link. The existing legacy path remains. Owned instance labels say dedicated Profile rather than source Profile. Native resource panels remain closed until owned provisioning is confirmed.

## Verification before the frontend commit

- Meaningful red UI reproduction: `.local/e03-owned-ui-red.log` reports `1 !== 0` for the old manually chosen owned-name field; fixed UI passes the new one-request flow.
- Owned request/status/admission, Bot API/main-chat/workbench/native frontend selection: 77/77, no failure/skip/cancel; `.local/e03-owned-focused-node.log`.
- New browser contract fixture: 6/6, including confirmed HOME versus missing discovery/auth, explicit failed recovery, uncertain read-only recovery, dropped accepted response plus full reload, blocked pending main chat, and 390px inner-container bounds; `.local/e03-owned-ui/receipt.json`.
- Existing browser UI + focused-chat fixture: 15/15; existing native-panel browser fixture: 21/21. No page errors. Their receipts are under `.local/e03-ui-evidence` and `.local/e03-native-ui-evidence`.
- Build passed, 1787 modules; existing >500kB main chunk warning remains. Lint checked 117 source files, `git diff --check` passed.
- Additional red/green recovery evidence covers HTTP 408, wrong same-workspace identity, API-origin namespace and default-version fencing. Logs are `.local/e03-owned-recovery-red.log` and `.local/e03-owned-origin-red.log`.

Browser responses are explicit fixtures; their displayed HOME values are fixture values. Desktop and 390px screenshots were inspected. They do not prove native resolver HOME equality or a real model turn. The inherited Gateway native health patch remains integrated and independently verified (16+9 native tests) at `850431c`.

## Remaining first-chain integration

Pick E02 stable owned-profile SHA, check its final authentication/status and recovery contract, extend only the native-preview provision allowlist/binding policy, then run actual product UI in a fresh temporary HOME with installed Hermes. Verify two named Profiles, native resolver HOME equals actual first-run HOME, same-key replay/reload and rename preserve Bot/main chat/state, and a bounded local test-provider message returns in the same conversation. Perform the final composed regression once, then update the one persistent preview with original stateRoot and preservation proof.

Working source is `C:\Users\25941\.codex\worktrees\v2-e03-owned-profile\灵光爸爸拆解`, branch `codex/v2-e03-owned-profile`. The earlier source at `v2-e03-profile-chat` stays unchanged for the current 5283/4283 preview. No new long-lived preview, formal services, real phone actions, push, merge or deployment were performed. Phone composition remains a later backend/frontend patch and is not claimed here.
