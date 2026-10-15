# Bot 模型登录续期与失败原因修复

## 实际故障

“闲鱼运营大神”主聊天在 2026-10-15 17:26（Asia/Shanghai）的动作 `action_dbd37516-1c96-4731-a133-4daa8ceb59ca` 失败。服务器保存的完整输出为正常的 `Resumed session` 提示，随后是 `Hermes Bot bootstrap rejected: bot source authentication refresh required`。根进程和进程树退出均已确认。

17:31 查询时，李金晋电脑已运行 `855e4fa7602b58de3b5eb93799834d67dc2afa7b85b24f0c55acbd8f5e89f78a`、PID 8832，已完成此前多图版本升级；不能继续沿用 16:27 的“仍是旧版”快照解释本次故障。本次失败不是根据截图推断的网络故障，也不代表会话丢失。

## 修复

Bot 的独立 Profile/HOME 原本引用同一份来源模型登录。早期预览代码却禁止原生认证写回：一旦需要刷新或恢复凭据，保存函数就抛出 125。这可能发生在 OAuth 已轮换旧 refresh token 之后，因此反复重试无法解决。

移除两处写回拦截，保留经过身份绑定检查的来源 `auth.json` 路径。刷新继续由原生 Hermes 的跨进程锁、事务与原子写入完成；多个 Bot 共享同一权威认证文件，不复制 refresh token 到各自 HOME。各 Bot 的配置、会话、状态库和记忆仍独立。正常续期会更新来源认证文件，这是有意行为。

失败摘要原先只取输出第一行，因此把正常的恢复会话提示显示为原因。现在优先结构化终态错误和明确 bootstrap/provider 拒绝，忽略恢复提示与 session_id 尾行；保留脱敏和长度限制。同条事件兼有 text/error 时两者分别处理，最终错误覆盖先前可恢复错误。

## 验证与范围

- 已安装 Hermes 的临时目录、虚构凭据回归 9 项通过。执行真实原生认证读取、锁、刷新事务与原子写入，仅 HTTP 返回使用 MockTransport；socket 连接和监听均被禁止。
- 覆盖两个 Bot 子进程同时读取旧凭据后仅刷新一次、第二个采用新凭据、随后复用、不同来源隔离，以及 401 invalid_grant 保留原生 AuthError/relogin_required、凭据不写坏、不伪报成功。没有接触真实登录文件或调用真实模型。
- 相关 Node 回归 36 项通过。另一个原有 Windows 路径断言在 Mac 失败，已用未修改的 HEAD `f4d4568` 隔离复现；本次不做产品 Mac 适配。错误摘要专项 14 项通过，lint 144 个源文件通过，diff 空白检查通过。
- Windows 专项 harness 的原生 fixture 数量断言随新增测试更新；只做语法检查，本次没有启动其监听型集成测试。

## 发布与使用

修复在 Windows 执行客户端。先推 GitHub，随后发布官方客户端包，主站/API/数据库无需变更。设备必须从终端执行 `ziwei_user update` 并核对新 build，之后再进行真实 Bot 运行验收；本机无网络回归不能代替该验收。

如果此前被阻断的刷新已经消费旧 token，升级后仍可能收到原生 `refresh_token_reused` 或 `invalid_grant`。这时需要在运行电脑重新登录对应来源 Profile 的 Codex 订阅；不能回灌旧认证备份或不断复用失效 token。没有证据时不要求用户重建员工或删除 HOME。
