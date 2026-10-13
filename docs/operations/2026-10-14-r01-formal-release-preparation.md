# R01 正式发布准备与保留数据回退检查点

状态：**PREPARATION ONLY / 未放行 / 未正式变更**。北京时间 2026-10-14。

R01 是唯一正式发布执行会话。用户已授权验收达到上线条件后直接推送 GitHub 并部署服务器及必要本机客户端，无需重复申请同一发布批准。该授权不把未通过的候选变成已签收版本。本轮先提交可审查的运维准备；不发布 Release、metadata，不切服务、不更新客户端、不执行模型或手机业务。

隔离树：`C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解`；分支 `codex/v2-r01-release-preparation`；准备基线 `8556aecb6a37385d9fc7061f989e97071bfd6cf9` 是 **Q01 已发现 P1 的旧候选，仅供读代码与编写准备**。不得将此树的产品代码作为发布源。最终源码从总控给出的 GitHub 确切签收 SHA 取得；必要运维文档提交单独审查并组合，不盲合历史分支。原 D、2884、E02/Q01 工作树均未写入或测试。

## 新获取的只读证据

SSH 使用既有私有 credentials reference、strict known-host 与 RejectPolicy，没有新登录身份或复制认证到仓库。远端 probe 经 `python3 -` 的 stdin 执行，不上传服务端脚本。SQLite 通过 `mode=ro`、`query_only` 与有界 backup API 到内存后查询；完整记录只在内存计算 hash，不输出正文、密钥、环境或 journal message。

服务器观察窗口：2026-10-14 **00:08:33–00:08:36**、补公网读回 **00:12:38–00:12:40**（北京时间）。

| 层 | 本轮实际证据 |
| --- | --- |
| 主 API | `a66df9c76de5ed016932ca0193a307f3df72f47f`；`/opt/ziwei/current -> /opt/ziwei/releases/a66df9c-sqlite-179d0d46`；PID181593；4178；原入口 `/opt/ziwei/current/backend/server.mjs`；systemd active、NRestarts0 |
| 静态前端 | RELEASE 记录功能基线 `274a418353b66d3c1dec23590274597921dccc34`；实际 JS `index-BTklAvoe.js` SHA `345ed449282a6d18d5766b26669b6d7f6ed3342043bd236415c4d347ac92bc00`；CSS `index-BzSMaS9U.css` SHA `57dbebe7ffa4e7715df70f9edf63ecffec45e475e34a7a245db59541e1894dd5`；公网200并逐字节与磁盘一致。基线标签不替代实际资源hash |
| 控制 | `8a4fe59f0b2486fb584962fd3006e9a47418037a`；`/opt/ziwei-control/current -> /opt/ziwei-control/releases/8a4fe59`；PID134533；5191；原入口 `server/index.mjs` |
| Nginx | PID737；80/443；配置SHA `21a955cdfaef8d16837671b20ec07ddcf4c7f61d0c1feea9c1885a4a3dedd231`；`/terminal-mcp/v1` location 与原4178/5191转发存在；没有 reload |
| 持久链接 | 当前 API 的 `data -> /opt/ziwei/data`、`.local -> /opt/ziwei/.local` |
| 主/控制 DB | `/opt/ziwei/data/ziwei.sqlite`、`/var/lib/ziwei-control/control-plane.sqlite`；两库 integrity=`ok`、FK问题0；逐表schema/PK集合/全部行hash私有留证；主库action状态30 succeeded / 9 failed / 1 expired，不能用这些数字代替原树退出证明 |
| 对象 | `/opt/ziwei/data/objects` 3项逐文件hash私有留证；本轮没有做可恢复正式备份 |
| 官方 Windows | 源 `324731e79c6a855fad1f501379630bbfa67e5d34`；0.1.0只是npm semver；tgz134338 bytes/36常规文件；SHA `1592d107fcbcf27b9ec5e0d909f871ffa3851d9e136e015713156144d70fc8cc`；tgz、release.json、update-windows.ps1均公网200且与实际发布磁盘hash一致 |
| 本机实际安装/运行 | `D:\work\nodejs\node_global\node_modules\ziwei`；installed=running build `7e2ae40a8e9cb12ad8592514db263b6952f27bd0eae6fe01d3b84fe8cd3d1950`；PID12132；创建时间 `2026-10-12T10:19:53.29Z`；ready/connected；active/poll0；本轮没有提交maintenance |
| 本机原配置 | `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\ziwei_user.json`；native final path精确吻合；SHA `7913bf1c1b490ecf9b6d6760787973c28f8c484703c144eb0028b57ef8166b72`；bigtron / 原bfd设备；shared0；原workdir `C:\Users\25941`；config SHA与运行lifecycle吻合；nonce只留摘要 `d9796e2420a8db139ef94c927c12db3c574573b38c6eb996ab7d898e4b56dec6` |
| 本机日志 | `C:\Users\25941\AppData\Local\Ziwei\ziwei_user\logs\daemon.log`及轮转历史、`client-upgrade.jsonl`、`client-exit-watch.jsonl`；独立observer36400仍绑定12132并有新心跳，原历史异常maintenance结果保留 |

