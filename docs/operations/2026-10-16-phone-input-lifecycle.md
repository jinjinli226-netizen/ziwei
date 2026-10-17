# 手机文字输入、自动回查与后台生命周期修复

## 2026-10-17 本机原手机本次升级恢复与AI视觉输入验收通过（有限范围）

本机原手机本次双22升级、包替换后恢复，以及“视觉清空 → 确认空框 → 新输入 → bound_editor完整读回 → 新截图显示”的C / D两轮中文与数字输入均通过；C隐藏再重开键盘、D最终隐藏键盘后值均保留。非空直接API覆盖仍受限，未取得same_node读回；本次结论不包含长期存活、断网、熄屏、重启或用户Stop场景。

新中控 `01637b2b8c2c8efcd0a1ffc05213ff2e4d8a5df7` 的远端6套 **82/82** 回归通过，fail / cancelled / skipped均0，tests / build / worker退出码均0；310个源码成员前后SHA一致、20个dist文件逐项验证。**16:24:55** 真实部署至 `/opt/ziwei-control/releases/phone-installer-scoped-01637b2b8c2c`，PID361304；备份 `/opt/ziwei-staging/backups/control-installer-scoped-20261017T082454Z`。部署中schema、四历史表全部现存列及完整rowset、DB inode、主站 / 客户端 / Nginx / APK均保持，原8f0 pending不变；controlOwner仍Agent / epoch13 / draining=false。仅切换中控代码，不创建手机动作、不恢复DB。

随后通过正常API创建的原非owner Updater21 UI launch `device-command-7348912d-61bc-4beb-b000-2d24b830682e` 已succeeded / performed=true / executingConfirmed=true；主代理按新screen03确认原Agent22安装弹窗。这是原pending限定的单条scoped授权，不是部署修改owner或重提安装。Agent22原事务 `device-update-8f0c17ba-beca-4f70-9369-2ceba3d8fb99` 与Updater22原事务 `device-update-2aeb6ecd-cdd0-4728-bc48-a1ef99b1ae15` 均submitted=1 / committed，installed_at分别为 **16:28:19.638 / 16:33:12.965**，由AI按新图完成确认。**16:33:37** 双22在线健康、进程24849 / 27051、双socketConnected=true、startTrigger=package_replaced，更新相关退出与包更新时间差+4ms / -1ms。日常控制已为Agent / epoch14；epoch变化来自后续Updater22事务，不是部署擅自修改。它支持本次安装恢复和该时段健康，不扩大到重启、Stop或长期验收。

非空旧值上的原B文本命令 `device-command-e2fcf519-126c-4671-aa79-fceb564d4d2d` 为 **failed / not_started / INPUT_EDITOR_TEXT_UNPROVEN**：原节点读到0字符，输入连接返回7字符，无法完整证明原文本一致。新screen14仍见旧值；保留这条安全拒绝，不把它写成非空API覆盖成功，也不放宽guards。

AI按新截图定位清除X，tap `device-command-deea3160-371b-404b-8859-795c287e3ebd` succeeded，screen15原截图 `device-command-1849f1a2-13be-4611-9ff4-e25e926e1bd0`确认输入框已空。另发C文本原命令 `device-command-2277404e-779f-4d9b-a1af-bc9cf9395a95` **succeeded / performed=true / textVerified=true / executingConfirmed=true**，alreadyMatched=false，actualWriteVerified=true，inputBackend=accessibility_ime，readbackSource=`bound_editor`。这是绑定编辑器的完整读回，不是same_node读回。screen16原截图 `device-command-45490a81-b08c-47df-a905-f17c337f6008`经主代理及独审分别目视完整本轮中文与数字；隐藏键盘命令 `device-command-e556d7b8-0b68-45c4-8f09-8356978aa571` 与重开命令 `device-command-6cab65fa-7c30-4379-b820-99708185d08d` 均succeeded；screen17 / 18原截图 `device-command-5a1632c4-ca27-4e60-a073-1ca3e0eb3262` / `device-command-8d72a571-b947-491e-b66a-b979c1fdd7e4`经主代理目视，键盘实际隐藏 / 显示且C完整保留。

第二轮按新截图点击可见清除X，原命令 `device-command-f7d4befd-30a9-44b8-a086-d8334afa87b3` succeeded；screen19原截图 `device-command-d70766eb-8509-40ef-8feb-a30e2a45a746`确认空框hint。另发不同D值的原文本命令 `device-command-b179fe75-32ef-4abf-8c20-9e8bef4ecc0a` **succeeded / performed=true / textVerified=true / executingConfirmed=true**，alreadyMatched=false、actualWriteVerified=true、deviceReadbackVerified=true，readbackSource仍为`bound_editor`。screen20原截图 `device-command-4c894c9d-34e0-463e-8b56-f4d276f184be`经主代理目视，完整不同D中文与数字和绑定编辑器读回在同一搜索框一致。最终隐藏命令 `device-command-ca11e52e-c2ab-42bd-8b8e-b20eec36c571` 及screen21原截图 `device-command-f943bc58-bb1c-4ea4-978b-49dcf91ee32b` 均succeeded；新图21确认D完整保留、键盘已隐藏，仍在同一输入联想页，未提交搜索。

**16:45:22.503** 最终只读健康确认双22 / 0.4.11在线健康、双socketConnected=true，Agent / epoch14、draining=false，进程仍为24849 / 27051，uptime分别1023355ms / 730742ms（约17分钟 / 12分钟）；phoneIdle / mainIdle均true。这是有限观测窗口。**16:45:43** 服务复核中控仍为01637 / PID361304，主站仍为并发发布的 `/opt/ziwei/releases/mobile-images-9668962e1c16-1204ed1a/v2` / PID351449，Nginx master737，current目标均符合预期，local / public health均200；官方index `be572dbe…` / manifest `6ff858aa…`保持。原8f0 / 2aeb仍submitted=1 / committed，安装时间未改；原f30e仍uncertain、B仍failed / not_started，C / D仍succeeded / bound_editor。

界面边界：主代理已目视screen11 / 12，Agent22本地主页仍显示“升级failed / 系统安装失败状态3”摘要；尚未将该本地摘要与具体当前或历史事务绑定，不能无证据归到某个旧ID或原因。原8f0 / 2aeb最新数据库事务实际installed / committed，当前双22健康且无lastError；本轮未清写未知历史，不因这条摘要重建升级事务，也不称所有历史失败提示已清除。验收范围为原安装事务、当前版本和上述截图输入流程。

该搜索框后续AI视觉流程为：新截图定位X → 点击后新截图确认空 → 新text命令并取得bound_editor完整读回 → 新截图确认同一搜索框显示。直接在非空值上无法证明文本一致时继续安全拦截。原21 f30e的uncertain及B失败均不resolve、不改原回执、不重放；全程未提交搜索、发消息、购买或发布商品。公开文档不放原词或截图，发布manifest的deviceVerified=false保持。本次原手机视觉输入和升级恢复验收通过，直接非空API覆盖限制及未测试的恢复场景仍按上述边界保留；**16:45:59** 只读核实原定时id1为PAUSED，按用户要求保持暂停，不重开。

阶段证据：私有 `control-scoped-build-proof.json`、`control-scoped-deploy-result.json`、原scoped launch记录、`v22-both-installed-health01.json`、`v22-text-b-screen14.jsonl`、`v22-clear-search-screen15.jsonl`、`v22-text-c-screen16.jsonl`、`v22-hide-keyboard-screen17.jsonl`、`v22-reopen-keyboard-screen18.jsonl`、`v22-clear-again-screen19.jsonl`、`v22-text-d-screen20.jsonl`、`v22-hide-final-screen21.jsonl`、`v22-final-health01.json`、`v22-final-services01.json`及`v22-final-automation-status.json`。部署的“旧rowset保持”仅指该部署事务；其后原升级和新命令通过正常API自然推进分别记录。

以下分时历史保留当时的观察、失败及等待结果；其中“当前 / 未完成 / 待验”均仅指该节标明的历史时点。最新状态和本次通过范围以上方16:45收口为准。

## 2026-10-17 16:02—16:24历史：code22发布后原安装待确认、中控测试阶段

code22 / `0.4.11` 源码 `5cab3cf54ac481d74776b5b30fca7853740424ba`、归档 SHA-256 `540c3df34edda0822877bba522379af1745ea46cf895709e0c5cc1956ae15722` 已完成精确构建。**16:01:26** 核验310个源码成员逐项一致，Agent99/99 / Updater99/99，共198/198 JUnit，0 failures / errors / skipped，双 Debug R8、双 Release完整Lint / assemble通过；日志 SHA-256 `97c8e0a81acf89596df03ba7397a3fe3cce613ff0abd3f6b1198a60f197a8d12`。

