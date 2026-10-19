# Windows Hermes 后台工具 TTY 修复

范围：修复知暖后台任务直接调用 `node` 返回 `stdin is not a tty`。普通任务、Bot 的独立 Profile、HOME 和默认目录沿用现有绑定。

## 已确认的原因

先前动作 `action_7fcec325-ea8f-44e9-b194-cf070c200548` 的原生 Session 工具记录确认：`node -e ...` 的 terminal exit1，内容为 TTY 错误。完整原生 Node 路径在 `action_8338eae8-a237-48ac-afcc-d8b47a649ba2` 返回正确 D 目录、exit0。不能用 CLI code0或平台succeeded代替工具业务成功。

本轮真实普通任务 `action_41d174c7-e1d4-47ea-8930-f7e4d77fcf08`（任务 `task_af9e56d6-4a9e-40b6-b9f2-61092dcb3da4`）不改目录、只读 Bash 内置命令，直接返回：`TERM=xterm-256color`，`node is aliased to winpty node.exe`，以及原生 Node 路径。后台管道没有交互 TTY，winpty 别名不适用于该调用。

Creator环境下的本机原生探针使用完整代码SHA校验，dumb、unset、xterm均能由 `_run_bash` 直接调用Node。这条探针绕过了真实终端的会话别名恢复层，不能用于否定实际员工的别名证据，也不把它伪称成修复前真实任务通过。

## 修改与验证

仅在 Windows Hermes 明确带 `--query-file`、`-q` 或 `--query` 的非交互查询子进程内规范化 `TERM=dumb`，清除大小写重复的TERM字段。覆盖纯文本JSON、单图text、原生多图与Bot查询；不把format=text误认为交互。调用者环境、代理、PATH、独立Profile与HOME保持，真正无query的交互CLI不应用此策略。

22项定向测试与独立复跑均通过，含真实Bash别名失败/修复回归、Windows字段大小写、调用者环境不可变、代理/PATH/Profile保持及其它运行时/平台边界。没有新增依赖。没有修改Hermes安装或用户Shell文件，也没有把工具错误误判成模型启动错误。本轮未声称原生Windows显式PTY工具已真机验收。

发布顺序为先推GitHub，再更新官方Windows包。仅请求李金晋电脑远程升级；必须以实际目标build心跳及修复后知暖普通任务确认安装和效果，候选测试不代表已安装。后续现场结果另行追加。
