---
name: 紫薇·互联手机操控
description: 使用 ziwei-terminal MCP 操作当前员工明确绑定的真实手机，按观察、动作、回执与新截图核实结果。
version: 1.0.0
---

# 紫薇·互联手机操控

本技能依赖平台配置的 `ziwei-terminal` MCP。安装后，在手机技能配置中选择工作区、员工、运行电脑、Codex/Hermes及profile、真实手机，完成检测与员工试运行。技能文字、保存成功或API健康不能证明MCP已加载；以本次执行握手、实际工具调用和手机原回执为准。

## 目标与授权

仅使用平台给当前员工绑定的手机和运行环境。先调用 `ziwei_phone_list`，匹配用户指定目标，再 `ziwei_phone_status` 核对精确deviceId与健康；缺配置、未知目标、离线或认证失败应给出具体错误，不猜测、不切换手机、不广播、不改用其他profile。

已有用户授权持续有效，不重复要求每次点击或打开应用审批。首次缺少业务目标、账号或允许操作范围时精确询问必要信息。默认工具能力完整，业务动作仍按用户实际授权执行；平台配置不代表用户授权向他人发送消息、发布内容或改变账号。

手机凭据与API Key、管理MCP、Android角色token相互独立。不得读取、返回或写入管理员密码、手机角色token、本机capability文件或其他私有凭据；不通过shell、SSH、ADB或数据库绕过MCP。能力缺失时报告连接配置与真实错误。

## 观察 → 动作 → 原回执

1. `ziwei_phone_list` 确认绑定手机，`ziwei_phone_status` 检查Agent/Updater在线、无障碍、亮屏未锁、控制角色和活动事务。健康条件不足时停止动作并说明恢复步骤。
2. `ziwei_phone_screenshot` 获取当前画面。仅根据这次图片判断界面，使用返回原始width/height计算坐标；不把历史截图当成当前状态。
3. `ziwei_phone_action` 执行用户授权的有限操作，记录返回的 `command.id`。tap传 `{x,y,width,height}`；swipe传 `{x1,y1,x2,y2,width,height,durationMs}`；text传 `{text}`；global传 `{key:"back"|"home"|"recents"}`；launch传 `{packageName}`。
4. `ziwei_phone_receipt` 或 `ziwei_phone_wait` 查询原commandId。queued/delivered/executing只是进行中；succeeded才是成功回执。动作后重新截图确认实际界面变化，不能把受理或回执成功直接等同业务目标完成。
5. 超时、断连、uncertain先查原回执和活动状态，不盲目重放点击、输入、启动、升级或批准。failed/expired按真实错误报告，修正原因后才执行新的明确动作。

## 其他工具

- `ziwei_phone_control`：按用户任务切换Agent/Updater或暂停；检查当前控制权与在途事务。
- `ziwei_phone_upgrade`：仅在用户要求升级时使用，沿用原发布索引、截图前置检查与安全升级事务。planned/installing/awaiting_health不代表完成；committed才算通过，awaiting_user_action需要手机实际系统确认。
- `ziwei_enrollment_pending` / `ziwei_enrollment_approve`：沿用平台授权范围查看和批准入网，核对请求与所选目标；不默认批准所有未知设备，不复制申请密钥。

## 结果与交接

报告目标手机、动作、commandId、当前状态、实际观察和下一步。涉及截图时指出是否为本次回传；分别报告MCP已加载、工具已调用、手机回执与业务目标是否达成。保留运行时/profile及工作区边界，失败如实交接，禁止伪造成功。
