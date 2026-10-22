# 失败执行自动收尾

更新：2026-10-21。源码已先推 GitHub；服务端、网页、官方客户端和 Android code16 已发布。李金晋电脑仍运行旧客户端，卡在远程升级的旧版隔离计数；已要求一次外部官方更新。员工恢复与真实模型连通性尚未通过，不能据此认定闲鱼已恢复。

## 用户可见行为

- 普通失败显示“失败”。新产生且执行结果未确认的 Hermes Bot 失败，由服务端自动建立独立收尾记录：本轮保持失败，运行电脑自动清理与归档，确认后恢复接收新任务。
- 等待电脑处理时，网页显示“失败，正在自动收尾”；电脑离线时显示“失败，等待电脑连接”。用户可以保留下一条草稿，原电脑归档确认前不派发新执行。
- 历史已经失败、仍占用当前 Bot 的记录，在主聊天和运行记录提供“结束本次执行”按钮。请求绑定原执行 ID、当前配置版本和控制版本，使用稳定幂等标识；随后读回服务器状态，不把 HTTP 成功当作原执行成功。
- 归档后显示“失败 · 已结束本次执行”。原始失败、聊天、业务结果及退出证据保持原样；未知业务不会变成成功，不会自动重跑旧任务，也不要求用户手动核对电脑进程。

## 实现边界

| 层 | 入口 | 约束 |
| --- | --- | --- |
| 启动前网络故障 | `src/runtime-launch-evidence.mjs`、`src/local-action.mjs`、`src/daemon.mjs` | 最终 Bot 启动准入请求超时、断网、异常响应或取消，只有真正经过宿主 `beforeSpawn` 边界的内部凭证才能证明未启动。请求内容自报或普通异常不能伪造此证明。已注册监督或可能已启动的进程仍走原进程树清理。 |
| 服务端收尾 | `backend/bot-failure-finalization.mjs`、`src/bot-failure-finalization-contract.mjs` | 独立记录 `awaiting_client` / `client_archived`，保留原失败；原电脑确认前，新执行明确拒绝准入。工作区、员工、设备、Profile、版本、原失败内容和配对凭证均需匹配。 |
| 原电脑归档 | `src/client-failed-action-finalization.mjs`、`daemon/ziwei_user.mjs` | 处理原电脑的精确收尾请求和本地记录；不重新执行原业务，不清空其它员工的任务。客户端维护与重启可继续处理同一收尾。 |
| 网页 | `frontend/src/bot-failure-finalization.mjs`、`frontend/src/App.vue`、`frontend/src/components/BotMainChat.vue`、`frontend/src/bot-workbench.js` | 以服务端顶层独立记录展示状态，拒绝把结果字段或进度事件冒充归档确认。轮询读回电脑归档状态，保留草稿，拒绝跨员工晚响应覆盖。 |

网页接口为 `GET/POST /api/workspaces/:slug/bots/:id/failure-finalization`。POST 包含 `expectedActionId`、`expectedRevision`、`expectedControlEpoch`、`acknowledgeUncertain: true`、`idempotencyKey`。这是结束失败执行的独立处置，不是补造模型回复或进程退出证据。

Android 管理 App 在独立分支。服务端保留并投射收尾字段，不代表旧 APK 已识别这些字段；本次网页适配不能替代 Android UI 验收。

## 验证记录

- 启动前准入、网络失败、取消及已有监督边界：68 项通过，0 失败、0 跳过。命令如下。
- 网页收尾及相关状态回归：76 项通过，0 失败、0 跳过；其中新增收尾测试 11 项，覆盖实际 App 请求函数、组件状态与 Enter 发送、幂等请求、丢响应不重试、跨员工响应隔离、归档不伪造成功、客户端确认后恢复发送。
- 网页分页、主聊天、草稿、Creator 和工作台读取回归：75 项通过，0 失败、0 跳过。与上一组存在重复，不能相加为独立测试总数。
- 后端定向 151 项、客户端恢复 126 项分别由对应实现代理报告通过，发布主任务继续复核集成结果；这些数字与上述组别也不合并计数。
- `node scripts/lint.mjs` 通过，236 个源码文件；`git diff --check` 通过；`npm run build` 通过，无本地监听服务。

