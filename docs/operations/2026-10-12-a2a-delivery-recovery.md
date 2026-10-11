# 2026-10-12 A2A 执行恢复发布与验收（已上线，验收与精确QA清理完成）

## 首版ce0源码与构建

- 分支：`codex/a2a-delivery-recovery`。
- 功能提交：`ce0a0e3a48fc46b1bf1b83ad5620ef8073bf6c9c`，GitHub push 后 `ls-remote` 核对一致。
- 基于已验证的 `1c94c9c10ad2081a6e5afb831cfc304ae286d289`；未合入其它树未完成的 SEC/手机归属改动。
- 本地完整串行回归 615/615；精确提交 git archive 再次完整串行 615/615。均 0 fail、0 cancelled、0 skip、0 todo。
- 两处 lint 均检查 74 个源码文件，前端构建通过；精确公开 npm 包含 32 个文件，逐个核对提交源码、归档和真实 Windows 安装。
- 前端 JS `index-DS7SuX_Z.js` / CSS `index-Chy_TRFE.css`。

## 首版ce0主站及官方包

北京时间 2026-10-12 03:58 发布主站 `/opt/ziwei/releases/ce0a0e3-a2a-e8c5cb96`。主 API PID `170667`；控制仍 `/opt/ziwei-control/releases/8a4fe59` / PID `134533`；Nginx PID `737`。

本次主 API restart 1 次，控制 restart 0、Nginx reload 0、数据库 restore 0。Nginx SHA `21a955cdfaef8d16837671b20ec07ddcf4c7f61d0c1feea9c1885a4a3dedd231` 和既有两处 16m body limit 保持。正式主键、15 类稳定资源、全部既有终态 A2A payload/result、消息和附件原始字节核对通过。仅允许已明确身份且有界的 heartbeat/last_seen/checkedAt 和已验证控制 lease 时间字段。

双 SQLite 使用 backup API 作短时备份；发布前后离线 integrity 均 ok、FK errors 均 0。私有目录、对象、签名、环境文件、服务文件、旧包和 metadata 同时保存。备份目录：`/opt/ziwei-backups/a2a-delivery-recovery/20261011T195831Z-e55f7110f9844ba4924c6e8feaa56c33`。回滚只回退代码链接和官方包，禁止用旧数据库覆盖当前数据。

官方 `ziwei-latest.tgz`：107747 字节，SHA256 `415d6165debc2c3d60a712ffe9891cf54a780d7d6f5e7e8d93668401fdbdf128`。公开 health、metadata、包、index 与 JS/CSS 的实际字节核对通过。既有图片能力、Windows 工作目录与 update bootstrap metadata 保持；bootstrap SHA `e78e39f3e1eeb9808ecd4ed32f2f856a82947f81e4ee2ca60f20383c766c332a`。

源码归档 build `2e13c32c5834b6ce791929d0abefe426d84fbaa424702f64e34e3a651e6b50bf`，Windows 安装 build `7ff3d6bb45d7161372f8b9208fe3cf17a8329ab9b8105d682452bf4527c82147`。区别仅为 npm bin-links 将 `scripts/ziwei-user.mjs` 第一行 shebang 的 CRLF 转为 LF；其余包文件逐字节一致。安装 build 与源码 build 分别记录，不能混用。

## 首轮实际Windows升级（历史）

首轮使用原安全入口，于04:00:27 complete；旧PID51880退出，新PID51924/安装及运行build7ff3d6bb…，ready=true。plain AppData与运行身份匹配，配置、连接、global入口、Codex auth/config和绑定保持；版本号仍0.1.0。第二次bf实际升级及最新PID/build见下方补充发布段。

## 真实公网恢复矩阵

独立全新e7ea QA 使用正常注册和配对创建个人 owner/workspace 与两台认证 fixture device。候选来自精确包的真实 Windows 安装模块；运行实际 delivery engine 与 dispatcher，执行器明确返回人工 fixture，无 CLI、模型、手机操作或 heartbeat。北京时间 04:04:20，5/5 通过：

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

独立browser635 QA 通过正常注册/配对创建自己的 owner、个人 workspace、两个 fixture device 和 plain Codex fixture employee。没有启动 fixture daemon、CLI/模型或手机操作；A/B/D 回执是明确标记的人工 fixture，不能算真实 Codex 输出。

