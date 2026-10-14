# E03 finite repair scope and release boundary

本轮在 E03 `9491d5e3d572fcb787cb1f7567cdfed393975942` 上只修 native source 的可见直接后代漏判，并验证有限证据不足的具体边界。未停止正式12132、执行四个 launcher/installer、修改 SDK/HOME/auth、启用 OS 审计、重启主机或改变正式版本状态。SDK 的现有 unknown/refusal、inflight/pending/uncertain 规则保留。

## 可合入的窄修正

Windows inventory 现在保留 native CIM 的 createdAt。原 PID 已不存在时，仍作为遍历锚点关联可见直接子进程；absent PID 自身不会成为 members。直接 child 的出生必须不早于原出生；无法读取或无法核对出生保持 unresolved。若 inventory 中已经存在同数值 PID，不种 absent 锚点，避免用旧实例身份认领新进程。collector 自身及其实际子进程排除规则保留。

这是保守的当前关联，不是停止 allowlist。R 仍须对每个可处置进程独立核 PID+held birth+归属。修正不会重建已经消失的中间 installer，也不会将所有当前 Python 或 post-birth PID 当成 writer。

## R 证据的准确可证范围

已只读核对 R clean `4f218b90703324f877f1234b57d7a34380c09b63` 的安全说明、source02 和当前 repair inventory。R handoff SHA256 为 `5caa23e509891072649e8844eb95b98903f349bc4bae2a101231a4887b8d02de`；source02 为 `948df5560262007bef603883da07e6d467bfa4d287f1deef6a781cb0689c95d9`。三 marker 的 native不存在和755进程/31个保守候选的零匹配，是实际当前负证据，不是停止后树退出证明。

具体缺口在 `_install_repair.py:419` 的 `subprocess.run(cmd,cwd=root,check=True,env=env)` 和 `run_core_install`。uv 的 argv 可只是 `uv pip install -e .[all]`；目标 venv 由 VIRTUAL_ENV、项目由 cwd 指定。fallback 还包括 python -m pip、ensurepip、base/extras 安装。直接等待不提供每个历史 installer/build 子孙的独立退出证据。`_claim_recovery_lock` 遇普通 OSError 会继续 unlocked；lock/marker 缺失也不是可靠存活见证。

native cwd 和允许路径变量 VIRTUAL_ENV 能补足**当前直接 installer/repair parent**的归属，但不能独自证明已失去父节点的后代已退出或只剩临时目录效果。应先区分效果，不能把任意构建进程定为 protected-HOME writer：如果实际审核证明某 backend 仅写临时 build 目录，且没有活 installer 可向目标提交结果，可以排除它。当前 R refs 没有提供这个有限效果约束及对应历史执行身份。

补充只读查看了实际项目 `pyproject.toml:404–410` 和 setup.py：editable core install 选择 `setuptools.build_meta`，requires 指定 setuptools==83.0.0；setup.py 明确 editable 的 build_ext 路径不受 wheel/sdist guard 阻止。当前读取的文件 SHA 分别为 `eb0b8daac75c0c0e655282a1a836cb4c8a0bdc266e435a4d77e3295544ccf488` 和 `d476dd1c28d707acd72f1d0551d7178123832ae18b6e201ca1ac48cd040653ae`。这仅确认具体 editable-build 分支，未执行它、未证明历史上进入过它，也未把新的历史 hash 门槛加入产品。

不足的输入限于这条链：当次选择的 uv/pip/interpreter 与 installer PID+birth，实际 editable backend 的原生加载来源/有效目标和允许文件效果，以及其目标相关子孙的退出或效果终结事实。当前 selection、cwd/VIRTUAL_ENV 或 marker zero 不能倒推这些过去事实。R 对 Claude/Codex version 的 HOME effect 未知也尚未关闭；Hermes 子项不能借来放行全部 discovery。无需继续扫描全 OS/stdlib 历史 hash。

## 默认 native 隔离验证

两项新测试使用实际默认 native reader，无替代 IO callback：

1. 已退出原 parent 的活直接 child，命令路径在 scope 外，仅环境绑定保护 fixture HOME。旧遍历红测漏掉该 PID；修补后保留 child。其伪造 no-worker audit 仍拒绝。
2. 中间 installer 已退出，活 child 的 command/cwd 在 scope 外，保护 HOME 仅在继承环境中。sample 时原 PID absent、marker absent、匹配成员空；之后该同 birth child 可写保护 fixture 的 marker。invalid source audit 仍拒绝，不签闭合。