原证书双包于 **16:02:54** 公网发布并回读验证，index SHA-256 `be572dbe5fef248ed6dc14a02ddacbd7288ccbd44fbd7e39919af8acc6d8a661`、manifest SHA-256 `6ff858aab81a706534cdfa6bb278b2462398e7222d919cc31dad42d98d5a3318`；备份 `/opt/ziwei-staging/backups/android-apks-20261017T080254Z-f49c56bf`。发布前17个旧版本 / 51个历史文件保持，runtime前后相同，servicesChanged=false / databaseChanged=false，manifest的deviceVerified=false不改写。发布成功不等于手机22安装或输入通过。

原Agent22升级 `device-update-8f0c17ba-beca-4f70-9369-2ceba3d8fb99` 仍 **awaiting_user_action / submitted=1 / installed_at=NULL**，沿原ID观察，不重提升级。screen01是旧Updater21完成页；AI按新图点Done的原命令 `device-command-9adc170e-d915-4b50-8899-38102f9e7215` succeeded / performed=true，screen02原截图 `device-command-a2c94270-d0dc-40a3-9550-012f6d5e424d` succeeded，显示闲鱼与既有测试值。这些不构成Agent22安装成功；helper中的code22上下文也不是手机版本证据。open-01为已知HTTP409拒绝，无command ID、没有手机动作，不写成已打开安装器。

新中控源码 **`01637b2b8c2c8efcd0a1ffc05213ff2e4d8a5df7`** 已审查推送核对，归档 SHA-256 `61a22f75602e07683ec3ed54610e8ec2cf07ff53b8edd01ce953828948c37476`。它仅为原pending安装的单条UI打开提供受限lease，正常controlOwner仍为Agent；根代理实际完成30/30纯内存测试，没有Mac监听。远端相关6套、预期82项回归与production build已启动，尚无全套通过或部署结论；当前生产中控仍为67c9，不提前写修复已上线。原f30e的uncertain与页面实际显示证据分别保留，不resolve或重复输入；整体任务未完成，定时PAUSED。

| code22 官方角色 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Agent | 891538 | `389ddaa4949ab6dbe9a1b423055e5d71c7511e6d67824e47568c1e220baa1fda` |
| Updater | 891542 | `dbfb49190e7cf14a74cedfd190674e7bf49fff107652c57dd86ca51673309803` |

以上阶段证据来自私有 `code22-build-proof.json`、`code22-publication.json`、原22升级观察与UI命令记录；不公开请求原词或手机截图。中控新源码测试与以后真实部署/安装/读回证据分阶段追加。

## 2026-10-17 15:55历史：双21健康、读回uncertain，当时22构建中

Agent21原升级 `device-update-308e8401-03aa-4366-8a96-6ecea93f0921` 与Updater21原升级 `device-update-ee6f6919-ff26-42ea-8253-67ec61432f68` 均submitted=1 / committed，installed_at分别为 **15:39:01.670 / 15:45:21.874**，系统安装确认均由AI按新截图完成；这与此前用户协助覆盖双20分别记录。**15:55:40** 双21 / 0.4.10仍在线健康，进程17797 / 20147、双socketConnected=true、控制Agent / epoch12。两端startTrigger=package_replaced，更新相关退出记录与包更新时间相差2ms / 5ms并标updateRelated=true，支持本次包替换后的恢复，不扩大为强停、用户Stop、重启或长期稳定性验收。

原文本命令 `device-command-f30e561b-751b-49f0-82ba-588a5bf51487` 保持 **uncertain / verify_read / INPUT_EDITOR_FOCUS_REQUIRED**，hostProof为 `CHANGED/COMPARE/p2/n25/ms457/q18`、txMs1472；设备读回没有通过。主代理独立目视私有新截图13 / 14 / 15，完整中文和数字测试值实际显示，隐藏再重开键盘后仍保留。截图原命令依次为 `device-command-c53f51dc-13d5-4e44-b542-c90eab19e2b7`、`device-command-efd08a49-f4c4-4060-acf2-d3ad58ea9353`、`device-command-fdc96e38-4ce8-4a74-b015-4aaf73dfd8bd`，均succeeded。页面侧可见与协议读回未通过分别记录；不改原uncertain、不resolve或重复输入，不提交搜索，不能宣告最终输入验收通过。

code22 / `0.4.11` 源码 **`5cab3cf54ac481d74776b5b30fca7853740424ba`** 审查通过，冻结归档 SHA-256 `540c3df34edda0822877bba522379af1745ea46cf895709e0c5cc1956ae15722`；测试配置为每角色99项、共198项，完整构建正在运行，尚无测试通过、签发、升级或实机验收结论。修复仅为既有固定3600ms观察和10秒事务内的只读观察重试收尾，不再次写入；测试配置与源码审查不等于测试或手机通过。发布manifest的deviceVerified=false保持，原定时PAUSED，整体任务未完成。

## 2026-10-17 15:36历史阶段：code21已发布，当时实机待验

code21 / `0.4.10` 源码 **`26cea77ff428b2aae66a84f63fc4d4de12e890f1`** 的7个源码文件已独立审查、提交推送并核对远端；冻结归档 SHA-256 `05ed12f28103ebbb7845c5053ddb067b837f7d3e17b258ca9398159e7a39fdcf`。新增13项测试；**15:34:07** 完整构建核验308个源码成员逐项一致、Agent94/94 / Updater94/94，共188/188 JUnit且0 failures / errors / skipped，双 Debug R8、双 Release 完整 Lint / assemble通过，日志 SHA-256 `8aea76cc5cdf7e6777f20cf4cc94fe1de68122c4c64fae66faf8092aef444308`。

最终原证书签名ready已核，**15:36:11** 正式发布并公网回读通过，index SHA-256 `42ac752d9b3e3745f12b5bc44c7a11427858dd874fd5e058f7354c21375a72af`、manifest SHA-256 `3b428eb561447a7395bd6e1fdd453efa7ae666dbbd1bfdebb34e5200bcd66557`。发布前16个旧版本 / 48个历史文件保持，服务 / DB未改、runtime前后相同，manifest的deviceVerified=false不改写。手机21升级刚开始，安装与输入通过仍待真实回执；原20失败 `89f7125d…` 保留，不预写成功。原定时继续PAUSED，整体任务未完成。

该版减少无效父节点读取与重复焦点证明，读取 / 证明分别限1800ms；输入事务总限10秒，execute入口在排主线程前固定11秒命令期限，不由读取续期。证明后500ms内须完成新读握手、直接父节点核验与最终屏幕授权；写后仅在固定3600ms观察期限内读回，不重复写入。短票据不是原子的整树快照，不扩大为绝对无竞态或实机输入已通过。

原签名证书 SHA-256 仍为 `6292cfac129ee17f36d0c08ebc430fd4b0e502c7ccce99927ea70c3f149e80f8`；发布备份 `/opt/ziwei-staging/backups/android-apks-20261017T073611Z-4f01e2a6`。`code21-build-proof.json`、`code21-sign-proof.json`及`code21-publication.json`分别记录完整构建、最终ready和publicVerified / historicalFilesUnchanged / runtimeUnchanged；servicesChanged=false / databaseChanged=false。15:17:52基线的16版本48文件明确指发布前历史集，不是发布21后的总数。主站mobile-images / PID351449、中控67c9 / PID333172及Nginx737在发布前后保持。

| code21 官方角色 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Agent | 890978 | `45674d61469cc68233b43cbf038408eeac3a07c464dd689557c609d6e1105473` |
| Updater | 890982 | `1ce201a39f0fdb676dede825e2ee294ff0aacf916c67c1b3fabbcff0b47451d0` |

记录始于 2026-10-16（Asia/Shanghai），最新状态以本文顶部16:45验收收口为准；下方10月17日接续进展是分时历史。正常故障处理由程序自动观察原回执和当前页面；不把结果未确认默认转交用户，也不自动重放整轮手机业务。

## 10月17日15:09后最新实机与code21边界

用户手动覆盖安装两包 `0.4.9 / code20` 后，**15:09:00** 原手机只读快照确认 Agent20 / Updater20 双端在线健康，控制 Agent / epoch10、draining=false，双 socketConnected=true，手机无活动命令或升级。进程4060 / 7344，当时uptime约45分钟，startTrigger均为 explicit；这仅证明该时段的健康与握手，不能称本次包替换自动启动或全程无人介入安装。20从未提交升级POST，旧19的88364 / 38fd原事务仍committed；手动安装不需要新建或伪造升级事务。

