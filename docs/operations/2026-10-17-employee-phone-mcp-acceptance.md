# 员工手机 MCP 中文输入与图片交付验收

2026-10-17 17:13:02（Asia/Shanghai），原员工“闲鱼运营大神”通过原 Windows 电脑、原 Hermes 独立 Profile 实际完成：手机 MCP 状态检查 → 新截图与读图 → 点击聚焦和清除 → 新截图确认空框 → 中文及数字输入一次 → 原命令回查 → 新截图确认 → 收起键盘 → 最终图片回传。原执行与全部 9 条手机命令均 succeeded；原会话已收到真实 JPEG 附件。本轮没有发现需要更换服务代码或 APK 的功能故障。

## 原身份与派发

- 员工：`employee_78932a02-be5c-42f5-b14d-f4bcb21d3529`，Bot revision 7 / control epoch 15。
- 原电脑：`device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`，Windows；Hermes Profile `bot-2ac0f5f778811a4cc9c15326`，owned_profile 隔离回执匹配。
- 原手机：`android-a2d39137-4c04-463c-b03b-6165a9f12f35`（闲鱼1），Agent / Updater 均 0.4.11 / code22。
- 原会话：`conv_d2c84b56-1c64-4589-b8f4-3232e948b168`。
- 原执行：`action_873a0d40-d17c-4d48-902b-dd3f78045204`，17:06:46.692 创建，17:13:02.905 succeeded。

使用现有 A2A 机器鉴权 HTTP 入口向原员工原会话派发有限验收；服务端重新校验 Bot 并注入当前可信身份快照。原电脑自行 bootstrap 本次员工 capability，再由员工实际使用 MAIN 的 `ziwei-terminal` MCP。运维凭据没有进入员工 payload，未新建会话、员工或 Profile，未通过私有手机 API 代替员工动作。该入口不新增网页 user 消息，因此本轮不声称验证了网页发送按钮。

本次按当前员工、已安装并附加的技能 1.0.1、手机绑定和 account 计算配置 revision `118f9ba0c6e4f16b8247c159ab3f683efeec21119bf1c82116492c9062d427f0`；没有使用旧配置表中的缓存 revision，也没有为此改写缓存、员工配置或绑定。

## 实际工具和原回执

本次回传 `terminalMcp.configured / injected / loaded=true`，原员工、原 Profile、工作区及目标手机全部匹配。实际 15 次手机工具调用覆盖 `ziwei_phone_list`、`ziwei_phone_status`、`ziwei_phone_screenshot`、`ziwei_phone_action`、`ziwei_phone_receipt`；另外 5 次 `vision_analyze` 均有执行和完成事件。

| 步骤 | 原 commandId | 结果 |
| --- | --- | --- |
| 初始截图 | `device-command-d8dfce8e-453f-4b46-853a-33118d4bf382` | succeeded；读图后才定位 |
| 聚焦搜索框 | `device-command-af95db80-0668-4e6c-a12d-0b19601317fd` | succeeded / performed=true |
| 聚焦后截图 | `device-command-6a78c171-359a-44bf-b629-de6d282fdc6a` | succeeded；确认清除按钮 |
| 点击清除 | `device-command-0f7fab66-2297-47a6-acc5-1cb4e9e1bc5d` | succeeded / performed=true |
| 空框截图 | `device-command-f9b735f9-e5fd-46a7-9fb0-67e5ba6fa5e8` | succeeded；灰色 hint，键盘显示 |
| 唯一一次新文本 | `device-command-828ad9b2-d757-46a4-b787-4ceb211290bb` | succeeded / executing_confirmed=1 / performed=true / textVerified=true |
| 输入后截图 | `device-command-c3fcdb73-0769-449d-988c-1833817c54fc` | succeeded；完整新中文与数字、键盘显示 |
| 收起键盘 | `device-command-0c230561-ae37-4a7f-8724-dc565dce4036` | succeeded / performed=true |
| 最终截图 | `device-command-86d727ec-73dd-4d91-8f86-6e3c2b0dabb5` | succeeded；同词保留、键盘隐藏，仍为输入联想页 |

员工可见的轻量 text 回执含 performed / textVerified，但未返回 alreadyMatched 或 readbackSource；员工据实报告未返回。独立只读查原记录确认 `inputBackend=accessibility_ime / readbackSource=bound_editor`，不是 same_node。alreadyMatched 字段未上报，不能伪记 false；空框新截图、唯一一次新 text 和新画面共同证明本轮新输入。

