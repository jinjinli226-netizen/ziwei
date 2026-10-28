# 驾驶舱统一身份：部署配置、验收与回退

日期：2026-10-22。规范 1.3.0、身份契约 1.0.1、CLI 2.0.0、机器契约 v1。源码基线 `19876c0f006af18c9fe3b6ef4a7d9e94c75c14c6`，当前为候选增量，最终 commit 见阶段回执。本文件是受控发布材料；未执行生产发布、改登录模式、重启、账号清理或生产恢复。已完成受保护的只读备份及隔离 SQL/object 恢复验证；这不授权将恢复副本投入生产。最终由总控复核各方证据后进入另行授权的发布窗口。

本站材料只覆盖驾驶舱。按最新人类范围，闲鱼不改登录、CLI 或 MCP，不迁移，也不附带清理其账号或业务数据；不得将本站发布步骤扩展到闲鱼。

## 准备期与最终切换

服务器默认 `legacy`，用于在准备期保留现网原入口。CLI 2.0.0 默认 `unified`；因此准备期服务器上的默认 CLI 授权不可用，需明确选择 `--mode native` 或 `--mode managed`，且当前服务器公开配置必须同时声明 `mode:legacy,legacyAllowed:true`。这项兼容不能作为最终统一账号交付，也不能为绕过新验证长期保留。

最终统一模式必须显式设置服务器 `ZIWEI_IDENTITY_MODE=unified`，配置受信 OP、本站 client secret、共享会话加密 key，以及核实后的 `(issuer,subject)` 到原生账号/员工/工作区绑定。缺失配置应拒绝启用，不能恢复旧密码、旧 Cookie、静态 owner Bearer 或按邮箱自动合并。此次仅准备实现与验收；不改变 API 的默认模式。

## 发布前必须明确的配置

以下是变量名和校验规则，实际秘密由受控渠道注入，禁止写进 Git、CLI 包、公开文档、截图或普通日志。

| 服务器变量 | 发布核对要求 |
| --- | --- |
| `ZIWEI_IDENTITY_MODE` | 准备期保留 `legacy`；仅在发布窗口显式切为 `unified` |
| `ZIWEI_IDENTITY_ISSUER` | 已实际部署并核实的精确 HTTPS realm issuer，无尾斜杠；候选域名不是配置证据，无默认 fallback |
| `ZIWEI_IDENTITY_ORIGIN` | 发布时必须显式设为由 186 现场核实的实际业务 HTTPS origin。代码中的历史默认值不能证明 186 当前域名已生效，也不能拿旧 URL 当本轮发布地址 |
| `ZIWEI_IDENTITY_API_SECRET` | confidential `ziwei-workspace-api` introspection secret，仅服务端持有 |
| `ZIWEI_IDENTITY_WEB_SECRET` | confidential `ziwei-workspace-web` code/refresh/revocation secret，仅服务端持有 |
| `ZIWEI_IDENTITY_SESSION_KEY` | 32 随机字节的 base64url 编码；安全注入，共享同一 SQLite 的 runtimes 必须使用同一 key；记录 key 版本及恢复程序，不记录值 |

网页 client 固定 `ziwei-workspace-web`，精确回调为实际 origin 的 `/api/identity/callback`，backchannel 为 `/api/identity/backchannel-logout`。API audience/introspection client 固定 `ziwei-workspace-api`；CLI 是公共 client `ziwei-workspace-cli`，不能注入 web/API secret。设备与网页普通授权只申请 `openid workspace:read workspace:write`，不默认 `offline_access`。

realm 需按已冻结共同配置验证 RS256、单一 audience、允许的 azp、AT 300 秒、PKCE S256，以及 AT 和 introspection 的本站角色 mapper。角色 `access/read/write/admin` 必须显式授予所需集合，`admin` 不自然包含其它角色；授权为已签发与当前 roles/scopes 及原生资源范围的交集。生产 DNS/TLS、OP 和 secret 来源仍须各自有证据。

## 生产文件基线与 overlay

