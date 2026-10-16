# 2026-10-16 公司台式 Profile 创建失败诊断

## 已确认的现场状态

09:13 的服务器只读查询确认，公司台式已运行上一修复 build `74405c8827b7a1248c57fecfa45ab14f83890a27e5dd504525089785f9258509`，PID 1528，在线。旧升级阻塞不能再解释本次问题。

用户新建的 `TiktokTrendSreach`（员工 `employee_510b8b52-68b5-4419-bc30-fa279b22fb1c`，Profile `bot-f2bcf1c02b51e43aed39db64`）在 09:08、09:13 两次创建失败，动作分别为 `action_8a30a7ff-d307-4545-bbd6-1a515a15127c`、`action_1699338d-1b47-4f1f-bf26-02644516f2a6`。两次均有 Windows Job 完整退出证据：root exit 0、treeConfirmed=true、activeProcesses=0；业务错误为 `BOT_PROFILE_CREATE_FAILED`。

该码来自 Python bridge.provision 的捕获分支，说明已通过 launcher/probe、源码及 profiles 模块绑定。旧代码将导入、目录、原生初始化、文件写入、发布和清理等异常压成同一码，未保存异常类、阶段或系统错误编号，JS 又忽略 stderr。因此旧回执不能还原真实故障；不能断言权限、文件占用、代理、登录或模型有问题。

核对本地已取得的官方 v0.22.0 源码，原生 helper 签名、默认 Profile 路径和布局相容。官方 bootstrap 也会将 stdin 设置成 UTF-8；新增显式 UTF-8 协议处理不构成此次中文编码故障的证明。

## 本次改动与验证

- Python 保存固定阶段、异常类别、有限 errno/winerror 和允许的源码位置；不包含异常正文、完整路径、请求或环境。以原异常对象一次性关联诊断，不接受异常自带伪造诊断。
- 清理失败不覆盖原始失败，另附 cleanupFailed；显式业务错误码保留。受控 JSON 请求按 UTF-8 原字节读取。
- JS 再次校验字段，将具体阶段和 Windows 错误号带入结果及可读错误；权限、占用、磁盘空间等仅在对应实际编号/异常出现时给配置建议。未知进程终态仍为 EXECUTION_UNCERTAIN，不因有诊断而视为已退出。
- 最终 4 文件 Node 回归 16/16，其中 Python harness 内部 12/12；真实 Python failed receipt 进入 JS finalize 后诊断不丢失。内存生产仓库路径验证结果保存、Bot 页面所用 error 字段以及同一个 Profile 的重试。相关扩展 29 通过、1 项原 Python 环境不可用跳过。148 源文件 lint、Python AST、Node 语法、构建及离线包依赖闭包通过。
- 测试无监听、无真实模型/手机/生产创建操作。Python 故障注入和 cp936 wrapper 测试不能当作公司 Windows 的根因复现；独立审查通过诊断接线和清理主因保留。

## 发布与下一步

源码 `2fc97a9b4a3d860cc8b2bd642e981b820ea10c74` 先推 GitHub 发布分支并核对，再于 **2026-10-16 09:24:42（Asia/Shanghai）** 发布官方客户端诊断补丁。

- clientBuild：`9230ce66bbe603db79fc0d5f9936a977d61e1d68ea768da30111fa23579888dc`。
- sourceBuild：`25319fc7f807918e64cfdb1397e8790d0f95abb18d112bc6ef706dd055412f5b`。
- 包 SHA-256：`8258f8bfb0a7c880adf994f516f34c46228133cfe26c6fe3b82a39943db344a2`，1,072,713 字节。
- 发布记录：`/opt/ziwei-staging/profile-diagnostic-2fc97a9b4a3d/publish-result.json`。
- 上一客户端下载文件备份：`/opt/ziwei-staging/backups/profile-diagnostic-client-20261016T012442Z`。

公网元数据和完整包哈希已验证。主站/API 仍是 `cd610444`，服务 PID、Nginx 和数据库文件身份保持。回退下载发布可原子恢复上述备份的 release.json 与 ziwei-latest.tgz，不更换业务数据库。

**公司机创建问题尚未宣告解决。** 用户需重新运行官方 update-windows.ps1，待新 build 心跳后在原 Bot 点击重试创建；随后从新失败回执的 stage/exception/errno/winerror 定位并修复实际原因。不要再把只存在 `BOT_PROFILE_CREATE_FAILED` 的旧回执当作充分诊断，也不要让用户重建员工、重登订阅或删 Profile 试错。
