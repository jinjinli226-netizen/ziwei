# 2026-10-11 双向持久会话图片发布记录

2026-10-11 23:11（北京时间）已发布初始主站 commit `65cef4b79a9b5c900a8f8d61f1063dca96f3881e`；23:35 仅更新官方客户端为 `3c8b0b77aa972d02deffb81c846b518a792da31a`。2026-10-12 00:20:50 仅更新主 API 为 b9a5eb1；00:51:39 再发布终态 ACK 设备权限补丁 `3be8d5f6912989c27e3e92f6dc7886826bf50e0f`，当前实际目录 `/opt/ziwei/releases/3be8d5f-api1`。前端全文件继续保持 65cef4b 的已验收字节，控制端仍为 `/opt/ziwei-control/releases/8a4fe59`，官方客户端仍是 3c8b0b7。真实生产 CLI 四次 succeeded、双视口浏览器验收、resilience 12/12、终态 ACK 探针和本轮精确 QA 清理均已完成；下文首张表保留初始主站发布时的历史值。

## 精确构建与公开文件

采用已推送 commit 的 Git archive，在隔离目录执行 `npm ci --ignore-scripts`、全量测试、lint、前端构建、npm pack 和真实 Windows npm 隔离安装。fresh 测试 **526/526、0 skipped**，lint **71** 文件；协调者以该 fresh dist 复验本地 UI **5/5**，0 page errors。

| 初始主站发布项目 | 值 |
| --- | --- |
| 前端 JS | `index-kUip0tGx.js`，SHA256 `741b0b8ac70ff9f593bb755858198776106f740f28f6f47924bd72237d40d6e5` |
| 前端 CSS | `index-Chy_TRFE.css`，SHA256 `7bf7caa99778441ac9617d6bdbf2f8548f7e34d373769f223bd1f0ec873ad969` |
| index.html SHA256 | `bd839a27b821b2a2fb738b0449dcf14ff6becbd965fa520445713d736be4c639` |
| source tar SHA256 | `6b1fa7456381470f669f12b1f7ecd62cddc6b72690409c8167c748cec0ebb3dc` |
| frontend tar SHA256 | `531756b1101e35f6557c414a9ea723891d8a8c9e7fa894ddb60611622c9cb625` |
| 官方 tgz | 101,194 B，SHA256 `bb49ed3d7ac03d66317f8570f54db5bbbb3400b3fbdc4ea262f8510c98eab625` |
| archive sourceBuild | `d50965c9ad2a272de4b5be1c742106709b3443ff0920de985440f88625971b43` |
| 实际 Windows clientBuild | `0bf10707c826b104c686540ac4a1124fe14406bd5597c3badb84b827b1b94a84` |

早先工作树构建的 `index-2yBy3VN1.js` / `index-Cue85KVY.css` 没有作为最终发布文件。Git 归档与工作树的 tracked 文件只有 CRLF/LF 差异；lockfile、UI artifact 与已安装 `@ziwei/ui` 文件逐字一致。实际 `@vitejs/plugin-vue/dist/index.mjs:60` 的 production component ID 将 source 字节纳入 hash，因此 Vue scoped IDs 不同；对应映射 scoped IDs 后，JS 和 CSS 文本都完全一致。差异没有被隐瞒，最终 fresh 文件重新通过全量测试与本地 UI 验收。

`clientBuildIdentity` 按相对路径及原始文件字节计算，不做全 LF 归一。npm bin-links 仅将 `scripts/ziwei-user.mjs` 首 shebang 的 CRLF 改成 LF；实际隔离 Windows 安装确认只有这项字节差异，因此 archive sourceBuild 与 clientBuild 分别发布。

隔离安装根目录为：

`C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解\.local\conversation-images\operations\build-65cef4b-63ab1f10\windows-prefix\node_modules\ziwei`

候选包的 public files 清单包含新增 `src/conversation-image-artifacts.mjs`，共 31 个普通文件，没有 data、.local、node_modules、凭据或私钥路径。

