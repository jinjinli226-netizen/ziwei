# E03 Profile creation and focused main chat implementation plan

**Goal:** Restore direct independent Hermes Profile creation in the Bot dialog, then implement the user-approved focused main chat.

**Architecture:** Reuse the existing profile request API, official device action executor/delivery and actual profile discovery. A scoped frontend request controller retains only request metadata across navigation/reload. The later chat shell reuses the same Bot employee and main conversation, with route-specific chrome and CSS.

**Tech stack:** Vue, existing product HTTP API, Node tests, headless Playwright, installed Hermes with owned loopback provider.

User authorization and visual direction are already explicit. No additional design approval is needed. Work occurs in the managed `v2-e03-profile-chat` tree because the old full-ui tree is the live Vite source under Q review. Do not update or stop that preview until coordinator confirms its checkpoint.

1. Reproduce missing new-Profile input in the existing built UI before edits. Add scoped controller tests for one action, known-action polling, same-key response-loss recovery, metadata-only refresh recovery, device/workspace navigation, default/invalid/offline and failed/discovery-pending handling.
2. Add explicit workspace arguments to existing frontend API methods, preserving old callers. Provide new/existing choices in BotWorkbench; new names go through the original profile action. Freeze workspace/device/name and deterministic initial SOUL per request; keep Bot persona/role in the existing Bot draft. A successful action and actual discovery/readiness remain separate checks.
3. Extend only isolated native-preview profile requests and owned source-profile policy. Use official profile executor and actual file-based discovery after delivery; synthetic devices continue to fail profile creation. Prove creation, discovery, selection, one employee/main chat, repeated queries, conflict/non-overwrite and default source preservation in a temporary HOME/product API. Commit this fix separately.
4. Read the approved reference image and current conversation flow. Add a route-specific focused Bot chat shell without changing ordinary Inbox behavior, backend data or bindings. Keep real directory inspection, attachments, streaming, stops and unknown receipts.
5. Verify desktop and 390px inner containers/composer/popovers, URL/refresh/back/return paths, same employee/conversation, real UI affordances and local times. Run required regressions, commit separately and hand off precise SHA/receipts/screenshots. The one persistent preview retains 5283/4283 and all state; no second long-lived preview, formal service or device actions.
