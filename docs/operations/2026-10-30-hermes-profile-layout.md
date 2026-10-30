# 2026-10-30 Hermes 独立 Profile 初始化接口

## 问题与修复

创建新 owned Profile 时，真实回执在 `native_layout` 阶段返回 `AttributeError`。当前安装的 Hermes `0.22.5+1507.gc2c5eef.dirty` 已把 `profiles._finish_profile_layout` 移到 `hermes_cli.profiles_initialization.finish_profile_layout`。紫薇的调用位置未随之更新。

`src/hermes-owned-profile.py` 改用当前原生模块与签名，保留原 staging 发布、归属校验和失败回执；不复制来源认证、记忆或会话，也不触发原生网关通知。Python 与 JS 诊断边界同步保留新模块的安全源码定位，完整路径和异常正文仍不对外返回。没有增加旧版兼容分支。

## 验证

- 实际安装的 Hermes、隔离临时 HOME：先复现原 `AttributeError`，再通过首次创建、重复创建和原数据保持等 10 项回归。
- Python diagnostic fixture 15/15，相关 Node 回归 18/18；lint 345 文件和 diff 检查通过。
- 独立审查核对了原生调用签名、staging 限定和诊断边界，无待修复缺陷；独立 Python diagnostic fixture 15/15。
- 验证未调用模型或读取真实凭据，真实 Profile 和原生 Hermes 源码保持。

## 发布边界

本机 CLI 已包含此前 Hermes Gateway/MCP 与 DSH 维护修复，安装包应以其实际安装为基底，仅叠加本次两个运行源文件。源码提交不能当成整树覆盖本机包的依据。通过官方更新流程安装后，再对原员工身份重试 Profile 创建、验证并启用；保留原失败回执，不另建员工冒充恢复。

## 本机发布与真实验收

修复源码 `dec52f3e1d9763d97d72f7d81a58b769e090e1a3` 已推送。候选从原实际安装 build `2c5c054d8ac48e380652da6eaf2c10f3bd604eca450a3f880053d7e4caf1ed29` 复制，仅叠加上述两个运行源文件；包 SHA-256 为 `e175799b740e8578d6035bd099241a29e6df6e481ae3171b6c53769db6956e83`。

CLI 维护会话完成官方升级，独立回读确认运行 build `58134adad81817be4a1b2a81672b570cfe296b4e3d84481755531ec74eb660f9`、20242 单实例、health 200、connected；原配置及 action-state 字节保持。随后在同一原员工与 Profile 身份上重试，真实 `hermes.bot.provision` succeeded，Profile 归属与认证 configured；`hermes.bot.validate` succeeded，原生预检回执的 provider/model/requested/effective/actual 精确匹配 `openai-codex` / `gpt-6.1-sol` / `max`，进程正常退出且树为空，再经正式控制入口启用。原失败回执保留。

该验收确认 Profile 创建和无模型配置验证，不把它扩写成内容生成或对外发布已完成；用户在已知当前严格接线不保持 ultra 后明确选择 max。
