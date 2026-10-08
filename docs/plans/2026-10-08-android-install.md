# 紫薇·互联 Android 安装页

状态：已实现、推送、合入主发布分支并于北京时间 2026-10-08 22:23 上线；真实生产安装页、主站往返、完整终端与旧缓存资源兼容验收完成。实机手机安装及操作另待验收。

开发基线：`c91f331`，包含 `a625350` 完整终端控制台；T4 开发分支 `codex/ziwei-android-install`。最终提交 `81b6ec8d0eb5693f3faf5eab88cd7ff2aeabdb00` 已由 T6 快进合入并推送 `codex/ziwei-terminal-console`。

## 目标与边界

让首次使用者用手机浏览器打开 `/android-install`，直接下载并安装 Agent / Updater、填写公开中控地址、申请入网，并回到主站审批与绑定员工。仅改主站前端和验证工具；不改手机协议、升级机制、控制数据库、Nginx 或运行中的业务服务。不操作真实手机，不批准未知申请。

## 设计与实现

- 采用独立公开安装页，在 App 登录判断前只放行精确 `/android-install` 和 `/android-install/` 路径，跳过该页的主站认证初始化与工作区加载；工作区路径解析将 `android-install` 保留，浏览器前进/后退也不触发该页工作区加载。其它页面与工作区 API 保持现有保护，未修改 `backend/auth.mjs` 或 API 认证白名单。
- 主站“紫薇·互联”标题栏提供“安装手机端”入口，并带回当前工作区的上下文。公开页返回链接只接受合法工作区 slug，默认回 `phone_ai/ziwei-connect`，不接受任意跳转目标。
- 浅色科技影像风格与现有 Logo / 蓝色主色。桌面为两应用下载区 + 扫码区；手机为单列，两个大按钮直接下载具体 APK。安装步骤清楚区分手机系统授权与网页审批。
- 从公开 `/downloads/android/index.json` 与实际发布 manifest 按最大 `versionCode` 选择当前最新发布，读取真实版本、包大小和文件路径，不把 `v0.4.4` 等历史版本永久写死；禁止私网/源站/其它域名、路径穿越或带凭据参数的下载链接。覆盖读取中、错误重试、无包、缺少角色包和非 Android 设备提示。Android User-Agent 可能固定报告旧系统版本，因此不据此禁用安卓下载；Android 11 及以上作为安装兼容要求展示。
- 二维码在本地生成，内容固定为正式公开安装页 `https://qzelynth.top/android-install`；不带工作区会话或凭据、不调用第三方二维码服务。
- 首次在同一手机安装双应用并确认安装来源及必要无障碍/通知/后台权限；两应用“连接配置”的“HTTPS 中控根地址”填 `https://qzelynth.top`，同名分别点“申请入网权限”；管理员回主站“待审核入网”批准，双应用在线后绑定已有数字员工。复制成功/失败反馈不替代常驻的手机名与申请操作说明。后续更新回到已有中控升级流程，不默认要求手填角色 token 或导入 JSON。网页不承诺静默安装或代替用户确认系统授权。

## 验收与交付

验收日期为 2026-10-08。下表为开发阶段构建产物和公开 APK 验证；页面实际上线与生产结果单列在后面的发布记录。任何浏览器下载验证均不代表真实手机安装或权限授权成功。

| 项目 | 当前状态 | 最终结果 / 证据 |
| --- | --- | --- |
| 下载数据 helper 单元测试 | 18/18 通过 | 包含 Chrome 简化 Android UA、发布切换与地址校验 |
| 前端构建 | 通过 | `index-BUxdmKav.js` / `index-C8foC8Iv.css` |
| 完整串行测试 / lint | 207/207 通过；lint 通过 | `npm test -- --test-concurrency=1` / `npm run lint` |
| 安装页浏览器验收 / 截图 | 9/9 通过 | `.local/android-install-evidence/results.json` 与 4 张截图 |
| 原终端控制台浏览器回归 | 6/6 通过 | `.local/android-install-terminal-regression/results.json`，无 page error；3 个预期错误响应 |
| 公网索引 / manifest / APK 只读验证 | 通过 | code15 / v0.4.4；Agent 815470 B，Updater 815474 B；真实浏览器下载 SHA-256 与清单一致 |
| Git commit / push | 已完成 | `81b6ec8d0eb5693f3faf5eab88cd7ff2aeabdb00` 已快进进入并推送主发布分支 |
| T6 统一服务器发布 | 已完成 | 北京时间 22:23 发布 `81b6ec8`；最终生产证据见下文 |

已执行的验证范围与复验命令：

