# Q01：cad5886d 有限独立源码检查点

冻结候选为 `cad5886d3dd5e6192bead8b85d40cc0d3ef4210f`，复审相对 `794ba7f` 的 12 个变更文件。**本次有限源码检查未发现可证实的新增 P1/P2 阻断；直接回归为 6 通过、0 失败、4 个 Windows 原生用例跳过。** 这不代表 G1–G5、最终六包或 Windows 实机验收通过。

用户明确不做 Mac 运行适配，Windows 无法远程，将在发布后本人实测。Q01 本轮只复核该冻结源码及现有无监听直接测试，R 仍是唯一推送与部署者；本报告未创建发布审批条件。

## 已核对的源码契约

- 普通 standalone 审计绑定真实原 entry/root 和实际非 SDK build；已审 SDK 身份不能降级成无 worker 字面程序。kernel archive 绑定原实例、完整源文件成员、字节、inode 和 before-capture 来源记录。
- 签名 restart fence 包含 stopped `sourceFiles`，消费端核对应 after 数组、真实新 boot、时序、原 entry fence及两次原生观察。SDK 日志 restore 仅允许保留同一文件身份和已签名前缀的追加，旧 PID 的 `action.started` 仍拒绝。
- 合格 archive 由成功 observation 的内部 WeakMap 提供；普通对象、JSON 副本、失败观察和外国 binding 不能取得该资格。
- source CLI 的前后两次 namespace observer 都传原 signed request。prepare/seal 在完整观察后选择合格 archive；restore 仍选择精确的实际 installed V2 target，原 config/HOME/连接 scope、未决债务和最终 recheck 没有被 archive 替代。
- POSIX 路径先于 Windows 路径判别，drive/UNC 路径保留对应 join；未增加 Darwin production nativeIO 支持。包构建和 API 临时路径调整只作有限发布工具检查。

关键位置（均按冻结 Git 对象一基行号）：`backend/preservation-source-namespace.mjs:137`、`:150`、`:184`、`:207`、`:294`、`:297`、`:515`；`scripts/production-source-proof.mjs:71`、`:118`、`:185`。另一只读 reviewer 对同一冻结对象复核，未报新增源码 P1/P2。

## 独立执行证据

实际在 clean E02 checkout 的该 SHA 上执行：

```text
node --test test/preservation-windows-kernel-boundary.test.mjs test/preservation-windows-native-source.test.mjs
tests 10 / pass 6 / fail 0 / skipped 4 / exit 0
Node v24.14.0 / darwin
```

六个通过项覆盖 POSIX/drive/UNC ref/capture/runtime 路径、签名模拟新 kernel collect/recheck、错误签名/时序/source/fence/writer拒绝、producer 输入限制、归档来源及 SDK-to-literal 拒绝、stopped logger 前缀和全 JSONL 规则。它们使用实际临时文件和注入的有限原生事实，不能写成真实 Windows 重启或 SDK 正例。

四个跳过项为真实 Windows OS boot/同 kernel 拒绝、held-handle 原生 birth/entry读取、execution override 拒绝、实际 no-worker进程关闭与来源变更。没有改 platform 或 allowUnsupported 使其变绿。

`node scripts/lint.mjs` 独立检查 132 个源码文件通过；五个变更模块的 `node --check` 及冻结 diff 空白检查通过。额外直接调用 Darwin 默认 `readProcess`、`readNamespace`，两者实测返回预期 `SOURCE_NATIVE_PLATFORM`。未启动监听服务，因此没有分配或变更 Mac 端口；未运行模型、手机、正式业务或完整 Mac 测试框架。

测试前后 E02 HEAD 均为该 candidate、工作区 clean。12 个变更文件均与冻结 Git 对象在 LF 归一化后相同；迁移留下的五个 CRLF 文件原始字节确不同，初次全字节断言失败已明确归因，证据同时列原始和归一化摘要，不宣称最终包字节相同。PowerShell helper 的 LF SHA 为 `3e4f6b41ed21a9d4fefccb69ad2acf4d7e1284e69bc70a9002bf4531fd42b658`，与模块 pin 一致。

## 边界与交付

本次没有构建或验收最终六包、没有实装 Windows 新客户端、没有实际 SDK positive完整链、真实主机重启 positive、Linux现场部署或 G1–G5 全链。此前 `794ba7f` 的 Windows 1235 pass / 0 fail / 2 Linux skip 属于作者历史证据，未迁移成当前 SHA 的独立结果；原 `289d4f4` G1子集报告也不升级。

Q01 仅保存这份报告和同目录 `2026-10-14-q01-preservation-evidence/cad5886d-source-checkpoint.json`；不修改产品/SDK/auth/HOME，不推送或部署。源码可作为有限检查点交给 R 按既有用户授权保存和发布，Windows现场验收边界继续明列。
