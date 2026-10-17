# Bot MCP 网页远程授权

日期：2026-10-17，Asia/Shanghai。

## 目标与状态

用户要求在自己的网页或已授权的远程管理入口给数字员工接入 MCP，不到员工电脑开终端、修改 YAML、复制 Token 或手动重载。首次确需服务账号批准时，在管理员自己的浏览器完成同意；已有有效授权优先复用。

产品 `6666a63b46cd783d6a6537dd3295b37619ba4afa` 已先推 GitHub，并于当日17:34–17:43依次发布 API、Windows 安装包和网页。**真实 Windows 员工、Team Planner 和爆款库的账号授权与查询尚未验收。** 不把隔离 SDK/HTTP/UI 测试或安装包发布称为正式员工联通。

## 实现

- 复用 Bot「资料与工具 → MCP 与工具」入口，支持 HTTP/SSE 的 OAuth 公开配置、并发开关和 resources/prompts 过滤；爆款库提供预设。其他现有连接和显式权限保持。表单仍先保存配置，再发起连接。
- 中央保存 `auth`、`oauth` 公共参数；不接收 access/refresh token 或 client secret。OAuth 保持服务逻辑名称，非 OAuth 使用既有 `ziwei_external_` 名称；配置、聊天 argv、原生检查与调用使用一致清单。OAuth 名称与原生工具集冲突会明确拒绝，不能借同名连接隐式启用额外工具。
- `mcp.authorize` 是受现有设备、员工、Profile、revision/control epoch 和进程监督约束的原生维护操作。只有此隔离子进程收到三项受信 relay 环境变量，读取后立即移除；普通聊天和其他操作不继承。
- 目标电脑使用 Hermes 原生 Dashboard OAuth flow 和 SDK 处理发现、DCR、S256 PKCE、state/issuer、换令牌及刷新。凭据始终保存在目标员工实际 HOME 对应的原生存储；不复制来源 Profile 的令牌、不清理已有授权，也不建立第二套令牌存储。
- 主站固定 HTTPS 回调 `/api/mcp-oauth/callback`，只暂存有界浏览器交接。访问/刷新令牌和 PKCE verifier 不经过紫薇主站或浏览器中转，由目标宿主直接与授权/资源服务器交换；令牌只在目标 HOME 的原生存储中持久保存。回调按当前配对设备凭据、工作区、员工配置与控制版本再次核对，一次性 state 不可跨连接复用。主站重启使未完成交接失效，不动员工已保存凭据。
- 页面按已保存、排队、正在连接、等待授权、连接成功、失败/到期/取消显示状态。收到浏览器回调后继续等待原生工具发现与凭据保存；不能立即显示成功。授权链接不写入浏览器持久存储。切员工、工作区、账号后取消旧查询并隔离迟到结果。
- 成功表示目标宿主已验证连接和工具发现；**不表示给既有运行中的模型会话热插入工具**。下一次员工执行自动加载中央配置，不需管理员重启机器人。
- `ziwei_bot` 复用同一管理入口，提供连接发起、状态读取与取消；秘书/Creator 可返回待批准链接并继续查询结果，不要求管理员执行本机命令。
- 修复 management bootstrap 对已有所属用户的设备漏传 `deviceScope`，始终绑定经过数据库核对的当前认证设备；撤权、跨设备和成员失效检查保持。

## 版本与环境边界

本功能需网页、API 和新版 Windows `ziwei_user` 配套。新客户端通过心跳上报 `bot_mcp_oauth_relay_v1`。旧客户端不假装已远程更新，不向它排队不支持的授权动作；页面给出具体版本缺项。初始安装、配对、电脑在线，以及缺少原生 Dashboard OAuth 依赖的环境仍是实际前置条件。

已只读核对旧 `208f` 客户端：现有安全更新器由本机 CLI 调用，网页维护面板只展示命令；daemon 没有远程 `client.update` 动作。因此首次升级旧宿主尚不能承诺网页自动完成。本轮未通过通用命令绕过维护入口、未停止实际任务或改动员工凭据。升级完成后，接入受支持的 MCP 不再需要去员工机操作。

只支持原生可完成的远程 HTTPS 浏览器授权。服务仅登记本机回调、预注册 client_id + redirect_port、device-code-only 或依赖未安装时明确报告，不在员工机偷偷监听本地端口，不伪造 device flow。

取消授权只终止尚未完成的浏览器交接，不撤销已有服务授权，不伪造员工进程已退出。若进程树确已退出而最终 OAuth 设置回执丢失，连接显示失败并可重新检查原生存储；普通 `mcp.call` 的业务不确定性与进程退出门禁保持。

## 验证

候选综合回归 153/153、零失败、零跳过；另在登记 282 / 127.0.0.1:8181 的隔离 HTTP 服务完成一次认证网页及设备范围管理 MCP → 精确设备 → 回调 → 原生结果合同测试。lint 通过，前端构建通过。

原生测试使用官方 Hermes 0.22 和本机源码，分别搭配本机 MCP SDK 2.0，在隔离 HOME 中执行实际 `_probe_single_server`、OAuth provider/manager、Dashboard flow 和原生磁盘存储。只替换 HTTP 传输与 relay；测试禁止网络连接、DNS、监听及子进程。覆盖 DCR 固定 HTTPS 回调、PKCE challenge/verifier、state/iss、initialize/tools/list、缓存复用、原生刷新和网络失败后原令牌文件字节保持。两个版本另各有 21 项安全/失败子例。

