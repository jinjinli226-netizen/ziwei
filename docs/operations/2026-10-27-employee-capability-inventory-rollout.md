# 员工能力清单三层正式集成

来源：总控会话 2026-10-27 的直接人工要求“那为啥不安排上线啊”。原 `67b85ab0247805bc4fe6ef740c3865e28229dd8a` 是源码交付，不代表网页/API、正式客户端或实际员工清单已上线。本事件按最新明确授权推进三层：网页与 API、正式 ziwei_user、李金晋单台电脑的受支持空闲升级及只读快照验收。其他电脑不批量升级；已由用户自行恢复并停止的推理事件不重新触发。

## 正式平台与下载通道回读

2026-10-27 22:28（北京时间）已分别确认源码、正式平台和官方下载通道：修复源码 `91505396d9e08efb9b9981d8ec0cc1b5f711b40f` 已推送并核远端；实际 API/前端 release 为 `/opt/ziwei/releases/employee-capability-inventory-9150539-20261027-retry3`，API PID `1140403`。正式平台 41 个 dist、两域下载 8 项和两域 Windows 更新脚本 2 项全部按真实字节验收；单写发布窗口已关闭。此时本机升级和两个员工的实际只读清单仍分别待验，不能用平台成功代替设备成功。

正式 `ziwei_user 0.1.4`：包 1256677 B，SHA256 `8412dd022849a1a64d9115b4f1a69e418f489f2783a1c0b6a531339f3c884705`，package-content build `875c9bcff635e7aeaa67e2e0fc984b90d9b2996a7e1a99e174948b02fbee3137`。公开 metadata SHA256 为 `93a1dc7a81516247f5b4a30fb445c2d34b2e513f888b4613032ff0be87f34be4`；不可变包名 `ziwei-client-0.1.4-91505396d9e0-875c9bcff635.tgz`。

正式发布前两次失败及受限回滚均保留：第一次误将独立主站 `qzelynth.top/index.html` 当作驾驶舱页面，改为仅验收 canonical `ziwei.qzelynth.top` 平台资源；旧域根站保持自身内容，两域仅共用正式 CLI 下载别名。第二次平台与两域包已过，末尾只读脚本 GET 遇临时 DNS `EAI_AGAIN`；仅该类只读网络错误加入最多三次有界重试，HTTP/hash 不重试，任何写操作不重放。产品源码和三份工件未因这些运维校验修正而改变，无数据库恢复、原生 Hermes 或员工配置迁移。

本机首个更新助手于 22:33 在公开包校验阶段退出，`postAttemptedThisRun=false`、`request=null` 且无更新意图文件，失败原回执已另存。消费者诊断证明两域 metadata、TLS、DNS 和小脚本均正确，但 45 秒内归档流不完整；延长的只读诊断分别用 Node 85 秒、curl 132 秒完整取得同一 1256677 B / `8412dd…` 包。后续助手仅将公共归档读取预算改为 180 秒，并新增安全阶段/字节数/错误码；metadata/API、原生维护强证明、同一幂等键、`waitForIdle` 和单次提交条件保持原逻辑。新增七项公共流用例与原八项强安全回归共 15 项通过，包括完整 hash、错误 hash、截断和超时反例。未修改系统 DNS、TLS 或代理配置，也未修改产品运行预算。

用户随后明确预算指的是**校验脚本超时**，不是会话执行时长。最终独立助手使用一个 `performance.now()` 单调时钟的 600000 ms 总校验 deadline；两个归档完整流共用剩余预算，metadata 单次仍不超过 15 秒，认证/API、原生证明和 POST 门保持原样。外层 30 分钟有限守护覆盖整个更新流程，不强杀业务；17 项预算/完整 hash/截断/超期/安全回归通过。实际公共校验用时 234185 ms，两个完整 SHA 均通过。此前误记的“会话50分钟/23:42截止”已从状态移除。

180 秒助手曾在随后身份链路遇 503，依旧无升级意图；单次受限身份诊断定位到本站 callback 503，旧隐私日志无法区分 OP 网络与本地数据库等待，未据耗时擅改身份产品、DNS 或权限。新的独立合法登录已完成 callback303、预期 subject 及自行登出200；最终正式助手和页面验收也均正常登录、登出。旧失败、回滚和登录诊断原始回执全部保留，不伪造历史成功。

## 实际电脑与两员工验收

2026-10-27 23:39 已完成仅李金晋电脑 `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493` 的产品通道升级。唯一新请求 `client-update_e7913d6a-a77a-4c3a-b654-45490cbf52f6`，固定幂等键 `employee-capability-inventory-91505396-device-bfd9a3d2-v1`，`waitForIdle=true`。双次原生身份/实际 build/空闲及原维护回执检查后才提交；等待期间未强杀、清队列或重放旧请求。

