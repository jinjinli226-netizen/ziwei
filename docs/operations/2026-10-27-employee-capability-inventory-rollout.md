# 员工能力清单三层正式集成

来源：总控会话 2026-10-27 的直接人工要求“那为啥不安排上线啊”。原 `67b85ab0247805bc4fe6ef740c3865e28229dd8a` 是源码交付，不代表网页/API、正式客户端或实际员工清单已上线。本事件按最新明确授权推进三层：网页与 API、正式 ziwei_user、李金晋单台电脑的受支持空闲升级及只读快照验收。其他电脑不批量升级；已由用户自行恢复并停止的推理事件不重新触发。

## 实际基线与完整支持门控

正式基线按现网混合源码冻结：安装页 `b75b4c8` 的新域、QR 和当前入口资源均保留，API 还包含精确叠加的 `device-updates` 修复。客户端基线是两官方域实际完整下载验 SHA 后的 `0.1.3 / 56511f8f…`，归档 SHA `ac6e2989f2bfa33898ea211eb639b33ae0aca3ebef820cf6b4ba14aefca96e64`。

隔离执行实包发现：0.1.3 的 daemon 虽误报 `employee_capabilities_inspect_v1`，包内却缺采集器及 handler、派发 cwd/截止、15 秒/60 秒 budget 和服务端准入 hook；真实 dispatcher 返回 unsupported，不能按旧标记派检查。完整新实现使用 `employee_capabilities_inspect_v2`，动作类型和快照 schema 继续为 `employee.capabilities.inspect / 1`。创建、ACK、执行准入都核对当前 v2；排队后客户端降级也必须拒绝。显示版本递增为 `0.1.4`。

客户端候选从实际正式包精确叠加功能文件及版本，保持原依赖和其余程序字节。Hermes Gateway 桥、0.1.3 维护完成证明/回滚恢复/启动预算不改；内含旧原生补丁材料不以工作树新副本覆盖，实际 Hermes 原生进程、源文件和 Profile/HOME 不因本功能重载或迁移。

## 上线前审查修正

- 通用动作 GET 不能以原请求 userId 绕过嵌套清单 subject。对该专用类型重新核对当前员工、所属用户、工作区和设备权限，归属或可见性变化后不能读取旧 raw payload/result。
- 个人工作区设备归属与当前成员角色使用同一授权谓词贯穿读取、创建、领取、执行。原请求者管理员降为成员后，不能继续检查非本人设备。
- 页面刷新遇到明确 401/403/404/410 或 scope 错误时清除旧详情和轮询。网络结果未知保留“先读回、暂不重复提交”保护。非 Hermes 同身份修改 skills、管理 MCP、model、status、cwd/cwd 设备时，以当前员工公开配置的稳定 key 提升 generation，丢弃旧延迟响应；不伪造服务端 configFingerprint。
- 文件目录使用 bounded iterator，上限加一项即停止并关闭；不先读完整目录再 slice。原生技能策略不可读取时，空技能根不能显示完整零项；已有条目保持 partial。quoted dotted TOML MCP 名称能读取，未适配的表拼写显示 partial，不静默返回 ready/0。
- 单份不超过 256 KiB 的 SKILL.md 为计算完整 SHA 会读取全文，只解析有界 frontmatter 并返回脱敏摘要/hash，不回传正文。不能宣称“不读取正文”。不读取登录凭据文件、执行 CLI 或导入模型运行时。

以上缺口均先用原实现复现红测，再最小修正，保留权限和严格绑定，不通过放宽校验满足展示。

## 验证与发布门禁

当前父会话联合 99 项通过、0 失败、0 跳过，lint 检查 268 文件通过。新增真实 App/SQLite 无监听整链覆盖缓存 GET 零动作、refresh、认证 ACK/admission、真实 dispatcher/文件采集、认证 result 和缓存回读；另覆盖两个员工同名 Profile、旧标记误报、配置与 revision 变化、迟到/撤权/错误设备/脱敏。前端控制器、实际 SFC watch 与现有 Workbench 相关回归通过；校准浏览器夹具不能冒充混合候选或生产。

源端命令：

```text
node --test backend/employee-capability-inventory.test.mjs backend/employee-capability-inventory-integration.test.mjs test/employee-capability-inventory.test.mjs test/employee-capability-metadata-boundaries.test.mjs test/employee-capability-dispatch.test.mjs frontend/src/employee-capability-inventory.test.mjs test/bot-capabilities.test.mjs
```

实际前端、API 和客户端分别按最新冻结混合基线形成可审核精确工件。必须保留安装页及旧指纹资源、当前后台修复、数据库、用户身份和授权。源推送并核对远端、完整候选浏览器/离线包及独立复审通过后，交总控审核并由既有 sole-writer 在新事件窗口统一发布；不直接整树覆盖。

上线后还必须经产品通道 `waitForIdle` 升级仅 `device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493`，核实际新版本/build/PID、配置原字节、认证心跳和真实维护终态。旧任务未空闲则等待，不强杀、不清队列、不重放旧更新。仅显式员工只读清单动作，不做模型、聊天或手机业务。最后核实际设备快照、选中员工入口可见、Profile/设备/revision 不串、返回不含 secret，才可报告已上线；其他旧设备仍显示未支持。

持续脱敏证据位于 `D:/AINavtie/ops/ziwei/employee-capability-inventory-rollout-20261027/`，以 `OWNER-STATUS.json` 分别记 source/platform/client/device 状态。当前记录是候选准备阶段，尚不声明正式发布、设备升级或真实快照验收完成。
