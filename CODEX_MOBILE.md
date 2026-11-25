# AIct 手机 Codex

AIct 的默认网页为手机 Codex 对话页，后端使用本机 `codex app-server --listen stdio://`。
它使用当前运行 AIct 服务的 Windows 用户已有 Codex 登录和配置，不是自建文本模型代理。
官方协议说明：https://learn.chatgpt.com/docs/app-server

## 设备与 project

手机 SDK 的 `capabilities().installationId` 选择设备。每台设备的目录固定为：

```
server/data/devices/<sha256(installationId) 前32位>/
  threads.json             # 此设备的对话索引
  codex-stderr.log          # 当前 app-server 诊断
  project/                 # 此设备所有对话固定的 Codex cwd
    PHONE.md               # 手机操作与移动网页开发说明，由接入层维护
    DEVICE.json            # 当前设备和网页视口，在新对话/新轮次刷新
    artifacts/             # 手机可打开的网页及其依赖
```

project 指 app-server 的固定 cwd/工作空间；未向 Codex 桌面应用的项目列表写入私有数据。
对话由 Codex 自身保存，AIct 保存 thread ID；服务重启后使用 `thread/resume` 恢复。
空对话在首次发送前可能没有 Codex rollout，因此没有发送过消息的空标签不会跨服务重启保存。
卸载/清除 APK 数据会改变 installationId；正常升级保留安装数据时应继续使用原目录。

本版本延续现有开发网关的可信客户端模型。installationId 是路由标识，不是身份认证；
独立目录和对话归属检查不等于多用户安全隔离。服务端本机账户与其 Codex 配置决定执行权限。
请勿把回环 HTTP 控制端口直接暴露到公网。

## 手机操作和网页

### 双向文件传输，不经过模型上下文

Agent 使用已有 `phone_call`，参数只包含路径：

```json
{"method":"transfer.toPhone","params":{"projectPath":"artifacts/report.pdf"}}
{"method":"transfer.fromPhone","params":{"phonePath":"/手机的绝对路径/photo.jpg","projectPath":"imports/photo.jpg"}}
```

服务端自动分块与编码并传输文件，Agent 只收到路径、字节数、SHA-256 和校验结果，不收到文件内容或 Base64。
toPhone 会读回手机落盘数据校验；fromPhone 校验接收字节与电脑落盘数据一致。
toPhone 默认保存到手机应用下载目录，自动生成唯一文件名；可显式提供 phonePath 或 content URI。
默认拒绝覆盖现有目标；只有用户要求覆盖时设置 overwrite:true。电脑路径限制在当前设备 project 内。
传输上限512MiB。手机路径、SAF 和存储权限仍受 Android 约束。
为避免误用，phone_call 的二进制 file.read 会提示改用 transfer.fromPhone；小文本显式 text:true 时剔除 Base64。

手机对话中的附件按钮支持图片和普通文件：逐文件以二进制流上传到该设备 project/imports/，单个文件最多50MiB。
对话只附带路径、大小和哈希；图片使用 Codex localImage 路径输入，普通文件按用户要求再读取分析。

### 自动滚动

文本、工具卡片、命令输出与文件传输进度统一跟随最新。用户向上翻阅会暂停跟随并显示“回到最新”，
新内容不会抢走阅读位置。点击“回到最新”或发送新消息会恢复跟随。

对话开始时注入设备 project 及手机开发说明，并注册 `phone_call` 动态工具。
工具绑定当前设备，通过现有 Gateway RPC 执行 capabilities、脚本、文件、截图、无障碍等方法。
当前设备离线或 Android 权限不足会返回错误，不会切换到其他在线设备。
DEVICE.json 记录手机型号、SDK、原生能力，以及网页视口、pixel ratio、浏览器 UA 和语言。
用户本轮消息就是内容需求；PHONE.md 要求网页适配窄屏、触摸、软键盘和安全区。

静态网页放到 `project/artifacts/`，手机点击“网页”或回复里的 `/artifacts/<projectId>/index.html` 链接打开。
相对 JS/CSS/图片路径保持可用；页面可以加载 `/phone.js` 并访问手机原生桥。
现有 WebView SSH 代理还支持电脑 `http://127.0.0.1:<port>/` 开发服务及其 WebSocket/SSE。
artifact 路由仅提供该 project 的 artifacts 子目录文件，不提供任意电脑文件浏览。

## 启动和使用

1. 以拥有 Codex 登录的同一 Windows 用户运行 `codex login status`。必要时先 `codex login`。
2. 如 PATH 中找不到可执行程序，设置 `AICT_CODEX_BIN` 为 `codex.exe` 的绝对路径。
3. 使用原来的 `tools/start-server.ps1` 启动 AIct；默认入口 `/` 是 Codex，原测试页在 `/diagnostics`。
4. 手机 SSH 在线后进入页面，可新建/切换对话、选择模型、附加图片、发送/追加消息、停止、审批。
5. “重连”恢复历史与待处理审批；服务端后台任务不随网页暂时断开而停止。

服务重启请使用 `phone_call` 的 `service.restart` 方法（仅在用户要求或同意时），不要让当前Agent的Shell先杀网关再启动。
网关会启动独立worker，延迟4秒后核对PID/命令行、重启服务并检查 `/health`。
返回的是“已安排”及operationId，不代表已经成功；结果在 `server/run/restart-<operationId>.json`。
网页断线后按1秒至15秒退避自动重连，恢复当前对话；不会自动重发消息或重复执行任务。