Agent页面显示的旧 failed 为本地 prefs journal 残留，不是20安装失败；未读取journal前不能锁定其具体旧事务ID。保持日志和旧失败回执，不清数据，也不以此否定API当前双20健康。

**15:11:51** 按新图点击原搜索框的 tap `device-command-616fc846-f714-4a4b-8d29-881ac505ba64` succeeded / performed=true。随后原文本命令 `device-command-89f7125d-f15c-4850-93d7-01ebcb83b64c` 为 **failed / not_started / INPUT_EDITOR_FOCUS_REQUIRED**，诊断 hostProof=TIMEOUT，actualWriteVerified=false / deviceReadbackVerified=false。截图原命令 `device-command-37360237-fc7c-4e4b-859d-b3d310392c5a` succeeded；主代理独立目视新screen04，页面仍见键盘与灰色提示词、请求文字未出现。executing ACK不等于写入，不重试20，不提交搜索，也未执行真实业务动作。

15:17之前的历史候选状态：code21 / `0.4.10` 仅为针对性能和时序的进行中源码修复与已就绪私有运维模板；截至本记录，源码 / 归档 / 测试数量仍未冻结，未推送、未构建、未签名或发布，没有手机21或输入成功证据。**15:17:52** 只读发布基线验证当前公网/shared仍为code20，16版本 / 48历史文件、runtime前后相同；这不等于21构建或发布。原定时继续PAUSED，整体任务未完成。

**15:13:37** 服务复核及15:17:52基线均确认，主站已由无关发版推进至 `/opt/ziwei/releases/mobile-images-9668962e1c16-1204ed1a/v2`，PID351449、自13:43:11运行；保护该当前release，不回退到旧mobile-runs或eabe。中控仍67c9 / PID333172，Nginx master737，双公开health与官方Android index20均200。

私有证据：`user-installed20-device-01.json`、`v20-user-screen01.json`、`v20-user-launch-screen.jsonl`、`v20-user-text-a-screen.jsonl`、`v20-user-service-check.json`及`code21-publication-baseline.json`。公开文档不放请求原词或手机截图；下方12:23离线及尚未安装20均为当时历史状态。

## 10月17日接续进展

用户恢复手机和电脑后，本对话手动继续工作。10月16日曾应用户要求暂停定时接续；10月17日 **10:08** 曾恢复原 heartbeat（id 1）为 ACTIVE，这是历史状态。当前只读本机 `automation.toml` 实查为 **PAUSED，按用户原先关闭定时的要求保持关闭**，不假定后续提示更新已持久化。本轮为手动接续，沿用本对话、原事务及私有 `resume-state.json`，不新建聊天或承诺定时自动继续；覆盖安装后的真实回执与输入复验见下方 11:06 后记录。

09:25 至 09:33 的只读证据确认，原 Agent18 事务 `device-update-21866c8a-7d0d-4bad-ae35-76a529106451` 已 committed，submitted=1、installed_at 为 09:24:01.773；Agent=`0.4.7 / code18`、Updater=`0.4.5 / code16`，均在线健康。Agent 的 `startTrigger=package_replaced`，包更新时间与本次 reason 10 退出时间同为 `1792200237930`，标记 `updateRelated=true`；Updater 的启动来源为 `peer_recovery`。这证明本次包替换后的实际恢复，不等于杀进程、用户 Stop、重启或长期存活测试。

两端持续报告 `socketConnected=true`；源码仅在 WebSocket `onOpen` 时置 true、关闭或失败时清 false，已取得原手机的实际鉴权握手证据。Nginx 09:23:57 另有真实 channel 101；访问日志不包含设备身份，且长连接可能在关闭时才写日志，不单凭这一行指定手机或角色。

09:31:23 主站活动业务为 0 后，沿原门禁一次提交 Updater18 事务 `device-update-5537b65e-890d-4dc5-825c-36f678ba77bf`，预检原命令 `device-command-e8ff9f5d-bfdd-403e-a190-2d5ef119aeb1` succeeded。当时该事务 submitted=1 / awaiting_user_action、无 installed_at；没有重提安装。09:33 打开原安装端 Agent 的命令 `device-command-47b03653-cf52-4b0b-820f-9e7e4674acd7` 被 Android 拒绝，failed / not_started / COMMAND_NOT_STARTED，executingConfirmed=false；错误为“指令角色、期限或控制授权无效”。原因是等待安装确认时没有普通租约，客户端安装辅助仅接受截图和点击，launch 无法执行。该失败不改写为成功，后续只在修复授权后发起有独立 ID 的明确未执行动作，不重提原升级。

09:31 前的新电脑业务先由原门禁阻止，待其自然 succeeded 后才开始升级。原业务门禁未修改，未知新业务仍默认阻止。私有证据为 `resume-20261017-device-01.json`、`resume-20261017-device-02.json`、`resume-20261017-ws-lifecycle-01.json`、`resume-scope-terminal-20261017.json` 和原升级 / 命令记录；不公开业务词或截图。下方 10月16日离线及“待取得握手”描述保留为当时的历史状态。

**09:53:32 中控授权衔接修复已发布。** 源码 `67c9b29b07a4975f5c632b724d2daea2afb983c9` 已独立审查、先推 GitHub，完整源码归档 SHA-256 `c89773b567f9779acc2fe50a4f1faec5040057d3a8c0cae608ec4d143d2e3dcf`。远端隔离环境 73/73 回归（含新增 21 项）、0 failures / cancelled / skipped，正式类型检查与构建退出码 0。测试仅执行一次；Node 默认 spec 输出曾使报告解析器未识别总结，保留原失败报告及原日志摘要后，按实际 73/73 结果继续同源构建，没有重跑业务或伪造测试结果。部署前后核对全部 302 个源码成员和 20 个构建产物摘要。

修复新增内部可空列 `android_commands.install_resume_update_id TEXT`，把打开原安装端的单条 launch 绑定原已提交、未安装、awaiting_user_action 的升级事务、原安装端当前 session / epoch 和自身包名。仅首次 queued 投递给有界正常租约，该次 poll 不重发 update 对象，兼容既有 APK；后续 poll / heartbeat 不续租或重投。executing ACK 再核同一绑定，终态缩短租约且保留在途隔离。其他应用、业务动作、角色或并发命令不能借用该租约；本机 enabled / Stop 继续优先。安装 session、原 confirmation 和原升级状态不被改写。

生产中控 current 为 `/opt/ziwei-control/releases/phone-stability-67c9b29b07a4`，仅中控服务重启。备份为 `/opt/ziwei-staging/backups/control-installer-resume-20261017T015331Z`；所有原 commands / updates / sessions / update_events 的旧列逐行摘要、数据库 inode、原 `5537b65e…` pending 行在该次发布中均保持。唯一 schema 变化为上述可空列，全部旧命令此列为 NULL；主站、客户端、Nginx 和所有 APK 字节保持。旧 `1b26b115` 模块已在包含新列的隔离内存数据库完成入网、心跳、命令与回执兼容检查；回退仅切代码，不恢复数据库覆盖自然进展。

09:54 后原电脑又出现新的目录与会话任务，全局业务门禁最初在 POST 和持久提交意图之前阻止新的 launch，没有新手机命令 ID。只读核对确认，本轮两项电脑任务均不含手机操作，本轮按精确动作 ID、请求摘要及原绑定范围限定 scope；原 scope 保留，未知业务仍默认阻止。**10:23:33.158** 一次 POST 打开原安装端，原命令 `device-command-a47d6514-71d0-461a-b3a8-20d358df2e17` 回查为 succeeded / performed=true、executingConfirmed=true；随后 screenshot02 成功，页面出现系统提醒。继续安装的点击请求被瞬态新业务门禁挡在 POST 前，未下发点击；没有重提原 Updater18 安装。

**10:25:23 设备快照：** 原 `device-update-5537b65e-890d-4dc5-825c-36f678ba77bf` 已回报 failed / submitted=1、无 installed_at，错误为“系统安装失败，状态 3；请人工核实后重新建立事务”；仍是 Agent18 / Updater16 在线，中文尚未测试。不据状态 3 或时间先后推断用户取消或某个点击导致失败。后续 screenshot03 为 expired、未投递、无图，不能用它判断当前页面。原 `47b03653…` 未执行、`a47d6514…` 打开成功以及安装失败分别保留，不改写为同一结果。

