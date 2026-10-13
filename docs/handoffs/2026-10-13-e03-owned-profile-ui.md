# E03 owned Profile frontend candidate

The owned-profile first chain is now integrated, tested with installed Hermes and the local protocol provider, and running in the one persistent preview. Real external provider acceptance is still required by the user before any launch claim.

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

## Composed implementation and native proof

E02 stable implementation `96559f8eb1df9292e8d264daaa80a0d584408616` was picked as `8825abd`, after its plan dependency was picked as `5710e3b`. Final contract: `docs/contracts/2026-10-13-hermes-owned-profile-api.md`. UI filters owned Profiles from initialization sources and treats authentication as an opening-time snapshot. A fresh validate is possible after source credentials are repaired; successful current validation supersedes the snapshot. Readonly OAuth expiry is shown using `authMode:source-native-store`.

`node frontend/verification/bot-owned-native.mjs` passed 6 actual product UI/API tests with installed Hermes 0.21.3: `.local/e03-owned-native-1791875423626/receipt.json`. Two named Profiles were created by real Windows Job actions. The first main-chat model action confirmed `botIsolation.home === botIsolation.profileHome === instance.home` and a native session ID. Reload, 390px chat, rename, native memory isolation and lost-response recovery all preserved the original identity. Source config/auth/.env hashes remained unchanged. Adjacent `cleanup.json` confirms closure with no errors.

Native policy initially expected a redundant top-level workspace field; the actual product carries workspace in the trusted Bot snapshot. The policy now checks that snapshot and rejects contradictory optional values. The native layout creates a blank `.env` scaffold, so verification checks that source test values were not copied. Initial failed runs remain on disk and are not counted as passing evidence.

Final composed Node regression: **886/886**, no failure/cancel/skip, 74.0834487 seconds: `.local/e03-owned-full-node.log`. Focused backend/native-preview tests: 25/25. Browser fixtures: 6 owned, 15 ordinary/focused and 21 native-panel. The only actual model provider tested so far is the loopback protocol provider.

## Required real-provider acceptance

The user requires one run against their already configured real provider before any launch claim. Q01 owns that next acceptance after this execution line finishes. This candidate is not yet real-provider accepted or authorized for deployment.

The full candidate code is in the E03 owned-profile tree. Entry points: `createApp` in `backend/app.mjs`, `createLocalActionExecutor` in `src/local-action.mjs`, and the official dispatcher/delivery. Identity/provisioning: `backend/bots.mjs` and `backend/bot-profiles.mjs`. Native layout: `src/hermes-owned-profile.mjs` and `.py`. HOME binding and source authentication reference: `src/hermes-bot-runtime.mjs`. Readonly OAuth and actual HOME confirmation: `src/hermes-mcp-bootstrap.py`. The UI native harness demonstrates the complete create/validate/activate/chat/reload sequence, but its provider/socket guard intentionally remains loopback-only.

E03 actually discovered only `custom:preview-local`, model `preview-local-model`, at its own temporary API. The user's real source Profile, provider host/model and auth store have not been inspected by E03 and must be discovered by Q01 under the new minimal-call authorization. Send only synthetic test text, keep secrets out of receipts/logs, preserve source auth bytes, and allow only the selected provider domain plus owned API endpoints. Expired OAuth or missing source is a real failure; do not substitute the loopback provider.

## Persistent preview and Q handoff

Working source is `C:\Users\25941\.codex\worktrees\v2-e03-owned-profile\灵光爸爸拆解`, branch `codex/v2-e03-owned-profile`. Backend running candidate is `4594d1b9bd5f1790cd206c54766d43fbf0912c9c`; the later documentation commit does not require another restart. E02 implementation source `96559f8` is included as `8825abd`; Gateway source `427da412` is included as `850431c`. The machine handoff `.local/e03-owned-profile-handoff.json` records the final HEAD and all proof paths.

On 2026-10-13 15:17 the original owned API process was stopped only after fresh health/PID/parent/listener checks and zero unfinished/unknown actions. Its supervisor logged both children exiting. Original stateRoot remains `C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview`; consistent backup is `backups/before-owned-profile-1791875766436.sqlite`. New native supervisor entry `frontend/preview/launch-windows.ps1` reused this exact stateRoot and ports 5283/4283.

Current instance: `2026-10-13T07-17-33-644Z-8908`, supervisor 8908, API 31840, Vite 54608, `windows-independent`. Real HTTP and command-line/parent observations confirmed these owners. Independent supervisor and business logs append every 15 seconds under the original `logs` directory. The port registry record remains `498622e5bdf9d880` under its original owning cwd; its note now records actual logs and the pending real-provider gate.

After-update native memory read succeeded with Hermes 0.21.3 and root/tree exit evidence. Preservation verified the original 2 employees, 14 conversations, 22 messages and 1 user; account authentication fields are unchanged, only normal login timestamp changes are permitted. The live create entry is enabled, server-generated naming is shown, and 390px create/main chat fit. Capture did not submit another live Bot, change the seed main chat or create a fake demonstration task. Live proof: `.local/e03-native-preview-evidence/current-health.json`, `preservation.json` and `live-owned-layout.json`.

URL: `http://127.0.0.1:5283/preview-bots/bots`. The original seed Bot/main chat remain available, honestly labelled legacy source + private instance. New creations use owned Profile/HOME. No second long-lived preview, formal server change, real phone actions, push, merge or deployment occurred; external exits and automatic Routine scheduling remain disabled in this preview. Phone composition is a later task.

Latest user model constraint for Q01: **gpt-6.1-sol, reasoning ultra**. Verify exact provider model ID and whether ultra is supported and actually sent; the coding-agent setting does not prove the Bot setting. The current local-test model is `preview-local-model` and does not satisfy this constraint. Missing real source configuration, expired OAuth or unsupported model/effort must be reported honestly, with no silent model/provider substitution.
