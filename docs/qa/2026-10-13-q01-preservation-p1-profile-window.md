# Q01 P1：兼容 V1 的异步 Profile 别名窗口

候选 `8556aecb6a37385d9fc7061f989e97071bfd6cf9`。Q01 独立复现，未修改产品源码、作者目录、正式数据或安装 Hermes。RB22 本项 FAIL，相关封存签收暂停，其他独立验收继续。

## 实际结果

同批交付 `v1-compat` 的真实 local executor 在 final fence 通过后，等待 `managementBootstrap.prepare()`。此等待期间，QA 将普通 Profile junction 从自有 ordinary 目录指向自有 owned HOME。兼容 V1 adapter 随后重新读取此 Profile，实际启动已安装 Hermes，最终返回 succeeded；原 Windows Job root PID54344、root/treeConfirmed=true、exit0、activeProcesses0。owned HOME 新增 state.db/session/cache/logs/memory等原生文件。对等待后的相同 action/路径重新调用 fence，结果为 V2_OBJECT_SEALED。

这不是“认证缺失造成失败”的用例。custom provider 与管理token均为本地合成fixture，模型调用唯一为6399 loopback，Python外网socket/DNS禁用。原子操作属于Q自己的junction，不涉及正式HOME；旧原生安装未编辑。

## 精确层次

API execution-admission 响应是受控夹具：sealed、protectedHomes 指向QA owned、原action摘要匹配；其最初 ordinary Profile在服务器/客户端层本可合法执行。这里不把夹具算为真实HTTP admission链。实际兼容包源码/真实执行器、Windows文件junction、installed Hermes、loopback provider、owned HOME写入和Job回执是真实。

文件：`src/local-action.mjs:375`入口再次fence；普通 native 分派在453/454异步管理/terminal bootstrap后才455调用executeRuntime。V1兼容包保留原V1 runtime-adapters；本次不是纯cwd alias——Windows safeCwd已有realpath固定，也不是V2 marker mismatch负例。普通Profile alias最终选择仍可在最后fence与spawn之间改变。

## 可重复步骤

1. Q私有base HOME建 ordinary 与bot-owned Profile，均只有合成custom provider/.env，bot-owned有ziwei-instance.json templateId=ziwei-hermes-bot。ordinary-alias junction先指ordinary。
2. 导入Q复制的同批v1-compat执行器/产品角色，执行普通runtime.execute、Hermes、profile=ordinary-alias；fixture admission保存sealed/protectedHomes及原action executionBinding。
3. executor进入最终fence后调用可控managementBootstrap.prepare，在此barrier仅将junction切到owned；给有效JSON形状的合成MCP配置后继续。
4. 记录真实native result、Job与owned新文件，再以同样参数调用assertNoOwnedBotResource，后者明确拒绝。

原代码可用QA helper `.local/q01-preservation/repro-profile-window.mjs` 重复，但不得在原预览或正式HOME运行。helper固定Q01登记的6399，先查占用；原始私有路径 `.local/q01-preservation/profile-window-1791896595485/receipt.json`，stdout `.local/q01-preservation/profile-window-attempt3.log`。首次两次fixture配置缺启用/JSON凭据均未形成完整复现，独立保留，不能计为产品保护PASS。

同批client archive SHA `9252d2b73499719bcb04a63ab4a5fe45eb4503de62a7db33f22cf955c2b72d90`。v1-compat source build `7562457493b14d7c781647f776bc7fc1253e8589e97b24acfeff224c867d6b76`；manifest installed build `006573c242a5498eff490644c28d472eaeaf6d34695769c8e09bffb6eda6ecf3`。本项直接导入导出包源码执行器，不冒称已覆盖完整daemon poll/API流程。

修复由E02负责。签收需要在实际启动前最终选择的Profile/HOME再次核保护，并以本同类异步barrier正例确认V2_OBJECT_SEALED、native spawn0和owned字节无变；只扩大现有executor入口前的测试不能覆盖此窗口。OS级任意竞态隔离未在本例泛化。
