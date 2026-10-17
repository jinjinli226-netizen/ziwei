# 会话目录绑定持续等待修复

用户反馈 TikTokTrendS 点击目录提示正在核对 Bot 绑定，切到仅本人可见的秘书员工知微也出现同样阻塞。

根因有两处。会话绑定 watcher 使用返回新数组的单 getter，每次消息/执行详情替换对象，即使会话和员工 ID 不变，也重新发起绑定请求、设置 pending 并废弃上一代结果；轮询或实时事件快于请求时会反复等待。另一个入口将普通对象赋给 Vue ref 后与原对象比较，响应式代理不相等，首次主会话加载失败时无法清除手动设置的 pending。

改为监听会话、员工、工作区、当前账号的标量身份；内容刷新不重启绑定。迟到结果按完整作用域丢弃。主会话入口保留响应式对象身份，以便失败只清理自身。目录打开时仅为已配置 Bot 定向更新 revision/control epoch；普通员工不重复查询。等待期间换员工、账号、工作区或离开聊天均不打开过期弹窗。“使用当前目录”在异步完成后再选择设备默认路径。

权限、员工可见范围、设备绑定、Profile/HOME 和后端目录检查规则保持。提示改为当前员工的目录设置，避免把所有员工都称为 Bot。

验证：新增真实 Vue ref/watch 与实际 App.vue 函数生命周期回归，旧代码 7 项失败，修复后 10/10。连同目录操作、主聊天、工作目录回归共 37/37；lint 和前端构建通过，独立代码审查完成。没有调用模型、改员工配置或写入用户目录。发布按先推 GitHub，再仅切换前端静态资源执行；API/Windows 包保持既有版本。

产品提交 `9ba205d68ea1c50bc93118f0780335a6394da808` 已先推 GitHub，2026-10-17 09:36:29（Asia/Shanghai）完成仅前端发布。公开首页、全部新静态资源和版本元数据哈希校验通过，服务身份、API路径、官方客户端包、数据库 inode 保持。

- 前端首页 SHA-256：`3f29ad467aa21f84bddb6c563cec49f6f11c5d978e3a872ce6a7053da67d18d4`
- 发布结果：`/opt/ziwei-staging/frontend-directory-9ba205d/publish-result.json`
- 回退备份：`/opt/ziwei-staging/backups/frontend-directory-9ba205d68ea1-20261017T013629Z-06809a02`
- API仍为 `eabe098`，Windows官方包仍为 `5db7d83`，没有重启服务或启动本机监听端口。

本轮回退仅恢复备份中的 index.html 和 FRONTEND_RELEASE.json，保留业务数据与旧哈希静态资源。

正式页面实测已通过：TikTokTrendS 在公司台式成功打开目录弹窗并读取 `D:\AIUSE\TikTokTrendS`，返回目录存在、3个盘符及5个子目录；知微在李金晋电脑成功读取原会话目录 `C:\Users\25941`，返回目录存在、2个盘符及115个子目录。仅发起各一次只读目录检查，未选择/保存路径、创建目录、修改员工资料、调用模型或更改可见权限。测试临时浏览器页已关闭。

截图留在主工作目录 `output/verification/tiktok-directory-fixed-20261017.jpg` 和 `output/verification/zhiwei-directory-fixed-20261017.jpg`。用户刷新网页即可，无需更新Windows客户端。