总控只读核查确认，186 当前源码路径为 `/opt/ziwei/releases/failed-finalization-1b9dbe40f494-53492a2b/v2`；`1b9dbe40f494` 已是本轮 Git 基线 `19876c0` 的祖先。生产 app 对应该原始 Git blob，auth/repository 与当前基线一致。这只确认对应文件，不授权将 Git 整树当成生产现状。

已核实与 Git 不同的生产文件包括 `backend/db.mjs`、`backend/storage.mjs`、`backend/management.mjs`、`backend/version-preservation.mjs`、`backend/production-preservation.mjs` 和 `package.json`；实际 `device-updates.mjs`、`ziwei-connect.mjs` 与保留的 Git 来源一致。证据为 `workspace-source-provenance.json`、`overlay-source-comparison.json` 及总控只读复核。**这是已核实文件范围，仍可能有额外 overlay；完整来源与增量安全保留核查未完成。** 不得因为 app 相同就整树覆盖，不能把差异猜成可删除的临时修改。清理快照核实 49 表 152,582 行，不表示代码中的每个 overlay 行为已完成发布迁移审查。

发布前分别固定代码候选 commit/包 hash 和生产文件 fingerprint，审阅 overlay 的数据路径、迁移、依赖和恢复作用，将必须保留部分纳入增量发布与恢复证明。没有这一步不得整树覆盖、重置生产文件或仅用干净 Git 备份替代实际部署快照。

## 原生绑定、保留与恢复门槛

`backend/identity/bindings.mjs` 的 `bindings.bind(...)` 是受信服务端 provisioning 接点，非 HTTP 接口。输入必须来自经审阅的精确 issuer/subject、已存在的原生 user ID、工作区 ID 和当前 membership。员工还需一个既有员工、其原生 owner、唯一工作区；机器 client 必须显式登记为本站单员工 client，不能自行提交 employeeId 获得身份。

本轮没有公开生产绑定写入命令。生产 provisioner/迁移调用方式、审批与审阅后的绑定清单须在切换前明确；不能让操作者直接按邮箱关联、创建空替代账号或在业务数据库里手写身份。实际保留账号及业务归属由清理负责人核实，秘密账号信息不得放入公开 CLI 文档。

指定管理员及已核实归属保留；其它账号只对明确归属条目准备清理，shared/global/unowned/mixed 未知项保持待判定。协作计划中央 subject 保留并集不得被本站清理误删。已完成一致快照与隔离恢复仍不代表删除意图获批；原 15 项测试及 1,237 条 partial proposal 是历史证据，不能代替最终完整分片覆盖、独立 source/admin/review context 或真实生产恢复。

清理边界修复已由新鲜独立审查复验：有效配对电脑凭据保持原状态，已撤销/已消费凭据不复活；metadata probe 明确不完整，另以闭合一致 SQLite backup、SQL 对象关系/内容及整个 object store path/size/content 构造完整 snapshot 指纹。正文与无引用对象单独变化、损坏对象、路径别名、外键异常及大表依赖均有负例，清理测试 25/25。有效/撤销状态只代表该恢复点；上线前仍须合入最新操作凭据撤销账本。

186 的闭合备份 SHA-256 为 `2c21ba50d218b5d9b56a307c7203c1d30448d823ee48dfcfeaf2e96c313fa1f9`；SQL-only 隔离恢复为 `bb7fe95833d1e0e5e5d2ada9a8f4cfee2367bbb11e069ef973141a7ba1f97e32`。总控独立只读检查备份/恢复前后 hash 不变、SQLite integrity 通过、FK 违规 0，服务端 root 私有目录 0700/文件 0600。恢复副本仅禁用旧网站凭据，未修改生产，也未启动副本业务服务。

完整 store 扩展含 4 文件、24,288 bytes（含 1 个归属待定的 63-byte 未引用对象）；4 份备份和 4 份隔离对象经总控独立逐个重 hash。完整 source fingerprint 为 `6562cd3c670a7c16d867cd76d94a9f210728598390139787e3b7f74f4440410b`。对象内容、路径/map、真实 DB 和逐行投影留在受保护证据存储，不进入 Git，不能把备份完整性当作删除授权。

