# AICT Codex 手机接入验证

日期：2026-11-18，Asia/Shanghai。

## 已完成

- 新增 server/codex_mobile.py、server/web/codex.html、server/web/codex.js。
- server/main.py 增量注册 Codex 路由，默认 `/` 为 Codex，原测试页为 `/diagnostics`。
- 设备稳定目录、同设备共享 cwd、对话归属检查、持久化对话恢复、动态手机工具、artifact 文件服务。
- PHONE.md / DEVICE.json 包含手机操作说明、移动端网页要求和设备/视口信息。
- 新增 CODEX_MOBILE.md；源码打包清单包含 Codex 模块与文档；server/data/ 不纳入版本控制。

## 结果

| 检查 | 结果 |
|---|---|
| server/test_codex_mobile.py，含 AICT_TEST_LIVE_CODEX=1 | 6/6 通过 |
| 实际本机 Codex app-server 初始化和 thread/start | 通过 |
| model/list 和一次真实模型推理 | 通过 |
| 模型调用 phone_call，由模拟设备返回 capabilities | 通过；不是实际手机 |
| 关闭进程后 thread/resume / thread/read | 通过 |
| 设备目录稳定性、线程归属、手机工具绑定与失败返回 | 通过 |
| artifact 访问、目录越界拒绝 | 通过 |
| WebSocket 审批重放、响应及设备归属 | 通过 |
| 原 server/test_gateway.py | 9/9 通过 |
| tools/test-web-sdk.cjs | 通过 |
| node --check 与 Python py_compile | 通过 |
| 浏览器 390x844 / 320x640 视口 | 无横向溢出；390px 控件高度均不小于 44px |

## 实际部署与未验证部分

另一聊天完成后，已确认 `/`、`/codex`、`/codex.js`、`/diagnostics` 均返回 200。
首次真实连接发现旧服务进程受 Windows 进程管道限制，创建 app-server 返回 WinError 5。
核对 PID 与命令行后，仅将此项目服务重启到正常 Windows 用户执行环境；当前 PID 49192。
手机通过公网 SSH 自动重连。本次未重建或安装 APK。

真实验收（非模拟设备）：
- 手机型号 2512BPNDAC，Android SDK 36，原生 runtime/capabilities 返回 ok=true、connected=true。
- 手机 WebView 已上报 400x757 视口、pixelRatio 3、zh-CN 与 Android WebView UA。
- 创建“手机连接验收”对话，完成一次真实推理、项目文件读取和绑定手机的 phone_call capabilities。
- Codex 创建 project/artifacts/connection-check.html，turn.status=completed。
- artifact HTTP 返回 200，3728 字节；包含 viewport 与 /phone.js。
- project ID：b3e5a9c26a52c22217cc99b9875dca00。
- thread ID：01a1ea6e-f770-71b3-a69a-4677c4ea4ff8。
- 原始事件和响应保存在 server/run/codex-live-acceptance.json（包含设备信息，不进入源码包）。

尚未完成用户在真实手机内点击该网页、运行网页按钮和处理审批的端到端验收。
服务端 HTTP 成功和真实 phone_call 成功，不等于这些用户界面操作已经完成。

project 指 Codex app-server 的固定 cwd；没有修改 Codex 桌面应用的项目列表私有数据。
本版本沿用可信网关模型，设备独立目录并非对恶意客户端或本机执行的多租户安全隔离。
