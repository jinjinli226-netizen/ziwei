# 单 Bot 的执行权限与自主工作

2026-10-25，源码隔离验证，未部署或操作真实员工。

新建和未显式选择权限的 Hermes Bot 默认使用 execute，挂载已支持的网页、浏览器、文件、终端、视觉、技能、待办、记忆、会话检索、代码执行与 `ziwei_autonomy`。明确保存的 read_only 维持无工具；普通配置补丁通过 `normalizeBotConfigUpdate` 保留此前权限及显式空工具列表，不以迁移为由升权。management:false 禁止自主管理接口。

`all` 只扩展这组已接通工具。cron/cronjob/heartbeat/goals/kanban/bot 别名路由至平台接口，不开启 Hermes 原生后台调度。delegate/delegation 仅在已配置明确协作目标时映射现有 ziwei_collaboration。每个 Routine 仍由紫薇 automation 唯一调度，原生 finite-step 驱动沿现有 nativeDriver 运行。未接入的操作返回 BOT_AUTONOMY_OPERATION_PENDING。

## 员工自身接口

`POST /a2a/v1/actions/:id/bot-autonomy` 使用已配对电脑身份，只接受当前 acked action 的同工作区、同员工、同电脑和当前 revision/controlEpoch；暂停、结束、改版本后拒绝旧请求。请求不允许传员工/工作区/Profile 覆盖字段。

- status/routines：读取实际权限、平台调度状态和自己的例行工作。
- configure：在当前已有授权内停用工具/连接/技能、调整记忆，必须通过 deferUntilIdle 队列应用；不能添加新工具、连接地址、凭据、权限或扩大员工目标。首次新增授权需本人在配置界面完成。
- createRoutine：创建自己的平台例行工作，原生驱动仍受现有白名单限制；以 source action 与稳定请求键去重，未知结果保留原键回读。
- pauseRoutine：只暂停自己的 Routine，重复暂停无副作用；不提供自主恢复用户停用任务的操作。

该通道不接收 API Key、登录密码或临时安全回答；这些使用独立安全交互通道。源码随客户端升级后才会实际挂载。缺少客户端/原生依赖、首次 OAuth/设备授权、尚未挂载和明确禁止应分别显示，不把页面保存称为本机执行成功。

## 验证

`node --test test/bot-autonomy-policy.test.mjs test/bot-autonomy-service.test.mjs test/bot-autonomy-native.test.mjs test/hermes-bot-defaults.test.mjs test/hermes-bot-runtime.test.mjs`

包含缺省 execute、显式 read_only、权限补丁保护、粗粒度别名、协作目标、跨电脑/过期版本拒绝、配置缩权、稳定重试键、Python 工具注册与受控请求、错误不反射敏感内容。Python 使用现有 D:/AIpartner/.tools/omi-voice/Scripts/python.exe，未下载模型或创建推理环境。未调用真实模型，未创建真实例行工作。
