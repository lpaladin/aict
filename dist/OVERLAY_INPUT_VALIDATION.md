# Codex 悬浮窗输入与通知验证

2026-11-18，现有 Android APK，无需重新安装。

- 接入 app-server requestApproval/requestUserInput，悬浮窗提供单次允许、拒绝、选项、输入框和提交；未知请求提供打开 AIct 入口。
- 关闭窗口保留后台监视；有待处理请求时创建 aict.codex.input 高优先级通知，点击打开 AIct；回答完成撤销通知。通知不包含问题详情、回答或命令。
- 请求编号、所属手机连接、悬浮窗 owner 和提交中标记校验，防止旧窗口或重复事件提交。
- 真机 2512BPNDAC / Android 36：无障碍树确认审批按钮、描述和关闭按钮实际出现。
- 真机 ALN-AL00 / Android 31：通过原生 performClick 触发真实选项按钮与提交按钮，收到 codex.interaction response，包含 requestId=test-input 与 answers.q.answers 的选项值；随后调用同一关闭处理函数，系统 getActiveNotifications 确认通知出现。独立通知测试确认 done 后撤销通知。
- 修复真机发现的 XML 布局转换问题：使用 E4X XML 创建 rawWindow。修复 UI 回调发送网络事件导致连接断开：事件排队，由脚本后台定时器发送。
- node tools/test-progress-controller.cjs：规范化提问、过期 owner、重复回答、原样回传、请求完成、结束状态通过。
- node tools/test-web-sdk.cjs：RPC、事件、分块文件传输等现有测试通过。

范围：测试请求为模拟请求，没有执行任何真实命令审批；未用真实模型生成提问做完整端到端验证。通知点击返回应用的系统 PendingIntent 已配置，未实点验证。脚本依赖 AIct 进程和对话页连接存活，系统杀死应用后不保证提醒。

## 2026-11-19 后台状态同步修复

原先45秒未收到浏览器心跳就显示连接中断，Android暂停后台WebView时会误判。现在原生脚本每5秒经SSH代理读取 `/api/codex/{device}/progress/{turn}`，查询精确轮次的状态；完成后原生脚本自行收起，无需网页恢复。未知轮次不推断为完成。同步超时改为“状态暂未同步 · 打开 AIct 刷新”。

真机测试把浏览器心跳设为60秒前且不再更新，原生悬浮窗仍显示来自服务器的运行状态；随后仅修改服务端测试状态为完成，验证原生关闭路径。测试为专用模拟轮次，无真实用户命令。

真机原生任务最终状态为 completed，证实没有新的浏览器心跳也能在服务器完成后退出。完成状态一旦确认，不再被同一窗口后续的断线文案覆盖。
