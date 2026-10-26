# 员工能力明细验收记录

日期：2026-10-26（Asia/Shanghai）。基线：`8fae99f41260a1c090bd54697b6317215256e2ed`，保留 Provider/独立 Key/安全交互/默认权限/全员工列表/客户端维护修复。本记录随实现提交，不表示已部署。

## 源码验证

最终联合回归 **124/124 通过，0 跳过、0 失败**：

```powershell
node --test backend/employee-capability-inventory.test.mjs test/employee-capability-inventory.test.mjs test/employee-capability-dispatch.test.mjs frontend/src/employee-capability-inventory.test.mjs test/bot-capabilities.test.mjs frontend/src/bot-capability-actions.test.mjs frontend/src/bot-mixed-roster.test.mjs frontend/src/bot-workbench-loading.test.mjs frontend/src/bot-workbench.test.mjs backend/bot-page-read-view.test.mjs test/action-execution-budget.test.mjs test/daemon-employee-parallel.test.mjs test/directory-inspection.test.mjs
```

`npm run lint` 检查 264 个源码文件通过；`git diff --check` 通过；最终 `npm run build` 通过（1820 modules）。保留既有大于 500 kB 的构建 chunk 提示。

覆盖：混合员工列表无 N 次重型读取、不初始化 Bot；两个员工共享安装但授权独立；同名 Skill/MCP 的 Profile 隔离；设备、配置指纹及 revision 变化；领取/执行前拒绝旧绑定；旧客户端、离线、超时、撤权、迟到回执；未知数量与截断；脱敏投影；缓存 GET 无写入；真实 dispatcher 使用员工工作目录与 15 秒截止；已有并行员工与目录检查行为。

## 独立审查

客户端、平台、前端由不同实现者交叉审查，集成后另有独立审查。发现并修复：

- 员工归属转移后暴露旧归属的历史快照；前端账号/归属切换及名册刷新保留旧缓存。
- 包名字段绕过脱敏、字段投影遗漏、未知数量误写为零。
- 15 秒截止未真正应用到 dispatcher。
- 缺失或未扫描外部技能根被误判为完整目录。
- 201 条清单被静默截断却返回精确总数。

上述问题均有回归或独立重现验证；最终审查无未关闭的已确证 P1/P2。

## 页面布局与交互

使用组件编译后的静态 SSR 样例检查桌面正常、等待检查、离线上次记录三个场景，样例醒目标注不含真实能力或授权证明。4 个修改的 Vue 组件编译通过；控制器测试覆盖按需读取、缓存轮询上限、切换员工/设备/归属、未知刷新结果与网络失败。

桌面截图已检查；320、390、430 像素 CSS viewport 的 `scrollWidth === clientWidth`，对应内容高度 3024、2855、2775，无横向溢出。移动验收采用精确宽度 iframe，避免 Edge 最低窗口宽度造成截屏裁切。静态样例不是生产页面端到端验收。

## 目标电脑只读检查

候选采集器只读两个已有不透明 Profile 目录，分别返回 1 与 3 个 Skill；未确认真实员工绑定，授权与实际加载均为 `unknown`。可信 npm 元数据核实飞书 CLI 1.0.0、工作区 CLI 2.0.2、爆款库 CLI 1.1.0、记忆 CLI 0.2.1；共享发现仅读取一轮并复用缓存。Team 未取得匹配包元数据，LibTV 未取得受管理安装回执，保持未知。

本次没有执行 CLI、调用模型、运行真实员工/手机任务、安装工具、读取登录凭据文件、启动业务服务或升级已安装客户端。仅为隔离测试创建模拟进程和临时目录。原生配置可在本机解析，回传内容不包含命令、环境变量、凭据、路径或 Skill 正文。

本机忽略目录 `.local/employee-capability-inventory-qa/` 保留脱敏元数据报告、SSR 样例、截图和布局指标；不上传本机原始材料。当前正式客户端没有本批清单上报能力，源码验证与未来发布、升级、真实员工授权验收分开记录。
