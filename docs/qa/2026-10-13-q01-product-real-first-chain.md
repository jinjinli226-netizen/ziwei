# Q01 正式产品路径真实 Codex 首链

日期2026-10-13，Asia/Shanghai。作者核心补丁 `7e846cd845831357efe2f4ed402aec592d2fcb09` 已挑入Q01原冻结组合树为 `5ed970666907b16a1818464bbc0397ec7136d8af`。执行前核对HEAD与工作树干净，执行后HEAD及全部src/backend文件hash一致。Q01没有原创产品修复，也没有用harness改写model/effort。

## 当前结论

**真实产品首链的6个功能场景满足独立验收不变量。** 12个真实产品action全部succeeded，4个模型动作完成，实际请求和completed response始终为精确 `openai-codex / gpt-6.1-sol / max`，经机器既有127.0.0.1:7890代理。A/B命名Profile等于actual HOME，A连续主聊天在重建执行器后保持同一原生session和记忆，B隔离，普通任务使用A的同一HOME并读到原记忆。

必须保留一个验收脚本失败：原脚本把“每个请求都completed”作为计数假设，末尾断言 `4 !== 5` 失败，原始receipt仍为status=failed、日志和退出码1保留。期间一个请求收到明确SSE服务过载error，安装版在原动作内做一次有界重试。Q01没有重跑任何已完成模型动作；随后离线按“每请求有明确结束、重试只在明确失败后且身份/参数不变、无重复工具/任务作用”的不变量核对，5 attempts = 4 completed + 1 explicit error。功能结论与原脚本exit结果分开报告，不把失败文件改成passed。

这不是完整V2/正式部署许可。E03最终参数UI与发现状态P2修正仍需稳定候选联验；完整回归留到该候选，只做本补丁必要针对检查。没有切换正式服务器、客户端、域名、代理设置或操作手机。

## 实际路径和两个Bot

在Q01自己的内存DB、新workspace `q01-real-9189fcec`、新本地账号/配对设备中使用真实产品HTTP API、官方ActionScheduler/Delivery/Dispatcher、`createLocalActionExecutor`和安装Hermes 0.21.3。临时API只作平台控制，不提供模型假响应。模型请求出口唯一为 `https://chatgpt.com/backend-api/codex/responses`；其他非授权origin/DNS/socket及OAuth刷新在发送前拒绝。

| Bot | employee ID | 命名Profile与actual HOME | 主聊天 |
| --- | --- | --- | --- |
| A | employee_ba73a74b-0518-4b98-8462-eafac8e05ee9 | `bot-504caac5ec3d36140faa80b9`；`C:\Users\25941\AppData\Local\hermes\profiles\bot-504caac5ec3d36140faa80b9` | conv_617a6667-a769-457f-893a-2c07183ef07a |
| B | employee_e62fbab7-ebb7-4b4a-a5b2-601934484b9f | `bot-0bbf55723b92e51d62b69dc5`；`C:\Users\25941\AppData\Local\hermes\profiles\bot-0bbf55723b92e51d62b69dc5` | conv_cf1ec2e0-cef5-48a0-a8bd-ce63a39dc82c |

两者是全新QA所有权HOME，来源default只作初始化/认证只读引用。配置显式provider=openai-codex、model=gpt-6.1-sol、reasoningEffort=max、maxTurns=4、toolsets=['memory']、management=false。来源SOUL/记忆/会话/全局MCP未克隆；有界prompt均为合成内容，没有文件/手机/业务工具。

6个实际场景：

1. 两Bot经产品create和真正原生provision创建，原生resolver HOME=instance.home，validate/activate后实际config为max。
2. A原生memory read→CAS write→read，B原生read没有A标记。只使用QA记忆。
3. A首条真实主聊天返回原标记及FIRST；HOME/profileHome一致，树已确认退出。
4. 重建执行器后A第二条返回原标记与SECOND，原生session仍 `20261013_163005_8e41d3`。
5. B真实模型回合的session为 `20261013_163113_f893ce`，没有A标记。
6. 经真实产品普通任务HTTP入口创建一个有界任务，结果包含A原标记/TASK-DONE，HOME仍A；没有另造employee或任务重放。

首个模型action：`action_fef8905a-7d82-4114-b01e-b57f6b5f6302`，output为合成 `Q01-A-ONLY-9dc29bab FIRST`。产品NativeProof requested/effective/actual=max，actualModel=gpt-6.1-sol、nativeActual=xhigh、mode=verified_gpt61_sol_max；后两个字段诚实保留原安装转换与项目限定兼容。独立HTTP观察进一步核对最终SDK合并后的真实请求和上游返回，而不是只信NativeProof所选参数。

## 上游模型与计数

每次实际wire都捕获model=gpt-6.1-sol/effort=max和连接到既有代理；4份completed response也返回同一model/max。响应头requestId均不可取得，写null，没有把cache session header或responseId伪装成requestId。

