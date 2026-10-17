# 手机功能候选受控集成与联调方案

日期：2026-10-17，Asia/Shanghai。当前结论为 `code_review_passed_integration_pending`。本文件仅记录方案；没有合入主发布树、部署 API/Windows、启动模拟器、重打包或发布 APK/二维码。产品源码继续冻结。知微历史 action 的缺失回执另案核查，本方案不能补足该回执。

## 固定输入与现有证据

| 输入 | 固定值与边界 |
| --- | --- |
| 主控已发布产品 | `4f26f450e6e1bcba6326fdaedd75937364eb5189`；当前 API 仍为原部署，候选 SHA 不是部署证明。 |
| 主控代码审查基线 | `8834e288d4afa4c2f90f638360a023a71176b377`，分支 `codex/v2-20261014-release`。其审查 JSON 已关闭 F1–F5。 |
| 当前主控文档头 | `8629091c2993e32625b25cfe7835805541286f4f`，连同 `29fcaf83cb95a0931a579af5d5b423164abb7ce1` 仅推进同一审查 JSON；主控已确认实际 push 成功。此前 GitHub TLS 暂时失败已恢复，不保留“29 未推送”的过时结论。后续如主控继续提交，以其最终指定的固定主树基线重新核对。 |
| 共享候选 | `20da8856beb7f008d8c3b85f65103f53b9deef19`，分支 `codex/mobile-notifications-contract`，已推送。 |
| Android 产品源 | `ab5045a23c814032937bf4b4143fac2fc9f6012b`；只引入 `mobile-manager/` 子树，其 Git tree 为 `fbb6cf70a26ee8cc72a9f81cedc3b0334c3074ff`。 |
| 准确 APK | `com.ziwei.manager`，code10 / `0.3.0-internal`，755846 bytes；SHA-256 `cc2d17f5f445c27e09d967c7f5993811410aa9ff6a8808457c86bf9b0523bcad`。 |
| 签名与资产 | signer SHA-256 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`；23 个打包资产匹配 manifest。没有物理手机验收声明。 |

主控 `8834e28` 的 `docs/qa/2026-10-17-mobile-features-candidate-review.json` 保留完整失败历史：最终定向 53/53、隔离 prelaunch 27/27；此前组合 95 项为 94 过、1 项既有 Mac fixture 的 3 秒 CLI version probe 超时，没有修改产品时限来消除它。不能将这次失败改写成全组合通过。

候选侧固定 `20da885` 的相关合同组合为 138/138 Node、12/12 Python。独立固定 archive 的 HTTP/SSE、实际零 TCP WS upgrade 101 与 5 个解码通知帧、原 F1 三类旧别名反例、DB proof 原字节保留通过。主控独立复核了 Cookie HTTP、真实 SSE 与 WS 共享事件源；实际 WS 帧是候选侧独立报告，不能称主控亲测帧。

关键证据均保留原目录，不用后续成功覆盖旧失败：

- 共享树 `.local/mobile-assignment-proof-read-review-20da885/20da885-result.json`：主控 F5 复审。
- 共享树 `.local/mobile-assignment-public-independent-20da8856/fixed-result.json` 与 `source-final-check.json`：候选侧独立复测。
- 共享树 `.local/mobile-assignment-public-review/result-20da885.json`：138/12 组合。
- Android 树 `.local/mobile-manager-code10-post-review-native-qa/result.json`、`evidence-manifest.json`：准确 APK 当前状态仍为 `partial_blocked_native_network`。

## 主树集成顺序

以下是交给主控的执行顺序，本轮没有执行这些步骤。

1. 由主控固定当时的主树 HEAD、现网 API revision、Windows 安装包/build 和回退源。保留当前主树未提交内容，不在正在发布的工作树试合；若基线继续前移，重新核对改动集合和主控合同。
2. 在隔离的集成分支以主控指定基线纳入完整 `20da885` 共享候选历史，不能只摘最后一个公开投影提交而遗漏可信 writer、权限和分页依赖。共同基线为 `a80322dc0eda1bb14ac7086178c8771cc11db2f4`；相对该基线，已核 `8834e28` 的 14 个改动路径与共享候选的 12 个路径无交集。此后至 `8629091` 仅推进原审查文档。
3. 集成共享候选后，相对固定主树只应新增下列 12 路径的候选变化；这些路径匹配 `20da885`，其余文件继续匹配主树。保留主树 `383d4cb` / `4f26f45` 的启动前密封证明、迟到回执轮询和同会话返回刷新；不能用候选整树覆盖主树。双方共同祖先已有 MCP `6666a63b46cd783d6a6537dd3295b37619ba4afa` 与移动投影 `9393dcb0aab1c7afeacf368c7205f300264fa69e`。

```text
backend/app.mjs
backend/mobile-group-action.mjs
backend/mobile-group-action.test.mjs
backend/mobile-notifications.mjs
backend/mobile-notifications.test.mjs
backend/repository.mjs
backend/task-assignment-binding.test.mjs
backend/task-assignment-public-view.test.mjs
src/hermes-native-bridge.py
src/hermes-native-contract.mjs
test/fixtures/hermes-native-groups-page.py
test/hermes-native-groups-page.test.mjs
```

4. 如同时收录 App 源，只从 `ab5045a` 纳入固定 `mobile-manager/` 子树，核对其 tree ID。Android 分支包含旧 backend/MCP 差异，不能整分支合入或复制整 checkout。指定配套文档为本方案、`2026-10-17-android-mobile-features-review-followup.md` 和原候选说明；不覆盖主控 HANDOFF、prelaunch 说明或审查 JSON。
5. 冻结新的集成 commit，记录父提交、差异清单与文件 SHA。对最终组合复核提醒/writer/公开投影、群组合同、移动读取、Hermes 分页及 prelaunch；prelaunch 27 项隔离运行，保留原 3 秒探针失败记录。已有候选测试通过不能替代最终集成源验证。当前 APK 不重打包；若后续 App 资产改变，必须形成新构建、新 hash 与独立准确包验收，不能沿用 cc2 的身份或证据。
6. 主控安排共享 API 与指定 Windows 受控更新，记录实际部署 revision/包 SHA 和启动回执，再进入下表联调。下载包已生成或主机上版本字符串变化都不算实际部署证明。

## 激活前的回退条件

当前 `fallbackPrepared=false`、`fallbackTested=false`。候选尚未激活时，可以放弃未上线的集成分支。首次启用新 writer 之前，必须准备并独立验证适合当前数据状态的回退源。

新版落库后直接整体退回旧 `4f26` 会让权威 `audit_events` 经旧 `listAudit` 重新公开 `assignmentBinding`。20da 新写的 notification 副本已脱敏；只有持久 notification 行本来含 proof 时，旧 raw/parsed/archive 才会再次暴露它，不能泛称所有新通知都泄露。旧 writer 本身仅发 `{taskId}`，没有重放历史事件，因此不声称整体回退后所有 SSE 都会泄露。

仅保留 20da 的 public-projection helpers、公开 listAudit/listNotifications/archive，以及 notification INSERT/onEvent 的 visible 副本，可以关闭这个公开字段问题。但它不是无条件的完整功能回退：旧 writer 不为实际改派写可信 marker；回退期间 A→B→A 后，重新启用新 feed 可能跳过无 marker 更新并复用早期 proof。

主控已采纳完整前向回退条件：必须保留可信 assignment create/实际改派 writer、SAVEPOINT 与原子事件语义、未知/未分配的失效 marker，再保留公开投影；feed 保持当前隐私判定，或明确不可用。仅公开投影的旧版补丁只关闭公开泄露，不能称完整安全 fallback。验证需在隔离数据中覆盖新源→回退源→恢复新源的往返，包含实际 A→B→A、歧义/取消分配、最新无效 marker、原子失败与延迟事件、公开 raw/parsed 不泄露、原证明不可被错误复用。以上均为未实施、未验过的回退设计，不是已制作的补丁；主控 `8629091` 已记录相同发布门槛。

回退保留业务数据库、权威审计、聊天、原 Profile/HOME 和不确定执行记录；不恢复旧库、清洗 proof 或补造执行回执。

## 真实联调前置

主控在执行前记录实际 API revision、Windows 设备/build、Android 设备/系统版本、工作区、授权账号角色、两位原员工及各自原 conversation ID。复用已有授权范围；实际目标尚未选定时停在准备阶段，不把空白项当默认目标。账号持有人在设备内登录，不输出或提取密码、Cookie、私有数据库。

准确 APK 固定连接 `https://qzelynth.top`；设备须通过正常 DNS/TLS 到达正式源。此前私有模拟器 code9 与 code10 均遇 Chromium TLS `-100`，主机匿名读取 401 只能证明主机链路，不能证明 Android 联网。不能关闭 TLS 校验、硬编码域名 IP、改为 mock 源，或用旧 `85fdb9…` 成功截图代替 cc2。

