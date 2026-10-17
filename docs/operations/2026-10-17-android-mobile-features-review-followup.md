# 手机功能候选：主控负例复审后续

日期：2026-10-17。状态：`code_review_passed_integration_pending`，仍不可发布。主控产品源 `4f26f450`、API `9393` 与交接/审查文档均未由本候选覆盖。主控已 push `8834e28` 关闭 F1–F5，后续 `29fcaf8`、`8629091` 仅补充发布前回退条件且已推送。所有修复仍仅在两条候选分支，未合入主发布树、未部署、未公开 APK 或新版二维码。后续步骤见 [受控集成与联调方案](2026-10-17-mobile-features-controlled-integration-plan.md)。

## 三项已闭环的群组问题

App 产品源 `ab5045a23c814032937bf4b4143fac2fc9f6012b`：旧电脑分页不兼容错误独立于页面 phase 保存，按账号、工作区、负责员工隔离，记录来源电脑、Profile、ownership 和 revision。返回、新建群、重选、重开、重建控制器或登出再登录都不会将已知不支持视为支持。同一员工仅修改版本或电脑/Profile 也不当成升级证明；只有当前绑定下新鲜、匹配且成功的分页读取才清除负能力。另一位经新鲜读取核实的负责员工使用独立门禁。

即使能力记录持久化写失败，当前 App 的账号隔离负能力内存仍跨登出保留，不会被新建群清掉。能力记录不含正文、凭据或任务结果。损坏记录阻止发送，成功读取可重新核实。主控原 `旧 host 读取→返回→新群→选成员→发送` 负例现为 POST 0；另补存储失败后登出绕过的负例。群组 29 项测试、App 全套 387 项测试及 320/390px 浏览器状态机回归通过；浏览器即使强行去掉发送按钮 disabled，控制器仍不派发。

共享源 `25713ab1c38264d458d6e3f05e2627cb36056101`：新 `/api/workspaces/:slug/actions/:id` 无 view、mobile、未知或多重 view 参数均先核对相同群组成员权限。无权查看私密成员时不返回完整群日志；授权通过的非手机格式仍保留原完整响应。原生群成员逻辑 Profile 必须等于员工 ID；handle 若有必须一致，target 若有只能是同一逻辑 Profile 的 local 目标。原 request targets 的正式结构与物理 runtime_profile 不混淆。24 项群测试、47 项相关回归以及主控固定 archive 的 66 次 HTTP 断言通过。

主控已确认以上三项闭环，未因它们扩大默认执行、停止或身份协议。

## 提醒负责人绑定的收紧

首轮仅按当前员工/成员 ID 与删除审计推断的 `d6fbfbb` 已被主控负例否决：员工的历史名称可以恰等于另一实体的 ID，改名后当前名称检查失效。因此不能仅凭字符串看起来像现有 ID 就追认旧任务身份。

最终方案仅在现有仓库写边界生成可信 assignment 绑定：新建任务，或实际持久化的 assignee 值改变时，在已有 `task.created` / `task.updated` 审计 payload 中附服务器解析的类型、实体 ID、工作区、任务 ID 和实际持久值的摘要。没有新增表或字段，复用原审计动作与通知行，不增加额外通知。客户端传来的证明字段不被接受；歧义、未知或取消分配也写相应标记，不能回退捡取更早成功证明。

读请求、标题、日期、状态和同值完整 DTO 保存都不回填；旧网页保存会携带未改变的 assignee，因此仅字段存在不构成重新分配。旧非空负责人没有可信证明时不进入移动提醒，原任务及已读状态不变。旧待办仍留在原任务列表，普通保存不会恢复提醒，需要在任务管理中实际重新分配负责人。新任务或真实重新分配的绑定每次仍核对当前实体权限；显示名称不能替代身份。

