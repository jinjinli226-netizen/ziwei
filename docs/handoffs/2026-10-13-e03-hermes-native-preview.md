# E03 原生 Bot 前端组合与持久预览

2026-10-13，Asia/Shanghai。E02 Group/Gateway 补丁已稳定接入，三项新增真实组合验收与完整836项回归通过，唯一持久预览已更新。页面顶部介绍区已按用户要求删除，创建与Creator按钮保留在名册工具区。正式账号、云模型与24小时墙钟运行不在本次证据范围内；后续独立Q审查由协调者组织。

## 候选与入口

- 前端：<http://127.0.0.1:5283/preview-bots/bots>；API健康：<http://127.0.0.1:4283/__preview/health>。仅监听127.0.0.1，沿用5283/4283。
- 代码树：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-full-ui\灵光爸爸拆解`；分支 `codex/v2-e03-hermes-full-ui`。
- 基线 `90e588b84a7a69a0ec41fbe41e5ebfb18debdb8a`；E02首轮稳定来源 `037cb777c5f23d81622d451a5d1b67cd2098b786`，本树等价挑入 `04f2bbfb`。后续补丁来源 `8cca4e2986c1b276ae2c4d48ad7b979c1fd68025`，本树稳定挑入 `7db1d8e281ceb25aa49586e4b471d93a9ed92975`。运行候选 `ac9cf8c088b2e04d38e8623a2b07a0c200e56f11`；随后仅文档交接更新，以分支HEAD查看最终审查候选。
- 当前实例 `2026-10-13T02-23-10-305Z-50996`，上海10:23:10启动，`windows-independent`；监督PID50996，API PID4240，Vite PID14064。PID仅为本次记录，操作前必须重新核对状态、命令行父子关系和实际监听。
- 状态/数据保持原树：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview`。配置 `ZIWEI_PREVIEW_DATA_ROOT` 指向此目录，代码根与持久状态根分开。
- 端口登记ID `498622e5bdf9d880` 保留；登记cwd继续代表原持久项目根，备注写明新代码根及日志绝对路径，诊断已验证。

## 用户流程与实际能力

选择“**Hermes 原生伙伴**”，或创建Bot时选择“本机原生隔离预览 · 本地测试 provider”电脑及 `default` profile。保存配置，在运行记录检查已保存配置，再明确启用。原生伙伴与团队管理使用同一个employee ID、Bot配置、控制状态和主聊天。

资料与工具支持原生MemoryStore/用户画像CAS修改、逐条删除、SessionDB检索、技能正文与Hub、stdio/HTTP/SSE MCP配置及schema/结果。伙伴协作提供同工作区精确目标的DM、群组/@、委派及源/目标进度。消息与音频提供Gateway配置、原生状态、控制入口、浏览器录音/上传STT及多文件TTS。主动工作提供有界Goals/Heartbeat、Kanban任务/Run结算；Routine可选择goal/heartbeat/kanban/group有限驱动，保留紫薇唯一调度权威。

请求使用真实产品API及 expectedRevision/controlEpoch/idempotencyKey。执行未知保留原action；丢失响应后先定位原记录；成功但读回失败只重读。原生staged/等待审核、依赖、授权、失败及uncertain分别展示。sessionStorage只保存恢复元数据，不保留记忆正文、消息、MCP参数、音频或凭据。手动刷新原生记忆保留已编辑正文，冲突时用户可核对并明确采用最新内容。

旧“资料研究员”等合成伙伴保留原设备/profile/ID/聊天，不自动改绑。Fixture worker只执行列明的合成检查和普通聊天/普通Routine，原生、协作和driver动作明确失败，不生成假NativeReceipt。实际拒绝回执已单独验证。

## 隔离、数据与运行

原SQLite、objects、fixture标记、访问/设备/签名资产和HOME留在原目录。旧`.local/employee-env.key`保持原关联：repository仅在初始化时以旧owner cwd读取原始持久键，随后恢复代码cwd；不改用会再次hash的字符串key模式。没有读取或回显密钥值。切换前建立一致SQLite备份，旧两位员工、14条会话、22条消息逐行hash核对保留；账号认证字段保留，只有正常登录更新 `last_login_at`。

新增原生设备在隔离库通过产品配对取得workspace/device凭据。执行复用官方 `createLocalActionExecutor`、`ActionDispatcher`、`createActionDelivery` 与 `createActionScheduler`；持久started/result补传沿原action，不在预览适配器复制业务状态机。群父任务仍保留子任务容量。设备回调保留原设备认证和action/workspace检查，不注入owner cookie。

