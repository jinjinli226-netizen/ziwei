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

## 独立包安装和真实只读查询

统一源码和文档提交 `5e5802dfe6a622f6a4d8b8efe4363fb7ce2ab8e9` 已推送并核对远端。最终独立 2.0.4 包为 64124 字节，SHA256 `666a0e34323b818d14696b4666404e145f2c442cd572f541eda6a195ab60c2c8`；23 个归档成员与该 Git 提交及实际安装文件逐字节全等。旧 `564f…` 候选缺少首次授权恢复修复，仅保留历史，不用于发布。

沿原全局 npm prefix 安装后，正式 npm 离线查询退出 0，实际二进制报告 2.0.4、49 个业务操作，三个插件操作和混合成员 schema 保留。原包装脚本未写出安装退出回执，没有虚构安装命令 exit 0 或重复安装；以 npm inventory、文件全等、实际版本和真实查询共同验收。

2026-11-02 11:44:48（Asia/Shanghai）完成一次露娜 `bots get`：原有人员授权 AT 已到期，CLI 用原 RT 正常自动续期后查询成功，HTTP 200、CLI exit 0，返回原员工 ID 和 active。没有新 login、模型调用、真实对话或业务重放。安装本身前后凭据及 config hash 不变；只读查询触发的正常 token 代更新单独记录。电脑执行客户端 PID 44180/build `13ce4205…`、原 Gateway 6716 创建时间、员工 Profile 与 Hermes 根配置均保留。

安装及只读证据位于 `D:\AINavtie\ops\workspace-cli-2.0.4-20261102\INSTALL-ACCEPTANCE.json`（passed=true，17 项检查）和 `READONLY-BOTS-GET.json`。

## 文档和下载发布

三份公共文档、新 2.0.4 包/元数据/SHA 文件及历史 2.0.3 四个原始文件共 10 个文件已增量发布。发布前格式检查器误判 schema 代码块，修正校验后才写入；该次失败没有更改线上。发布过程未重启服务、改变 API/前端业务文件或手机设备版本。

根会话于 2026-11-02 11:58:49（Asia/Shanghai）独立匿名读取 7 个 URL，全部 HTTP 200、类型和实际字节正确，passed=true：

| 入口 | 验收结果 |
| --- | --- |
| `/docs` | HTML 2043 字节，与提交源一致 |
| `/docs/cli.md` | Markdown 278693 字节，CLI 2.0.4、文档 2.1.0、更新 2026-11-02，49 个操作；SHA256 `41c19e37522a284fe9c86029fbfbde8f4d97fe1c16adf510af923d49c304cae4` |
| `/llms.txt` | 1624 字节，与提交源及版本一致 |
| `/downloads/workspace-cli/2.0.4/release.json` | 可解析 JSON，版本/源提交/49 业务操作/包字节与 hash 匹配 |
| `/downloads/workspace-cli/2.0.4/ziwei-workspace-cli-2.0.4.tgz` | 64124 字节，gzip 头及完整 SHA 匹配验收包 |
| 历史 `/downloads/workspace-cli/8e4f37a/` 的 release.json 和 2.0.3 tgz | 恢复原始 JSON 与 62934 字节包，不再返回 SPA |

部署方本地/公网 20 项读回、10 文件保留和进程证明位于 `D:\Ziwei-Local\artifacts\workspace-cli-2.0.4-5e5802d-20261102\PUBLISHED.json`；根独立读回为 `D:\AINavtie\ops\ziwei\workspace-docs-refresh-20261102\PUBLIC-ACCEPTANCE.json`。正常文档缓存为 300 秒，浏览器可能需要强制刷新。文档读取与安装/只读查询已验收，不把这些结果推广为所有业务写入或模型功能的完整现场验收。
