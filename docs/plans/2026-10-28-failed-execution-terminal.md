# 失败执行直接终结

用户已批准：失败或结果不确定直接保存、展示失败；后台归档不阻塞失败展示；保留原始回执，不自动重放。原进程仍在运行时保留执行位。

## 实现与验收

1. 在现有失败收尾与聊天测试中先覆盖：没有 ACK 也显示失败、停止失败轮询；已确认进程树退出可接新工作，明确存活的进程仍拒绝并行；用户再次确认缺失或不确定证据直接按失败结束。
2. API 把不确定结果持久化为 failed（包括自动化运行），保留结果正文及错误；继续禁止不确定业务自动重试。
3. 调整 Bot 执行占位判断，分开明确存活证据和业务结果不确定。后台归档协议及原始证据不改。
4. 聊天、员工状态和工作台显示统一失败；归档元数据继续可查，不当作前台等待状态。已有恢复/停止工具保留。
5. 运行相关无监听回归、lint、前端构建，独立只读审查；提交 codex 分支、推送 GitHub 并核对远端提交。部署、客户端升级不在本次推送结果内。

源码入口：backend/repository.mjs、backend/bots.mjs、backend/bot-execution-occupancy.mjs；frontend/src/conversation-execution-state.mjs、bot-failure-finalization.mjs、bot-presentation.js、components/BotMainChat.vue、components/BotWorkbench.vue。

验证入口：backend/bot-failure-finalization.test.mjs、frontend/src/bot-failure-finalization.test.mjs 及相邻状态回归。使用已有 node --test / npm run lint / npm run build，不启动业务实例或调用模型。
