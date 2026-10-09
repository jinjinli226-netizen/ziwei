# 员工创建 / 编辑弹窗勾选框修复与生产验收

日期：2026-10-09。**状态：已发布并完成生产验收。** 本机证据路径以 `C:\Users\25941\.codex\worktrees\2884\灵光爸爸拆解` 为根目录；ignored `.local` 中的私有证据不进入 Git。

| 发布字段 | 当前记录 |
| --- | --- |
| 生产前端 / 主站基线 | `82c4f8e` |
| 紫薇·互联控制服务基线 | `8a4fe59` |
| 生产代码提交 | `f790f099ae80b8cac8d272c9b260527f8c611e0b`，已推送 `origin/codex/ziwei-terminal-console` |
| 发布目录 / 时间 | `/opt/ziwei/releases/f790f09`；北京时间 **12:13:51** / `2026-10-09T04:13:51Z` |
| 前端资源 | `index-Bxj_j2AJ.js` / `index-Du5DwJBi.css` |
| 服务PID / 重启 | 主API80617、控制44591、Nginx737均不变；0重启 |
| 发布证据 | `.local/employee-modal-fix/deployment-result.json`，服务器备份目录 `employee-modal-release.json` |

生产代码包含邀请82c4f8e、手机628482d、管理MCP与团队卡片全部增量。后续交接文档与截图helper提交可晚于生产代码SHA，无需重建或重新发布产品前端。

## 问题与修复

修前真实页面测得“启用紫薇管理 MCP” checkbox 为 **657.21875 × 40 px**，“保存后配置手机技能” checkbox 为 **700.390625 × 40 px**。`workspace-shell.css` 的通用 `.employee-field input` 将 checkbox 也设置成 `width:100%`、`height:40px` 和文本框 padding；后续 `.employee-checkbox input` 仅重置 `min-height`，未覆盖宽高和 padding。Label 虽为 flex 布局，控件仍占据大块宽度并挤压文字。

本次将 checkbox / radio 排除在通用文本框尺寸与 focus 样式之外，原生 checkbox 通过共享 label 规则设为 **18 × 18 px**、固定 flex 尺寸且不收缩，保留 label 点击、键盘焦点与 Space 切换。SKILLS 使用同一共享类；环境变量“敏感值” checkbox 也由共享尺寸规则覆盖，避免继承文本框 padding。最终生产15个控件均18×18、label间距8px；敏感项隔离实测18×18、间距6px。原生appearance、v-model/@change保持。

“保存后配置手机技能”从正文之外移入 `.employee-create-modal__body` 末尾，随表单滚动并复用正文内边距；footer 保持独立。该选项仍只在创建时显示。编辑弹窗的可见标题与说明改为编辑语义。员工配置、邀请、手机与管理 MCP 的既有业务逻辑均不属于本次改动范围。

## 验证结果

| 检查 | 当前结果 |
| --- | --- |
| 完整串行测试 | **296 / 296 通过** |
| Lint / 前端构建 | **49 项 lint 通过；build 通过** |
| 隔离管理 MCP UI 回归 | **6 / 6 通过** |
| 隔离团队布局回归 | **12 / 12 通过** |
| 隔离手机技能 UI 回归 | **12 / 12 通过** |
| 邀请 UI 回归 | **6 / 6 通过** |
| 新弹窗隔离浏览器 | **11 / 11 通过**，35个控件交互 |
| 生产修前复现 | **10 / 10 预期拉伸RED**，五组创建/编辑 |
| 生产发布后只读检查 | **10 / 10 通过**，15个控件交互 |
| 独立生产正文 / footer | **最终5 / 5通过** |
| 公网传输 | health200，管理与手机MCP匿名401 JSON |
| QA 临时会话撤销 | remaining0、旧cookie401，服务器私有文件删除、本机token移除 |

五组CSS视口为1250×882、1440×900、1280×720、720×450、390×844，均覆盖创建/编辑、顶部与底部、checkbox实际尺寸/文字间距、label末端点击、原生点击、真实Tab/focus-visible/Space、正文可滚到底及footer命中。720×450仅代表1440×900在200%时等效CSS可用空间，未操作真实浏览器缩放。

隔离验证SKILLS选中保留到创建payload，手机继续开启时进入原向导、关闭时普通创建，编辑取消后原fixture员工配置逐字节不变。环境敏感项正常。所有fixture写入仅进入内存，未启动业务后端或连接真实手机。原功能回归共36项；管理回归2条console503来自其显式失败fixture，不计为生产错误。

生产所有非GET/HEAD/OPTIONS硬阻止，实际0写请求尝试、0页面/控制台/请求错误、API全200、0手机动作。真实phone_ai未授权管理MCP准确阻止提交，取消后其他条件就绪；编辑标题正确且无创建专属项。10次employee数量均2→2、配置摘要hash不变，未创建QA员工、未提交配置/检测/trial。

