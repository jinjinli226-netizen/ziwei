# 数据保留回退候选契约

本契约描述 E02 隔离候选。正式环境部署、GitHub 推送和 Q01 独立验收没有由本地演练授权。

## 版本与产物

V1 API/前端基线为 `2ebe3dfee2f438a0b6aa3045d46c83bb67d7341b`，公开客户端源码为 `324731e79c6a855fad1f501379630bbfa67e5d34`。原公开安装包 SHA256 为 `1592d107fcbcf27b9ec5e0d909f871ffa3851d9e136e015713156144d70fc8cc`。V2 产品基线为 `5643d5d36c3cd85d74ab849c77f52b6f69555093`。`0.1.0` 是历史复用的 npm 版本，不能作为产品版本或安装身份。

构建导出冻结 Git 基线后施加明列的保护补丁。每一版本包含前端 ZIP、API ZIP、离线依赖随附的 Windows 客户端 TGZ，以及 manifest。manifest 记录候选提交、全部源码/补丁摘要、产物大小/摘要、安装后源码摘要和实际客户端 build。npm 在 Windows 安装 bin 入口时可能归一化换行，`installationChanges` 单列实际前后哈希，不把源码 build 和安装 build 混为一项。安装前核三项产物；运行时核 PID、入口、config 摘要、实例 nonce 和实际 build。

V1 兼容包没有 V2 执行器，其静态产品角色无法由环境变量或 action payload 改为 V2。V2 包包含保护层及原生树、缓存和补传证据支持。未提交构建仅供调试；独立 QA 必须接收 clean SHA 的最终新目录。

## 状态与允许变更

`prepare` 在同一数据库保存操作 ID、精确冻结版本及原身份意图，然后冻结 V2 新写入和执行。只读 inspect/plan 不注册持久触发器，也不使队列过期。失败保持 preparing。相同操作重复可回读；不同操作不得覆盖未恢复的意图。

preparing 期间，原已 ACK 动作可凭原设备提交完成回执，并同步保存该动作的助手消息、任务结算和 Routine 完成记录。回读 ACK 的补传许可不续租、不改变 payload/身份、不授予新启动。未知、过期 ACK 和不完整结果仍阻切。新消息、任务、配置、控制、Routine、Gateway、协作和手机业务不得通过补传上下文执行。该上下文是本数据库连接的私有同步闭包，不由 HTTP 参数设置。

`seal` 要求原数据库没有 V2 pending/acked、uncertain、未收敛 Routine/webhook/Gateway 入站或手机运行；原客户端处于经实例 nonce 确认的 draining，原 native tree 已退出，缓存、补传 metadata/blob、连接身份和 HOME marker 都可核验。原文件及目录在异步采集后、提交事务内再次核摘要。任何缺失、临时文件、未知树、身份不匹配都拒绝；不删除证据、不清队列、不用过期冒充排空。

seal 仅把 Bot 员工 status 改为 paused、Bot control_state 改为 paused 并增加一次 control_epoch、Routine status 改为 paused 并清 next_run；更新对应时间和转换审计。它保留 employee/Bot/conversation/Routine ID、workspace、device、runtime、profile binding、初始 provision ID、revision、配置、已完成 action/result、历史消息、文件和记忆。

`restore` 由 V2 保护包检查原快照身份和上述封存变更后解除版本 fence；Bot 和 Routine 仍暂停。显式版本化 activate/resume 才启动未来工作，不补历史 tick、旧入站、重试或 action。`abort` 仅撤销尚未 seal 的准备；不会重放或替换原动作。转换表和审计表只由私有转换方法写入。

## 两层执行保护

服务器读取真实 Bot、会话、任务、Routine、source action 和原 provisioning 关联；HTTP/MCP/服务 SQL 共享同一持久 fence。SQL 触发器覆盖原对象写入和原 action 身份，冻结时的终结例外仅限原设备、原已 ACK 动作的同步结算。技能卸载先核真实依赖者，再在 savepoint 内整体提交。

本机在原 wire action 被注入工作目录之前核完整 payload 摘要。封存期间还核实际 selected HOME/目标的 canonical 路径、原 marker 和服务器提供的保护 HOME，拒绝大小写/junction/相对目标别名进入 owned Bot HOME。default、普通 Profile 及 Creator 的来源 HOME 不因总 Hermes 根内有 Bot 而被全局封禁。

Gateway connect 的成功结果保持原样；真实 worker 退出后，将同 source action、平台、版本、nonce、HOME 和受监管 root PID 的追加生命周期证据 fsync 到原缓存。命令绑定同一个原连接。缺乏原 worker 的 alreadyDisconnected 仍 unknown。普通 runtime 结果不能自称 Gateway 来借用别的树退出证据。

## 备份、切换与故障处理

先保存操作前一致 SQLite 备份作为审计/灾难恢复副本；正常版本切换始终使用原数据库和对象目录，不还原整库。备份含隔离凭据，留在私有 QA 目录，不上传公开仓库。各阶段使用原 server/client 入口，API origin、数据库文件、配置和 HOME 根保持一致。

候选 CLI 默认只读。apply 目前限定标记为本次隔离演练的根目录、根内 DB/client/config、明确包目录与精确候选提交。依次执行 prepare → drain → seal，之后才能停原客户端/API并换为 V1 兼容包；恢复时安装同批 V2 包、沿用原 DB/HOME、执行 restore。实际在途结果必须先收敛。V1 兼容包不能启动 Bot，V2 保护包不能绕过未封存意图。

失败时保留 operation、原 action ID、完整缓存/blob、日志和失败回执；先确认原设备/入口/实例，回读原状态。不能换 key 重建，不能复制 auth/HOME、修补未知树为零或强行恢复整库。旧 V2 回执缺少可靠进程树/资源绑定时，本候选明确拒绝封存，不能用事后猜测补证。

## 验证与边界

四阶段演练在新建私有 HOME 中运行已安装 Hermes 的实际 SDK；合成 custom 和 openai-codex 凭据只指向 loopback 协议夹具，Python socket/DNS 拒绝外网。原安装源码和来源认证摘要前后核对。测试 Provider 返回合成答案与真实 memory 工具调用，证明执行/保留协议，不证明模型业务质量。

本地回归、真实 Windows Job 案例和四阶段回执分别报告。Q01 RB01–30 的独立结果仍由 Q01 填写；没有现场证据的故障、外部入口、Group、真实 Gateway 平台、UI 切换、真实付费 Provider、24 小时运行均不得从相邻用例推定 PASS。前端产物已经构建/核摘要，四阶段主要运行 API 与客户端。

诊断使用项目内独立 observer：每 10 秒保存 PID/实例/健康状态，追加并轮转 stdout/stderr 和退出证据；下次启动记录上次未正常退出。隔离强制退出 fixture 验证后才标记诊断已验证。旧真实项目和端口保持不变。
