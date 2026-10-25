# Bot 伙伴的全部员工名册

2026-10-25。桌面 `GET /api/workspaces/:slug/bots?view=roster` 现在投影当前用户可见的全部员工，包含已初始化 Hermes、未初始化 Hermes、Codex 和未配置运行时的员工。原始 employeeId 保持不变。默认/MCP/mobile Bot 专属列表仍只返回 Hermes，避免破坏原生 Bot 操作合同。

名册不自动初始化、不创建员工、不替换运行时/Profile/HOME。非 Hermes 行提供 `canUseHermesBot:false`、`entry:employee`、`configuration_state:not_applicable`，已有会话只做轻量 ID 投影。前端默认全部，运行时筛选从当前名册真实数据生成；点击 Codex 等员工进入现有聊天，运行时未配置进入原员工设置。Hermes 仍沿原 Bot 工作台。

列表使用单次 API，无逐员工详情请求；已有会话用批量查询，历史提示词/配置/大型头像不进入名册。沿用工作区成员、个人员工可见性、设备范围过滤。跨工作区迟到回包不切换员工。

验证：`node --test backend/bot-page-read-view.test.mjs frontend/src/bot-mixed-roster.test.mjs frontend/src/bot-workbench-loading.test.mjs frontend/src/bot-workbench.test.mjs`。内存 SQLite/HTTP middleware 不监听端口；合成员工与会话不调用模型或真实业务。检查混合运行时、未配置员工、原 employeeId/会话不变、未新增 Hermes 记录、个人不可见、零完整 action 读取与非 Hermes 点击零 Bot detail 请求。源码需部署前后端后才在实际页面可见。