## 客户端补充发布：管理 MCP override 顺序

首个生产原生 QA action 因管理 MCP 握手失败而精确回传 failed，保留为失败证据；上传本身与手机动作无关。排查发现受信任执行器的 `codexMcpDisabledServers` 全表 override 在临时 `ziwei_management` 注册之后，覆盖了新注册。修复仅涉及 `src/runtime-adapters.mjs` 和对应 regression tests，将全表隔离策略放在本次管理/手机 overrides 之前；普通执行不会新增空的全表 override。

协调者提交并推送 `3c8b0b77aa972d02deffb81c846b518a792da31a`，全量 **528/528、0 skipped**、lint **71**、diff check 通过。本次从精确 Git archive 重新 `npm ci`、客户端相关 fresh 回归 **51/51、0 skipped**、lint **71**、pack，并在新 Windows 隔离 prefix 实装；前端源码和 lock 与主站归档逐字一致。发布只原子替换官方 tgz/metadata，**0 restart、0 reload、0 数据库业务写入、0 手机动作**。主 API PID 165505、控制 134533、Nginx master 737 及其启动时间、主 release marker/index、Nginx 配置、签名与 data/.local 链接均保持。

| 3c 客户端补充发布时项目 | 值 |
| --- | --- |
| commit | `3c8b0b77aa972d02deffb81c846b518a792da31a` |
| 包大小/SHA256 | 101,215 B，`794687127d983b977dd9daac27f8ffd8f3bdf4b8c3e7cd140bb4f8e44550041a` |
| sourceBuild | `25eba314ffbb48726a151c7604e6f6c112d307fc34680fa518bbecb54129161b` |
| 实际 Windows clientBuild | `73332c47af1da41caf50606129778601941677adaa764c3b77e4203e98155fba` |
| mainSiteCommit | `65cef4b79a9b5c900a8f8d61f1063dca96f3881e` |
| metadata 描述 | `clientOnlyPublication=true`，`mainSiteCommitUnchanged=true`，与这次仅客户端更新一致 |

实际隔离安装根目录为：

`C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解\.local\conversation-images\operations\client-followup-3c8b0b7-2f53cfe2\windows-prefix\node_modules\ziwei`

独立备份目录 `/opt/ziwei-backups/conversation-images/client-followup/20261011T153541Z-d07abe7c` 保存原官方包/metadata/bootstrap 与新的两库 before/after。完整性/FK通过，全部 pre-publication 主键保留，15 类正式稳定字段与控制端有界动态时间守卫通过。公开 HTTPS package/metadata/index/JS/CSS/bootstrap/health 再次全部通过 SHA/版本核验，正式 Windows PID 51880、global 7c2d47ab…、运行/磁盘配置 hash 与启动时间保持。

主站原始 manifest 另存 `publication-manifest-main.json`；当前 `publication-manifest.json` 指向新隔离安装根目录，`client-followup-result.json` 与 `client-followup-public-checks.json` 为本次证据。没有用新客户端 commit 冒充主站运行源码 commit，也没有把包发布称为用户正式 daemon 已升级。

第二个新客户端原生 QA action 的 result POST 已返回 200，随后测试器在读取较大的响应体时遇到原 30 秒超时。只读 SSH 通过 SQLite online backup 后离线查询精确 QA action，确认其已于 `2026-10-11T15:39:20.777Z` 持久化为 succeeded、error=null，runtime Codex、model gpt-6.1-sol，management MCP loaded=true。返回图片 `employee-generated.png` 为 image/png、1,217,037 B，实际解码 SHA256 `278e8cc8ec8aa10c143a864d617e4507e37a030f9e4acdfaa3d4427dadece7ea`；同一完成时间的助手消息附件大小和 SHA 完全一致。证据 `qa-native-action-cb00f542-readonly.json` 不含正文、Base64 或凭据，查询没有重跑模型或修改数据库。测试器提高只读请求超时并从精确终态恢复，整体验收结论仍由后续生产 UI 证据给出。