用户主动表示可以协助安装，已提供已校验原签名和摘要的 Updater18 官方包覆盖安装链接，不卸载或清数据。代码审查确认：Agent 的 PackageObserver 或同原 ID 的 poll 会触发 reconcile；它先核对真实已安装的版本18及原签名，再处理 failed 状态，因此可报告原 `5537b65e…` 的 installed。服务器只接受指定安装端的该原回执，随后等待 Updater18 新健康才 committed，旧 failed 事件摘要保留。截至 10:51:39 尚无覆盖安装或新版本健康成功证据；11:06 后沿原事务取得的进展见下节，未新建 resolve、未清锁或重提原升级。这是人工安装协助路径，自动恢复另据 MY_PACKAGE_REPLACED / peer_recovery 和心跳实测，不能写成全程无人介入安装通过。

**10:51:39（02:51:39 UTC）的历史设备快照**为 Agent18 / Updater16 在线健康，原 `5537b65e…` 当时仍 failed / submitted=1、无 installed_at，没有用户覆盖安装或中文输入通过证据。本轮故障及回查私有证据为 `direct-fix-open-installer-03.json`、`direct-fix-device-03.json` 及对应截图命令记录；原 heartbeat id 1 当前实读 PAUSED、保持关闭，本轮手动继续，整体任务未完成。

### 早期安装确认候选1ad（历史，后由bb60替代）

静态审查确认旧路径按“安装”子串寻找标签，可能选中“取消安装 / 安装来源”等文字；任意 clickable 祖先及 false 回调后继续遍历也会扩大或重复点击。这里确认的是源码缺陷，**没有证明现场状态 3 由该缺陷或任何特定点击导致**。

候选改为精确允许标签，仅归属最近单一正向按钮；保留 ColorOS 非 clickable TextView 的最近父按钮路径，拒绝冲突描述、混合子树、多目标和跨包 / 窗口。点击前重新取得整树、刷新原节点，并复核 Stop / enabled、原事务 / PackageInstaller 会话；两次扫描共享 700 ms 期限，最终 Binder 返回后再次检查期限。false 或 exception 也在派发前占用尝试，同一 Service 实例内按原事务 / 会话、控件身份及标签语义去重，任一重复均拒绝；不声称跨进程持久 exactly-once。现有会话检查不能单独证明安装器窗口必属该会话，此边界保留。

早期源码 **`1ad02efed4d0ac4ee6e6c25ef8c7feabea31a332`** 已独立审查、提交并推送 GitHub；精确归档 SHA-256 为 `fef38854716476eacad67c7b44ff69e7da6d0692742f74592d1280b87c8a01b7`。**该早期 code19 / 0.4.8 远端隔离完整构建通过：Agent66/66、Updater66/66，共132/132 JUnit，0 failures / errors / skipped；其中每角色新增13项，共26项，已包含原106项，不能再加总。双角色Java编译、双 Debug R8、双 Release 完整 Lint / assemble 的显式任务均完成；`BUILD SUCCESSFUL in 3m 27s`，159 actionable tasks 全部 executed，进程结束并取得 `CODE19_BUILD_TESTS_SUCCESS`，但未签名、未发布或实机验收。** 早期构建日志为私有 `code19-build-check3.json`，完整核验证据为 `code19-build-proof.json`：304个归档源码成员逐项摘要一致，双包元数据均为19 / 0.4.8；buildSuccess=true、signed=false、published=false。该阶段尚待用户覆盖安装18，现已由下节原事务进展及 bb60 输入候选更新；不将 1ad 的构建证据移作 bb60 证据。

### 11:06 后覆盖安装与真实输入复验

用户报告已安装后，11:06:06 只读样本确认 Agent18 / Updater18 双端 0.4.7、在线健康，控制 Agent / epoch 8，活动手机命令和升级均为 0。原 Updater18 `device-update-5537b65e-890d-4dc5-825c-36f678ba77bf` 自然推进为 committed，installed_at 为 11:05:33.454，submitted 仍为 1；未创建 resolve、未重提安装，旧失败事件保留。这次安装包含用户协助覆盖安装，不算全程无人介入安装通过；安装后的 Updater 启动来源为 package_replaced，退出记录 updateRelated=true、比包更新时间晚 5ms，支持本次自动启动与健康恢复。

按新截图打开闲鱼搜索页，11:09 的原文本命令 `device-command-a987444f-ac41-4e5a-9877-aa28f93aeab3` 返回 failed / not_started / INPUT_EDITOR_FOCUS_REQUIRED。再次取得新图并明确点击实际搜索输入框后，约 1 秒内提交 `device-command-faa8139f-e2d4-4cc3-8b3b-048bb9170830`，仍为同一确定未写入错误；紧随其后的截图证明页面仍在输入框、键盘可见且请求文字未出现。位置识别及点击依据截图；故障发生在文字写入前的输入焦点验证，不以键盘可见或 executing ACK 当作写入成功。保留两条原失败回执，不继续盲目重复输入。

输入补丁 `bb60a02c2d58aafa6c9826a4732fbd7a83f2d9d3` 已独立审查并先推 GitHub，在 code19 中纳入安装确认修复。保留原目标节点，补查服务级 FOCUS_INPUT，仅当节点身份、窗口及包名精确一致时确认焦点；任一来源指向另一有效可编辑节点仍拒绝。不把服务返回节点改为写入目标，不放宽为同包名、键盘显示或无障碍焦点。失败诊断增加有界节点属性，不含文字。新冻结归档 code19b SHA-256 `10e23536ed07835e4e216f5581f6d6216d2bbea740878bc65ce66bcd211a4b83`，旧安装候选归档保留；版本为 0.4.8 / code19。**11:27:00（03:27:00 UTC）已核完整19b构建通过：304个源码成员逐项一致，Agent / Updater 各69/69、共138/138 JUnit，0 failures / errors / skipped，双 Debug R8、双 Release 完整 Lint / assemble 均通过**。构建日志 SHA-256 为 `dfde73b04bb4a4d9bf339da6e36fe9bdc39806519489a5b6f187e3ab64b1e62d`。随后原签名发布、双端安装及输入复验结果见下一节，不以构建代替实机输入结论。

### code19正式发布、双端安装与输入复验

原证书签名的 `0.4.8 / code19` 已正式发布，源码为上述 bb60、冻结归档仍为 code19b。私有 `code19-publication.json` 确认 publicVerified=true、historicalFilesUnchanged=true、servicesChanged=false、databaseChanged=false；备份 `/opt/ziwei-staging/backups/android-apks-20261017T033028Z-6dbf0548`。新 index SHA-256 为 `44680a0fafb620b28b5d9c65e143115d92247fc2d35d5765b54071cc5db85d5f`，manifest SHA-256 为 `94f5ba6c4fd909a3813b961069c23b579886f95511a4ea9a81730027bf755ce0`。原14个历史版本与42个历史文件保持，发布未启停服务或写数据库；manifest 的 deviceVerified=false 保持原值，不把发布写成整体实机通过。

| code19 官方角色 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Agent | 877230 | `5314fbbace2a2a2716fd30e790428caa88485559fcd4f057a179a357753b6c32` |
| Updater | 877234 | `794322fbbe57e05b8b1fefab23ba91e5a6fa7b0f9663ed17dab6945b801ac0af` |

本次 code19 安装由 AI 根据新截图处理系统确认，没有新增用户安装协助。Agent19 的继续安装与扫描后确认原命令 `011e531e…`、`80d34ae9…` 均 succeeded / performed=true；完成页由 `1f662a3a…` 按新图关闭。Updater19 打开原安装端 `439022ef…`、继续安装 `5a1a08ba…`、扫描后确认 `b85595f9…` 均成功。OPPO `com.oplus.appdetail` 页面仍需 AI 按图处理；这些结果不能证明客户端自动确认策略已在该 OEM 页面全程实机走通，也不声称静默无系统确认安装。

**11:34:05** 快照已确认原 Agent19 事务 `device-update-88364dd5-ec9f-438b-9e6d-253806256240` submitted=1 / committed，installed_at 为 **11:33:53.313**。**11:39:27** 快照确认原 Updater19 事务 `device-update-38fd8387-3249-443d-9ec8-1adbb3829ff8` 也 submitted=1 / committed，installed_at 为 **11:39:17.765**；Agent19 / Updater19 双端 `0.4.8` 在线健康，控制 Agent / epoch 10，活动手机命令和升级均为0。两端 `startTrigger=package_replaced`、新退出记录 updateRelated=true，进程19333 / 20596，支持本次包替换后的自动启动与健康恢复，不代替强停、重启或长期存活实验。

