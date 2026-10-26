# 员工能力明细：Skill、MCP、业务 CLI

本批扩展现有「Bot 伙伴 → 能力组合 / 资料与工具」，保留原技能安装、MCP 连接与授权入口。非 Hermes 员工也能查看自己的只读明细，不会为展示清单初始化 Bot 或更换运行时。主页排版不在本批范围内。

## 状态与事实

- 能力卡的保存状态、最近一次原生检查与当前运行障碍分别显示。电脑离线不会删除已保存配置或覆盖历史成功证据；真实执行准入保持原规则。
- Skill 目录可见、平台分配、启用、按需读取、实际加载分别表达。未取得对应证据的项目显示「尚未核实」。
- MCP 保存配置、授权、工具发现与本轮加载不是同一状态。业务 CLI 的机器安装也不表示所有员工都可见或已登录。
- 缺目录、不可读取、未适配运行时、超时、离线及旧客户端未上报均有明确原因。上次记录可保留，但会标记过期，不能成为新配置的当前证据。

## 数据链路与边界

`GET /api/workspaces/:slug/employees/:id/capability-inventory` 仅返回当前选择员工的缓存，不派发检查。`POST .../capability-inventory/refresh` 使用专用 `employee.capabilities.inspect` 动作，合并当前绑定的重复刷新。

快照绑定工作区、员工、所属用户、设备、运行时、Profile、Bot revision/controlEpoch（如适用）与配置指纹。创建、领取及执行准入重新核对绑定和访问权限；读取时拒绝将旧配置或迟到回执作为当前证据。快照存放在既有动作回执中，不新增业务任务、会话或安装系统。

客户端声明 `employee_capabilities_inspect_v1` 后才可接收刷新。旧客户端保留既有运行能力，清单显示未上报；本批源码交付不会自动升级用户电脑。

本机采集只读明确的 runtime HOME、已登记工作目录及可信安装元数据。共享安装发现按设备缓存，员工授权证据必须另外绑定员工和 Profile。不会遍历整盘、执行任意 `--version` / `help`、调用模型、运行手机动作、安装工具或读取登录凭据。只返回有界名称、摘要、版本、来源和脱敏状态；不上传环境变量、命令参数、原始配置或 Skill 正文。

达到条目、根目录、深度或遍历上限时返回 `partial / inventory_truncated`，不提供精确总数。Hermes 声明但未检查的外部技能根同样明确为部分结果。检查调度设置 15 秒截止与 60 秒领取租约；普通同步本地文件读取无法在系统调用阻塞时强制中断，服务器到期仍将无有效回执的结果标记为未知。

## 实现与验证入口

- 客户端：`src/employee-capability-inventory.mjs`、`src/local-action.mjs`、`src/daemon.mjs`。
- 平台：`backend/employee-capability-inventory.mjs`，沿现有员工可见性和设备访问授权。
- 页面：`frontend/src/components/EmployeeCapabilityInventory.vue`、`frontend/src/employee-capability-inventory.js`，复用 `BotWorkbench`、`BotKnowledgePanel`、`BotMcpPanel`。
- 回归：`test/employee-capability-inventory.test.mjs`、`test/employee-capability-dispatch.test.mjs`、`backend/employee-capability-inventory.test.mjs`、`frontend/src/employee-capability-inventory.test.mjs`、`test/bot-capabilities.test.mjs`。

验收分别记录源码测试、页面布局、候选采集器对真实目录的只读检查与已安装客户端状态。合成场景只证明对应边界；不据此声称全员工具已安装、已授权或生产已上线。