已安装 Edge 使用本次证据目录内全新临时 profile 独立 headless 启动，实际加载公开 Vue 构建与真实 API/WS。原用户浏览器的新增 CDP 连接没有完成授权，首次连接失败证据保留；不能宣称在用户日常 Edge 的现有 CDP 会话里完成了全部矩阵。原用户标签保留，新 headless/context 结束后其 exact profile 进程残留 0。

9/9 通过：A succeeded、B pending、旧 A 原始响应晚到被拒绝、B acked、B succeeded、C failed、断网及真实 WS 重连后 D succeeded、E expired、390 窄屏 E expired。全部 phase 以认证 canonical API 的当前 action/message 身份核对真实左右 DOM 状态；同一会话五条 user/四条 assistant、task0、pageerror0。延迟响应保留原始 body，没有伪造状态；重连前后草稿保持，1440 桌面与 390 窄屏截图保留，窄屏 document width 390 无横向溢出。实际 JS/CSS 下载 SHA 与发布 manifest 一致。

E 为从未 ACK/执行的本轮独立 pending fixture；根任务核对 owner/workspace/employee/device/conversation/message/action 七项精确绑定、正式与已退休 ID 排除后，通过一次短事务仅将此 action 设为 expired。其它资源更新、CLI/模型和手机动作均 0；不对正式动作使用该 fixture。

## 真实 global Codex 执行与问答限制

第一轮first208使用既有bigtron Owner的正常API，新建personal/plain Codex员工和会话，职责/人格/消息均新写，skills为空，没有使用正式Creator、模板、旧指令或phone MCP。使用独立空cwd，不声称隔离Codex HOME。

仅提交一次新消息，04:28:40 canonical succeeded：一user/action/action.started/assistant，无重试或旧expired重发。原生唯一Codex PID68620/parent51924、default profile、gpt-6.1-sol及实际cwd通过；management MCP loaded，ziwei_list_employees与ziwei_phone_mcp_setup各一次ok，phone MCP未加载或配置，任务仍2。

执行与投递链路通过，数量回答并未全部通过。实际目录为 3 个员工（包括本 QA 自身）和 2 个手机。模型正确回答 employee_count=3，但表示 phone-mcp/setup 输出被截断，无法核验完整 phones 数组，phone_count 返回 failed，没有猜测 2；输出还有前置说明，未满足 QA 的纯三字段 JSON 格式。

正常 phone API 对象完整，pretty JSON 34782 字符 / 46809 UTF-8 字节、phones 两条；bridge 源码完整 pretty JSON 返回，无截断逻辑。runtime result.truncated=false、diagnostics 1386 字节，未触及 daemon 4 MiB 输出预算。因实际工具 result 原始字节未记录、Codex `--ephemeral` 未保存 session，只能推断限制位于 Codex 工具输入/呈现链路，不能据此确定 CLI 与 provider 中的具体截断层。失败原始问答和证据保留，不用正常 API 的 2 条目录替代模型实际回答。

## 手机目录摘要：官方包及实际客户端已更新

| 项目 | 实际值 |
| --- | --- |
| 主站/前端 | `ce0a0e3`，保持；JS/CSS字节不变 |
| 客户端源码 | `bf2135158c693534849443daf7d146046ac5f201`，已推送 |
| 验证 | 源码633/633、精确git archive633/633，0 fail/cancelled/skipped/todo；lint74/前端构建通过；Windows32文件真实隔离实装验真 |
| 官方包 | 108903B，SHA `6631d4e8a6f26849187448824b0abc7af855b3a7d3f4c50936e8133cbaaa0b98` |
| sourceBuild | `524423aa4df120540321f3efb9771b5dc38ba4ae5025e596e291ca9ad00e3e72` |
| Windows安装/运行build | `33f572266dffd96ee24d4a3bbbed7275bdf4210ebfc7b7e6e3af30faa9b93e9a` |
| 北京时间 | 06:29:08发布包；06:45:01.719 queued →06:45:02.229 running →06:45:18.777实际升级complete |

只更新官方CLI包与release.json，保留bootstrap、windowsWorkdir、conversationImages及a2aDeliveryRecovery；metadata明确clientOnlyPublication=true、mainSiteCommitUnchanged=true。包发布的服务操作、配置写入、数据库写入/恢复、模型与手机动作均0。公开health、metadata、包、index、JS、CSS均200；主站/前端/控制/Nginx、正式稳定资源和对象目录保持。源码与Windows安装build的唯一已验证差异仍是npm bin-links对首行shebang换行的归一。

