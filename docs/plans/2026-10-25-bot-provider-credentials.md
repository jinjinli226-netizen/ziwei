# Bot Provider、独立密钥与受控交互实施计划

日期：2026-10-25。基线 origin/main 98dfa12；仅隔离源码与合成测试，未授权部署或真实业务。

目标：沿用浅色基础配置入口，以 Provider 关联模型；独立安全密钥通道绑定用户/工作区/员工/电脑/服务商；分别显示页面保存、设备同步、配置检查、真实调用。保留来源认证兼容状态和原 Profile/HOME。

设计：公开 Bot config 只含 provider/baseUrl 等路由；密钥经独立受权限控制的加密通道传输，设备受保护存储和运行时内存读取，不进入通用动作。凭据替换/清除使用单调版本，拒绝迟到应用。服务商切换不复用不匹配凭据，不继承错误 GPT endpoint。离线及旧版本标待同步，未执行真实调用标未验收。

1. Provider owner（主代理）：先写模型组合/endpoint/默认兼容失败测试，扩展公开路由验证、运行时生成和基础配置 UI；复用既有安全能力并接入独立通道。
2. credential owner（provider_secure_channel）：核实完整加载链，测试两个员工隔离、加密绑定、保留/替换/清除/迟到/权限拒绝，实施后端设备专用通道与安全存储、bootstrap防覆盖。公共app接线由主代理执行。
3. interaction owner（secure_interaction）：核实实际 Hermes/Team 协议，实施可核实的等待/应答/取消/到期桥接及合成测试，协议不支持时明确 pending/unsupported，不能假续接。
4. autonomy owner（controlled_autonomy）：核实权限/平台调度，默认最高已支持执行能力，显式只读保留；以受控适配替代可替代的粗粒度拒绝，保证唯一调度与取消闭环。
5. 集成：专题文档和功能索引，相关测试、lint/build及必要 UI 验证，独立审查修复，提交并推送 codex/bot-provider-credentials 后核对远端 SHA。

不读取真实Key，不执行付费模型、员工/设备/手机业务，不重启升级客户端，不恢复或启用历史自动化。测试监听前遵循本机端口技能；不监听的单元测试优先。
