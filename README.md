# AIct

当前客户端为 `0.4.1` 开发构建。业务页面和执行脚本由服务端提供；APK 固定承载
WebView、SSH、AutoJs6/Rhino、Java 互操作与 Android 系统适配。

## 已实现

- 每用户 APK 内嵌 SSH 私钥，无激活/配对流程；固定 SSH 服务端公钥指纹校验。
- 内置地址 `zhyzbklqx.gicp.net:19198`，测试账号 `aict_demo`。
- 独立 Python SSH 服务，监听本机 TCP `19198`，不改系统 sshd。
- WebView 专用 HTTP 代理，通过 SSH 转发；其他应用的代理/VPN 不变。
- HTTP/HTTPS CONNECT、WebSocket、SSE 转发；保留浏览器原始 URL 与 Cookie。
- 可信页面/iframe 的通用 `phone` 桥；页面和服务端共用原生任务入口。
- AutoJs6 6.6.4 的真实独立打包运行时，以及同一引擎内的 Rhino Java 互操作。
- `phone.execute(source, args)` 动态执行并显式上报 JSON 结果；`phone.start`、事件、任务查询及单任务取消。
- 文件路径/授权 content URI 分块读写、Blob/data 保存、下载续传及进度。
- 结构化无障碍手势、节点输入、系统动作与连续截图采样；原生可见相机入口。
- 权限中心：逐项运行时授权、所有文件访问、SAF 目录、无障碍、悬浮窗、通知读取等。
- 无障碍节点快照；Android 11+ 通过独立 AIct Vision 无障碍服务截图。
- 文件选择上传、多窗口、网页相机/麦克风权限转接、基础应用内 HTTP 下载。

所有加载内容按可信代码处理，无业务方法白名单。脚本仍受 Android 的 UID、
权限、组件声明和后台执行规则约束。安装包内凭据可被复制，实例 ID 只是路由标识。

## 安装与测试

1. 安装 `dist/aict-demo-0.2.0.apk`，适用于 arm64 Android 8.0+。
2. 打开 AIct，完成所需授权。无障碍设置中按需启用两个服务：
   - AutoJs6 的操作服务：供 AutoJs6 控件/手势脚本使用。
   - AIct Vision：供结构化节点快照和无障碍截图使用。
3. 确保公网 TCP `zhyzbklqx.gicp.net:19198` 映射到本机 TCP `19198`。
4. SSH 认证成功后自动显示服务端测试网页，点击“点击发送 Toast”。
5. 用“动态脚本”验证文件写入与 Java 互操作；测试截图、节点树。

测试页面源文件：`server/web/index.html`。修改后刷新手机网页即可生效，
不必重新构建 APK。页面 SDK 由客户端在文档启动时注入；服务器也提供 `/phone.js`。

```javascript
await phone.execute('toast(args.text); ({ok: true})', {text: '来自服务端网页'});
await phone.execute('new java.io.File(context.getFilesDir(), "demo.txt").getAbsolutePath()');
await phone.snapshot();
await phone.capture();
```

脚本通过 `engines.myEngine().execArgv.aictActivity` 可访问当前宿主 Activity
（仅在其存在时提供）。常驻事件脚本应管理自己的生命周期；`phone.stopAll()`
请求停止 AutoJs6 脚本，但不保证中断所有阻塞原生调用。