两次旧私有发布保护分别被固定31秒checkedAt假设与terminal/latest-node即时相等假设拒绝，均自动恢复旧包原字节，没有恢复整库或操作服务。新守卫依据实际cache/heartbeat源码及SQLite观察窗口，只修正已登记时间字段，完整schema/PK/stable和其它规则保持；旧失败/回滚记录保留。新publisher59项离线回归、成功发布前后六份实际DB的SHA/完整性/FK及三段保护核对均通过，长期备份保留。

第二次实际global更新沿原安全维护入口，确认plain AppData与lifecycle身份。旧PID51924已退出，新PID17648；实际安装/运行build均33f572…，原配置、global入口、primary/shared绑定、credential及Codex auth/config保持，32文件验真，升级后ready=true/active0。官方包、隔离实装与实际用户升级分别留证，不混用。

`ziwei_phone_mcp_setup` 新增可选summary，默认full不变；只投影原同权限GET，view不传给服务端。手机数为control_catalog非空ID去重目录数量，不是工作区绑定数；无效/不可用返回null，健康空目录才返回0。成功摘要保留完整数量，最多20条简短资料及裁剪标记，pretty UTF-8≤6144B、escaped-text≤7168B。非2xx HTTP错误文本未新增限长；工具名/次数审计不保存任意参数，缺少绑定本cwd/session的原始事件时参数证据必须unavailable。

第二轮7a只使用普通数量消息、全新personal/plain Codex员工和独立cwd，沿原auth/default profile，不隔离HOME。提示没有指定view、统计范围或数量答案；执行与回答、工具参数直接证据分别判断。创建前独立目录为2员工/2目录手机/2任务，八GET200、旧会话404；此为创建前观察，新QA可能改变员工总数，不能预埋为模型答案。实际结果：普通数量问答一次真实执行succeeded；员工3、control_catalog手机2及范围功能核对通过，cwd按Windows路径归一与实际原生PEB匹配，不声称逐字符相同。严格纯三字段JSON格式未通过：原回复带前置说明，原答案保留。两个只读管理工具各一次ok，phone MCP未配置/未加载，手机动作0；参数证据unavailable（没有绑定本次执行的参数直接证据），不从数量或scope反推view，未追加模型重跑。

## 精确QA清理及剩余事项

| 轮次 | 实际结果 |
| --- | --- |
| 网络fixture | 精确114行提交清理，完整保留保护通过；原临时owner和两设备认证各实际401 |
| 浏览器fixture | 精确80行已提交、完整独立保留复核通过；原owner和两设备各一次真实GET401；旧postcheck失败与独立复核分别保留 |
| first208真实Codex首轮 | 06:42:16.306精确提交82行/8表，四份实际DB SHA/完整性/FK、完整PK减集合、82行before SHA/after absent和3013条保留stable核对通过；Owner auth/正式management状态200、指定QAemployee/会话404 |
| 7a普通问答后的第四轮 | 第四轮精确提交清理88行，正式及其它资源的全部PK/稳定字段和服务保护通过；指定QA员工/会话404，正式Owner/管理状态200，共享management bearer/cache KEEP。浏览器本地两项删除受自动审查阻挡的限制保持。 |

沿用正式Owner/device的QA不删除其身份，shared management bearer/cache KEEP；指定QA访问404不等于通用bearer已401撤销。正式Creator、员工、手机MCP/绑定、auth/config/HOME、任务和其它资源保持。原expired动作及第一轮未通过的数量回答不重放或改写。

最终普通API目录复验为2员工、2个control_catalog手机、2任务；QA员工/会话404，正式认证与管理状态200。六份完整双库备份共85表复核，精确删除88行，3013条保留记录通过保护；正式设备metadata仅有已独立核对的自然续期expiresAt变化，保留当前值，其余正式稳定字段及全部既有A2A历史原始字节保持。最终原生PID17648 ready=true、build33f572…及32文件/配置保护通过；最终公网七资源验真通过。

浏览器本地credentials文件与临时profile两个精确删除目标仍保留：自动审查两次在命令启动前返回 `blocked by policy`，未提供更具体原因，没有绕过或继续重试。线上三项认证已401，不能据此声称本地两项已清除；截图、manifest及原证据保持。
