# 紫薇：AI 项目入口

先用本页理解项目，再根据用户任务从[功能索引](docs/FEATURE_MAP.md)查找实现。更新于2026-10-20。

## 我们在做什么

紫薇是一个数字员工工作平台。用户通过网页或 Android 管理 App 创建岗位员工、聊天派活、查看结果和管理运行电脑。真正执行任务的是用户电脑上的 `ziwei_user`，它调用本机 Codex、Hermes 等运行时；需要操作手机时，再通过紫薇互联和手机 Agent 执行。

- **工作区**组织成员、员工、设备、权限与任务。
- **数字员工**保存岗位、人格、模型、运行电脑和默认工作目录。伙伴市场的 Creator 是帮助用户创建、配置员工的可复用岗位模板。
- **Hermes Bot**是在同一员工身份上增加独立 Profile/HOME、长期聊天、记忆、工具、Routine 等配置；团队管理和 Bot 页面指向同一员工。
- **电脑执行与手机控制**分别有自己的连接和回执；网页保存配置、电脑实际加载、模型成功、手机执行完成是不同状态。

## 目录怎么看

```text
frontend/src/       网页界面；components/ 是页面组件，api.js 负责请求
backend/            HTTP API、工作区权限、数据、任务与自动化调度
daemon/             用户电脑上的 ziwei_user 服务入口
src/                本机 CLI 适配、Hermes Bot/Profile、会话、执行与恢复
scripts/            CLI、MCP 桥接、安装升级、诊断和发布工具
test/               本机运行与端到端协议的自动测试
docs/               功能说明、接口合同、运维与 QA 记录
```

Android 管理 App 源码在 `mobile-manager/`，已归并 code18 统一登录的验收来源；被控手机 Agent/Updater 和 Control 在独立私仓。最新源码归并范围见[main 集成记录](docs/operations/2026-10-28-github-main-source-integration.md)，历史发布层见[版本与仓库地图](docs/handoffs/2026-10-20-release-map.md)。

## AI 如何接任务

1. 读取适用的 [AGENTS.md](AGENTS.md)，检查当前分支和未提交修改。
2. 用[功能索引](docs/FEATURE_MAP.md)将用户说的功能或报错映射到对应源码与测试；先读该模块，再沿实际调用关系展开。
3. 用户已给具体任务时，直接推进必要工作。缺信息时只询问阻塞当前任务的内容，其他部分继续完成。
4. 遇到历史原因、上线状态或设备差异，再查该模块的运维/QA、[HANDOFF.md](HANDOFF.md)对应日期。首次理解项目无需通读历史、迁移清单或其他员工的全部记录。
5. 修改后做与影响范围相称的验证；交付实际结果、验证依据和仍未确认的部分。新增或移动主要功能时，同步维护索引中的入口。

## 按需继续阅读

| 当前需要 | 入口 |
| --- | --- |
| 找代码、测试、功能说明 | [功能索引](docs/FEATURE_MAP.md) |
| 核对服务器、官方包、某台电脑或 APK 的版本 | [分层版本地图](docs/handoffs/2026-10-20-release-map.md)，再核对有权访问的实际环境 |
| 查某次变更、失败原因和真实验收 | [HANDOFF.md](HANDOFF.md)最新相关记录 → 对应 `docs/operations/`、`docs/qa/` |
| 换电脑、接未提交工作、移交私有资料 | [迁移详细说明](docs/handoffs/cross-computer-guide.md) |
| 新建 AI 会话 | [简短接手提示词](NEW_AI_SESSION_PROMPT.md) |
| 查开发约定与较早架构记录 | [项目管理手册](PROJECT_MANAGEMENT.md)、[README.md](README.md) |

当前源码入口为 `main`，已合入最新主项目代码与 AI 导航文档；实际使用前核对远端提交和本地修改。`codex/remote-client-upgrade`、`codex/v2-20261014-release` 保留为接续记录。生产各层可能分别发布，具体变更按对应层的记录处理。
