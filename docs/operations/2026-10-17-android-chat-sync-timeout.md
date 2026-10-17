# 2026-10-17 Android 聊天记录同步超时修复

用户在0.2.0/code7交付后明确反馈：进入员工聊天，持续提示“聊天记录同步失败：读取超时”。原先原AVD通过属于上版当时观察，不能替代本次故障复现或保证实体手机网络表现。继续按已授权的总控协作分工：总控维护线上API，Android分支负责App及隔离、模拟器验证；不发送真实员工消息、转发、执行或配置命令，仅允许App自身已读水位。

## 已确认的读取行为

所有GET的20秒阈值包括连接排队、首包、完整响应下载与JSON解析；每个聊天已有单飞，不是8秒轮询必然叠同一请求。原生没有另一套HTTP桥接队列，API由WebView对原站HTTPS读取。code7的mobile conversation仅替换头像，仍带全部正文、内嵌图片和执行事件；不能因原本测试通过就排除弱网首次下载。

纯内存复现两个缓存行为：超过约16MiB的单个JSON因字符串双字节计费，不能放入32MiB总缓存；八路由FIFO又会逐出刚被304验证的历史。当前线上两原聊天未达到该单条阈值，总控报告forward_json为零，故不把超大转发或该上限冒充本次现场根因。

切员工或离开页面只失效epoch、清Map，旧history、bot、runs、routines仍继续下载直至完成或20秒；Promise不相互等待不等于网络连接不相互竞争。后台暂停也没有取消这些GET，恢复时旧请求可能已耗尽时限。这些是可复现的超时放大器，而非单凭源码认定线上唯一原因。

总控只读生产统计：闲鱼54条、正文16013字节、附件JSON813791字节；TikTok34条、正文66119字节、附件JSON1158936字节。节点健康约2–10ms、SQLite聚合及动作扫描为毫秒级，没有据此证明持续数据库阻塞。Nginx无请求耗时字段，出现大量304和少量499，不能从combined日志证明或排除20秒失败。bot详情仍水化多次历史动作事件，主控单独做窄查询优化。

## App 修复与竞态复核

产品源码 `f270f10c84ce724b23563e7d2055f34f4e23bb86`，版本0.2.1-internal/code8，已先推`codex/android-manager`。

- 304成功使用时提升真正LRU位置，200更新同样提升，保留八条/32MiB上限及每次服务端认证、ETag验证。晚到304不能复活逐出项或覆盖并发新200；不接受未经304确认的离线快照。
- 指定员工只读GET接受作用域signal，切员工、离开、后台与dispose取消旧读取。恢复后以新scope读取原canonical会话；主动取消为READ_CANCELLED，不当作READ_TIMEOUT展示。20秒真实超时保持原分类，未延长或隐藏错误。
- GET取消代次与发送POST归属分离。暂停不能吞发送成功或失败回执，不能让sending永久为true；后台不开始发送后的历史GET，已开始的该GET可取消，前台再读取。业务POST不带signal、不取消、不自动重发，待核实标识与失败草稿保留。
- 普通员工查询会话按signal隔离单飞，创建POST按同账号/工作区/员工共享。已完成创建promise保留至同一组在途opening scopes全部结束，阻止“两个lookup先读到空、首POST先完成、第二空lookup晚返回”重复创建；最后scope退出后释放，非无限缓存。

首次候选被独立审计发现上述POST暂停归属与旧空lookup重复创建两项竞态，补丁前有确定性失败，修正后单独复核4种成功/失败、回执在resume前/后时序，以及发送后GET在pause取消；均POST一次、sending解锁、原会话恢复。未将初始全绿单元测试当成充分证据。

## 隔离验证和安装候选

213项App单元通过。52组浏览器流程通过：历史10、原工作流20、设置12、转发10。历史新增真实fetch的signal.aborted与AbortError、旧route未释放即新scope重开同员工、pause/resume同原ID及草稿；原浏览器脚本的“旧GET必须200返回”断言按新取消契约更新，首次过时断言失败证据保留。独立复核API/controller101项及额外时序通过。

浏览器使用隔离真实Express/内存库，不开HTTP监听，不访问生产或账号；30张截图及结果在私有`.local/mobile-manager-sync-timeout-qa/`。编译签名包`ziwei-manager-0.2.1-internal-code8.apk`为706114字节，SHA-256 `fe81bd91331e50625a9c75209150fa8adfa2aa56036f4149ec65cf6477d97678`，原证书`507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`。本地输出附manifest、checksum和590px二维码，二维码已实际解码为本版直接APK URL。清单实体设备验证仍为false。