## 启动本机服务

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/start-server.ps1
```

后台进程 PID 在 `server/run/server.pid`，日志在 `server/run/stderr.log`。
前台启动可用：

```powershell
<Python路径> server/main.py
```

服务端依赖见 `server/requirements.txt`；当前工作区已安装到 `.tools/python`，
不修改系统 Python。HTTP `127.0.0.1:18765`，控制通道 `127.0.0.1:18766`，
代理 `127.0.0.1:18767`。后三者仅监听回环地址，通过 SSH 暴露给客户端。
这些端口是可信本机开发接口，不提供额外的本机用户认证。

服务端主动执行：

```powershell
$devices = Invoke-RestMethod http://127.0.0.1:18765/api/devices
$deviceId = $devices[0].installationId
$body = @{ method='script.execute'; params=@{source='toast("服务端主动调用"); "done"'} } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:18765/api/devices/$deviceId/call" -ContentType 'application/json' -Body $body
```

SSH 不提供 shell，也不开放任意 direct-tcpip 端口。网页代理允许可信客户端
经电脑访问其他 HTTP(S) 目标，这是加载用户新建网页和依赖所需的能力。

## 构建

本版本采用官方打包模板，而非重新编译整个 AutoJs6 工程。
`tools/build.ps1` 会编译本项目 Java、用 D8 生成 DEX、加入官方运行时、重打包并签名。
脚本参数可指定 Android platform/build-tools、JDK、Apktool 和 Python 路径。
默认路径为当前机器已验证的工具位置。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build.ps1
```

准备过程：

1. 安装 `server/requirements.txt` 到 `.tools/python`。
2. 官方发行元数据保存为 `.release.json`；`tools/download_runtime.py` 下载并校验固定资产。
3. 从该 APK 提取 `assets/template.apk` 为 `.tools/template.apk`。
4. JSch 0.2.26 保存为 `.tools/jsch.jar`；Apktool 2.12.1 保存为 `.tools/apktool-new.jar`。
5. `tools/provision.py` 首次生成 SSH 用户密钥、主机密钥和配置，之后保留原密钥。

私钥、签名密钥、内嵌配置和构建产物均已加入 `.gitignore`。
`.secrets/` 与 `client/assets/connection.json` 包含真实凭据，不应加入源码归档。
更换主机密钥需重发固定该密钥的 APK。

## 验证与当前限制

```powershell
<Python路径> server/test_gateway.py
<Node路径> tools/test-web-sdk.cjs
```

集成测试覆盖真实 SSH 加密通道内的 HTTP POST/二进制体、Cookie、WebSocket、SSE、
CONNECT、服务端主动 RPC，以及错误凭据/主机密钥拒绝。RPC 的设备端在此测试中
使用明确标记的模拟客户端，不能作为手机原生操作已成功的证据。
`tools/SSHProbe.java` 使用 APK 相同版本的 JSch 和真实用户密钥测试实际运行的服务。

用户已反馈 0.1.0 核心链路可用。本次通过实际在线 Android 16 手机验证了脚本异常返回，以及带断言的应用私有目录读写与清理。
0.2.0 新增的相机、手势、URI、任务和结果上报接口仍需升级 APK 后真机验证；当前没有 adb 可见设备。
模板保持 upstream targetSdk 29，以避免未经验证地提高目标 SDK 导致旧运行时不兼容。
本版本不能声称已完成现代目标 SDK 迁移或应用商店发行准备。

新增接口、任务/事件语义和示例见 [API.md](API.md)。0.2.0 修复旧版成功脚本表达式可能始终返回 null 的问题：由脚本显式向宿主报告结果。
新版保持包名、签名密钥和 SSH 凭据，可覆盖安装；诊断页 `/diagnostics` 提供“下载并打开更新”入口。

其他边界：

- 每个 `phone.execute` 创建 AutoJs6 执行实例；结果必须可 JSON 序列化，Java 对象可在脚本内部使用。
- 原生脚本任意网络 API 不会自动被 WebView 专用代理接管；需要走隧道时应显式使用代理。
- HTTP(S) 下载已支持重定向、Cookie、验证器约束的 Range 续传、取消与进度；Blob/data 由网页 SDK 分块保存。
- 下载到 SAF 目录时，先下载到路径再通过分块接口复制；部分文档提供者不支持随机定位。
- 已加入可见原生相机拍照与系统相机录像接口；后台启动受系统限制，尚未在目标手机验证。
- 截图依赖 AIct Vision，Android 11 以下可另走 AutoJs6 MediaProjection；受保护窗口不能保证读取。
- 不提供强制后台永久在线、root/系统权限或全系统文件访问的承诺。
- 全部网页可信并不意味着 WebView 支持全部桌面浏览器 API。

详见 `THIRD_PARTY_NOTICES.md` 的运行时来源、许可证及可取得的上游源码。
