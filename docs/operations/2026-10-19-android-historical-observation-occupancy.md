# Android 历史只读观察异常与当前占位

旧准确 code14 在原闲鱼聊天自然同步后，顶部显示上次已完成，原73条消息和两条恢复验收成功回复均可见，但仍从旧历史 unknown 选出当前运行横幅，展示待核实、停止并禁用非空草稿发送。问题由准确旧包在 Android35 模拟器复现；初始异步未加载的帧未计入通过证据。

新版不以最新成功或时间解除其它执行的阻断，而是把“历史业务结果仍未知”与“这条记录是否占位”分开。复用部署 API `e7ecaf6a52ed2b1229008b881be4d5084ca717e0` 与权威工作树 `794211e` 中相同的 `backend/bot-execution-occupancy.mjs` 完整纯校验模块，字节 SHA256 为 `4a3cd7a5c5a4460e639f794238057d4058a71bf0f91904902f20737fa8649d1f`。只排除严格 `exitedReadOnlyPhoneObservation`，保留 App 原有 queued/running/executing、顶层 uncertain 等所有忙谓词；没有直接用更窄的后端状态集合替换它们。

现有 `view=mobile` 读取沿普通 repo 完整 action，保留 payload/result、terminalMcp、botIsolation，只去可识别图片字节和部分事件；不使用省略关键证据的管理摘要。完整 CLI 根退出、全部实际手机写终态、剩余仅只读观察未知以及动作、员工、电脑、Profile 与工作区均须核对。普通 API action 不投影 workspace_id，依授权请求与完整 Hermes workspace 绑定；显式 DB 归属仍按当前成员工作区核对。缺回执、未知新证据或其它真实 unknown 不获豁免，无需增加 API 契约或改生产服务。

`executionUncertain` 及原失败记录不变。展示为历史结果待核实时，不宣称原手机成功、进程树退出或员工已经停止；只说明本条历史记录不再占位。最新成功不清除同员工其它聊天的真在途。原 controller scope、epoch、取消和写入幂等保持，runtime 无额外改动。

| 项目 | 值 |
| --- | --- |
| 准确源码 | `94379947947b2304895ee144c55acf073174e97a` |
| 版本 | `0.5.3-internal` / code15 |
| APK SHA256 | `6938df37c25f529c522ed92e06e32b0264ec9b76fa4780a9f284563b3d0d1d6f` |
| 大小 | 780,821 bytes |
| 原签名 | `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35` |
| 原生 DEX | 与准确 code14 字节相同：`7f350ebe7550d657e37caceb44843bd0aa6f8646811e0fcc48f36019c8660ab9` |

全网页476/476，独立22个内存反例及20项历史/控制器检查通过；真实 Chromium 组合输入、跨员工与工作区草稿回归通过。新增控制器反例覆盖旧visit的busy不能复活、新真实unknown不能被旧released清除、同slug DB换代、辅助GET失败保留真阻断，以及多轮刷新和详情返回。28份网页资产独立核对准确 Git、manifest、APK一致；Java、资源、权限、通知接收实现不变，无第三方或测试 CA / 调试桥入包。

准确 code14→15 已在同一私有 Android35 模拟器覆盖安装，安装内 base.apk 实读SHA与上表一致；UID、首次安装时间、原登录和非空文字草稿保留。读取完成后三次自然8秒轮询，原73条消息、两条先前恢复回复与草稿不变，旧待核实/停止误锁消失，发送按钮可用但从未点击。详情可见刷新返回、退出首页后重进均稳定。原旧失败标签、完整error和action ID与旧14逐字一致。原进程树未确认/3个保留进程仅关联提供的既有只读QA收据，不伪称本轮UI直显或新进程测量；原始会话以先前验收的两条唯一回复与完整73条历史关联，不提取Cookie或运行时ID。

本轮没有现场真忙样本，也未遍历或制造任务；真在途及未知写保护由476回归与独立22个反例验证。初次覆盖后仍在加载的0条历史/send禁用帧完整保留，不算通过。准确原生记录在 `.local/mobile-manager-readonly-observation-code15-native-qa/actual-android-canonical-result.json`，清理收据同目录 `cleanup-final-owned.json`。

本轮接收器从未启用，没有测试输入法。只停止自有QEMU/ADB并销毁本次新userdata，释放401–413，删除本轮shim二进制；原六盘SHA/大小/mtime均未变，旧59582、保留267/268/271和其它项目260不动。临时依赖链接已移除，真实依赖目录未改，最终端口检查正常。

已先推送准确源码到 GitHub，再发布[0.5.3 内部测试版](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.3-internal)：[直接下载 APK](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.5.3-internal/ziwei-manager-0.5.3-internal-code15.apk)。tag 实际解析为9437994，匿名完整下载SHA与准确模拟器已测包一致；附SHA256和manifest-code15.json。590×590安装二维码保存后重新解码核对同一直接下载URL，文件位于 `output/android-manager/v0.5.3-internal/`。独立最终收据 `.local/mobile-manager-occupancy-code15-independent-review/final-release-review.json` 已固定；root发行gate固定27份验证和清理证据，发布结果见 `.local/mobile-manager-release-0.5.3/result.json`。

本轮未发送消息、停止或暂停员工、重放业务、安装 Windows 更新或改动生产 API。运维员工没有任何控制操作，原始未知失败及3个历史保留进程证据不改写。模拟器通过不代表物理手机已验收；`deviceVerified:false` 保持。
