# 新 AI 会话接手提示词

把新会话的工作目录设为：

```text
D:\灵光爸爸拆解
```

然后直接发送下面的提示词：

```text
你现在接手的是本地项目：D:\灵光爸爸拆解。

这是一个 Vue 3 + Vite 前端、Express + SQLite 后端、以及本机 ziwei_user daemon 组成的智能工作区项目。请先理解项目，再开始修改，禁止凭截图或历史聊天猜测状态。

请按这个顺序执行：

1. 阅读 PROJECT_MANAGEMENT.md，它是当前唯一维护入口。
2. 阅读 README.md 和 HANDOFF.md，了解启动方式、历史变更和明确延期项。
3. 如果存在 AGENTS.md，读取其中的项目约束。
4. 执行 git status --short。工作区已有修改不要 reset、clean、checkout 覆盖或删除。
5. 检查本地代码服务：
   - 前端 http://127.0.0.1:5178
   - 后端 http://127.0.0.1:4178/healthz
   - 项目 `data/ziwei_user.json` 仅代表本地 `bjc-ops`；只有明确进行本地 daemon 验收时才核对项目入口和对应 `/readyz`。
6. 真实服务器 daemon/A2A 验收必须单独使用全局 `D:\work\nodejs\node_global\ziwei_user`、用户配置 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`、服务器 `https://qzelynth.top` 和 `test_222` 工作区，再核对 `ziwei_user status --json` 与 `http://127.0.0.1:20242/readyz`；不要用项目 daemon 或本地 `bjc-ops` 结果冒充服务器证据。test-111 只是默认示例，不能假定它是当前工作区。
7. 修改前先说明：问题属于前端、API、SQLite/repository、A2A、daemon 还是 CLI 层；先复现并记录证据，再做最小修改。
8. 不要使用伪数据、静态成功状态或扩大超时掩盖执行失败；不要依赖 AuraBaba daemon。
9. 完成修改后至少运行：npm test、npm run lint、npm run build；涉及 daemon/A2A/CLI 时还要做一次真实本地链路验证。
10. 最后报告：改了什么、为什么、验证结果、未验证边界、回滚方法，并更新 PROJECT_MANAGEMENT.md 或 CHANGELOG.md。

先执行第 1～6 步，只输出当前项目状态和你建议的下一步，暂时不要改代码。
```

## 新会话的正确打开方式

1. 在 Codex/其他 AI 中选择或打开项目目录 `D:\灵光爸爸拆解`。
2. 粘贴上面的提示词。
3. 等它完成状态盘点后，再告诉它具体要修改的功能。
4. 如果换了电脑，先把整个项目目录和 `data` 的必要备份恢复，再让它检查端口和配置。

不要只把本次聊天截图或零散描述发给新会话；维护手册、代码、测试和运行状态才是项目事实来源。