| 完成的回合 | responseId | input/output/total tokens |
| --- | --- | --- |
| A首次 | resp_0d225ad0bdede454016acdec23e81081909345fff06987c106 | 3909 / 129 / 4038 |
| A继续 | resp_0d225ad0bdede454016acdec3f9404819082ee54f580fee6fb | 4636 / 163 / 4799 |
| B | resp_07e6d3cf4c690210016acdec5d6ee88196b5100044fd5bcdd6 | 3875 / 101 / 3976 |
| A普通任务 | resp_0d225ad0bdede454016acdec78a5688190a54b652caf15ffc2 | 5250 / 17 / 5267 |

完成响应总usage=18080 tokens。第一失败attempt未返回usage，不能补0或推算包含它的总计。产品proof中的requests是原生参数构造检查计数，不代替网络attempt计数。

## 一个SSE过载error与有界重试

首次A进程的HTTP请求已收到200响应头，SSE随后在16:30:21返回 `type=error`，并非DNS/TCP/TLS超时。Q01最初SSE白名单只取顶层code/param，未捕获嵌套error详情，记录null；原生QA Profile `logs/errors.log`独立给出同session、同时间的APIError：“Our servers are currently overloaded”，及2.333秒后 `attempt 1/3` 的重试。第二attempt仍同进程、session_id和cache请求标识、同模型/max，完成。对应线索保存在 `redacted-error-log.json`。

安装码只读定位：`agent/codex_runtime.py:559`从error SSE的顶层/嵌套message构造_StreamErrorEvent，`:736`精确error处理器直接raise；`agent/conversation_loop.py:1397`–1426的API retry loop捕获API异常后走 `handle_api_error`，并未进入有效response后的工具执行。`agent/turn_api_error.py:343`检查max_retries边界，`:373`–395作有界backoff/interrupt，再继续API循环。本次原生日志明确1/3，只发生一次恢复；没有配置或触发另一provider/model/effort fallback。

离线审计不以把期望改成5迎合结果：按PID分组关联每条request→HTTP response→completed/error，要求没有未知在途request；任何后续request必须发生在明确error后，model/effort/session headers不变。completed的进程数和模型action数一一对应。最终观测的数量是5/5 HTTP响应/4 completed/1 error。

副作用核对：

- dispatcher journal中12个action ID各一个started、一个completed；首action未重建，普通task.execute只有一个。
- A原生SessionDB为3 user+3 assistant（两聊天、一任务）；B为1 user+1 assistant。两者没有role=tool，也没有非空tool_calls行。
- A最终MEMORY.md仍精确是原API写入的合成标记；B不含该标记。没有重复memory/task作用。
- 无 transport-failure/未知请求重发、无刷新或来源保存调用。计数错误属于QA断言对合法失败attempt的错误假设，原始失败状态保持，后续只读审计另列结论。

## 完整性、退出与回归

source config/.env/auth前后hash一致；全部6685个tracked Python/JS/PowerShell安装码hash一致。Q01没有改安装supported_efforts或用observer覆写model/effort；observer只验证、记录白名单和阻断刷新/非授权请求。两个QA HOME的auth scaffold均为空、`.env`无非注释内容，未复制凭据。

12个产品动作全部succeeded。2个config-only validation同步返回但无Job字段，未补造。其余10个provision/native/chat/task动作均root/treeConfirmed=true、activeProcesses0；scheduler/delivery已idle、dispatcher无quarantine，临时API与内存DB关闭。后续只读进程/监听查询没有发现该临时API端口或已记录Job root PID存活。QA HOME保留作证据，不存在长期测试实例或正式数据修改。

本补丁独立针对Node回归15/15，0失败/跳过；实际安装版纯原生reasoning/SDK边界8/8及7个config/拒绝场景通过，模型网络全禁、Windows树确认。这些是本次新执行，不借作者96/96或历史886/886作为Q01结果。最终E03组合候选稳定后再运行必要全量一次。

## 证据位置

执行产物：`.local/q01-real-provider/q01-product-real-fca3ac19-3e98-4a3d-9ef6-86fd52478d2d/`。同报告目录 `2026-10-13-q01-product-real-evidence/`已保存：

- original-run-receipt.json及product-first-chain.log：原始6场景/12动作及末尾计数失败，不改写。
- offline-audit.json、side-effects-audit.json、redacted-error-log.json、no-credential-clone.json：独立离线对账、日志关联、作用与凭据克隆检查。
- wire-*.jsonl：每进程真实请求/HTTP/终态响应白名单；不含auth header、token、完整原始provider响应或私有认证。
- product-first-chain.mjs/product-sitecustomize.py及audit脚本：本次方法可复核；只提供明确sourceRoot和stable SHA才可运行，不能对WIP或当前持久预览执行此harness。
- reasoning-owned-targeted.log、native-reasoning-receipt.json/native-fixtures.log：本次针对回归与原生边界证据。

先前真实capability max200/ultra400在阶段报告fc725363，仍单独保留，不能代替本报告的真正产品回合。当前UI/控制最终联验待E03新稳定candidate/checkpoint，16:10旧预览清理点保持有效，Q01在本轮真实首链期间未访问持久预览。