隔离浏览器 9/9：预设及配置读回、保留其他服务与权限、唯一连接、授权链接、刷新恢复、切员工隔离、回调后仍连接中、宿主模拟终态后才成功，以及 390px/64字符名称布局。没有调用真实员工、模型或手机；设备端授权和工具回执为模拟。证据在 `.local/mcp-oauth-ui/`，本地运行记录在 `.local/remote-mcp-oauth/`。

公开爆款库发现元数据可达，授权码 + refresh_token + S256；未授权 initialize 返回 401 并指向资源元数据。它不等于完成账号授权。Team Planner 地址未包含在本次交接片段中，未猜测地址或替员工授予权限。

已只读核对实际 Nginx：根路径由 SPA 处理，`/api/` 代理到 API。公共回调因此固定在 `/api/mcp-oauth/callback` 且注册在登录中间件前，无需更改 Nginx。更正回调前缀后重新通过原生 SDK、HTTP 与9项浏览器回归。

## 发布与回退

先提交并推 GitHub，再通过正式 API、前端和 CLI 发布通道分别上线。API 不新增数据库表或迁移；仅增加内存中的有界授权交接与原 JSON 元数据字段。保留当前聊天、员工、任务、Profile/HOME 及既有发布记录。代码回退不得恢复旧业务数据库；新增原生凭据也不因代码回退而删除。

API 发布器复制当前活动 release，仅替换经 hash 固定的精确源文件，检查前端/CLI/保护模块/外部服务和原库逻辑 schema。CLI 包包含全部新增 JS/Python，需冷空缓存离线安装验证；发布包不等于在线电脑已安装。每次 stage 只能执行一次，未知结果先只读检查，不重放或盲回退。

### 实际发布结果

| 部件 | 时间（Asia/Shanghai） | 结果 |
| --- | --- | --- |
| API | 2026-10-17 17:34:11 | `/opt/ziwei/releases/remote-mcp-oauth-6666a63b46cd-a5b46d87/v2`，PID `364287`，8份精确源文件更新；内外健康200。公共回调无参数400且不是SPA，匿名管理接口401。独立16项检查通过。 |
| Windows 安装包 | 2026-10-17 17:41:37 | commit `6666a63`，build `7b4939c27eb485e0a1eff0635a698eb64b088dbff8ced84391ce1e87889bc212`；1,086,600字节，SHA-256 `b2515f91a7d433d2acb43529a5a14ed21b6137ba4bead7dc1533cac40d4a2da9`。服务器冷缓存离线安装及公网下载哈希通过；独立13项检查通过。 |
| 网页 | 2026-10-17 17:43:53 | 同一commit，入口 `index-DI_NO0_n.js`；首页SHA `3ae8783d4c5e4e94e870456a227de24f5dc54539730a02b27d690c4147e95857`。13份发布文件逐项公网校验；17:45独立13项复核通过，50份原有资源逐字节保持，API、CLI、服务和数据库保护状态保持。 |

API 原活动目录为 `/opt/ziwei/releases/mobile-images-9668962e1c16-1204ed1a/v2`。只复制当前完整活动树并覆盖8份固定源，不以旧Git快照覆盖此前现场修补。原数据库文件身份、逻辑schema、持久目录、三份旧发布记录、中控与Nginx保持；API重启使未完成的内存授权交接失效，既有原生凭据不受影响。

客户端首次准备校验因 `git archive` 按 `.gitattributes` 输出CRLF、`git show` 返回LF而拒绝。未改产品包或跳过校验；发布工具改为核对实际archive原始字节，43份源SHA全匹配，路径/类型/范围限制保持。26项离线发布检查及独立复核通过；原失败证据保留。前端发布器14项故障模拟通过。

本轮没有更新实际Windows客户端、发起真实员工授权、执行模型或手机任务。最后一次发布前只读快照中，公司台式及全公司最强电脑仍为 `208f2350…`，李金晋电脑为 `9230ce66…`；需要后续新build与 `bot_mcp_oauth_relay_v1` 心跳才能认定已安装。爆款库公开发现可达不等于账号授权成功；Team Planner实际地址未在交接片段中给出，未猜测或给任意员工授予权限。

### 发布证据与保留数据的回退

本机证据目录 `.local/remote-mcp-oauth/`：API `publish-result.json` / `inspection-api.json`；客户端 `client-publish-result.json` / `inspection-client.json` / `offline-recheck-linux-x64.json`；网页 `frontend/publish-result.json` / `frontend/manifest.json` / `inspection-frontend.json`。原始快照与访问配置只留本机受限文件，不提交凭据。

- API stage：`/opt/ziwei-staging/remote-mcp-oauth-6666a63b46cd-2fdeabfb`。
- 客户端备份：`/opt/ziwei-staging/backups/remote-mcp-client-3c465fdb08f14d50948e319900d98821`。
- 网页备份：`/opt/ziwei-staging/backups/frontend-remote-mcp-6666a63b46cd-20261017T094353Z-853176fd`。

回退前重新核对current、发布锁、实际进程身份、包和静态文件哈希，拒绝覆盖其他后续发布。各部件可按证据单独回退：API切回上述上一完整release并重启API；网页恢复本轮备份的首页和元数据、保留哈希资源；客户端下载恢复备份的latest包与元数据。**任何代码回退都不能恢复旧业务数据库、删除新任务/聊天，或清空Profile/HOME及新授权。** 实际Windows已安装版本另行核对，不把服务端包回退当成员工本机已降级。
