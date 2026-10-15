# 历史回执阻塞客户端停止与升级

## 现场原因

2026-10-15，李金晋电脑运行 build `855e4fa…`、PID 8832。用户本机 health 明确报告 active/polling/quarantined 均为 0、pending 为 0、blocked 为 2，唯一维护错误为两条 `DELIVERY_NOT_DRAINED`。旧 daemon 将“历史回执已交付”当作“允许停止进程”的必要条件，造成 stop 409，update 又依赖 stop，形成升级阻塞。

已通过现有 action.cancel 恢复通道核实原结果，没有重跑原任务：

- `action_7eb3fe75-1857-4a27-9509-906ad66972b7`：原配置检查已成功，恢复控制动作 `action_170f0423-efdf-4c74-a202-0192a4c64d77` 返回 `targetReceipt.confirmed`。
- `action_ba086b98-ee74-4463-96ad-c8b798ef0b2f`：服务器仍 expired，原员工与 Bot 身份已硬删除。恢复控制动作 `action_c537fc9f-a8c9-4511-b7f3-4425248c5333` 找到本地原结果，但 targetReceipt 仍 pending。真实访问日志原 ACK 200、result 400；服务器日志未保存 400 正文，不能伪称已直接取得具体错误消息。再次派恢复动作不能重建已删除的身份。

## 修复

本机停止新增 `stopSafe`，与原严格 `safe` 分开。仅原 action/result 字节校验、工作区/设备绑定、终态与完整进程树退出证据均有效的 blocked/result_pending 回执，允许原样保留后停止。既不标记上传成功，也不删除文件或重跑模型。正式保留数据/迁移证据扫描仍要求原严格条件。

未知执行、损坏记录、未退出进程及未核实 Gateway 继续阻止安全停止。旧拒绝的空 409 改为有限原因码/计数；CLI 显示可读原因，隐藏原始私密路径、认证与任意响应正文。正常关闭等待任务调度、心跳与登记 Gateway 结束。

旧客户端不能靠自身旧 updater 获得停止修复。官方下载入口先取得并校验新包，再由新 updater 处理原安装：仅首次更新停旧客户端的阶段，在旧 409、已暂停、当前执行/轮询/隔离均为 0、旧维护错误只有历史回执时，使用完整已核验候选包重新检查 `stopSafe`。配置、安装、实际监听进程、创建时间、nonce 和磁盘回执均复核后，以已持有的同一 Windows 进程句柄退出原 daemon。所有原数据保留；普通 stop、卸载、回退停候选流程没有此恢复入口。

旧版现场应在 Windows PowerShell 运行官方入口，而不是重复旧 `ziwei_user update`：

```powershell
irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex
```

## 验证与发布边界

使用无监听测试验证真实持久投递层、维护扫描、daemon 停止准入及关闭等待，并验证旧版升级分支保持暂停、失败恢复接收、非 409 不进入恢复。Windows 原生句柄退出与真实升级须由运行设备读回；Mac 的模拟边界测试不等于 Windows 实机通过。

最终相关回归 124 项通过、0 失败，12 项 Windows 专用测试跳过；HTTP 下载 fixture 因本轮不分配监听服务而排除，下载代码未改。Mac 临时目录使用规范绝对路径消除系统路径别名，未做 Mac 产品适配。lint 144 个源码文件、改动脚本语法与 diff 检查通过。独立审查确认候选 inspector 的 11 个模块依赖均已打包；历史包 build 的计算结果保持兼容。大批量回执证据通过 stdin 输入 PowerShell，600 个 Unicode 路径测试不增加命令行长度。

本次按先推 GitHub、再发布官方 Windows 客户端执行。沿用主站/API `ead2ac9`，不切换网页/API、不变更数据库结构。客户端同时包含前次 Bot 登录续期修复；设备更新之后仍需真实订阅调用验收。

## 18:49 发布回读

源码 `6ddb51daa6090656a29cec5c09a3ba9d676c7ca5` 已推送并与远端发布分支一致。官方客户端于 `2026-10-15T10:49:07.723241Z` 发布，build `a996e94aebec66b15636d526be8013746617950fab1858d4815720c7b93cb5f1`，包 SHA-256 `86525d20f9239af0a30e867ac3bd72dbc7fb81a1ad0f7e95c67cd048a37f6bcf`，1,056,759 bytes。离线依赖闭包验证通过；官方包和 release.json 公网回读一致。

备份 `/opt/ziwei-staging/backups/retained-stop-client-20261015T104907Z`。当前主站仍 `/opt/ziwei/releases/v2-hotfix-ead2ac9281c4/v2`，主 API、控制 API、Nginx 进程及 Nginx 配置、数据库 inode 均保持。现有官方 `update-windows.ps1` 与仓库字节一致，SHA-256 `579fdeac68b92e24a62069c173af193f5b45bbb0ef220206004d7888ffa99b8a`，其既有流程会先拉新包并使用新 updater，无须替换脚本文本。现场旧 Windows 客户端尚未确认升级，不报告真实模型已恢复。
