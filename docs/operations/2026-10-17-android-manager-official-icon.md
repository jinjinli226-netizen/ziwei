# 2026-10-17 Android 管理 App 官网图标统一

用户要求使用官网现有图标。已读取官网首页 favicon 引用并回读 `/ziwei-logo.png`，与仓库 `frontend/public/ziwei-logo.png` 完全一致：1254 × 1254、314313 字节，SHA-256 `68452b1f4299b0af353ee35d3315302061fa64c72cc77ba66763ebb8ec81ca2c`。

启动图标、加载页、登录页、工作区和关于标识直接复用该原图，移除原独立星形品牌标识。Android legacy 和 adaptive 图标保留原 PNG，加入浅色底；adaptive 前景采用相对安全边距，圆形和圆角蒙版均无主体裁切。员工头像的装饰不作为品牌图标替换。

## 验证与范围

- 无监听定向视觉检查 6 组通过：加载、登录、工作区、首页、关于与 360px 窄屏。原图均解码为 1254px，未见横向溢出。
- 离线 aapt2 编译与圆/圆角/legacy 预览通过。最终构建包名、code 4、原证书、权限、zipalign、全部 Web 资源逐字节比对通过。
- Android 模拟器 code 3 → code 4 同签名覆盖安装成功；实际 Launcher 显示官网 Z 图标，正式匿名登录页显示官网标识。用户真机和正式账号未作已验收结论。
- 原生 `classes.dex` 与 code 3 完全一致，API、controller、Bot/设备设置、汇报等核心 JS 哈希也与 code 3 相同。本轮仅更改品牌资源、视图及版本；功能基线为 0.1.2 的 69 项单元、39 组浏览器流程和原生验收，不把旧版本验收冒充本轮新跑。
- 临时服务已停，登记 250, 251, 252, 253, 254 已释放，最终端口检查无冲突或未登记端口。

## 发布

产品源码 `09616161620138fc40186993dc8b8ecc5066560d` 已先推 GitHub 并以 ls-remote 核对，再构建 `ziwei-manager-0.1.3-internal-code4.apk`，685430 字节。APK SHA-256 `a4c211ab3ecca60181ae5f9c56e32d82ad2a414ecffd5dbae30021d6f44caf7c`；签名证书 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`，与 code 1–3 相同，可直接覆盖安装。

[0.1.3 内部发布](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.1.3-internal)已公开，公开下载回读 SHA-256 一致。保留旧发布资产，不替换正式站/API、数据库、电脑客户端和互联 Agent/Updater。包含前版聊天历史修复与 App 内模型、能力及设备绑定。

交付目录 `/Users/zhangjie/Documents/ChatGPT/紫薇/output/android-manager/v0.1.3-internal/`，含 APK、校验、manifest、安装说明、原图来源、视觉/原生验证 JSON 和预览。
