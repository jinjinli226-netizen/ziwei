# Q01：7467eed 最终六包有限检查——P1 包装阻断

冻结源码为 `7467eed41f8eee0614d2020d74bb93460a335d19`，tree 为 `9427705c1cbe64ec500a26379affabc3e283e081`。**发现 P1：两角色客户端 TGZ 缺少 Express 的必要传递依赖，按 manifest 指定的离线 API 依赖方式运行会失败。本批六包不能标记为运行依赖完整或最终包验收通过。**

本次没有修改产品、重打包、联网补依赖、启动监听、调用模型或手机、部署或推送。Windows仍由用户上线后实测；发现的是现有归档的纯 JavaScript 依赖缺失，不是要求 Mac 适配。

## P1 的实际证据

Q01 在自己的私有目录为两角色分别使用全新 prefix 和空 npm cache，执行最终 TGZ 的 `npm install --offline --ignore-scripts --no-audit --no-fund`。安装退出成功；V1 的 53 个安装后源码文件、V2 的 66 个安装后源码文件及两者 clientBuild 都精确匹配 manifest。随后使用各自安装根的 `createRequire(package.json)` 导入随包依赖：

| 角色 | Express | ws / yaml | 安装后 build |
| --- | --- | --- | --- |
| V1 兼容 | `MODULE_NOT_FOUND: Cannot find module 'body-parser'` | 可导入 | `039b0c6dd071c4449871132777ad6704971e0618d9670a492ca7176d3669d7ee` |
| V2 | 同上 | 可导入 | `fed59ef0e6434f4dec5c590e8f785ac1df5370082e9f917f751caf651dacf7e6` |

独立扫描两 TGZ 的全部成员（包含可能的嵌套 node_modules），仅有 express/ws/yaml 包。Express 5.2.1 的 28 个直接依赖全部无成员，body-parser 成员为 0。归档 `package/node_modules/express/lib/express.js:15` 立即 require body-parser；实际 API `backend/app.mjs:1` 导入 Express，因而该缺失影响 manifest 指定的 API 运行依赖路径。

源码定位为冻结 `scripts/build-preservation-packages.mjs:74` 设置 bundled dependencies、`:77–79` 从现有 node_modules 打包、`:81` 安装后仅采集源码/身份、`:84` 无条件声明 `offlineDependenciesBundled:true` 并要求 API 使用此客户端的 node_modules。**npm install成功和源码 build 匹配不能证明运行依赖闭合。** 另一只读 reviewer 独立核对 TGZ 成员和必需 require，确认同一缺陷。

本次未自行修包。修正后的交付应使用新的实际产物与 pins，并再次完成空缓存安装及必需依赖/实际 API 模块加载核验；不能只改 manifest 的成功标志或沿用当前归档 SHA。此为现有包装承诺的验收要求，不新增 Mac 产品支持。

## 已通过的有限部分

两 manifest 的实际 SHA 为：

- V1：`31990437fcd8672221462346c6cdcf76f9f2ddfa75f3313fd786f55c733a6fad`
- V2：`1caf82d91e7fc442e38cca29598234b24f1aee30868d39a2f2afc9b80150366c`

六 artifact 的实际字节数和 SHA全部匹配清单，candidate/role/baseline/versions/descriptor一致，错误 candidate负例被拒绝。API ZIP的107/128个源码成员、frontend ZIP的5/12个构建成员、client TGZ的53/66个自有源码成员都与对应manifest逐文件匹配。归档无绝对路径、父目录穿越、重复大小写成员、symlink/hardlink、加密ZIP或所查私有runtime路径。每角色33个overlay的实际来源hash匹配清单，与冻结Git在LF归一化后对应；PowerShell helper pin一致。这里只证明所列源码和归档成员关联，**未把262个 bundled文件称为依赖闭合**。

sourceClientBuild与安装后clientBuild保持分列。唯一installationChanges为scripts/ziwei-user.mjs：实际npm只把shebang行的CRLF改为LF，其余行保持原样。初次“全文件换行归一化”期望不正确，修正为核对实际单行变化后，两端摘要匹配；原始失败不判产品问题。

## 独立 API 入口结果及其限度

Q01 另行调用冻结 `verifyApiEntries` 导出函数；实际解压归档至新临时目录，以外部cwd和独立临时spec/key运行维护CLI，未覆盖或复用R的api-entry-proof.json。两角色实际结果均通过：

- 隔离及production spec的inspect/prepare均为plan、willApply=false。
- 首次apply明确拒绝：V1 `PRODUCTION_COMPAT_READ_ONLY`，V2 `PRODUCTION_TRANSPORT_REQUIRED`。
- 原临时DB/WAL/SHM字节保持、无新schema、无QA marker；执行期fetch/socket/child helper被禁止。
- 移除该一次性解压副本的daemon/config.mjs后，缺依赖负例明确拒绝；临时目录按既定范围清理。
- 检查前后两manifest和六归档pins不变，R的冻结checkout保持clean。

这个verifier执行的是 `scripts/v2-preservation.mjs`，未加载Express或 `backend/app.mjs`。因此其PASS正确限定为“实解压只读维护入口”，不消除上述P1，也不证明真正API服务启动、native namespace、Windows完整链或G1–G5通过。

同目录 `2026-10-14-q01-preservation-evidence/7467eed-package-checkpoint.json` 保存逐artifact pins、成员核对计数、独立API回执和两个离线安装/依赖失败回执；内容只含Git-safe核对数据。私有临时trust/key、cache、安装目录及日志不入Git。

此前794ba7f全量Windows结果、cad5886d的6pass/4Windows skip，以及289d4f4的G1子集均不升级成当前最终包验收。R的Git推送/readback和operations测试由其单独负责；Q01未重跑或据此声明发布、部署或Windows现场通过。