## 主 API 补充发布：响应图片去重

生产原生图片已完整保存，但响应 DTO 同时携带 raw JSON 与 parsed 图片，且会话 execution 再带一份 outputArtifacts。该 1.2 MB 图片的 result 响应达到 3,262,379 B，历史回读也重复传输。补充修复只改变公开 DTO：历史消息使用一份 canonical attachments，会话 execution 附件仅元数据，A2A 公开结果保留 parsed 字段并去掉重复 raw JSON；原数据库和执行输入保持。

协调者串行全量 **533/533、0 skipped/cancelled**、lint **71**、diff check 与独立 diff 复核后推送 `b9a5eb107bd8f36e133b7a6a58663fbebbd3b236`，明确提供没有模型/native 在途的执行窗口。发布侧从精确 archive 另跑串行全量 **533/533、0 skipped/cancelled**（111,191 ms）、lint **71**，source tar SHA256 `c5413d301202a87a86674019029e8d8dba40a6bbdc47c87e2692ba2a678cc985`。没有重新构建前端或打包/安装客户端。

备份 `/opt/ziwei-backups/conversation-images/main-api-followup/20261011T162046Z-aa1ef37d` 在切换前保存新的两库、签名、原 metadata/tgz/bootstrap、Nginx、旧 release/index 和对象文件副本。新目录 `/opt/ziwei/releases/b9a5eb1-api1` 从旧 release 复制完整 dist，并逐文件比较 bytes/SHA；原子 current 后只 restart 主 API 一次。新主 PID 167067、启动 `2026-10-11 16:20:50 UTC`、working directory 实际解析到新 release。控制/Nginx PID 和启动时间保持；本次 **0 rollback、0 Nginx reload、0 控制 restart、0 CLI publication、0 整库恢复、0 手机动作**。

新的快照都 integrity=ok/FK=0。全部 predeploy 主键、15 类 46 条正式稳定记录保持；36 条既有 A2A payload_json 逐字保持，3 条终态 QA action 与 6 条 QA message 所有原始列 row hash 前后全等。控制快照窗口 4,769 ms，只有已审核精确记录的两个 lease_until、一个 agent.last_seen 及其 terminal.last_heartbeat 更新；所有其他控制字段、主键与 schema 保持。正式 Windows PID 51880、global build、启动/命令 hash、运行配置 hash 与实际磁盘文件 hash 都保持，00:20:55 再次 ready=true；既有不存在的 legacy root/data 配置文件也保持不存在。

官方 metadata 的 commit/sourceBuild/clientBuild/package SHA/bytes 和 CLI publishedAt 保持 3c8b0b7，只将 mainSiteCommit 更新为实际 b9a5eb1，写 mainSitePublishedAt 与 `publicationScope=main-api-only`；这次 `clientOnlyPublication=false`、`mainSiteCommitUnchanged=false` 与主 API 更新一致。公开 health、metadata、tgz、index、JS/CSS 全部通过 SHA/身份核验，Nginx 16m 和 Windows bootstrap 保持。`publication-manifest.json` 仍指向原 3c 隔离实装 root，分别记录当前 mainSiteCommit/mainRelease；旧客户端 manifest 保存在 `publication-manifest-client-followup.json`。

独立证据为 `b9a5eb1-main-api-followup-manifest.json`、`b9a5eb1-main-api-followup-result.json`、`b9a5eb1-windows-main-api-followup-protection.json`，另有 `b9a5eb1-preserved-evidence.json` 记录七份原始文件的 SHA/bytes；fresh 原始日志与 UTF-8 副本位于 `main-api-followup-b9a5eb1-edeb5992`。构建准备阶段曾遇到 Windows PowerShell 中文路径旧编码与 npm notice stderr 处理；均在任何服务器服务动作前修正并保留记录，未将准备故障计作部署重启。后续整体验收继续使用原 QA 终态，不重跑已成功模型。

