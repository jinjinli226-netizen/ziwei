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

## 明确推理强度（有界补充）

Bot `config` 新增可选 `reasoningEffort`，仅接受精确原生等级 `minimal/low/medium/high/xhigh/max/ultra`。创建和版本化更新使用同一字段；未提供时不保存新字段，也不改变既有 Bot/Creator 的默认行为。新 QA 请求应明确给出模型和等级，不能以来源配置存在该值代替。

该字段随 revision 进入 provisioning/validate/聊天/任务的受信 `hermesBot.config`，新 HOME seed 与每回合 HOME 的 `agent.reasoning_effort` 相同。每次启动设置进程内 `ZIWEI_BOT_REASONING_EFFORT`，bootstrap 核对 raw/effective 配置以及原生 resolve_reasoning_config；managed policy 或 per-model override 改写时返回 `BOT_REASONING_MANAGED_CONFLICT`，不关闭 managed policy。

开通的 `botProvision.reasoning={requested,actual:null,status:"configured"}` 只证明配置保存。验证回执 `botValidation.effective.reasoning` 和模型回执 `result.reasoning` 含 `requested/effective/actual/nativeActual/mode/status/phase/evidence/actualModel` 及 employee/revision/provider/model 绑定。`phase=preflight` 是本机原生转换检查；`conversion` 是每回合转换；`request` 是原生 request overrides 和 sanitization 后、SDK 接收前的最终 kwargs 核对，均不等于外部服务接受或实际计费。模型回执的 `requests` 统计这些最终原生请求准备回执，不是 HTTP 成功次数。

明确请求被转换为其他等级时 `status=mismatch`，返回 `BOT_REASONING_UNSATISFIED`；缺少请求边界证明不能报告模型执行成功。服务端也拒绝缺少匹配 actual 的明确等级验证回执。`ultra` 不会被静默当作 `xhigh` 成功，旧未配置该字段的回执保持兼容。

当前精确等级实际验收限定 `openai-codex`；其他 provider 显式请求等级时返回 `BOT_REASONING_PROVIDER_UNVERIFIED`。Q01 已经实际 Codex endpoint/机器既有代理验证精确 `gpt-6.1-sol / max` HTTP200，响应 model/effort 匹配。项目 adapter 因而只对 `openai-codex + gpt-6.1-sol + max` 补充兼容，回执为 `requested=max/effective=max/actual=max/nativeActual=xhigh/mode=verified_gpt61_sol_max`。安装版原始转换仍是 xhigh，且未修改安装文件或其他 provider/model/level 的支持集合。其他原生匹配情形 `mode=native`。

Q01 的 `gpt-6.1-sol / ultra` HTTP400 已明确不支持；本补丁继续拒绝 ultra。Bot 以用户最新决策明确保存 max，旧 Bot 不批量改值。没有自动重试/降档代码；用户授权的 max→xhigh 仅在明确不支持时由版本化配置选择和新验收体现，超时、认证或限流不能触发降档。外部能力探测不替代正式产品连续聊天/任务首链验收。

## 认证及本轮边界

`source-native-store` 复用现有认证：来源 `.env` 仅加载到当前进程；来源原生 OAuth 存储只读引用，不复制 token。两个原生写入口 `_save_auth_store`、`_save_codex_tokens` 在 Bot 进程内拒绝写入。需要 OAuth 刷新时运行失败，须处理来源授权；本轮不声称支持自动 OAuth 续期，也不要求每个 Bot 注册新的模型账号。来源 HTTP_PROXY/HTTPS_PROXY 也保留在进程内，不强制禁用正常机器代理，不改变系统代理或预览的 loopback 策略。

实际验收包含本地协议 provider、两 Bot 原生创建、主聊天、普通管理任务、重建执行器后复用、记忆隔离和原生 memory read。管理 API 创建任务不等于管理 MCP loader 已握手；手机 MCP loader、手机命令及完整 native driver 组合留待独立后续验收。