独立footer最终5/5实际elementFromPoint命中取消/创建按钮中心、按钮在视口内，取消可关闭；正文scrollWidth/clientWidth依次808/808、808/808、808/808、686/686、368/368，底部手机label在正文内且可达。匿名Android索引200/latest code15、六个旧hash资源HEAD200；本轮未下载或核验APK内容hash。

## 证据、截图与历史失败

| 证据 | 相对路径 |
| --- | --- |
| 全量 / lint / build | `.local/employee-modal-unit-tests.log`、`.local/employee-modal-fix/lint.log`、`.local/employee-modal-ui-build.log` |
| 隔离弹窗11/11 | `.local/employee-modal-ui-after-final/results.json` |
| 原功能UI36/36 | `.local/employee-modal-fix/regression-{team,phone,management,invitation}/results.json` |
| 修前生产10项RED | `.local/employee-modal-fix/live-before-complete/results.json` |
| 最终无遮挡生产10/10 | `.local/employee-modal-fix/live-after-final/results.json` |
| 独立footer最终5/5 | `.local/employee-modal-fix/results-footer.json` |
| 匿名MCP传输 / QA清理 | `.local/employee-modal-fix/transport.log`、`.local/employee-modal-fix/session-cleanup.json` |

完整30张最终图位于 `.local/employee-modal-fix/live-after-final/`。截图前临时visibility隐藏背景账户区域，截图后移除样式，不在前景上画遮罩。root已目视检查修前/修后桌面、390px与720短高关键图：

- 修前桌面：`.local/employee-modal-fix/live-before-complete/live-create-1250x882-bottom-blocked.png`。
- 修后桌面保留真实未授权提示：`.local/employee-modal-fix/live-after-final/live-create-1250x882-bottom-blocked.png`。
- 修后390px：`.local/employee-modal-fix/live-after-final/live-create-390x844-bottom-ready.png`。
- 修后720短高：`.local/employee-modal-fix/live-after-final/live-create-720x450-bottom-ready.png`。
- 修后编辑：`.local/employee-modal-fix/live-after-final/live-edit-720x450-bottom-ready.png`。

早期RED包含skills原15px与窄屏flex收缩，统一共享控件后完整11/11 GREEN。早期生产脚本networkidle/8秒超时、编辑未等CLI发现结束，属于等待问题；修正后修前10项拉伸RED和修后10项GREEN分开保留。初次修后截图mask覆盖部分前景，原10/10结果保留于live-after，最终无遮挡图与结果为live-after-final。

独立footer首轮页面5个case通过，但附加解析带active前缀的deployed.json导致本地JSON失败，首轮原JSON随后被覆盖，不能声称原文件仍保留。第二轮两个ERR_CONNECTION_CLOSED导航失败保留为 `results-footer-connection-retry.json`；最终证据来自第三轮fresh5/5，不删除历史失败或以最终通过否认此前网络现象。

## 发布保护与回滚

发布前备份目录为 `/opt/ziwei-backups/employee-modal/20261009T035856Z`：双SQLite完整性均ok、13份配置，清单保存在服务器metadata.json；本机摘要 `.local/employee-modal-fix/release-backup.json`。

source/frontend archives上传后先核对SHA-256，后端/daemon/src/package/lock及原生客户端/MCP入口逐字节不变；复用原data/.local/node_modules目标。复制原release六份旧hash文件并拒绝碰撞；服务实际0重启。Nginx配置hash `faf170c39866d8c307ed68cc49d96cf7cc28dfac442e979d3f3d8c35cf494967` 前后不变且phone MCP路由存在。原子切换后核对三服务active/PID、health、公网新JS/CSS内容hash，若检查失败发布脚本自动切回旧symlink。

仅此前端回滚时，先核对当前仍为本轮release，再通过独立临时symlink和os.replace将 `/opt/ziwei/current` 原子切回 `/opt/ziwei/releases/82c4f8e`，复核页面/health；无需重启服务、不修改data/control目标。**不得恢复旧数据库**覆盖邀请、员工、手机绑定、管理MCP配置或后续业务数据。

本轮QA会话session_employee_modal_fix_20261009已撤销，2026-10-09T04:22:23.563Z旧cookie实测401；服务器私有文件删除，本机覆写为无token的撤销记录。无新增QA用户/员工/绑定，无需删除业务资源。用户三份untracked保留，未修改原D目录/全局客户端/手机。

手机当前离线且用户暂不能操作，真实员工截图/有限动作验收仍待手机在线。团队页390px顶部管理按钮的既有裁切不属于本次弹窗范围。用户随后明确“codex这个不用管了”，本轮停止Mac/Codex CLI相关处理，不影响已完成的UI发布。