## 图片与执行结束

原会话 assistant 消息 `convmsg_9d1ff836-fc80-4aed-9be7-26c54b692efa` 在 17:13:02.905 实际保存 JPEG 附件，720 × 1612、107,244 字节，SHA-256：

`a9d211b970e73052f7068da4931584bba8a652e8b48c532ae413fcdeed997964`

附件 bytes 与最后原命令 screenshot result、MAIN 对应 run 的 snapshot 逐字节一致；5 张 run 图片与对应原手机命令 bytes 也全部匹配。下载后再次核对 SHA，主代理及独立审查分别目视空框、输入后和最终原图。图片按本次输出目录和 manifest 进入原会话，不能把 MEDIA / 本机路径当成交付；本次已取得实际附件。

员工原生执行退出码 0；Windows Job 的 rootConfirmed / treeConfirmed 均 true、activeProcesses=0。17:13:25 只读核验双22仍在线健康、双 socketConnected=true，控制 Agent / epoch14、draining=false，手机和主站无活动事务。17:13:26 主站 PID351449、中控 PID361304、Nginx master737 及 current 路径保持，公开健康检查与 APK 索引摘要保持。

## 范围与证据

仅操作搜索框，没有点击搜索、Enter、商品、发布、交易或发送消息，没有重放旧失败 / uncertain 命令、重提安装或修改历史回执。本轮不新增生命周期、直接非空覆盖、same_node、升级 / 入网 / 控制切换工具或网页输入入口的验收结论。原 0.4.11 发布 manifest 的 deviceVerified=false 保持，真实手机证据独立记录。原定时任务保持暂停。

逐条 initialize / tools/list 原始审计仍在原 Windows，标准回执将两者合并为 loaded；本轮未单独导出这两条原始协议事件。实际 MCP 加载、工具调用、原手机动作、新画面和图片交付证据支持上述功能链路通过，不扩大为已逐条读取握手日志。

私有原始证据保存于 gitignored `.local/android-stability/`：`mcp-v22-submit01.json`、`mcp-v22-observe08.json`、`mcp-v22-collected.json`、`mcp-v22-final-phone.json`、`mcp-v22-final-services.json` 及 5 张原截图、实际回传附件。公开文档不保存测试词、原图、凭据或业务内容。

## 额外只读核对与审查更正

审查方连续查看多图时曾误判输入后截图的键盘状态，触发额外只读核对；逐张原图及独立审查确认输入后图确有QWERTY键盘，原员工17:13总结正确，不属于手机或MCP故障。原图、原成功回执均保留，不为这次审查误读修改软件。

只读执行 `action_0b52d7dd-9889-4ca1-bb95-958aa2d4cb2b` 于17:20:20.375 succeeded，仅list/status、一次新截图和读图，没有点击或输入。原截图 `device-command-bfb7ea16-f1ac-4792-a55c-bb99c7ed63fb` 与同会话新图片附件逐字节匹配，107,008字节、SHA-256 `ce2de5da3c73e536ee1180ecf6e8b2b1391e3ae6f0ba513560d1e37853b4aeb8`；新时点仍保留原词、键盘隐藏。它仅说明该新时点，不能据此反推输入后原图没有键盘。审查方的错误前提另通过原会话文字说明撤回，以下收口按逐张原图和实际回执为准。

文字说明原执行 `action_f3b5f02c-e690-44ce-935b-cdce72df0bd7` 于17:22:38.044 succeeded，原会话消息 `convmsg_1d67e4f8-270a-4863-baf7-252fa68a5891` 已确认收到审查方更正并保留原键盘状态、输入与图片交付成功结论；该执行没有手机run或手机命令，进程树退出已确认。旧只读回复中的历史判断不作为验收依据。

全部补验收尾后，2026-10-17T09:23:45.548Z 再次只读确认双22在线健康、双socketConnected=true、控制Agent / epoch14、draining=false，手机与主站均空闲；17:23:55.453只读核实原定时id1仍PAUSED，没有改动。最终证据另含 `mcp-v22-visual-collected.json`、`mcp-v22-review-note-observe02.json`、`mcp-v22-final-phone-after-followups.json`、`mcp-v22-final-automation-status.json`。
