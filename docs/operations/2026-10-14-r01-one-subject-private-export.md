# R01：一条原动作的 Windows 私有材料导出

范围固定为 `action_8668054e-e2e9-476b-acb1-d20f561eb661` 已批准的历史材料。只在原 Windows 本机读取已有文件，输出新的私有包；不执行旧 inspect/helper、不新采 SDK/OS/HOME、不读取 auth、不控制客户端或服务、不调用模型或手机。该包只供独立字节复核，不能自动解除真实数据库债务或生成正式 source/action proof。

## 已恢复的准确清单

一次有限 `read_thread(includeOutputs)` 从 R01 原 handoff writer 与原 recheck 输出恢复 schema：

```text
refs = code[10] + evidence[12] + productBasis.code[2]
       + approvedGenerationSource + originalCaptureReference
```

不是一个待猜的 JSON pointer，也不是产品直接 policy 的11项。原 handoff 固定为：

```text
C:\Users\25941\.codex\worktrees\v2-r01-release-preparation\灵光爸爸拆解\.local\r01-abi-legacy-qualification-20261014\handoff-abi-legacy-qualification-01.json
SHA256 a74064567961cffab88e60ac5857f93a3a4adf9d8613d16ceb8a7301d048ab45
kind r01-abi-legacy-qualification-finite-checkpoint
commit af6d95e6947affb6275f9ab89d30ef5bde6d637e
```

26 refs 在原历史窗口全部匹配；当前 Mac 没有 raw 文件，未宣称 fresh 复核。工具内固定 handoff SHA/path/kind/commit 和准确组合，不允许 CLI 另选 manifest、callback、subject 或通用递归查找所有 path。已知原 collector/capture/两份 logger 的四个 byte pins 还须存在。

真实证据文件为原 approved inspect 副本、原 call 和 code-read 记录、原 capture time check、已批准 logger/cache副本与manifest、两份原审核、原测试记录及两个原引用，共14项；不因当前文件缺失而重采。12项历史公开代码若在原工作树已被后续提交覆盖，只允许从 handoff 固定的 af6d95 10个 Git blob 与 2ea61b6 两个模块读取本地 Git 对象；不checkout、不联网、不执行。Git LF/Windows CRLF 候选也必须精确匹配原 handoff SHA及bytes，导出清单标记 `approved-local-git-blob-exact-pin`，不冒称当前原文件未变。

## 原 Windows 的具体执行命令

发布者会交付此版本 `scripts/operations/r01-export-approved-legacy.py` 的确切 GitHub commit URL与源码SHA。将该单个公开脚本存到 `C:\Users\25941\Downloads\r01-export-approved-legacy.py` 后，在原用户的普通 PowerShell 运行以下命令。Python路径来自原历史 native reader 记录，不自动安装或选择其它环境。

只读核对（不创建导出目录）：

```powershell
& 'C:\Users\25941\AppData\Local\Programs\Python\Python311\python.exe' 'C:\Users\25941\Downloads\r01-export-approved-legacy.py' --mode plan
```

导出到全新目录；已经存在则拒绝，不覆盖：

```powershell
& 'C:\Users\25941\AppData\Local\Programs\Python\Python311\python.exe' 'C:\Users\25941\Downloads\r01-export-approved-legacy.py' --mode export --output 'C:\Users\25941\Downloads\ziwei-one-subject-export-20261014'
```

来源要求绝对规范路径、普通单链接文件、无 reparse/symlink/junction、实际文件句柄 final path精确吻合；读取前后identity/size/mtime稳定，逐项SHA/size匹配。新输出目录使用当前用户SID与SYSTEM的独立ACL，ACL未核好之前不复制。成功输出 `private-bundle.zip` 与其 `bundle-receipt.json`，ZIP回读包含原handoff、私有映射清单及26份准确bytes；所有原JSON原样保留，不重写 authorization 或 sourcePath。

stdout 仅 complete、计数、missing的index/错误码和包SHA/size，不打印日志、cache或call正文。缺文件/变更/未知原blob均按准确index报告，保留已有私有副本与 `export-manifest.json`，`complete:false` 且没有完整ZIP。没有搜索别树、从安全docs造字节或把部分包视作complete。

如果 Python311入口或原 handoff不存在，先报告该精确缺项，不能把另外一个工作树或MSIX cache当作原文件。将成功的私有ZIP通过私有文件传递给发布会话；原材料与输出ZIP不进入GitHub、安全文档或公开客户端包。

## 收到后的独立复核与范围

发布者先核原handoff固定SHA、ZIP成员路径/数量、逐files映射SHA/size以及14项真实证据原bytes。在准确最终产品模块上重新运行固定独立coverage verifier；必须有 `producerRead/copy/launch/resultRead` 四个 distinct callId 与原 inputSha256，核原code-read/copy/WMI PID/时间窗/同result摘要及严格logger前缀/rotation/boot关系。导出本身不把旧 qualified:true 当 callback。

现 `backend/preservation-legacy-integration.mjs` 固定调用独立 verifier，JSON没有callback入口。历史字节复核通过后，真正 action proof仍须真实当前 config/state、完整原action row及fresh operation/spec/freeze/challenge，不能将复制后的本地文件identity冒充原host当前identity。当前 namespaceComplete、formalGatePassed及originalActionProofMinted仍未知/false；Linux正式prepare的真实原scope停止与fresh汇总检查仍保留。

## 已执行验证

11/11有限一次性夹具测试通过：准确bytes/ZIP回读、不改原来源、missing/tamper拒绝、26唯一性及路径别名拒绝、auth/DB排除、symlink/hardlink拒绝、固定schema、只读plan、新目录不覆盖、限定Git代码恢复及真实证据缺失不可替代、非Windows CLI拒绝。另有源文件语法与diff检查。未运行原Windows输入，Windows ACL及native final path的实机结果没有声称已通过。
