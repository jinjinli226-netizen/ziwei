# 2026-10-12 A2A 执行恢复发布与验收

## 源码与构建

- 分支：`codex/a2a-delivery-recovery`。
- 功能提交：`ce0a0e3a48fc46b1bf1b83ad5620ef8073bf6c9c`，GitHub push 后 `ls-remote` 核对一致。
- 基于已验证的 `1c94c9c10ad2081a6e5afb831cfc304ae286d289`；未合入其它树未完成的 SEC/手机归属改动。
- 本地完整串行回归 615/615；精确提交 git archive 再次完整串行 615/615。均 0 fail、0 cancelled、0 skip、0 todo。
- 两处 lint 均检查 74 个源码文件，前端构建通过；精确公开 npm 包含 32 个文件，逐个核对提交源码、归档和真实 Windows 安装。
- 前端 JS `index-DS7SuX_Z.js` / CSS `index-Chy_TRFE.css`。

## 主站及官方包

北京时间 2026-10-12 03:58 发布主站 `/opt/ziwei/releases/ce0a0e3-a2a-e8c5cb96`。主 API PID `170667`；控制仍 `/opt/ziwei-control/releases/8a4fe59` / PID `134533`；Nginx PID `737`。

本次主 API restart 1 次，控制 restart 0、Nginx reload 0、数据库 restore 0。Nginx SHA `21a955cdfaef8d16837671b20ec07ddcf4c7f61d0c1feea9c1885a4a3dedd231` 和既有两处 16m body limit 保持。正式主键、15 类稳定资源、全部既有终态 A2A payload/result、消息和附件原始字节核对通过。仅允许已明确身份且有界的 heartbeat/last_seen/checkedAt 和已验证控制 lease 时间字段。

双 SQLite 使用 backup API 作短时备份；发布前后离线 integrity 均 ok、FK errors 均 0。私有目录、对象、签名、环境文件、服务文件、旧包和 metadata 同时保存。备份目录：`/opt/ziwei-backups/a2a-delivery-recovery/20261011T195831Z-e55f7110f9844ba4924c6e8feaa56c33`。回滚只回退代码链接和官方包，禁止用旧数据库覆盖当前数据。

官方 `ziwei-latest.tgz`：107747 字节，SHA256 `415d6165debc2c3d60a712ffe9891cf54a780d7d6f5e7e8d93668401fdbdf128`。公开 health、metadata、包、index 与 JS/CSS 的实际字节核对通过。既有图片能力、Windows 工作目录与 update bootstrap metadata 保持；bootstrap SHA `e78e39f3e1eeb9808ecd4ed32f2f856a82947f81e4ee2ca60f20383c766c332a`。

源码归档 build `2e13c32c5834b6ce791929d0abefe426d84fbaa424702f64e34e3a651e6b50bf`，Windows 安装 build `7ff3d6bb45d7161372f8b9208fe3cf17a8329ab9b8105d682452bf4527c82147`。区别仅为 npm bin-links 将 `scripts/ziwei-user.mjs` 第一行 shebang 的 CRLF 转为 LF；其余包文件逐字节一致。安装 build 与源码 build 分别记录，不能混用。

## 实际 Windows 客户端

通过 WMI 隐藏启动原生 Python，Windows 文件句柄最终路径确认 plain AppData，而非桌面 MSIX 的历史 LocalCache。升级前实际 global 入口是 `D:\work\nodejs\node_global\node_modules\ziwei`，原 PID `51880` / build `7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64`；磁盘配置、运行 lifecycle 身份、工作区、设备匹配。

先从公开下载入口取得此精确 SHA 的包，在全新私有 prefix 真实 npm 安装，核对 32 文件、metadata、bootstrap 和 Windows build；无正式 daemon 启动。然后原 global CLI 通过已有安全 `update --package ... --sha256 ... --json` 维护流程升级，不重新配对或直接终止进程。

本次 maintenance：`update-2fc603b0-736f-4e20-a8e1-919d861ea7f2`，状态 `queued → running → complete`，北京时间 04:00:27 完成，`restoredRunning=true`、`configurationPreserved=true`。新原生 PID `51924` / 实际安装及运行 build 均 `7ff3d6bb45d7161372f8b9208fe3cf17a8329ab9b8105d682452bf4527c82147`，旧 PID 已退出，ready 为 true。