## 主 API 最后发布：终态 ACK 设备归属

聚焦复核发现既有终态 ACK 的 duplicate 分支在 `assertActionDevice` 之前返回，可向同工作区错设备暴露已完成结果。补丁只将设备归属校验移到终态分支之前，并新增认证 HTTP regression。协调者先红后绿验证并完成串行全量 **534/534、0 failed/skipped/cancelled**、lint **71**、diff check，推送 `3be8d5f6912989c27e3e92f6dc7886826bf50e0f`；只有 `backend/repository.mjs` 与新测试两文件改变。

发布侧再次精确 archive、隔离 npm ci、串行全量 **534/534**（113,303 ms）、lint **71**，source tar SHA256 `a20108be62c0443b7e8c7012dfcf682fd3a6e2bb07202da73cf2ebe9cdd5d9af`。前端源码、lock 和官方客户端 included sourceBuild `25eba314…` 全部保持；没有重新构建前端或发布客户端。候选先以 `executeAuthorized=false` 上传，等真实最大图片历史回读 finished、浏览器退出且没有模型/HTTP 在途后，才按协调者明确窗口切换。

新备份 `/opt/ziwei-backups/conversation-images/main-api-followup/20261011T165136Z-e5162810` 保存两库 before/after 和保护文件。实际目录 `/opt/ziwei/releases/3be8d5f-api1`，主 PID **167695**、启动 `2026-10-11 16:51:39 UTC`、active/NRestarts=0，实际 `/proc/PID/cwd` 指向新目录。本次主 API **1 restart、0 rollback**，Nginx/control/正式 Windows/CLI **0 restart/reload/publication**。12 条 QA action、24 条消息的全部原始列 hash 全等，45 条既有 A2A payload_json 字节全等；全部 predeploy 主键与15类46条正式稳定记录保持，两库完整性/FK通过。

控制快照窗口4232ms，仅4项已审核精确时间更新，其他列/行/schema保持；前端整个dist、Nginx16m、bootstrap、官方3c包、签名与持久路径保持。公开 health/metadata/package/index/assets全部匹配。线上 `backend/repository.mjs` raw SHA256 `ef608c8faeebedd5877f5d6d9725a3f38025e36dda8171c0bc8e69c58d010cb1` 与归档相同，metadata准确记录 mainSiteCommit=3be8d5f、client commit=3c8b0b7。独立证据使用 `3be8d5f-main-api-followup-{manifest,result}.json` 和 `3be8d5f-windows-main-api-followup-protection.json`，不会覆盖 b9 证据。

部署后的精确小 vision 终态 action 以原 QA 设备 ACK 返回200/duplicate、7,279 B、509ms；匿名请求401，管理 MCP loaded与输入 SHA保持。错设备由认证 HTTP regression覆盖，线上未新增第二设备。证据 `browser/production-terminal-ack-results.json`，探针没有重跑模型。

## 备份与部署保护

成功部署的独立备份目录：

`/opt/ziwei-backups/conversation-images/20261011T151106Z-39848f5d`

目录 0700，数据库和保护副本 0600。main/control 均用 SQLite online backup API、64 页批次取得一致性快照，离线 `integrity_check=ok`、`foreign_key_check=0`。目录内保留两库 before/after、原 Nginx、签名 key、旧 release、frontend index、官方 tgz、metadata、Windows bootstrap 和对象目录副本。保护比较在离线快照上执行，没有生产长读事务或整库恢复。

真正 before-QA 正式身份集合取自 22:01:52 的 `production-baseline.json`，SHA256 `569721b25d9e7062d468a6a8a51949ac46408dca9be247aa3709f5c7d6da2c0d`。22:11:14 的另一次快照已包含新 QA Owner，不能称为 before-QA 基线。部署前后所有 predeploy 主键都保留；15 类、46 条正式资源稳定字段保持。允许用户/设备正常心跳、last seen 等已列明的运行字段变化，新增正式资源不会被误判为删除。

