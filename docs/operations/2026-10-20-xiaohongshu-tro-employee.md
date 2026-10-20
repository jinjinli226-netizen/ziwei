# 小红书 TRO 运营员工：创建、岗位决策与最终头像交接

本文是 2026-10-20 的脱敏观察摘要，供另一台电脑上的 AI 接手现有员工。配套机器可读证据为 [QA 摘要](../qa/2026-10-20-xiaohongshu-tro-employee.json)。两份文件包含必要身份、任务、结果与证据边界；clone 后无需取得原 Mac 的 `.local` 才能理解本轮状态。本文不包含账号凭据、完整聊天、用户照片或生成头像资产。

## 接手现有员工

正式站为 <https://qzelynth.top>。使用有权访问 `bigtron` 的真实账号，在团队管理或 Bot 入口核对同一个中央员工，再打开原主聊天；不要重新创建替代员工或重放本轮任务。

| 项目 | 已确认值 |
| --- | --- |
| 工作区 | `bigtron` |
| 员工 | 小红书 TRO 运营；`employee_e6b7a53c-c647-4a38-be18-46bc30381bad` |
| Runtime / 可见范围 | Hermes / workspace |
| 电脑 | 公司台式；`device_11af6d85-6c5c-4cbe-9a25-31599a474e5d` |
| 独立实例模式 | `owned_profile` |
| Profile | `bot-5626d724d71935aa28c3c125` |
| 实际 HOME | `C:\Users\PC\AppData\Local\hermes\profiles\bot-5626d724d71935aa28c3c125` |
| 主聊天 | `conv_94eb84bf-d569-453c-bed1-06dca015bc3a` |
| 主聊天工作目录 / 执行 cwd | `D:\AIUSE\xiaohongshu-tro` |
| 最后核验的 Bot 状态 | revision 2 / control epoch 3 / validated revision 2 / active；无 active action |

HOME 是该员工的独立原生 Profile 路径，业务工作目录是 D 盘路径，两者分别核对。员工的 `default_working_directory` 未设置；本轮设置和验证的是主聊天目录，不能宣称所有新会话都已获得员工级默认目录。接手后先回读当前配置及原动作，保持该电脑、Profile、HOME 与 D 盘目录绑定。

## 创建与初始化验收

员工通过真实认证的生产 UI 创建、配置、验证并启用，使用既有中央员工与 Bot 流程，没有修改产品代码、部署服务或在 Mac 启动监听服务。

| 步骤 | 精确动作 / 消息 | 结果 |
| --- | --- | --- |
| 建立独立实例 | `action_668cedfa-5245-444c-a485-ae8964d6d544` | succeeded；独立 owned Profile 就绪 |
| 配置验证 | `action_692dab25-541b-4738-81bd-c83f32616d87` | succeeded；root/tree 退出已确认 |
| 目录检查 | `action_30dfede3-ef39-4f17-b2a1-ca25960c0e38` | succeeded；用于原主聊天 D 盘目录 |
| 初始化消息 | `convmsg_f10c62be-7df7-4bc8-a058-cfb9c217699b` | 只执行受限初始化小任务 |
| 初始化执行 | `action_0aa13660-4a67-4e65-acc1-c8626383e82b` | 2026-10-20 11:15:22.940 北京时间完成，succeeded |

初始化执行的服务器回执于北京时间 11:20:07 回读：实际模型 `gpt-6.1-sol`，原生 session `20261020_111101_694e10`；root PID 10684，root exit 0，root/tree 均确认，活动进程 0，无后台保留。管理 MCP 的 configured、injected、loaded 均为 true，`ziwei_get_employee` 实际调用 `ok=true`，不是只保存了配置。

真实 UI 显示自己的员工查询、terminal、write_file、terminal 均已完成。服务器保存的最终执行回复报告已创建并读回 `D:\AIUSE\xiaohongshu-tro\TRO-小红书运营启动清单.md`，UTF-8 正确、非空，4704 bytes，SHA-256 为 `2239e72c5248dbbea85b6fe0adf9e2d7630dd835fedb3980bce372194ec3dbf9`，并返回 `TRO_XHS_READY`。这里保留的是工具完成观察及真实执行回复中的文件回读结果；本次文档整理没有再次连接电脑读取文件。

## 员工自主决定风格与技能

用户授权“让员工自己决定”账号风格与 skills 后，协调会话在原主聊天仅发送一次独立任务，标记 `TRO_STYLE_DELEGATION_20261020_01`。服务器确认：

