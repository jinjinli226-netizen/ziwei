# 紫薇·互联完整终端管理接入

状态：已完成实现、推送、两端部署、真实域名只读浏览器及 APK 下载核验；临时 QA 会话和凭据文件已清理。实机手机操作验收仍单独待完成。

## 交付与入口

登录主站后进入工作区左侧“系统 → 紫薇·互联”。手机工作区正式地址为 `https://qzelynth.top/phone_ai/ziwei-connect`。Owner/Admin 使用主站同一登录即可批准或拒绝手机；手机在连接页填写 `https://qzelynth.top` 后申请，批准后沿原 `pairing_hash` 配对协议自动领取独立 Agent/Updater 配置。

`frontend/src/components/terminal/TerminalConsole.vue` 实质复用原 `AndroidDevicesView.vue`，保留手机列表/详情、审批全状态、双端健康/心跳/错误、手动登记与一次性配置下载、真实截图和原像素 tap/swipe、文字/导航/应用启动、控制端切换/暂停/draining、完整命令回执和 uncertain 核实、已发布 APK 选择、双端升级/取消/验收/修复、手机归档。当前手机在主站详情插槽绑定已有数字员工与账号，执行记录和诊断保留，采用主站浅色主题和导航。

## 认证和数据边界

- 管理 API 经 `/api/workspaces/:slug/ziwei-connect/terminal/android-devices[/*]` 使用主站工作区身份代理，沿用成员与 Owner/Admin 校验。管理凭据只留服务端，浏览器不需要第二次登录原控制台。
- 手机身份、配对、健康、截图、控制租约、命令与升级继续保存在原控制服务；主站仅保存员工/账号绑定及运行记录，没有复制第二份手机状态。
- 复用既有 Node 控制服务、Android 双端协议和 MCP，不新建数字员工，不改本机 daemon。
- 真实域名验收只读，不批准未知申请，不登记真实设备，不执行手机动作。

## 实际修复

summary 列表只含活动命令和活动升级，不含终态回执与结果。控制台现在按列表→当前详情刷新，并保留历史；升级预检直接读取捕获手机 ID 的完整详情，成功截图回执与新截图可见后才下发升级。离页或换手机后停止继续提交升级。员工动作 delivered/executing 继续轮询，acknowledged 保持“已人工核实”语义，核实事件同步关联旧运行记录。首条其他手机绑定不会再填入当前手机账号，批准和归档成功提示不会被选择刷新清空。

## 发布事实与备份

| 项目 | 本轮真实状态 |
| --- | --- |
| 主站功能提交 | `a625350b23926597810fe5181741937933303170`，已推送 `origin/codex/ziwei-terminal-console` |
| 主站发布 symlink | `/opt/ziwei/current -> /opt/ziwei/releases/a625350` |
| 主站发布前版本 | `f88d6f8` |
| 前端产物 | `index-noIbPxU1.js` |
| 主站服务 | 既有 `ziwei-api.service`，`127.0.0.1:4178` |
| 控制服务 | 既有 `ziwei-control-api.service`，`127.0.0.1:5191` |
| 首次备份 | `/opt/ziwei-backups/terminal-console/20261008T122923Z`，双 SQLite 与配置，integrity 检查通过 |
| 源归档兼容提交/发布 | `8a4fe59f0b2486fb584962fd3006e9a47418037a`，已推送 `origin/codex/phone-archive-compat`；`current -> releases/8a4fe59`，发布前 `af63071` |
| 控制服务第二备份 | `/opt/ziwei-backups/terminal-console/20261008T124627Z`，mainBefore=`a625350`、sourceBefore=`af63071`，12 配置、两 SQLite integrity 均通过 |
| APK | 既有 `/downloads/android/index.json`，v0.4.4/code 15；APK 与 `dist/downloads` 保留 |