Updater 安装转健康期间，screenshot11 原命令 `device-command-45db845e-aa8d-4403-b646-efa615391831` 为 **failed / not_started / COMMAND_NOT_STARTED**，错误“执行确认后授权已失效”，虽有 executing ACK 但无图片；不把它作为新页面证据。11:39:27 的 Agent19 socketConnected=true；Updater19 刚启动1.354秒、socketConnected=false、lastSuccessfulHeartbeatAt=0，该初始样本不作双端握手通过证据。随后 **11:43:00.674** 只读样本确认双19 socketConnected=true、进程19333 / 20596未变、uptime为545352 / 219154ms，控制仍Agent / epoch10、phoneIdle / mainIdle=true。它支持该有限时段的健康与握手，不覆盖长期、重启、强停或用户 Stop 场景；较早双18握手证据保留为历史时点。

按新图明确点击实际搜索框后，code19 原文本命令 `device-command-2ba2c10e-1c30-4284-9dd1-3e458a26aa08` 仍为 **failed / not_started / INPUT_EDITOR_FOCUS_REQUIRED**。随后 screenshot03 原命令 `device-command-da0e4842-c526-4605-ad71-39dabbc92221` 成功，主代理独立目视搜索页与键盘仍在、请求文字未出现。root / service 两个焦点来源均返回同窗口同包名、focused=true 但 editable=false 的 FrameLayout 容器，原 EditText 不等于该焦点节点。保留原失败，不盲目重复输入，不宣告 code19 输入修复成功；code20 的安装和真机输入结果仍待后续证据，整体任务未完成。

### code20完整构建、原签名发布与连接阻塞

code20 / `0.4.9` 源码 **`1ea60190d245e909bab5ff22d5d2198a023b4aa0`** 已独立审查、提交推送，并由 ls-remote 核对；归档 SHA-256 为 `634ddf15d4989daa80eed73054189b4abb248897cbb04c4a36eeeb9fc84106f2`。FocusedEditorPolicy 通过两轮完整树、父节点身份和唯一原编辑节点绑定判断容器焦点，不改变原写入节点；保留256节点 / 24层 / 共享700ms边界，实际效果前仍复核 Stop 与期限，readbackSource 区分 same_node / bound_editor。新增12项测试；**11:58:56（03:58:56 UTC）完整构建核验通过：306个源码成员逐项一致，Agent81/81 / Updater81/81，共162/162 JUnit，0 failures / errors / skipped；双 Debug R8、双 Release 完整 Lint / assemble通过**。日志SHA-256 `adfcbef6679601f14d103c0894f7ad6cec03127a20d3ad83d6e167312f0f4fa8`，证据 `code20-build-proof.json`。原证书签名候选于12:00:42形成，`code20-sign-check-02.json`确认双包20 / 0.4.9、原证书 `6292cfac…`、signedCandidateReady=true。

**12:01:41 正式发布**由 `code20-publication.json`确认 publicVerified=true、historicalFilesUnchanged=true、servicesChanged=false、databaseChanged=false，deviceVerified=false保持。备份 `/opt/ziwei-staging/backups/android-apks-20261017T040141Z-3a9f166e`；index SHA-256 `f97b251a921795253bfed77e544614d7ef5ab4afe16a798e92ad09b187952448`，manifest SHA-256 `9ce73cfc54dc5ac9297002b95527a810a73ec28281378500773ee9707ac0fdbe`，原15版本45历史文件保持。

| code20 官方角色 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Agent | 884562 | `465db6ba4b1e1b1c8e175302a2033d981486465d1d7bf23beff3a60a7c77bcee` |
| Updater | 884566 | `8986157c800b2afb046048624fe8b07724383c8cfdc7a3b2ad485f9c638c6f02` |

**12:13 最新只读观察：手机仍为 Agent19 / Updater19，双端 offline，code20 尚未安装或实机输入验收。** code20 已于 **12:01:41** 原证书签名发布并公网核验；首轮 observe 被新电脑业务挡在 POST 前，没有20手机命令或升级提交。随后只读核实该精确任务是另一台 PC11af 的内容研究，不含手机请求、绑定或执行；本轮仅新增该动作 ID / payload SHA 的精确 scope，未知任务仍默认阻止。这是有限业务判断，不是操作系统能力隔离。再次 observe 因双19不健康等待，未下发手机动作。last_seen 为 NULL，runtime 仅为约12:11的缓存，无新退出原因，不能归因被杀或用户停止；原绑定电脑 bfd 在线。定时任务继续 PAUSED，整体任务未完成。

新电脑业务为 `action_364a54e0-0a60-498a-a2c8-8434ac75b74e`，payload SHA-256 `29f32ed75889a1d56cdcf759bf5dcc0b31d60a7546f1f3aefd37af086300c92c`。`code20-business-intent.json`将真实用户请求派生为另一电脑的内容研究，手机 / Android / 闲鱼 / 原设备 / 委派标志均false，员工无手机绑定、原execution无phone run。只在原5条精确规则上增加此1条，私有 `direct_fix_scope_v20.py` SHA-256 `9aa8ca2fc847ec56945eb4fb036f5d30c8ddb81743ceda05e6fc203d19878b32`，原scope不改；这不证明管理能力在OS层绝对隔离，不通配未来任务。原20 observe01在POST前被阻止，observe02仅返回 waiting_both_roles_healthy；没有20手机命令或升级POST。

**12:14:49 服务复核**：生产主站已由其他发布推进至 `/opt/ziwei/releases/mobile-runs-1757bd819099-51e2a255-bf145367/v2`，PID340823、自11:02:13运行；不回退至历史eabe。中控仍 `/opt/ziwei-control/releases/phone-stability-67c9b29b07a4` / PID333172，Nginx master737，双公开健康、官方客户端元数据与Android index20均200。12:11:35两条WS 101不能归属手机；只凭可能延后记录的close日志不能归因断连。root正尝试已有电脑只读恢复通道，尚无手机20安装或输入结果。

**12:23:58 最后只读复核：** Agent19 / Updater19 仍双端 offline，原因未知；活动手机命令、升级及主站动作均为0。code20 observe 继续 waiting_both_roles_healthy，原私有20状态无 commandId / updateId，未下发任何20手机命令或升级。既有19两条升级 committed 和输入失败均保留；code20 实机安装、中文读回及页面验收仍未完成，沿用户已提出的覆盖安装协助继续，不卸载或清数据。原定时实读 PAUSED，不承诺定时接续。私有证据 `v20-final-phone-readonly.json`、`v20-final-upgrade-observe.json`、`v20-final-upgrade-state.json`。

**12:21:16 原电脑恢复通道探测结果：** 12:21:12只提交一次正常 `command.execute`（executable=`adb`、args=`["version"]`），原动作 `action_ab02baa5-5a9e-4582-a14e-d3f70f6c1a35` 返回 failed，错误 `executable is not allowlisted: adb`，没有stdout、未spawn。只证明该执行名被拒，不证明ADB未安装或USB不存在；未改allowlist、换路径、新建token或bot聊天，既有兼容A2A鉴权仅在内存使用。12:16最后手机观察仍双19离线，没有20手机动作或升级POST；0.4.9已准备，可沿用户已有授权请求覆盖安装协助，尚未发生，不称无人介入安装完成。整体任务未完成，定时继续PAUSED。 私有证据为 `original-pc-adb-version-code20-result.json`。

以上证据保留在私有 `v19-device-observe-03.json`、`v19-device-observe-05.json`、`v19-device-observe-06.json`、原安装确认 JSONL 与 `v19-focus-text-screen-03.jsonl`；不公开原词或手机截图，不重写原事务或失败回执。

## 10月16日发布基线与当日待补项（历史）

