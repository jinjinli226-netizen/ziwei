# R01：最终源码、包级资格与服务器准备交接

最终产品/制品源码冻结 `3c8615ab5faac57f2e479ff78fc5042f9ff7b902`，tree `19059ceb72ccd9cd040c0528fd84e35c913a19ee`；版本分支 `codex/v2-20261014-release` 已 normal push 并由 remote refs/GitHub commit API 精确读回。后续仅添加 Q01 两份安全验收文件及本文，不重打包、不改实际候选或既有八个 pins。

Q01 独立最终包验收原 commit 为 `a7f815ad217fbffdd8346ee3bda2d8accc036832`，仅两份安全文件，R cherry-pick 为 `802ca5b`。详见 [最终包级验收](../qa/2026-10-14-q01-3c8615a-offline-closure-acceptance.md)。旧7467eed包缺Express依赖的P1在真实3c最终归档上闭环；旧失败产物及记录保留。Q结论限定实际六包/成员/源码关联和仓库外冷装、真实API memory factory/installed CLI，不等于正式迁移 GO。

## 实际服务器准备

六个归档与两份manifest已完整暂存 `/opt/ziwei-staging/v2-3c8615a`，目录0700、文件0600，服务器逐项SHA/size精确匹配。没有公开Release/客户端metadata变更、官方安装、current切换或服务动作。旧坏批 `/opt/ziwei-staging/v2-7467eed` 仍只是未签收归档。

原在线保护副本 `/opt/ziwei-staging/backups/pre-v2-7467eed-20261014T032535Z` 保留。主/控制SQLite用backup API生成一致副本，integrity=ok、FK=0；旧代码、静态资源、非DB持久目录和服务配置归档回读通过。在线文件复制不是正式停写proof，不恢复旧整库覆盖当前增量或墓碑。

实际 Linux Node v24.13.0 在新私有目录 `/opt/ziwei-staging/v2-3c8615a/linux-zip-cold-verification-03` 完成两角色有界检查：Python按ZIP真实格式核绝对/越界/重复路径、文件类型、成员/总大小及每个成员SHA/完整集合后提取；V1/V2实际API成员107/128项精确匹配。每role使用空cache、独立prefix、不同空user/global npmrc、空HOME/最小env离线安装真实TGZ。实际依赖图各71packages/127edges，图摘要 `cac7efa2a7af67292446896186093ef62e8b39320babe87be3e0fd488f76ba00` 与manifest一致；实际express/ws/yaml、backend/app.mjs内存工厂与DB查询、installed脚本version均成功。运行入口禁止网络、监听、child helper，未启动daemon、模型或手机；没有读取或改变原HOME/config或正式DB。

该 Linux 结果由 R01 私有ops harness获取，未用作者回执代替执行，也未通过改产品/归档/guards或shadow tar补成功。原工具失败仍保存：GNU tar1.34不能执行 `tar -xf API.zip`；随后自有probe曾将两项npm配置误指向同一文件并在安装阶段失败。改为两个不同空配置文件后本轮成功；该次失败未保存完整npm stderr，不声称取得其精确错误正文。E02 runtime utility的GNUtar ZIP调用可移植问题仍如实留记，当前ops使用已逐项核字节的Python ZIP提取。

最终保护状态前后稳定：主 current `/opt/ziwei/releases/a66df9c-sqlite-179d0d46`、API PID181593；control current `/opt/ziwei-control/releases/8a4fe59`、PID134533；Nginx PID737。三者active、创建时间不变；RELEASE、静态index、Nginx、签名文件和公开CLI metadata摘要稳定。没有正式source/action/namespace proof，`formalStoppedProof=false`、`formalBackupProof=false`、`originalActionProofMinted=false`。

| 私有结果（不入Git） | SHA256 |
| --- | --- |
| packages-pins-3c8615a.json | 0d91472216cba5ccac7d279c2a41b2ead41b1185cf22fd068c55ab1bf7077260 |
| api-entry-proof.json | a842e99b1eb16f01d4691179b532acb48a6ca0b1fa15bd6a3236d43fb3661785 |
| server-staging-final-3c8615a.json | 7560fb88314034f9d238ac37b24639cc01084c8660b3084a8a1a847b428f2b90 |
| server-linux-cold-final-3c8615a.json（原工具失败） | 32366cf7c39f81cb09721cc302679320a5c57b6acde881b2b713931f7ee75002 |
| server-linux-cold-diagnostic-3c8615a.json | 6a7d9cd171d8718caff123d9600b3ce90ad16729bfc08c3f2080518f3fffaa8f |
| server-linux-zip-cold-final-3c8615a.json（第二次probe失败） | da4c38aec81ea81042e4a46e0a06f06619a4a0ebe815f7094d58d31f856ea90a |
| server-linux-zip-cold-final-3c8615a-03.json（实际通过） | 3cd029058045be0b3d5a409dafdf7eda4090577a2a91caa3c64b3dbea8c51ac2 |
| cold-runtime-proof.json（服务器实际结果） | 460f0321f560ba2b1b4fd76d26fa40ea718a2519fb353eed5008e189516f8f57 |

## 当前明确待输入

真实 action_8668054e-e2e9-476b-acb1-d20f561eb661 仍保留 expired、ACK及原空result。当前正式guard真实拒绝 `PRODUCTION_ORIGINAL_DEBT`；不改行、清队列、借expiry视为退出或伪造callback/proof。其余failed/历史行不被扩大成同类门槛。

原 handoff固定26项中12份公开代码允许精确原Gitblob字节恢复，14份原私有证据必须原件。新 [Windows私有导出工具与具体命令](2026-10-14-r01-one-subject-private-export.md) 已完成11/11有限fixture测试和只读安全复核，当前真实原件尚未收到。准确脚本下载地址为 `https://raw.githubusercontent.com/jinjinli226-netizen/ziwei/3c8615ab5faac57f2e479ff78fc5042f9ff7b902/scripts/operations/r01-export-approved-legacy.py`，Git原bytes18548，SHA256 `2b8738938b3a301cd1f773172ec914b5929b265ea86ae74c971c72b5ce692b1d`。

当前阶段准备与保存已完成，R停下等待私有输入。收到后仍须在准确模块上独立核原字节及实际fresh请求/原scope条件，不能把该导出或包级PASS升级成迁移许可。原服务、data/.local、控制/Nginx、客户端和公开metadata保持；Windows实机/provider/手机测试范围没有因此扩展。
