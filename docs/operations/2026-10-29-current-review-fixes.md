# 当前版本审查修复

本轮从 `9644320` 开始，按用户要求修复自查问题：默认开启队列，暂停后恢复不能卡住；其余按真实执行链路修正。不新增旧客户端兼容，不绕过权限、配置、设备或原生会话校验。

## 已修复

1. 暂停发生在 poll 与 ACK 之间时，不再将临时 409 持久化为永久 blocked；真实 HTTP 保留错误 code。
2. Bot 恢复为配置未改变的待发消息续授控制版本，compact ACK 更新本机实际执行输入。失败不自动暂停，新消息和恢复操作开启队列。
3. 服务端详情明确 `execution:null` 时清空旧执行并合并取消消息；字段缺失、同一动作防回退、分页与过期请求保护仍保留。
4. 清理超过等待窗口后，晚到退出回执只追加真实退出证据，保留原失败码、原因、输出和业务未知状态，不重跑原任务。
5. DSH Hub 通过原生状态接口进入设备心跳、网页运行时选择、真实 Bot 选择和员工创建。明确要求当前设备及已启动 Bot，禁止借第一台设备或员工显示名绑定。Provider、模型和工具保持所选 Bot 的原生配置，不保存会被忽略的模型覆盖，也不错误跳转手机设置。
6. DSH 在发送 prompt 之前遇到连接失败，不再把从未执行的动作永久隔离；已发送 prompt 后缺少确证的动作仍严格未知，不重放。

DSH 发现只读取原生 `/api/state`，使用 1500ms 超时与独立短缓存；不扫描端口、不启动 Hub、不上传原生 URL、token、路径、日志或配置。网页“已发现”只表示原生运行端就绪，不声称模型或 Provider 已完成真实调用验证。

## 验证入口

- `backend/conversation-queue.test.mjs`、`test/daemon-action-delivery.test.mjs`：真实 SQLite 与当前投递组件，覆盖暂停竞争、恢复、epoch 续授与完整 executionBinding。
- `frontend/src/conversation-execution-state.test.mjs`、`test/daemon-immediate-failure-stop.test.mjs`：权威空执行、取消消息与晚到退出的诊断保留。
- `test/dsh-runtime-discovery.test.mjs`、`backend/dsh-onboarding*.test.mjs`、`frontend/src/dsh-onboarding.test.mjs`：发现、网页提交、统一身份 HTTP、管理创建、聊天提交、当前 executor/dispatcher/delivery 与原生协议 fixture 的连通验证。
- `backend/dsh-session-receipts.test.mjs`、`test/dsh-current-supervision.test.mjs`：发送前失败、上传丢失恢复、scope 反例、伪造证明及不能洗掉已未知的业务。

运行记录在工作树 `.local/current-audit-fixes-frontend.log` 和 `.local/current-audit-fixes-functional.log`。测试使用隔离进程或原生协议 fixture，不调用付费模型、实际 Hub 或生产设备。源码验证不代表已经发布或完成线上模型验收；本轮不把以前未完成的全库扫描说成全库通过。

最终受影响功能集合 **446/446** 通过，全部前端 **493/493** 通过；lint 检查 333 个源码文件通过，生产前端构建及 diff 检查通过。独立复核另外确认并修复：DSH 缺失目标设备不能借首台设备证据、模型单字段更新不能绕过原生配置策略、切换 DSH 不继续触发隐藏的手机配置流程。当前审查范围无遗留阻断项。