预检读取前后，server current/RELEASE/前端/Nginx/公开包hash及服务PID/创建时间稳定；本机config/build/身份/认证摘要前后稳定。正常日志/心跳可持续追加。本轮没有验证日志强制退出或重新挂observer；旧V1日志专项可引用，下一次实际升级必须挂接并核新实例。systemd/journal与既有append日志可读取，但周期observer及轮转的完整服务器诊断标准本轮尚未独立验收；没有为端口登记补业务实例。

端口登记簿与实际占用同时核过：本机5178/4178没有监听，但仍归紫薇，不复用；20242原PID12132；127.0.0.1:7890原clashmiService18400，保持既有代理。只查看，不改登记。

Windows 前两次读取分别被 `PATH_REDIRECTED_OR_LINKED` / 原生路径验证拒绝；MSIX将常规及扩展路径的config文件读取映到Codex LocalCache，缓存SHA不等于运行配置。拒绝留证，没有弱化守卫。第三次以同用户隐藏WMI只读reader运行，精确final path/health config SHA证明读到原生文件；reader PID34836已退出。这个reader不具备stop/update/start命令。第三次HOME枚举仍为部分观察，**没有证明所有配置/PEB source HOME、owned/Creator HOME或native claim已排空**；不能将其计数用作不存在证明。

私有证据根：`C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解\.local\r01-preflight-20261014`。

- `server-01.json` SHA `41bc5c9523dc2097cdc3e144bd0c27b87a0f911f88028cdbb524283a63b7a3ef`。
- `server-02-public.json` SHA `b319ab08244448c084410c83b66f884e917282db85fbb97971d45bb384bf5ad3`。
- `windows-01-refusal.json`保留首次拒绝；`windows-02.json`保留第二次失败；`windows-03-native.json`保存本机原生成功投影，SHA `9289da51e34575f26435e7fd7844842f94c1a09460cd7b9924e88ba2f991c529`；所有文件不入Git。
- 安全文档保存版本、hash与事实；不把数据库/HOME/auth/.local原始记录或私有产物推GitHub。

fresh `git ls-remote`：rollback `8556aec`、E03 `667a4f8`、旧provider QA `63f690c`、main `339b1db`；V1注释tag `775eccb` peel至 `2ebe3df`。8556祖先中main可达仅是当前准备树的Git关系，**不证明最终组合可FF**。本地及8556 tree未见`.github`自动工作流；最终发布还须fresh查询GitHub Actions/workflow、webhook或外部auto-deploy可见配置，现阶段不能声明推送无自动部署副作用。

## 正式validated spec最小契约（提案；不是已实现接口）

唯一产品owner=E02。R01不改 `scripts/v2-preservation.mjs`、collector、guard、exporter或产品角色。8556的apply仅允许QA marker/root；不得复制 `preservation-rehearsal.json`到生产，不能另写薄wrapper绕过scope。运维controller的mutation调用要等E02提供明确正式contract并由Q01独审/隔离验证；**现在没有可用于生产写入的controller**。inspect/plan可在同批compat当前role只读回读；restore仍要求匹配同批V2保护包已安装/运行，保留原role守卫。

正式private spec应绑定以下内容并在第一项写入前核实：

