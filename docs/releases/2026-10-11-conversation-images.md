# 2026-10-11 持久会话双向图片

## 功能与范围

用户可在持久会话发送纯图片或图文；员工输出的图片可作为同一会话的真实附件保存、预览大图和下载。刷新或重新进入会话后，附件从消息历史恢复。普通聊天和回图不自动创建任务看板卡片；从任务发起的执行仍可写入其关联会话。另行明确创建任务（包括员工调用管理 MCP `ziwei_create_task`）会产生任务卡片；这与保存普通会话消息是两个入口。

每条消息最多 20 个附件，图片和文件内容合计最多 10 MiB。图片支持 PNG、JPEG、GIF、WebP；按实际字节、图片结构及 MIME 校验，不能用本机路径或仅文件名代替图片内容。已有非图片文件输入保持兼容。浏览器添加图片入口按图片格式过滤并显示限额。

发送过程按工作区和会话保留草稿。读取图片和提交消息都捕获当前上下文，切换会话不会串入旧消息或清空新草稿。发送锁与 `clientMessageId` 幂等配合，网络重试不重复创建执行。请求失败保留编辑内容；执行失败显示具体原因，并可恢复原消息重新编辑和发送。已有新草稿或正在读取图片时，恢复旧消息不会覆盖它。

## Windows CLI 支持边界

- Codex 使用 CLI 原生 `exec --image`，可传多张图片。模型必须支持视觉；CLI 参数支持不能代替模型实际验收。
- Hermes 当前使用 `chat --image` 的单图片查询。多图明确拒绝，不丢弃额外图片。模型/provider 的视觉能力需要分别验证。
- 本轮未实现 Claude、Gemini 的原生视觉输入；带图片时明确提示不支持，不把文件路径视为识图成功。
- 各运行时的图片输出走同一显式清单通道，与输入附件分开。只接受本次执行目录中明确声明的文件，不自动扫描工作目录或磁盘寻找图片。
- Mac 未适配。本次不修改 Creator HOME、正式手机 MCP、现有连接与维护流程，不扩展自动化或其他审计修复。

## 输出协议

客户端每次执行建立独立随机图片输出目录，将本次 action、会话和清单格式提供给 CLI。CLI 先写图片、最后写 UTF-8 `manifest.json`：

```json
{
  "version": 1,
  "actionId": "本次执行ID",
  "conversationId": "本次会话ID",
  "artifacts": [{"path": "result.png", "name": "结果.png"}]
}
```

运行时环境变量为 `ZIWEI_IMAGE_OUTPUT_DIR`、`ZIWEI_IMAGE_OUTPUT_MANIFEST`、`ZIWEI_IMAGE_OUTPUT_ACTION_ID`、`ZIWEI_IMAGE_OUTPUT_CONVERSATION_ID`。`path` 只能是该执行目录内的相对路径。链接、硬链接、跨目录路径、错误归属、无效文件和超限清单均失败，返回具体原因。

结果字段 `inputAttachments` 表示用户输入在电脑上的落地信息；`outputArtifacts` 表示已读取的真实输出图字节。服务器只将后者保存为 assistant 附件，并从已授权 action 取得会话、员工和工作区归属；结果体传入的会话 ID 不改变归属。

## 验收与发布记录

发布前隔离浏览器矩阵已通过：1440×1000 和 390×844 的纯图、图文、回图、大图、下载字节校验、刷新持久化、普通聊天不增任务；请求失败保留草稿后重试、延迟发送切会话、延迟文件读取切会话均通过。该矩阵使用真实 Vue 页面和认证 API/数据库，结果投递使用隔离 fixture，不作为生产模型验收替代。

独立复核发现并关闭三项边界：最大回图加长日志超过接口 JSON 上限、恢复旧消息与读图竞态、无图失败事件绕过事件预算。完整 result 控制在 15 MiB 内，事件 result 控制在 128 KiB 内；日志或文字按实际 JSON 字节预算截断并标记原因，图片字节完整保留。合法 10 MiB PNG 加 3 MiB diagnostics、JSON 转义膨胀、output 与 diagnostics 同时较大的三个认证 HTTP probe 均返回 200，保存图片 SHA 与输入一致。

发布前全量测试 526/526 通过，0 skip；lint 检查 71 个源码文件，前端构建通过。真实 Windows Codex 0.162.0-alpha.17.2 单次 preflight 正确识别未在 prompt 透露的红色三角形、蓝色圆形，执行隔离 QA 图片生成脚本，通过 manifest 返回 1,217,037 字节 PNG。该次沿用 native 默认模型，本机配置默认 gpt-6.1-sol，CLI 流未独立回报实际服务端模型名。12 个既有 global MCP 仅在本次 argv 禁用，正式配置 hash 未变，手机调用与正式 daemon 改动为 0。真实 Hermes provider 视觉能力与真实多图推理未在本轮验证。

主站功能已上线，主 API 当前代码为 `3be8d5f6912989c27e3e92f6dc7886826bf50e0f`，北京时间 2026-10-12 00:51:39 切换至 `/opt/ziwei/releases/3be8d5f-api1`；前端为本轮图片功能的 `index-kUip0tGx.js` / `index-Chy_TRFE.css`。官方 Windows CLI 为 `3c8b0b77aa972d02deffb81c846b518a792da31a`，公开包 SHA `794687127d983b977dd9daac27f8ffd8f3bdf4b8c3e7cd140bb4f8e44550041a`，已从该包隔离安装并执行实际 Windows Codex 验收。生产原生浏览器、无模型韧性矩阵与精确 QA 清理均已完成；发布、回滚与受保护数据证据见 [本轮运维记录](../operations/2026-10-11-conversation-images.md)。