| 层 | 源码 / 产物 | 状态 |
| --- | --- | --- |
| 主站 / API | `891685f70e9e4bfc2c56821ee2cc9a28a356f548`，分支 `codex/android-stability-main` | 11:09:08 发布，`/opt/ziwei/releases/v2-hotfix-891685f70e9e/v2` |
| 官方 Windows 客户端包 | 同一提交；build `6b8449d952039abf08bde26c3b3a840e297a250cf684378cd4c4c1371699a8b1`；包 SHA-256 `4d993a13c29cdb66b22d71ccacc77d6a4424fc63766d93a182bf69b19ba52a9f` | 已发布且公网逐字节回读；不等于电脑实际安装完成 |
| 中控 | 私有仓库 `jinjinli226-netizen/ziwei-system`，分支 `codex/android-input-lifecycle`；`1b26b11538916bd2dedd8685bfaa752f5736f567` | 已先推 GitHub，11:50:25 发布，`/opt/ziwei-control/releases/phone-stability-1b26b1153891`；前版 `8be4604` 于 11:15:29 发布 |
| Nginx WebSocket 代理 | 已推模板源码 `98db76d4fa0e42f019e81bf446d382891ec1253f`，仅 10 行精确 channel block | 13:10:38 部署，语法 / graceful reload / 无凭证 401 空 body / Origin 403 空 body 通过；认证手机 101 待补 |
| Android code16（历史发布） | `8be4604f2938271bf54798db9e74ac3dfa0c3b37`；`0.4.5 / versionCode 16` | 11:24:57 原证书发布，11:58:24 双端均在线健康，两条原升级事务均 committed |
| Android code17（历史发布） | `1e7977b43fda78eabc924e8a15c4502dc9a82131`；`0.4.6 / versionCode 17` | 12:20:17 原证书发布；Agent 原 code17 事务 committed，12:38:27 快照 Agent=17 / Updater=16；12:45 实际中文输入未执行 |
| Android code18（16日官方下载） | `c54ec5332c1686d6478aca14aa23cb25166713ce`；`0.4.7 / versionCode 18` | 已冻结、推送 GitHub，106/106 JUnit / 双 R8 / 双 Release 完整构建通过；12:56:34 原证书签名发布，公网回读通过，当时安装 / 实机验收待补 |

10月16日 13:16:21 的最终只读快照显示，主站已由另一项后续发布推进到 `eabe098af3b6c0e7d76cf4121052e3606e022888`（`/opt/ziwei/releases/v2-hotfix-eabe098af3b6/v2`），该提交继承本轮 `891685f` 手机修复；已核对 ancestry 和 phone MCP 差异，未覆盖原回执机制。官方下载客户端元数据为源码 `5db7d834deaf3524adfada59a434bc764fda750a`、build `208f2350ff390bbf7506e6baaef60eb7c8d467f2c8630a86c670ce01aada1044`、包 SHA-256 `2aadef1b066953fb81ff247ec16cd1a5e5e91a8d34490b66b8d47f11fa13d734`。这些后续发布保持现状，不回退为 11:09 的历史包。该16日快照中控为 `1b26b115`；双服务、公开健康与 Android index 在最终检查中正常，该快照手机双端仍离线，活动手机命令为 0、原安装事务为 1。

原签名已私下获得并验证。10月16日官方最新 APK 为 `0.4.7 / code18`，Agent / Updater 包名仍为 `com.ziwei.device.agent` / `com.ziwei.device.updater`；code16、code17 和 code18 均通过 `apksigner 35.0.0`、包名 / 版本 / 字节数 / SHA-256 校验，证书 SHA-256 与原版一致：`6292cfac129ee17f36d0c08ebc430fd4b0e502c7ccce99927ea70c3f149e80f8`。发布 manifest 保留 `deviceVerified=false`，没有把发包写成完整实机通过；17日最新 code20 发布见顶部。

| code16 历史安装包 | 字节数 | SHA-256 |
| --- | --- | --- |
| Agent | 846630 | `5524ed1e312536b3318574d7803d932456c5f65e31b9accdfa990a77cccf824b` |
| Updater | 846634 | `fa9f21552cd997a3e4ebfd987941d7446601132c8043dc99bcdaed7564ab1376` |

| code17 官方安装包 | 字节数 | SHA-256 |
| --- | --- | --- |
| Agent | 861862 | `685241034dddeb6f96e046401996f7f213707c58382d6d6151d9c96d931b8be2` |
| Updater | 861866 | `eec6400c945dbf601258ab405b34bf1f35bd5e6f75d8c489ad69d4726f96deb1` |

| code18 官方安装包 | 字节数 | SHA-256 |
| --- | --- | --- |
| Agent | 869578 | `f6e5d83917e91ec79ef0a437a75e687bd9324622ce785fc9bf42248468f91531` |
| Updater | 869582 | `f689a4263b2e8c775435376a824821596a4a48bab761ea133a7991a40b0868a3` |

code18 冻结归档 SHA-256 为 `bca0a4e87d299341ef2a56fd4dafa53fa6ef6c771efaca467612f90b2e186b08`。它是本次构建源码身份，尚不是 APK 摘要或实机通过证据。

## 证据与实际修复

闲鱼1设备 `android-a2d39137-4c04-463c-b03b-6165a9f12f35` 三条中文输入命令均有 executing ACK 和 uncertain 回执，但只留下 `执行结果待核实 ExecutionException`，没有原 cause。不能从历史记录反推每条输入失败的具体原因，也未独立目视旧截图。旧源码只查 active root 的 input focus，且未验证写入结果。

- 输入目标改为前台非键盘窗口中的安全可编辑节点，优先唯一焦点，无法排歧时不写入。查找有时间、节点和深度上限。中文直接通过 `ACTION_SET_TEXT`，同一节点自动读回验证；系统返回 false 也可能是回调超时，读回成功才宣告成功，不盲目重发。
- 取消门禁覆盖主线程排队动作，超时后尚未开始的动作不会稍后落地。执行前明确拒绝报告 `failed / not_started`；可能产生副作用但尚无验证的情况保留 `uncertain`。executing ACK 不代表动作已发生。解包 `ExecutionException` / `CompletionException`，保留可读错误和 `errorCode`。
- 后端对已受理命令按原 commandId 自动只读回查，最多两次；手机 MCP 对失败的只读请求最多重读一次，不重复动作提交。AI 获得继续观察原回执 / 当前页面的指引。截图已完成但图片下载失败时保留真实动作终态，单独说明图片交付问题。
- 聊天保留员工完整总结及底层错误。混合动作不把先前成功点击描述成整轮未执行；同一原命令的最终回执可解除早期未确认状态，别的命令成功不能抵消。automation 不自动或同 run 手动重放整个已尝试手机动作的流程；电脑进程完整退出时不会因手机结果未知而误隔离电脑。
- Android 新增系统退出历史、机型 / 系统、前台通知、省电 / 后台限制和内存诊断。读取失败的字段保持未上报。伙伴恢复识别用户停止、设置有界持久退避，旧回调不复活已停服务；前台状态恢复失败会退出并释放唤醒锁。
- 控制 POST 改为有界短超时；APK 下载和安装串行放到独立 worker，不阻塞心跳。安装提交前再次检查停止和授权状态。Receiver 的磁盘与安装查询移出主线程。日志面板改为后台读取和缓存，最多 200 行 / 32 KiB UTF-8，暂停或销毁页面后拒绝晚到更新，清空显示保留之后新增事件。
- 正式终端页每个角色增加折叠诊断，缺字段显示未上报，离线记录带时间；历史退出原因不自动等同本次离线原因。
- 中控 `1b26b115` 增加已确认安装结束后的显式恢复交接：只允许离线目标交给原健康安装端，仍检查原动作与租约排空、递增 epoch 并留审计。实际控制端为安装端时，轮询不重发已完成的安装工作，避免旧 APK 因收到 update 对象清掉本地租约；原 awaiting_health 事务继续保留在数据库和状态接口。安装未完成阶段的隔离不变。
- code17 在未声明 SET_TEXT 的同一目标上增加 API33 无障碍输入连接；已有原生写入发出后不会转后端重写。异步只读、会话 / 授权 / 取消重检、单次提交与自动读回机制已实现，但现场 text 仍被焦点安全检查拒绝，不能称闲鱼中文已修好。
- code18 增加 `isFocused` 或系统 `root.findFocus(FOCUS_INPUT)` 精确等于原节点作为输入焦点证据，不根据键盘显示、无障碍焦点或仅同包名豁免。生命周期实现持久冻结首次 MY_PACKAGE_REPLACED 边界和精确退出标记，重复广播、空结果或晚查询不能绑定后续退出；首 MY 之前仅用窄时间窗推断，SDK34 的 reason 10 不适用升级例外。
- code18 的主进程 Application 入口单次登记 13 字节版本 summary，已知同 / 高版本或坏 summary 拒绝升级豁免，保留本机 Stop、enabled=false 和 FLAG_STOPPED 优先。旧 code17 没有 summary 时，首次 MY 之前的 reason 10 仍有因果歧义，不能称已证明旧版本或绝对识别用户停止。系统历史 / 包信息查询在 worker；主线程仅有早期 summary 登记和微小广播边界持久化。

