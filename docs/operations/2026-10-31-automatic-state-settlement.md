# 自动状态收敛与证据保留

2026-10-31，本轮将会长期占位的异步状态改为系统自动收敛。产品不要求用户确认“未知”结果，也不把未知结果伪装成成功。

## 规则

- 有明确失败回执的动作立即结束为 `failed`；失败不会继续占用员工、队列或设备槽位。
- 队列、延后配置、设备升级、手机互联、自动化、Webhook、Gateway inbox、Codex 会话映射、维护 checkpoint 和成员 provisioning 都有期限。到期后写入明确的失败或 `expired_unknown` 结果，保留原始 payload、回执和证据。
- 服务器拒绝结果投递或租约过期时，CLI 将原始 action/result 归档为 `archived_unconfirmed`。这个状态表示“服务器终态未确认”，不会伪造成功，也不会继续阻塞 ready/stopSafe；证据通过 `maintenance.deliveryDiagnostics` 和 `diagnostics.delivery` 暴露。
- 仍有活动进程、损坏证据、身份不匹配或执行树无法确认时，系统继续自动隔离和观察；这些状态不能被普通的投递归档覆盖。达到期限后由对应监督器写入终态并释放占用。

## 入口

- CLI 投递：`src/daemon-action-delivery.mjs`、`backend/preservation-native-evidence.mjs`、`daemon/ziwei_user.mjs`
- 会话与队列：`src/codex-conversation-session.mjs`、`backend/conversation-queue.mjs`、`backend/repository.mjs`
- 配置、设备、互联：`backend/bot-deferred-config.mjs`、`backend/device-updates.mjs`、`backend/ziwei-connect.mjs`
- 自动化和维护：`backend/repository.mjs`、`src/daemon.mjs`
- 成员 provisioning：`backend/member-provisioning/service.mjs`

## 验证边界

定向回归覆盖自动归档、readyz 非阻塞诊断、队列 TTL、延后配置 TTL、设备升级 TTL、互联超时、Codex 会话归档、维护提交超时、自动化/Webhook/Gateway 过期和成员 provisioning 过期。原始证据仍可离线读取，不需要重启服务才能查看。
