# 会话目录绑定持续等待修复

用户反馈 TikTokTrendS 点击目录提示正在核对 Bot 绑定，切到仅本人可见的秘书员工知微也出现同样阻塞。

根因有两处。会话绑定 watcher 使用返回新数组的单 getter，每次消息/执行详情替换对象，即使会话和员工 ID 不变，也重新发起绑定请求、设置 pending 并废弃上一代结果；轮询或实时事件快于请求时会反复等待。另一个入口将普通对象赋给 Vue ref 后与原对象比较，响应式代理不相等，首次主会话加载失败时无法清除手动设置的 pending。

改为监听会话、员工、工作区、当前账号的标量身份；内容刷新不重启绑定。迟到结果按完整作用域丢弃。主会话入口保留响应式对象身份，以便失败只清理自身。目录打开时仅为已配置 Bot 定向更新 revision/control epoch；普通员工不重复查询。等待期间换员工、账号、工作区或离开聊天均不打开过期弹窗。“使用当前目录”在异步完成后再选择设备默认路径。

权限、员工可见范围、设备绑定、Profile/HOME 和后端目录检查规则保持。提示改为当前员工的目录设置，避免把所有员工都称为 Bot。

验证：新增真实 Vue ref/watch 与实际 App.vue 函数生命周期回归，旧代码 7 项失败，修复后 10/10。连同目录操作、主聊天、工作目录回归共 37/37；lint 和前端构建通过，独立代码审查完成。没有调用模型、改员工配置或写入用户目录。发布按先推 GitHub，再仅切换前端静态资源执行；API/Windows 包保持既有版本。

产品提交 `9ba205d68ea1c50bc93118f0780335a6394da808` 已先推 GitHub，2026-10-17 09:36:29（Asia/Shanghai）完成仅前端发布。公开首页、全部新静态资源和版本元数据哈希校验通过，服务身份、API路径、官方客户端包、数据库 inode 保持。

- 前端首页 SHA-256：`3f29ad467aa21f84bddb6c563cec49f6f11c5d978e3a872ce6a7053da67d18d4`
- 发布结果：`/opt/ziwei-staging/frontend-directory-9ba205d/publish-result.json`
- 回退备份：`/opt/ziwei-staging/backups/frontend-directory-9ba205d68ea1-20261017T013629Z-06809a02`
- API仍为 `eabe098`，Windows官方包仍为 `5db7d83`，没有重启服务或启动本机监听端口。

本轮回退仅恢复备份中的 index.html 和 FRONTEND_RELEASE.json，保留业务数据与旧哈希静态资源。

正式页面实测已通过：TikTokTrendS 在公司台式成功打开目录弹窗并读取 `D:\AIUSE\TikTokTrendS`，返回目录存在、3个盘符及5个子目录；知微在李金晋电脑成功读取原会话目录 `C:\Users\25941`，返回目录存在、2个盘符及115个子目录。仅发起各一次只读目录检查，未选择/保存路径、创建目录、修改员工资料、调用模型或更改可见权限。测试临时浏览器页已关闭。

截图留在主工作目录 `output/verification/tiktok-directory-fixed-20261017.jpg` 和 `output/verification/zhiwei-directory-fixed-20261017.jpg`。用户刷新网页即可，无需更新Windows客户端。


## 同日跟进：执行中点击目录仍等待

用户在 TikTokTrendS 执行中再次报告等待。当前页面加载的确为首轮 `index-CsQMWc01.js`；实际点击后没有目录弹窗，不能归为未刷新。首轮两次真实目录读取成功，但未覆盖请求挂起与执行中再次打开的场景。

剩余代码缺陷：绑定读取无 deadline；目录打开前 await 绑定，挂起时只能反复等待；初次读取失败的 null 与已确认普通员工混同。修复为目录窗口立即打开，读取状态与错误在窗口内显示，错误可直接重试且保留输入路径；同一员工/会话/工作区/账号共用正在进行的读取，迟到结果不能改变新编辑器。未知/失败的绑定必须重新确认，普通员工仅在已确认后跳过额外读取。普通聊天的目录入口同样可进入加载界面。

