# R01 最终发布前有限预检

本轮只读核对 GitHub、已知正式部署宿主入口，以及原 PID12132 的当前写入者范围。服务器和客户端没有切换，正式 gate 仍未通过。所有原始引用留在 R `.local/r01-release-readiness-20261014/`；Git 只收录安全 ops source 和本说明。

协调线程确认：用户已授权最终验收后直接完整推送 GitHub 和部署。最终同批代码/六产物/两 manifest 经 Q 独立签收后，即使原客户端实际停止门槛仍有缺口，也可以先将安全完整最终代码、QA 和运维提交推到明确版本分支并读回 SHA。main、Release、官方 metadata 与服务切换仍按既有最终发布方式和实际门禁执行。不能用此准备树的旧产品代码替代 E02 最终源码，不能把 .local、DB、HOME、auth 或原 D 脏文件加入提交。

## GitHub 与已知发布宿主

最终 GitHub API/refs 窗口为北京时间 2026-10-14 07:39:32–07:40:22。使用现有 Git credential manager，凭据仅在内存中用于官方 HTTPS GET，未打印/写入凭据。reader 禁止重定向，防止 Authorization 离开固定 API host。没有 push 或 GitHub 写 API。

| 项目 | fresh 结果 |
|---|---|
| repository | `jinjinli226-netizen/ziwei`，public、default main，当前凭据 admin/push 可用 |
| main | `339b1db1862882c5305ebddceead85d487c8c9d0` |
| 远端 rollback | `8556aecb6a37385d9fc7061f989e97071bfd6cf9` |
| workflows / runs / hooks | 官方 API HTTP200，完整页面均为空 |
| deployments / environments | HTTP200，完整页面均为空 |
| main protection / main .github | HTTP404；不据此绕过任何实际发布规则 |

已知正式宿主在北京时间 07:33:03–07:33:07 只读检查：原 API 181593 和 control 134533 均 active；两 unit 的 ExecStart 没有 git pull/fetch、GitHub、curl/wget 或 deploy/publish 引用，ExecStartPre/Post 为空。两个 current release 均无 .git/.github，相关命名 service/timer 只有两紫薇服务。`/opt/ziwei` 根仍有 .git，是保留的手动 Git 路径；本轮没有调用它。查询没有读取环境、认证、DB、HOME、cron 正文或 journal message，也没有扩大到全宿主研究。本结果足以用于有限安全版本分支准备，不声称不存在所有外部定时服务或应用订阅。

Git push 清单必须逐路径审查，`.gitignore` 和 npm files 不是完整 Git 收录 allowlist。最终组合还须纳入 E02/E03 最终产品依赖 closure、测试及安全 QA 文档；原 R 包闭合列表不是最终 exporter。R wire fixture 要显式配置独立批准的 `R01_PRODUCT_MODULE` 并核对同批模块 SHA，不能把缺少 fixture 配置的 CI 当绿灯。

## 当前原生范围与事件记录

精确核 E03 clean `9491d5e3d572fcb787cb1f7567cdfed393975942` handoff SHA `4ab51895473bca720780c2378c1e74382b7c99eac1cdf87599e3de9fc8ad773a`。使用其实际固定 helper/system PowerShell/prelude；本轮 reader 的有限静态 repo import 闭包共 7 文件，导入前与批准 commit 比较，导入后逐字节复核。没有新增原 SDK/OS 历史 hash 门槛。

第二次实际原生读取 07:39:33–07:39:36：原 12132 的 held birth、boot、entry/command digest 前后稳定。754 个 PID/parent/birth 均可读；其中493个不早于原 birth，只是保守候选全集，当前 parent 链仅12132。不能把这些无关进程当 writer、后代或 stop allowlist。

当前权限下 Security 日志读取返回 `LogInfoUnavailable`，Sysmon 返回 `NoMatchingLogsFound`。本轮未取得可用历史进程创建/退出记录；这不表示 Security 历史不存在。未启用审计、写事件记录、赋 Job、停止候选进程或重启主机。现有筛选集合和原 PID absent 均不能单独替代 writer 闭合证明。

## 精确 Hermes writer 分支与当前状态

本轮以 Win32 held file handle 核过有限公开源码的精确 final path，保留相关片段。没有执行四个 launcher、恢复或安装，也没有读取 settings/auth。原实际 HERMES_HOME 为 `C:\Users\25941\AppData\Local\hermes`，其 `hermes-agent` 位于本次 protected baseHome；产品要求 backup homes 包含该 baseHome。

`main.py:51` 在 fast version `:329` 前执行恢复检查。`_early_recovery.py:113` 将 projectRoot 定为本模块的 parent.parent；`:437–440` 可直接创建/写入该 root 的 `.update-incomplete.lock`；`:337/340` 明确设置 VIRTUAL_ENV=root/venv 并运行 uv pip install --force-reinstall。该实际分支具有保护 HOME 写能力，不可一概称为范围外非写入者。未观察它实际触发或正在写入；也没有证据显示这段恢复代码写主 DB、Ziwei objects 或待确认回执。