任务 assignee 的生产写路径已盘点：session/external/MCP 创建及 A2A 创建收敛于 `repository.createTask`；任务 PATCH 收敛于 `updateTask`。执行、状态切换、自动化和原生 Kanban 不另写该列。绑定审计不声称识别绕开所有仓库写路径且无任何痕迹的外部 SQL 复原。

可信绑定冻结提交 `113355be748f35fa50f3798142521a97743a48b3`，仅修改 repository、移动提醒和两份测试。新创建或实际改派时查询完整当前实体候选，名称与另一实体 ID 冲突、重复身份或未知对象都记 unresolved；不会优先猜 ID。读取取最新显式 marker（包括 null、malformed、unresolved），验证 schema、工作区、task、持久值摘要后只按该实体当前权限核对；不再用现在的同名对象解释历史值。SQL 只返回有预算的负责人及证明窄列，不搬整份任务、审计或执行结果。

提醒 43 项、写入/回滚/template defer 5 项及相关 Hermes 任务、management 默认和版本保护的纯内存回归共 76 项通过。扩大检查的旧通用 repository 14 项中有 3 项环境/旧预期失败，已在原 `d6fbfbb` 的隔离 Git archive 复现完全相同的 11/14，涉及 agent-card provider 与本机 `ziwei-aigc` profile；没有修改旧测试或把它们算作全通过。基线日志位于共享树 `.local/mobile-backend-review-final/repository-d6-baseline.log`。

固定 `113355be` 的最终联合回归为 **133/133 Node、12/12 Python**，无失败或跳过。独立审计另有 **20/20** 固定源用例及 **48/48** 通知/写入用例通过，执行前后运行时文件 SHA 一致。原主控三种旧名称恰等于 member ID、user ID、另一公开员工 ID 的负例，经过改名和删除后均不能在 list/resolve 泄露；新的人类/员工可信绑定、未分配、实时权限与设备撤权、实际重分配、最新无效 marker、伪造证明和同值保存均已覆盖。

可信绑定原问题的证据位于共享树 `.local/mobile-backend-review-final/trusted-assignment-review.json`、`trusted-assignment-combined.log` 和 `.local/mobile-assignment-independent-audit/review-final-113355be748f.json`。本结论限定于已盘点的两个生产写入口；不宣称能检测绕过仓库及全部审计的无痕外部 SQL 复原。本项未由 `d6fbfbb` 的旧通过结论替代。主控已确认 `113355be748f35fa50f3798142521a97743a48b3` 关闭原四项问题，并在未合入的 archive 组合上通过 144 项 Node、12 项 Python；后续发现的新增公开关联问题与修复见下一节。

## 内部归属证明的公开读取投影

主控固定 `113355be` 用真实 member Cookie 的内存 HTTP/SSE 实证发现新增 P1：私有员工在员工列表隐藏、详情 404，任务负责人仅为名称且没有执行，但新增 `assignmentBinding` 经审计、旧通知的 raw/parsed 两份 payload 和实时推送公开了员工与任务的类型关联。原四项归属、群组问题的闭环仍有效；本项是新 writer 的内部证明进入旧公共事件载荷造成的独立问题。原负例保存在共享树 `.local/mobile-assignment-proof-read-review-113355b/113355b-result.json`，没有被修复后结果覆盖。

窄修共享源 `20da8856beb7f008d8c3b85f65103f53b9deef19` 仅修改 repository 与两份测试。权威 `audit_events` 中的证明保持原值，供移动提醒内部校验。新通知存储、即时及所有延迟 `onEvent` 使用公开副本；SSE 与 WebSocket 共享该事件投影。公开 `listAudit`、`listNotifications`、通知归档与恢复对旧记录统一剥离 `task.created` / `task.updated` 顶层新增 `assignmentBinding`，同时清理 raw `payload_json` 和 parsed `payload`。原 `taskId`、通知计数、普通任务响应、其他已有字段与非 task 事件不变；原本没有该字段的 raw JSON 保持字节不变。没有重构全站审计权限、清洗权威历史数据库或改变移动提醒的归属判定。