现场已经回传退出诊断，但仍不能断言已定位其“经常被杀”的具体根因。Updater 有升级后自动恢复证据；16日 Agent17 的当次启动来源与旧 reason 13 记录仍有证据缺口；17日 Agent18 的 package_replaced 恢复见顶部。用户明确停止继续被尊重，不用双端互拉风暴覆盖用户意图。

## 验证范围

- 主站相关回执、自动回查、A2A、daemon 与 reconciliation 联合回归 66/66；正式诊断 UI helper 6/6。lint 150 个源文件、构建和离线客户端依赖闭包通过。
- 主站更广的旧测试存在 4 项已在未改发布基线上复现的 Mac 环境失败：本地 Sonnet 模型、两项 Hermes profile、Windows 固定路径断言；不把它们算作通过。
- 精确 Android 提交 `8be4604` 在隔离 Linux 工具目录运行 Agent / Updater 各 38 项 JUnit，共 76/76；两个 debug 角色 R8、两个 unsigned release 的编译 / Dex / Lint / 组装通过。
- code17 提交 `1e7977b` 在远端完成各角色 43 项 JUnit、共 86/86、0 failures / errors / skipped，R8 和 Release 构建通过。code18 `c54ec533` 已冻结并推送 GitHub；远端各角色 53 项、共 106/106 JUnit（0 failures / errors / skipped）、双 Debug R8 和双 Release 完整 Lint / compile / Dex / assemble 均已通过，完整构建 2m31s、159 个任务全部执行，日志有 CODE18_BUILD_TESTS_SUCCESS；原证书签名与 12:56:34 公网发布验证已完成，安装和实机证据待主代理补入，不将完整构建通过写成手机验收通过。
- 中控 `8be4604` 的 Android 设备、轻量回执、终端控制及 MCP 集成 50/50；最终恢复提交 `1b26b115` 新增两项后，远端最终回归 52/52、0 skipped。中控 Vue 类型检查和构建通过；此次 server 修复没有重建或更换 code16 APK，Android 76/76 的源码基准仍为 `8be4604`。
- Mac 未新增监听服务；需要监听的中控集成测试在服务器隔离 staging 数据目录运行，未使用生产库。
- code16 双端实际升级和 code17 Agent 升级已完成，历史包逐文件摘要保持；APK 发布未启停服务、未改数据库。12:02 code16 与 12:45 code17 的真实闲鱼中文输入均未通过，返回确定未执行；16日尚未取得 code18 实机验收。17日双端18及19已健康，code18两次、code19一次真实文本命令均确定 not_started / INPUT_EDITOR_FOCUS_REQUIRED，code20 成功输入仍待后续实机验收，详见顶部。断网 / 熄屏 / 重启和长期存活证据仍待补。构建、单元测试和下载验签不能代替这些实机证据。未发布闲鱼商品、发送消息或修改历史回执冒充成功。

## 10月16日设备验收快照（历史）

11:17:12 的发布后只读快照仍显示闲鱼1双端 `0.4.4 / code15`；该快照早于 code16 APK 发布，不能代表后续升级结果。

**10月16日当时记录：Agent17 / Updater16 自 13:01:19 之后双端无 HTTP 并离线。** code18 原 Agent 升级事务 `device-update-21866c8a-7d0d-4bad-ae35-76a529106451` 为 submitted=1 / awaiting_user_action、无 installed_at。原事务已受理但尚无安装结束证据，不能重提安装或宣告 code18 已升级、自动恢复或输入成功。服务 API / Nginx / 下载仍 200，但没有新退出或 TLS 失败证据，不能据此归因“被杀”或 WebSocket。程序分别调查 TLS 与绑定电脑恢复通道；此前在线健康快照均保留为历史时点。

绑定电脑的只读查询也显示离线，最后 heartbeat 为 12:59:40、未见活动任务；没有操作其他电脑或修改 allowlist。生产公开证书的磁盘与实际服务端回读 SHA-256 均为 `c7e65503c1a23b41e17f498ec29bd8150302c43ecb819664d1eb1755799f2f0c`，mtime 为 10 月 4 日，有效期 2026-10-04 至 2027-01-02；13:01 附近没有 Nginx reload，仅有下述 13:10 修复。Android 使用系统默认信任链，没有缓存该叶证书或固定 pin。此证据仅排除该观察端所见证书过期 / 轮换，不能证明手机网络或 TLS 正常，不能据此判断被杀原因。

| 验收项 | 10月16日当时记录 | 当时待补证据 |
| --- | --- | --- |
| Agent / Updater 沿原协议升级至 code16 | 11:58:24 双端均为 `0.4.5 / code16`、online；无障碍 / 亮屏 / peerBound 均为 true，locked=false；两条原事务均 committed，control=agent / epoch 3、draining=false，活动动作与升级均为 0 | 已取得版本、事务和健康心跳；不等于长期存活验收 |
| code17 实机升级 | Agent 原事务 committed；12:38:27 快照 Agent=`0.4.6/17`、Updater=`0.4.5/16`，双端在线健康 | 不把 Agent 升级扩大为 Updater 已 code17 或 code18 已升级 |
| 中文输入与焦点 / 键盘切换 | code16 `0ad2168c…` failed / not_started / INPUT_UNSUPPORTED；12:45 code17 `5309ba7c…` failed / not_started / INPUT_EDITOR_FOCUS_REQUIRED | code18 修复后的原命令 textVerified、页面观察及焦点 / 键盘切换证据尚未取得 |
| code18 安装与恢复 | 12:56:34 原签名发布通过；原 Agent 事务 21866c8a… awaiting_user_action / submitted=1、无 installed_at，Agent17 / Updater16 当时均离线 | 按原事务等待可核安装状态及恢复通道，不重提；双端 code18、健康和输入均待补 |
| WebSocket channel 修复 | 13:10:38 代理补丁已部署，真实 Upgrade 无凭证 401 空 body / Origin 403 空 body 通过 | 未取得认证手机 101；不以代理探针替代手机连接、安装或输入验收 |
| 系统退出诊断与后台恢复 | OPPO PHJ110 / Android 13；双端前台与通知启用、忽略电池优化为 true，后台限制 / 省电 / idle 为 false；Updater 已证明升级自动恢复，Agent 启动来源未证实 | 断网 / 熄屏 / 重启恢复及长期观察；未知退出原因保持未知 |
| `1b26b115` 恢复交接分支 | code17 Agent 已安装 awaiting_health 且离线时，实际交接 Updater / epoch 5，Updater16 正常 lease 下 launch succeeded，AI 允许打开并显式 Start 后 Agent17 健康 / committed；12:42 已恢复 Agent / epoch 6 | 旧 APK 兼容恢复分支已实测；Agent17 仍依赖 AI 显式 Start，不能宣称自动复活 |

两条升级事务为 Agent `device-update-3d4973fa-573a-4cea-806a-a32ff78d0b35`（安装端 Updater，installed_at 11:42:08.700）与 Updater `device-update-468c004f-1162-4d11-b7fe-63cfea614200`（安装端 Agent，installed_at 11:56:49.277），均为原签名 code16，原记录保留。

真实闲鱼 text 命令 `device-command-0ad2168c-180b-4d28-8748-47ea7ad2cb3e` 于 12:02:23 提交，12:02:27 按原 ID 回查为 `failed`，结构化结果为 `executionState=not_started / errorCode=INPUT_UNSUPPORTED`，底层错误“目标输入框未提供系统文本写入操作”。虽有 `executingConfirmed=true`，本次尚未开始写入，不能视为中文输入成功；code16 实际控件兼容仍待定位与修复。保留该原回执，不盲目重复提交。

Agent code17 原升级事务 `device-update-3060d5bb-579c-4cb5-98f8-3dc6cc721c56` 已 committed，installed_at 为 12:29:07.407。code17 实际 text 命令 `device-command-5309ba7c-9c68-48dd-bde5-436235039298` 于 12:45:07 提交、12:45:11 回查 `failed / not_started / INPUT_EDITOR_FOCUS_REQUIRED`，底层错误“系统输入连接要求目标为当前非密码输入焦点，未继续输入”，有 executing ACK、没有写入成功证明。保留原 ID，code18 实机结果待补。

