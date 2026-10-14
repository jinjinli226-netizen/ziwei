# R01 GitHub 完整源码发布候选 — 2026-10-14

用户已明确授权测试通过后直接上线、直接推送 GitHub，并停止 Mac 产品适配。Windows 客户端实际验收由用户上线后进行，不作为安全源码保存门槛。R01 为唯一发布者。

## 固定源码组合

版本分支为 `codex/v2-20261014-release`。正常非 force merge 组合 E02 clean `cad5886d3dd5e6192bead8b85d40cc0d3ef4210f` 与 R01 `4f218b90703324f877f1234b57d7a34380c09b63` 的八个安全 ops 提交。组合包含最终 E03 namespace/qualified archive/POSIX 路径修复、必要产品/tests/docs，以及 R 的签名 proof/phase/backup 接线；未复制 E02 WIP 或原项目脏文件。

R 自有 wire fixture 从历史 2ea 输入更新到最终 cad 产品模块，导入前校验 LF-normalized SHA：production `264c1a5d51ae0b896f363979f274ac405800f8f275e0d8ae94e6d0c93db29c6d`、namespace `ee332e50a78fd61a765ea2b721093e34311016be17d855ed2c71657611c4a6ac`。phase factory 可将 independently loaded legacy policy 作为第二代码 options 传给产品；该 policy 不进入 spec 或 signed request JSON。

## 实际验证与准确范围

R 在 Node v24 的当前 Mac 上实际运行本身不监听的 operations 测试：87/87 pass、0 fail、0 skip。覆盖签名 requests/完整有序 previous、挑战重放/变更拒绝、回执恢复、私有 CLI、namespace encoder、legacy logger、离线备份对增量/墓碑的保留与恢复读取。它们是隔离代码/数据测试，不代表 Windows 原生退出、实际产品 source 四阶段、付费 provider 或手机操作。

首轮临时目录经过系统符号链接被路径 guard 拒绝；第二轮原 fixture key 默认权限被产品私有 key guard 拒绝。用本树物理私有 TMPDIR 和 fixture key 0600 重跑成功，产品 guards 没有弱化。旧 generic phase 缺入口测试改用单独空 package fixture。只读增量复核未发现这些 ops 接线调整的明确新缺陷。

E02 本次有限直接资格为 6 pass、4 Windows-native skip、lint 132 sources/syntax/diff pass，详见同批 E02 final CLI checkpoint。旧 794 的 Windows 全测试是历史证据，不能声称 cad 或本组合 SHA 已重跑全部 Windows 测试。Windows 实机客户端、当前 source lifecycle、真实 provider/手机仍由用户后续验收；本轮没有 Mac 产品适配。

## Git 和访问状态

fresh 公共 refs 的 main 仍为 `339b1db1862882c5305ebddceead85d487c8c9d0`，rollback 为 `8556aecb6a37385d9fc7061f989e97071bfd6cf9`；main 是该正常组合的祖先。origin 已恢复为 `https://github.com/jinjinli226-netizen/ziwei.git`。只收已提交 repo-owned 安全代码/tests/docs，逐路径排除 .local、DB、HOME、auth、依赖安装、产物、错误 capture 和原项目未提交修改；未用 git add -A。

Mac 初始 Git keychain 没有可用 GitHub 凭据、SSH agent 没有 identities；已连接 GitHub 账号只有 pull、没有该 repo Write。用户选择切换到可写账号，R 用经官方 asset digest/checksums 校验的临时 GitHub CLI 2.102.0 开启正常网页 device login，由用户本人完成。工具仅位于 R .local，不全局安装，不读取或导出 token。必须核实际授权账号的 repo push 权限，正常推送本分支并读回 exact SHA 后才可报告上传完成。此文档的提交本身不是 push 回执。

## 产物与部署边界

最终六产物和两 manifest 只能从本组合的 clean commit 生成，builder拒绝 tracked WIP；原 Windows .local 私有回执没有迁移，本轮不能重新宣称已核其 bytes/hash。Git 源码保存不等本机 Windows 实测，也不等完整 Mac 平台测试。

服务器须另行使用确认属于紫薇的 SSH host/user/key reference 做 fresh 只读预检、真实备份/恢复读取和原在途状态核验。当前 Mac 没有迁移原 Windows SSH reference；现有部署 key 只有公钥名称和别项目式 comment，tracked 项目未提供 host/key 归属关系，正式 DNS 的代理地址也不能用于认定 key 归属。R未猜 host/user、尝试未知 key 或宣称服务器已可达。

Linux 新两个角色 root 必须复用真实 data/.local links，并核实际 cwd/ZIWEI_DB_FILE/ZIWEI_OBJECT_STORE_DIR，保持原 DB/objects/HOME，compat回退只换同批代码而不恢复整旧DB覆盖增量/墓碑。ordinary --apply 没有注入 proofProvider；正式代码 runner必须实际传独立 trust/transport/backup与legacy policy，不能用plan或回读旧receipt冒充新mutation。control/Nginx/terminal-mcp与原端口保持。暂无真实服务器或 Windows 服务切换、主机重启、模型/设备动作。
