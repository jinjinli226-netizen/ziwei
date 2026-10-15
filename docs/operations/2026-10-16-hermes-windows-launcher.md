# Hermes 0.22 Windows 启动器与 Bot 创建

## 真实故障

公司台式 `device_11af6d85-6c5c-4cbe-9a25-31599a474e5d` 的 Bot 创建动作 `action_a4ad606b-74ce-4a9e-afd3-e55722945cf4` 在 2026-10-15 23:36:53（Asia/Shanghai）失败，错误为“原生入口未绑定可核实的绝对解释器”。原员工 `employee_6479482e-0842-41ed-98b8-3dd944228a4c` 与待创建 Profile `bot-7581d9fa21f8eb1acb3a108f` 应复用，不以重建员工绕过。

当时设备已运行客户端 build `a996e94aebec66b15636d526be8013746617950fab1858d4815720c7b93cb5f1`。Hermes 的实际探测入口为 `C:\Users\PC\AppData\Local\hermes\bin\hermes.exe`，版本 0.22.0、`versionSource=cli`、available。这是启动器适配阶段失败，尚未进入模型请求，不能归因为代理、订阅失效或早期版本探测超时。

## 修复依据

- [Hermes v0.22.0 官方启动器](https://github.com/NousResearch/hermes-agent/blob/v0.22.0/hermes_cli/_launchers.py) 使用绝对 store Python 和 `-I`，启动脚本先加载所属安装的 `hermes_bootstrap`，再调用 `hermes_cli.main`。旧紫薇将整条 shebang 当文件路径，既不识别 `-I`，也没有恢复原生依赖加载过程。
- [uv 0.12.3 启动器](https://github.com/astral-sh/uv/blob/0.12.3/crates/uv-trampoline-builder/src/lib.rs) 另有将 Python 路径和入口 ZIP 放在 PE 资源中的格式，不能只扫描 `#!`。它是兼容分支，不代表公司台式的实际入口必定使用 uv。
- 旧绝对 shebang、UTF-8 路径和官方 venv 转发入口仍须兼容；不搜索并替换为系统 Python。

## 实施与验收

源码 `528361d80bf7ac3976bff621cb9d5ac044129cb7` 已推送到 `codex/v2-20261014-release`，远端提交核对一致，然后于 **2026-10-16 00:24:43（Asia/Shanghai）** 发布官方客户端。

实现包含：精确从 distlib 的入口 ZIP 定位 shebang，避开 PE 内部的 `#!` 字符串常量；保留原解释器的 `-I`；从入口 AST 绑定所属安装和原生 bootstrap，恢复其依赖加载；所有创建、配置和原生动作入口同步调整参数位置。启动器、源码和转发入口变化均继续校验，Bot 原独立 Profile/HOME 与来源认证机制保持。

实际支持的格式为 0.22 默认 distlib EXE、旧绝对 shebang、UV PE 资源和旧官方 CMD 到 venv EXE 的转发。0.22 的 Base64 CMD 备用形式未在本次扩展；公司台式上报的是 EXE。

验收结果：

- 11 个相关测试文件共 73 项：首轮最终回归 72 通过、1 项因默认 `python` 命令不可用跳过；将已安装 Python 放入测试 PATH 后，单独补跑该项通过，共 73 项已验证。lint 145 个源码文件、diff check、归档构建和离线安装依赖闭包验证均通过。
- 官方 Hermes `v0.22.0` 源码加 distlib 0.4.3 原始模板生成的 EXE，经过实际 `hermesMcpSpawnSpec` 自动探测、`-I` 和新参数位置执行，创建独立 Profile 成功，重复创建保留记忆，配置检查 `valid:true`，篡改绑定被拒绝。来源 config/.env/合成授权未变，未复制授权。
- 上述原生流程在 Mac 的 Python 中离线执行，PM 的 `prepare_launch`、`recover_if_needed`、`activate_dependencies` 使用测试替代以复用现有依赖；其余 bootstrap、profiles、config 等为官方源码。没有运行 Windows PE、真实模型或真实订阅授权。源码归档缺安装版本印记而报告 0.0.0，版本依据是 v0.22.0 tag 和归档 SHA `61333ab64f7ad728bc265d103fd73b2eb4b936f9c8d9fe3ccf2531ad955e96a1`。
- UV 0.12.3 官方模板的独立样本另行通过解析与原生 Profile 创建测试。上述样本均不能代替公司台式升级后的真实结果。

本机原始证据在 ignored `.local/hermes-022-official-launcher/flow-proof.json`、`.local/uv-official-launcher-probe/` 和 `.local/bot-stop-hotfix/528361d80bf7/`；本文件保留可通过 GitHub 接续的结论与限制。

## 发布与回退

- 官方包：`https://qzelynth.top/downloads/cli/ziwei-latest.tgz`；build `c3ec583e44396579a8d4bd601061a62de69e184931adc22691917021fd1c3c48`。
- 包 SHA-256 `0448b7baf714159007578f69601557de05ae5baac9539a44219d9c289bd304ca`，1,061,507 字节；服务器及公网独立读回与 metadata 均一致。
- 原客户端下载备份：`/opt/ziwei-staging/backups/hermes-launcher-client-20261015T162443Z`。回退范围为其中原 `ziwei-latest.tgz` 和 `release.json`，不覆盖业务数据库。
- 主站/API 仍是 `ead2ac9281c47624929f433bc190b44e2659498c`，三个服务、Nginx 配置、当前发布路径和数据库文件身份核对保持。仅更新官方客户端下载包，无主站切换。

公司台式仍需更新本机客户端，随后重试原 Bot 的创建，回读同一员工的成功回执和独立 HOME。服务器下载包更新不等于 Windows 已完成升级或创建。可在该机 PowerShell 执行官方更新入口：

```powershell
irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex
```
