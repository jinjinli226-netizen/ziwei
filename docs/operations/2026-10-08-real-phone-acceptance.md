# 2026-10-08 真实手机技术验收（脱敏）

## 当前结论与证据边界

主站 Owner 管理代理已完成 1 台真实手机的控制验收，33 条命令全部 succeeded。打开系统设置、返回原应用均由真实截图及回执交叉确认；北京时间 23:25:04–23:25:26 的动作后主站网页只读后验通过，临时验收会话已清理。

本次实际执行链是管理员代理。工作区员工与员工绑定均为 0，终端 MCP 实际调用失败，员工/MCP 手机执行链路尚未通过。真实双端升级、业务消息与内容发布没有在本轮测试。

本记录只保留脱敏技术状态。账号、作品、查询指标及完整截图仅保存在 ignored `.local/real-phone-acceptance/`，完整本地报告为 `report.md`，结构化总结果为 `result.json`；这些私人数据不提交 Git。下文证据路径均相对此本地证据目录。

## 设备、工作区与运行时

- 本轮目标为 `phone_ai` 管理入口唯一可见的 1 台手机，来自源中控全局设备目录；尚未建立员工绑定，不能据此认定手机独占归属该工作区。
- Agent 与 Updater 均为 v0.4.4/code15、online；无障碍 true、亮屏未锁、peerBound/canInstall true，控制端为 Agent，无待审入网申请。
- 工作区 employees=0、ziwei_connect_bindings=0；没有创建员工、员工或手机设备令牌、员工绑定。为主站验收曾创建短期 Owner QA 会话，并在结束后撤销、删除私有文件。
- 宿主有真实心跳，Codex 元数据 available；其它 CLI 不能只凭 runtimes 表 online 判为可执行，没有员工/A2A 手机链路成功证据。
- 全局本机 daemon 仍属于 test_222，端口 20242、PID 33260、ready=true；未启停、切换或改写配置。
- `final-state.json` 于北京时间 23:24:47 记录主站/控制端仍为 81b6ec8/8a4fe59、三服务 active、公开发布 v0.4.4/code15、33 条命令全部 succeeded、updates=0、pending=0。本轮没有代码部署或运行配置修改。

运行时只读证据：`runtime/assessment.md`、`runtime/server-runtime.json`、`runtime/local-readyz.json`。

## MCP 实际失败与管理员代理

终端 MCP 实际 list/status 均返回登录服务不可连接。`runtime/mcp-config-origin.json` 的脱敏检查确认本地 MCP 与凭据文件仍配置旧 IP 源站，没有打印密码、token 或 cookie。

`runtime/mcp-tls-probe.json` 的无凭据只读探针在证书校验开启时记录旧 IP 请求失败 ERR_TLS_CERT_ALTNAME_INVALID；正式域名 healthz 返回 200。本轮未修改入口配置或绕过 TLS 校验，MCP 链路仍未通过。

所有设备动作由主任务独占，通过正式域名主站 Owner 代理执行。管理员代理成功证明主站控制 API 与真机可通信，不能扩展为员工执行或 MCP 成功。

## 命令、画面确认与读取异常

逐条命令及回执位于 `commands/`，对应截图位于 `phone/`。33 条真实命令分类为 17 次 screenshot、9 次 tap、5 次系统 back、2 次 launch，全部 succeeded。

- 首次进入目标页的 04 tap 虽回执成功，真实画面未切换；观察后 06 新的定向点击才确认到达目标页。命令成功与界面到达分别核对。
- 两次大响应读取在 20 秒超时，但手机命令已 succeeded，没有重放；`commands/17-work-order-menu-readback.json` 为只读补取。读取异常保留，不以最终成功抹去。
- `30-system-settings` 打开 com.android.settings，回执 succeeded、performed=true、foregroundVerified=true，前台包名及 component 为系统设置；`phone/31-system-settings.jpg` 确认设置主页。没有改写设置。
- `32-global-back` 回执 succeeded、performed=true；`phone/33-restored-douyin.jpg` 确认已恢复原应用和查询页面。具体账号、作品与指标见本地私人报告。

## 网页后验与会话清理

动作前网页只读检查位于 `browser/connected-before-actions/`，UI 错误 0。动作后检查为 `browser/after-real-actions/results.json`，北京时间 23:25:04–23:25:26，passed=true：

- 设备列表 1 台且正确选中；双端 online，Agent 控制，待审与员工绑定均为 0。
- 真实 image/jpeg 截图 720×1612 加载完成并正常渲染，capturedAt 为北京时间 23:23:42.372。
- 完整详情含 33 条 succeeded；DOM 最近 20 条均显示“执行成功”，有完整回执入口；未把列表 summary 的空历史当成详情。
- pageErrors、consoleErrors、request failures、API body 读取失败、alerts、blocked writes 均为 0；1440 px 下 document/body 均 1440，无横向溢出。
- 后验 realDeviceActions=0，所有观测请求均 GET；此前两次大响应超时没有再现，本轮没有因该读取异常改动产品。

`session-cleanup.json` 记录 qaSessionRevoked=true、privateFileRemoved=true；主任务另确认本机私有 session JSON 已删除。本轮短期 Owner QA 会话不保留为后续登录入口。

## 尚未验收与历史状态

- 已有数字员工绑定及员工手机执行：当前员工/绑定均 0。
- 终端 MCP 恢复后的真实 list/status 与动作：当前调用失败，本轮未改配置。
- 真实双端升级、业务消息、内容发布，以及从零开始的 APK 安装/权限申请/入网流程。

此前 `.local/install-live/` 等“手机 0、待实机”记录是发布阶段历史。本轮已取得 1 台真机的管理员控制与网页后验证据；该结论不包含员工/MCP 链路或未执行的升级与业务任务。