源 `af63071` 部署复核缺少归档 API 和 `android_devices.archived_at`。源增量仅补原本地归档实现与该列的兼容迁移，保留历史、撤销双角色接入及配对凭据、从列表隐藏手机。不会复制手机数据或覆盖下载资源。源端已于 `2026-10-08T12:47:46Z` 部署，服务 active、健康接口 200，真实数据库兼容列存在、手机 0。仅重启原控制服务，主站/Nginx 保持 active、未为此重启。源 `node_modules/.local/data/dist/downloads` 均继续链接 `af63071` 原真实目录，保留 APK/CLI。

主站继续链接原 `data`、`.local`、`node_modules`。本轮不改 DNS/子域名，不启停本机 daemon，不切换其配置或凭据，不新增本机业务实例。当前本机 daemon 只读事实为 `20242`、PID `33260`、工作区 `test_222`；本地代码 `bjc-ops` 和真实全局 daemon `test_222` 的边界保持不变。已有 dirty 修改与 `tmp_gzgov.html` 保留。

## 验证记录

- 主站全套 `npm test -- --test-concurrency=1`：189/189；lint/build 通过。默认并发运行在构建 CPU 负载下曾触发既有 daemon 60 ms/100 ms 计时用例失败；隔离 daemon 7/7 与全套串行复核均通过，没有改 daemon 或把失败记录改报成功。
- 源归档兼容补丁：Android/terminal-console 测试 36/36、生产 build 与 diff check 通过；覆盖旧 schema 迁移及重复启动、在线/活动命令/升级/租约阻断、归档列表隐藏、双角色旧凭据失效及历史保留。
- 隔离真实 HTTP/SQLite 协议验证 6 组：主站身份/权限、原配对批准、双角色相同设备且凭据独立、拒绝/过期、登记/归档、绑定删除及代理错误边界。
- 构建后合成浏览器 6/6：审批加载/空/过期/批准拒绝提交与错误态、原完整控制页面、原尺寸截图动作、完整回执/人工核实、精确 summary 契约、升级预检及离页停止、员工账号隔离、归档、弹窗/滚动与 390 px 布局。
- 真实域名只读浏览器证据 `.local/terminal-live-evidence/results.json`：临时主站 Owner cookie；1440 px 和 390 px；匿名管理代理 401、登录后 200、直接源管理接口仍 401；无需源管理员登录。页面/审批空态/登记弹窗打开关闭/导航均通过，0 page/console/request 错误、0 设备动作。真实手机 0、待审 0。

源更新后的最终生产核验已完成，记录时间 `2026-10-08T12:49:03Z`：

- 真实域名只读脚本 6 项检查/5 个探针全部 passed：Owner 主站会话 200、匿名 401、直接源管理 401；1440/390 px 无溢出，0 page/console/request 错误、真实设备动作 0。
- `.local/terminal-live-evidence/deployment.json`：主站/控制服务 health=true，主站/控制/Nginx 三服务 active，归档兼容列真实存在，手机数 0。
- v0.4.4/code 15 发布清单 200；Agent/Updater APK GET 均 200，分别 815470/815474 bytes，SHA-256 均 matches 发布清单，下载资源保留有效。
- 临时 Owner QA 会话已撤销，服务器和本机临时 token 文件已删除，没有保留额外登录。

尚未完成实机 APK 安装、申请→批准→自动领取配置→双端心跳、真实截图控制和双端升级验收；隔离协议和合成浏览器通过不代表真手机在线。

## 回滚

主站需要时将 current symlink 切回 `/opt/ziwei/releases/f88d6f8` 并重启既有主站 API，检查 `/healthz`、页面及登录。源需要时切回 `/opt/ziwei-control/releases/af63071` 并重启既有控制服务；旧版兼容额外 `archived_at` 列，但不提供新增归档管理行为，代码回滚不会自动恢复已撤销凭据。两端真实数据目录和历史均保留，数据库只在明确需要时从归属和时间均核对过的对应备份恢复，避免覆盖发布后的有效数据。
