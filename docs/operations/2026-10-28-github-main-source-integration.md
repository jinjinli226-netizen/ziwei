# 2026-10-28 GitHub main 源码归并

本次按用户要求将已完成的当前源码归并到 main。远端起点是 `98dfa12e74d0fbda6b05659448e14259080e21ae`；集成仅改变 Git 源码，不执行生产发布、客户端升级、业务请求或数据恢复。

- 保留 `a38ffb7851baa023345a3c1bd8666e6181547143` 的完整祖先链，包括员工能力清单 `67b85ab`、Android 安装页 `b75b4c8`、安全门控 `9150539`、Provider 密钥、安全输入、员工列表与客户端终态修复。
- 合并 `8f2d6f100b822566c473ef956e9d077759bb3475` 的 Workspace CLI 与统一身份源码，再纳入 10/27 已验生产混合候选中后续的身份 floor、Control bridge、授权流、member provisioning 和 machine CLI 增量。生产基线来源为 `employee-capability-inventory-rollout-20261027/mixed-candidate-9150539`；逐文件哈希回执保存在本机 ops 目录，私有原始材料不进入 Git。
- `mobile-manager/` 按 `4d86ec0635e54291ba6e600cfdf83e3dba013ec9` 全部 97 个跟踪文件归并，产品 code18 来源为 `32ace365186863011b0175201b3c7076b411900a`。原签名、模拟器登录、续期及退出验收见 [code18 记录](2026-10-25-android-unified-login-code18.md)；真实手机覆盖升级仍未测。
- 正式 0.1.4 包的 105 个运行源码与 a38 对照，103 个语义相同，另两个 native Gateway 补丁材料保留 a38 中已验收的 `ec355e9` 准入增量。包内旧补丁材料与已安装原生源码分层保留，不能用包内旧材料回退已验源码。详见 [Gateway 验收记录](2026-10-27-hermes-gateway-session-compatibility.md)。
- 未整支合并旧 Android/mobile TPNS 或历史 WIP；已停止的第三方 SDK 候选和用户已关闭事件的未验工作不作为完成成果。历史分支、用户工作区与原始失败回执均保留。

配套私仓 `ziwei-system` 的 main 来源为已验收 `9d25509cf4a2f947465582d9442a2d1845a8af1b` 的 Control / Android code22 祖先链，并归档已审核的独立 Control CLI 1.3.0 r2 源码。该仓原默认分支仍为 master；主仓 Android Manager 与手机 Agent/Updater 分属不同应用。

本轮 fresh 检查未发现 ziwei GitHub Actions、Webhook 或 Pages 自动发布，main 无分支保护。源码检查和本地组装检查的结果另存无密钥回执；这些检查不替代现场部署及真实设备验收。
