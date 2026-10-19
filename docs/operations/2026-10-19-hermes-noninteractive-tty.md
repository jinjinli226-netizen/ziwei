# Windows Hermes 后台工具 TTY 修复

范围：修复知暖后台任务直接调用 `node` 返回 `stdin is not a tty`。普通任务、Bot 的独立 Profile、HOME 和默认目录沿用现有绑定。

## 已确认的原因

先前动作 `action_7fcec325-ea8f-44e9-b194-cf070c200548` 的原生 Session 工具记录确认：`node -e ...` 的 terminal exit1，内容为 TTY 错误。完整原生 Node 路径在 `action_8338eae8-a237-48ac-afcc-d8b47a649ba2` 返回正确 D 目录、exit0。不能用 CLI code0或平台succeeded代替工具业务成功。

本轮真实普通任务 `action_41d174c7-e1d4-47ea-8930-f7e4d77fcf08`（任务 `task_af9e56d6-4a9e-40b6-b9f2-61092dcb3da4`）不改目录、只读 Bash 内置命令，直接返回：`TERM=xterm-256color`，`node is aliased to winpty node.exe`，以及原生 Node 路径。后台管道没有交互 TTY，winpty 别名不适用于该调用。

Creator环境下的本机原生探针使用完整代码SHA校验，dumb、unset、xterm均能由 `_run_bash` 直接调用Node。这条探针绕过了真实终端的会话别名恢复层，不能用于否定实际员工的别名证据，也不把它伪称成修复前真实任务通过。

## 修改与验证

仅在 Windows Hermes 明确带 `--query-file`、`-q` 或 `--query` 的非交互查询子进程内规范化 `TERM=dumb`，清除大小写重复的TERM字段。覆盖纯文本JSON、单图text、原生多图与Bot查询；不把format=text误认为交互。调用者环境、代理、PATH、独立Profile与HOME保持，真正无query的交互CLI不应用此策略。

22项定向测试与独立复跑均通过，含真实Bash别名失败/修复回归、Windows字段大小写、调用者环境不可变、代理/PATH/Profile保持及其它运行时/平台边界。没有新增依赖。没有修改Hermes安装或用户Shell文件，也没有把工具错误误判成模型启动错误。本轮未声称原生Windows显式PTY工具已真机验收。

## 发布与真机验收完成

产品 Q `d249c5786df867346d9b0f97451daf75e1d4bf76` 已先推 GitHub 两条发布分支，再发布官方 Windows 包。build `11cf2eb7f739698a34f0590020629c1b99dd6fed4abfdecc69154850e7ed4fa6`，包 SHA256 `c960b9962ee4f88368d3f12498653e95f59e8a57fc3156a601a0d5afe3b9310a`，1156114 字节。只覆盖已审查的客户端累积文件；API/UI仍为 J `241f0cc59bbd2cb7800ac3072470b1a85a77dfd1`，没有重启主站服务。

仅对李金晋电脑提交统一远程升级 `client-update_a514c779-278b-4cc9-a5a1-51a55a0b9962`，2026-10-19 10:19:07 北京时间目标认证心跳确认 succeeded、heartbeatVerified:true、completionSource:heartbeat。后续本机健康只读回执确认同一 Q build、PID2808；其余设备未请求升级。无需用户终端或重复更新。

安装后知暖普通任务 `task_6417162a-438d-4711-b902-452e130091b7` / `action_b468da01-3fe7-4a97-8668-01427d02a93f` 使用真实 `gpt-6.1-sol` provider。提交未传 cwd/workdir/conversationId，沿用原 `zhi-nuan-life` Profile，实际 payload 为 `D:\AIUSE\life-assistant`。一次 terminal 调用包含 `printf`、`type -a node` 和裸 `node -e 'console.log(JSON.stringify({cwd:process.cwd()}))'`，没有完整 Node 路径、winpty、PTY、unalias、export TERM、cd 或工具 cwd 覆写。返回 TERM=dumb、node 原生路径、D 盘目录，工具 exit_code0；根PID16152/root0/tree0/active0，cancelled:false，无后台残留。

独立只读动作 `action_8c442fac-4ccd-49c2-985b-be033468dde4` 使用 Node 内置 SQLite 只读打开该 Profile 的 state.db，仅提取精确 Session `20261019_102500_bd2308` 的 assistant tool_calls 与 tool 结果，确认实际只有一次 terminal、上述裸 node 命令及 exit_code0。原生持久记录中的反斜杠有二次转义，QA保留原文，并另存规范化目录；没有把模型口述或仅平台 succeeded 当作工具原始回执。

此前安装后诊断 `action_0ddef406-0911-4960-988d-539c2e395e1b` 已确认别名消失、Node能启动，但本轮验收提示误把 `process.execPath` 属性写成函数，工具 exit1。它是验收脚本笔误；修正提示后重验通过，没有为此改产品。另一次长编码只读探针因 SHA 不匹配安全拒绝，未执行变形代码；最终使用短探针取得原生记录。

本次验收只覆盖李金晋电脑上的真实普通知暖任务。单图路径有定向回归覆盖，没有宣称单图真机或原生 Windows 显式 PTY 完整验收。没有重跑闲鱼手机业务，也没有新增升级后自动续干功能。
