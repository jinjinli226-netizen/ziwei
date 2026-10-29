# 新基线前端测试的已知失败

核对日期：2026-10-29。代码基线为 `8e4f37a`，父提交 `b0febd9` 仅保存基线对齐文档。本记录区分原基线失败、测试夹具修正和本轮 IME／滚动验证，不表示已部署或现网验收。

## 保留的五项失败

直接运行以下未修改的测试文件，结果为 **14 项，9 通过、5 失败**：

```powershell
node --test frontend/src/historical-prelaunch-recovery.test.mjs frontend/src/operator-force-abandon-recovery.test.mjs
```

| 测试位置 | 原测试名称 | 当前失败断言 |
| --- | --- | --- |
| `frontend/src/historical-prelaunch-recovery.test.mjs:51` | post-update holder proof cannot weaken the original-generation time rule or substitute a process-tree claim | `executionNeedsPolling(run)` 期望 `true`，实际 `false` |
| `frontend/src/historical-prelaunch-recovery.test.mjs:83` | generic flags, uncommitted events and receipts for another action cannot remove the original block | 同上 |
| `frontend/src/operator-force-abandon-recovery.test.mjs:52` | offline disposition requires exact absence observations and cannot borrow a holder exit or a generic offline flag | 同上 |
| `frontend/src/operator-force-abandon-recovery.test.mjs:89` | result flags and event bodies cannot stand in for independently projected abandonment metadata | 同上 |
| `frontend/src/operator-force-abandon-recovery.test.mjs:102` | another action, altered raw failure, wrong binding or a process-tree claim keeps the original uncertainty fenced | 同上 |

以上两个测试文件，以及它们涉及的 `historical-prelaunch-recovery.mjs`、`operator-force-abandon-recovery.mjs`、`bot-presentation.js`、`conversation-execution-state.mjs`、`src/bot-force-abandon-contract.mjs`，逐文件与 Git HEAD 比较一致（只归一化 CRLF/LF）。这五项失败不是本轮 IME／滚动改动造成的。

`343bfbea20d8ced38476f09023426c0fcc4f1a58` 已把失败／不确定执行的前台轮询改为直接结束：`executionNeedsPolling` 只对非不确定的 `pending`、`acked` 返回 `true`，不再等待归档 ACK。上述旧断言仍要求失败且不确定的执行继续轮询。拒绝伪造恢复凭证、保留不确定结果的前序断言仍通过，不能把这次失败解释为恢复凭证校验已失效。

同一提交规定：仅 `processAlive === true` 或 `processExit.activeProcesses > 0` 的明确进程证据保留执行位；失败终态、业务结果不确定和进程占位是独立判断。不能为了让旧轮询断言通过而恢复无限等待 ACK，也不能伪造进程退出或重放业务。本轮保留这五条断言及恢复实现，后续对齐测试语义应作为单独审查事项。

规则原说明：`docs/operations/2026-10-28-failed-execution-terminal.md`。

## 另外五项测试夹具修正

先使用 Git 原版 App 源码和原版测试在内存中运行，复现 **19 项中 14 通过、5 失败**；两个被测试 App 函数与原 HEAD 相同。随后仅补测试函数执行环境缺少的依赖，保留全部断言，不改发送、目录或刷新业务实现：

| 测试文件 | 涉及测试 | 缺失依赖与修正 |
| --- | --- | --- |
| `frontend/src/conversation-directory-inheritance.test.mjs` | actual new/open/refresh/send uses employee D through inheritance without persisting a fallback；a deliberate temporary directory survives refresh and is sent explicitly；a newer employee list cannot turn an unchanged displayed inherited directory into an explicit message override | 原夹具未绑定 `refreshBotChatFailureState`；补充普通员工无 Bot 失败状态时的空异步分支 |
| `frontend/src/conversation-message-races.test.mjs` | actual UI submit retains new conversation and new draft when an earlier response finishes；actual UI handles network retry with one client ID and preserves edits made while sending | 原夹具未绑定 `botBindingError`；补充无错误的 `{value:''}` |

它们是基线测试夹具遗漏，不是本轮新发现并修复的产品功能缺陷。修正后上述五项通过。

## 本轮验证范围

- IME／滚动及相关分页、附件、目录、绑定、发送竞态、失败发送门禁：11 个测试文件，**77／77 通过**。包含实际 Vue 组件 setup 和 App 滚动 watcher，覆盖 229、composition、500ms、40px／120px 边界、用户上滚、跳至最新、分页锚点与晚到图片。
- 全部 `frontend/src/**/*.test.mjs`：**479 项，474 通过、上述 5 项失败**；不能描述为前端全量通过。
- `npm run lint`：通过；`npm run build`：通过，保留既有主包超过 500kB 的提示；`git diff --check`：通过。
- 未启动业务服务、调用模型、部署网页或使用 Computer Use。
