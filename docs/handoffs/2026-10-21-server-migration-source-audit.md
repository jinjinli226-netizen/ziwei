# 2026-10-21 换服务器前源码核对

本次只读核对 GitHub 和原服务器源码，没有迁移、切换域名、部署、停止服务或升级设备。

## GitHub 已包含的修改

北京时间 14:43 左右重新 fetch 并回读 GitHub，`main`、`codex/remote-client-upgrade`、`codex/v2-20261014-release` 同为 `a9ef04eb54e464a3cda45d3d491f49cfb5c23dd4`，与当前接续工作树无差异。以下提交均已在 main 祖先链中，无需再次合并：

| 修改 | 源码提交 | 验证记录 |
| --- | --- | --- |
| Bot 伙伴列表与配置页避免全量历史读取 | `0d4f6c3f47ba9f80627268068d694dd83f9f3d8e` | [性能](../operations/2026-10-21-bot-page-performance.md) |
| 网页聊天初始及翻页每次 10 条 | `0494db8fb9ee72f2fe8d509b7b7bf00477939a0f` | [分页](../operations/2026-10-21-conversation-history-pagination.md) |
| 员工默认共享知识库指南 | `6243891548c2951cf03b05cec24183a998e2b728` | [知识库](../operations/2026-10-21-world-memory-skill.md) |
| 正式目录及真实网页分页验收文档 | `a9ef04eb54e464a3cda45d3d491f49cfb5c23dd4` | 同上各专题和 QA |

上述 SHA 是核对时的快照；本文件后续文档提交会改变分支头。换服时再次核对 main 的实际完整 SHA。

## 正式服务器不是单一 Git 树

2026-10-21 06:43:33 UTC 只读核对原服务器 `/opt/ziwei/current`，其目标仍为 `/opt/ziwei/releases/world-memory-skill-6243891548c2-969a825292ca/v2`。按 main 的 266 个选定非测试产品文件、归一 CRLF 后比较：162 个相同、23 个不同、81 个未在正式目录部署。今早相关 API 文件均在相同集合；前端正式部署使用 `frontend/dist`，不包含 `frontend/src` 属于部署形态差异。其余差异包含旧配套客户端及恢复模块，不能解释为 23 项线上故障，也不能据此声称整个正式树等于 main。

本次不是整树闭包审计：未比较所有额外文件、测试或构建产物，未重新跑业务。今日增量发布器位于原维护电脑忽略的 `.local/`，Git 的旧 `scripts/server-code-rollout.mjs` 不是复刻当前正式系统的一键安装器。不能仅 clone main 后就承诺完整换服成功。

## 换服必须单独保全

- 主数据库、图片和附件对象、`data` 持久目录及原运行密钥。活动 SQLite 使用一致性备份，不能只复制主文件而遗漏 WAL 中的新数据。
- Control 独立 `ziwei-system` 私仓、控制库和手机服务持久数据；主仓不是该仓库的替代品。
- 已发布的 CLI/APK、下载元数据及不可变历史产物，不能以 npm 源码代替已部署包。
- 实际 API/网页/Control 发布目录与清单、systemd、Nginx、HTTPS 证书、环境及安全配置；秘密通过安全渠道迁移，不放 GitHub。
- Windows 原员工 Profile/HOME、账号授权、记忆和本地业务文件继续留在对应电脑。只换服务器不应重建员工、设备或配对身份。

Android 管理 App 源码仍在独立并行分支，Control/Agent/Updater 在独立私仓。来源见[分层地图](2026-10-20-release-map.md)。旧试运行模式若实际启用，具有数据库路径和 dev/ino 绑定，需按新服务器重新核对，不能复制旧模式配置后绕过校验。

下一步应以旧机实际持久目录和发布清单制作受控迁移包，在新机恢复并检查登录、员工/聊天/附件、设备心跳、工具及通知，再切换域名；原服务器和可恢复备份应保留到验收完成。当前没有开始该步骤。
