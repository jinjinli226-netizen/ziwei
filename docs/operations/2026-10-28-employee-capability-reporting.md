# AI 主动回填员工能力

员工或管理 AI 通过正式 CLI/MCP 回填 Skill、MCP、CLI，不再只能等待固定软件包扫描。支持增量登记、更新和移除；电脑离线也能保存与读取。报告沿用当前工作区成员、员工可见性、设备 scope 校验，不新增账号、安装、业务执行或模型调用。

## CLI

使用已有紫薇登录身份；managed 员工身份沿用相应 `--purpose employee` 等身份选择参数。

```sh
ziwei-workspace employees capabilities get --id employee_example
ziwei-workspace employees capabilities report --input-file report.json
```

`report.json` 示例：

```json
{
  "id": "employee_example",
  "idempotencyKey": "capability-video-cli-20261028-1",
  "entries": [
    {
      "kind": "cli",
      "id": "my-video-cli",
      "name": "视频 CLI",
      "command": "my-video-cli",
      "status": "working",
      "description": "本次已成功调用，支持查询视频生成任务。"
    }
  ]
}
```

- `kind`：`skill`、`mcp` 或 `cli`。不受原 CLI 扫描软件包名单限制。
- 同员工、同 `kind/id` 后续报告更新该条，不覆盖其他条目。`status: removed` 移除该条，保留历史报告。
- 状态：`declared` 已登记、`working` 自报可调用、`failed` 自报调用失败、`removed` 移除。安装/配置或实际调用结果变化后回填，无变化不用重复提交。
- 报告最多 100 条，读回最多 300 个当前条目。稳定 `idempotencyKey` 用于相同请求去重；改变条目内容时使用新键，未知网络结果先 GET 回读，不自动重试业务。
- `command` 仅命令名；不提交参数、绝对路径、环境变量或密钥。`description/version` 可选。
- `evidenceActionId` 可选，必须属于同工作区、员工、电脑、Profile 的原终态 action。它是关联原记录，不自动证明具体工具已成功执行；运行中的本轮 action 不能冒充已完成证据。
- 顶层 `ziwei-workspace capabilities` 仍是离线命令目录；员工清单是上述三段命令。

## MCP 与 API

同一能力由两个正式管理工具提供：`ziwei_get_employee_capabilities`、`ziwei_report_employee_capabilities`。工具说明会告知 AI 何时回填、如何更新与移除，不要求它为登记而运行额外业务。

- GET `/api/workspaces/:slug/employees/:id/capability-inventory`
- POST `/api/workspaces/:slug/employees/:id/capability-inventory/reports`
- managed MCP 使用对应 `/mcp/v1/workspaces/:slug/employees/:id/...` 路径。
- POST body 是 CLI JSON 去掉路径字段 `id`；返回 `source: agent_reported`、报告 ID、`duplicate` 与当前 `reported` 条目。
- GET 保留原 `sections/snapshot` 自动检测合同，另加 `reported`。客户端显示来源，不将自报写入或伪装为 `device_readonly`。

网页在同一 Skills/MCP/CLI 分组展示回填条目，标注“AI 回填 · 自报可调用/调用失败 · 未经独立验证”。授权和加载层仍保持未知，AI 不能任填 `verified/loaded/authorization` 改成已验证。自动检测与自报可同时保留；同名条目以来源区分。配置变化标为旧配置；员工 owner、设备或 Profile 变化后不泄露旧绑定的回填记录。

## 实现与发布边界

- 新增 SQLite 表 `employee_capability_reports`（`CREATE TABLE IF NOT EXISTS`），保存增量报告历史与身份快照；不修改旧 action 或自动检测原回执。
- 后端：`backend/employee-capability-reports.mjs`、`employee-capability-inventory.mjs`、`app.mjs`、`db.mjs`。
- CLI/MCP：`scripts/ziwei-mcp.mjs`、`packages/workspace-cli/src/{registry,main,transport}.mjs`。三段命令只放行真实已注册操作。
- 原 CLI 生成器依赖已迁移的手机回执函数和缺失的 Provider 纯模块，本次修正生成源并重生成 vendor；不手改生成文件。
- 生成命令：`node packages/workspace-cli/scripts/build.mjs`、`node scripts/build-workspace-cli-docs.mjs`。公开命令文档随注册表更新。
- 生效需要部署对应 API/网页，并使用包含新命令的 workspace CLI 或新 MCP 适配器。旧客户端不会凭服务器更新自动获得新工具名；源码推送不表示现网或全部员工已升级。
- 回退代码不删除报告表或清库。旧前端忽略新增 `reported` 字段；原清单接口和旧记录保留。

## 验证记录

186 项相关测试通过，涵盖实际 CLI 登录→API 持久化→CLI GET→MCP 更新、离线读写、成员/个人可见性、幂等冲突、移除墓碑、101 次增量更新、设备检测原合同、CLI 身份/传输与生成文档。前端构建和 lint 通过；实际 Vue 渲染确认离线时自报 CLI 可见、不捏造授权/加载。workspace CLI 打包 dry-run 确认纯 Provider 依赖和新注册表包含在独立包内。未调用模型、启动业务实例或改生产数据。