## 本次模拟器环境边界

初次重开原AVD时，ADB绑定参数与emulator派生netsimd需调整，未进入业务页；随后自有qemu59582在正常退出后处于macOS UEs不可中断退出，正常kill/TERM/KILL均未释放原5554/5555。没有据此宣称App复现失败或通过，没有重启Mac、清会话、清锁或并发写同userdata。旧进程CPU0、RSS约5.3MiB，5秒采样存储mtime/size不变且未见userdata存储文件open，但不能当作无缓冲写的绝对证明。

所有本轮端口已按用途登记；实际仍占用的退出残留保留登记，不虚报释放或绿色。后续本机官方-read-only临时COW实例的验证与收尾结果单独追加，不能沿用code7的原生通过结论。

## 配套后端图片读取

主控首先发布 `0da5581963b140fbf7dcf929748dbe16781a06dc`，mobile Bot查询保留能力与历史结果元数据，但不水化100个历史动作的所有events；必要latest/stop在SQL层只读完整终态证据和最后事件，保留总event_count，默认网页/MCP保持。启动时已有guard重建使SQLite schema_version变化，原发布器保护正确停在核对阶段；主控独立复算对象结构与其他文件/数据链接均一致并核健康，没有掩盖原失败或盲重播。此减负不冒充已经单独修复history首次大图下载。

图片投影随后固定源码 `9668962e1c16d3ee3b11ba9ef33bf95c4ad5842b`：仅mobile JSON将内嵌图片换成同源认证URL，保留正文、顺序、消息身份、附件元数据与size。普通图片路径 `/api/conversations/:id/messages/:messageId/images/:index?v=hash`，转发图路径 `/api/conversations/:id/messages/:parentId/forwards/:quoteIndex/images/:index?v=hash`；转发的扁平兼容附件也引用目标parent保存的快照，不能绕到不可见的来源会话读取。旧code7的图片组件已优先支持URL，代码8不需要额外请求参数。默认API/MCP和DB原图片字节不改，图片点击仍是App内预览。

主控隔离压力夹具中，无头像普通聊天JSON从1049778降到1276字节；实际reference转发父附件与快照双份的JSON从2099511降到2529字节。原DB/default/raw原图保持一致，转发没有派发任务。以上为夹具精确数值，不将它代替生产会话的实测耗时或字节数。

额外8项真实浏览器图片兼容通过，独立计在原52项之外：后台严格核9668962源码，实际served客户端15资产均等于f270；4格式普通图与转发图的缩略、详情、全屏自然尺寸和原bytes均匹配，17次图片200完整验证SHA。浏览器HttpOnly fixture cookie经真实请求传入app.handle，adapter未补造身份；无cookie401、不可见源图404、来源删除后目标快照仍可读取、目标权限撤销后带If-None-Match仍404。无外跳/生产请求/监听；证据`image-url-compat/result.json`及4截图，首个源码换行guard误报保留并修为精确Git blob或checkout filter比对。

主控报告图片API于2026-10-17 13:43:13（Asia/Shanghai）正式切换至 `/opt/ziwei/releases/mobile-images-9668962e1c16-1204ed1a/v2`，PID351449，基于0da复合现场仅替换两个图片运行文件，无DB结构/网页/CLI/中控迁移。生产组合验证在该信号后进行，不把旧API下的App表现计入新API成功。

## 临时私有 AVD 恢复过程

本机SDK确实支持-read-only，但旧UEs写模式实例仍持multiinstance.lock，SDK以“所有实例均需-read-only”拒绝新只读实例。该失败接受退出，没有清原锁。之后按授权整体复制已关闭存储盘到本机0700私有目录：6盘复制前后源SHA/size/mtime一致、clone SHA相同，无hardlink/symlink，QCOW2相对backing均解析至clone；所有可写配置与盘路径重定向至clone，仅只读SDK镜像共享。未单独提取cookie、密钥或账号凭据，原目录保持，临时完整副本验收后销毁。

独立临时实例boot后同签名覆盖安装code8成功，firstInstallTime保持，原BigTron账号及5条聊天首页目视确认。guest初次SystemUI ANR单次Wait恢复，UIA初期空2节点不能当作实际页面空白；SwiftShader重复分块画面与延迟可访问树均如实记录。05:42:15Z附近旧API0da组合截图出现“最近聊天同步失败：读取超时”，该轮未算通过；先Home暂停轮询，等13:43:13最终图片API发布后再验，不用旧帧或初始登录成功替代最终两原聊天同步结论。