原生source、各Bot HOME、dispatcher journal/outbox均在原预览runtime-home内。`default` source是本预览生成的本地测试profile，不引用正式Hermes HOME、认证或密钥。已安装Hermes 0.21.3实际运行，原生资源归属原Hermes文件/数据库；模型/语音/MCP协议端由同一个4283 API的`/__preview/native-peer`提供并明确标注本地测试。Python出站只允许4283与同一Python进程自己创建并登记的loopback listener；后者用于Windows asyncio内部socketpair，并非专门识别socketpair的机制。其他项目loopback端口和外部连接被拒绝。预览不启动任意stdio命令；产品本身的stdio接口仍已接入。手机MCP关闭。

**本预览的Gateway配置/状态入口可用，但不启动外部渠道监听器。** connect明确返回未启动原因，避免新增未登记端口；未用通用peer伪造连接成功。真实adapter、群源成员、DM/delegate及49个协议回执见E02验收，但具体云渠道实账号仍需授权电脑的SDK、凭据及已登记端口。自动Routine调度关闭，手动有限驱动实际运行。

健康中的`hermesInstalled`表示安装发现；`nativeExecutionVerified`只在本实例收到匹配版本的原生检查/操作回执后为true。它们不替代各能力的实际回执。当前两者均为true，schedulerEnabled=false。

## 验证与证据

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 最新组合完整Node回归 | 836/836，0失败/跳过，90.20秒 | `node --test --test-concurrency=4`；`.local/e03-full-evidence/followup-full-final.txt`；运行源码7db1d8e |
| 新增真实产品HTTP + 前端controller/transport + installed Room/Mattermost + 官方scheduler/dispatcher | 3/3，7个记录的执行回执、6次模型请求，清理及树证据确认 | `.local/e03-native-followup-1791857961927/receipt.json`、`cleanup.json`；实际协议REST/WS握手，source→peer→source与第二source取消 |
| 实际Gateway致命失败原始状态 | failed / mattermost_auth_error，匹配原connect action，nativeVersion 0.21.3 | 同目录`gateway-fatal-status-receipt.json`，从实际持久dispatcher journal提取并核对 |
| 更新后当前实例原生健康/只读操作 | 双端200，真实记忆read succeeded，root/treeConfirmed=true | `.local/e03-native-preview-evidence/current-health.json`；API PID4240，独立后台入口 |
| 首轮组合完整Node回归（历史） | 823/823，0失败/跳过，48.94秒 | `.local/e03-full-evidence/full-native-final.txt`；代码21f3ae3 |
| Lint / build / diff | 109源文件；1781模块；通过 | 原有约502kB主入口体积警告保留 |
| 原生面板合成浏览器 | 21/21，页面异常0 | `.local/e03-native-ui-evidence/result.json`、`followup-corrected-final.log`；纯拦截fixture，证明UI流程及failed/code保留与普通断开 |
| 原界面合成浏览器 / 顶部删除后的真实布局 | 15/15，页面异常0；390px不溢出 | ac9cf8c候选复核`.local/e03-ui-evidence/followup-final.log`；更新后的`clean-layout-desktop.png`、`clean-layout-mobile.png`真实页面捕获 |
| 实际产品HTTP + 前端controller/transport + installed Hermes | 7/7，34个执行回执 | `.local/e03-native-http-1791831036357/receipt.json`；记忆连续CAS、丢响应不重写、技能开关版本、Goals/HB/SessionDB、整数Kanban Run、MCP/STT/TTS、同主聊天；source config/auth未变 |
| 真实持久页面/API/官方原生worker | 9/9，16个执行回执，页面异常0 | `.local/e03-native-preview-evidence/result.json`；包括页面创建同员工、原生记忆写读、MCP、音频、单次Goal模型回合与预算结算、HB/Kanban、主聊天、其他项目端点拒绝及390px布局 |
| Fixture原生失败 | 1/1 | `fixture-rejection.json`；code=PREVIEW_NATIVE_REQUIRES_NATIVE_DEVICE，无NativeReceipt |
| Windows asyncio隔离 | socketpair/asyncio通过，其他项目端点拒绝 | `frontend/verification/preview-socket-guard.mjs`使用已安装解释器运行 |
| 旧数据保留 | 2员工/14会话/22消息及账号认证保留 | `preservation.json`；一致备份在原stateRoot/backups |
| 诊断 | 隔离退出码/强制退出/脱敏测试通过；当前双端200且心跳追加 | `frontend/preview/diagnostics.test.mjs`及原stateRoot/logs |

实际HTTP与持久页面均未mock响应。模型、语音、MCP协议端为本地测试，不能作为云模型质量或外部账号连通结论。测试只创建/删除自己的验收员工ID；旧员工及用户数据没有删除。调试中的MCP隔离失败、脚本选择器失败等记录保留，最后成功JSON为验收依据。

