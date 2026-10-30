# 统一身份模式下的配对设备管理 MCP

2026-10-30，依据本机部署现场排查：设备 bootstrap 成功返回短期 `zmcp1` 凭据，但调用管理 MCP health/discovery 时统一身份守卫把该凭据当作人类访问令牌验证，返回 401，导致原生运行时无法准备管理工具。

`backend/app.mjs` 的管理 MCP 路由现在先调用已有 `managementBootstrap.authorize`。只有签名、有效期、工作区、设备凭据及当前成员权限全部有效时，才沿用它返回的受限 `mcpCredential`，包括 `deviceScope` 和设备归属检查。非 bootstrap 凭据继续进入原统一身份守卫；统一模式不恢复旧静态 owner token，也不把设备凭据用于人类 API。

验证入口：

```powershell
node --test backend/identity/app.test.mjs test/management-bootstrap-security.test.mjs
```

`createApp({memory:true})` 回归覆盖真实设备配对、HTTP bootstrap、管理 health/discovery 及仅本机设备发现；伪造、过期、跨工作区、设备停用、设备凭据撤销、成员移除和旧静态 owner token 均被拒绝。原统一身份访问令牌的读写和撤权回归继续执行。本次源码验证不等于正式服务已部署，也没有调用模型或更改生产身份配置。
