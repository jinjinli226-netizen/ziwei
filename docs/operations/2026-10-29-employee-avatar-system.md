# 角色与图片头像

用户要求复用 DSH Bot 的“小眼睛”头像，并保留紫薇原有图片上传。现在所有员工共用同一头像编辑器和显示组件，角色与图片均使用原员工头像保存流程。

## 来源与交互

`src/employee-avatar.mjs` 复用 `D:/dshbot/ui/avatars.js` 的 25 个形状路径、11 种颜色、眼睛位置和确定性选择算法。来源工作区读取时 HEAD 为 `6bc343682f3b76cd42247f37d583d60be30afbe0`；实际源文件 SHA-256 为 `b41b482500ae64ac9eb9f9504686b8a2ea9e378f16cc13afd0deceb9fc55af3f`。保留原 `grok:shape:color` 角色值；不引入旧数值头像适配。SVG 通过隔离的图片源显示，不把用户内容作为 HTML 执行。

头像选择提供“角色头像”和“上传图片”两种模式。角色可选形状、颜色；图片继续支持 JPG、PNG、WebP，最大 2 MB。切模式只预览，明确选用后修改当前草稿，提交员工／Bot 配置后生效。未保存的两类草稿可以往返切换。

确认保存角色后，旧的服务端图片 URL 缓存会失效并从编辑器清除，避免将已被替换的图片链接写回存储。仍持有实际字节的本地图片草稿可以重新选用。新建员工未指定头像时，提交创建预览对应的角色值，避免保存后因新员工 ID 变化而换形状。

创建和编辑员工复用 `BotAvatarEditor`，按账号、工作区和编辑代次卸载旧选择器；原裸 FileReader 路径删除。读取期间阻止提交，关闭／换员工取消旧读取，迟到结果不能覆盖当前头像。Bot 的保存未知、冲突与草稿保护保留。

## 保存与读回

- 数据库仍使用单个 `employees.avatar` 文本字段。角色值仅允许已知形状／颜色枚举；原图片字符串、URL、空值合同保留，不新增数据库列。
- 轻读／移动投影继续返回原受权头像地址，角色头像额外提供只读 `avatar_character` 供网页恢复形状与颜色。编辑时优先读取该角色值，提交仍只发送 `avatar`，不提交派生元数据。
- 原头像接口按已保存枚举生成可信 SVG，保留员工可见性、工作区授权、私有缓存和条件请求。查询参数不能指定 SVG 内容；原图片字节和 MIME 不变。
- 角色切换为图片或移除时，前端合并清除旧角色标记。原图片引用未改变时仍不作为替换头像重复提交。
- `EmployeeAvatar` 覆盖员工名册、管理页、聊天头部／助手消息／空态、团队和会话列表。真人账号头像、运行时图标和公司 Logo 不改。

## 验证范围

- 全部 `frontend/src/*.test.mjs` 加现有布局合同 **578/578** 通过；文件集合和日志在 `.local/employee-avatar-frontend-files.json`、`.local/employee-avatar-frontend.log`。
- 共享角色生成与后端头像定向集合 **13/13** 通过。命令：`node --test --test-name-pattern "avatar|character|Hermes avatar-only" backend/mobile-read-view.test.mjs test/employee-avatar.test.mjs`。覆盖创建／修改／读回、无效枚举拒绝、私有头像授权、缓存版本、图片往返、Hermes 配置与执行版本不被头像修改影响。HTTP 使用内存请求对象，没有监听服务。
- `npm run lint` 检查 **344** 个源码文件通过，前端构建通过；保留既有入口包大于 500kB 的提示。
- 静态预览使用真实组件和明确示例数据：`node frontend/verification/bot-management-preview.mjs .local/employee-avatar-preview --avatars`。角色选择和图片上传模式在 1440×1000、390×844、844×360 共 6 帧检查无横向溢出、输入与管理区域可达；图像和尺寸证据位于 `.local/employee-avatar-preview/`。预览不连接生产设备或模型，不使用 Computer Use。
- 加入角色头像后，Hermes／DSH／Codex 共 27 帧统一工作台预览通过，覆盖聊天、设置和展开名册；证据在 `.local/employee-avatar-chat-preview/`。两个头像组件通过原版设计 Skill 静态审计，记录在 `.local/employee-avatar-design.log`。

本轮后端完整回归未宣称通过：一次较广的执行／队列集合存在未定位断言失败，大事件能力回执用例出现内存分配错误；未证明其基线归因，也未扩大本轮头像改动追查。头像定向集合与前端回归通过，源码发布和线上实际验收分别确认。
