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
本记录首次提交时尚未合入主发布分支或部署生产。

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