`bigtron` / `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`、原配置 SHA `7913bf1c1b490ecf9b6d6760787973c28f8c484703c144eb0028b57ef8166b72`、primary binding、global 入口、Codex auth/config 摘要均保持。版本号仍为 0.1.0，本次真实更新由 commit、公开包 SHA 与实际运行 build 核实。

## 真实公网恢复矩阵

独立全新 QA run `e7ea1762-7ecd-4708-9976-5c4f7d5b231c` 使用正常注册和配对创建个人 owner/workspace 与两台认证 fixture device。候选来自精确包的真实 Windows 安装模块；运行实际 delivery engine 与 dispatcher，执行器明确返回人工 fixture，无 CLI、模型、手机操作或 heartbeat。北京时间 04:04:20，5/5 通过：

| 场景 | 执行器次数 | engine result 上传次数 | 恢复证据 |
| --- | ---: | ---: | --- |
| 最大 10 MiB 输入 | 1 | 1 | 认证 poll、compact ACK 与 canonical history 图片 SHA 保持 |
| ACK 提交后断开回执 | 1 | 1 | 认证 history 确认已 acked，重试 ACK 后才执行 |
| UUID event 提交后断开回执 | 1 | 1 | 同 UUID 只有一个 event 和 audit，重复内容冲突被拒绝 |
| 10 MiB result 发送 256 KiB 后中断 | 1 | 2 | 新 engine/dispatcher 从原文件恢复，仅重传完整结果，无 CLI 重启 |
| 10 MiB result 已提交后断开回执 | 1 | 1 | 新 engine 终态 ACK 267 字节，第二次整图上传为 0 |

每条 case 均 1 user、1 assistant、task count 0；错误设备/工作区、终态新事件被拒绝。输入与输出以实际认证 canonical history 下载解码重核 SHA，最大 PNG 为 10485760 字节 / SHA `ec3e7c66a972161eca3c137d054aa9d3ab10d890eb088f40cf6bc10b79da4962`。

实际 poll/result transport deadline 为 600000 ms，ACK/event 为 15000 ms。最大 message POST 13981347 字节，往返 11622 ms；认证 poll 13982553 字节，5000 ms；最大 result 13981459 字节，恢复完整上传 5262 ms / compact 回执 451 字节；已提交回执丢失 4978 ms，恢复只请求终态 ACK。独立重复大图 result probe 4199 ms / 468 字节，单独标记，不能混入 engine 恢复次数。

以上为本次测量。之前公开最大 result 往返 472349 ms、完整图片 history 355579 ms；当前小回执消除了不必要的整图回传，但不能据一次较快运行宣称公网性能问题已彻底解决。

## 真实浏览器状态矩阵

独立新 run `63572f6d-76b4-449b-b816-4c79dee2c6f7` 通过正常注册/配对创建自己的 owner、个人 workspace、两个 fixture device 和 plain Codex fixture employee。没有启动 fixture daemon、CLI/模型或手机操作；A/B/D 回执是明确标记的人工 fixture，不能算真实 Codex 输出。

已安装 Edge 使用本次证据目录内全新临时 profile 独立 headless 启动，实际加载公开 Vue 构建与真实 API/WS。原用户浏览器的新增 CDP 连接没有完成授权，首次连接失败证据保留；不能宣称在用户日常 Edge 的现有 CDP 会话里完成了全部矩阵。原用户标签保留，新 headless/context 结束后其 exact profile 进程残留 0。

9/9 通过：A succeeded、B pending、旧 A 原始响应晚到被拒绝、B acked、B succeeded、C failed、断网及真实 WS 重连后 D succeeded、E expired、390 窄屏 E expired。全部 phase 以认证 canonical API 的当前 action/message 身份核对真实左右 DOM 状态；同一会话五条 user/四条 assistant、task0、pageerror0。延迟响应保留原始 body，没有伪造状态；重连前后草稿保持，1440 桌面与 390 窄屏截图保留，窄屏 document width 390 无横向溢出。实际 JS/CSS 下载 SHA 与发布 manifest 一致。

