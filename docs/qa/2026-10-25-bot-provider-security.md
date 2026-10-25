# 2026-10-25 Bot 配置、安全通道与全部员工名册验收

基线：origin/main 98dfa12e74d0fbda6b05659448e14259080e21ae。隔离分支 codex/bot-provider-credentials。仅源码及合成隔离验收，未部署。

## 自动化证据

- 主回归命令：`ZIWEI_TEST_PYTHON=<现有Hermes解释器> node --test backend/bot-page-read-view.test.mjs backend/bot-interactions.test.mjs test/bot-secret-channel.test.mjs test/bot-autonomy-policy.test.mjs test/bot-autonomy-service.test.mjs test/bot-autonomy-native.test.mjs test/bot-interaction-client.test.mjs test/bot-provider-routing.test.mjs frontend/src/bot-mixed-roster.test.mjs frontend/src/bot-roster-entry.test.mjs frontend/src/bot-provider-settings.test.mjs frontend/src/bot-interaction.test.mjs frontend/src/bot-workbench.test.mjs test/hermes-bot-defaults.test.mjs test/hermes-bot-runtime.test.mjs test/hermes-bot-compression-config.test.mjs`：85通过，0失败，0跳过。含真实Node/Python加密pipe往返、真实内存repository和local-action顺序验证、Windows DPAPI合成安全保存。
- 兼容扩展：Bot page/load/capability、Hermes reasoning/turn-limits/task-conversation/reconciliation/service等12个测试文件：68项，66通过，2项因Windows不支持POSIX shebang捕获而跳过，0失败。与主回归有交集，不累加成独立测试总数。
- `test/hermes-provider-key.test.py`：3通过；`test/hermes-interaction-bridge.test.py`：6通过。使用D盘已存在Python，不安装环境或模型。
- `npm run lint`：257个源码文件检查通过。
- `npm run build`：通过；保留既有大chunk建议，无构建失败。
- `git diff --check`：无空白错误。

## 独立审查及修复

由非模块实现者分别审查Provider密钥、交互/自主、全部员工列表与UI。已修复：来源认证先行阻断独立Key；config-only未验证真实resolver；旧电脑版本忽略独立状态；历史admission被旧client重用；异常traceback泄露；独立Key继承来源代理；清除后迟到投递；员工owner/publicKey变更后的临时请求；自主工具重定向；错误Provider模型家族；Codex假待配置状态；新建模型选项受当前员工污染；部分补丁把历史显式只读升权。最终审查范围无未解决P0/P1。

真实原生接口证据：安装Hermes的主模型代码在方法内动态导入runtime resolver，进程内包装生效；已在隔离HOME、合成Key、禁止socket连接环境核实真实DeepSeek resolver，不调用模型。Team官方PKCE/worker接口只读核实，未连接生产。

## 尚未验收

未向真实员工下发密钥、未执行付费模型、未运行员工/手机业务、未启用真实Routine、未升级或重启客户端。非Windows受保护存储及Team专用设备授权仍待接入。前端构建与逻辑/加密回归通过；本地文件浏览器预览被URL协议策略拒绝，未绕过，浏览器截图/目标设备现场UI仍未验收。源码推送不代表上线。