Bot GET 和会话 GET 全程 20 秒 deadline（含响应体），取消 transport 并隔离迟到结果；执行 POST 不套短超时。目录检查仍使用真实设备与当前 revision/control epoch，不修改已有执行、可见权限或运行绑定。52 项相关回归、lint、前端构建与独立代码审查通过。发布及实测结果待下节记录。

## 真实目录检查暴露的执行准入阻塞

`4fd364a` 前端于 10:19 发布后，窗口能立即显示并读到绑定；两次只读检查在公司台式返回 `The operation was aborted due to timeout`。原动作均已在服务器收到 failed 终态，不把已接收当作成功。Nginx 显示对应 `/execution-admission` 请求为 499，客户端 10 秒截止被触发。

定位到 ACK/执行准入保护仅为取产品 state 却调用完整 `preservation.inspect()`，反复扫描全部历史、员工、Profile。对正式数据库只读测量：完整检查 7843.44 ms，单独读取 state 0.177 ms，两者 state 一致。改为独立轻量 state 查询；真正封存/回退审计、V1兼容冻结、设备身份、执行绑定与原回执规则不变。另将目录入口/回执鉴权改为只读会话归属和员工可见性，避免重复装载聊天附件/执行历史。

期间 Android 会话已发布 `mobile-read-9e5dee5c700c`。本修复基于该现场保留移动 view/avatar API 和 SQL runs 改进，未用旧基线覆盖。44项后端纯测试（含回退状态、私有员工、目录设备/版本与移动接口）通过，lint通过。前端追加确认非Hermes员工属于普通员工的分支，避免将明确不支持Bot的返回误作网络失败。

## 10:38 发布与 10:39 实测记录

产品提交 `77bb58a729a21ff32ff505ffc1d5e179e913d612` 已先推 GitHub。API 于 `2026-10-17T02:38:49.017273Z`（北京时间 10:38:49）发布，前端于 `02:38:54.931425Z`（10:38:54）发布。44项后端和53项前端回归通过，lint、构建和独立代码审查通过。

API 基线是现场 `/opt/ziwei/releases/mobile-read-9e5dee5c700c/v2`，保留移动 view/avatar API、SQL runs 优化及既有线上修补，仅替换 `backend/app.mjs`、`backend/repository.mjs`、`backend/version-preservation.mjs` 后重启 API。官方 Windows 包仍 `5db7d834deaf3524adfada59a434bc764fda750a`；业务数据和受保护状态保持。首次 manifest 的旧文件哈希与现场修补版不符，在变更服务前拒绝，未触碰文件；下载真实旧文件独立核对仅差本次补丁后，使用其哈希建立新发布阶段并成功完成。

- API 发布操作：`6675b84b-1ffe-4499-a506-7b59e773bd52`；备份 `/opt/ziwei-staging/backups/directory-api-77bb58a729a2-6675b84b-1ffe-4499-a506-7b59e773bd52`。来源文件回读核验通过，API 已 active/running。
- 前端备份：`/opt/ziwei-staging/backups/frontend-directory-77bb58a729a2-20261017T023854Z-5ef6d07b`；首页 SHA-256 `66874253b54dd55c62e786103216dbd7e962174242c60511f20c255b2f76d331`。公网首页、全部新资源和版本元数据回读核验通过。
- 本机发布证据：`.local/directory-api-final-77bb58a/publish-output.txt`、`.local/directory-frontend-final-77bb58a/publish-output.txt`。这些本机路径用于接续核验，未作为仓库附件提交。

正式 TikTokTrendS 只读目录动作 `action_3c8f2554-1381-483e-9411-bad045461c4c` 已返回 `succeeded`：创建 `02:39:10.564Z`、ACK `02:39:13.239Z`、完成 `02:39:22.370Z`。返回原目录 `D:\AIUSE\TikTokTrendS`，3个盘符、5个子目录；从创建到完成约11.8秒。此结果验证目录执行链路，不代表模型任务或24小时连续运行已验收。**知微在本次发布后的验证仍在进行，待独立回执补录；不能沿用首轮成功记录替代本轮验证。**