首轮生产纯图执行正确识图，但全局 MCP 禁用参数覆盖了本次管理 MCP 配置，导致必需握手失败；客户端 `3c8b0b7` 调整参数顺序后，两条桌面原生执行实际 succeeded、管理握手 loaded，图文执行返回 1,217,037 字节 PNG。后续浏览器/API 读取超时暴露了历史响应同时携带原始 JSON 和解析后的图片内容；主 API `b9a5eb1` 保留消息中的一份完整附件，执行摘要只保留图片元数据，原生 action 输入与数据库原始字节保持。A2A 默认仍返回完整已解析 payload/result，新增 `includeResult=false` 可只读省略 result。不能把响应读取超时误写成服务器执行失败。

最终源码 `3be8d5f6912989c27e3e92f6dc7886826bf50e0f` 全量串行测试 534/534 通过，0 fail、0 cancelled、0 skip；lint 71 文件通过。该补丁只将目标设备校验放在终态 ack 幂等返回之前，认证 HTTP 回归先红后绿：同工作区错设备对 pending/succeeded/failed 均被拒绝，原设备的完整图片及管理回执保持。线上 repository SHA 与精确候选一致；新版本上用已终态纯图 QA action 验证匿名 401、原设备 200/duplicate、完整输入 SHA 和 management loaded，未新增 action/模型。没有为了生产 cross-device 验证再创建设备，拒绝边界由认证 HTTP 回归与线上源码 hash 验证。默认并行运行曾出现四项既有 Windows 进程/时序用例失败，未改变其实现或测试阈值；根工作树和发布精确归档分别完整串行通过。认证隔离 HTTP 验证合法 10 MiB 图片的发送回执、历史和默认 A2A list 各保留一份完整图片内容，sidebar 不含图片字节；输入 SHA 保持。这些隔离响应指标与生产传输验收分别记录。

生产浏览器在 `b9a5eb1` 主 API 与 `3c8b0b7` 官方包组合下已完成 1440×1000 和 390×844 两组完整原生验收：四条不同 action 都 succeeded、管理 MCP loaded，正确识别未在纯图 prompt 透露的红三角/蓝圆；两次图文执行由模型调用隔离 Node 脚本写入本次输出清单，返回新的 900×600 PNG，均为 1,217,037 字节，SHA `278e8cc8ec8aa10c143a864d617e4507e37a030f9e4acdfaa3d4427dadece7ea`。这不是扩散绘画服务验收。大图、下载 SHA、刷新、离开后重入、user/assistant 归属都通过；两个视口任务卡片均为 0→0。线上全量历史分别为 1,644,285 / 1,641,219 字节，保留一份回图。

四条成功执行各保留一份管理 MCP 审计 JSONL，实际 `initialize` 与 `tools/list` 都返回 ok；这是初始化和列工具握手证据。本轮图片请求没有业务 `tools/call`，回执 toolCalls 为空，不扩大为管理业务工具的执行验收。

本轮真实模型调用总数为六次：一次独立 preflight，加五次生产调用（包含首轮管理握手失败及后续四条成功）。最终恢复桌面终态时使用认证服务器回执，没有再次调用模型。无模型的韧性 fixture 另行标记，最终 12/12 通过：桌面和窄屏合计十项失败重试/恢复原稿/延迟文件读取和发送切会话均通过；四种非法附件实际 HTTPS 400 且消息/action 数量无变化；最大 10 MiB 输出加长文本/diagnostics 的实际 result 返回 200，完整请求 15,728,639 字节。公开历史读取与独立服务器只读快照均确认 SHA `ec3e7c66a972161eca3c137d054aa9d3ab10d890eb088f40cf6bc10b79da4962`，action 与 assistant 附件均为完整 10,485,760 字节 PNG。七条无模型 fixture 执行都已投递终态，pending=0、pageErrors=0、cleanupErrors=0。此次公开传输仍慢，1.2 MB 图文 result 响应 1,631,188 字节耗时 50,207 ms；最大 fixture result 响应 15,732,492 字节耗时 472,349 ms，历史响应 15,882,777 字节耗时 355,579 ms。不据此断言具体网络根因或性能达标。

北京时间 2026-10-12 00:54:39 按最新精确 manifest 清理本轮独立 1 个 QA Owner、工作区、设备和员工，以及 4 会话、12 action、24 消息和相关审计/能力/session，共 214 行；事务 856.79 ms，QA 残留为 0。备份 `/opt/ziwei-backups/conversation-images/qa-cleanup/20261011T165439Z-7ca7711f`。主/控制数据库完整性及 FK 通过，所有当前非 QA 主键与正式 15 类稳定字段保持，控制端只有已证实记录的一项有界 lease 续租。旧 Owner cookie、设备 token、未过期管理 capability 均真实 401；本机三个精确 QA 凭据文件已删除。原输入图片、输出回图、manifest、四份 MCP 握手审计、失败阶段及脱敏验收证据保留。

最后只读健康验证于 00:55:32 完成，19 项全部通过；主 API PID167695/控制134533/Nginx737、签名、持久化链接、前端/官方包/bootstrap/source hashes 保持。整个功能发布及两轮保护性回退累计主 API restart 7 次、Nginx reload 5 次；最后两次主 API 补丁各 restart 1 次且不 reload Nginx，客户端补充发布与 QA 清理均不重启服务。正式 Windows PID51880/global `7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64` 持续 ready，配置身份保持，本轮未升级。

本人既有 daemon 的运行连接与我们读取的磁盘配置 hash 不一致，不能直接覆盖或停止。官方新版包发布与本人运行版本升级分别记录；仅在原终端通过实际实例/配置身份核验后沿既有安全 update 执行，不重配对，不强行停止当前进程。
