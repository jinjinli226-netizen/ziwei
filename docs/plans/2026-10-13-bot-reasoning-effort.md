# Bot 显式推理等级有界补丁

基线：96559f8eb1df9292e8d264daaa80a0d584408616。授权范围为 schema/API→queue/context→owned HOME seed/每回合 HOME/managed effective→native preflight/request 证明；旧缺省兼容、revision/恢复一致；不修改源 Profile 或安装版 Hermes。只在 E02 工作树实施，不进入 E03 预览。

先建立失败用例，覆盖原生等级验证、创建与确定失败恢复、版本化验证和执行、HOME/overlay、伪造回执拒绝；再补最小字段和传递。安装版原生测试覆盖显式 ultra→xhigh 拒绝、managed 冲突、请求准备边界匹配/改写拒绝、缺省无 hook。实际 bootstrap fixture 全禁网络，仅用合成配置/凭据与 Windows Job 证明。

用户随后选择 Bot 模型 gpt-6.1-sol，优先 max，明确不支持才可 xhigh；实现/验收聊天模型仍 gpt-6.1-sol / ultra。Q01 经机器已有代理取得 ultra HTTP400；max 的外部接受结果独立验收。只有取得真实 max 证据后，才能考虑项目 adapter 中限定 openai-codex + 精确 gpt-6.1-sol 的补充；不扩大其他 provider/model，不因超时/认证/限流降级。保持 source-native-store 与既有 HTTP(S)_PROXY 进程路由。

定向回归优先，本轮不机械重复上一核心提交的 800 项；最终以新鲜相关测试、实际 bootstrap/进程回执、lint/AST/diff 和清洁提交交接。模型等级不满足与模型请求外部失败分别记录。
