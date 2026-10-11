# Conversation Images Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用户和数字员工在同一持久会话可靠收发真实图片附件，并发布经验证的服务与 Windows 客户端。

**Architecture:** 保留消息 Base64 存储，增加显式 `outputArtifacts` 回传。客户端按执行隔离目录读取清单，服务器按 action 归属落消息，浏览器按会话隔离草稿与异步回调。

**Tech Stack:** Node.js、SQLite、Express、Vue、原生 Codex/Hermes CLI、Playwright、现有 SSH/systemd 发布流程。

---

### Task 1: 后端消息与输出归属

**Files:** Modify `backend/repository.mjs`、必要的 `backend/app.mjs`; Create backend 图片验证 helper 与 `backend/conversation-images.test.mjs`。

1. 先写纯图片 dispatch、错误不落库、clientMessageId 重试幂等、可信 action 回图与输入不回显的测试；运行 `node --test backend/conversation-images.test.mjs`，确认预期失败。
2. 实现图片魔数/类型/大小验证，在写入前建立有效执行载荷；持久化客户端消息 ID 并复用相同请求，冲突报错。
3. 只解析 `result.outputArtifacts`，完整验证后写 assistant 图文；错误状态可见，重复 result 不写重复回复。
4. 重跑相关后端测试，必须全部通过；审查工作区、员工、设备归属。

### Task 2: Windows 原生输入与输出

**Files:** Modify `src/runtime-adapters.mjs`、`src/local-action.mjs`; Create `src/conversation-image-artifacts.mjs` 及相应测试。

1. 先写清单隔离、跨路径/链接拒绝、类型和总量限制、输出/输入区分、能力拒绝测试，运行相关 `node --test` 命令确认失败。
2. 读取实际 CLI 帮助与入口；将支持的图片传入原生视觉参数，不支持组合给具体错误。
3. 建立每执行独立输出目录，注入清单指令，验证显式文件并生成 `outputArtifacts`；清单错误使执行失败。
4. 重跑相关测试，准备合法真实 CLI 图像测试，记录 runtime/model/识图与回图结果。

### Task 3: 会话编辑器与预览

**Files:** Modify `frontend/src/App.vue`、`frontend/src/styles.css`; Create `frontend/src/conversation-compose.js` 与测试。

1. 先测试重复发送、重试 ID、延迟发送/文件读取切会话、发送后新草稿保留，运行 `node --test frontend/src/conversation-compose.test.mjs` 确认失败。
2. 实现会话草稿状态、同步发送锁和修订检查；限定图片格式/合计 10 MiB，读失败保留原草稿。
3. 添加按比例缩略图、大图模态窗口、文件下载与上传/发送错误；从消息附件恢复。
4. 测试通过后运行 `npm run build`、`npm run lint` 与适当项目测试。

### Task 4: 真链路验收与发布

**Files:** Private evidence `.local/conversation-images/`; Modify `PROJECT_MANAGEMENT.md`; Create release 验收记录。

1. 浏览器真实桌面/窄屏覆盖图文、纯图、员工回图、预览/下载/刷新、失败重试与切会话；验证普通聊天不新增任务。
2. 真实 Windows 支持 CLI 至少一次合法识图并回传图片。客户端更新若需重启，使用现有安全维护流程并验证正式连接完整。
3. 审查最终 diff，运行必要测试并记录结果；只提交本次改动，推送当前授权分支。
4. 先备份，沿现有流程部署主 API/静态/官方 Windows 包，保留旧资源，验证域名、实际版本与 hash。
5. 精确清理本次 QA 对象并检查正式资源保护；更新项目管理与发布证据，明确任何剩余边界。

本会话使用 subagent-driven-development 连续执行，文件分工避免冲突；实现者测试后由 root 复核规格和代码质量。用户已经授权执行与发布，不再次请求相同许可。
