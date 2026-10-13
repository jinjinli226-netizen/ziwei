# Bot owned Profile 实施计划与 ADR

**Goal:** 新 Bot 拥有唯一 Hermes 命名 Profile，原生解析 HOME 与实际配置、记忆、会话、状态 HOME 一致。
**Architecture:** 服务端保存不可变 owned-profile 身份，创建 Bot 时同时建立设备 provisioning action。设备使用已安装 Hermes 的原生 profile 布局函数在隐藏 staging 建立目录，写入受信归属，再原子发布至原生 `profiles/<name>`；运行前核对归属与原生目录解析。现有 Bot 保留 legacy 私有 HOME，不迁移。
**Tech Stack:** Node/SQLite A2A、现有 Windows Job 监管、已安装 Hermes 0.21.3 Python、原生 managed overlay。

## 决策与范围

新 Bot 默认 owned_profile。`runtimeProfile` 在创建输入中仍兼容表示初始化来源；新字段 `sourceProfile` 更明确，二者同时提供必须相同。服务端生成稳定 `bot-<hash>` 名称，员工改名不改变 Profile。已有员工 initialize 继续 legacy_private_home；现有 Creator、Bot、profile、认证与状态不迁移或删除。

评估过两个替代方案：继续来源 Profile + hash HOME 不满足用户的一对一目标；完整克隆 Profile 会带入历史/技能/凭据且 OAuth 刷新存在争用。采用独立命名 Profile + 受限模板初始化。只取模型/provider 的非敏感配置；不复制来源 OAuth、`.env`、MCP、记忆、会话或渠道。认证在新 Profile 的原生存储中独立配置，创建成功与认证/验证成功分别显示，不承诺独立模型账号已登录。

命名 Profile 的权威目录由目标设备的原生 resolver 决定；前端不能提交 HOME、ownershipId 或独立标记。设备 metadata 绑定 API origin/workspace/employee/computer/profile/ownershipId。所有后续运行复核相同 metadata，原生 bootstrap 验证 profile resolver、config、memory、state 都在同一个 HOME。每次执行的 overlay 只保存本次工具准入，不承载 Bot 持久状态。

使用原生 `_bootstrap_profile_dir` / `_finish_profile_layout` 构建全新布局，并在启动器绑定中核对源码接口。避免公开 create_profile 的 multiplexer 通知/服务注册副作用；原子发布后的目录由原生 get_profile_dir/profile_exists 识别。版本不兼容则失败，不安装依赖或回退主 HOME。

## API 契约（给 E03）

- `POST /api/workspaces/:slug/bots`：现有字段，新增可选 `sourceProfile`；服务端创建 employee、主聊天、owned 身份和 `hermes.bot.provision` action。HTTP 202 表示已排队；幂等重试返回同 Bot/同原 action，不再创建 Profile。
- Bot GET/list 增加 `instance`：`mode:owned_profile|legacy_private_home`、`profile`、`templateProfile`、`ownershipId`、`home`（只有确认回执后才有值）、`provisioning:{actionId,status,authentication,error}`。owned 的 employee.runtime_profile 是专属名称，templateProfile 仅初始化来源；legacy 的 profile 仍为来源，home 不伪装为该来源目录。
- `POST /bots/:id/provision`：版本与幂等保护的显式恢复。待处理/已领取/未知结果仍返回原 action，明确失败后仅允许对同一身份与名称核对/补齐，不创建第二套。原 action 始终可通过 runs/action 查询。
- provisioning succeeded 仅表示目录与原生映射已证明；认证可能 required。仍需现有 validate → activate，未 provisioned 不允许模型运行。修改配置会遵守原 revision/epoch 验证规则。
- `phone-mcp setup/status` 的 configuration 增加服务端 `botInstance` 身份/模式/阶段；owned 已 provisioned 使用现有专属 profile，固定电脑/runtime/profile，无需再创建一个。legacy 的现有准入规则保持。
- 手机 capability 仍绑定原 workspace/employee/computer/phone/revision/action，不新增手机授权机制。服务端从员工当前配置统一派生 terminalMcp；native Goals/HB/Kanban/group source 的模型回合也走相同 bootstrap。纯 read 动作不加载手机工具。
- 所有状态分别表达 saved/provisioning/provisioned/authentication/validated/active；202、文件存在、MCP injected、MCP loaded、手机 command receipt 不互相替代。

## 执行步骤

1. 先加入 API 失败用例：A/B 名称不同；同请求同身份/action；未 provisioned 拒绝 validate/run；拒绝伪造归属与回执；legacy 不迁移。运行 `node --test test/hermes-owned-profile.test.mjs` 确认失败，再实现 DB、Bot create/provision/readback、A2A 准入/回执核验。
2. 先加入目录/运行绑定失败用例，再实现 `src/hermes-owned-profile.mjs`、Python 原生布局桥接，以及 `hermes-bot-runtime`/bootstrap 的 owned 分支。真实 Hermes 在临时根验证 resolver==HOME，重复创建复用、他人目录拒绝、source 字节不变、认证独立、不复制全局 MCP。
3. 先加入 phone 组合失败用例，再统一服务端 phone metadata 派生、bootstrap 当前 Bot revision/权限核查、本机 native runBotTurn 注入与清理。验证只读/解绑/变更/终态撤销，源目标分别使用自身绑定。
4. 本地协议验收：两个 owned Bot 有界模型回合、重启复用、记忆/会话独立、实际管理/手机 MCP loader 握手；手机命令只连模拟服务。所有 helper/model 进程受 Windows Job 监管并保留 cleanup 证据。
5. 稳定候选仅执行一次完整 `node --test --test-concurrency=4`；lint/AST/diff 和必要定向回归。整理事实边界、证据、SHA 与 E03 契约交接；仅本地提交。

## 失败与保护

事务保证 employee/主聊天/owned身份/action 关联同时保存。设备隐藏 staging 避免可见半成品；最终目录已有同一完整 metadata 则仅核对，不重新写初始配置/记忆。目录冲突或归属不明保留现场失败。已发布但响应丢失通过同身份核对恢复，不能换名重建。未知进程树不标记创建成功；既有 journal/取消规则继续约束重放。

不操作 E03 工作树/唯一预览，不修改原客户端/Hermes安装/正式服务，不调用真实手机，不读取或复制正式认证；固定最多两条执行线，不增加第三执行者。