实际新进程 PID `52612`，CLI 输出 `ziwei_user 0.1.4`，运行/模块 build 同为 `875c9b…3137`；认证目标心跳、`native_worker_v1`、原生 complete 终态、worker/supervisor 已退出和维护锁不存在全部通过。客户端配置仍为原 SHA256 `7913bf1c1b490ecf9b6d6760787973c28f8c484703c144eb0028b57ef8166b72`。旧 `9c7a…` 成功与 `75cde…` 失败/未知历史保持原证据。原生 Gateway PID `59448`、创建 FILETIME、命令摘要和 owner 在更新前后相同，本轮没有重启或改原生 Hermes/员工模型。

23:42 完成两名员工各一次专用只读刷新及真实页面缓存 GET，全部主体/设备/Profile/配置绑定匹配：

| 员工 | 独立 Profile | 实际只读动作 | 观察到的清单 |
| --- | --- | --- | --- |
| 知微 | `bot-e1bf33c85b1543b18ecd3d6a` | `action_df3c4b31-5722-464f-b727-2819b3c19671` | Skills 3、MCP 配置 2、CLI 白名单 6（其中 4 个安装可确认） |
| 闲鱼运营大神 | `bot-2ac0f5f778811a4cc9c15326` | `action_13da92d8-4c9d-4f73-9a6d-6a0e2f4970fb` | Skills 3、MCP 配置 0、CLI 白名单 6（其中 4 个安装可确认） |

两者 source 均为 `device_readonly`、不同动作和 Profile，缓存重复 GET 没有新动作；返回通过 secret 投影检查。已发现/已配置不等于员工已授权或本轮已加载；CLI section 因员工授权未检保持 `partial`，授权/加载层继续显示未知，不用清单证明工具或模型实际执行成功。

正式浏览器用独立登录态，实际打开“Bot伙伴 → 能力组合”与“资料与工具”两处入口，逐员工/逐清单行与已验证 API 快照一致；匿名显示登录且零清单读取。真实 UI 仅放行同源 GET/HEAD，未点击刷新/配置验证，转发业务写为零，页面错误为零；WebSocket 被拦截。整个验收只新增上述两个只读动作，无本轮模型、聊天或手机调用。其他旧电脑未升级，仍按能力标记明确显示不支持，不能宣称全员全设备已采样。

关键证据均在事件目录：`ONLINE-PUBLICATION.json`（平台/官方包）、`CLIENT-PRODUCT-UPDATE-014-READBACK10MIN-FINAL.json`（更新强终态）、`LIVE-INVENTORY-ACCEPTANCE.json`（两员工）、其指向的 `LIVE-INVENTORY-UI-PROOF.json`（真实页面）及原生进程前后证明。它们分别验收各层，不能相互替代。

原独立诊断已接到新进程：watcher `41084` → client `52612`，32 个健康/身份样本、owner、双方 FILETIME 和实例锁通过；源 Python SHA `aa204021…` 未改，沿用 10 秒心跳、退出码记录及 5 MiB × 5 轮转，日志为 `C:/Users/25941/AppData/Local/Ziwei/ziwei_user/logs/client-exit-watch.jsonl`。原验证器在 Windows PowerShell 5 默认编码读取含中文的端口 JSON 时失败，保留该回执后仅用显式 UTF-8 的独立验证器复核通过，没有重启观察器或客户端。原端口记录 `2fc1eec40b979a39` 仅更新诊断备注，名称、D 盘项目路径、4178/5178/20242 和其余 49 条登记均保持原值，原始登记字节已备份；没有新增服务实例或强退真机验收。

## 实际基线与完整支持门控

正式基线按现网混合源码冻结：安装页 `b75b4c8` 的新域、QR 和当前入口资源均保留，API 还包含精确叠加的 `device-updates` 修复。客户端基线是两官方域实际完整下载验 SHA 后的 `0.1.3 / 56511f8f…`，归档 SHA `ac6e2989f2bfa33898ea211eb639b33ae0aca3ebef820cf6b4ba14aefca96e64`。

隔离执行实包发现：0.1.3 的 daemon 虽误报 `employee_capabilities_inspect_v1`，包内却缺采集器及 handler、派发 cwd/截止、15 秒/60 秒 budget 和服务端准入 hook；真实 dispatcher 返回 unsupported，不能按旧标记派检查。完整新实现使用 `employee_capabilities_inspect_v2`，动作类型和快照 schema 继续为 `employee.capabilities.inspect / 1`。创建、ACK、执行准入都核对当前 v2；排队后客户端降级也必须拒绝。显示版本递增为 `0.1.4`。

客户端候选从实际正式包精确叠加功能文件及版本，保持原依赖和其余程序字节。Hermes Gateway 桥、0.1.3 维护完成证明/回滚恢复/启动预算不改；内含旧原生补丁材料不以工作树新副本覆盖，实际 Hermes 原生进程、源文件和 Profile/HOME 不因本功能重载或迁移。

## 上线前审查修正

