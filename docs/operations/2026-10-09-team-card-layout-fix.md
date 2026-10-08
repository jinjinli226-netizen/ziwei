# 团队员工卡片重叠修复与验收

## 问题与根因

用户截图中的 `test_222/members` 存在实际布局错误：三张员工卡片把完整 instructions 展开成窄长文字列，并与下方设备/Agent 环境表重叠。真实旧生产与离线真实字段均复现；最高卡片 787px，另外两张 613px、395.5px，而组织区固定 500px。桌面环境区起点709px，最高卡片底边1361px。

三个原因共同造成错误：App.vue 在卡片和设备员工行优先展示完整 instructions；后置 CSS 把卡片摘要改为 overflow:visible；员工列表使用 absolute/top:365px，父组织区不能随内容增长。此前验收侧重创建弹窗和员工详情，夹具只有短文本员工；旧合同还强制绝对定位和全文展开。此前通过的 MCP 链路验证不代表该布局已验证，用户指出了漏验。

## 最终改动

- 两处员工列表优先展示 description；缺失时取去除前导空白后的指令首句，最多80个 Unicode 码点，超出加省略号。只计算展示摘要，不改变持久数据。
- 卡片头像和状态在顶排，名称、运行配置、岗位摘要使用卡片完整宽度；摘要限制两行。完整 instructions 继续在岗位详情、员工编辑和岗位编辑初始化中保留。
- 组织员工列表进入正常文档流，父区按多排卡片增长。菜单展开时额外预留底部空间，末排“安排任务”和“配置伙伴”可实际命中。
- 390px 环境员工行允许换行，岗位文字列从0px恢复到150px；完整指令不再把设备员工行撑成大段文本。

## 验证

| 验证 | 结果 |
| --- | --- |
| `npm test -- --test-concurrency=1` | 235/235 |
| `npm run lint` / `npm run build` | 43 source files / 通过 |
| `node scripts/verify-team-layout.mjs --output .local/team-card-fix/root-verified` | 12/12；无需私有 fixture |
| 保存的真实员工字段离线对照 | 12/12 |
| 原 `verify-management-mcp-ui.mjs` 回归 | 6/6；两个503控制台错误来自预期失败夹具，无非预期错误 |
| 真实 HTTPS `test_222` 只读浏览器 | 1440/2048/2549/390px，各布局和完整详情检查，共8/8 |

隔离布局按四个宽度分别覆盖三名长指令员工、12名多排员工、缺 description 且带前导换行的长指令。检查卡片/摘要尺寸、文字列宽、组织区包围、环境间距、多排、末排菜单命中、任务表单预选正确员工、详情指令原值及目录树切换；布局验收没有提交任务或修改员工。原输入字段不变，写请求0，页面/非预期控制台/失败请求0。

真实线上三卡统一126px，摘要28px；桌面组织区523px、390px组织区799px，环境与末卡间距均32px。真实加载 `index-PEvi9Z0Z.js`；页面/控制台/请求/HTTP错误0，写请求0，设备动作0。人工查看桌面与390px截图确认卡片不再跨进设备表。

证据保存在工作树 ignored `.local/team-card-fix/`：`before/results.json`、`live-before/results.json`、`root-verified/results.json`、`after-real-verified/results.json`、`mcp-regression/results.json`、`live-final/results.json` 和各自截图，以及 unit-tests/lint/build 日志。真实字段与用户截图不提交 Git。

验收范围为 Chromium 下员工卡片、岗位摘要、组织高度、环境员工行及菜单。390px 顶部四个管理按钮的既有横向裁切未在本轮修复；未验证非 Chromium 浏览器，不能宣称整页移动端控件全部完善。自定义 `--employees` 输入描述时，当前脚本的描述全等断言适用短且无多余空白的描述；长描述的规范化/截断尚需扩展夹具断言。

## 发布与资源

- 代码 `dc3917341cd801d4e83bda8da24fe794d35f23f2` 已推送 `origin/codex/ziwei-terminal-console`。
- 北京时间2026-10-09 00:50:22（UTC 2026-10-08T16:50:22Z）切换 `/opt/ziwei/current -> /opt/ziwei/releases/dc39173`；前版 `/opt/ziwei/releases/4db30ce`，控制端仍 `/opt/ziwei-control/releases/8a4fe59`。
- 产物 `index-PEvi9Z0Z.js` / `index-DyDgRE0D.css`，保留旧发布全部 hash 资源及原 APK。
- 备份 `/opt/ziwei-backups/terminal-console/20261008T164821Z` 保存双 SQLite（integrity=ok）、12份配置和原data/.local/node_modules真实路径。部署归档SHA-256与manifest匹配，旧资源同名冲突校验通过，nginx配置校验通过。
- backend/daemon/src文件映射、package/package-lock及MCP启动脚本与旧发布逐字节相同；原运行目录继续链接。服务未重启，主API PID52196、控制 PID44591、Nginx PID737，全部active/NRestarts0，主域health正常、双库quick_check=ok。
- 本机原daemon `/readyz` 仍 ready=true、test_222、PID49296、managementMcp configured=true，健康端口20242保持原值。本轮未升级客户端或改变运行配置，未新增业务实例。
- 员工数据、完整指令、runtime/profile、凭据、手机与绑定未改变；phone_ai员工/绑定/运行记录仍0。控制数据库总记录2包含历史记录，不把该数当成当前界面可见手机数。

## 临时会话与回滚

生产浏览器使用短期 Owner QA 会话，所有非GET/HEAD/OPTIONS浏览器请求均阻止。北京时间00:54:46已撤销该会话；使用原cookie访问受保护员工API实测401，服务器及本机私有会话文件均已删除，生产管理MCP凭据保留。清理证据为 `session-revoke.json` / `session-cleanup.json`，未撤销用户原有登录。提交前对4个代码文件和6个文档文件扫描本次真实私有凭据，命中0。

回滚仅需按已有原子symlink发布方式把主站current切回 `/opt/ziwei/releases/4db30ce`，无需重启API；先核对当前版本，保留新旧资源和数据目录。本轮没有数据库迁移，不恢复备份覆盖之后的数据。回滚后检查canonical健康接口及团队页；备份元数据与发布元数据保存在上述目录。

后续验收必须覆盖多名长指令员工、多排、缺描述和窄屏，并测几何位置、完整详情及菜单命中。不能再次用控制台无错误或短文本单员工截图代替布局验收。
