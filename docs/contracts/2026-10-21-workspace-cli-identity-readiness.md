# 驾驶舱 CLI：统一身份接点与待接入边界

规范 1.2.0 / 机器契约 v1；核实源码基线 b8c8a669e0fb18623166628bd3e1088dfb133249。本说明记录接入准备，不表示六站统一身份或生产接线已经完成。

## 当前身份路径

- 人的迁移兼容：`POST /api/auth/login` 使用原账号协议，服务端用 `Set-Cookie: ziwei_session` 签发独立会话。`GET /api/auth/me` 实际验证会话，`POST /api/auth/logout` 撤销当前会话。`backend/auth.mjs` 继续按原 user_id、memberships 和角色处理资源访问；CLI 不注册账号、不复制其他站密码、不自动合并邮箱。
- 已授权电脑的管理兼容：`backend/management-bootstrap.mjs` 签发 `zmcp1` 短期凭据，现有 audience 固定 `ziwei-management`，绑定原工作区、设备及 device credential。一小时有效期和每次请求的成员、设备停用/撤销检查仍由后端实施。它不是新统一员工身份，也不是跨站 token。
- 独立 CLI 的 `--account`、`--profile`、`--purpose` 只是凭据槽选择器；`--purpose employee` 不赋予员工身份，输入中的 employeeId 不成为可信 principal。CLI 只接受明确提供的原生受限 managed credential，不默认发现或导入旧静态 owner token。
- 原 `ziwei_user`、管理 MCP、设备配对与 Control 均保留。当前改造没有更改后台授权或线上身份数据。

## 等待统一协调的接线

统一 issuer、每站 audience、client 配置、机器员工授权流程、令牌验证/撤销接口及身份绑定契约尚未由协调者固定和部署。本项目不猜测这些值，不新建第二个身份源。

后续受信接口接入必须保持以下接点：

1. **受众验证**：进入 `backend/app.mjs` 的会话与管理 guard 前，验证受信 issuer、固定本站 audience、签名、有效期及撤销状态。拒绝其他站 token，不复用历史共享 audience 候选。
2. **显式身份绑定**：用受信 `issuer + subject` 绑定原 user_id 或明确的员工 principal，保留现有成员、租户、资源所有权；绑定冲突必须可见。不能按同名或邮箱自动迁移。
3. **分站及动作授权**：统一身份认证不生成本站业务 grant；将本站 grant 与原角色、员工可见范围、设备范围、资源及动作权限逐次相交。缺 grant、禁用或撤销后立即拒绝。
4. **独立 CLI 会话**：在原生身份源提供支持后接通 `auth login --mode unified`；仍按站点/origin/profile/account/purpose 保存受众受限凭据。当前命令明确返回 NOT_SUPPORTED/pending，不降级为通用管理员身份。
5. **站点退出**：默认只撤销当前站点 CLI 授权；跨站退出需单独的显式操作和身份源真实回执。原 managed 模式没有本 CLI 的远端撤销入口，不能虚称已全站注销。

## 验收状态

本次可在随机夹具与内存 Repository 验证原生成员、设备范围、撤销、受众与失效负例，并验证新 CLI 的槽隔离、错误/状态契约与不重发。

统一身份跨站登录、A 站 token 访问 B 站拒绝、无本站 grant 拒绝、统一禁用/撤销、显式旧账号绑定迁移均属于 **C13 pending**。它们需要协调后的真实身份接口与各站集成，不能用旧原生登录或本地模拟称作通过。生产部署不在本轮授权范围。
