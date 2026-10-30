# 2026-10-30 Hermes Gateway 会话工具集适配

## 真实故障与根因

新建 Bot 的无模型配置验证通过，但真实自我介绍在创建会话时返回 `invalid_params`，`session_id` 为空，实际模型请求为零。配置验证不能代替真实对话验收。

实际安装的 Hermes Gateway 先在 `_resolve_toolsets` 验证原生工具集名称，随后才挂载会话私有 MCP。紫薇把只在 bootstrap 子进程内注册的 `ziwei_autonomy` 和执行私有别名 `ziwei_management` 提前作为原生工具集提交，常驻 Gateway 不认识这些名称。

使用当前实际原生校验器、临时 HOME 与禁止网络/进程/私密文件读取的审计钩子复现：原完整列表返回 `invalid_params` / `field=toolsets` / unknown `ziwei_autonomy`，管理别名单独提交同样失败。原生 create/editor/resume/strict-submit 的结构校验通过，问题在工具集语义而非字段名。

## 修复

- 仅将实际已注入私有 MCP 服务器的别名从原生工具集参数中移除；十个原生工具集保留，未知自定义项继续由原生校验器拒绝。
- 管理 MCP 仍通过原生 editor 会话挂载。自主工具新增轻量私有 stdio MCP 服务，与原 `hermes-autonomy-tools.py` 共用同一 schema 和 handler，不改后端权限、幂等或调度逻辑。
- 自主工具仅在 Bot 已选择、未禁用且本次执行授权齐全时注入。凭据只走私有服务器环境，不进入命令参数、`client_env` 或日志。
- 保留原 Profile/会话归属、续接与 CAS、严格模型与推理等级回执检查。

本轮同时归并已部署的普通员工私有 MCP 修复 `94196d1`，避免源码与实际安装漂移。

## 验证与发布边界

Root 以实际 Hermes 完整依赖解释器独立运行相关回归：30/30、无跳过；lint 345 文件和 diff 检查通过。新增测试直接调用当前原生 `_resolve_toolsets`、`validate_editor` 与 ACP schema，并验证私有 stdio 握手及共享自助工具 handler。两位代理交叉审查无重要缺陷。

用户明确要求先不部署。候选代码未安装到正式 CLI，未据单元测试宣称正式网页已经恢复；真实隔离集成验收另行记录。此前失败消息与原始回执保留。