恢复父进程确实同步等待：`_early_recovery.py:314` 和 `_install_repair.py:419` 均用 subprocess.run，没有 timeout。core branch `run_core_install` 对当前项目执行 editable install，结束后才释放 lock/删除 marker。同步等待是正常执行关系，不能变成 launcher 超时后的递归终止证据。

原实际 SDK 的 `runtime-cli-discovery.mjs:87–89` 使用 spawnSync、3秒 version timeout、shell:false；`runtime-adapters.mjs:461–469` 只对 ps1/cmd/bat 包装 PowerShell。已恢复的实际 Hermes 选择是 distlib `hermes.exe`，因此该路径的直接 probe 目标是这个 launcher，非 cmd.exe；本轮没有取得其某次超时的实际 PID/exit receipt，不能声称 Python/uv 本体被同步杀掉。

root 另行授权后，仅核三个 source 指定的恢复 marker 元数据。原生 project directory 和路径吻合；`.update-incomplete.lock`、`.update-incomplete`、`.lazy-refresh-incomplete` 当前均 native file-not-found。没有删除/改写 marker。

最后一次755进程 inventory 保守保留所有 Python/Hermes/pip/uv 镜像及已识别安装参数，共31项。31项的 exe/command 查询可见；underHermesHome、exactVenvInterpreter、commandMentionsHermesHome、installerArguments 和 uvProcess 计数均0，未处置其他项目的 Python。完整 command、任意环境、settings/auth 均未保存。这是当前无匹配修复 writer 的有限负证据，不是所有原后代已退出的声明；没有覆盖 uv/pip 可派生的命令不带 root、改用其他镜像的构建/安装后代，也没有取得这些后代的独立 HOME effect/退出证据。

Gemini 的已核 shim 只有 Node 选择、参数转发和等待；E03 bundle review 排除了 version 的 model/action 初始化路径。Claude/Codex 的实际 PE/version 身份不能单独证明或否定 HOME effect。本轮没有把未知的这些后代或所有493候选自动定为 writer。

可进行的有限处置边界是：最终 QA 后，按原 PID+held birth 精确受控停止 daemon、禁止新的旧 probe，再核同 source 所确定的修复父进程/installer/marker；如发现精确相关 writer，仅处置已归属的进程并核 PID+birth absent。今天原 daemon 仍运行，所以“当前0”不是停止后的完整边界。产品当前 SDK 审核仍无条件保留 `SOURCE_WINDOWS_DISCOVERY_DESCENDANTS_UNRECOVERABLE`，尚未认证消费这组当前 writer 证据；R 未改变该分支或 pending/uncertain 拒绝规则。该实际缺口不自动要求整机重启，也不阻止 Q 签收后安全版本分支备份。

## 精确私有引用与验证

| 私有文件 | SHA256 |
|---|---|
| github-readonly-02.json | `df5dfe161416a9d6b0b103903cdb6d24ed24c774c6a7924d19380b1d5a8eab14` |
| server-deployment-01.json | `5966349584965436d626ea3d26d76ebfd66b7241bccd22ad176d5314642257ed` |
| windows-closure-02.json | `e4524ce819c2101cca0f01483da243afc9767b823379be1ad01f5f4fb7cb8fe4` |
| launcher-writer-source-01.json | `3017d2d565fe68d2513b3a2fa4cf34a8ab6620eb798ed225b8f42a278357c5d0` |
| launcher-writer-source-02.json | `948df5560262007bef603883da07e6d467bfa4d287f1deef6a781cb0689c95d9` |
| current-repair-markers-01.json | `6090205c86d171fbc16fb58ad3ca07a120649890351c3ba0807f0dcbb5bfbbb2` |
| current-repair-inventory-02.json | `369d9988df4228116c666a490426d8716b65d6867046a3db70bbde7003ce4f79` |

全部正式数据写入、service stop/start/restart、key provisioning、模型/设备动作和 push 均为0。三份 Python 源码与一份 Node reader 通过语法检查；GitHub 禁重定向分支用无网络 fixture 确認。代码复核发现的 redirect 和实际 reader import bytes 绑定缺口已修复；修正后 GitHub/Windows 实际读取再次通过。临时 repair reader 首次因使用 PowerShell 保留变量 HOME 而拒绝，修正命名后成功，没有业务副作用。

有限检查点 clean commit 后给 root 精确 handoff 并 idle，留出 Q 槽位。E02 最终同批六包/两 manifest 与真实 SDK 四阶段、Q 独立签收、R 后续精确部署/停止门槛均不由本预检替代。