最终 v3 分片 summary 覆盖 49 表、152,582 行：152,580 条主 typed native references 分布于 152 片，其余 2 行 schema_migrations 以基础设施 schema/count 保留；所有主引用不重复。归类为 preserve 34、delete 0、pending 152,546；validator errors 0，152 片全部仍为 pending，`globalInventoryComplete:false`。collection fingerprint `bc1dc1a836b929593bfae3959028a91dcbe91683193fcb63a3aad42b69542aaf` 是有序主引用集合摘要，不冒充共享单数组 inventory hash。三项新增表按已核实源码分类：device_updates/ziwei_connect_runs 为 native actor，ziwei_connect_bindings 为 platform account。

实际源已被观察并独立读回；共享 validator 的 `pending_source_baseline` 表示逐批受信 source/admin/review context、跨片 cascade、逐片恢复绑定与 disposition 尚未完成，不表示备份仍未发生，也不表示可以删除。整体 SQL 与 objects 恢复事实不能自动满足每片的恢复绑定门槛。未发生生产删除、中央 subject 或闲鱼操作。

## 已完成的固定 OP 与独立审查

Keycloak 26.8.1 本站 HTTPS 隔离基线 22/22，通过 52 次真实 introspection、7 次真实签名 backchannel；另有 worker/三个 client mapper 与 client-scope、group/composite、client 禁用专项 13/13、76 次真实 introspection。两轮产品源码 hash 相同，执行脚本快照不可变；总控另核 report 与执行快照 SHA。证据索引为 `workspace-final-verification.json` 和 `workspace-focused-verification.json`，均为合成 realm/账号，不是生产身份上线。

覆盖真实 CLI 设备授权 S256、人工批准协议、wait、/me/status、tasks list、Bot capabilities、refresh/logout 与旧 AT inactive；覆盖 BFF code PKCE/state/nonce/sid、Cookie 请求、当前角色/scopes 交集、管理员撤权、跨站拒绝和 backchannel 防重放。API 离线 34/34，CLI+文档 92/92；新鲜独立审查另跑 API 34、CLI 身份/竞态 40、cleanup 25 项并关闭 7 个 P2，结论为代码审查通过且外部验收待办，`productionReady:false`。

真实 Edge 页面尝试因一次性 fixture CA 未被浏览器信任而以 `ERR_CERT_AUTHORITY_INVALID` 阻止加载；未绕过警告、未关闭校验、未改系统信任。真实浏览器登录及 Secure/HttpOnly/SameSite 行为保持 blocked/pending。隔离 Node/KC 可信 HTTPS 协议测试通过不能代替浏览器或公网证据。测试 realm、进程、监听与临时秘密已回收。

## 本地交付与无监听验证

以下命令只构建/测试当前候选，不启动业务服务：

```powershell
npm run build --prefix packages/workspace-cli
node --test packages/workspace-cli/test/*.test.mjs test/workspace-cli-docs.test.mjs
node scripts/build-workspace-cli-docs.mjs --check
node --test backend/identity/*.test.mjs
npm run lint
npm run build
```

本轮独立 CLI 包验收脚本为 `.local/verify-workspace-cli-identity-package.mjs`，从原验收器派生，输出到新的 identity 证据目录。它在洁净 staging 中连续两次 `npm pack --offline --ignore-scripts`，核对相同 SHA-256，再从 tarball 安装到空 prefix、使用空配置目录验证版本/help/capabilities/参数错误/无身份失败/未就绪统一配置，最后卸载。它不读取真实凭据、不联网、不监听、不覆盖上一轮包和 receipt；记录上一轮文件 hash 保持不变。

实际包名 `@ziwei/workspace-cli`、文件 `ziwei-workspace-cli-2.0.0.tgz`；hash、字节数和安装证据见本轮阶段 QA/identity receipt。私有 tarball 不等于公开 npm 发布。可下载的真实不可变 HTTPS URL 及远程 hash 比对目前 pending，发布后补入回执。

文档源码 `scripts/build-workspace-cli-docs.mjs` 从实际 registry 生成三入口完整正文与 44 项 schema。除纯 handler 外，本轮 22 项固定 OP 隔离验收实际通过本地 HTTPS 匿名 GET/HEAD 六请求：正文/Content-Type/2.0.0 与全部 schema 一致，未知文档 404、私有资源 401。该证据属于已登记隔离 harness，监听/日志由 API 负责人管理并已回收；没有新启动文档业务实例。公网实际域名仍未部署/验收，旧 C14 的 1.0.0 证据没有被转签。

