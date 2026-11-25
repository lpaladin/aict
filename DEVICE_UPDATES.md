# 设备上线自动更新

AIct 网关启动更新服务，设备建立控制连接后立即检查，在线期间每 60 秒复查。无需依赖某个 Codex 对话保持运行。

更新依据是已安装 APK 的 SHA-256，同时记录 Android 的 versionName / versionCode。同一版本号重新构建的修复包也能识别；已安装目标包时不重复推送。

## 用户与密钥

- 默认用户 `aict-demo-001` 的配置保存在 `client/assets/connection.json`。
- 第二用户 `aict-user2-001` 的配置保存在 `.secrets/users/user2.json`。
- 更新包必须用对应配置构建。发布和首次发送都会比较内嵌 credentialId、username、privateKey、服务器地址和主机指纹。不同用户的包会被拒绝。
- 配置和密钥保持原位置，不重新生成。APK 签名继续使用 `.secrets/apk-signing.p12`，避免无法原位更新。
- `server/data/updates/releases.json` 记录用户到安装包、配置文件路径的对应关系，不复制私钥文本。`devices.json` 保存设备校验和投递状态，服务重启后仍然有效。
- 更新过程绑定原设备连接；断线重连或连接身份变化时，中止旧连接的投递。

## 发布新版

先依次构建，不能并行构建（共用 `.build` 目录）：

```powershell
& tools/build.ps1 -OutputApk dist/aict-demo-new.apk
& tools/build.ps1 -ConnectionConfig .secrets/users/user2.json -OutputApk dist/aict-user2-new.apk
```

然后为每个用户登记版本。以下 Python 路径是当前工作区运行时：

```powershell
$python = 'C:/Users/hy/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $python tools/publish-update.py --apk dist/aict-demo-new.apk --connection client/assets/connection.json --version new-release
& $python tools/publish-update.py --apk dist/aict-user2-new.apk --connection .secrets/users/user2.json --version new-release
```

发布后不需要重启网关。离线设备下次上线自动检查，在线设备最长约一分钟开始检查。发布文件为当前目标版本；需要回滚时也必须显式发布目标包。不要直接覆盖已发布 APK：哈希变化会使更新被拒绝，须重新执行发布命令。

## 投递和安装

服务提供临时随机下载链接，经设备已有 SSH 代理下载。下载后在手机本地计算 SHA-256；不把 APK 内容或 Base64 送进模型上下文。校验一致后调用系统安装器，标记 `awaiting_install`。Android 要求的安装确认仍由用户完成；不会把打开安装器当作安装成功。

下一次检查会读取实际已安装 APK 的哈希，只有匹配才标记 `installed`。同一包在等待安装时，六小时内不重复打开安装器；传输失败有五分钟退避。服务会继续定期检查安装是否完成。下载链接在传输结束后撤销，最长半小时过期。

本地状态入口：`http://127.0.0.1:18765/api/updates`。它显示已发布版本和设备状态，不返回密钥、配置路径或安装包下载令牌。未知用户没有默认包回退。

## 验证

`server/test_device_updates.py` 覆盖：用户密钥不匹配、已发布文件改变、已安装去重、下载校验、服务重启后去重、未知用户、连接替换，以及真实 HTTP 下载路由返回正确用户包并撤销链接。

2026-11-19 部署后，2512BPNDAC 重连自动检查结果为 `installed`，安装包哈希匹配当前默认用户发布包。ALN-AL00 离线，第二用户包已经登记，将在连接后执行检查和投递；尚未验证第二台的自动安装结果。
