# Android 双应用安装页的同源发布索引修复

本事件独立于已完成的 Hermes / ziwei_user 修复，不升级客户端、不更改 Android APK，也不执行手机或员工业务。

## 故障与正式地址

2026-10-27 的真实页面 `https://ziwei.qzelynth.top/android-install?workspace=bigtron` 使用 `index-Dp12wvM7.js`，安装 helper 仍请求旧根域的 `/downloads/android/index.json`。该响应 HTTP 200，但没有允许新子域读取的 CORS 响应头，真实浏览器返回 `net::ERR_FAILED` 并显示“发布索引加载失败”。新子域已有同字节索引、清单和双 APK 的同源服务，故不需要扩大 CORS 或修改共享 edge。

只读核实最新双应用为 `0.4.11 / code22`，Agent 891538 字节，Updater 891542 字节；两个域名上的实际下载 SHA 均与正式清单相符。该双应用不是 Android 管理 App code18。旧根域的安装页现已 308 到新子域，并保留 `workspace` 查询参数。

中控根地址另按当前 Nginx 机器路由、公开原生 CLI 文档和 `/api/health` 核实为 `https://ziwei.qzelynth.top`，不加 `/api` 或 `/control` 后缀。旧根域机器 API 仍兼容；不能因旧根域首页是生态入口就推断其设备 API 失效。网页“Agent 执行 / Updater 维护”的双角色和“申请入网、批准并绑定”流程保留，无设备申请或授权写入。

## 最小实现

- `frontend/src/android-install.js` 的正式安装、管理返回和下载地址固定为新子域。Control 根地址独立固定，不从不受信任的 location 或查询参数推导。
- 旧根域的绝对下载地址仅作为精确输入别名；先检查原始路径，再归一到新域。同一归一规则用于索引和清单的 APK 路径比较，因此 legacy manifest/HEAD 不会再次跨域。
- 保留原 URL、文件名、角色重复、版本、包名、哈希、签名等检查。其他域名、凭据、额外端口、查询、fragment、编码路径、空段和遍历等仍拒绝，fetch 继续 `credentials:omit / redirect:error / cache:no-store`。
- 安装页二维码像素、alt、链接和显示地址同步为新的裸安装 URL。沿用静态通用二维码原行为；主站安装入口及 `bigtron` 页面返回仍保留合法工作区。

## 完整候选验收

针对测试为：

```text
node --test test/android-install.test.mjs test/android-install-origin.test.mjs test/android-install-page.test.mjs
```

30 项通过、零失败、零跳过。新增用例先在旧实现复现失败，覆盖 18 条索引选 code22、旧/新绝对路径归一、严格拒绝、HEAD、真正 QR 像素解码、实际 Vue SFC 编译/加载/渲染、bigtron 返回、Control 复制和错误重试。源码独立评审及 lint 通过。

候选以发布方冻结的实际 composite 前端快照构建，非本工作分支整树覆盖。快照归档 SHA 为 `003587a6136416160500b287bb9958b46e457e25aa98c2d65fc02f32d990a3a4`，199 文件；依赖版本按原锁核对，基线及候选均在独立 D 盘副本中离线构建。候选源码仅覆盖 helper、安装组件和 QR 三项，后台、数据库、APK、CLI 与 ziwei_user 不进入静态工件。

隔离浏览器在正式 HTTPS origin 下加载冻结候选 dist，实际读取公网索引、清单和两个 APK；没有生产写入或本地监听。旧 dist 的跨域错误已在真实浏览器复现；候选无 CORS、重定向或脚本错误，双 APK 的浏览器 fetch 及真实下载按钮取得的 SHA/大小均匹配正式清单，未安装或执行 APK。浏览器 QR 元素截图解码为新安装 URL，复制地址和 bigtron 返回正确。该验收证明网页和分发链路，不代表物理手机已安装、入网或可控。

未改基线重建的 Vue scope ID 和资源指纹与原 dist 存在构建环境差异，须与原线上入口可达资源逐一映射并独立复核，不能把历史 dist 差异归入本次产品改动。所有旧指纹资源应保留，避免已有页面缓存引用丢失。

## 负责人、证据与待发布边界

脱敏证据及精确工件保存在 `D:/AINavtie/ops/ziwei/android-install-index-20261027/`，持续状态为 `OWNER-STATUS.json`。源码维护分支 `codex/android-install-origin-fix`；审核由既有驾驶舱总控进行，正式写入沿既有 sole-writer 的新事件租约执行。完整候选和哈希交审前不发布；源码推送、候选通过和实际上线分别记录，不用旧 Hermes 授权触发旧发布、客户端升级或消息重放。
