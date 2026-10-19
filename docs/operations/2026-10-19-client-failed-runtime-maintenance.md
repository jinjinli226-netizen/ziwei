# 李金晋电脑失败回合阻塞远程升级

2026-10-19北京时间08:40只读确认：李金晋电脑仍H build `bfc96edf59be31f1be50d3878a12d6c37d154fa108ef37c7a0d7d41ee7511927`、PID40628在线。K升级 `client-update_b9f94525-1577-48d3-a957-3f04ea6baeeb` 在05:40:56因stop_client/CONTROL_REJECTED失败，没有装入K。闲鱼原动作 `action_49bd64e6-0105-4fd6-aff5-53f50b520d52` 在05:40:08因模型上下文过长、自动压缩失败自然退出；早于升级失败，cancelled:false，不能说升级杀掉了这轮业务。

原Windows回执根exit1确认、tree:false、backgroundProcessesRetained:true、active3；本次只读电脑诊断原root46856及当前后代为空，不能拿旧active3当当前活进程。维护检查报告ACTION_STATE_CORRUPT和原action的result_pending；诊断自身active1/另一acked队列不计历史阻塞。原回执、手机动作不确定与业务结果不改写，不重跑原手机任务。

候选仅修客户端：模型执行显式内部cleanupOnFailure:true，在仍持有原Windows Job句柄时清理非零退出的本次子进程，保真实根退出码、cancelled:false；通用supervisor默认false、成功启动的后台服务保留。旧失败后台记录单列本地停止类别，严格校验身份、修订、隔离、非零exit/host0/真实retained标记。精确配对原action/结果blob和缓存终态的result_pending才计retainedPendingCount；不放行其它pending或嵌套本机退出未知。原action-state及queue字节完整保留，formal扫描仍拒绝原树未知。

候选恢复沿原官方更新器：两次健康和文件快照/hash、暂停接单后精确pending数相等、原生清单只有精确daemon、持有真实Process句柄验证无直接子进程后停止；停止后核对进程/监听均空。仅证明本次daemon停止，回执仍originalExecutionExitConfirmed:false，不补造历史业务退出。

定向新旧本地恢复78/78、未来清理相关15/15通过；独审93项82通过/9 Windows条件跳过/2项原HEAD同样失败（Mac路径与ENOENT差异）。Windows条件测试不是Mac真机通过。发布及真实升级和D盘新任务结果另行追加，不把候选测试或包发布当作设备安装完成。


L `2a801ef702bd3deb16ba76f37b52d07db9782e09` 已推GitHub并发布客户端：build `27b255fb7b48777bcdedaf3c81eafe8518ac607ebd1b5eb3fbafa677d0e8b6bc`、SHA `577d1e4557014737a11620f83fe597382d3d13e4628afcd1fbf9090ace70fedf`。主控85项通过；Linux离线冷装与helper导入通过。真实请求 `client-update_f1fc8b9f-14cd-49fc-9f2d-50b023a86ebd` 又在stop_client/CONTROL_REJECTED失败，原H/PID40628保持，未停电脑或换安装。

后续发现分类夹具用了executor_failed，而真实Hermes adapter返回runtime_failed，dispatcher会原样保留（而非统一改executor_failed）。补丁仅允许这两个已知码，不接受任意code；新夹具通过真实dispatcher接收runtime_failed先红后绿，另测无code默认executor_failed与未知码拒绝，定向80/80通过。后续候选发布与设备结果另记；原L失败保留，不用测试总数代替现场验收。


M `e0fa8e2a4e265e678e82d948b289dc69c62bd2d9` 只准备了包和发布stage，未执行发布。现场只读诊断进一步确认：旧回执包含手机工具深层 executing/uncertain 状态，原纯判定即使归一code仍拒绝。补齐严格同workspace/employee/action/runtime/profile的已加载ziwei-terminal业务子树局部判定：仅本地legacy业务状态检查省略该手机子树，完整原视图仍检查任意嵌套本机exit/native/control/quarantine。使用完整真实原结果形状的本地纯探针通过，原数据不变；含深层状态、scope错绑、子树未知进程/控制状态的91项回归全通过。不会先把未通过真实形状的M发到设备。


