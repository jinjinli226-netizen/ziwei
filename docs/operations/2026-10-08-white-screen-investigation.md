# 2026-10-08 短暂白屏调查与旧文档兼容验证

## 结论与证据边界

用户报告白屏或进入后报错，随后自行恢复。北京时间 21:59–22:02 才进行只读诊断，当前访问正常，未复现实际用户事故，根因尚未证实。没有根据缺乏证据的推测重启服务、回退版本、修改 Nginx/DNS/防火墙或本机 daemon，也没有要求用户改 DNS 或切网络。

另外通过隔离旧首页文档重放，稳定复现了旧 hash 资产缺失导致的模块 MIME 白屏。该实验是独立的发布兼容缺陷，不是用户事故的复现，不能据此直接认定本次事故根因。随后在已授权的 Android 安装页发布中保留旧资产，生产重放验证此兼容缺陷已修复。

## 恢复后的只读排查

排查时主站 current=`/opt/ziwei/releases/a625350`，控制服务 current=`/opt/ziwei-control/releases/8a4fe59`，没有版本漂移。主站/控制/Nginx active、NRestarts 0，启动时间与此前发布相符。

- 服务器回环 TLS、公网 IPv4：首页、`phone_ai/ziwei-connect`、`healthz`、当前 JS/CSS 均 200，资源 MIME 与长度正确，TLS 校验通过。
- 本机 curl IPv4 直连、固定 A 地址/SNI、显式现有代理的相同入口和资源均正常，JS/CSS SHA 一致。裸域有 A、无 AAAA；强制 IPv6 无可解析地址不能算作该站 IPv6 故障。
- www 经 Cloudflare，HTML/当前资源与裸域一致且 IPv4 正常；本机 www IPv6 TCP 超时只证明这条本机路径不通，没有证据与用户事故关联。
- 新 headless 匿名 context 的 8/8 页面显示登录表单，当前资源全部 200，无 console/pageerror/requestfailure。浏览器 direct flag 本身不能证明绕过所有本机代理层，独立直连证据来自 curl。
- 当日当前资源未见 Nginx 4xx，发布后服务日志无异常退出；诊断前没有发现可与事故直接关联的旧 hash 资源请求。

原始只读证据在 `.local/outage-20261008/`：`diagnosis.md`、`server.json`、`asset-timeline.json`、`browser/results.json`、`browser/stale-document-replay.json` 与网络矩阵目录。本文不收录会话、令牌或其它秘密。

## 独立旧文档重放

当时 f88d6f8 首页引用的 `index-DI4MTrjS.js` 与 `index-Dh14YCcE.css` 已不在 a625350 当前 dist。Nginx SPA fallback 将旧资源路径返回为 200、`text/html`、426 B，而不是对应模块/样式。

实验只在隔离浏览器中替换首页文档为原 f88d6f8 HTML，资源请求仍从生产真实 GET、未 mock。浏览器产生模块 MIME 错误，body 为空且 app 无子元素。这证明旧 HTML 缓存与已删除 hash 资产组合可造成白屏，但不是用户实际缓存或事故时间点的证据。

## 发布与修复核验

北京时间 22:23，Android 安装页提交 `81b6ec8d0eb5693f3faf5eab88cd7ff2aeabdb00` 由统一发布方切换到 `/opt/ziwei/releases/81b6ec8`；source 保持 `8a4fe59`。新 dist 保留 a625350 assets，并恢复 f88d6f8 两个旧 hash 资源。此次 backend 与 69 个 runtime lock 条目无变化，未重启任何服务、未修改 Nginx/DNS/daemon；原 data/source/APK 保留。

发布前备份 `/opt/ziwei-backups/terminal-console/20261008T142230Z` 包含 12 配置与两 SQLite，integrity 均通过，mainBefore=`a625350`、sourceBefore=`8a4fe59`。

同一旧 HTML 再次合成重放，生产未 mock 资源请求得到：

| 旧资产 | HTTP / MIME / 长度 |
| --- | --- |
| `/assets/index-DI4MTrjS.js` | 200、application/javascript、333563 B |
| `/assets/index-Dh14YCcE.css` | 200、text/css、172282 B |

浏览器登录表单可见，app 有正常子元素，0 console/page/request 错误。证据 `.local/install-live/stale-assets/results.json`，模式为 `postfix-synthetic-stale-document-replay`，`actualUserIncidentReproduced=false`。

北京时间 22:26:46 的 `.local/install-live/deployment.json` 记录两端 health=true、三服务 active/NRestarts 0，启动时间未因这次发布改变；原主站当日 20:35、控制当日 20:47，Nginx UTC 10-07 16:13:39，即北京时间 10-08 00:13:39。临时 QA 会话已撤销、剩余 0，服务器和本机 token 文件已删除。

## 后续发布与回滚

后续前端 release 继续保留缓存 HTML 所需旧 hash 资产，核对正确 MIME/长度，并重放旧文档验证，不只检查新首页 200。本次 backend 未变，前端回滚只切 symlink 回 `/opt/ziwei/releases/a625350`，无需重启 API；继续保留原 data、source、APK 和旧资产。

本记录解释已取得的证据及独立兼容修复，不把当前恢复、服务健康或合成复现扩展为用户事故根因已确定。真实手机安装、权限、入网、操控和升级也不属于本次只读调查的实机验收范围。