若主控安排新的 Mac 本地监听、ADB 或私有模拟器，先执行端口中心 `registry.py list`，按同用途复用或 allocate/register，再启动并 check；临时服务结束后停止并 release。入口为 `/Users/zhangjie/Documents/Codex/tools/port-registry/registry.py`。不借用其他项目端口；旧 PID59582 与 267/268/271 保留，不作为本方案待清理对象。优先私有完整 COW 克隆并核源 AVD 不变。

## 共享 API、Windows 与准确 APK 验收

| 顺序 | 操作与通过证据 | 未通过的处理 |
| --- | --- | --- |
| 1. 覆盖安装 | 核精确 APK hash、包名、签名、版本、23 assets；保留原首次安装时间、会话与本机数据。 | 包不符或需要卸载/清数据才可安装则停止；安装成功不算联网通过。 |
| 2. 原聊天和本机功能 | 两位原员工均打开原主会话，核 header、conversation ID、既有正文/图片；跨两轮正常刷新及一次后台恢复。输入不发送的本机文字草稿，返回、重开后核原文与账号/员工隔离；验证置顶、已加载消息搜索定位和群入口。 | TLS、历史读取、会话身份或草稿异常记失败；不新建会话替代原会话。GET 等待可达 60 秒，同步失败不能发 Stop 或自动重发。可见消息已读沿用既有行为并记录。 |
| 3. 提醒 API 和权限 | 正常读取 `/api/workspaces/{slug}/mobile/notifications`，核 schema、账号/工作区、游标与有界响应。可见卡片点击先 fresh resolve；用已获授权的 owner/member 样本核私有待办 member 隐藏/404、owner 可见，以及公开审计/通知不含 proof。旧非空负责人无证明时隐藏提醒属预期，原任务仍保留。 | 404、5xx、schema/身份错误、权限失败仍导航均停止；没有合法样本只记未证明，不在业务库临时造私有任务补样本。 |
| 4. Windows 分页能力 | 核实际已安装 build 含新 JS contract/Python bridge。schemaVersion 2 `groups.read` 接受 `groupId/limit/afterSeq`，返回 `pagedRead:true` 与完整 pagination，`decision/plan:null`，只调用一次有界 `read_events`。每页 30 条，成员逻辑 `profile=member_id`，不能用物理 runtime_profile 代替。 | 不能猜最低版本号；仅更新 revision 字符串不算有能力。旧回执不分页时保升级门禁，不退回全量日志或 planner。 |
| 5. 原生群记录 | 使用主控指定且已授权的员工和既有 room。群 list/read 会 POST native action 到 Windows，并非纯 HTTP GET；记录限定读取次数、原 actionId、第一页及下一页，随后只 GET 原 action。核准确成员、顺序、分页及持久群记录。 | 未指定实际 room 时只验入口；不足一页数据不能声称续页已通过。未知回执不重派；禁止为补样本创建业务群。 |
| 6. 群创建与协作 | 如要发布真实发送能力，由主控在已授权的专用验收员工/room 执行单次最小协作，记录原请求 ID、终态和持久消息。创建并发送会启动协作，不能把原生只读分页成功当作协作执行成功。 | 没有合适的授权验收目标则保持真实发送未验收，不使用生产员工正在执行的工作补样本；结果未知只查询原请求，不新建标识重发。 |
| 7. 旧 host 门禁 | 用已有合法旧回执或指定的一次读取建立升级门禁，验证返回、新群、重选、重启/同账号再登录后仍阻止 collaboration POST（计数 0）。只有当前绑定下新鲜分页成功可清除。 | 不降级真实电脑制造样本；只改设备/Profile/revision 不清门禁。无真实样本则记录未证明，不能以 mock 通过代替。 |
| 8. 通知订阅 | Android13+ 用户点击开启后正常申请权限；baseline GET 成功且身份匹配才显示 enabled；记录该包只有一个 15 分钟 Job。首次基线旧事件不发通知，拒绝权限仍可用 App 内提醒。 | 服务失败却显示开启、重复 Job 或跨账号订阅均失败。当前线上尚无已证明的成功订阅，不用过去权限弹窗截图代替。 |
| 9. 后台送达和点击 | 使用 baseline 后自然出现的合法新事件；退后台但不 force-stop，记录实际 Job 执行、增量读取、系统通知 event ID。点击先 baseline 核身份、消费一次性目标，再 fresh resolve，打开精确原 chat/task。 | 无新事件或观察窗无送达只记未证明，不能承诺即时推送。手动诊断触发与自然调度分别记录；不为了 QA 改派任务或发送业务。缓存目标直接导航、错会话/跨账号均失败。 |
| 10. 关闭和恢复 | 显式关闭撤销 Job、通知与目标；已授权的失效会话/账号切换样本不得让迟到回执恢复旧订阅。重启手机后打开 App 恢复单个任务。 | 不为制造撤权案例改动真实员工权限；没有样本则未证明。禁止把需要再次打开 App 的恢复称常驻即时推送。 |

通知是用户主动开启、约 15 分钟由系统安排的只读检查，可能延迟；不包含员工群/@即时推送承诺。端到端联调不会为读取超时自动停止员工，不自动重试发送、转发、保存或协作。

每个真实步骤记录准确组合、去敏截图/路径、event/action/room/conversation 对应、时间与通过/失败/未证明。证据文件不含凭据和完整私密正文。若发现新的身份、权限或未知写入问题，停在原请求核查，保留错误与回执，不用空数据或新请求掩盖失败。

只有最终集成源验证、适合数据状态的回退源、实际 API/Windows 能力与准确 APK 正常联网及上述发布功能的真实验收都满足后，主控才可决定公开 APK 和二维码；当前没有放行。