Windows 上请从正常用户 PowerShell 启动服务。受限执行环境可能允许 HTTP/SSH，但拒绝 Python 创建 app-server 命名管道，表现为 WinError 5；需要更换服务启动环境，不是修改 SSH 配置或手机权限。

接入使用真正的 Codex harness，具备其本地文件、shell、已配置 MCP/skills 等能力。
具体能力取决于安装版本、账户、配置、网络及执行权限，不承诺复制 Codex 桌面 UI 的专属工具。
命令/文件审批及问题输入有手机表单；其他扩展请求保留协议 JSON 响应入口。
回复使用本地打包的 markdown-it 15.0.3，支持 CommonMark、表格、删除线、自动链接及任务列表。
原始HTML作为文本，危险URL不可点击；宽表格与代码块只在自身区域内横向滚动。
工具内容可展开；没有桌面 diff 编辑器，数学公式与 Mermaid 不作专用图形渲染。

## 验证

```
python server/test_codex_mobile.py
# 以下会使用当前 Codex 账户执行一次很小的真实推理；手机是显式模拟设备
$env:AICT_TEST_LIVE_CODEX='1'
python server/test_codex_mobile.py
node --check server/web/codex.js
```

基础测试覆盖设备目录稳定性、对话归属、绑定手机路由、原生失败、artifact 路径越界、客户端覆盖 cwd 拒绝。
可选真实测试覆盖 app-server 初始化、新建对话、模型读取、一次推理和动态工具调用、进程重启后的对话恢复。
模拟设备测试通过不能证明真机文件、授权、截图或 UI 操作已成功。


手机 Codex 顶部的“操控手机”可选择本机或同一 AIct 服务上的在线手机，显示机型及完整设备 ID；点击刷新可更新列表。选择会保存在当前浏览器，并切换到目标手机独立的对话、文件和操作空间。切换不会停止原手机上已开始的任务，返回原手机可继续查看。目标离线会保留选择并显示离线，不自动回退到本机。上传和提交期间暂时禁用切换，避免附件与指令发往不同手机。进度悬浮窗仍显示在当前打开 Codex 的本机。

列表沿用现有 `/api/devices` 的服务可见范围；当前设备注册只有机型与安装 ID，没有机主姓名。此选择器不新增机主身份或授权关系。

## Windows 后台常驻

运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-resident-server.ps1` 安装或更新当前用户的 `AIct Resident Server` 计划任务并立即启动。任务在该用户登录时启动，以普通用户权限、隐藏窗口运行，不需要保存 Windows 密码。锁屏后仍可运行；退出登录后停止，电脑睡眠期间无法提供服务。它不是开机未登录即可运行的 Windows SCM 服务。

守护脚本 `tools/resident-server.ps1` 每 10 秒检查网关进程；退出后通过 `tools/start-server.ps1` 重新启动。守护任务自身失败后每分钟重试，最多 999 次。允许电池供电运行，无任务运行时长限制。进程仍存活但业务卡死的情况不在当前自动恢复范围。启动脚本使用独占锁避免守护和手动重启同时创建实例；现有在线服务可直接接管。

查看状态：`Get-ScheduledTask -TaskName 'AIct Resident Server'`。诊断日志在 `server/run/resident.log`、`server/run/stdout.log`、`server/run/stderr.log`。重新运行安装脚本可更新配置。

停止常驻并停止网关时，先执行 `Disable-ScheduledTask -TaskName 'AIct Resident Server'` 和 `Stop-ScheduledTask -TaskName 'AIct Resident Server'`，再停止经命令行确认属于本项目的 `server/run/server.pid` 进程。仅停止网关会触发自动拉起。卸载自动启动可执行 `Unregister-ScheduledTask -TaskName 'AIct Resident Server' -Confirm:$false`，这不删除数据，也不自动停止已经运行的网关。

2026-11-18 本机验证：任务处于 Running，交互用户 hy、Limited 权限，登录触发、无限运行时长和电池设置读回成功；停止已核验的网关 PID 1200 后，守护自动拉起 PID 29552，`/health` 返回正常。随后检测到 1 台手机，计划任务环境下成功初始化 Codex app-server，`model/list` 返回 8 个模型。此检查未发送推理请求，尚未通过实际退出登录/重新登录验证登录触发。

### 新用户空对话历史兼容（2026-11-18）

实际在线 user2 的空对话在 `thread/read(includeTurns=true)` 返回 `-32601: list_turns is not supported yet`；仅加载元数据正常，元数据显示默认 historyMode 为 paginated。创建线程现在显式使用 `historyMode: legacy`，避免进入当前安装版本未实现的分页历史路径。首条用户 turn 被接受前使用 `includeTurns:false`，避免 legacy 空线程的 `not materialized yet` 错误；已有消息的线程继续完整读取历史，错误不会被伪装为空记录。

验证：13 项测试全部通过（启用真实 Codex app-server 集成），包括空对话读取、首轮工具调用、进程关闭后历史恢复。部署重启后，在线 user2 的 legacy 空对话返回 0 turns、原用户已有对话返回 1 turn，均无错误。修复在服务端，无需重发 APK。未落盘的空对话按原有启动策略不跨服务重启保留；已落盘对话不改动。