N `c897b68593655624a839c115158ce2ccbcaf83fc` 已先推GitHub后发布；build `a39048706e304e6292a9e7efa41abd5e571c3a2c0bdd1ab1e2b0b65ea9364d64`，只换客户端下载，API/UI仍J。真实升级 `client-update_38de2d53-476c-4537-a67e-e90a9ab80f6d` 在holder_revalidation拒绝；设备仍H/PID40628，没有安装成功。真实Windows扫描已接受原失败回执：retainedFailedBackgroundCount=1、retainedPendingCount=1；formal与原业务状态不改写。

精确只读诊断 `action_eafcad29-bc45-47d4-999e-e1eba64e7d26` 成功：唯一本安装daemon、四项原生身份、config/build/listener全匹配；正常polling前1后0。旧逻辑在暂停接单前长时间查询原生身份，期间新轮询启动会被误拒。后续候选在pause前仅容许0..已绑定连接数的整数polling，active/quarantine/Gateway及精确pending条件不放宽；先pause，再最多15秒等被中止的polling退出，最终与原生停止仍要求polling=0。超时不kill；原实例与业务状态仍匹配时恢复连接。3个竞态夹具在N先红，修复后连同历史回归94/94通过，独立复核同样94/94。候选包发布不等于设备升级或D盘验收通过，结果待追加。


O `621985b86cdeb3a58bcd409568644f8196084a5e` 已推送及发布，真实请求 `client-update_27ff3d92-8681-43aa-9fa4-f27ba59b99ae` 仍旧CONTROL_REJECTED。只读现场动作 `action_5c839c7b-cc37-459c-bae5-9346766017d9` 确认只到current_health即返回notApplicable；候选对原回执匹配正确，activeActionCount包含已结束任务的result_pending重传。之后普通旧stop虽等到排空，却仍被旧维护分类拒绝；并非模型任务一定还在运行。

后续候选把稳定扫描移到已核对精确进程与配置身份的pause/drain之后：初始active仅容许等待，15秒内active/poll都归零后才按候选扫描并严格匹配pending，随后归档、二次文件/进程核验和原生停止仍强制active/poll=0。真实任务不退出则超时恢复连接并拒停；扫描不适用也恢复，原先已draining则不擅自resume。4个现场顺序夹具先红后绿，定向108/108和独审108/108通过。后台成功服务与手机业务不被重跑，原记录仍不改写。

P `b02683b28cb12ecdcc2b93c6a847ccdb45bbcfee` 已先推GitHub再发布。包SHA `e6b04c4b3c81ced265034e14b6d7586bad4607283518ac76bf8473a8957c37a7`，build `b40ce7117c3b43b8ff05bbc9adb541b59555125934a670a5ab43069c0ef7b405`。统一升级 `client-update_3b976a49-9b7c-4711-8a57-02edacc4f4a4` 于09:35:47北京时间收到目标新进程认证心跳：succeeded、heartbeatVerified:true、completionSource:heartbeat。李金晋电脑PID40628变为17316，无用户终端。精确官方回执complete、configurationPreserved/restoredRunning均true；本机health与安装指纹同为P。合成专属Job真机验证根exit23、tree0/active0/childgone、cancelled:false；动作 `action_5e77888e-69b3-4f67-9eef-cdc1a4125ffd`。原闲鱼业务未重跑，历史tree:false未改写。

升级后新建两条普通任务，未提交cwd/workdir/conversationId。擎天 `action_7f1cbadf-ad26-4e65-87a2-5c6ab988b585` 成功、root0/tree0，payload为 `D:\AIUSE`，有真实命令活动及返回D盘的模型JSON；适配器未单独保存原tool stdout。知暖 `action_7fcec325-ea8f-44e9-b194-cf070c200548` payload为 `D:\AIUSE\life-assistant`，仍原独立profile `zhi-nuan-life`，模型调用terminal后返回 `stdin is not a tty`（session `20261019_093634_1eb0d7`）。CLI code0和平台succeeded不代表目录业务验收通过，正在读取精确原生工具记录。
