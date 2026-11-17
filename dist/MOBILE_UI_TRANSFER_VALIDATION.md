# 手机界面、工具滚动与无上下文文件传输

2026-11-18，Asia/Shanghai。

## 界面

用户要求重开 Astra 后，由 gpt-6-astra 子 agent 完成 codex.html 设计。
保留对话、设置、工具状态、附件、审批和回到最新所需 DOM IDs。
400×844、320×640 均无横向溢出，可见操作触区至少44px；400×420设置弹窗可操作。
截图 mobile-ui-preview.jpg / mobile-ui-preview-320.jpg / mobile-ui-settings-compact.jpg 为浏览器样式验证，不是真机截图。

## 自动滚动（实际浏览器，显式模拟事件）

tools/preview_codex_ui.py 使用真实生产 codex.html、codex.js，与模拟 WebSocket 事件进行 UI 回归。
首次追加6张工具卡片和命令输出后距底部约0.4px，自动跟随生效。
向上滚动到 scrollTop=1249.6 后，继续追加6张工具卡片，scrollTop 保持1249.6。
显示“有新内容 · 回到最新”；点击后距底部约0.4px，继续跟随。
模型 HTML 字符串仅作文本显示，没有创建 img 节点。
400px 消息页 document.scrollWidth=clientWidth=400。

## 文件传输

新增 server/file_transfer.py；既有 phone_call 支持 transfer.toPhone / transfer.fromPhone。
字节仅在电脑和手机 RPC 间传输，服务端自动分块、编码、写入、校验；模型只收到路径和哈希元数据。
toPhone 会从手机读回做SHA-256校验；fromPhone 校验接收字节与本地落盘一致。
默认拒绝覆盖，电脑路径限制在本设备 project，最大512MiB；手机路径仍受Android权限限制。
直接给模型的二进制 file.read 被拒绝并提示传输方法；显式文本读取去除Base64字段。
普通附件直接以二进制流上传 project/imports，单个50MiB；对话只提交路径和元数据。

## 测试与部署

- server/test_codex_mobile.py：9项通过，1项真实Codex进程测试按默认设置跳过。
- 覆盖约600KB二进制往返、空文件、SHA-256、错误读回检测、覆盖拒绝、路径越界、上传和禁止二进制上下文泄漏。
- JavaScript语法检查、Python编译检查通过。
- 核对服务PID/命令行及无活动turn后，重启本项目服务为PID14932，手机自动重连。
- tools/verify_phone_transfer.py：真实手机600001字节往返，源/手机读回/取回文件SHA-256一致。
- tools/verify_agent_transfer.py：真实Codex Agent准确调用 transfer.toPhone、transfer.fromPhone，两次成功，没有file.read、Shell或Base64搬运。
- 实际SHA-256：e8efa822097ea4910f047c18b73bf691f08e9783e0eac6d9fa6f3a4e088fdef2。
- 原始传输元数据：server/run/file-transfer-live.json；Agent工具事件：server/run/agent-transfer-live.json。

本次不构建或安装APK，避免与另一个聊天的原生界面改版冲突。
手机内实际手势翻阅、软键盘布局与文件选择器仍需用户重载后确认；浏览器回归不作为真机交互证据。