新增follow-up使用真实产品内存数据库API、前端API/controller/transport、官方worker及本机Hermes；模型与Mattermost REST/WS均为自己临时建立的loopback协议端。网络只允许这两个端点与该Python进程自己创建并登记的loopback listener，后者用于Windows内部socketpair。REST Bearer与WS认证帧都精确核验，撤销后的真实WS握手返回401；第三方posts为0。正式源config/auth、账号与设备未访问。两个Group场景共六次原生模型请求；停止时第二source的SSE真实等待，更新产品controlEpoch取消原父action，聚合树确认activeProcesses:0，并观察十个调度周期未重跑、dispatcher无quarantine、delivery待补传为0。清理不以idle代替树确认，未知树会记录cleanup错误且不能写passed。

初次新浏览器夹具复核因测试未配置Slack却选择Slack而失败，修正夹具真实配置后21/21通过；保留`followup-final.log`失败记录。产品代码未为测试放宽选择或失败判断。最新完整回归在该夹具修正前已通过，后续只改独立verification脚本，没有改运行源码。

日志绝对目录：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview\logs`。独立supervisor每15秒检查两端健康、记录PID/退出码/信号；API同周期追加心跳，stdout/stderr脱敏、按实例文件与5MiB轮转历史保留。之前两次实例完整保存在instances与日志内，原生Bot另有自身生命周期证据。Windows更新只停止新观察核实的本预览API，supervisor关闭配套Vite并记ended；未对正式服务执行进程动作。

## 已闭合的Group/Gateway审查与运行记录

1. **精确`@发起Bot`已修复并实测。** E02使用受信冻结Room roster核验完整mention；targets仍只包含授权的其他成员。新增真实HTTP场景确认source→peer→source，两个source回合复用同一父action，各Bot群会话与主聊天独立，前端只显示一条父记录。
2. **同父任务多次source监督与停止已修复并实测。** 聚合`runtime-group`监督覆盖native read/publish及所有本地source模型进程；第一轮退出不关闭父生命周期，停止关闭后续准入，第二轮的未知树不得晋升为停止成功。
3. **Gateway实际失败状态已修复并实测。** 安装的MattermostAdapter真实REST/WS流程经历401后，status查询NativeReceipt本身成功返回，`data.runtime`内Mattermost渠道状态为failed/mattermost_auth_error，前端保持该报告。断开保留失败原因，stopConfirmed与processExit单独证明树已回收；缓冲心跳不恢复连接。其余恢复/未知发送门闩由补丁11项Node竞态测试覆盖。

E03只接入E02干净稳定提交，未直接修改其工作树或分工的backend/src/contract实现。内部两名只读审查员核对runtime-group、Gateway健康与前端回执；其提出的fixture失败原因保留、失败收尾树证据均已修正并重新验证。独立Q审查尚由协调者在交接后组织；不将本次组合验收表述为全部云账号或24小时耐久已验收。

恢复前的历史实例52396曾在上海06:26:58后停止记录心跳；重新观察时三个PID及端口均不在，且无完整退出记录，无法判断停止原因。09:28:57沿原状态根恢复为独立实例24728，记录previous_unclean_exit。10:23更新前核对三进程命令行/父子/端口身份、只读确认pending/acked为空，另做一致备份`backups/before-followup-1791858141476.sqlite`。仅结束已核实的本预览API，监督器记录API退出、Vite SIGTERM、preview_ended与supervisor_exit；随后沿同一个原生supervisor入口启动50996。旧数据、instances、HOME、journal/outbox、opaque密钥及日志全部保留。

正式D目录、2884、正式服务器/数据、Creator原HOME/会话、客户端、真实手机及既有Hermes安装源码不在本次修改范围；没有push、正式merge或发布。

## 重验与保留

优先复用当前实例，不为查看或登记重启。启动确需恢复且用户已要求时，核对登记簿/实际监听/当前PID身份后，从新代码树沿原入口启动，显式保留状态根：

```powershell
& .\frontend\preview\launch-windows.ps1 -StateRoot 'C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview'
```

验证脚本使用同一状态根；Playwright路径由`ZIWEI_PLAYWRIGHT_PATH`提供。原生实际HTTP脚本自行建临时HOME/数据库与ephemeral协议peer，结束时清理进程/环境；它不会切换当前持久预览。

`launch-windows.ps1`仅独立启动原`frontend/preview/supervisor.mjs`；检查原状态库、精确代码入口及两端口无监听，环境仅继承系统运行项和本预览HOME，保留原端口/原生入口，不接管其他项目。当前预览已有实例时直接复用，不再次启动。
