# 驾驶舱公开 CLI 文档入口

实现基线为 `b8c8a669e0fb18623166628bd3e1088dfb133249`，分支 `codex/workspace-cli-contract-v1`。记录创建于 2026-10-21 任务，更新于 2026-10-22。依据统一 CLI 规范 1.2.0 与 C14；新包 `@ziwei/workspace-cli@1.0.0`、命令 `ziwei-workspace`、默认机器契约 v1。现有电脑客户端 `ziwei_user`、管理 stdio MCP、配套手机 Control `ziwei` 各自保留。

## 路由与原入口核对

源码检查 `backend/` 未发现原 `/docs`、`/mcp-docs` 路由或 SPA/static fallback。`backend/workspace-cli-docs.mjs` 只注册三个固定 GET，Express 同时可处理相应 HEAD；没有 `express.static`、目录遍历、文档通配兜底或新业务身份豁免。

| URL | 对应文件 | Content-Type |
| --- | --- | --- |
| `/docs` | `docs/public/workspace-cli/index.html` | `text/html; charset=utf-8` |
| `/docs/cli.md` | `docs/public/workspace-cli/cli.md` | `text/markdown; charset=utf-8` |
| `/llms.txt` | `docs/public/workspace-cli/llms.txt` | `text/plain; charset=utf-8` |

`backend/app.mjs` 仅增加模块 import 与 `registerWorkspaceCliDocs(app)`。注册位于通用安全响应头之后，JSON body parser 与 `/api` session/member/resource guard 之前。未修改 authExempt、业务路由、Cookie、API Key、MCP/设备授权逻辑。固定文件缺失时 404；其他读取错误 500；异常正文不包含文件路径或原异常，且 no-store。正常文件 public cache 300 秒、nosniff；HTML 为实际正文，无 JavaScript、SPA 挂载壳或外部资源。

三个公共入口一律使用 `https://ziwei.qzelynth.top` 绝对链接。该地址为交付目标；没有根据源码推断生产反向代理、原线上文档配置或部署状态。今后若生产已有独立 `/docs` 或 `/mcp-docs`，须在发布差异核对时保留原内容/真实链接，不以本地检查替代线上路由核对。

## 生成来源与更新

`scripts/build-workspace-cli-docs.mjs` 直接 import `packages/workspace-cli/src/registry.mjs` 的 `operations`、`unsupportedOperations` 和版本/origin 常量。所有业务命令、完整 inputSchema、原工具/子操作、readOnly、sideEffects、requiredPermissions、supportsDryRun、幂等及传输差异、resultQuery、transports 和原 API routes 均来自该 registry。文档中包含命令目录 SHA-256；该 hash 不是包 hash 或生产源码证明。

手写导言负责发行状态、身份/权限、全局参数、stdin、JSON/退出码、异步/unknown/取消、MCP 和版本边界。导言对应当前 CLI 实现，不能只改 registry 就假定这些说明也自动更新。原管理 MCP 指向真实 `scripts/ziwei-mcp.mjs` 与受权限保护的官方仓库源码，不宣称 HTTP 管理 API 是远程 MCP transport。公开文件只含占位账号/ID/输入文件，不含真实员工资料、业务数据、凭据或本机运维目录。

更新/检查命令：

```powershell
node scripts/build-workspace-cli-docs.mjs
node scripts/build-workspace-cli-docs.mjs --check
node --test test/workspace-cli-docs.test.mjs
node --check backend/workspace-cli-docs.mjs
node --check scripts/build-workspace-cli-docs.mjs
node scripts/lint.mjs
```

生成器提供纯 `buildWorkspaceCliDocs()` 与 `writeWorkspaceCliDocs({outputDirectory,check})`；import 本身不会写文件。`--check` 对缺失/过期输出退出 1。生成内容与时间元数据固定，可复现；命令目录变动后需要重新生成并复测。公开输出目录自己的 `.gitattributes` 固定 Markdown/HTML/txt 为 LF，避免 Windows core.autocrlf 使精确生成校验误报过期。

## 本轮验证证据与边界

2026-10-22 运行 `node --test test/workspace-cli-docs.test.mjs`：5 tests，5 pass，0 fail；先验证缺模块的失败再实现。用内存 app.get 注册 mock 与无 Cookie/认证头的 req/res 调用，核对精确路由集合、200/Content-Type/实际正文/绝对链接/版本、无脚本/空 SPA、缺失文件 404、异常脱敏 500。生成对照逐项检查 registry 全 schema 与行为字段、占位/敏感模式、发行/SSO/MCP/退出码边界；临时目录验证缺失/过期检测。`--check` 报 3 files / 43 operations；`node --check` 无语法错误，`node scripts/lint.mjs` 报 239 source files checked。

