# Bot 模型密钥安全通道（2026-10-25）

Provider 与模型先保存；独立密钥走专用接口，不进入 Bot config 或通用 A2A payload。空输入由页面保留旧值。保存新值时浏览器以目标设备登记的 RSA 公钥包裹 AES-256-GCM 密钥，正文仅在浏览器和设备受控内存中解密。OAEP label 和 GCM AAD 绑定规范 JSON：用途、工作区、员工所有者、员工、电脑、Profile、Provider、API Base URL、公钥标识和凭据版本。服务只保存密文和元数据，读取不返回密钥。

`backend/bot-provider-credentials.mjs` 的独立表由服务初始化，兼容旧数据库；`bot_secret_devices` 保存公钥，`bot_provider_secrets` 保存密文或清除墓碑。服务每次检查现有员工、成员权限、目标设备及运行绑定。替换和清除在事务内递增凭据版本以及 Bot revision/control epoch，清空旧校验并回到 draft；存在 active_action_id 时拒绝修改。替换和清除递增版本，旧投递/ACK 不恢复旧密钥；修改人格等无关配置不要求重新输入。改变电脑、Profile、所有者、Provider 或 Base URL 会转为 pending，拒绝把旧密钥用于新目标。

用户接口：`GET/PUT /api/workspaces/:slug/bots/:id/provider-credential`。设备配对凭证接口：`POST .../bot-provider-credentials/device/register`、`GET .../device/deliveries`、`POST .../device/ack`、`GET .../bots/:id/provider-credential/runtime`。均须 TLS（隔离本机测试可 loopback），禁用重定向；响应 no-store。设备注册新公钥后不允许静默更换已有公钥。

Windows 客户端使用当前 Windows 用户 DPAPI 加密 RSA 私钥和每员工密钥文件；目录位于客户端用户目录下 `bot-provider-secrets/<origin/workspace/device 摘要>/`，路径权限收紧。身份文件通过原子独占链接发布；每员工写入加进程锁，版本比较与原子替换在锁内，旧投递不会覆盖清除。没有受支持 OS 安全存储的客户端保持 pending，不能降级成明文。非 Windows 设备的安全存储适配尚待后续实现。

每次实际执行前，客户端从专用接口重新确认最新版本并安全保存、回执，再加载 Key；离线时不启动独立 Key 模型。清除后保留独立状态，缺密钥明确失败，不回退来源授权。旧服务 404 只容许未使用过独立密钥的历史 Bot 维持原行为；动作标记或本地已有独立记录均禁止降级。历史来源 Profile、auth、HOME、记忆、会话不迁移、不删除。

已只读核实本机 Hermes 源码 `hermes_cli/auth.py` 支持 `deepseek`/`DEEPSEEK_API_KEY`，`hermes_cli/runtime_provider.py` 暴露 `resolve_runtime_provider(requested, explicit_api_key, explicit_base_url, ...)`。`src/hermes-provider-key.py` 对该真实接口做进程内包装，显式注入并校验返回的 Key/endpoint、拒绝共享凭据池和跨 Provider 切换；旧接口不支持时启动前失败。Key 在初始化后从子进程环境删除，日志格式化及回传流额外遮蔽精确值。

验收：`node --test test/bot-secret-channel.test.mjs` 覆盖 11 项加密绑定、双员工隔离、替换/清除/迟到、权限、变更目标、离线/旧服务拒降级和受保护墓碑。`D:/AIpartner/.tools/omi-qwen3/Scripts/python.exe -B test/hermes-provider-key.test.py` 覆盖 3 项显式 Key 路由、旧接口拒绝、错误来源 Key 拒绝。已用合成值完成真实 Windows DPAPI 内存往返；没有向真实员工同步、调用付费模型、部署或升级客户端。页面保存、电脑安全保存、配置检查、真实调用分别验收；最后两项不能由密钥保存成功推定。

当前客户端每次启动独立 Key 模型或执行配置检查，还须通过专用 ACK 提交 actionId/protocolVersion:1。服务持久记录非敏感 action、配对凭据、员工、密钥版本、Bot revision/control epoch 准入；有独立密钥记录或清除墓碑时，旧客户端缺少准入便不能沿用来源认证启动或提交成功。未配置过独立 Key 的历史 Bot 保留旧客户端兼容。纯目录/创建 Profile/非模型维护不要求密钥准入。配置检查使用独立密钥调用原生 resolver 做零模型调用协议校验；同步旧校验入口对独立模式明确拒绝，生产采用异步受监督校验。

额外隔离证据：使用目标机已安装 Hermes 自带 Python，临时 HERMES_HOME 及合成 DeepSeek Key，禁止 socket.connect，真实 resolve_runtime_provider 显式 key/endpoint 校验通过，未调用模型。AST 核对 cli_agent_setup_mixin.py 在方法内动态 import resolver，main.py 未缓存该别名，因此进程内包装会被真实模型初始化读取。Python 日志最终 Formatter 连同异常 traceback 脱敏，Node 完整输出行在解析/回传前遮蔽原值及 JSON 转义值。

防旧客户端回滚重放：独立 Key 的 bot-start 与成功 result HTTP 必须携带 `x-ziwei-bot-secret-protocol: 1`，服务在 action admission 以外再次检查当前请求协议，历史 admission 不能替代本次客户端支持证据。自定义 Provider 的独立 Key 必须先保存显式 API Base URL。

Windows 隔离集成测试还通过真实 createLocalActionExecutor 验证配置检查顺序：专用密文读取、DPAPI 安全保存、action 级 ACK 在 bot-start 请求之前完成；启动请求含当前协议头。测试在原生启动前主动拒绝，不监听服务、不调用模型。
