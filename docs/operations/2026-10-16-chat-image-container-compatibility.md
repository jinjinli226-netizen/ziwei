# 2026-10-16 聊天图片格式兼容修复

## 故障与确认范围

用户在 Bot 主聊天选择三张微信 PNG 后，网页提示“图片内容无效或格式不支持；支持 PNG、JPEG、GIF、WebP”，并反馈 JPG 不能发送。已取得报错截图，未取得这三张原始图片，因此不能断言原文件一定具有下述特征。

实际复现了同样错误：旧服务端要求 PNG IEND、JPEG EOI、GIF trailer 精确位于文件末尾，WebP RIFF 长度精确等于文件总长度。真实可解码图片末尾附加 CRLF、NUL 或其他数据后，浏览器仍能预览，前端完整传输原字节，但服务端拒收。执行端输出图片有同样的重复校验。JPG 是 JPEG 的常见扩展名，原识别代码已支持 JPEG；选择入口和提示未明确列出 JPG。

## 实现

- `src/raster-image.mjs` 提供共享、有大小边界的容器结构识别：按 PNG chunk、JPEG segment/scan、GIF subblock 和 WebP RIFF chunk 寻找完整主图边界。支持渐进 JPEG、EXIF 内嵌缩略图、动画 GIF/WebP；不把内部缩略图或元数据里的结束标记当作主图终点。
- 服务端入站附件与客户端输出产物使用相同规则。完整图片后的数据保留，原始字节、文件顺序、大小、base64 均不裁剪；仍限制每条 20 张、合计 10 MiB，拒绝截断、缺失图像数据、错误 MIME 和损坏容器。此校验不是像素或熵流解码器，不宣称能识别一切像素损坏。
- `image/jpg`、`image/pjpeg` 统一为 `image/jpeg`。文件选择器显式包含 `.jpg`/`.jpeg`；界面显示 JPG/JPEG。失败时提示具体文件名，一张失败不会留下半条消息或任务。
- 旧测试中不完整的 67 字节 PNG、四字节 JPEG 和空 WebP 占位样本替换为真实 Pillow 图片；保留这些伪图片被拒绝的反例。

## 验证

相关后端/运行时 92 项，最终 84 通过、8 项 Windows 专用跳过；前端 229 项最终全部通过，共 313 项通过。lint 146 源文件、生产前端构建及离线安装依赖闭包通过。

新增真实 HTTP 链路测试使用三份实际图片 File（带尾随数据的 PNG、JPG、渐进 JPEG），经前端读取和 JSON 请求、真实登录身份校验、消息保存、幂等重试、设备 A2A 下发、结果图片回传及历史读取，逐张比对完整原字节和顺序。损坏第二张时返回其文件名，消息与任务数不增加。未调用生产 Bot、用户手机或真实模型，不把这次测试记为 Windows 真模型多图验收。

另经独立结构审查修复 JPEG 新帧借用旧扫描状态、WebP VP8 声明分区超出 chunk 的问题；真实动画 WebP 内存正例与截断反例通过。没有为本次改动增加生产图像解码依赖。

HTTP 回归使用端口中心登记 `221 / 127.0.0.1:8181`，以固定端口预载串行运行；检查无未登记端口、无冲突后释放。首次固定端口运行有连接池复用已关闭服务导致 ECONNRESET，关闭该测试连接复用后整文件通过；前端的一项 HTTP 测试最初被禁止监听预载拦截，随后转到登记端口通过。协作过程中另一次旧测试误启动 `listen(0)`，已核实子进程退出、监听关闭，并按登记端口重跑，不能将该历史执行描述为符合端口规约。

## GitHub 与发布

源码提交 `cd610444ce793d6e5fbebfa7ed1b982c070ad9a3` 已先推送并用 `ls-remote` 核对发布分支 `codex/v2-20261014-release`，再从同一提交打包部署。于 **2026-10-16 00:49:35（Asia/Shanghai）** 发布主站、API 与官方下载包。

- 当前目录：`/opt/ziwei/releases/v2-hotfix-cd610444ce79/v2`。
- 上一主站目录：`/opt/ziwei/releases/v2-hotfix-ead2ac9281c4/v2`。
- 备份：`/opt/ziwei-staging/backups/image-container-20261015T164930Z`，含主数据库快照及上一官方下载包和发布元数据。
- 发布记录：`/opt/ziwei-staging/image-container-cd610444ce79/deploy-result.json`、`independent-verification.json`。
- 新 clientBuild：`6de43142dce43675f6b8c8c56fd8d306eec0b0dcea8920091936c1b6c1a1b829`。
- sourceBuild：`954242477f3c24693904a3d6b1ca67c193fcb437e86638e4391537623eb75eb0`。
- 包 SHA-256：`7d1a231f6bedd897baf314a9e66339f58abdb2fc8d695bffb535fd04dc49282d`，1,064,245 字节。
- 前端资源：`/assets/index-Dc-SfXsL.js`，SHA-256 `c4119cc6270fbe23fcc9bf1ec2395c5ec707a11fbafe832ec5e93bd99512f50e`。

已独立公网回读健康接口、JPG/JPEG 界面资源、release.json 与完整下载包；三个服务 active。最终发布确认数据库 schema 与文件身份未变，control API/Nginx 的进程和配置未改变。

### 发布中断及恢复

第一次发布在 00:45:52 的数据库只读备份步骤失败：停止 API 后留下需要 SQLite 自动恢复的 rollback journal，只读连接无法进行恢复。发布脚本切回旧目录，但旧服务启动检查也被该 journal 阻塞，期间曾观察到 502。

先停止主 API，将原数据库及 journal 原样保存在 `/opt/ziwei-staging/backups/image-container-journal-recovery-20261015T164804Z`，再以 SQLite 正常可写连接触发自动恢复，未删除 journal、手工清理业务记录或用旧备份覆盖数据库。完整性检查为 `ok`，保存 recovered.sqlite；00:48:54 公网健康回读恢复。修正发布步骤：备份前允许 SQLite 正常恢复 journal，回退重启前也做同样恢复；随后重新部署通过。首轮记录保存在 `deploy-result-attempt1.json`，未上线的首轮解包目录保留在同 staging 的 `unused-release-attempt1`。

后续若停止 API 后只读连接出现同类错误，应保留原文件并让 SQLite 正常恢复，不可删除日志绕过，也不可仅凭 systemctl start 返回成功认定服务恢复。

## 用户使用及回退

网页上传校验修复在服务端，刷新网页后重新发送即可，不要求先升级 Windows 客户端。客户端返回图片的同类兼容修复需要安装新包；新包同时包含之前的登录续期、停止维护及 Hermes 0.22 启动器修复。设备已升级与模型实际读图仍应以设备后续回执为准。

回退本次代码时可切回上述上一主站目录，并恢复本次备份的官方下载包/元数据；保留当前业务数据库，先处理可能的 SQLite journal 恢复，再核对健康和公网资源。没有 schema 迁移，不需要恢复旧业务数据库。本记录不证明 V1.0 数据兼容回退。