code17 恢复时，`handoff_recovery_v17` 在 Agent 已安装、awaiting_health 且目标离线条件下实际 POST control=updater 成功，epoch 5；Updater16 的旧 poll 获得正常 lease，原 launch 命令 `device-command-288d2de9-e63e-4c43-b1f6-7ef51e2002c1` succeeded。AI 随后允许打开并点击 Start，原命令 `device-command-1094e3b2-9cbb-4264-bfdf-582fae510088` succeeded，Agent17 才恢复健康 / committed。12:42 已恢复 control=agent / epoch 6。此为 `1b26b115` 兼容旧 APK 的真实恢复分支证据，同时明确 Agent17 并非无需显式 Start 的自动复活；早期 code16 那次脚本因事务已 committed 停止只作历史记录。

11:58 的 code16 快照中，Updater 的 `startTrigger=package_replaced`，reason 10 退出记录 `updateRelated=true`，退出时间比包更新时间早 13ms，支持本次升级后自动恢复。Agent 的 `startTrigger=explicit` 来源未证实；reason 10 显示名为“用户请求停止”、`updateRelated=false`，退出时间比包更新时间晚 340ms，这组证据仍无法区分旧 Android 升级退出与用户停止，不能认定此次 Agent 上线全自动，也不能据此认定用户主动停止。两端旧 reason 13“其他系统原因”缺少进一步原因证据，不能归咎 OEM。

上述 340ms 为 code16 历史记录。code17 Agent 又出现 reason 10，退出 `1792124945625` 比包更新 `1792124945610` 晚 15ms、`updateRelated=false`；这是 code18 修复升级恢复误判链路的现场依据，不足以将 Android 13 同码歧义彻底消除。

以上待补项由程序沿既有回执和只读观察链收集；不默认转交用户逐项核实，也不重放真实业务。

## 10月16日发布、数据保护与接续（历史）

先推 GitHub 并核对远端，再按相同源码归档发布。主站和中控分别只重启自己的服务。11:50 恢复发布在停服务前后均要求活动手机命令为 0，仅允许精确原 Agent `3d497…` 已安装且 awaiting_health 的事务保留，拒绝其他未完成升级。SQLite 备份使用 backup API，核验 integrity / FK，保留原数据库 inode；中控 schema 与全部原命令、升级和会话行摘要保持。11:09 主站及 11:50 中控发版时 Nginx 未改；13:10:38 的 channel 配置修复是后续明确例外。

- 主站 / 旧客户端备份：`/opt/ziwei-staging/backups/phone-receipts-20261016T030906Z`。
- 中控初次发布备份：`/opt/ziwei-staging/backups/android-control-20261016T031528Z`；11:50:25 恢复发布备份：`/opt/ziwei-staging/backups/android-control-20261016T035025Z`。
- 旧主站：`/opt/ziwei/releases/v2-hotfix-cd610444ce79/v2`；中控此次回退基线为 `/opt/ziwei-control/releases/phone-stability-8be4604f2938`，更早的 `/opt/ziwei-control/releases/8a4fe59` 继续保留。
- Android 历史包已逐文件核对复制至 `/opt/ziwei-control/shared/downloads/android`；新 release 的 `dist/downloads/android` 指向它。11:15 中控切换时原 index 保持 SHA-256 `20cc66c484238f3e8316b7ce9604cbc5fb45785736624552708a9d658c8aef7a`。
- 11:24:57 仅新增 `v0.4.5-code16` 产物，并最后原子更新 index；历史包与旧 release 条目保持。新 index SHA-256 `1f64cec0f3eed435af75baafa8e96dd70de7adb95566407d82fc59878a7d5aa2`，manifest SHA-256 `8b1806e70d3a1c275a6d9fabfeaa38f00abb5febae281d752f9fcf7e47adabb8`，公网回读匹配。
- APK 发布备份：`/opt/ziwei-staging/backups/android-apks-20261016T032457Z-23bc1467`，保存原 index、拟发布 index 及结果。撤回下载索引时恢复该原 index，保留版本化产物供复核；不删除历史包。
- 11:50:25 中控恢复发布确认 schema、全部旧 command / update / session 行摘要、数据库 inode、主站与 Nginx 服务及配置均保持；Android shared 下载目录与 index SHA-256 `1f64cec0f3eed435af75baafa8e96dd70de7adb95566407d82fc59878a7d5aa2` 保持。
- 12:20:17 code17 原签名双包发布，保留 code16 及更早版本；备份 `/opt/ziwei-staging/backups/android-apks-20261016T042017Z-fcda5d01`。新 index SHA-256 `4015ae5a1f80545ac89ff4f098ef3c5f5741b1f3e0ac9d44f15f77780639a016`，manifest SHA-256 `9f1d5c99a2b501ed04f368fc5cb1be38374fe05a0d34924bc664b2dfb2ae443f`，公网回读通过；未修改服务或数据库。
- 12:56:34 code18 原证书双包已发布，publicVerified=true、历史文件保持、servicesChanged=false / databaseChanged=false；备份 `/opt/ziwei-staging/backups/android-apks-20261016T045634Z-452e0449`。该次 index SHA-256 `49204ab39fa7843a12efcd0918581810b962ec98d393d13ef8e7c75805391ac2`，manifest SHA-256 `f286bdc0c7575b2e751e4bbf7139e04af9773f626ddab3ad7eda0d709bd85959`；安装验收待补为16日时点，17日双端18进展见顶部。
- 13:10:38 仅向原 Nginx 配置插入源码 `98db76d4fa0e42f019e81bf446d382891ec1253f` 的 10 行精确 `/api/device/v1/channel` block。配置 SHA-256 `21a955cdfaef8d16837671b20ec07ddcf4c7f61d0c1feea9c1885a4a3dedd231` → `8c92827d0e8cae5377c04f33bc775c3c9ab39b156d924638abca7a7a25472aec`，其余配置字节保持；备份 `/opt/ziwei-staging/backups/android-websocket-20261016T051038Z`。发布脚本在 reload 前记录尝试状态并检查配置漂移，语法 / 探针失败时恢复原配置并 reload。实际 nginx -t、graceful reload、无凭证 Upgrade 401 空 body、有 Origin 403 空 body 验证通过；主站 / 中控 PID 和 current、code18 index 均保持，无 DB 写。authenticatedDevice101Verified=false，认证手机连接尚待观察。
- 回退服务只切代码 current 链接并重启对应服务，必要时恢复客户端发布三文件；不覆盖当前业务数据库。手机覆盖更新不能直接降级，恢复旧逻辑需原签名与更高版本号。

**10月16日当时状态：代码、构建和发布完成，真机验收等待连接恢复；当时任务未完成。** 当前接续以顶部 10月17日进展为准。原签名、code16 双端升级及 code17 官方发布 / Agent 升级均已完成；code18 `c54ec533` 已推送且 106/106 单测及完整构建通过，12:56:34 原证书签名与官方发布验证已完成。已为本对话创建 heartbeat“闲鱼1恢复后自动接续验收”（id 1，ACTIVE，每 10 分钟）；私有 `resume-state.json` 保留原 `21866c8a…` 事务、证据路径和严格不重投约束，连接恢复后继续完成双端 code18 与实机输入验收，通过后停用计划。该计划依赖本 Mac 开机且 Codex App 运行，不是任意时刻均能执行的云端任务。

输入验收仅为“中文+数字搜索词（仅搜索框，不提交搜索）”；公开文档只记原命令 ID、状态 / 校验位，不放原词、截图或完整业务数据。程序继续在同一原回执和当前页面上定位输入问题，验证焦点 / 键盘切换、读回和后台存活，不重复真实业务动作。私有证据位于 gitignored `.local/android-stability/`：部署依据 `control-recovery-deploy-result.json`、`test-recovery-final-check3.json`；code16 为 `device-observe-05.json`、`xianyu-text-1.json`；code17 为 `apk-publication-v17-check1.json`、`v17-device-observe-02.json`、`v17-xianyu-text-1.json`；code18 在16日已有 `code18-source.json`、构建 / 签名 / 发布和首个升级 tick 记录，最终手机原事务与文本回执待主代理补入。不得提交其签名或运维凭据。

## 签名材料的未完成安全事项

原签名材料已私下接收并用于本次签名。误传材料已在 `dd813218` 从公开 `main` 最新文件树删除，`709166` 增加忽略保护，但历史仍可访问，尚需后续独立处理；不能将删除最新文件或添加忽略规则当作已清除历史暴露。文档不提供该材料的位置或下载入口。仓库补充 `*.keystore`、`*.jks`、`*.p12`、`*.pfx` 忽略规则，签名与运维凭据仅保存在私有目录。
