# 工作区群聊直接入口

2026-11-01。用户在 `ziwei-ops` 员工工作台看不到 CEO 创建的群。经原创建会话使用当前官方 CLI 身份只读 GET 确认：`mix_averinyo_ops_v1` /「Averinyo · 全链路经营团队」存在，6 名成员，原回执状态为 partial。本次不创建替代群，不重放入职消息。

原网页只在 DSH/Codex 员工管理抽屉中挂载 MixedGroupPanel；未选员工及 Hermes 工作台没有入口，且该面板强制依赖员工。现在工作台左栏独立读取工作区已有群，在员工列表前显示“群聊”和成员数，选择群直接在中央显示讨论、成员与真实执行结果。

群选择使用 `/:workspace/bots?group=<id>` 路由，刷新、浏览器前进后退均可恢复。群不依赖某一员工或运行时筛选。点击员工返回原聊天；打开/返回群会使旧员工打开请求失效，避免迟到读取将页面拉回员工聊天。切群不会丢弃原员工未保存的管理草稿，也不增加确认步骤。

群面板支持工作区受控选择，不自动打开其他群。活跃成员运行每 4 秒 GET 更新，页面隐藏跳过、请求不重叠、卸载/终态停止；不重新发送任务。输入复用中文 IME 500ms 保护；消息视口复用 40px 跟随与 120px“跳至最新”规则。新建表单默认收起。

入口源码：`frontend/src/App.vue`、`frontend/src/components/BotWorkbench.vue`、`frontend/src/components/MixedGroupPanel.vue`。真实 Vue renderer/路由测试入口：`employee-workspace.test.mjs`、`employee-conversation-view.test.mjs`、`mixed-group-panel.test.mjs`（均在 `frontend/src/`）。仅发布前端静态资源，API/CLI/手机协议及正式业务数据保持。

本轮相关回归 123/123 通过，lint 检查 422 个源文件通过，生产构建通过；未使用 computer use 或触发真实群任务作验收。