这些是 handler/生成检查，不是实际本地 HTTP C14 或公网验收。实际本地 HTTP 由主代理先按 port-manager 端口/持久掉线诊断规则办理，再通过普通 HTTP 无 Cookie/认证头/JavaScript 核对；独立记录其端口、状态、Content-Type、正文、绝对链接和私有 API 仍拒绝匿名。该执行者未启动服务、占用端口、调用模型或执行设备/消息动作。

## 发布文件闭包和 pending

发布后端时至少一起带入修改后的 `backend/app.mjs`、新 `backend/workspace-cli-docs.mjs` 与整个 `docs/public/workspace-cli/`。只复制 backend 会导致固定文件缺失 404；文件默认位置相对于模块而非 cwd，不需复制开发机绝对路径。静态文件是生成结果，运行时后端不需要 import CLI package 或 generator。若发布过程有 allowlist/归档清单，必须把这些文件纳入该次发布方案；本轮没有修改现有发布工具或私自部署。

构建文档时另需 `scripts/build-workspace-cli-docs.mjs` 与 CLI registry/vendor 来源。根 `ziwei_user` 的 npm files 清单保持原样；本文路由不是通过电脑执行客户端升级发布。CLI 独立包、包 SHA-256、临时 prefix 安装/卸载、本地实际 HTTP 与最终源码 commit 由主代理分别记录，未在本记录虚称完成。

- C14 handler/生成源码实现已验证；实际本地 HTTP 与后续公网观察见下方，公网发布仍为 pending。
- SSO 统一身份未配置，C13 pending；native/managed 仅迁移期原身份兼容。
- 独立包当前是本地 artifact，未发布公共 npm；生产网站、设备与原客户端未因此更新。
- 该记录不代替统一回执、最终 commit、包 hash 或发布验收。

## 主代理最终验收补录（2026-10-22，Asia/Shanghai）

最终目录为 44 项操作，复用原 24 MCP 工具，另含只读 `actions wait`。重新生成并执行 `--check` 后，CLI/文档集成测试 52/52；原生管理授权内存测试 16/16；不监听端口的旧 `ziwei_user` 回归 5/5。两轮独立审查的问题均已修复并复审。

在先查询并登记的 `127.0.0.1:54173` 上，以实际 `registerWorkspaceCliDocs` 模块构造一次专用文档 HTTP 夹具。普通 Node HTTP 客户端不带 Cookie/Authorization、不运行 JavaScript，验证三个路径的状态、UTF-8 Content-Type、正文、绝对链接、版本、全部 44 项 schema、HEAD 与未知路径 404。日志按实例分段追加，worker 每 15 秒心跳，独立观察者每 10 秒健康检查；仅隔离进程退出码 23 和正常退出 0 均被记录。全部进程退出、无监听后释放临时登记，日志保留。本夹具无业务 API；其 404 不作为业务鉴权证据。

包 `ziwei-workspace-cli-1.0.0.tgz` 两次独立 pack 字节一致，SHA-256 为 `97f2c3cc8ec8de89c50bcb873166c085a54609d224bc4af58dfc2066c6d8270c`。在全新临时 prefix、空配置目录和空 npm 用户配置中离线安装，验证版本/帮助/能力/参数失败/无凭据快速失败/统一身份 pending，再卸载并确认程序移除；没有创建凭据目录或修改全局安装。

公网匿名观察与本地验收分开：`https://ziwei.qzelynth.top/docs` 请求在连接阶段超时；`/docs/cli.md` 与 `/llms.txt` 当时均为 HTTP 200、`text/html`，正文 556 字节，仅有 `#app` 和脚本引用，没有文档正文。两者 SHA-256 同为 `53f5ce54f58aefd7676cff6ee398bf07b24a68182a300ccf12ff52ef2674b9ea`。这是尚未发布的现状，不是 C14 公网通过。

后续独立发布方案除上述文件闭包外，还必须核对前端/反向代理的 SPA fallback：把**精确** `/docs`、`/docs/cli.md`、`/llms.txt` 交给该后端处理器或对应真实文档文件，先于 SPA catch-all；不要广泛豁免 `/api` 鉴权，不覆盖既有文档。生产发布后须重新做匿名 HTTP 验收，本轮未修改反向代理、DNS、生产代码或设备包。

详细本机原始证据和最终提交号由 `D:/AINavtie/ops/cli-standard/receipts/workspace.json` 记录。可迁移的精简验收见 `docs/qa/2026-10-22-workspace-cli-contract-v1.json`。