1. `mode=production`、精确operationId、用户授权的目标与有限范围、spec本身hash；同operation异参拒绝。新operation不得用于跳过未结束旧phase。
2. 当前DB canonical absolute path、持久file/DB identity、origin/workspace集合、当前保存phase/intent/snapshot摘要；控制DB只做保护，不切换控制代码。
3. 总控准确签收candidate SHA、QA evidence commit/hash、同批两角色×API/frontend/Windows六产物SHA、两manifest SHA、API role/content identity、installed/running Windows build、固定FROZEN版本语义。candidate与历史v1/v2基线字段分开。
4. 各机器原API/client root、原生入口、配置/userHome/runtime/baseHOME绝对路径、设备/workspace/shared bindings、原PID+创建时间+nonce私有引用、服务管理器身份；不能仅存PID或HTTP200，不能以非原生MSIX cache替换配置。
5. 同operation、同DB一致投影、原device/HOME/marker/初始provision/action关联的机器端proof。Linux DB controller不能假定本地可读Windows HOME；传输safe proof并验证可信来源、哈希、operation/设备/DB/root身份与新鲜度，密钥只引用原private文件。
6. prepare后新工作持久fence；drain覆盖被切换实例**全部作用域**，原worker/Job树、缓存、原payload/ACK/结果补传。停机/collector缺失/损坏/uncertain/blocked retainEvidence/旧终态无PID树证明都拒切，不能按expiry视为退出。
7. `state.db` driver pending对应settled/source action/原tree；Gateway inbound pending/accepted/delivery_started及未知发送；全量Kanban task/run及claim；Group完整events/成员结算；collaboration outbox/claimed。不能只核UI最近100条、内存active0或此次未使用。已settled历史保留关联，不能清pending key造zero。
8. 文件/目录与process最终复核、seal时一致性；phase提交丢回执后原operation回读。已提交状态必须可辨，不自动重复变更；abort不能擅自启用Bot、重放业务或删除unknown证据。

正式初次V1→V2也须确定**启动新API/客户端之前的持久fence与原实例排空顺序**。不能先启无fence的新调度器，再事后prepare；不能让updater自动恢复轮询后才补保护。这是正式adapter隔离验证须覆盖的bootstrap检查点，具体入口由E02 contract给出，R不能临时编辑生产DB造phase。

## 备份与恢复验证

放行后以全新私有目录 `/opt/ziwei-backups/v2-r01/<UTC-operation>`及本机原生private目录保存；权限0700/0600或对应Windows ACL，密钥不进Git或公开包。先枚举真实配置/PEB source HOME与所有绑定机器；不能用预检HOME计数代替最终清单。

备份范围包括主/控制SQLite的一致backup API副本、当前增量和墓碑清单/稳定PK摘要、对象存储完整内容、data/.local所指持久目录、source/旧Creator/owned profiles与HOME全部文件含logs/state/kanban/session/memory、action journals/result cache/delivery/gateway/group/collaboration records、客户端config/原凭据引用与实际安装目录/入口、发布三文件和静态资源、原signing/key与必要私有材料、服务unit/Nginx配置、独立observer源码/状态和历史日志。不能直接cp正在写入的SQLite主文件而遗漏WAL，不能保存半套HOME。

最终一致性窗口在freeze、全实例排空、写入方退出或已证明暂停之后：用SQLite backup API生成新副本；在独立离线副本跑integrity/FK、核每表PK/稳定列与当前schema、新附表；对象每项hash与DB引用可读；HOME全清单hash与marker/provision/会话/记忆摘要；恢复到隔离目录后只读打开SQLite及抽取对象/HOME，不启动业务、模型、gateway或手机；首次/结束投影一致。正式备份与restore读取本轮 **NOT_RUN**。

这些备份用于取证/灾难恢复。版本回退始终沿同一当前DB及全部新附表/对象/HOME，**不把生产整库恢复为发布前快照**；不得恢复已删除员工或丢弃期间增量，也不清新HOME。若出现物理数据损坏，先保存损坏原物，再提出明确数据级恢复方案；不能混为普通代码回退。

## 执行与失败检查点

以下是运行计划，等待正式adapter contract后将命令填实；当前未执行任何mutation。

