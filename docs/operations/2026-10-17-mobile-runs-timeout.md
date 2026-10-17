# Android 运行记录读取超时修复

## 现场与范围

用户 2026-10-17 17:17 截图显示聊天内容与执行面板已存在，错误为
`运行记录更新失败：读取超时，请刷新重试`。主控只读诊断确认请求来自
`ZiweiManager/0.2.1-internal`，不能再将其归为旧安装包或聊天历史接口失败。

当时最近五条运行的返回仍带两张 `result.outputArtifacts[].content` 图片，
合计 285,672 个 base64 字符，约占所查五条 payload/result/mobile events
461,600 字节的 61.9%。SQL 查询约 83.5 ms 不是手机完整收包时间；Nginx
200/304 也不能证明在 App 的 20 秒读取时限内完成。截图状态栏速率不作
该 HTTP 请求实际带宽证据。

本修复基于完整 MCP 产品 `6666a63b46cd783d6a6537dd3295b37619ba4afa`，
分支起点为仅追加文档的 `7255fb39dcb11a5cc5941621e32a0dd1207e12c0`。
本记录首次提交时尚未合入主发布分支或部署生产；现已由主控合入并先推
GitHub，再于18:06:21（Asia/Shanghai）完成API发布，详见下方实际结果。

## 最终变更

仅移动端读取投影删除明确附件槽位中已识别的 PNG/JPEG/GIF/WebP 内联
图片字节：payload.attachments、result.outputArtifacts（含嵌套 result），
以及保留事件的 data.result 对应槽位。保留其名称、MIME、大小及其他元数据；
未知编码、非图片、无效容器、MIME 不符及不同图片别名均原样保留。

同一投影覆盖 mobile runs、Bot 列表/详情的 latest_run/stop_action、以及
conversation.execution。Bot 能力推导先使用完整原回执，之后才投影。
完整 prompt、messageId、报告文本、未知字段、processExit、stopConfirmed、
code、event_count、最后事件和全部终态事件保留。数据库原件、默认 API、
MCP 和既有认证聊天图片通路保持。当前 App 不显示运行元数据中的图片字节，
因此无需改变 0.2.1 的客户端资产或增加浏览器跳转。

聊天 runs 轮询仍保留：parallel directory.inspect 可能成为 latest_run，
不能据此替代规范 activeAction 或取消 Stop/发送阻塞。未实现新的 status
接口，也未截断正文、延长读取时限或隐藏错误。

## 验证

正式修复树 73/73 通过：移动投影与认证内存 HTTP 27 项、runs 查询/聊天
已读 8 项、能力推导/停止恢复/聊天转发 38 项。独立审查无可行动缺陷，
独立复跑投影 27 项通过。所有这些测试不启动监听，不访问真实账号。

此前窄候选的真实 localhost HTTP 弱网验收使用原 f270 App 资产、合成
16,000 B/s 与 100 ms 延迟，保留 20,000 ms 时限。465,000 字节旧响应
在 App 20,014 ms 超时；179,302 字节候选单接口 11,375 ms 完成。实际
App 原并行请求与八秒轮询中，旧接口出现用户同文案红条，候选约 17 秒
完成且无读取错误。50 ms 连续采样旧版 405 次、候选 337 次，Stop 始终
可见、发送始终禁用；未点击停止、发消息或操作真实任务。

该弱网夹具是合成数据与桌面 Chromium，未复现 Android 蜂窝、TLS、
gzip 或真实电台调度；当时 latest_run/execution 夹具较小，不能代替扩展
大槽测试。首轮验收脚本的选择器错误已保留并修正，不计为产品失败或通过。

私有证据位于 Android worktree 的 `.local/mobile-manager-runs-candidate/`
和 `.local/mobile-manager-runs-weaklink-qa/`，不提交真实业务内容或会话凭据。
弱网临时 HTTP 登记 283 已释放，Chrome 使用 pipe，结束时端口检查无冲突、
无未登记；既有 267/268/271 与其他项目的 260 未动。

## 发布交接

主控拥有生产发布入口。应基于当前完整 MCP 基线审查本分支精确 diff，
先推源码再发布 API，不能用旧 Android 分支的后端覆盖最新 MCP。发布后
记录生产 current/commit，并以只读方式检查相同运行组的响应减量与证明
字段保持。生产发布与最终 App 补验结果须在完成后追加，不能以本地通过
代替已上线或实体手机验收。