原持久 data 与 .local 链接继续复用，签名身份保持。新 dist 保留了 58 个旧 hash assets，未覆盖同名不同内容文件。控制 release、手机包、Android 下载与 Windows bootstrap 保持原发布身份。

| 服务 | 成功部署后 PID | 状态 |
| --- | --- | --- |
| 当前主 API | 167695，启动 `2026-10-11 16:51:39 UTC` | active，NRestarts=0 |
| 控制 API | 134533，原启动时间保持 | active，NRestarts=0 |
| Nginx master | 737，原启动时间保持 | active，NRestarts=0 |
| 正式 Windows daemon | 51880，原启动时间保持 | ready，connected |

初始主站的成功 r3 切换只重启主 API 一次、Nginx reload 一次；连同前两次保护回退，初始阶段主 API 共执行五次 restart、Nginx 五次 reload。3c 客户端补充发布为0 restart/reload；b9和3be主 API 补充发布分别各执行一次主 API restart、0 Nginx reload。因此累计主 API **七次 restart**、Nginx **五次 reload**。控制端与正式 Windows daemon没有restart/stop/update，手机动作0；最终QA清理没有服务动作。

## 两次保护回退与实际动态字段

首轮 `/opt/ziwei/releases/65cef4b` 在严格控制全表原值比较时发现两个既有 Android `lease_until` 正常续租；r2 `/opt/ziwei/releases/65cef4b-r2` 进一步发现现有 node 与 terminal 心跳时间更新。两轮都自动回退旧 current、Nginx、公开 tgz/metadata，没有恢复数据库、删除 release 或扩大未知例外。失败目录与独立日志、快照均保留：

- 首轮备份：`/opt/ziwei-backups/conversation-images/20261011T145545Z-e6e9d495`。
- r2 备份：`/opt/ziwei-backups/conversation-images/20261011T150304Z-4d89bff1`。
- 无重启的 30 秒控制观测：`/opt/ziwei-backups/conversation-images/control-observations/20261011T150537Z-98cd584d`。

独立观测中 45 个控制表的 counts 全等、0 missing/added，只有七个已证实精确 row/field 的正常时间更新。原控制源码 `server/android-devices.mjs:209` 续租，`:321` heartbeat 更新 node last_seen，`:197` refresh 将关联 nodes 的最新 last_seen 写入 terminal last_heartbeat。其他 session、token hash、role、health、history、status、epoch 和所有稳定字段全等。

r3 仅对这组精确记录的时间更新开放有界比较，保持所有其他控制表/行/列和 schema 原值比较。实际运行两项白名单配置读得 `leaseMs=15000`、`heartbeatTimeoutMs=35000`，不输出其他 env。lease 要求整数、单调、session 非空全等；heartbeat 要求非空 ISO Z 毫秒时间、单调、落在本次快照窗口 ±1000ms，增量受 elapsed+有效 timeout+1000ms 限制；terminal after 时间还必须等于关联 nodes 最新 last_seen。实际守卫函数从部署文件 AST 提取，用观测 fixture 的正负 14 项测试全部通过。

成功 r3 两 control 快照间隔 3865ms，仅实际出现四项允许动态更新：两个 lease_until、一个 updater.last_seen 和其 terminal.last_heartbeat；其他控制列/schema 全等。证据字段为 `controlProtectedStableFieldsUnchanged` 和 `allowedDynamicFields`，没有宣称全表原始字节完全不变。

## 请求体与公开入口

实际 Express 仍为 `express.json({limit:'16mb'})`。只在原 `/a2a/` block 加入 `client_max_body_size 16m;`，与原 `/api/` 对齐；`nginx -t` 通过后 reload。Nginx 文件 SHA256 从 `faf170c39866d8c307ed68cc49d96cf7cc28dfac442e979d3f3d8c35cf494967` 变为 `21a955cdfaef8d16837671b20ec07ddcf4c7f61d0c1feea9c1885a4a3dedd231`，有效配置两条 route 都代理 `127.0.0.1:4178`、limit 16m。10 MiB decoded aggregate 图片约占 13,981,016 B Base64，metadata events 不携带图片 Base64；完整 body 仅正式 result 回传。最大请求生产验收由专门 QA 证据记录，配置推断不能冒充实测。