| 点 | 操作及必须新获取的证据 | 失败/丢回执处理 |
| --- | --- | --- |
| P0 放行与Git | 总控明确Q通过、正式门槛通过、准确SHA/六产物/manifest/可用范围；fresh远端与auto-deploy审查；只推最终代码/安全QA/运维记录，正常非force，远端读回SHA；main仅最终关系可FF且符合既有发布方式时推进 | 无准确放行或push结果不明，先远端读回，不部署、不force |
| P1 staging | 从GitHub确切SHA/验收包建立新release目录；离线hash/role/manifests/依赖运行环境/DB schema兼容核实；沿原data/.local links、4178/20242端口与原native入口；准备compat及V2双方产物、旧层备份 | staging不合格不影响当前运行；保留失败产物与日志，不改current |
| P2 freeze/drain | E02正式入口持久prepare fence；首装bootstrap不能产生无fence工作；原实例pause排空，核原PID/创建时间/nonce、所有scope原动作/后台worker、tree/cache/result_pending与原生claims；只补原结果，无新model/native调用 | preparing/unknown保留；不改failed/expired、不清队列、不换key重跑；回读原phase和原实例 |
| P3 backup/seal | 完整一致备份及隔离restore-read通过；native proof对同operation/DB/原HOME；最终文件/目录/process复核后seal原子提交 | 备份/claims/proof不明拒seal；提交丢回执先inspect/plan读原operation |
| P4 版本切换 | 仅需变层：API/front/官方Windows包与必要本机实装；停原已排空实例并证明退出后切current/原安装；控制/Nginx保留；Windows沿原maintenance/update-worker入口，精确tgz/SHA与原prefix，更新metadata最后且公开读回 | 更新queued只表示受理；等同job结果并核实际安装/运行build。失败用同批保护包代码/原安装回退，保留当前DB/HOME与停止/运行状态；不盲start、不重配对 |
| P5 compat保持 | 回退目标为**同批v1-compat** API/frontend/Windows角色包；新PID/root/installed/running identity核验；DB/HOME仍sealed，旧default/Creator/普通员工功能仅在排空证明后继续 | 不使用裸V1接V2数据；compat安装下仅inspect/plan，不能restore |
| P6 回到V2 | 再排空compat所有共享实例、核原tree和期间增量；停compat、安装/运行同批V2仍sealed；核API role/client build/DB/HOME/operation/snapshot身份；调用V2正式restore，保持Bot/Routine暂停、未来时间重算 | 任何错身份/部分状态应仍sealed；不能通过改snapshot/清HOME恢复 |
| P7 联验与交付 | 准确API/UI/static/client running版本；核心owned开通/配置/启用暂停/主聊天/普通任务/promptRoutine/session/memory/数据保留链；原scope只复用未变provider证据，必要一次有界真实gpt-6.1-sol/max请求沿127.0.0.1:7890；QA精确新manifest清理；新实例observer/心跳/退出诊断留证 | 保留真实401/timeout/overload失败，不当降档依据；Source auth先核实，不克隆/修改源auth；失败保持暂停并按P2–P6保护回读/回退 |

只升级当前已授权且必要的本机；其他机器不批量更新。未结共享执行必须证明排空，即使其Group/Gateway/手机/Goals/Heartbeat/Kanban/24h可用性不承诺。本轮未验范围如实保留；当前没有统一core-only开关，不能把“未验/未用”写成强制禁用或零风险。

Q01 G1–G5、P1、补传/unknown/native资源全量证明、正式validated adapter及bootstrap隔离验收、最终SHA/六产物全部待交付；R01没有替Q标PASS。真正放行后发布按已有授权继续；本轮准备检查点交接后idle，给Q01释放动态复验名额。

## 可重复的只读入口

`scripts/operations/v2-run-server-preflight.py`传入既有private SSH reference和Paramiko库路径，新输出仅允许本树`.local`；远端reader不含mutation。`scripts/operations/v2-windows-preflight-readonly.py`传入既有V1只读helper绝对路径+准确SHA，新输出仅允许`.local`；打包命名空间不匹配时拒绝，必要时在同用户原生只读入口执行，不能改配置来让检查通过。运行例保留在本轮私有证据，公开文档不含凭据值。两入口都显式 `formalGatePassed=false`，不生成QA marker、不调用正式apply。

本轮验证：server-01及server-02公网/磁盘/identity读回成功；windows-03原生身份投影成功；原namespace失败保留。最新3个Python脚本AST语法核验PASS；Windows reader的外部输出路径负例exit1且文件未创建；Git差异检查通过。Windows reader随后仅修正部分HOME候选目录并显式标记inventory不完整，该部分尚未重新实机采集，不升级原证据范围。不以这些运维reader检查代替产品测试或正式回退演练。