E 为从未 ACK/执行的本轮独立 pending fixture；根任务核对 owner/workspace/employee/device/conversation/message/action 七项精确绑定、正式与已退休 ID 排除后，通过一次短事务仅将此 action 设为 expired。其它资源更新、CLI/模型和手机动作均 0；不对正式动作使用该 fixture。

## 真实 global Codex 执行与问答限制

独立 run `208390cc-f7a7-498d-b012-4ed1792be7cf` 使用既有 bigtron Owner 的正常 API，新建 personal plain Codex 员工 `employee_3449738d-80fe-4235-a65f-ad08f963f4f8` 与会话 `conv_fab0970d-4e9c-4069-b5ff-5c9ed89b06de`。职责、人格、指令和消息均新写，skills 为空，没有安装模板、配置手机 MCP、复制正式 Creator 指令或读取旧会话。专用 cwd 为该 run 下的空目录；不声称使用独立 Codex HOME。

只提交一次新的 `clientMessageId`；实际 user 为 `convmsg_5cbd664a-2ae4-4dad-8c6e-e591e8c7131a`，action `action_131e0e4a-387e-4206-94d8-a1a0cfa061b1` 于北京时间 04:28:40 canonical succeeded。一条 user、一个 action、一次 action.started、一条 assistant；没有重试 POST 或重发原 expired 消息。原生 observer 捕获唯一 Codex PID68620 / parent51924，PEB 实际 cwd 匹配专用目录，模型参数 `gpt-6.1-sol`，default profile。实际 management MCP loaded，只调用 `ziwei_list_employees` 与 `ziwei_phone_mcp_setup` 各一次、ok；phone MCP 未加载或配置，正式任务仍为 2。

执行与投递链路通过，数量回答并未全部通过。实际目录为 3 个员工（包括本 QA 自身）和 2 个手机。模型正确回答 employee_count=3，但表示 phone-mcp/setup 输出被截断，无法核验完整 phones 数组，phone_count 返回 failed，没有猜测 2；输出还有前置说明，未满足 QA 的纯三字段 JSON 格式。

正常 phone API 对象完整，pretty JSON 34782 字符 / 46809 UTF-8 字节、phones 两条；bridge 源码完整 pretty JSON 返回，无截断逻辑。runtime result.truncated=false、diagnostics 1386 字节，未触及 daemon 4 MiB 输出预算。因实际工具 result 原始字节未记录、Codex `--ephemeral` 未保存 session，只能推断限制位于 Codex 工具输入/呈现链路，不能据此确定 CLI 与 provider 中的具体截断层。失败原始问答和证据保留，不用正常 API 的 2 条目录替代模型实际回答。

## 手机数量只读摘要修复（客户端验证中）

`ziwei_phone_mcp_setup` 新增可选 `view:"summary"`；默认 `view:"full"` 保留完整配置资料。摘要只在客户端投影已有同权限 GET 的完整对象，不增加接口调用或控制器查询，`view` 不发送到服务端。它明确统计 `control_catalog` 手机目录的非空真实 ID 去重数量，以及当前调用者可见工作区的员工与电脑数量；不是工作区已绑定手机数。接口不可用或目录格式无效时返回 unknown/null 和原因，健康空目录才返回 0。

摘要先返回完整数量，再提供有字节预算的最多 20 条简短手机资料，标明列表或字段是否裁剪。仅修改管理 MCP 客户端与针对性回归；不改变服务端权限、归属、手机能力或任何手机操作。新包只发布客户端层，主站与前端继续使用上面的 `ce0a0e3`，无需再重启服务。新公开包、实际 global 安全升级、新隔离真实 Codex 数量问答完成后另记准确版本和结果。

## 精确 QA 清理

本轮三份独立 manifest 的清理正在进行；每份先保存主站/control 的 SQLite backup API 副本并离线预览，根任务审核实际精确 PK 与完整行 SHA，再在串行空闲窗口执行，保护全部正式和其它 QA 资源。当前文档不将尚未完成的删除、撤销探测或本机 secret 清除记为成功。原正式 expired 动作/消息保持原始历史。