- 用户消息 `convmsg_4315a2af-6110-41fd-bf37-8034c51b1a3a` 于北京时间 11:41:42.459 保存。
- 唯一绑定动作 `action_fd901c1a-1711-4ed5-9804-c1f818e84548` 于 11:41:46.041 ACK；11:42:22 的只读快照仍为 acked，电脑、员工、主聊天、Profile 和 cwd 全部匹配。
- 后续完成证据来自协调会话对真实主聊天的 UI 回读：北京时间 **11:54 显示完成，265 个阶段**。该证据的来源为 `coordinator_observed_main_chat_UI`，没有另外保存该轮服务器终态或 root/tree 退出回执；不能把旧 ACK 快照当作服务器终态证明。旧 intent 中 `completed=false` 与 ACK 文件保持原样，未为本次交接改写。

员工选择“**冷静的跨境案件工作台**”，采用《TRO案件核对》《收到通知以后》《一案一拆》三个栏目，色彩方向为暖白、深青、石墨、琥珀。员工阅读了 **6 个候选技能源，外部安装 0 个**；现有 `hermes-agent` 已 load。研究记录涉及 3 个赛贝官网样本以及主页/作者关联，未取得公众号原文，不能宣称公众号原文已核验。

主聊天 UI 回读报告下列产物位于 `D:\AIUSE\xiaohongshu-tro`：

- `账号风格规范.md`
- `技能决策清单.md`
- `研究来源与核验记录.md`
- `TRO-示范稿-咨询材料整理.md`
- `执行进度与阻碍.md`
- `验收记录.json`

这些文件名与岗位决定来自上述真实主聊天 UI 观察，本摘要没有另取文件内容、大小、hash 或原生技能审计。6 个候选来源不等于 6 个已安装技能，也不代表 Mac 上的技能会自动同步到员工宿主。

`AGENTS.md` 的持久写入触发了保护审批并被阻止，员工没有绕过。当前聊天已采纳这些约定，**跨 session 自动加载尚未闭环**；下一位 AI 不应假定该文件已经落盘或开始自动生效。此阻碍在本轮未修复，也未重派任务补证。

## 最终头像：用户原图已保存，其他配置未变

用户纠正头像需求后，最终使用用户上传的原图 JPEG。此前生成的候选不是最终状态；本文和仓库均不纳入原图或生图资产。

本轮通过生产正式“编辑数字伙伴”表单选择原图并保存一次。该表单提交原有配置及头像，因此保存前后对非头像字段做了独立只读比较：

| 核验项 | 结果 |
| --- | --- |
| 保存前基线 | 2026-10-20 14:14:02.655 北京时间 |
| 中央员工更新时间 | 2026-10-20 14:14:56.248 北京时间 |
| 保存后只读观察 | 2026-10-20 14:16:49.920 北京时间 |
| 中央头像 | `image/jpeg`，158346 bytes |
| 头像 SHA-256 | `16aafe5e7a0a164a0a00e368a0a5704feae0f78166a92e61eb3459ad6077f473` |
| 非头像员工配置 | 17 项列清单及逐字段 hash 全部一致，改变字段为 0 |
| Bot 配置与 Profile 绑定 | hash 与保存前一致 |
| Bot 状态 | r2 / e3 / validated 2 / active，`active_action_id=null`，主聊天未变 |

非头像总指纹为 `f7301d04d900a59b1cb8eccc4822911881ca2f170a960f2d543d48329d14e077`；规范为 UTF-8、键排序、无额外空格的 JSON，排除 avatar、created_at、updated_at。Bot config 指纹为 `cd67d285f0ffc6d5173998535305af5a5abc8a41c0617580984d4d1cee68ba4d`，Profile binding 指纹为 `f3cfacf2cbcca99a3268c45a519e2a9cc50c12f02eb82e0b4ba4968638470fc6`。

第一次保存后核验在 SSH banner 阶段失败，未执行生产查询；经协调会话另行授权的一次新尝试成功。没有因 UI 提交或读回缓慢而重复保存，没有把超时当作失败后重建员工，也未写库、直调写 API 或派新动作。

## 观察边界与可选追溯

以上是 2026-10-20 各时点的证据，不是实时健康承诺。接手时用获授权的真实工作区回读现有员工、Bot、主聊天及原动作；不重放业务任务，不借用其他员工身份，不将 configured/injected、ACK 或 UI 终态互相替代。

原 Mac 上可选追溯材料位于 `/Users/zhangjie/.codex/worktrees/bot-historical-recovery/紫薇/.local/` 下的 `xhs-tro-employee-20261020/` 和 `creator-tro-readonly/evidence.json`。它们包含创建、ACK、头像及指纹回执；风格完成是协调会话的主聊天 UI 观察，没有另造服务器回执。`.local` 不在 Git 中，本交接的必要事实已经写入本文与配套 QA，其他电脑无需依赖这些路径或复制凭据。
