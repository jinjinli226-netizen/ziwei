# 手机文字输入、自动回查与后台生命周期修复

2026-10-16（Asia/Shanghai）。正常故障处理由程序自动观察原回执和当前页面；不把结果未确认默认转交用户，也不自动重放整轮手机业务。

## 已发布与待完成

| 层 | 源码 / 产物 | 状态 |
| --- | --- | --- |
| 主站 / API | `891685f70e9e4bfc2c56821ee2cc9a28a356f548`，分支 `codex/android-stability-main` | 11:09:08 发布，`/opt/ziwei/releases/v2-hotfix-891685f70e9e/v2` |
| 官方 Windows 客户端包 | 同一提交；build `6b8449d952039abf08bde26c3b3a840e297a250cf684378cd4c4c1371699a8b1`；包 SHA-256 `4d993a13c29cdb66b22d71ccacc77d6a4424fc63766d93a182bf69b19ba52a9f` | 已发布且公网逐字节回读；不等于电脑实际安装完成 |
| 中控 | 私有仓库 `jinjinli226-netizen/ziwei-system`，分支 `codex/android-input-lifecycle`；`8be4604f2938271bf54798db9e74ac3dfa0c3b37` | 11:15:29 发布，`/opt/ziwei-control/releases/phone-stability-8be4604f2938` |
| Android Agent / Updater | 同一中控源码；计划 `0.4.5 / versionCode 16` | 双角色已编译、压缩和测试；原签名文件待用户提供，尚未发布、安装或实机验收 |

现有官方 APK 仍为 `0.4.4 / code15`。签名证书 SHA-256 必须保持 `6292cfac129ee17f36d0c08ebc430fd4b0e502c7ccce99927ea70c3f149e80f8`；包名仍为 `com.ziwei.device.agent` / `com.ziwei.device.updater`。不使用新的临时签名冒充覆盖升级。原 `debug.keystore` 只放私有忽略目录，不能入 Git。

## 证据与实际修复

闲鱼1设备 `android-a2d39137-4c04-463c-b03b-6165a9f12f35` 三条中文输入命令均有 executing ACK 和 uncertain 回执，但只留下 `执行结果待核实 ExecutionException`，没有原 cause。不能从历史记录反推每条输入失败的具体原因，也未独立目视旧截图。旧源码只查 active root 的 input focus，且未验证写入结果。

- 输入目标改为前台非键盘窗口中的安全可编辑节点，优先唯一焦点，无法排歧时不写入。查找有时间、节点和深度上限。中文直接通过 `ACTION_SET_TEXT`，同一节点自动读回验证；系统返回 false 也可能是回调超时，读回成功才宣告成功，不盲目重发。
- 取消门禁覆盖主线程排队动作，超时后尚未开始的动作不会稍后落地。执行前明确拒绝报告 `failed / not_started`；可能产生副作用但尚无验证的情况保留 `uncertain`。executing ACK 不代表动作已发生。解包 `ExecutionException` / `CompletionException`，保留可读错误和 `errorCode`。
- 后端对已受理命令按原 commandId 自动只读回查，最多两次；手机 MCP 对失败的只读请求最多重读一次，不重复动作提交。AI 获得继续观察原回执 / 当前页面的指引。截图已完成但图片下载失败时保留真实动作终态，单独说明图片交付问题。
- 聊天保留员工完整总结及底层错误。混合动作不把先前成功点击描述成整轮未执行；同一原命令的最终回执可解除早期未确认状态，别的命令成功不能抵消。automation 不自动或同 run 手动重放整个已尝试手机动作的流程；电脑进程完整退出时不会因手机结果未知而误隔离电脑。
- Android 新增系统退出历史、机型 / 系统、前台通知、省电 / 后台限制和内存诊断。读取失败的字段保持未上报。伙伴恢复识别用户停止、设置有界持久退避，旧回调不复活已停服务；前台状态恢复失败会退出并释放唤醒锁。
- 控制 POST 改为有界短超时；APK 下载和安装串行放到独立 worker，不阻塞心跳。安装提交前再次检查停止和授权状态。Receiver 的磁盘与安装查询移出主线程。日志面板改为后台读取和缓存，最多 200 行 / 32 KiB UTF-8，暂停或销毁页面后拒绝晚到更新，清空显示保留之后新增事件。
- 正式终端页每个角色增加折叠诊断，缺字段显示未上报，离线记录带时间；历史退出原因不自动等同本次离线原因。

目前尚未取得手机的现场退出日志；不能断言已定位其“经常被杀”的具体根因。新 APK 安装后自动采集系统证据。用户明确停止继续被尊重，不用双端互拉风暴覆盖用户意图。

## 验证范围

- 主站相关回执、自动回查、A2A、daemon 与 reconciliation 联合回归 66/66；正式诊断 UI helper 6/6。lint 150 个源文件、构建和离线客户端依赖闭包通过。
- 主站更广的旧测试存在 4 项已在未改发布基线上复现的 Mac 环境失败：本地 Sonnet 模型、两项 Hermes profile、Windows 固定路径断言；不把它们算作通过。
- 精确 Android 提交 `8be4604` 在隔离 Linux 工具目录运行 Agent / Updater 各 38 项 JUnit，共 76/76；两个 debug 角色 R8、两个 unsigned release 的编译 / Dex / Lint / 组装通过。
- 中控 Android 设备、轻量回执、终端控制及 MCP 集成 50/50；中控 Vue 类型检查和构建通过。
- Mac 未新增监听服务；需要监听的中控集成测试在服务器隔离 staging 数据目录运行，未使用生产库。
- 尚未执行新 APK 签名、双端实际升级、闲鱼中文输入实机验证、断网 / 熄屏 / 重启和长期存活验收。unsigned 构建及单元测试不能代替 Android 实机证据。未发布闲鱼商品、发送消息或修改历史回执冒充成功。

## 发布、数据保护与接续

先推 GitHub 并核对远端，再按相同源码归档发布。停服务前后均核对无活动工作；主站和中控分别只重启自己的服务。SQLite 备份使用 backup API，核验 integrity / FK，保留原数据库 inode；中控 schema 与全部原命令、升级和会话行摘要保持。Nginx 未更改。

- 主站 / 旧客户端备份：`/opt/ziwei-staging/backups/phone-receipts-20261016T030906Z`。
- 中控备份：`/opt/ziwei-staging/backups/android-control-20261016T031528Z`。
- 旧主站：`/opt/ziwei/releases/v2-hotfix-cd610444ce79/v2`；旧中控：`/opt/ziwei-control/releases/8a4fe59`。
- Android 历史包已逐文件核对复制至 `/opt/ziwei-control/shared/downloads/android`；新 release 的 `dist/downloads/android` 指向它。原下载 URL 与 index 内容不变，index SHA-256 `20cc66c484238f3e8316b7ce9604cbc5fb45785736624552708a9d658c8aef7a`。
- 回退服务只切代码 current 链接并重启对应服务，必要时恢复客户端发布三文件；不覆盖当前业务数据库。手机覆盖更新不能直接降级，恢复旧逻辑需原签名与更高版本号。

收到原签名后，先核对证书，再生成 code16 的两个包，校验包名 / 版本 / APK SHA 和签名后发布。空闲时沿既有升级协议先 Updater 更新 Agent，待新版本健康提交后由 Agent 更新 Updater。随后程序自动读取退出诊断，并在安全测试输入页验证中文、键盘开关、焦点切换和结果读回；不重复真实业务动作。私有接续脚本、SSH 引用、精确测试回执和产物在本修复工作树 `.local/android-stability/`，不得提交其签名或运维凭据。
