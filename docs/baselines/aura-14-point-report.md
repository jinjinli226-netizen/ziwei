# Aura 14 点验收基线报告

日期：2026-10-01
工作区：`test-111`
基线定义：[aura-14-point-baseline.json](./aura-14-point-baseline.json)

## 验收方式

当前依赖中没有 Playwright（`npm ls playwright --depth=0` 为空）。因此自动化回归使用 Node 内置 `node:test`、`fetch` 和静态 Vue contract；同时使用 Codex 内置浏览器对运行中的 5178 页面做了人工 DOM/点击验收：

- `test/routes.test.mjs` 检查 14 点路由矩阵、页面 render 分支、全局导航/语言/帮助/快捷托盘按钮和 Playwright 限制声明。
- `test/e2e/aura-14-point.spec.mjs` 在 `createApp({ memory: true })` 的临时端口上跑 HTTP 验收，不连接、不重启用户当前运行中的服务。
- 本轮浏览器验收覆盖文档页 Git 导出弹窗、开放平台 API Key 创建/脱敏/撤销；发现并修复窄屏快捷托盘遮挡文档操作按钮的问题。
- HTTP 验收串起任务→日历、文档版本/下载/回收站、成员/设备/心跳/运行时/数字员工、技能导入安装卸载、自动化→A2A ack/result、设置/API Key 轮换和撤销、邀请查找/接受、开放平台 Agent Card、通知和会话归档。

## 结果

14 个功能点的本地实现状态已全部标记为 `complete`。这里的 complete 指前后端功能、持久化和本机 `ziwei_user` 链路已落地；远端 Git、生产外部对象存储和浏览器截图留证仍属于部署/验收边界，不影响本地功能运行。

```text
node --test test/routes.test.mjs test/e2e/aura-14-point.spec.mjs
6 tests passed, 0 failed
```

全量验证命令：

```text
npm test   # 62 tests passed, 0 failed
npm run lint
npm run build
```

新增测试覆盖登录用户创建工作区、唯一 slug、Owner 成员和新工作区 summary 路由。

本轮新增测试未要求重启现有后端/前端，也没有修改端口登记。所有 HTTP 测试使用 `listen(0)` 的隔离端口和内存 SQLite。

## 未覆盖与待补项

- 没有真实浏览器点击、键盘焦点、拖动、截图比对、剪贴板权限或窄屏布局证据；需安装 Playwright 并补充浏览器 harness。
- 任意未知路径当前没有专用“可返回空状态”render 分支；未知 `/test-111/<page>` 会按 parser 回退到首页，这一行为已由路由 contract 固定并记录。
- 实时通知现已提供 WebSocket 优先、SSE fallback、指数退避和 ready 后补偿刷新；多工作区 cron 与受控执行目录已有后端实现，仍建议在真实生产部署中做环境验收。
- 生产对象存储、HTML 描述净化和 Git 文档导入/导出已接入并有专项测试；Git 真实目录可写入但尚未接入远端仓库。
- 设备删除/重命名和 Owner/Admin/Member 资源矩阵已有 API 覆盖；仍需浏览器逐项检查权限反馈。
- 视觉还原和每条路由的加载/失败/权限不足四态需要浏览器 harness 才能逐页面留证。

## 2026-10-01 状态校准

本轮代码已把此前报告中的若干历史 partial 描述更新为可操作状态：任务泳道与拖拽改状态、日历事件/任务拖动改日期、自动化编辑/启停/立即运行/删除及运行记录、成员和数字员工动态管理、设备清理入口、头像持久化、A2A action events 查询与终态事件保护均已接入。技能中心已支持 SKILL.md 文本/文件、URL、ZIP 和在线工位复制四种来源；快捷创建附件也会随任务保存。通知通道现已支持 WebSocket/SSE 双通道；登录用户可在工作区选择器中新建项目，后端创建唯一 slug 和 Owner 成员，前端立即切换到 `/<slug>/<page>` 路由。`npm test` 62/62、`npm run lint`、`npm run build` 已通过。

仍明确延期的验收项：远端 Git 同步（本地 Git 导入/导出保留）、完整浏览器四态/截图比对和外部对象存储。Git 远程同步保持延期，不以本轮构建结果宣称完成。
