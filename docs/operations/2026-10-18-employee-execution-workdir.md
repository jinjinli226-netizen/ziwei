# 员工任务继承工作目录

用户反馈知微给擎天、知暖创建了 D 盘员工，但自检都运行在机器默认 C 盘。2026-10-18 23:18（北京时间）只读生产查询确认：擎天默认目录及新聊天目录均为 `D:\AIUSE`；知暖均为 `D:\AIUSE\life-assistant`，目标均为李金晋电脑。两员工的创建配置没有丢失。

真实自检动作 `action_109d9d20-dd48-4001-8e3b-c8140641e77b` 和 `action_ee7a600b-369e-4768-adcc-9f24f5b1e5c9` 均为 task.execute，没有 conversationId，cwd/workdir/workingDirectory 均未下发。原 executionPayload 只取调用者的 cwd，漏读员工默认目录，因此客户端沿用机器默认 `C:\Users\25941`。正常主聊天已持久保存 D 盘，与这两次任务执行分开。

修复统一采用：本次显式目录 → 同工作区、员工和电脑的会话目录 → 员工绑定该电脑的默认目录 → 现有机器默认行为。错绑会话/设备与非法路径明确拒绝，不借用其他员工目录。任务在写入前检查；Routine、协作、Gateway、直接 native 和群组使用相同解析。Windows native 执行也使用已校验目录，不再覆盖为宿主默认。网页展示继承目录时不将其误存为用户显式覆盖，刷新保留用户临时编辑且不带到另一电脑。

独立 Profile/HOME 保存配置和记忆，与实际文件工作目录分别管理；本次不重建员工，不迁移 Profile/HOME，不移动既有业务文件。

验证：后端新9项先红后绿及相关33/33，native新5/5，UI新16/16与相关54项通过；完整前端379项中375通过，4项与HEAD基线同样失败；repository原14项中3项因本机缺少模型/profile同样在HEAD失败。主控联合与发布、真机任务回执另行追加；此处不将候选测试等同于已上线。


2026-10-18 发布进展：产品提交 `241f0cc59bbd2cb7800ac3072470b1a85a77dfd1` 已先推两条 GitHub 分支再发布主站，API 实际进程 466819；数据库结构不变，原库保留，旧资源保留。主站目录解析已生效。正式客户端 J 构建为 `b036e91d6fd6800ca71364dbff6bb5a34e19583415c3eca486ce53a7ba7ca0d3`，包 SHA256 `cf5b96140985f56dff700969a92c938470f47fb83412bd41a17b3fde1deec545`，Linux 空缓存离线安装、API factory 和独立 helper 导入通过。

真实任务 `action_789473ad-1578-4f4b-a8d4-4a1ff586c945`（擎天）下发 cwd 为 `D:\AIUSE`，原生进程退出确认，模型返回同目录 JSON；适配器没有持久化 Codex command_execution.aggregated_output，故这不是独立工具 stdout 回执。知暖 `action_f85ed19e-946f-446e-a97c-8e29d5fca072` 的 cwd 已为 `D:\AIUSE\life-assistant`，但仅输出 `stdin is not a tty`，退出码为 0，不能计为真实模型/终端验收通过。

针对知暖的后续客户端补丁：普通无图 Hermes 改用已有 Bot/多图使用的显式 `chat --query-file - --format stream-json`，完整提示词走 stdin，单图及 Bot 路线不变。退出码 0 但无结构化答复且只有独立 TTY 诊断时返回 `HERMES_NONINTERACTIVE_FAILED`，保留原退出证据，不自动重跑。新测试通过隔离 Python/bootstrap 检查真实 stdin、profile、model、管理 overlay 与 cwd；TTY 在 stdout/stderr 均不能假成功，合法答复引用该文本不误判。新5项、多图8项、图片19项通过；主控联合 native 测试18/18。此测试模拟原生协议，不代替 Windows 真实 provider 验收。

J 远程升级请求 `client-update_c760583a-cc18-4d0e-8508-b719e4206737` 在等待空闲期间取消，准备累计包含上述 Hermes 修复的新包。李金晋电脑上的用户闲鱼业务 `action_49bd64e6-0105-4fd6-aff5-53f50b520d52` 仍运行，不强停该业务、不把排队升级显示为成功。后续包发布、升级与真实验收追加记录。


后续 K `0f7e8940feaf70d9cd0ecd912eeff752a6ca8220` 已先推 GitHub 两分支再发布正式客户端，完成时间 `2026-10-18T15:56:05Z`。新 build `5ed84509b57a6ad3e3b40cfc223703f50c799af8c34edddef161d3fd3e4ddb00`，包 SHA256 `cb79d6f7d4debcb1d1a1be3869b4371b5419f5e1d1fb9e59f2f45b3d67e6985f` / 1,153,612B。主站/API仍J/PID466819，K发布不重启服务、不改库，全部既有下载和通用PS入口保留。主控离线冷装、API工厂、实际helper导入及独审19/19通过。

另一次显式原生命令验收 `action_1b766694-d774-4647-a9bb-b29c3d16267a` 已由李金晋电脑的 Creator 执行一次：直接启动现有 `zhi-nuan-life` 的新 chat/query-file 路线，真实模型 `gpt-6.1-sol`；Hermes session `20261018_235424_847d2a` 返回1次 terminal tool_use/tool_result（命令没有自定cwd、exit_code0），cwd为 `D:\AIUSE\life-assistant`，原生总耗时20,053ms。证据来源是原Creator动作转述/透传的原生stdout，未提供独立文件读取链；这是显式启动路线的provider smoke，不等同于K安装后普通task.execute全链验收。

已为精确李金晋电脑提交累计K正式远程升级 `client-update_b9f94525-1577-48d3-a957-3f04ea6baeeb`，使用固定官方包与 `waitForIdle:true`；源H build尚在运行用户的闲鱼任务。升级请求提交不算安装完成，必须看到新build认证心跳才能记成功。目前不触碰运行中的用户业务，其他电脑未更新。本次服务器目录继承已上线、显式Hermes路线实测通过；K安装与安装后普通任务仍待空闲后的回执，不宣称已经全链验收。