固定 `20da885` 的通知、写入和公开边界回归为 53/53；相关合同组合为 **138/138 Node、12/12 Python**，无失败或跳过。覆盖真实 member Cookie 的审计、通知双份载荷、归档/恢复、read、SSE，以及历史不同 JSON 类型的证明、旧字节与其他字段、即时和模板延迟/回滚事件。数据库证明仍保留，owner 的移动待办可见、member 列表隐藏且 resolve 404。证据为共享树 `.local/mobile-assignment-public-review/result-20da885.json` 与 `combined-20da885.log`。

独立固定 Git archive 复测的 8 组检查和 53/53 现有测试通过：原主控 member Cookie 反例已反向断言关闭；HTTP/SSE 200 及真实零 TCP WebSocket upgrade 101 后解码的 5 个任务通知帧均无证明，即时/模板延迟与回滚均核对。历史双份通知、归档恢复、原 F1 三组 ID 别名在改名和硬删除前后的隐藏与 404、可信新成员待办 200、私有证明的 owner 200/member 404 均通过。权威审计证明原字节、摘要与字段不变；源码 archive 前后 SHA 稳定，工作区按 CRLF 归一后匹配固定 Git blob，tracked clean。证据为共享树 `.local/mobile-assignment-public-independent-20da8856/fixed-result.json`、`source-final-check.json` 与 `existing-tests.log`。本轮测试没有监听或真实业务操作，临时依赖链接已删除，端口中心检查通过。

主控已固定 `20da885` 完成 F5 复审，全部 F1–F5 代码问题关闭，无新增 P1/P2。主控证据在共享树 `.local/mobile-assignment-proof-read-review-20da885/20da885-result.json`；合成主树的定向 53/53 与隔离 prelaunch 27/27 通过。此前 95 项组合为 94 过、1 项既有 Mac fixture 3 秒 version probe 超时，原日志保留且未改变产品超时；不改写为组合全过。主控亲测真实 SSE 与 WS 共享源，实际 WS 帧仍按候选侧独立报告注明。代码闭环不代表集成、回退、现网或准确 APK 已通过；保持不可发布，也不代替下节原生联网验收或知微历史缺失回执另案。

## 精确 APK 与本轮原生验收限制

当前未发布包为 code10 / `0.3.0-internal`，产品源 `ab5045a23c814032937bf4b4143fac2fc9f6012b`，APK SHA-256 `cc2d17f5f445c27e09d967c7f5993811410aa9ff6a8808457c86bf9b0523bcad`，755846 bytes，签名仍为 `507531ee91afe6369a2d519d653713a76d2fa54b8f5f76119672f668230ced35`。23 个 APK 资产逐项与 manifest、当前源码 SHA 一致。旧 `85fdb9c6…` / `bba9be85…` 包已经被替代，不作为本轮交付包。

本轮精确包的安装、版本及首次安装时间保留通过；原账号聊天、草稿恢复及群组入口因本轮模拟器 TLS 连接关闭而未能证明。旧 code9 基线也发生同传输错误；主机无凭据公网读取返回 401，而系统没有已确认可复用的 HTTP/HTTPS/SOCKS 代理。没有改网络设置、硬编码 IP、关闭 TLS 校验、读出凭据或重新登录。首轮旧包成功截图只对应首轮包，不能替代当前精确包的联网验收。

当前精确包证据：Android 树 `.local/mobile-manager-code10-post-review-native-qa/result.json` 与 `evidence-manifest.json`，状态 `partial_blocked_native_network`。本轮私有模拟器 PID85966 正常退出，297–301 已释放，完整 COW 克隆销毁，源 AVD 六盘 SHA/size/mtime 均不变；旧 PID59582 与 267/268/271 未触碰，端口检查通过。

正常提醒服务订阅、通知送达/点击、员工群持久记录及当前精确包正常联网仍需由主控在共享依赖部署、环境恢复后联调。以上完成前不发布新版二维码。
