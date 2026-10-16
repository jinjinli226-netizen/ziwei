# 2026-10-16 Hermes 0.22 原生 YAML 兼容修复

## 最新现场回执

公司台式确已升级上一版 `12932d5c024d1bb36584a96f2e06c6d334f5cee5c74fd60fc4d73e8999f3550f`，PID 16228，Hermes 0.22.0 在线。重试动作 `action_b3069ba8-b020-40ac-9de5-ab33de4c10fb` 于 **09:47:47–09:47:56（Asia/Shanghai）** 执行，仍失败：`native_imports / ModuleNotFoundError / missingModule=yaml`，位置 `hermes-owned-profile.py:_provision:87`。Windows Job 根进程 21492 已退出 0，执行树完整退出。

新 `runtimeStartup` 明确为 `launcherKind=distlib-isolated`、`bootstrapBound=true`。因此上一版修复的非 isolated 初始化缺口**不是公司机这次实际故障点**，不能继续说用户未更新或未加载 bootstrap。

## 原因及修复

官方 0.22 的 `hermes_cli/config.py`、`profiles.py` 使用同源码 `hermes_yaml`，后者使用 `ruamel.yaml`；核心依赖声明对应 ruamel。PyYAML 仍可能随可选/传递依赖出现，但不能假定任何正常 Hermes 安装都有 `import yaml`。紫薇有两个错误假设：创建独立 Profile 时直接导入 PyYAML；启用 Bot 工具后读取 managed overlay 时也直接导入它。

现两处共用 `hermes-yaml-compat.py`，优先使用已绑定 Hermes 源码根下的 `hermes_yaml`，校验实际来源和接口，文件纳入启动 fingerprint。只有原生 wrapper 确实不存在、且同源 config 的 AST 明确使用旧 `yaml` 时，才使用旧版 PyYAML。新版内部缺 ruamel 时保留真实错误，不静默回退；不向用户安装补丁依赖、不改 Python、不重建来源 Profile。

上一轮真实 PM 测试人为将 PyYAML 放进 generation，验证了依赖激活，却掩盖了“不应依赖 PyYAML”的假设。已改成仅含真实 ruamel、全过程无法导入 PyYAML 的测试环境，明确撤销上一轮对公司机根因的推断。

## 验证范围

- 最终相关 7 文件 Node 回归 **41/41**，0 skip；独立复审 **22/22**。
- 官方 v0.22.0 源码、真实 PM 激活、真实 ruamel 专项内部 **5/5**：普通及 distlib-isolated 适配均完成原生创建、重复请求和配置读回；记忆与来源认证/配置保留；缺 ruamel 不偷用 PyYAML；变更 bootstrap、跨安装依赖目录拒绝。
- 常规环境 ruamel 0.18.17 通过后，另下载官方依赖固定的 **0.18.16** wheel，核验 PyPI SHA-256 `048f26d64245bae57a4f9ef6feb5b552a386830ef7a826f235ffb804c59efbba`，仅解压到私有测试目录；同一官方 PM 专项 **5/5** 再次通过。产品没有安装或打包该 wheel。
- 工具配置专项使用原生 YAML 接口 fixture，禁止旧 yaml 导入，验证管理/手机 MCP 过滤仍有效及 YAML 源码变更拒绝；该 fixture 不是实际模型或手机操作。
- Python 诊断内部 **15/15**，148 源文件 lint、AST、构建及离线发布包依赖闭包通过。没有启动本地监听或修改生产员工数据。

上述是离线源码及隔离适配验收，**不是 Windows 真机已成功**；合成 isolated 容器不执行 Windows PE。本次针对已确证的接口假设错误，实际结果仍须新客户端回执。

## 发布与下一步

源码 `d915129bf45bbb555cb1a089593c9c9cdc940d59` 已先推 GitHub `codex/v2-20261014-release` 并核对远端，再于 **2026-10-16 10:00:28（Asia/Shanghai）** 发布官方客户端。

- clientBuild：`993639eb3840f257830c2fc8f1400339f2d3ad60a085ab27f4d547824f6b10f9`。
- 包 SHA-256：`702c9027b04a67a23e918c8ce0da7ed727f2ea355f224eb015fcf8885bda2657`；1,073,960 字节。
- 发布记录：`/opt/ziwei-staging/profile-native-yaml-d915129bf45b/publish-result.json`。
- 回退下载备份：`/opt/ziwei-staging/backups/profile-native-yaml-client-20261016T020028Z`，可原子恢复 `release.json` 与 `ziwei-latest.tgz`；不恢复业务数据库。

服务器已公网读回完整包与元数据；主站/API 保持 `cd610444`，服务、Nginx 配置、数据库文件身份保持。本次只发布 Windows 客户端下载。

公司台式运行官方更新入口后，应先核对心跳 build `993639eb…`，在原员工 `employee_15c315d3-2223-40f6-b9c9-5ffc4d0f1130` 的 Bot 重试创建。仍使用原 Profile `bot-ae3870b2c57ac0db01035511`，不继续新建员工。接手者直接查询新回执，不先要求重装 Hermes、手动安装 PyYAML或重新登录订阅。
