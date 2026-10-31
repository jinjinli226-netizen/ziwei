# 混合群聊实现记录

本轮新增工作区级混合群协议，成员可同时包含 Hermes、DSH、Codex。群成员冻结为员工、runtime、Profile、设备和专属 conversation 绑定；服务端创建每个成员独立 `conversation.execute` action，保存 runs 并按 action 回读状态。父群状态只汇总成员真实回执，不代替成员终态。

网页端提供混合群入口，CLI 增加 `members/memberDescriptors` 成员描述，手机版允许三种 runtime 成员并显示运行时标签。DSH 原生 `/api/groups` 继续独立保留；混合群的 DSH 成员使用绑定的 DSH conversation action，避免伪造原生 Hub 群 ID。

移动群投影对超过 8 个事件的 action events 保留首尾证据并折叠中间事件，完整群历史通过分页读取；源数据库、完整 action/result 和非移动端响应不变。
