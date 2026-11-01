# Averinyo Hermes Gateway 协作与冷启动修复

2026-11-01，用户经 CEO 日报要求紫薇主会话协助。目标是 ziwei-ops 现有三名独立 owned-profile Hermes；未创建员工、改前端/API/DSH、重放旧 action 或手写 journal/SQLite。

## 根因与修复

- `ziwei_collaboration` 原来只在执行子进程注册，常驻 Gateway 的 session policy 不认识这个 alias。`12d3c309` 提取并复用原有 message_agent/delegate_task handlers，通过 session-private MCP 挂载；只在绑定成功后过滤 alias。每次调用核对实例 HOME、员工、工作区、Profile 和 ownership key，action 凭据只通过私有环境交付，平台继续负责来源授权和派发。
- 实测共享 owner 冷启动约147秒，原 ensure 默认60秒提前 deadline。`74b28e6` 新增 `src/hermes-gateway-readiness.py`，仅聊天执行将默认预算延长至180秒，保留显式预算和终态，仍调用一次 native ensure，未增加重试或另建 owner。
- 39/39相关回归通过，含实际安装的 native parser、私有 stdio、跨Profile拒绝，以及实际 native ensure 函数配虚拟时钟的147秒启动/180秒期限/已有owner/终态拒绝。独立代码审查未发现阻止发布的问题。

## 正式升级与现场证据

原生 WMI 上下文运行正式 updater；五个修复文件以精确Git字节覆盖已安装基线后打包，避免带入其他待发布代码。

- 包SHA256：`1ee5f10011b8a4856841b06420f7d759a3e82410780a10f56234422bd1b24ea4`
- build：`688d6582022472835acc76d62fb5402bbfe057d56981afc946e1ba078774b9ba`
- device：`device_b7b53eaa-094e-4290-8fae-f8c3ede3f6e5`，daemon PID7552
- native配置SHA保持 `1eb525a9be88126517a266aa63059fc87cc430ccb1f85628a1ad497fe0275171`；MSIX旧bigtron配置未写入。
- 共享Gateway PID6716及15:39:29创建时间不变；未用冷启动现场重启来验证超时修复，冷启动边界由隔离native-loop测试覆盖。

三条全新正式请求均 succeeded，读取项目README，并实际调用各自私有 `mcp__editor_ziwei_collaboration_<session>__delegate_task`，参数 `{"action":"list"}`，返回 `{"actions":[]}`。实际工具完成事件、独立native session/Profile、模型回复、code0及root/tree退出确认均已保存。

| 岗位 | 新action |
| --- | --- |
| 主理人 | `action_5023f7cb-3e93-4556-875f-8208d9f6d10a` |
| 系统自动化 | `action_5c6dfd84-02b4-427f-ba27-3eae1c2197af` |
| 增长宣传 | `action_00efb328-dfe9-4479-b43e-1584717ee231` |

原两条deadline和一条invalid_params仍为failed。验收快照 healthz/readyz200、ready/safe/stopSafe=true、pending/blocked0。另有两条非本次验收action的409 archived-unconfirmed诊断，均blocking=false；原证据保留，未清除或伪称server success。

完整无密钥回执：`D:\AINavtie\ops\ziwei\averinyo-gateway-20261101\FINAL-ACCEPTANCE.json`，包含各工具完成事件ID、模型输出、退出证明与原失败事实。这次只验收了协作工具的只读list；未发送员工消息、委派经营任务或启动对外业务。