## 最终生产组合原生验收

最终code8 `fe81…` / App源码f270与API966896的必要范围整体通过。闲鱼已有长正文在确认可见后额外27.1秒观察窗跨多轮自动同步保持，无资源读取错误；已有历史截图真实缩略解码，单次点击打开App内完整原图预览并正常关闭，根执行者也目视核对原图，未发送“获取截图”或其他设备命令。

第二会话自动选择器曾将正文预览中的TikTok字样匹配到Ins行，被当前header身份检查拦下。后改用Android实际放在text属性的精确可访问名称，读取当前树后立即点击对应bounds；误选Ins窗口不计TikTok通过。真正TikTok首次目视确认后跨70秒以上仍保持原header和既存正文、无资源错误；一次Home到前台恢复，06:01:25Z当前帧确认同TikTok正文、MainActivity前台与无读取错误。

总控独立按实际DB员工绑定映射Nginx的Android+Ziwei UA：闲鱼05:46:44Z mobile200为204368字节，后续连续约8秒304，原图200为71417字节；真正TikTok05:58:08Z mobile200为358057字节，之后连续5次304，无HTTP错误。05:54–05:56的Ins流量明确排除，不混用桌面约2.1MB请求或缺失的request_time字段。整体UI主要窗05:45:39–06:01:25Z，是包含测试工具、渲染及操作等待的观察窗，不能当精确HTTP耗时；UIAutomator本身的20秒dump等待也不等同App读取超时。

生产测试只有读取与App自身已读水位，没有消息、转发、执行、配置或设备命令提交。原图其他格式与转发权限由额外8项隔离浏览器覆盖，实体手机未冒称通过。完整副本及真实截图仅本机私有目录，不上传Release；无敏感汇总由Android执行者单独保存。

## 安装包公开交付

最终原生必要范围通过后，公开 [Android 0.2.1/code8](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.2.1-internal)。发布前再次核远程Android分支HEAD等于清单f270、三资产digest及长度一致；公开 [APK](https://github.com/jinjinli226-netizen/ziwei/releases/download/android-manager-v0.2.1-internal/ziwei-manager-0.2.1-internal-code8.apk) 随后匿名完整回读，SHA-256等于本页fe81…，`verifiedDownload:true`，没有以私有草稿冒充交付。Release只有APK/checksum/manifest，无真实账号图片或AVD副本。

15个APK Web资产已逐个与f270 Git blob核SHA；原证书一致，可覆盖安装，原登录和服务端聊天记录保留。输出在 `output/android-manager/v0.2.1-internal/`，590px二维码已实际解码核对到本版直接下载URL；实体设备清单字段保持false，不用模拟器代替实体手机结果。

总控又匿名独立核对GitHub Release为非draft、prerelease，06:02:25Z发布、三资产及APK digest/bytes一致，并已将双方最终边界写入[主控同步发布记录](https://github.com/jinjinli226-netizen/ziwei/blob/3bbe23826a6a0d23d0769e6fe4cf8a6a1cbbec03/docs/operations/2026-10-17-mobile-chat-sync.md)。服务器仍为9668962、PID351449，没有再次部署。

## 本机收尾与仍登记的旧退出残留

临时clone正常emu kill退出、专用ADB停止，自有临时进程剩余0。完整0700私有AVD副本已销毁；源6盘最终SHA/size/mtime与复制前完全一致，原AVD/login保留。277–281全部释放，前面未启动或退出的266、269–270、272–276也已按实际状态释放；260及其他项目未动。临时测试node_modules软链已移除，没有删除借用的依赖本体。

原普通写模式实例59582仍为宿主UEs退出残留，实际监听的267/268/271保留登记，未盲目释放或再反复kill，也没有重启Mac、清原锁或删除原userdata。端口检查绿色表示没有未登记或归属冲突，不代表此三个旧残留已经停止；将来宿主恢复并确认占用消失后才能释放。

执行者收据在私有`sync-timeout-code8/cleanup-result.json`、`clone-stop-result.json`、`source-disk-final-integrity.json`、`final-registry-check.json`，无敏感总汇为`android-sync-timeout-code8-qa.sanitized.json`。根执行者随后独立项目`check`也为`ok:true, conflicts:[], unregistered:[]`，保留于`.local/mobile-manager-release-0.2.1/root-final-registry-check.json`。真实账号截图保持本机0600，不随Git或Release上传。
