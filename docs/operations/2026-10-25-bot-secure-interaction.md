# Bot 非交互安全输入与续接（2026-10-25）

## 用户入口和生效条件

升级 API、网页和目标电脑 ziwei_user 后，员工主聊天在当前执行下显示安全输入、确认或补充问题卡片。输入不会作为聊天消息发送。答复后继续原工具调用；等待期间原执行仍在运行，不能把卡片提交当作任务完成。可取消，默认五分钟到期。

只有当前员工所有者能看到和提交请求；共享可见性不自动授予其他成员输入凭据的权限。read_only、Routine、原生后台和其他程序化 unattended 上下文不开安全输入。API/电脑客户端版本缺少协议、电脑离线或 Hermes ABI 不兼容时，保留普通工作的原行为，交互能力为 unsupported/pending；不会自动切到其他员工或本机默认 Profile。

## 已核实的原生协议

只读核对本机 Hermes 源码（2026-10-25），没有执行任何真实员工任务：

- `agent/vault_backends/unlock.py` 提供按线程的 unlock/save_login/code callback，并在 headless 单次查询返回不可提示。保存的有效 Vault 登录和已解锁会话仍由 Hermes 原逻辑复用。
- `run_agent.AIAgent.run_conversation` / `clarify_callback` 承载本轮执行和问答；`tools.approval._presence` 判断人类交互表面，原生审批 gate 继续负责 hardline、用户 deny、范围与持久许可。
- `hermes-interaction-bridge.py` 只在绑定的首个 Agent 的本轮调用内注册 callback，恢复原 callback；cron/unattended/其他 Agent 保持原生行为。不会改环境成全局 yolo，不改变现有 execute 普通工具授权。
- 当前 Hermes 原生 save_login 会把账号 identifier 作为模型元数据返回。桥接层将此结果改为白名单，只保留状态、handle、origin、填充成功与否，不返回账号；密码/账号/验证码注册原生 redactor。网站账号字段仍需本人在页面核对，不声称完成整个网站登录。

现有 Hermes 解释器内已核实 `cryptography 50.0.0` 可 import。没有下载模型、安装环境或改 Hermes 源码。其他版本若缺 cryptography、callback 或路径验证则明确 unsupported，不退回明文通道。

## 接口和生命周期

服务模块 `backend/bot-interactions.mjs`：

| 调用方 | 接口 | 行为 |
| --- | --- | --- |
| 当前设备 | `POST /a2a/v1/actions/:id/interactions/start` | 返回服务端核对后的 action 精确 binding |
| 当前设备 | `POST /a2a/v1/actions/:id/interactions` | 发布公开请求描述和五分钟 TTL |
| 所有者网页 | `GET /api/workspaces/:slug/bots/:id/interactions` | 返回卡片元数据、公钥、密文绑定；不返回答复 |
| 所有者网页 | `POST .../interactions/:requestId` | 只接收浏览器加密 envelope |
| 所有者网页 | `DELETE .../interactions/:requestId` | 取消并销毁待投递密文 |
| 当前设备 | `POST /a2a/v1/actions/:id/interactions/:requestId/claim` | 复核归属后一次性取走 envelope |

绑定包括 workspaceId、employeeId、profile、deviceId、actionId、revision、controlEpoch、requestId、kind、expiresAt、keyId 和 purpose。每次提交/投递复核当前 owner、paired credential 撤销、设备、公钥版本、action active 和 Bot 版本。归属改变、停止/取消、迟到答复不能复活请求。相同 request 重试只观察原请求，不重跑业务。密文只保存在有界进程内 Map；服务重启使未完成请求失效。claim 的网络结果丢失不重复投递原答案；当前工具失败关闭，不能把未知投递当作成功。

浏览器用 WebCrypto RSA-OAEP SHA-256 + AES-256-GCM，AAD 绑定精确请求。目标设备复用每台设备受操作系统保护的私钥，仅内存解密临时答复，不持久保存。长期 Provider Key 和临时问答 purpose/lifecycle 各自隔离。

Node 与 Python 使用独占随机命名 pipe（Windows）或权限 0700 目录内的 0600 Unix socket；不是 TCP 服务。包体使用独立 AES-GCM 会话密钥认证加密。私有 IPC 参数在 Python 引导时消费并从环境删除，不传给普通工具子进程。敏感回答不进入通用 A2A payload、数据库、聊天消息、模型提示词、URL、日志或截图；普通澄清答复按原生工具协议返回员工。secret 输入提交失败和切换员工后也会清空表单。

## Team 授权边界

只读核对提供的 Team CLI 1.0.2 交付包 `src/auth.mjs` 和官方候选文档：`AuthClient.login` 使用设备授权 PKCE S256，`notify` 展示受信 issuer 验证地址和 user code；device_code/verifier 留在设备进程。`machineLogin` 必须使用已受信登记的员工专属 client/subject/worker 文件，AT 最长 300 秒；不是共享管理员或密码导入。`accessToken` 在原范围复用有效 AT/RT，worker 到期重新显式授权。

本次没有访问 Team/身份服务器，没有重新启用 410 旧 MCP，没有为任何员工创建 Vault 登录项，没有创建或读取 worker secret。本机 PATH 未发现 Team CLI，因此 Team 专用 device-flow 接入和目标员工实际授权仍待对应设备安装与现场验收；通用安全输入桥接不代表 Team 专用授权已接通。

## 隔离验证

- `node --test backend/bot-interactions.test.mjs test/bot-interaction-client.test.mjs frontend/src/bot-interaction.test.mjs`：临时密文、两个用户/员工/设备拒绝、撤权、owner 变更、key 变更、取消/到期、重试、一次性投递、浏览器与设备加密互通。
- `ZIWEI_TEST_PYTHON=<已核实的 Hermes 解释器> node --test test/bot-interaction-client.test.mjs`：Node 与真实 Python cryptography 的加密命名 pipe 跨语言往返通过；stdout 仅验证标记，不输出合成凭据。
- `python test/hermes-interaction-bridge.test.py`：六项合成原生 callback 测试，包括审批范围不扩张、超时、取消、native callback 恢复、unattended 保持关闭和模型结果账号脱敏。
- `npm run build` 通过（既有大 chunk 提示）。没有 TCP 预览监听、真实付费模型调用、真实员工业务或正式客户端安装验收。
