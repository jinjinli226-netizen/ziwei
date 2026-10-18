# Bot 默认不限轮数

用户明确要求无需开关，所有数字员工普通聊天默认不限轮数。此记录取代此前 d453 的可选模式；历史发布记录保留。

## 最终行为

普通 Bot 聊天统一使用 `9007199254740991` 的原生迭代计数。无配置、旧 `maxTurns:20/100`、旧 `turnLimitMode:bounded/unlimited` 都使用相同有效值。此正整数能无损通过 JavaScript、JSON、YAML、Python，避免不同 Hermes 对零或负数的解释差异；24小时内实际不可达，不称数学无限。

删除设置中的轮数开关和单次轮数输入，只留单次最多24小时、可手动停止。无需修改既有 Bot 配置或重新创建 Profile/HOME。保留旧 wire 字段及严格校验，以免旧创建重试指纹变化；Goals/Kanban 和主动工作累计预算保持独立，未将这些预算改为巨大数。任务完成、模型错误或人工停止仍可提前结束。

Profile YAML、实际 CLI argv 统一调用同一 helper。所有 Bot 的启动回执均返回 `mode:unlimited`、有效轮数、86400秒预算和 `configured`；配置检查匹配员工、revision、原生有效轮数后标记 `validated`，不把配置检查当作真实长跑。已有进程退出证据在拒绝时保留。非 Bot 上下文不新增此回执。

此前 df2 的默认两个不同员工主任务加一个直接协作槽保持；同员工保序、停止独立通道、隔离状态和持久交付不变。

## 验证与发布范围

112项定向回归全通过，0失败、0跳过；覆盖旧配置、原生形状子进程的argv/YAML、config-only有效轮数回读、退出证据、24小时预算、真实独立子进程并行、UI编译和创建幂等。lint192项通过。最初单独CLI fixture遇到既有3秒版本探测超时；串行综合测试通过，生产探测超时没有改变。

API仍仅覆盖 `src/hermes-bot-config.mjs`，保留 d453 线上混合来源的 runtime/adapters/启动证据及数据库。完整执行代码由新Windows客户端包提供。必须更新目标电脑后下一次执行才使用新默认；已启动任务不追溯改写。未把本机fixture当作Windows模型连续100轮或24小时现场证明，不重放闲鱼原业务。

发布准备以 d453 实际线上目录为基线，新建独立 stage、完整 Git 归档构建网页及冷包，保留原发布目录、下载包和标记。先推 GitHub 再发布，正式结果见下方续记。

## 已发布（2026-10-18 11:13，Asia/Shanghai）

产品 `12d5aa9f6d62a1b3173ff787efcf5a1e225ca38b` 已先推GitHub两条既有分支。UTC03:10:05 API/网页切至 `/opt/ziwei/releases/default-unlimited-12d5aa9f6d62-3f149f60/v2`，PID409294；UTC03:11:17官方包发布，build `161cc99010d6cdee4e3d8834135ac2ed4e8fb2031b746755b7d53de0b76dfb0b`，包1132117字节，SHA256 `593294a3961ca4004309932276d3f2f81ad3fef1f84c0cf03888efe49bfc134c`。旧目录、下载包及发布标记保留。

UTC03:13:45独立postcheck全部14项通过，含GitHub、API/网页及官方下载哈希、配套版本、数据库身份/schema、其他服务及旧下载保全。53项CLI源码与Git归档一致，网页冷构建通过，本机未启动监听，端口中心check通过。冻结manifest为 `c18ca97a38e0daa051b82160b7b34cf4ea59fd081e8427b12f3f1a0e0a68ebfd`，payload为 `54e8ff3ee425b19040dc6708161d3b3203ae8fb01d88f699c1f1359054012eda`。

正式owner页面只读DOM确认：高级运行设置保留主动工作累计预算、截止时间、工具权限和“单次最多24小时，可手动停止”，没有普通聊天轮数开关/输入。没有保存或改写员工配置。浏览器输入命令曾超时，后续DOM实际已展开；截图因native pipe关闭未取得，未声称截图验证。

UTC03:13:42李金晋电脑仍在线、PID21776、旧623d5585 build；闲鱼r7/e17 active且没有在途动作。安装本次新包后下一次执行默认不限轮数，同时取得并行修复，不需要逐个Bot重新保存/启用。尚未取得新build或真实provider长跑、并行现场回执。

## 用户升级后的真机验收通过

UTC03:25新build161cc990和PID34836心跳已确认。闲鱼配置检查 `action_edc94400-5d3d-4bd5-87a0-a582a4d035d6` succeeded，原生有效轮数9007199254740991，turnLimit.mode=unlimited、runBudgetSeconds=86400、status=validated。没有修改员工原r7配置，旧maxTurns100留在兼容数据中，不再决定普通聊天的有效轮数。

通过正常owner登录和正式聊天API创建两个专用验收对话，各派发一次只读终端+CIM祖先PID观察、45秒等待任务。闲鱼动作f0113dd0和知微7fbf1d39都真实运行成功，原生Codex订阅请求边界匹配gpt-6.1-sol/max；实际rootPid分别2632/31616，Windows根和树均退出0、activeProcesses=0。两次真实执行回执均为默认unlimited/86400。

另通过现有sessions.read原生只读入口读取各自本次Session，而非采信助手转述。terminal工具原始消息中的UTC区间重叠45.3943362秒，同机10MHz QPC重叠45.3947017秒；工具call_id匹配各自assistant工具请求，nonce/session/employee/profile/revision/device及祖先链绑定都核对。只测试终端等待，无手机、店铺、外部消息或旧任务重放。短测试不构成连续24小时或超过100轮的长跑证明。

已保存[脱敏验收摘录](../qa/2026-10-18-bot-unlimited-parallel-live.json)，原始回执与独立校验器保留在私有.local/live-unlimited-parallel。一次只读快照查询失败后重读成功，没有重发测试。独立本地proof校验及13个篡改负例通过。当前无需用户再升级、重建Bot或另开轮数开关。
