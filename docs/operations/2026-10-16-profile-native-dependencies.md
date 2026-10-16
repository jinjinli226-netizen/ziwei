# 2026-10-16 Bot 创建时加载 Hermes 原生依赖

## 现场依据与根因范围

公司台式已运行诊断 build `9230ce66bbe603db79fc0d5f9936a977d61e1d68ea768da30111fa23579888dc`，PID 20268。09:28:07 创建 TiktokTrendS 的动作 `action_06bd4986-8fbe-461a-8880-c8720dfb4174` 在 09:28:17 返回 `BOT_PROFILE_CREATE_FAILED`。诊断为 `native_imports / ModuleNotFoundError`，位置 `hermes-owned-profile.py:_provision:83`，对应 `import yaml`；Windows Job 根进程退出 0、执行树完整退出。员工为 `employee_15c315d3-2223-40f6-b9c9-5ffc4d0f1130`，专属 Profile 为 `bot-ae3870b2c57ac0db01035511`。

用户确认 `hermes profile list` 正常。原生命令可以加载依赖，失败发生于紫薇直接调用创建逻辑的路径。源码检查发现：旧适配只在 isolated launcher 分支激活原生 bootstrap；非 isolated 分支绑定源码后直接创建，绕过 `hermes_cli.main` 的 bootstrap，可能找不到 PM 管理的 PyYAML。已用初始无法导入 yaml 的解释器复现并验证修复。服务器旧回执没有记录实际 launcher kind，因此尚不能直接确认公司机属于哪个启动分支，仍须更新后的创建回执确认。

## 修复与验收

- 非 isolated 入口发现同源码 `hermes_bootstrap.py` 时，调用该安装的原生初始化，交由 Hermes 选择已提交的依赖环境；不安装依赖、不改用系统 Python、不硬选 venv。
- 探测记录 bootstrap 哈希，执行前复验；依赖激活后重新核对四个已绑定模块的来源。保留独立 Profile/HOME、来源配置和认证边界。
- 回执增加固定启动器类型、bootstrap 绑定状态；失败诊断允许受限的缺失模块名，不返回路径、环境、凭据或原始异常正文。
- 最终 7 文件 Node 回归 **40/40**，无跳过；其中真实官方 PM 专项内部 **3/3**、Python 诊断专项内部 **14/14**。独立复审通过。148 源文件 lint、Python AST、Node 语法、前端构建、发布包离线依赖闭包通过。
- PM 专项使用离线官方 v0.22.0 源码，初始移除 site 包并断言无法导入 yaml；不替代 `activate_dependencies`、`prepare_launch` 或 `recover_if_needed`。真实 facts 选中私有 generation，`.pth` 生效，yaml 实际来源属于该 generation；首次创建及重复请求保留记忆通过；篡改 bootstrap 和跨安装目录被拒绝。PyYAML 字节仅离线复制进测试 generation，未用于产品路径。
- 先前 00:24 的样本验收替代了 PM 初始化，不能覆盖本次缺口。本次纠正该测试盲点，但仍是离线验收，**不能称 Windows 实机创建已成功**。测试无监听、无真实模型或生产员工创建。

## 发布与接手

源码 `bb52bbe235aa0e5ab92d4f229021f01f6279ef61` 已先推 GitHub `codex/v2-20261014-release` 并核对远端，再于 **2026-10-16 09:43:17（Asia/Shanghai）** 发布官方 Windows 客户端。

- clientBuild：`12932d5c024d1bb36584a96f2e06c6d334f5cee5c74fd60fc4d73e8999f3550f`。
- 包 SHA-256：`7b657cc60fb7f26cc4eb6767ef03f97d81896f086971049c153d48f8f1a8c13a`；1,073,136 字节。
- 发布记录：`/opt/ziwei-staging/profile-dependencies-bb52bbe235aa/publish-result.json`。
- 上一客户端下载备份：`/opt/ziwei-staging/backups/profile-dependencies-client-20261016T014317Z`。

服务器已公网回读元数据及完整包哈希。主站/API 保持 `cd610444`，三个服务未重启，Nginx 配置和数据库文件身份保持；本次仅更新官方下载包。回退下载发布可原子恢复上述备份的 `release.json` 与 `ziwei-latest.tgz`，不恢复业务数据库。

下一步请公司台式运行官方 `update-windows.ps1`，核对心跳 build `12932d5c…` 后，在原 Bot 点击“重试创建”。从新动作核对 Profile/HOME、结果和 `runtimeStartup`；不要让用户继续重建员工、重装 Hermes、重登订阅或删除原 Profile 试错。公司机实测尚待该更新后回执。