回退时恢复上述 API 备份中的三个原文件并重启 API；前端恢复本轮备份的 `index.html` 与 `FRONTEND_RELEASE.json`，保留旧哈希资源。无需改数据库、Profile/HOME 或客户端包，也不回退已保留的移动接口。

## 执行中只读目录与主聊天入口补齐

知微在李金晋电脑执行任务时，已能打开目录窗口并读取当前路径 `D:\AIUSE\friend`，但检查被 `BOT_BUSY` 拒绝。进一步确认目录检查复用了 Bot 执行占用检查、会覆盖 active_action_id，而且旧客户端会按顶层 employeeId 排到长任务后。只读目录现保留完整 conversation/hermesBot/设备/请求者绑定，以 inspectionEmployeeId 标识且使用独立动作调度，不占用或释放原运行任务；仅精确 directory.inspect + createIfMissing=false 适用。创建目录、实际保存不同路径保留占用限制，原路径不变可保存。ACK、执行准入、执行前再次核对版本与设备，封存限制不变。

另修复主聊天入口先切页面、后切员工的竞态：立即设置目标员工，手动打开期间背景列表不再抢占选择，用户主动切换仍可以取消，失败也不会保留旧员工身份。前端新增7项真实生命周期回归。产品 `51e2a25538ea24691c60baf7a8064b9adde8bc5a` 已先推 GitHub；最终后端57/57、前端76项纯回归、lint、构建及独立审查通过。

测试操作例外：扩展验证误纳入3项既有 HTTP listen(0) 测试，已结束并关闭自有临时服务；不应将这一轮全部描述为无监听。随后重新运行纯测试，端口中心检查本 release 工作树返回 ok:true、conflicts:[]、unregistered:[]，未保留新增监听。后续测试不得绕过端口登记。

`51e2a25` API 于 10:52:42、前端于 10:52:51 发布成功。API 仅替换 bots/repository/version-preservation 三文件，保留前次性能修复及移动端接口；客户端仍为 `5db7d83`。API备份 `/opt/ziwei-staging/backups/directory-api-51e2a25538ea-018d0adf-1522-4089-96d8-0d7da7a55ff1`，前端备份 `/opt/ziwei-staging/backups/frontend-directory-51e2a25538ea-20261017T025251Z-5c187d76`。公网静态资源、元数据及服务健康回读通过，数据库、官方包、中控与Nginx身份保持。

### 10:57 最终正式页面回执

知微刷新到 `index-Bs9eeNY3.js` 后，目录动作 `action_f093db74-9810-49cc-bd5b-024ad1406106` 于 `02:57:39.569Z` 创建、`02:57:42.399Z` ACK、`02:57:45.498Z` succeeded，约5.9秒。返回 `D:\AIUSE\friend`、exists=true、2个盘符、0个子目录，页面显示“目录存在，可以使用”。旧页在发布后的首次重试没有取得新动作回执，未将其记为通过；最终刷新后的结果有独立服务器终态与页面证据。知微当时 active_action_id 已为空，原任务已经结束；执行中并行能力由保持原长任务的真实调度器回归证明，本次未另发模型任务制造并发，也不将闲置实测称为并发实测。

TikTokTrendS 刷新后的第二次成功动作是 `action_2729cfe1-8880-49d9-8cfa-c0c30629993e`，`02:41:25.871Z` 创建、`02:41:34.489Z` 完成，约8.6秒，仍为3个盘符和5个子目录。两位员工均未保存/改动路径、创建文件夹或改变可见权限。最终截图在主工作目录 `output/verification/tiktok-directory-final-20261017.jpg`、`output/verification/zhiwei-directory-final-20261017.jpg`。知微临时验证页已关闭，用户原 TikTok 页面已加载最新前端。
