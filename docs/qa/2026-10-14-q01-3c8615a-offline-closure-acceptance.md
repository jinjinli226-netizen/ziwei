# Q01：3c8615a 最终包依赖闭合独立复验

冻结最终源码为 `3c8615ab5faac57f2e479ff78fc5042f9ff7b902`，tree 为 `19059ceb72ccd9cd040c0528fd84e35c913a19ee`。实际批次为 R01 的 `.local/preservation-final-3c8615a`。**最终六包的摘要/成员/源码关联、两角色仓库外冷安装、运行依赖和实际API/client入口均通过；旧7467eed缺Express依赖的P1在这一最终批次上闭环。结论仅为本轮包级PASS，不是正式deployment GO、Windows原生或G1–G5全链验收。**

旧NO_GO文档及证据提交 `7f964bb69930f891100c3728d95047b7e4e43f98` 保持原样；旧归档不改绿。E02 `e655d9a` 中间批次也已独立实跑通过，但最终结论使用新的3c8615a安装目录、缓存、真实归档及回执，没有用中间批或作者结果替代。

## 精确最终身份

原pins文件SHA256为 `0d91472216cba5ccac7d279c2a41b2ead41b1185cf22fd068c55ab1bf7077260`，Q01重新读取并核验。两manifest SHA256：

- V1：`d406602ce6f16001176975f2d2522bfe5cd26bd6427566c51cb5e7f46afb2998`
- V2：`db7997c069f8cac6a9d0b3e88b2f619370cbc12e90978ceaf373be8a53900036`

| artifact | 字节数 | SHA256 |
| --- | ---: | --- |
| V1 client | 998409 | `4b2699c160065f2d7f53ce75416e7d084819771684c91e04c42fcba36f4c301d` |
| V1 frontend | 487364 | `6d92988dd6b22cdbc5e3b5a765ea1eca9cb8a310ca395803b12d1b55c7602bf1` |
| V1 API | 515032 | `63c894b056e3fdbd0a56ddcfd112c0c9f16dc32003624bbe820ac5d2597c8edb` |
| V2 client | 1046061 | `7498d54ee2af2b1ba02d10fa79f6e29385a71977f6ce2e5c92f03bffb7b6c1bd` |
| V2 frontend | 558640 | `712027aca4ee0eb7f47d197a53daa9af86823f4638fc2b741f8adc85fe344563` |
| V2 API | 616298 | `f47ebb583cba10ea84249b434018a204b76b91d34c7c4fdf433ab8593f49d1d9` |

实际归档字节全部匹配。API的107/128个自有源码文件、frontend的5/12个构建文件、client的53/66个自有文件逐一对应manifest。客户端每角色另有852个bundled文件。archive检查拒绝绝对/越界/重复大小写路径、symlink/hardlink和加密ZIP；未见所查私有runtime路径。candidate、静态role、baseline、versions、descriptor一致。每角色33个overlay的实际来源摘要匹配清单，来源与冻结Git在LF归一化后相同；不将归一化比较混称归档原字节相同。PowerShell helper pin保持一致。

sourceClientBuild和安装后clientBuild仍分列；唯一npm安装变化是scripts/ziwei-user.mjs的shebang换行。最终安装后build为：

- V1：`039b0c6dd071c4449871132777ad6704971e0618d9670a492ca7176d3669d7ee`
- V2：`fed59ef0e6434f4dec5c590e8f785ac1df5370082e9f917f751caf651dacf7e6`

这两个源码build与旧失败批相同不代表运行依赖相同；本轮归档摘要和852个bundled成员均独立核验，依赖图也另行取得。

## 独立冷安装与真实入口

Q01实现独立探针，没有直接调用作者runtime verifier或把作者receipt记为结果。最终批次在新的canonical系统临时目录运行，位于所有repo之外；每role独立prefix、初始空cache、空user/global npmrc、临时HOME/USERPROFILE及最小env。没有继承NODE_OPTIONS、产品/config/private变量或NODE_PATH。安装命令为：

```text
node <current-runtime npm-cli.js> install --offline --ignore-scripts
  --no-audit --no-fund --userconfig <blank> --globalconfig <blank>
  --cache <new-empty-cache> --prefix <new-offrepo-prefix> <exact-role-TGZ>
```

两角色都实际安装成功，所有安装后源码SHA及clientBuild与各自manifest精确相同。独立遍历声明dependency、peer和optional边，按实际Node搜索顺序找到package.json，核semver范围及canonical解析目标，全部物理路径限制在自己的prefix/node_modules；不允许祖先或全局目录满足运行依赖。semver只作为npm工具链中的元数据校验库，不向产品运行提供任何依赖。每role实际取得 **71个包、127条边**，包含nested版本，图摘要与最终manifest一致。

真实运行探针进一步限制CJS解析目标只能位于自有prefix或提取API，禁止fetch/socket/connect/listen和child helper，并syncBuiltinESMExports：

- 从实际安装client/package.json的createRequire导入Express/ws/yaml；真实调用express.json、校yaml结果并核ws类。
- 解压实际API ZIP，按manifest指定方式把API/node_modules链接到安装后client/node_modules，即prefix/node_modules/ziwei/node_modules。真正导入backend/app.mjs并运行createApp({memory:true,enableScheduler:false,...})；真实内存DB查询成功、两role静态身份吻合，关闭该DB，没有listen。
- 使用同一冷安装根的scripts/ziwei-user.mjs实际执行version，两者输出均为 `ziwei_user 0.1.0`；只测这个真实入口及加载依赖，不启动daemon。临时HOME前后为空，没有读取或改动正式HOME/auth/config。
- 同批verifyApiEntries导出函数另作独立实解压维护CLI检查：readonly inspect/prepare、V1兼容/缺transport首次apply拒绝、DB/WAL/SHM字节保持和缺依赖负例均通过。这个窄入口结果与真实app factory结果分别保留，不互相冒充。

本轮运行在Node v24.14.0 / Darwin。沒有改platform或allowUnsupported，沒有增加Mac产品支持。最终实跑后六archive/两manifest摘要再次吻合，源码checkout保持clean。中间/最终两个正例的唯一临时根在完成验证后按精确记录范围删除，私有metadata回执保留；旧失败安装和回执没有删除。

## 交付边界

安全证据为同目录 `2026-10-14-q01-preservation-evidence/3c8615a-offline-closure-summary.json`，包含最终精确pins、源码/成员计数、两批各自独立依赖图、真实入口和维护回执、探针摘要、清理及范围。Git不包含包、安装目录、cache、原DB/HOME/auth或raw私有资料。Q01不推送或部署；R仅取入这两份新增QA文件。

真实生产原action债务和Windows原件仍是独立操作门槛，不能用此包级PASS替它们结算、清空或解锁。沒有实际WindowsSDK positive/host restart、真实daemon/服务运行、模型/手机、UI行为或完整G1–G5验证。此前794ba7f全量、289d4f4 G1子集、cad5886d源码检查不迁移成当前现场结果。R的Git推送/readback由其单独负责，本次不据包级验收宣称正式上线通过。
