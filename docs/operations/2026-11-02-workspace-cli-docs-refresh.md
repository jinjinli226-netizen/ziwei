# Workspace CLI 文档、发行源码和下载入口对齐

2026-11-02，用户指出 `/docs/cli.md` 没跟上当前产品。匿名读取确认不是仅浏览器缓存：线上 Markdown 为 233079 字节、46 个业务操作，仍显示 CLI/文档 2.0.0、更新 2026-10-22、未部署和未提交候选；`/docs` 和 `/llms.txt` 也包含这些旧状态。同次公开 `/api/identity/config` 已为 unified、ready=true、legacyAllowed=false，支持 native/mcp CLI transport。

## 来源与差异

源码分支当时为 `a8b3e3194ea94f8ffc65b0a527c47219f7195e07`。本地 registry 有 49 个业务操作，新增 DSH 插件 get/refresh/apply 及 Hermes/DSH/Codex 混合成员 schema，但文档未完整重新生成。版本标识仍为 2.0.0。混合成员是 `bots collaboration` 的输入能力，不是独立的 mixedGroups 命令族。

实际安装的独立 `@ziwei/workspace-cli` 为 2.0.3、46 个业务操作。已核归档为 62934 字节，SHA256 `2f6401718659f82f0961d6b7d74a87333afea7884f45b2defbc2352e115d3708`，23 个包成员逐字节匹配安装目录。它来自实际 2.0.2 认证修复加 `8e4f37af60a473ecc2b811fa66d8461c11d66e7d` 的能力回填增量，并非该 Git 提交的纯构建；原生认证改动当时没有完整归入这份 Git 源码。

2.0.3 包含现有分支缺失的人员 long-lived、业务前自动续期、按凭据槽 session 锁、刷新新 AT/RT 先持久化再服务端核验、invalid_grant 保留重新登录状态及凭据 fsync；现有分支包含 2.0.3 缺失的三个插件命令和混合成员 schema。任一方整包覆盖另一方都会回退已有功能。

历史 2.0.3 的不可变 release.json 和 tgz URL 当前均被 SPA fallback 接走：HTTP 200、text/html、556 字节，SHA256 `f4e54c33c74f8cc468dd3a6288b8bc54883f6c6408cf260d0a4ff1cfc5b4ce6a`，不是可解析 JSON 或 gzip。不能仅以 HTTP 200 宣称下载正常。

## 本轮范围

- 将实际 2.0.3 已验证认证修复收敛到当前源码，保留插件命令、混合 schema 和原 transport 回执；独立管理 CLI 统一为 2.0.4。
- 更新生成器的日期、发行状态、统一登录、人员长期登录和机器身份说明。文档版本为 2.1.0，所有业务 schema 继续从同一 registry 生成。移除旧提交的“字节一致”、候选未提交等失实断言。
- 修正 capabilities 的 machine/统一模式自述，区别已有实现、实时服务器配置与真实业务验收；不承诺固定或永久登录期限。
- 重新生成三个公开文件，通过原精确路由增量更新，无需替换 API 或前端代码、重启业务。发布 2.0.4 的真实独立包与元数据并逐字节验收，禁止将 SPA 的 200 当成功。
- 该管理 CLI 与电脑执行客户端 `ziwei_user` 是不同软件。本轮不替换电脑执行客户端、手机端、Gateway、员工配置或业务数据，不运行模型或重放任务。

## 验收进度

认证合并及最终独立审查额外发现首次授权的恢复顺序问题：token 已落盘但首次 `/api/identity/me` 返回 503 时，identity 仍为空；后续 status 在进入待验证恢复之前先校验完整 identity，无法恢复。新增真实 runCli/CredentialStore 回归先失败再通过，仅调整该校验顺序；未验证成功前仍禁止业务派发，且不再进行第二次 token exchange。已有身份刷新后 503、身份替换拒绝和持续未验证阻止派发也通过独立复核。

根会话最终组合回归 120/120，无失败、无跳过；三文件 `--check`、49 项 schema/权限对照及 lint 440 个源码文件通过。测试没有调用真实 OAuth、模型或业务动作。

源码、洁净打包/安装、已授权只读查询、文档和下载公网读回继续分别验收。最终版本、包 hash、源码提交及发布结果在完成后补录。