- Node 测试验证最新发布选择、路径约束、错误、空包以及 API 身份保护。
- `npm run build` 后执行 `node scripts/verify-android-install-ui.mjs --public-downloads`。页面/API 用构建产物和 fixture 隔离，真实 APK 下载使用现有匿名公开发布；验证最新版本、两个按钮文件名/大小/SHA-256、复制地址及失败回退、二维码像素解码、加载/重试/空态/缺角色/iOS、390px/1440px 无横向溢出、主站入口及返回、相似路由不绕过登录。未启动监听端口或业务后端。
- Chromium 的原生 `download` 请求可能绕过 Playwright 路由；默认不带 `--public-downloads` 时只核对下载链接与属性，不点击 APK。该参数明确允许真实匿名下载验证，并根据当次公开索引/manifest 核对内容，不能把真实下载误记为 fixture 文件。
- 二维码本地生成：`node scripts/generate-android-install-qr.mjs`，实际像素解码为 `https://qzelynth.top/android-install`。
- `node scripts/verify-ziwei-terminal-ui.mjs --output .local/android-install-terminal-regression` 复验完整终端；使用独立临时测试静态服务和合成 API，不连接真实手机。
- 开发阶段公网验证不写生产数据；fixture 验收与后面的生产上线记录分开，未执行真实手机安装、授权、入网或升级。
- 提交并推送到 `codex/ziwei-android-install`，基于 `c91f331`（包含 `a625350` 完整终端）；不从旧分支覆盖当前终端功能。
- **发布协调已完成**：T4 开发与验证完成后，由 T6 统一发布，保留既有 `/downloads/android/`、下载代理及 SPA fallback；公开安装路径及尾斜杠均 200，新主站 dist 没有覆盖 APK。此次未改 Nginx、未重启或接管业务服务。

## 实际发布与生产验收

| 项目 | 最终事实 |
| --- | --- |
| 主站 commit / release | `81b6ec8d0eb5693f3faf5eab88cd7ff2aeabdb00`；`/opt/ziwei/current -> /opt/ziwei/releases/81b6ec8` |
| 发布时间 | 北京时间 2026-10-08 22:23；最终生产记录 22:26:46 |
| 前端资源 | `index-BUxdmKav.js` / `index-C8foC8Iv.css` |
| 原控制服务 | 保持 `8a4fe59`；不改 source/data/APK |
| 发布前备份 | `/opt/ziwei-backups/terminal-console/20261008T142230Z`，mainBefore=`a625350`、sourceBefore=`8a4fe59`，12 配置、两份 SQLite integrity 均通过 |
| 运行时兼容 | backend 目录和 69 个 runtime lock 条目无变化；jsqr/qrcode-generator 仅 dev 构建/QA，生产复用原 modules |
| 服务操作 | 不重启任何服务，不改 Nginx/DNS/daemon；三服务 active/NRestarts 0，主站/控制 health=true |
| 公开地址 | `https://qzelynth.top/android-install` 与尾斜杠均 200 |
| 生产 APK | 最新 code15/v0.4.4；Agent 815470 B、Updater 815474 B；HEAD/GET/SHA-256 均匹配清单 |
| QA 清理 | 临时 Owner 会话撤销，remaining 0，服务器/本机 token 文件删除 |

真实生产证据：

- `.local/install-live/results.json`：匿名安装页 1440/390 px 两组 passed，最新索引与清单/双 APK 大小正确、QR 实际渲染解码 canonical 安装 URL、复制根地址正确、返回管理 401/登录保护；0 page/console/request errors、无 overflow、真实设备动作 0。
- `.local/install-live/main-entry.json`：真实 Owner 从完整终端点击“安装手机端”→`/android-install?workspace=phone_ai`→返回同一 `phone_ai/ziwei-connect`，实际 passed。
- `.local/install-live/terminal/results.json`：主站 Owner 终端 6 检查/5 探针通过，手机 0、待审 0、错误 0，无源管理员二次登录和真实设备动作。
- `.local/install-live/stale-assets/results.json`：合成旧 f88d6f8 HTML 配合生产未 mock GET，旧 JS 333563 B、application/javascript，CSS 172282 B、text/css；登录可见、0 errors。
- `.local/install-live/deployment.json`：北京时间 22:26:46，两端 health=true、三服务 active、归档列存在、手机 0，服务未重启；主站启动仍当日 20:35、source 当日 20:47，Nginx UTC 10-07 16:13:39（北京时间 10-08 00:13:39），QA session remaining 0。
- root fresh lint 39 files 与 build 通过；T4 完整测试 207/207、安装 UI 9/9、原终端 UI 6/6。

## 白屏调查与缓存资产兼容

用户先报告短暂白屏并自行恢复；之后只读排查没有复现实际用户事故，当前版本、服务、入口和资源正常，无直接根因证据。未为诊断无依据重启、回退或修改 DNS/网络。

独立合成旧文档重放确认 f88d6f8 的 hash JS/CSS 在当时 a625 dist 中缺失，SPA fallback 返回 200 text/html，造成模块 MIME 白屏。安装页新发布保留 a625 assets，并补回 f88 的这两个旧 hash；发布后同一旧 HTML 从生产读取正确资源、登录可见且零错误。该实验仅证明兼容缺陷及修复，不能认定其就是用户事故根因。详见 [只读调查记录](../operations/2026-10-08-white-screen-investigation.md)。后续前端发布继续保留缓存 HTML 引用的旧 hash 资产，并复验旧文档，不以刷新用户缓存替代发布兼容。

## 风险、回滚与实机边界

公开索引和 manifest 短暂不同步时显示可重试错误，不生成假下载按钮。本次 backend 未变、无数据库迁移，前端需要时只切 current symlink 回 `/opt/ziwei/releases/a625350`，无需重启 API；保留所有原 data/source/APK 和已有旧 hash 资源。原 source 的归档版本保持 `8a4fe59`。

尚未在真实手机完成 APK 安装、系统权限、申请/自动配置、双端心跳、真实操控和升级验收；公开下载、模拟 UI 和只读生产页面通过不等于实机链路通过。