## 受控窗口的核实顺序

1. 总控核对最新源码/锁文件/静态资源与安装包 hash、独立审查、真实固定 OP 与本站 API/BFF/CLI 测试。实际机器运行时与 native 资源授权必须有各自证据；不会因 CLI 的只读 GET 成功自动通过全部员工工具。
2. 186 操作者核实真实进程/启动入口、当前环境模式、业务 origin、数据库/文件存储、持久日志及备份。保留原端口与原生入口；不用新默认域名或当前 Git HEAD 覆盖混合生产整树。
3. 完成绑定/provisioner、保留清单、完整 fingerprint、一致备份与隔离恢复，核实恢复后已撤销网站登录和已撤销设备凭据仍被拒绝。
4. 在批准窗口只发布经过核对的增量和配置，先以维护窗口限制业务写入；配置完整且显式绑定后启用服务器 unified，核对固定 origin/回调。实际进程操作沿用已核实入口，不在本材料中捏造 systemd/容器服务名或额外实例。
5. 用经授权的测试身份分项验收登录/SSO、跨站拒绝、组/组合角色/机器 client 的即时撤权、新增角色不扩大旧 AT、刷新、本站退出、backchannel、旧登录拒绝和原生越权。读回检查，不使用真实收费任务、消息或设备动作证明兼容。
6. 匿名无 Cookie/Authorization、不执行 JS 地读取实际 origin 的三个文档入口，核对 HTTP 200、Content-Type、2.0.0/1.3.0/1.0.1 正文和绝对链接；不存在的文档应为 404。记录真实 origin、响应时间、源码和内容 hash；本轮没有执行这些公网步骤。
7. 本地、OP、生产切换、生产数据清理和员工设备/工具可用性分别签署状态。最终通知由总控协调，不因包安装通过提前发布身份或清理生产。

## 必须单列的覆盖边界

CLI 的 unified AT 可在服务器公开允许的精确 native/mcp HTTP 路由上访问。保留的 `scripts/ziwei-mcp.mjs` stdio 脚本没有新增 OP 授权/RT 刷新，其 managed token-file 模板不能作为统一模式代理授权。旧 daemon pairing/A2A/terminal 机器协议沿其独立守卫保留，不代表所有 Bot 管理 MCP 已完成统一迁移。实际员工/工具获取、刷新、撤销其按站身份仍是部署验收项；未验证前记 pending。

当前统一模式拒绝原 WS/SSE 和 mobile notification-v2 适配器，网页使用每次验证身份的轮询。非交互机器 client_credentials 和全站 OP logout 未由 CLI 提供。私有部署环境可能有其它入口，必须以生产源核查为准，不能凭这一份本地源码宣布已全部覆盖。

## 回退与失败边界

CLI 二进制回退只重新安装先前已核验的 tarball，不改变服务端鉴权，不会恢复被 unified 拒绝的旧网站凭据。回退前逐槽退出；正在刷新/兑换或结果 unknown 的授权先核实或由 OP 受控撤销，不用复制旧凭据文件解决。1.0.0 程序只支持旧模式；统一服务器不会因安装旧程序而恢复登录。

统一切换后回退应用必须保持统一模式、已撤销状态与显式绑定，不将环境改回 legacy，不从旧备份复活密码/旧 Cookie/旧 token。若无已核验的上一版统一实现，应进入受控维护/拒绝访问状态，修复后再恢复；不能用当前 legacy 基线替换来冒称安全回退。

数据库与 objects 恢复需使用已经过隔离验证的同一一致恢复点，保留用户后续删除/失败/未知状态以及设备配对的有效/撤销区分。会话加密 key 的版本和数据库必须匹配；缺 key 时不解密或重置为默认秘密。账号/业务恢复不自动授权重新启用旧网站凭据。实际恢复命令、保护路径、密钥恢复和数据证明由对应生产/清理回执提供，未齐备时保持 pending。
