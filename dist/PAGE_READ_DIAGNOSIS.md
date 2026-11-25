# 手机页面读取诊断

2026-11-18，检查会话 01a1ee76-0347-7fd3-acbb-312adf0720cb。

## 会话证据

- 支付宝余额页两次只用 textMatches 提取 text，返回一个图标字符，没有余额文字；没有检查该页全部 contentDescription，因此不能认定页面不能读取。
- 后续调用返回当前包 org.autojs.autojs6.inrt，而目标支付宝节点为空。此时并非仍在已确认的支付宝页面，不能根据包名过滤后的空结果描述支付宝页面内容。
- 会话多次 screen.capture 返回 device disconnected，耗时约0.12到0.62秒。最近中国银行其他资产页面同样返回该错误。它不等于安全窗口错误。
- 招行补查通过 accessibility.snapshot / desc 找到此前漏读的黄金账户，说明只提取 text 的策略确实不完整。

## 修复

ConnectionService 原先在 NativeRuntime 回调线程直接写 SSH。VisionService 的截图回调、ui.action 的回调位于主线程。写出异常被吞成 channel.disconnect，导致 agent 只看到设备断开。改为专用单线程 ExecutorService 串行发送回复，并记录实际异常；回复仅能写到原连接。

补充 PHONE.md：同时读 text/desc；校验前台包和操作后页面；空提取不等于零资产；device disconnected 不等于防截图；未读取部分不得按常识补全。

Java编译、DEX/APK构建、签名验证通过。修复包：dist/aict-demo-0.4.1-capture-fix.apk。ADB当前无设备，因此未安装、未完成修复版截图真机验收。现有已安装APK仍保留旧的回传路径。
