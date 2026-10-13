# 新 Bot 的专属 Hermes Profile 首链接口

本合同对应 E02 owned Profile 首链。新建 Bot 的原生命名 Profile、配置、记忆、会话和状态使用同一实际 HOME。已有 Bot/Creator 不迁移。手机组合不在本次交付范围。

## 创建与身份

`POST /api/workspaces/:slug/bots` 与 `/mcp/v1/workspaces/:slug/bots` 使用同一服务。

```json
{
  "name": "研究助手",
  "targetDeviceId": "device_...",
  "sourceProfile": "default",
  "model": "已配置模型",
  "idempotencyKey": "客户端保存的稳定创建标识"
}
```

`runtimeProfile` 仍作为初始化来源的兼容输入；与 `sourceProfile` 同时给出时必须一致。允许的来源是当前目标设备发现的 default 或普通原生 Profile。另一个 owned Bot 不支持作为来源：创建前返回 `BOT_PROFILE_TEMPLATE_UNSUPPORTED`（400），不建立新员工。设备开通再次检查同一限制，不递归继承认证。

环境发现及 Bot capabilities 的 `runtime.profiles[]` 增加布尔字段 `owned_profile` 和 `initialization_source`。E03 的“初始化来源”选择器过滤 `initialization_source === false`，或显示为不可选并说明是另一个 Bot 的专属配置。旧客户端心跳未携带标记时，服务端也会用已知 Bot 绑定补全；设备上的最终检查仍是权威。

新请求返回 **202**，幂等重复返回 **200**。employee、主聊天、专属身份和开通 action 在同一事务保存。返回完整 Bot，示意新增字段如下：

```json
{
  "instance": {
    "mode": "owned_profile",
    "profile": "bot-<服务端生成的稳定24位hash>",
    "templateProfile": "default",
    "ownershipId": "服务端UUID",
    "provisionActionId": "action_最初开通动作",
    "authMode": "source-native-store",
    "home": null,
    "provisioning": {
      "actionId": "action_当前开通动作",
      "status": "pending",
      "authentication": null,
      "error": null
    }
  }
}
```

新 Bot 的 `employee.runtime_profile` 就是 `instance.profile`，不再是模板。`templateProfile` 仅指初始化和认证引用来源。员工改名不改变 Profile、ownershipId、HOME。客户端不能提交 HOME、ownershipId、profileMode 或 isIndependent 以伪造归属。

旧 Bot 的 `instance.mode=legacy_private_home`，`profile/templateProfile` 仍为原来源，`home=null`、`provisioning=null`。这个 null 不表示运行中使用来源 HOME，也不能显示为已迁移。现有员工 `initialize` 保持此模式。

## 状态与下一步

| 回读状态 | 含义及允许的下一步 |
| --- | --- |
| `pending` | 开通已排队；按 `provisioning.actionId` 查询原 action |
| `acked` | 目标设备已领取；继续查询原 action |
| `provisioned` | 收到身份匹配、原生 HOME 一致和成功退出证明；可进行 validate |
| `failed` | 确定失败；显示原错误，可显式恢复同一身份 |
| `expired` | 未领取即到期；可显式恢复同一身份 |
| `uncertain` | 包含执行未知，或领取后到期；只查原 action/停止证据，不新建替代实例 |
| `not_started` | 无当前开通 action 的防御性状态；正常新建不会出现 |

成功回执的原生 HOME 必须是 `profiles/<专属名称>`，`home === profileHome`，并匹配 workspace、employee、device、profile、templateProfile、ownershipId、最初 provisionActionId。设备与服务端共用证明规则：launched、rootConfirmed、treeConfirmed 都为 true，rootExitCode=0、activeProcesses=0，且没有取消、信号或失败矛盾证据。目录存在本身不构成成功。

`provisioning.authentication` 是开通时按**新 Bot 实际 provider/config 和受信来源**取得的快照：`configured` 或 `required`，不是云端登录/模型成功证明。更换 provider 后须重新 validate，并以实际模型执行回执判定可用。来源模型可初始化；来源 OAuth、`.env`、记忆、会话和全局 MCP 不复制。

首链顺序：create → 查询原 action → GET Bot 确认 provisioned → validate → 查询验证 action → GET 最新 revision/control_epoch → control activate → 主聊天或普通任务。未完成开通时，validate/native/model/task 返回 `BOT_PROFILE_NOT_PROVISIONED`。新 Profile 尚未出现在下一次发现心跳时，服务端可凭受信开通回执派发，设备仍须验证实际原生配置及归属。

## 恢复与 MCP

`POST /bots/:id/provision` 接受 `{expectedRevision,idempotencyKey}`，返回 202 和 `{action,duplicate?}`。pending/acked/provisioned/uncertain 返回当前原 action，不另建；仅确定失败或未领取到期后建立恢复 action，仍使用同一 profile/ownershipId/最初 provisionActionId。当前 `provisioning.actionId` 可以变，顶层 `provisionActionId` 不变。已发布目录只核对归属，不覆写已有配置或记忆。

`ziwei_bot` 增加 `operation: "provision"`，create 输入支持 `sourceProfile`；工具说明和 Creator 管理指引均要求等待开通再 validate。原有 runs/action 查询、revision/control_epoch、设备绑定、忙碌/暂停/停止与不确定执行保护保留。设备将 `hermes.bot.provision` 纳入原生进程及持久化 started 记录；重启发现无终态时隔离，禁止重放。

## 认证及本轮边界

`source-native-store` 复用现有认证：来源 `.env` 仅加载到当前进程；来源原生 OAuth 存储只读引用，不复制 token。两个原生写入口 `_save_auth_store`、`_save_codex_tokens` 在 Bot 进程内拒绝写入。需要 OAuth 刷新时运行失败，须处理来源授权；本轮不声称支持自动 OAuth 续期，也不要求每个 Bot 注册新的模型账号。

实际验收包含本地协议 provider、两 Bot 原生创建、主聊天、普通管理任务、重建执行器后复用、记忆隔离和原生 memory read。管理 API 创建任务不等于管理 MCP loader 已握手；手机 MCP loader、手机命令及完整 native driver 组合留待独立后续验收。
