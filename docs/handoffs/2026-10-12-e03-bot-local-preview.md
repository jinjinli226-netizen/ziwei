# E03 Bot 工作台与隔离本地预览交付

核验日期：2026-10-13（Asia/Shanghai）。状态：首版本地预览已运行，未发布；Hermes 全量原生能力接入与真实 24 小时验收尚未完成。

## 访问与候选

- 前端：[Bot 本地预览](http://127.0.0.1:5283/preview-bots/bots)，仅监听 `127.0.0.1:5283`。
- API：[隔离健康信息](http://127.0.0.1:4283/__preview/health)，仅监听 `127.0.0.1:4283`。
- 代码候选：`1358fc8036b8a1ee13d5f25324d00aea277fc335`；分支 `codex/v2-e03-hermes-bot-ui`。
- 工作树：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解`。
- E02 来源：`633e0caf5d102f58ffde0e590ccfc08dffaca32c`，本树等价挑入提交 `bb7e505581e0429a7f07526c179ee071bb24ac7c`。
- 预览实例：`2026-10-12T15-58-19-799Z-30436`；启动 2026-10-12 23:58:19，双端 ready 23:58:34。监督 PID `30436`，API PID `51060`，Vite PID `11024`。
- 端口登记 ID `498622e5bdf9d880`，名称“紫薇 V2 Bot 隔离本地预览”。5283/4283 启动前同时核对登记簿与 OS，均未占用；启动后核对本机监听及 PID 后登记。

实例 `active-instance.json` 保存的是启动时提交 `af1a68abc2e01bd4064e495784a51fc631ab3066`。后续 API/监督器未变；前端经 Vite 原生热更新到当前代码候选，并重新执行真实页面验收。交付文档提交只增加说明，不重启预览。保留工作树、分支、独立数据与当前预览。

## 用户可见流程

1. 从“Bot 伙伴”选择“资料研究员”，或创建自己的演示 Bot。创建须选择标明合成的电脑和 `preview-fixture` profile；员工 ID 与团队管理完全相同。
2. “基础配置”修改姓名、头像、可见范围、岗位、人格、模型/provider、回合上限和权限。“能力组合”设置记忆开关、工作区技能、原生技能禁用、工具集和标准输入输出 MCP。MCP 环境值仅支持本机变量名引用，不保存字面密钥。
3. 保存并读回后，在“运行记录”检查已保存配置，等回执再启用。此预览的检查与回复均由合成执行器返回；能力卡显示“合成流程已验证”，不把它显示为真实原生能力已接入。
4. “打开长期聊天”进入同一条主会话，发消息后看到明确标注的合成结果。“Bot 设置”“Routine”“运行控制”“返回 Bot”仍定位同一位员工。模型和电脑以 Bot 已保存配置为准。
5. “例行工作”创建/编辑/暂停/恢复/删除计划，显示服务端真实时区、下一次时间、结果主会话与最近结果。预览自动调度关闭；“手动运行”创建一次合成执行。
6. “在团队管理查看”转到同一员工。团队编辑/岗位说明汇入 Bot 配置，暂停及删除同步到两处视图；原有 Hermes 员工可原地初始化 Bot，保持 ID 与主聊天。Creator 保留原管理路径。

未保存草稿遇到 409 保留原版本；切换工作区、Bot 与历史导航不会让旧回包覆盖新视图。Routine 请求结果未知时保留原请求标识，单纯 GET 不能解锁新意图；显式恢复使用同一 idempotencyKey。执行不确定及已 ACK 后过期不显示普通重试。停止请求受理、目标执行结束与执行树退出分别显示。

## 数据、运行和网络隔离

- 数据库：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview\data\preview.sqlite`，从空库建立。对象数据位于同目录 `objects`。
- HOME：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview\runtime-home`。子进程 HOME/USERPROFILE/APPDATA/LOCALAPPDATA/HERMES_HOME 均指向独立目录；移除继承的业务/provider 环境项。
- `createApp` 复用产品真实公开 API、权限、数据库和 management service；独立随机本地账号自动注入仅本机请求，页面不登录正式账号，不读取或覆盖浏览器正式登录凭据。
- 两个独立演示工作区 `preview-bots` / `preview-alt`，设备 owner 通过产品 createDevice 建立，再发送合成心跳。模型发现注入产品支持的合成发现器，版本明示 `fixture-no-Hermes`，不运行本机 CLI 发现。
- 合成 worker 只处理这两处自己的 Bot 动作。不启动 Hermes、模型服务、MCP、真实 daemon、手机业务或外部账号；Creator 模型执行返回明确未连接。关闭产品 scheduler，不自动执行 Routine。
- 请求白名单禁止原生 profile 发现、外部 URL 导入、Git 导出、Webhook、MCP/A2A/设备控制写入及互联业务；本机 Origin/peer 校验限制访问。前端 `VITE_API_URL` 显式为4283，CORS origin显式为5283，避免开发默认4178。
- 原始 `D:\灵光爸爸拆解`、2884、正式服务/端口、正式数据库、员工删除状态、Creator HOME/记忆/会话和客户端未被本次实现修改、停止、升级或切换。

## 诊断日志

日志目录：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\bot-preview\logs`。

- 独立监督日志：`supervisor-2026-10-12T15-58-19-799Z-30436.jsonl`；每15秒检查 API和前端HTTP健康，记录观察者/子PID、端口、启动、stdout/stderr、异常、退出码/信号和退出状态。
- API日志：`backend-2026-10-12T15-58-19-799Z-30436.jsonl`；启动与每15秒心跳，以及异常/退出留痕。离线后直接读文件，不依赖先重启。
- 按实例新文件，单文件5MiB、5份轮转。字段名敏感值和结构化文本脱敏；stdout按完整行合并后处理，拆分JSON不会漏出完整敏感值。
- 任一预览子服务退出时，监督器关闭其配套预览子服务并保存 ended/退出结果；下一次启动识别上次未正常退出。不会自动重跑业务或终止正式服务。
- 隔离诊断测试3/3：退出码17、独立强制终止、结构化/拆分输出脱敏。另一次真实预览首次启动因占位互联URL格式错误退出，监督器记录API code1及前端SIGTERM并结束；修正后启动当前实例，历史日志保留。未对当前预览或正式服务做强制退出验收。

登记备注已写日志绝对路径和“诊断已验证”。核验时双端HTTP200、监督器和API周期心跳持续写入。

## 验收证据

证据目录：`C:\Users\25941\.codex\worktrees\v2-e03-hermes-bot-ui\灵光爸爸拆解\.local\e03-ui-evidence`。

| 验证 | 实际结果 | 范围 |
| --- | --- | --- |
| `npm test` | 754/754，0失败/跳过，47.62秒 | 集成E02后的完整回归；最近完整回归对应b3edb12代码，随后仅调整预览能力文案 |
| `npm run lint` | 91 sources通过 | 最终候选 |
| `npm run build` | 1770 modules通过 | 最终候选；主入口500.93kB提示仍存在 |
| `frontend/tests/bot-http-integration.test.mjs` | 1/1通过，完整回归也包含 | 实际产品HTTP/API/controller；fixture执行；故意丢失Routine受理响应，同key恢复仅产生1次run |
| `frontend/verification/bot-browser-fixture.mjs` | 13/13，页面异常0 | 本地拦截的纯合成UI；409草稿、能力状态、模态框、MCP输入隔离、390px等 |
| `frontend/verification/bot-local-preview.mjs` | 11/11，页面异常0 | 真实5283/4283页面与持久API，无mock响应；执行器合成 |
| `frontend/preview/*.test.mjs` | 5/5通过 | 策略拒绝和独立进程诊断；完整回归包含 |

最新 JSON：`local-preview-result.json`、`browser-fixture-result.json`、`full-regression.txt`。截图：`local-preview-roster-desktop.png`、`local-preview-routine-desktop.png`、`local-preview-capabilities-desktop.png`、`local-preview-mobile.png`。已视觉查看桌面与390px截图。失败记录也保留，最新成功回执才是验收依据。

## 原生能力缺口与局部限制

后端提供17项能力目录，前端展示真实状态、原因和证据，不为未接入项提供虚构开关。完整原生矩阵和0.21.3核实证据见 [E02交付](2026-10-12-e02-hermes-bot-preview.md)。这里没有实际运行原生Hermes。

尚未完整接入：群聊/@、Bot委派、外部消息Gateway、语音、Goals、Heartbeat、Kanban；原生记忆正文浏览/编辑、原生技能安装/Hub管理、会话检索工具UI及高级HTTP MCP配置仍有缺口。图片保留原附件链，但真实视觉模型未在本预览验收。工具/MCP实际成功、正式provider/OAuth业务模型与真正24小时耐久运行未验证。Creator模型创建链在此预览不执行。

最终只读审查发现的两个局部兼容问题已在前端处理，但后端接入仍需E02继续：

1. Bot `directory.inspect` 不在动作白名单。当前Bot目录检查按钮明确禁用，函数也阻止进入；可手动填写并保存已知工作目录，保存路径不证明路径存在。
2. 原员工的旧会话电脑若与当前员工不同，初始化会导致后续消息绑定冲突。前端初始化前读取原会话并阻止不一致写入，提示用户先核对原会话电脑/目录；没有静默改绑或另建聊天。直接API调用及读写间并发变化仍需后端原子校验，不把前端预检当后端修复。

未初始化员工能力保存按钮已禁用；MCP未加入草稿的临时输入在名册/历史/工作区切换清空。相关浏览器和控制器测试通过。两位内部审查仅做源码只读复核，未替代可见执行会话实施。

## Q复核与保留方式

先读取E03工作树内 `.local/bot-preview/active-instance.json` 和上述健康接口；已有实例活着时直接复用，不执行启动命令。核对数据库/HOME必须在E03工作树 `.local/bot-preview`，健康必须返回 `realHermes:false`、`schedulerEnabled:false`。核对监听必须是127.0.0.1及上述PID；PID随后续主动启动会改变，先查状态文件，不能靠旧PID处理进程。

可在此隔离树执行：

```powershell
npm test
npm run lint
npm run build
$env:ZIWEI_PLAYWRIGHT_PATH='C:\Users\25941\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
node frontend/verification/bot-browser-fixture.mjs
node frontend/verification/bot-local-preview.mjs
git diff --check
```

纯合成浏览器脚本要求先构建成功。真实预览脚本只创建自己此次生成的验收员工并删除这些确切ID，不删除种子或用户随后建立的数据。不要并发运行两份真实预览脚本。

只有用户要求恢复已结束的预览时，才从本树运行 `node frontend/preview/supervisor.mjs`，或Windows隐藏后台启动相同入口；先重新检查端口登记/OS占用。该入口沿用原生Vite CLI和产品公开createApp参数，不替换原项目启动脚本/默认端口。关闭也只处理核实过的这套精确预览进程；保留独立库与日志，不对正式环境执行回滚。
