# 紫薇·互联 Android 安装页

状态：页面与下载 helper 已实现，代码回归及构建后浏览器验收通过；本会话只开发验证并推送，T6 是唯一发布执行方，尚未由本会话上线。

基线：`c91f331`，包含 `a625350` 完整终端控制台；分支 `codex/ziwei-android-install`。提交号以该分支 Git 历史及交付记录为准。

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

验收日期为 2026-10-08。以下验证构建产物和现有公开 APK，不作为新页面已经上线或真实手机安装成功的证据。

| 项目 | 当前状态 | 最终结果 / 证据 |
| --- | --- | --- |
| 下载数据 helper 单元测试 | 18/18 通过 | 包含 Chrome 简化 Android UA、发布切换与地址校验 |
| 前端构建 | 通过 | `index-BUxdmKav.js` / `index-C8foC8Iv.css` |
| 完整串行测试 / lint | 207/207 通过；lint 通过 | `npm test -- --test-concurrency=1` / `npm run lint` |
| 安装页浏览器验收 / 截图 | 9/9 通过 | `.local/android-install-evidence/results.json` 与 4 张截图 |
| 原终端控制台浏览器回归 | 6/6 通过 | `.local/android-install-terminal-regression/results.json`，无 page error；3 个预期错误响应 |
| 公网索引 / manifest / APK 只读验证 | 通过 | code15 / v0.4.4；Agent 815470 B，Updater 815474 B；真实浏览器下载 SHA-256 与清单一致 |
| Git commit / push | 交付时按本分支 Git 历史核对 | `codex/ziwei-android-install` |
| T6 统一服务器发布 | 本会话未执行 | T6 发布后回填版本、路由与服务证据 |

已执行的验证范围与复验命令：

- Node 测试验证最新发布选择、路径约束、错误、空包以及 API 身份保护。
- `npm run build` 后执行 `node scripts/verify-android-install-ui.mjs --public-downloads`。页面/API 用构建产物和 fixture 隔离，真实 APK 下载使用现有匿名公开发布；验证最新版本、两个按钮文件名/大小/SHA-256、复制地址及失败回退、二维码像素解码、加载/重试/空态/缺角色/iOS、390px/1440px 无横向溢出、主站入口及返回、相似路由不绕过登录。未启动监听端口或业务后端。
- Chromium 的原生 `download` 请求可能绕过 Playwright 路由；默认不带 `--public-downloads` 时只核对下载链接与属性，不点击 APK。该参数明确允许真实匿名下载验证，并根据当次公开索引/manifest 核对内容，不能把真实下载误记为 fixture 文件。
- 二维码本地生成：`node scripts/generate-android-install-qr.mjs`，实际像素解码为 `https://qzelynth.top/android-install`。
- `node scripts/verify-ziwei-terminal-ui.mjs --output .local/android-install-terminal-regression` 复验完整终端；使用独立临时测试静态服务和合成 API，不连接真实手机。
- 公网验证不写生产数据；页面/API 的 fixture 验收不等于新页面已经发布。没有执行真实手机安装、授权、入网或升级。
- 提交并推送到 `codex/ziwei-android-install`，基于 `c91f331`（包含 `a625350` 完整终端）；不从旧分支覆盖当前终端功能。
- **T6 唯一负责发布**：保留既有 `/downloads/android/` 静态资源、下载代理与 SPA fallback，确认 `/android-install` 和 `/android-install/` 返回安装页 HTML，不能被 API/认证规则拦截；新主站 `dist` 不覆盖 APK。当前会话不独立部署、不改 Nginx、不切 release、不启动或接管业务服务。

## 风险与回滚

公开发布索引与 manifest 短暂不同步时不显示假下载按钮，显示可重试错误。页面无数据库迁移；回滚只回退本轮前端代码与资源，保留 APK 与原控制服务。
