# E02 明确推理等级与 gpt-6.1-sol / max 有界兼容验收

基线 96559f8eb1df9292e8d264daaa80a0d584408616。本补丁为一个完整的字段/原生证明/限定兼容提交；最终 SHA 在 `.local/e02-reasoning-effort-handoff.json`。E03 挑入后接参数 UI，Q01 独立做产品真实连续聊天/任务首链。本轮不进入 E03 预览，不重做外部能力探测。

## 最终行为

`config.reasoningEffort` 接受明确原生等级，随当前 revision 进入 create/recovery/validate/chat/task 的受信上下文。owned 新 HOME seed、每回合 HOME 和 bootstrap effective 保留同一值；managed policy/per-model override 改写则失败。未给字段的旧 Bot 不新增默认或继承来源强度，也不修改 Creator/旧 Profile。

原生转换及最终 SDK kwargs 均核对：包含 request_overrides/sanitization 和 SDK extra_body 覆盖语义。extra_body 改模型或等级被拒绝，非冲突参数保留。回执记录 requested/effective/actual/nativeActual/mode/actualModel，绑定 employee/revision/provider/model。服务端不接受明确等级缺少匹配 preflight actual 的成功验证。

仅对 `openai-codex + 精确 gpt-6.1-sol + max` 用项目内 adapter 补充真实接口已接受的 max，`nativeActual=xhigh` 保留安装版原始转换事实，`actual=max/mode=verified_gpt61_sol_max` 表示项目兼容后的准备值。没有修改安装版支持集合、源码、其他 provider/model/level；ultra 仍明确失败。其他显式 provider 等级尚无验证入口，返回 BOT_REASONING_PROVIDER_UNVERIFIED。

当前 Bot 按用户最新决定显式设置 gpt-6.1-sol / max；所有实现/QA 聊天的 ultra 设置与 Bot provider 的 wire 参数分开。没有自动降档或重试代码，不因超时、认证或限流改成 xhigh。已有机器代理变量经 source `.env` 的受信进程引用保留，不改系统代理或持久预览策略。

## 新鲜验证

- 相关 Node 定向回归 **96/96**（schema、恢复、revision、伪造验证回执、HOME/overlay、Bot API、原生入口、MCP、driver、运行生命周期、group、Creator 默认兼容）。
- 实际安装 Hermes 原生转换/最终 SDK 边界 **8/8**：ultra 拒绝、max 精确兼容、其他模型不扩展、managed 改写、转换后改级、最终 model/effort 改写、extra_body 冲突拒绝与非冲突保留、无显式字段无 hook。
- owned 原生 fixture **6/6**：含新 seed 保存/回执、不复制认证、来源 HTTP_PROXY/HTTPS_PROXY 只进当前进程且来源字节不变。
- lint **100** 个源码；Python AST **5** 个文件；diff 检查通过。
- 前一核心提交的 800/800 属于前一提交证据，本补丁不重复宣称全量通过。

本轮实际 bound Hermes 0.21.3 bootstrap 验收：`.local/bot-reasoning-1791879251390/receipt.json`。ultra 配置验证与模型启动前检查实际读到 ultra→xhigh，返回 BOT_REASONING_UNSATISFIED；模型回执 `neverStarted=true/externalModelCalls=0`。max 配置检查 requested/effective/actual 都为 max、nativeActual=xhigh、mode=verified_gpt61_sol_max；high/native 和缺省检查通过，managed 冲突返回独立错误。开通、被拒的模型 helper、原生 fixture harness 三个 Windows Job 均确认树退出/活动进程0；config-only 验证仍没有独立 Job 字段，不补造证明。

本机测试使用合成认证和全禁网络，实际 source 文件与安装源码/原 tracked 状态不变。它证明产品字段与原生 adapter 行为，不证明产品外部模型回合已通过。

## 独立真实服务兼容依据

Q01 probe `q01-max-proxy-bfd745ac-2933-4f95-be1c-9a91f4edfcaf` 经机器既有 `127.0.0.1:7890` 代理请求 `https://chatgpt.com/backend-api/codex/responses`。wire 模型 gpt-6.1-sol、effort=max；**HTTP200**，completed response 模型 gpt-6.1-sol、reasoning.effort=max。responseId `resp_06fad05399ddd6c1016acde4a00a448197835b2f019f3ee688`，input37/output37/total74 tokens，requestId 不可取得。来源与安装哈希不变、刷新/登录请求0，Windows Job rootPID29612/exit0/treeConfirmed/active0。

原始白名单证据在 Q01 工作树 `.local/q01-real-provider/q01-max-proxy-bfd745ac-2933-4f95-be1c-9a91f4edfcaf/provider-probe-result.json` 与同目录 process-exit.json。E02 只读核对并保存其绝对路径/SHA256及白名单摘要。ultra 的 Q01 HTTP400 参数拒绝保留在独立 Q 报告，不将安装版 clamp 当服务接受。

持久综合回执为 `docs/ops/2026-10-13-e02-reasoning-effort-receipt.json`。该外部服务能力依据支持此限定 max 兼容，正式产品两个 Bot/连续聊天/记忆/任务的真实 provider 首链仍由 Q01 完成。
