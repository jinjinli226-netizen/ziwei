# Android 自建持续接收

`com.ziwei.manager`，最低 Android 8 / API26，target35。此版0.5.0-internal / code12移除全部TPNS、OEM、FCM适配器与Gradle依赖。只通过现有正常HTTPS会话连接自建紫薇服务器，没有安装秘密、设备token或第三方注册请求。

## 构建

```sh
python3 mobile-manager/scripts/android-tools.py
python3 mobile-manager/scripts/test-android.py
python3 mobile-manager/scripts/build-android.py --profile selfhost --version-code 12 --version-name 0.5.0-internal
```

默认及唯一profile为selfhost。手工javac→D8→AAPT2→zipalign→apksigner，不启动Gradle、adb或模拟器。固定工具沿用原缓存；内部签名沿用原独立管理App身份，私钥/密码不入库。脚本核包名、版本、SDK、五项准确权限、签名、对齐、web逐字节绑定，并拒绝任何厂商/TPNS/FCM DEX类或原生库。产物默认dist，也可用--output写私有候选目录。

## 用户明确开启的连接

用户点击开启、系统通知权限获准后，先启动specialUse前台服务并请求v2 baseline，不推送旧历史。持续连接拥有独立LOW静音频道和常驻通知，明确标为直接接收员工消息/任务提醒，可点“停止接收”。不使用dataSync、remoteMessaging、音频、无障碍、WakeLock或自动电池豁免。另保留一个15分钟Job仅作补充；连接Service运行时Job不重复收取，两个入口共享唯一cursor/去重/本机capability所有者。

FGS和普通权限仅INTERNET、POST_NOTIFICATIONS、ACCESS_NETWORK_STATE、FOREGROUND_SERVICE、FOREGROUND_SERVICE_SPECIAL_USE。specialUse subtype如实说明自建服务器员工消息接收。没有BOOT receiver；正常前台恢复能重新启动此前明确开启的连接，系统回收后的sticky恢复仍须有效本机订阅。Doze、省电限制、断网与用户强制停止可能暂停接收，不能保证被强制停止后送达。

桥新增openBatterySettings()，仅受信前台点击打开本App系统详情页，用户自行选择电池设置。状态batteryOptimizationExempt只读，不申请REQUEST_IGNORE_BATTERY_OPTIMIZATIONS、不自动更改设置。

## v2传输与本机状态

固定正式HTTPS源，正常CookieManager会话只进请求内存，不给JS、不持久第二份Cookie、不输出。无重定向、TLS放行或自定义URL。接口：

- GET /api/workspaces/:slug/mobile/notifications-v2?baseline=1
- 增量 ?cursor=...&limit=30
- /wait?cursor=...&limit=30&timeout=25
- /items/:eventId 当前会话逐项fresh授权

只接受schemaVersion2，nextCursor为正式游标；旧v1订阅在升级时清除并要求重新开启。接收先等待/补拉页，再逐项fresh GET、显示/去重落盘，最后提交页cursor。重试仍保留cursor，重复回包不双发；网络切换取消旧request并补拉，退避1秒至60秒封顶。401/403清停，409提升generation、清旧点击能力并新baseline跳过旧历史。Service和Job在同一原子门禁下读取，迟到回执必须匹配generation和当前Cookie。

消息通知使用真实员工名(title≤160 UTF8字节)与纯文本内容(summary≤1024字节，保URL/换行)，可展开，锁屏PRIVATE。只在内存和系统通知中显示正文，私有偏好不保存正文/title/summary。setForeground(chatId|'')仅标记真正可见的原会话；该会话事件同cursor/seen原子抑制，后台/离页清除标记。

点击只传192bit本机随机能力，不暴露目标URL。能力绑定账号、工作区、generation及24小时TTL，使用一次；PendingIntent显式且immutable，独立私有URI防请求码碰撞。点击用当前HTTPS会话核scope，网页登录ready后再fresh resolve v2 item并打开原聊天，不新建会话。退出/换号同步清能力、关闭Service/Job及旧通知，迟到网络回执不能恢复。

## 桥与状态

保留getStatus/configure/requestPermission/openSystemSettings/clear/consumePendingTarget/setForeground，新增openBatterySettings。deliveryMode为selfhost/supplement/unavailable；connectionState为connecting/connected/backoff/stopped；另有foregroundServiceRunning、batteryOptimizationExempt、batterySettingsAvailable、supplementScheduled。selfhost表示前台连接服务正在运行，不保证系统一定即时调度。

JVM检查包含原URL/receipt边界、真实文本限长/UTF16、精确前台抑制和退避边界。必须再以隔离Android安全合成事件验收后台收到→员工名/实文→点击原聊天、断线恢复、重复回包、前台抑制和退出后迟到；不得把编译/模拟器结果冒充真实厂商手机强制停止后送达保证。

参考：[Android specialUse前台服务](https://developer.android.com/develop/background-work/services/fgs/service-types#special-use)、[后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)、[Doze与待机](https://developer.android.com/training/monitoring-device-state/doze-standby)。
