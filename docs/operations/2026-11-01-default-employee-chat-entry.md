# 默认直接打开员工聊天

2026-11-01。用户要求：打开员工时直接进入聊天输入框，不先展示“打开聊天 / 管理伙伴”的选择页。

原因为 `BotWorkbench.vue` 的名册点击会打开聊天，但首次加载员工路由只读取员工，没有打开会话。App 聊天 slot 尚无内容时，组件显示了旧的二次选择入口。

本次由 App 明确标识有员工 ID 的默认 `/bots/:id` 聊天入口，工作台在该入口启用且员工读取就绪后自动复用原聊天打开流程。加载期间显示状态；读取失败显示错误和重试。已有 inbox 历史链接及 `?section=settings` 等管理入口不触发自动重选。手动名册选择与自动入口不会重复打开；右上角员工设置仍保留原管理抽屉。

源码：`frontend/src/App.vue`、`frontend/src/components/BotWorkbench.vue`。相关实际 Vue renderer 与 App 编译接线回归位于 `frontend/src/employee-workspace.test.mjs`、`frontend/src/employee-conversation-view.test.mjs`；验证 harness 只增加临时读取失败注入。

验证：105 项相关测试、lint（421 个源文件）及生产构建通过。覆盖 Hermes/DSH/Codex 首屏自动打开、路由切换、同员工返回、读取失败后重试、刷新不重开、手动选择不重复、历史/管理入口、IME 和流式滚动策略。此次仅改网页入口，不改变 API、CLI、手机协议或模型执行；打开聊天本身不会发送模型消息。