- 通用动作 GET 不能以原请求 userId 绕过嵌套清单 subject。对该专用类型重新核对当前员工、所属用户、工作区和设备权限，归属或可见性变化后不能读取旧 raw payload/result。
- 个人工作区设备归属与当前成员角色使用同一授权谓词贯穿读取、创建、领取、执行。原请求者管理员降为成员后，不能继续检查非本人设备。
- 页面刷新遇到明确 401/403/404/410 或 scope 错误时清除旧详情和轮询。网络结果未知保留“先读回、暂不重复提交”保护。非 Hermes 同身份修改 skills、管理 MCP、model、status、cwd/cwd 设备时，以当前员工公开配置的稳定 key 提升 generation，丢弃旧延迟响应；不伪造服务端 configFingerprint。
- 文件目录使用 bounded iterator，上限加一项即停止并关闭；不先读完整目录再 slice。原生技能策略不可读取时，空技能根不能显示完整零项；已有条目保持 partial。quoted dotted TOML MCP 名称能读取，未适配的表拼写显示 partial，不静默返回 ready/0。
- 单份不超过 256 KiB 的 SKILL.md 为计算完整 SHA 会读取全文，只解析有界 frontmatter 并返回脱敏摘要/hash，不回传正文。不能宣称“不读取正文”。不读取登录凭据文件、执行 CLI 或导入模型运行时。

以上缺口均先用原实现复现红测，再最小修正，保留权限和严格绑定，不通过放宽校验满足展示。

## 验证与发布门禁

首轮父会话联合 99 项通过、0 失败、0 跳过，lint 检查 268 文件通过。新增真实 App/SQLite 无监听整链覆盖缓存 GET 零动作、refresh、认证 ACK/admission、真实 dispatcher/文件采集、认证 result 和缓存回读；另覆盖两个员工同名 Profile、旧标记误报、配置与 revision 变化、迟到/撤权/错误设备/脱敏。前端控制器、实际 SFC watch 与现有 Workbench 相关回归通过；校准浏览器夹具不能冒充混合候选或生产。

`4a01e3d` 的实际混合候选随后完成 56 项后端/冷安装整链和 9 项真实构建浏览器夹具验证。基线前端重建 12 文件逐字节复现现网，31 个旧指纹资源保留。第一次混合浏览器失败是夹具遗漏现网新增的只读 `/api/identity/config`，补齐该夹具后通过；失败证据保留，产品源码未因此修改。

最终独立复审仍发现两个窄缺口，故 `4a01e3d`/旧 `cfd08d…` 客户端候选未发布并保留为被替代候选。合法 TOML 表头的空白、quoted/escaped 根名和数组表若未适配，必须标记 `native_configuration_partial`，不能返回 ready/0；6 个新增输入在旧实现均失败，最小修正后采集/派发 28 项通过。库存类型的通用动作 GET 还须将 result/error/events 统一投影，不能绕过专用清单接口的脱敏；该边界针对受支持设备提交附加字段，不声称当前正式采集器会主动读取或返回密钥。修正后重新冻结受影响 API/客户端并复审，其他动作回执合同保持原状。

两项修正后，新增真实认证设备 result/events 附加字段、失败原诊断及非清单动作保持原合同的 HTTP 回归均通过；原始数据库回执/事件保留，通用清单读取仅公开安全字段。父会话联合 108 项通过、0 失败、0 跳过，lint 268 文件及 diff 检查通过。此为源码验证，尚不代表新版正式发布或实际设备验收。

源端命令：

```text
node --test backend/employee-capability-inventory.test.mjs backend/employee-capability-inventory-integration.test.mjs test/employee-capability-inventory.test.mjs test/employee-capability-metadata-boundaries.test.mjs test/employee-capability-dispatch.test.mjs frontend/src/employee-capability-inventory.test.mjs test/bot-capabilities.test.mjs
```

实际前端、API 和客户端分别按最新冻结混合基线形成可审核精确工件。必须保留安装页及旧指纹资源、当前后台修复、数据库、用户身份和授权。源推送并核对远端、完整候选浏览器/离线包及独立复审通过后，交总控审核并由既有 sole-writer 在新事件窗口统一发布；不直接整树覆盖。

上线后还必须经产品通道 `waitForIdle` 升级仅 `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`，核实际新版本/build/PID、配置原字节、认证心跳和真实维护终态。旧任务未空闲则等待，不强杀、不清队列、不重放旧更新。仅显式员工只读清单动作，不做模型、聊天或手机业务。最后核实际设备快照、选中员工入口可见、Profile/设备/revision 不串、返回不含 secret，才可报告已上线；其他旧设备仍显示未支持。

持续脱敏证据位于 `D:/AINavtie/ops/ziwei/employee-capability-inventory-rollout-20261027/`，以 `OWNER-STATUS.json` 分别记 source/platform/client/device 状态。本文保留候选门禁和历史失败的时点，正式发布、单机升级与两员工真实快照的最终事实以上方正式回读为准。