```sh
node --test --test-concurrency=1 \
  test/bot-start-network-prelaunch.test.mjs \
  test/bot-admission-prelaunch.test.mjs \
  test/daemon-runtime-failure-evidence.test.mjs \
  test/daemon-admission-rejection.test.mjs

node --test --test-concurrency=1 \
  frontend/src/bot-failure-finalization.test.mjs \
  frontend/src/bot-api.test.mjs \
  frontend/src/bot-stop-recovery.test.mjs \
  frontend/src/bot-workbench.test.mjs \
  frontend/src/historical-prelaunch-recovery.test.mjs \
  frontend/src/operator-force-abandon-recovery.test.mjs \
  frontend/src/conversation-execution-state.test.mjs
```

上述测试使用模拟网络、组件计算与内存服务端请求，不调用真实模型、不操作手机、不重放员工业务。正式环境仍需分别核验：GitHub 源码、服务端部署、客户端下载内容、原电脑安装版本、客户端归档回执及后续正常准入。

## 2026-10-21 正式发布与旧客户端首次装入边界

- 产品源码 `1b9dbe40f4940a6b8105a34a670ed7094db4c3ea` 已核对推送至 `main`、`codex/remote-client-upgrade`、`codex/v2-20261014-release`，随后发布至新服务器的 `ziwei-workspace-api.service`。当前代码目录为 `/opt/ziwei/releases/failed-finalization-1b9dbe40f494-53492a2b/v2`。
- `/healthz` 返回 `ok: true / ziwei-api`；正式网页两个新构建资产与本机构建字节一致。工作区数据库设备号/inode保持，未恢复旧库。生态服务、中控和 Nginx 未重启或替换。继承现场 Node24.22 和既有 `db.mjs` 的 WAL/FULL 设置，未用主仓旧文件覆盖。
- 首次发布因25秒健康窗口不足回退；实际旧服务曾127秒才开始监听。按实际情况采用180秒窗口后发布通过。回退仅切代码，未回退业务数据。
- 官方客户端下载 build `f96559041d637cb5d870c3f3d2ec93745d375f323a49edb3d3738b07fd4bb96e`，归档SHA256 `c3f70896739751c229df06d345b2ac5c33c6802c838edf274a13a1116b87963b`，1,266,787字节。外部完整下载与 release 元数据一致。Mac实际冷缓存离线安装和71包依赖检查通过；Linux候选应用factory、12项后端测试、包内CLI/依赖/build运行检查通过。Linux npm冷安装停在配置加载后，未记为通过；Windows实机安装仍待验收。
- 闲鱼原失败 `action_a9e24edf-afc2-42dd-b779-6cb3629ef94c` 经正常Owner API建立收尾，r7/e25→r7/e26、active action清空，状态 `awaiting_client`。原status/result/error/ACK和完成时间读回不变；没有重放业务。`awaiting_client` 仍阻止新业务，不能记成员工已恢复。
- **实际旧156874客户端存在首次装入死锁**：`remoteUpdateIdle` 虽未直接查隔离，但 `actionScheduler.activeCount` 包含 `quarantinedActionIds`。因此旧任务让远程升级永久 `waiting_idle`，新候选恢复入口尚未获得运行机会。正常停止没有该旧动作的监督句柄，不能靠服务端伪造ACK解除。此设备需从外部执行一次新版官方 `update-windows.ps1`，让候选恢复入口处理记录并装入新版；不再让用户查PID或改文件。之后以新build认证心跳、`client_archived` ACK和短模型回复分别验收。不要重复创建远升意图或声称已自动远升成功。
- Android管理App `0.5.4-internal / code16` 已在[正式预发布页](https://github.com/jinjinli226-netizen/ziwei/releases/tag/android-manager-v0.5.4-internal)发布，产品tag对应 `6a857c54c197fc774e5549aa4ffcdca6779afc7b`。原签名、29资产、匿名完整APK及manifest核验通过；APK SHA256 `1d1cb8269472ebaa51ddd59ba8edb52770d5aae37a24323ed2c21ef5c9576366`。72项相关测试、266项JVM检查通过，真机未安装验收。旧APK不识别新收尾字段，须更新；未覆盖被控Agent/Updater下载目录。

正式分层回执见[QA](../qa/2026-10-21-failed-execution-finalization-release.json)。以上发布结论不代表Windows安装、客户端归档或员工业务完成。

已用正式服务端真实 mobile 投影运行已发布Android16的model、render及controller：awaiting_client/在线离线文案、ACK前发送阻断、历史列表缺失时Bot顶层receipt兜底均通过，0次业务发送，原failed/uncertain/processExit:null保留。此项是生产投影加真实App代码的验证，不能代替真机安装。

## 外部更新器 recover_history 超时补丁（2026-10-21）

用户已正确执行外部官方更新，仍得到 `recover_history / OPERATION_TIMEOUT`，不是命令拼接问题。原电脑仍上报156874，收尾ACK尚未收到，不能记为更新或恢复成功。

只读核对生产工作区服务保持397608/1b9源码；同进程近期已完成HTTP请求的上游等待有8.8、10.9、17.7、19.8秒，超过恢复读取原有8秒单次上限。生产隐私日志不记URI，因此这些数字不能证明某条就是本次恢复请求；原错误也没有步骤字段，无法事后准确区分服务器读取、本机健康、暂停或进程观察。旧包未知POST接口已用精确回调的无监听复现确认立即404，不等待请求体。

本次补丁只调整官方电脑包的恢复流程：

- 只读授权GET最多三次，分别等待8/16/24秒，另有100/200毫秒退避，总等待预算约48.3秒；仅对超时、连接瞬断和408/429/502/503/504重试。403、非法JSON、记录不符不重试。读取响应体也纳入同一截止时间。
- 本机通知、暂停与归档ACK不自动重复提交；请求暂停后即使响应或响应体超时，也会尝试恢复同一已核验实例的连接。不能把超时当作客户端不存在，不能扩大杀进程范围。
- 更新结果、最终错误与日志兜底保留闭合枚举的phase/step、1–3次attempt和有限elapsedMs；不输出URL、凭据、响应正文或原始错误。清理后的恢复请求不会覆盖原失败步骤，日志写入失败不再中断已经完成的归档。
- 62项相关恢复/原始归档/dispatcher/锁与诊断测试通过，1项Windows原生测试按平台跳过；包含报头/响应体超时、最终attempt、递增预算、403不重试、ACK不重试、暂停部分成功后恢复、原步骤保留及日志失败。它们使用模拟网络及临时文件，不代替Windows现场更新。

该补丁不改服务端、网页或Android，正式客户端下载发布与电脑实际安装继续分开记录。首次实际超时的精确步骤仍未知，后续须依据新版回执，不能将有限重试直接称为员工已恢复。

超时补丁源码 `c67d2cd00fc0526f2c2da3528a220d03263fa143` 已先推三条接续引用，随后仅发布官方电脑包。客户端下载build `b6261c0c383b03ba419312e8b116081c72162e6469acb4e4f80277e06d51dae3`，SHA256 `570ae5c333280a61d0c9fe0fc234155561331cb08cde5ee74142e3ba72cd7ee3`，1,268,383字节；外部完整下载一致，Mac冷安装71包及Linux包内实际CLI/build验证通过。另12项更新器兼容测试通过，lint238源码文件通过。API仍为原1b9目录和397608进程，其它下载、数据、网页、Android保持；这次超时补丁无需再升级手机App。Windows实际更新、归档ACK及短模型回复仍待用户装入新包后核验，不能将下载发布当实机恢复。见[本次QA](../qa/2026-10-21-client-recovery-timeout-fix.json)。

## 2026-10-21 旧健康计数与恢复 BUSY 兼容

用户确认本次是新任务 `update-5daf1875-2269-45c9-90b9-48e87ffb1e76`，在 `current_health / local_health`、第1次、270ms返回 `FAILURE_FINALIZATION_BUSY`。这已不同于上次超时，但原判定把多项条件合并，不能从提示反推是哪项失败，更不能断言正在运行其它员工。已请求一次只读健康摘要，现场具体命中仍待回读。

独立复现使用旧156874正式包原始Dispatcher、Delivery、Scheduler、证据scanner和真实healthPayload（函数与当前源码一致，归一化SHA256为 `ccd5b99acc2a029a2cc5c717abb8440b9dc2f9664666ff89b55489de8ab903b8`），不启动daemon、监听或外网请求，不重放业务。确认以下缺陷：

- 已审计保留的历史 `result_pending` / `blocked` 仍计入旧health。恢复入口只计算本轮授权主体，导致即使没有未授权在途动作也被误拒。修复从同次scanner输出中精确取已被审计消除的 `DELIVERY_NOT_DRAINED` 文件，排除本轮主体，并在源文件哈希匹配后读取实际状态计算待投递/阻塞数。未审计、损坏、额外在途、篡改历史不能贡献额度；不靠泛化retained计数放行。
- `lifecycle.managedAuxiliaryCount` 是动态数；排空1→0不应当作启动代次变化。比较仍固定PID/build/nonce/root/config哈希/runtime目录/启动时间等原有字段，仅移除该动态数，并单独要求当前辅助数为0、Gateway安全且workers为空。
- 原生句柄程序不变，仍在停止边界重读精确计数、启动身份与所有源快照/目录，并只清理已持有实例及精确后代。原失败root/tree未知不会变成确认退出，历史业务不会重发。

新增12项旧真实health回归、native输入快照及负例；另用旧官方包6种矩阵验证，包括历史pending/blocked/confirmed、动态辅助排空及本轮主体也属于已审计历史时的两种排重。业务执行次数均为0。旧兼容测试中解析单行函数的过期测试已改为调用实际 `createHistoricalUpdateRecoveryEntry` 工厂。`scripts/client-update.mjs` 仅输出闭合FF规则及有界整数计数，终态文件和旧日志回读保持同一脱敏字段；不输出原始健康、路径、Token或任意异常文本。BUSY及transport文案不再声称存在其它员工或保证旧daemon会自动重试。

本节先记录源码验证。正式包发布、实际Windows新build心跳、client_archived归档和后续真实模型短回复需分别核对；服务端/UI/Android无需因这两处客户端兼容修改重发。

源码 `2e731c9c141a2db1c035f5f89f7d86354fb6cc35` 已先推三条接续引用后，仅发布官方客户端build `d3d8f25b9d429192e54adb911484476fe41fffa072956a45bf4667bd9bdf2878`，包SHA256 `c5f690b838da2d22b5df13ae07de898033739f4f60d7b5953a6c5e33f7e9deb6`，1,269,465字节，完整公开下载与清单匹配。只叠加两个运行文件及包描述，所有其它混合生产包字节和依赖保留。75项恢复/诊断、97项历史/更新兼容通过，Windows原生1项平台跳过；lint238、Mac冷安装71包、Linux实际包内CLI/build和独立审查通过。没有本地监听服务，API原进程397608、数据库、其它下载和Android保持。

发布后通过普通Owner API回读：电脑在线仍156874，目标已是d3d8f25；闲鱼active r7/e26、无active action，但独立收尾仍awaiting_client，原失败各字段不变，原远程升级意图保持cancelled。未发新升级意图或模型/业务任务。现场具体健康规则、实际装入、归档ACK与真实模型短回复仍未完成，先等待已请求的只读本机健康摘要，不要求用户再次盲更新。详见[本次QA](../qa/2026-10-21-client-recovery-legacy-health-fix.json)。

## 2026-10-22 Windows实际装入与真实接口验收

用户执行外部更新并启动后，普通Owner API已确认在线新build d3d8f25与官方目标一致；闲鱼原a9失败在 `2026-10-22T01:23:35.507Z`（北京时间09:23:35）获得原电脑client_archived确认，原失败status/result/error/ACK/完成时间均与发布前快照一致，原执行退出仍unknown/unobservable。旧远程意图保持cancelled，本次是外部更新完成后的独立心跳证明。未再需要用户读取本机健康记录。

首条新短测 `action_8d3d4cd2-dc8e-40b2-9b4b-0577c0abd2be` 因bot-start准入10秒超时失败，可信prelaunch为spawnAttempted:false/launched:false/rootPid:null/treeConfirmed:true，正常收尾且未再隔离。错误没有HTTP status，表明fetch尚未完成取得Response，不能从总执行耗时或没有匹配日志指认服务器处理耗时或根本网络原因。

确认电脑新鲜在线、员工active无占位且精确绑定保持后，仅新建第二条短测 `action_329b86f6-6902-42b9-bbf8-76af08435a4d`，没有复活首条失败。实际原Hermes/Profile/session/gpt-6.1-sol/max请求返回HTTP429使用额度上限；原生reasoning请求边界matched，CLI/root退出1、tree确认、activeProcesses:0，无后台保留。两MCP工具调用数组为空，未声称完整原生工具调用审计。原生边界requests:6不等于已证明6次HTTP请求。没有预期短答，不能标记模型验收成功，也不再继续发请求。

最终回读闲鱼active r7/e26、active action为空、failureFinalization为空，旧原失败reconciliationRequired:false，最新429保持failed，无待核实锁。升级及原失败归档已验，后续模型回复仍受当前订阅额度限制；未改凭据或产品源码、未重新部署、未派发店铺/手机业务。下次无需再次更新客户端，等额度恢复或用户选择有额度的授权后再验证回复。脱敏证据见[Windows现场QA](../qa/2026-10-22-failure-finalization-windows-live.json)。
