# 2026-10-16 公司台式：创建失败记录阻塞停止与更新

## 根因与现场证据

公司台式运行旧 build `a996e94aebec66b15636d526be8013746617950fab1858d4815720c7b93cb5f1`，对应源码 `6ddb51daa6090656a29cec5c09a3ba9d676c7ca5`。用户提供的本机 health 显示 `stopSafe=false`，唯一问题为 `UNMAPPED_NATIVE_EXECUTION`，动作 `action_a4ad606b-74ce-4a9e-afd3-e55722945cf4`；待交付、阻塞回执和网关工作进程均为 0。

该动作是原员工 `employee_6479482e-0842-41ed-98b8-3dd944228a4c` 的 Hermes Profile 创建，服务器已有 failed 终态，错误为“原生入口未绑定可核实的绝对解释器”。旧客户端先标记 nativeRuntime，再在纯文件启动器解析处失败，未记录未启动证明，维护扫描因而一直认为执行退出未知。这处失败发生在 Profile 创建进程和原生探针启动之前；不等于整轮运行从未调用过 CLI 版本探测。

旧更新入口把这个现代 stopSafe 协议下的 409 交给仅支持更旧协议的恢复器；恢复拒绝后，又把原阻塞原因隐藏成 `STOP_CLIENT_FAILED`。单纯重复旧 `ziwei_user update`、重建员工或重装 Hermes 不会消除这条旧记录。

## 修复

1. Hermes 的纯文件启动器解析失败使用进程内一次性标记。dispatcher 只对这一明确边界记录 `launched=false`；任意异常、伪造字段、已经启动的探针或监督登记异常都不能取得该结论。已注册监督器的异常保留真实完整进程树退出证据，缺证据时仍隔离；迟到证据只结算原动作。
2. 官方候选 updater 增加针对已审 a996e 缺陷的恢复路径：核对旧安装 build 和 7 个相关源码摘要、唯一精确失败类型、原 started/completed/delivery、身份、原进程生命周期、已暂停接收、空闲与无网关占用。停止前再次核对文件摘要、原 Windows 进程句柄、创建时间及直接子进程为空。
3. 原 daemon 句柄确认退出后，在本机 `runtime/prelaunch-history` 写入绑定原记录的恢复证明。原执行与回执文件保持原字节，不伪造业务成功或历史进程退出。新版本仅将这条已核实历史排除出本地 stopSafe 阻塞；正式扫描与严格 safe 不放宽。若更新中途回退旧版本，重复更新可复用完整重验的原证明，保持证明原字节。
4. 没有旧证明且当前进程启动晚于历史动作时，不推测该历史归属于当前代码；恢复拒绝并保留原因。只有已核实范围可自动恢复，不是通用强杀接口。
5. 停止与更新输出保留具体、有限的阻塞代码和 HTTP 状态；未知代码映射为固定文本，不输出原始配置、路径或密钥。

## 验证

- 新失败证据专项 13 项；相关 9 文件无监听回归 137/137 通过，使用实际 Hermes 创建入口的解析失败证明 supervisor 和 beforeSpawn 均未调用，HOME 未创建新 Profile，重启同动作不会重复执行。
- 历史恢复 3 文件 71/71 通过，含专项 16 项。使用已发布 a996e 官方包的离线安装核对实际 build/源码，模拟原 held-handle 退出后验证持久证明、原文件摘要不变及后续 stopSafe；记录突变、错误身份/时间/源码、未确认退出等反例拒绝。
- updater/lifecycle/诊断 20 项通过，12 项 Windows 专用跳过。生产前端构建、147 源文件 lint、改动模块语法与离线安装依赖闭包通过。
- 扩展测试中的 `runtime-group` POSIX 第二来源退出和 `preservation-gateway-process` resident Job 两项失败，均用本轮修改前 HEAD 的原 daemon/扫描器复现；未为本次修复改变既有策略。这不是全量测试全部通过的声明。
- 唯一 HTTP 回归使用端口中心登记 `222 / 127.0.0.1:8181` 串行执行，检查无冲突/未登记端口后释放。其余测试禁止监听；Mac 临时路径别名导致的一项拒绝在 canonical TMPDIR 下重跑通过。

独立审查已核对生命周期归属、停止前快照绑定、监督异常与更新回退重试。以上不代表实际 Windows 句柄退出、公司台式升级或真实模型调用已经完成；本机无法远程操作该 Windows 电脑。

## GitHub、发布和回退

源码 `40cefe91672b62abe14b8348022e5116803f33de` 先推送 GitHub 发布分支 `codex/v2-20261014-release` 并用 ls-remote 核对，再于 **2026-10-16 09:02:55（Asia/Shanghai）** 发布官方 Windows 客户端。

- clientBuild：`74405c8827b7a1248c57fecfa45ab14f83890a27e5dd504525089785f9258509`。
- sourceBuild：`ce759de5a283d5dc6e5cc6d57083668e0262bbc3176231360e4935ca0c5ba950`。
- 包 SHA-256：`99f6da3729ba51369e91a1ce5c1550d93421aac7fc4b4f2e1775ab87571815d5`，1,069,883 字节。
- 发布记录：`/opt/ziwei-staging/prelaunch-stop-40cefe91672b/publish-result.json`。
- 备份：`/opt/ziwei-staging/backups/prelaunch-stop-client-20261016T010255Z`。

发布回读公网元数据和完整包哈希通过。主站/API 仍在 `/opt/ziwei/releases/v2-hotfix-cd610444ce79/v2`；主 API、control API、Nginx 进程及配置、数据库文件身份保持。本次无需切换主站、重启服务或数据库迁移。

公司台式应重新运行官方下载的 `update-windows.ps1`，让新候选 updater 处理旧停止故障；不要只调用安装中的旧 updater。完成后核对运行 build，再在原员工中重试创建。若拒绝，保留新结果中的具体代码继续处理，不删除原执行文件绕过。

回退下载发布时，将本次备份的 `release.json` 与 `ziwei-latest.tgz` 原子恢复并回读哈希即可，不触碰业务数据库。已经完成设备更新或写入本机证明，不会因服务端下载文件回退而自动撤销；保留本机记录以便后续核实。