第二例是显式 detached 的无业务 Node fixture，**不是实际 SDK/uv 已留下 writer 的证据**。它证明当前字段集合不能区分这个存活状态；实际 SDK 的效果分类仍取决于上节的有限缺失输入。私有结果 `.local/preservation-native-qualification/repair-lost-ancestor.json` 显式记录 actualSdkExecution:false。测试自己的实例由 IPC/隔离 stop 文件受控退出，默认 native birth/absence 复核后才清理 fixture；独立父进程诊断保留 PID、heartbeat、exit/absence。

已有闭合的 literal no-worker native 正例继续通过，包含受控退出、变源和变路径拒绝。这不是 SDK positive。已有 held-handle/inventory/conhost 正例也做定向复测。没有重跑完整 suite 或原 SDK probe。

## 最小替代边界契约，交 E02/R/Q 审核

若有限 installer/effect 证据无法取得，可以选择旧 Windows 客户端主机的 kernel restart 边界；这是可验证替代方案，不自动成为必需操作。它关闭该旧 kernel 的全部进程，无需将未知进程当停止集合。影响范围是该 Windows 主机全部应用；须人类明确同意这一维护影响。普通精确 daemon/已归属 writer 停止已有部署授权，不能自动延伸成整机重启。原生计划入口为 `C:\Windows\System32\shutdown.exe /r /t 0`，本轮未调用。

建议接口保持在 source namespace 内，不改 formal state 或 debt：

| 项目 | 最小契约 |
|---|---|
| 固定 protocol | 新审核过的 `windows-kernel-restart-v1` 规则，仅允许原生 kernel 边界；现有 SDK protocol 不自动接受它 |
| approved binding | 新 producer 代码 pin、原 SDK/source refs、原 scope 和原实例必须由已批准 host/binding/spec 固定；JSON 不得提供替换审查规则 |
| before | 保留真实 held original PID/birth/boot/entry 和已批准原数据的签名 before capture；unknown discovery 可以作为原始事实保留，不能伪装成已完整退出 |
| after nested raw proof | `namespace.terminationBoundary` 的闭集字段可为 `{kind, originalInstanceDigest, oldBootId, newBootId, bootStartedAt, observedAt}`；身份/op/spec/host/freeze/policy/producer 继承现有 signed after envelope，原 before digest 由现有 previousCaptureDigest 绑定，不自引用 after digest |
| default native method | namespace/helper 新增实际只读 `readWindowsBootIdentity()`，返回 `{bootId,startedAt}`；仍用949固定系统 prelude/CIM，bootId 必须沿用当前 nativeBirth 的同一 OS boot编码规则。没有实际默认方法实现时不能接受该字段 |
| consumer | oldBootId 必须等于签名 before 的实际原 boot，newBootId 必须不同且等于当次 fresh native boot；原 birth 早于新 boot。仅比较 PID absent、操作者声称重启或旧 capture 都拒绝 |
| collect/recheck | 每个已认证 fresh source request/challenge 均独立重读 boot、原实例和完整当前 scope；当前外层 source proof 绑定这些事实。after 原始引用自身不能代替每次 fresh 读取；boot改变/来源改变/挑战或原身份不匹配均拒绝 |
| 新写入者 | R 先阻断精确旧 daemon/updater 的自动再启动，再查 fresh inventory；任何新旧入口 writer 拒绝，restore 仅允许实际签名并独立原生核验的同批 v2 runtime。全局 pending/uncertain 保持原规则 |

本轮**未实现/启用这个新协议**：没有 new-boot producer、fresh default OS boot 方法和经过批准的 after 消费链，单加 consumer 接受字段会形成误放行。协调线程确认后续这一必要 consumer 实现和隔离验证属于已授权的部署准备范围；实际整机重启仍须人类明确同意。E02/R/Q 先审核本接口及 before unknown 的处理，再实现安全默认拒绝的 producer/consumer 和对应 native 隔离验证，随后安排实际维护与新 capture。当前服务切换的阻断是有限缺失链；安全版本分支备份和最终包/功能 QA 可以继续。本有限 checkpoint 不自称正式 ready。
