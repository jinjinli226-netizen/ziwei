# 李金晋电脑的一次性远程升级桥接

这是旧版 `ziwei_user` 首次装入专用远程升级能力的运维桥接。它只允许工作区 `bigtron` 的李金晋电脑，安装目录固定为 `D:\work\nodejs\node_global\node_modules\ziwei`，配置与用户数据仍在原来的 `C:\Users\25941\AppData\Local\Ziwei\ziwei_user`。不得用于其他电脑、迁移目录或批量发布。

`register-li-bootstrap.ps1` 默认 `Validate`，不注册任务。显式 `Register` 才创建当前用户、有限权限、一次触发、零自动重试的计划任务，使维护程序在员工执行 Job 之外运行。脚本不调用强停，不改用户或系统环境变量；npm prefix 只在维护进程及其子进程内规范为现有 D 盘 prefix。

桥接严格核对旧实例的设备、SID、安装路径、PID、build、boot nonce 和配置摘要。它等待全机活动执行、轮询、隔离执行归零及 Gateway 空闲。历史 `stopSafe` 与问题代码保留到工作目录的观察 JSON，由已安装的受信官方更新器执行 `recover_history → stop` 并决定能否停止。桥接不伪造退出证据，不清除历史记录，不绕过官方停止校验。暂停回执丢失或更新失败时，只允许恢复同一个旧实例的接单状态。

仓库仅保存带占位符的 plan 模板和合成测试数据。实际 plan、真实 boot nonce、配置摘要、浏览器会话、账号凭据均不入 Git。填写 plan 前，使用一次只读诊断取得目标机器的真实信息；提交前再由脚本核对。不要把诊断执行自身造成的 `active=1` 当成故障。

发布桥接文件时，从已提交且已推送的运维提交读取精确 Git blob，使用不变的官方地址，例如：

```text
https://qzelynth.top/downloads/cli/register-li-bootstrap-be6ebd4851c3.ps1
https://qzelynth.top/downloads/cli/bootstrap-li-worker-21939efa2d02.mjs
```

目标机器下载时禁止重定向，分别核对完整 SHA-256，再写入本人的新建维护来源目录。实际 plan 通过该已授权设备的管理通道传递，不发布到公共下载地址。先对 PowerShell 源码执行原生 `Parser.ParseInput`，对 JS 执行 `node --check`；任何语法错误或摘要变化均停止。随后运行默认 `Validate`，只有通过后才提交一次 `-Mode Register`。重复请求必须复用同一维护 UUID，不能覆盖已有任务或换 UUID 盲目重试。

桥接包 A 与正式包 B 的业务源码和依赖完全相同，A 仅增加 `_ziweiRemoteUpgradeStage: "bootstrap-validation"` 元数据以形成可区分的真实 build。A 的固定包地址、摘要及 build 来自其独立离线冷安装验收清单，不能使用后续可变的 `latest` 代替。

只有观察到 A 的真实设备心跳、专用升级 feature 和实际 build 后，才可在同一台电脑通过正式的设备升级 API 请求 B，并验收 B 的新实例心跳。桥接任务成功仅证明首次安装完成，不能替代专用远程升级协议的实际验收。未经用户另行授权，不对其他电脑创建升级请求。

纯测试不监听端口、不调用 Windows 任务、不访问设备：

```sh
node --test scripts/operations/remote-client-bootstrap/bootstrap-preparation.test.mjs
```
