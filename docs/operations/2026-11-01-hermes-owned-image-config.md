# Hermes owned Profile 生图配置保留

2026-11-01：增长岗在原生CLI显式设置 `image_gen.provider=openai-codex` 后，下一次 `prepareHermesBotHome` 重写config.yaml未带入image_gen，使requirements重新为false、image_generate不可用。

`d530d0b` 只修复 `src/hermes-bot-runtime.mjs`：owned Profile准备时，保留本Profile已有的 `image_gen.provider`、`image_gen.model` 和选中provider节的 `model`。不从聊天provider推导生图provider，不新增中央配置字段，不复制image_gen整节或其中的api_key/headers，不复制OAuth，不改变聊天路由。未选择时仍未选择；该修复不会自行启用生图。

`d8ec28f` 补原生reader验证。`test/hermes-bot-image-gen-config.test.mjs` 调用真实prepare两轮，覆盖原生选择保留、轮间修改下一轮读到、独立Profile与初始化模板隔离、auth/历史未改动；实际安装的Hermes load_config、provider selector和model resolver也在隔离无网络/无真实凭据读取的环境中确认两轮输出。相关owned/runtime/compression/reasoning回归15/15通过。

目标普通Gateway会话不走safe/ignore-user-config的冻结配置分支。原生load_config按文件签名重读；现有每轮session-private MCP重绑触发editor_mcp policy publication并evict缓存agent，从而下一轮重建工具schema。未追加原生session补丁或重启共享Gateway。不能把这一结论扩展为所有managed-worker分支都自动刷新image_gen。

发布只在已安装 `688d6582…` 上叠加hermes-bot-runtime一个文件，前五个Gateway修复hash应保持原样。部署回执保存在 `D:\AINavtie\ops\ziwei\averinyo-imagegen-20261101`。正式配置是原生ziwei-ops；不得读MSIX缓存bigtron配置作为维护对象。

实际图片由CEO日报会话负责提交新请求验收。应在已升级环境用员工自己的原生公开配置入口恢复显式选择，再按本轮prompt的绝对输出目录与manifest合同生成/发布附件；不依赖Gateway没有透传的ZIWEI_IMAGE_OUTPUT环境变量。源码/测试/升级通过不替代样图成功及附件链路验收。
