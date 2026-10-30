# DSH 原生插件同步合同（2026-10-30）

范围仅 DSH。Hermes 沿用自身原生插件、Skill、MCP；不共享配置或加载器。本批源码待整合，未部署或重启任何正式服务。

## 数据来源与边界

- DSH Hub `GET/PUT /api/bots/:botName/plugins` 读取安装包中真实 Web bundle catalog，并读写该 Bot 的 `home/profiles/web/package.json` 的 `dsh.profile.bundles`。保存仅下次启动生效。保留必需和现有自定义 bundle、其他 manifest 字段。
- 已运行 Bot 的原生 RPC `pluginManager/listBundles`、`pluginInventory/list` 提供当前运行时 bundle 与 Cordis Loader entries/preset rows，`fiberPhase` 是实际观察值。运行时 bundle 清单可能多于 Hub 的可切换 Web catalog（本机只读实测 20 对 14），两者分开报告。
- 原生 `settings/describe` 的 schema 是 `schemastery` 引用图：`uid` 指向 `refs` 根节点，object 的 `dict` 为字段到 ref 的映射，union 的 `list`、array/dict 的 `inner` 为引用。只回传字段元数据与约束，不返回当前配置值、默认值、凭据或原始诊断。本批不暴露任意 settings 写入，字段编辑继续使用原生 DSH。
- 原生安装源码定位：`app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/{index,typert.host}.js`、`dsh-host-plugin-inventory/lib/{index,typert.host}.js`。Hub 来源：`D:/dshbot/plugins.rs`。

## API 与载荷

网页前缀 `/api/workspaces/:slug`；管理 API 前缀 `/mcp/v1/workspaces/:slug`。均以当前员工可见性、设备归属和授权检查为前提。

| 方法 | 路径（前缀后） | 请求 |
| --- | --- | --- |
| GET | `/employees/:id/plugins` | 无；只读已有设备观察快照 |
| POST | `/employees/:id/plugins/refresh` | `{ "idempotencyKey": "refresh-1" }`；key 可省略 |
| PUT | `/employees/:id/plugins` | `{ "enabled": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], "idempotencyKey": "save-1" }` |

PUT 要求先取得当前、未过期的原生 catalog。最多 128 个不重复 id，每项最长 240 字符，必需项不能删除。仅接受上述字段，不接受 URL、路径、Bot 名称或另一个设备 ID。相同 key 不同 enabled 返回 409 `IDEMPOTENCY_CONFLICT`。

所有成功响应使用同一 view。GET 200；POST/PUT 202 表示受理或当前不可排队，必须看 view 状态。`status: ready` 仅表示快照新鲜可读，不等于插件已在运行时加载。

### GET 尚无快照 / 老客户端

```json
{
  "schemaVersion": 1, "workspace": "team", "employeeId": "employee-1",
  "subject": {"workspace":"team","workspaceId":"ws-1","employeeId":"employee-1","ownerUserId":"user-1","deviceId":"pc-1","runtime":"DSH","profile":"alpha","revision":null,"controlEpoch":null,"configFingerprint":"…"},
  "status": "unknown", "reasonCode": "CLIENT_NOT_REPORTED", "stale": false,
  "plugins": [], "runtime": {"status":"unavailable","reasonCode":"NOT_OBSERVED"},
  "configuration": {"status":"unavailable","writable":false,"namespaces":[]},
  "running":null, "ready":null, "restartRequired":null, "notice":null,
  "snapshot":null, "pending":null, "lastAttempt":null
}
```

尚未请求为 `NOT_REPORTED`；离线为 `DEVICE_OFFLINE`。设备需上报 `runtimeDiscovery.features` 包含 `dsh_plugins_v1`。

### POST / PUT 排队

```json
{
  "schemaVersion":1,"workspace":"team","employeeId":"employee-1",
  "subject":{"workspace":"team","workspaceId":"ws-1","employeeId":"employee-1","deviceId":"pc-1","runtime":"DSH","profile":"alpha"},
  "status":"pending","reasonCode":"REFRESH_PENDING","stale":false,
  "plugins":[],"runtime":{"status":"unavailable","reasonCode":"NOT_OBSERVED"},
  "configuration":{"status":"unavailable","writable":false,"namespaces":[]},
  "running":null,"ready":null,"restartRequired":null,"notice":null,"snapshot":null,
  "pending":{"actionId":"action-1","status":"pending","operation":"apply","expiresAt":"2026-10-30T10:01:00.000Z"},
  "lastAttempt":{"actionId":"action-1","status":"pending","operation":"apply","createdAt":"2026-10-30T10:00:00.000Z","completedAt":null,"reasonCode":null}
}
```

示例 subject 为简略表达，实际为上面的完整 subject。已有新鲜快照时，pending view 的 plugins/snapshot 可保留上次观察。前端以 pending 禁用保存/重复请求；轮询 GET 至 pending 结束。重复相同 key 可附 `duplicate:true,actionId`。

### 设备完成后的 GET