[公开主站](https://qzelynth.top/)与 healthz 返回 200；公开 index、JS/CSS 和官方 tgz 的 SHA 均与精确候选匹配。十个关键部署源码 raw-byte hash 与 Git archive source 完全一致。控制健康返回 200/ok。

[官方 release metadata](https://qzelynth.top/downloads/cli/release.json)、[官方包](https://qzelynth.top/downloads/cli/ziwei-latest.tgz)、[Windows 更新入口](https://qzelynth.top/downloads/cli/update-windows.ps1)均可 HTTPS 获取。原 bootstrap SHA256 `e78e39f3e1eeb9808ecd4ed32f2f856a82947f81e4ee2ca60f20383c766c332a` 保持。主站 r3 发布期间复核发现上一轮遗留 `clientOnlyPublication`、`mainSiteCommitUnchanged` 描述不符主站更新，已备份后原子修正为 false，写入实际 mainSiteCommit；该次修正不改变包 bytes/SHA/build 字段。后续 3c8b0b7 客户端补充发布设为 true；b9a5eb1 主 API 补充发布再次设为 false，当前 metadata 的主 API 和官方客户端版本分别记录。

## 正式 Windows 保持与用户更新条件

23:11:31 的只读复验及清理后2026-10-12 00:56:49最终复验均确认 daemon PID51880、bigtron、ready/connected，运行和global实装仍为 `7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64`，启动时间、命令hash、lifecycle配置hash、磁盘配置hash都保持。本轮新包仅在隔离prefix安装，未更新实际global，未启动新常驻daemon/监听端口。证据 `windows-final.json` 与 `windows-final-protection.json`。

仍存在既有环境差异：health.lifecycle 读到的 config hash 为 `7913bf1c…`、connected，但工具读取同路径磁盘 hash 为 `a633f988…`、disconnected、workspace/deviceId 空且没有 deviceToken。现有安全维护拒绝这种身份/hash 不一致；本轮不强停、不覆盖配置、不重配对。已准备私有 `windows-user-update-guard.ps1`，默认只读；用户原终端只有在真实文件/hash/身份与 ready daemon 全匹配后，才可显式 `-Execute` 调用既有安全 update 并跟踪返回的精确 resultFile。不匹配则保留原 PID。

## 回退与私有证据

初始旧主release `/opt/ziwei/releases/36d6bf1`、65cef4b-r3、b9a5eb1-api1和全部旧assets都保留。当前3be主API补丁的直接回退目标为 `/opt/ziwei/releases/b9a5eb1-api1`：原子切回current、只restart主API，并恢复本次备份的 `official-metadata.before`，使mainSiteCommit与实际旧源码一致；前端、Nginx、官方3c客户端包保持。初始发布的Nginx/包备份作为历史保留。继续使用当前data/.local，不能自动用旧数据库覆盖部署后新增的正式数据。SQLite快照完整性与离线比对已验收，不等于全站灾难恢复演练。

私有证据根目录为 `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解\.local\conversation-images\operations`，不进入 Git：

- `publication-manifest.json`、`publication-results.json`、`post-publication.json`、`deployment-result.json`。
- `build-65cef4b-63ab1f10/full-tests-fresh.log`、`lint-fresh.log`、`build-correspondence.json`。
- `control-observation-30s.json`、`control-guard-tests.json`、两轮 rollback investigation 与各自 stdout/stderr。
- `windows-baseline.json`、`windows-before-deploy.json`、`windows-after-deploy.json`、`metadata-description-correction.json`。

## 生产验收与精确 QA 收尾

实际隔离Windows官方3c客户端完成四次生产native成功：1440/390两视口分别纯图理解和文本+返回图，management MCP实际loaded，任务计数均0→0；图片预览、下载和刷新恢复通过。生产模型累计五次（保留最初一次握手failed、四次succeeded）加独立preflight一次；不把失败改记成功，不重跑恢复的成功动作。`browser/production-ui-results.json` 为2个双视口测试/4个succeeded的最终证据。

四份独立 `native-runtime/management-mcp-audit/*.jsonl` 各记录 initialize ok=true 与 tools/list ok=true，native receipts的toolCalls为空；本轮证明实际管理MCP初始化与列工具握手，没有tools/call或业务管理工具实际调用结论。四份JSONL及native输入/返回PNG/manifest保留。

`browser/production-resilience-results.json` finished `2026-10-11T16:49:00.123Z`、passed=true、12/12，7次隔离fixture、0模型/手机/正式daemon动作，pending/pageErrors/cleanupErrors均空。真实HTTPS验证单文件/aggregate 10MiB+1、伪PNG、错误MIME返回应用400且无部分message/action。最大10MiB合法图片的原始result JSON为22,327,040 B，经预算处理保留完整图片、截断文本/去diagnostics，最终请求15,728,639 B；POST/result实际200/15,732,492 B响应/472,349ms，随后公开历史GET200/15,882,777 B/355,579ms，图片SHA完整保留。大响应在本次公网链路传输很慢，验收证明完整性与成功，并未把耗时写成快速响应。

独立只读SQLite online backup→memory查询最大图action与关联助手：二者均 `qa-budget.png`、image/png、10,485,760 B，SHA256 `ec3e7c66a972161eca3c137d054aa9d3ab10d890eb088f40cf6bc10b79da4962`，与本机fixture纯算法重算一致。`qa-maximum-image-readonly.json`、`qa-maximum-image-expected.json` 不含正文/Base64/凭据；该查询不替代实际公开历史读取。

协调者确认所有浏览器/HTTP/模型结束后，重新读取本轮 `browser/qa-manifest.json`，精确匹配1个Owner/工作区/设备/员工、4会话、12action和24message。只读FK级联preview共214行，未与22:01 before-QA正式主键交集；执行前新备份 `/opt/ziwei-backups/conversation-images/qa-cleanup/20261011T165439Z-7ca7711f`，窄事务856.79ms。清理214条本轮QA及其级联行，workspace/user/session/member剩余0，所有当前非QA主键和15类正式稳定字段保持，主/控制schema与两库完整性/FK通过。

清理控制守卫用新before/after短快照2843ms，只出现1个已批准exact lease_until +3222ms；其他控制列/行/schema保持。服务PID/启动、完整dist、Nginx、官方包/metadata/bootstrap、签名和共享路径保持。旧QA cookie、deviceToken、管理capability在真实只读接口均返回401；capability到17:29Z才过期，核验时仍未过期。随后仅逐文件hash/realpath核验并unlink `browser/private-credentials.json`、`browser/private-owner-state.json`、`native-runtime/management-mcp-credentials/e199164ab177de6051207aa45ef7bef1d592ab402f9dc19109d4657037c5a267.json`，3文件均不存在；无递归删除、无正式HOME/global/SSH凭据操作。

本轮15份图片/脚本/manifest证据保留，文本扫描未发现这些真实QA token/password/cookie/capability残留。最终公开/本机核验19项通过，main3be/CLI3c、main PID167695、control134533/Nginx737保持，Windows51880在00:56:49仍ready且全部身份/config/global指纹保持。私有证据：`cleanup-preview.json`、`cleanup-results.json/md`、`qa-auth-revocation.json`、`local-qa-secret-cleanup-plan.json/results.json`、`windows-qa-cleanup-protection.json`、`windows-final-protection.json`、`final-readonly-health.json`。本次仅清理新隔离QA，没有重跑前一轮审计清理，没有恢复整库。