## 最终冻结验证与实际发布

冻结产品为 `9393dcb0aab1c7afeacf368c7205f300264fa69e`。主控主发布树另跑
78项相关回归（含MCP连接）全过，lint178通过，源码及27项投影测试独立
审查无阻塞。发布器25项、发送器8项离线检查及独立审查通过。

最终原App资产的真实HTTP并行/轮询验收：16,000 B/s、100 ms合成节流，
176,796字节运行响应在19,447 ms完成。**原20秒阈值仅余约0.55秒**；不能
以此前较窄夹具约17秒的结果代替此结果，更不能保证所有手机网络不超时。
两条可见历史逐字匹配（助手报告3,545字节），四份运行输出、五份prompt
和退出证明保持。393次50 ms采样Stop未消失、发送未误开放、无读取错误。
没有业务提交、停止、外部请求或弹窗；夹具存在一次已读水位写入。
正常速度大槽补验中，Bot latest/Stop原始878,298→20,924字节，聊天execution
原始159,573→16,584字节，原ID、Stop目标、正文与数据库动作/事件/消息保持；
该大槽结果不是弱网通过。临时端口284已停止释放。

用户后续要求GET读取可等一分钟，由App分支独立调整和发布；本API补丁
不包含App读取时限或APK改动，原20秒测试仅为当时冻结版本的减负证据。

产品先推 `codex/v2-20261014-release`，再于 **2026-10-17 18:06:21** 发布：

- 当前：`/opt/ziwei/releases/mobile-runs-projection-9393dcb0aab1-e0f199eb/v2`，API PID `366044`。
- 上一完整版本：`/opt/ziwei/releases/remote-mcp-oauth-6666a63b46cd-a5b46d87/v2`。
- 唯一运行时代码覆盖：`backend/mobile-read-view.mjs`，SHA-256 `259b7e0d42a8a6a5245f2a2de70e89ef5e9e2e68f65ce3e0072ef4e6a67eee07`；另增 `MOBILE_RUNS_PROJECTION_RELEASE.json`。
- 网页和官方Windows包仍为 `6666a63`；客户端build `7b4939c27eb485e0a1eff0635a698eb64b088dbff8ced84391ce1e87889bc212`，未更新实际Windows员工。

复制正式完整MCP树，只覆盖上述单文件。发布前后全树比较确认8份MCP源、
此前CHAT/MOBILE_SYNC/MOBILE_IMAGES/REMOTE_MCP发布记录、全部网页和CLI、
持久路径、数据库文件身份与逻辑schema、中控/Nginx进程及配置保持。
未恢复旧数据库、未调用模型/手机、未更改员工或授权。内外健康均200。
18:07独立只读复核18项全过；这不是Android真机超时恢复验收。

## 现场固定输入的投影核验

发布前、发布中与独立发布后，都在单次只读SQLite事务内取同一组固定ID，
对同一份输入分别运行旧/新实际模块。五条运行：419,971→134,273字节，
减少68.0%；识别到两个JPEG内容槽，共285,672个base64字符。聊天execution
258,244→17,138字节（489事件改为全部终态及最后事件，并保留event_count）；
latest17,138、Stop1,326字节保持。差异白名单、非图片证明、原输入与同事务
原数据未变全部通过。不是完整鉴权HTTP响应大小或网络耗时测量。

当时员工active_action_id已自然为空，control_state为active、revision7、
control_epoch15；最新执行failed、旧Stop动作succeeded。本次未停止任何员工，
不把同快照字段保持称为正在运行的真实任务跨发布验收。不同时间的新任务
或回执可正常改变业务哈希，不要求跨发布冻结业务。

私有发布证据：`.local/mobile-runs-timeout-release/` 内的 `baseline.json`、
`publish-result.json`、`preflight-protected.json`、`projection-before.json`、
`projection-after.json`、`inspection-api.json`、测试日志。探针只保存数字、
ID及哈希，不保存原始业务正文；首轮只读诊断失败证据保留，成功结果单列。

若回退，先重新核对当前代码指针、进程身份、保护哈希和发布锁；仅切回上述
上一完整MCP目录并重启API。保留新聊天/任务、图片、Profile/HOME和MCP授权，
**不得恢复旧业务数据库**。不能覆盖其他任务此后发布的代码或回执。