```json
{
  "schemaVersion":1,"workspace":"team","employeeId":"employee-1",
  "subject":{"workspace":"team","workspaceId":"ws-1","employeeId":"employee-1","deviceId":"pc-1","runtime":"DSH","profile":"alpha"},
  "status":"ready","reasonCode":null,"stale":false,
  "plugins":[{"id":"@deepseek-ai/dsh-base","name":"Harness 基础能力","description":"…","enabled":true,"required":true}],
  "runtime":{"status":"observed","bundles":[{"name":"@deepseek-ai/dsh-base","enabled":true,"availability":"profile","installed":true,"optional":false,"removable":false,"rows":[{"rowId":"skill","moduleName":"@deepseek-ai/dsh-skill","entryId":"loader-1"}]}],"entries":[{"entryId":"loader-1","moduleName":"@deepseek-ai/dsh-skill","enabled":true,"fiberPhase":"active"}],"agentPresets":[{"id":"standard","isDefault":true,"rows":[{"entryId":"preset-tool-1","moduleName":"native-tool","enabled":"conditional","fiberPhase":"active"}]}]},
  "configuration":{"status":"available","writable":true,"schemaFormat":"schemastery","namespaces":[{"ns":"agent-loop","revision":"native-revision","schema":{"uid":2,"refs":{"1":{"type":"number","meta":{"min":1,"step":1}},"2":{"type":"object","dict":{"maxParallelToolCalls":1},"meta":{}}}}}]},
  "running":true,"ready":true,"restartRequired":true,"notice":"只修改当前 Bot 的插件组合，下次启动生效。列表表示已保存配置，不代表运行或账号连接状态。",
  "snapshot":{"schemaVersion":1,"subject":{},"source":"dsh-native","checkedAt":"2026-10-30T10:00:01.000Z","plugins":[],"runtime":{},"configuration":{},"running":true,"ready":true,"restartRequired":true,"notice":"…","actionId":"action-1","late":false,"stale":false},
  "pending":null,"lastAttempt":{"actionId":"action-1","status":"succeeded","operation":"apply","createdAt":"2026-10-30T10:00:00.000Z","completedAt":"2026-10-30T10:00:01.000Z","reasonCode":null}
}
```

上例 snapshot 为节略展示；实际完整保留该观察的 subject/plugins/runtime/configuration。Bot 名为 `subject.profile`；来源为 `snapshot.source`；catalog 为顶层 `plugins`；启用状态为每条 `enabled`。没有额外的 `catalog`、`botName`、`effect` 或 `error` 字段。原生 runtime 不可读时仅 `runtime.status: unavailable`，不编造 loaded。所有 notice/reasonCode 应按 saved/next-start/runtime 区分文案。

### 失败

输入/授权错误为非 2xx `{ "error":"DSH_PLUGINS_ENABLED_INVALID", "code":"DSH_PLUGINS_ENABLED_INVALID" }`。异步失败为 GET `status:unknown`、`reasonCode:OPERATION_FAILED`，`lastAttempt.status:failed`；可保留 `snapshot.stale:true` 供查看历史，顶层 plugins 不冒充当前。超时为 `OPERATION_TIMEOUT`；迟到回执为 `LATE_RECEIPT`。不要依赖原始错误文本。

## 设备动作与权限

`employee.plugins.inspect/apply` 经既有设备 action、ACK、execution-admission、result 链路执行。顶层 payload 只带 workspace/workspaceId/userId/deviceId，嵌套 `pluginOperation:{schemaVersion:1,subject,operation,enabled?,requestedBy}`。刻意不带顶层 runtime/employeeId，防止配置管理动作误入 DSH 模型会话终态协议。

创建仅允许专属入口；ACK 和执行前再次核对完整 subject、当前成员、员工可见性、设备凭据及 feature。设备本机读取配置的 `ZIWEI_DSH_BASE_URL`，API 不接受请求提供地址。服务器只保存设备回执快照，不保存另一份组合。Bot 或设备绑定变化后旧 action 不能写入新目标。

本批不启动、停止或重启 Bot，不更改权限模式，不安装 bundle/模型，不暴露任意运行时 RPC。未运行 Bot 仍可保存组合，加载状态为 unavailable。

## 验证入口

- 紫薇：`node --test backend/dsh-plugins.test.mjs test/dsh-plugins-dispatch.test.mjs packages/workspace-cli/test/plugins.test.mjs`（无监听）。
- DSH：`rustc --test tests/ziwei-plugin-native.rs -o .local/ziwei-plugin-native-test.exe`，再运行该 exe 的 `--exact ziwei_native_bundle_manifest_is_loaded_as_a_model_invocable_skill --nocapture`。
- 隔离测试通过真实 Hub route 写 alpha，真实 `loadProfileDirectory → composeEntries → boot/Cordis Loader` 加载安全 skill 子树，观察 `dsh-badge` 正文和 `modelInvocable:true`；beta manifest 字节不变且无该 skill。排除网络监听及模型服务子树，因此不声称整个 Web Bot 启动已验收。原生侧修改 alpha manifest 后 Hub GET 回读禁用。
- 未向正式 `community-lead` / `wenji-wechat` 写入；仅只读验证前者 14 个可切换 bundles、20 个 runtime bundles、194 个 Loader entries 和 4 个 presets。
