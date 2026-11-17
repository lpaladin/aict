# AIct 0.2.0 原生能力接口

业务代码仍由网页/服务端提供。以下接口是通用适配；AutoJs6/Rhino 和 Java 互操作入口保留。

## 动态脚本、事件和任务

```javascript
await phone.execute('({sum: args.a + args.b})', {a: 2, b: 3});
const off = phone.on('progress', (data, event) => console.log(event.taskId, data));
const task = await phone.start(`
  for (var i = 0; i !== 10; i++) {
    aict.emit('progress', {step: i}); sleep(1000);
  }
  ({done: true});
`);
await phone.tasks();
await phone.task(task.taskId); // 完成后包含 response，断线重连可查询
await phone.cancel(task.taskId);
off();
```

- `execute(source, args, {timeoutMs, waitMs})`：timeoutMs 到期请求引擎取消；waitMs 只控制网页等待，0 为不限时。返回的 Promise 带 requestId，可用于 task 查询/取消。
- `start` 立即返回 taskId，结束时发出 `task.finished` 事件。
- `aict.emit(name, data)` 发送 JSON 事件；`aict.isCancelled()` 查询取消请求。
- `phone.on('*', listener)` 监听全部事件，返回取消订阅函数。
- 结果由脚本显式上报，修复旧版 AutoJs6 完成回调可能始终返回 null 的问题。
- `cancelling` 只表示已请求 forceStop，不保证阻塞的原生调用立即终止。
- 尽量保留最近 128 个任务条目，活跃任务不驱逐；进程结束会丢失内存状态。
- 每个脚本是独立执行实例，返回值和事件需可 JSON 序列化；Java 对象可在脚本内部使用。

## 分块文件与下载

```javascript
const caps = await phone.capabilities();
const path = caps.paths.files + '/test.txt';
await phone.files.write({path, text: 'hello'});
await phone.files.read({path, offset: 0, length: 131072, text: true});
await phone.files.list({path: caps.paths.files});
await phone.files.read({uri: 'content://...', offset: 0, length: 131072});
await phone.files.write({treeUri: caps.treeUri, name: 'new.txt', text: 'hello'});
await phone.files.list({treeUri: caps.treeUri});
await phone.saveBlob(new Blob(['hello']), {name: 'hello.txt'});
await phone.saveUrl('data:text/plain,hello', {name: 'hello.txt'});

const transfer = phone.download('https://example.com/file', {
  path: caps.paths.downloads + '/large.bin', headers: {'User-Agent': 'AICT'}
});
// await phone.cancelDownload(transfer.requestId);
await transfer;
```

读写每块上限 1 MiB，二进制用 base64 和 nextOffset；text 是 UTF-8 便利接口，多字节字符跨块时应自行增量解码。
路径写入支持 offset/append；content URI 取决于提供者是否允许定位。
treeUri 写入会创建文档，后续分块应使用返回的 location 作为 uri，避免重复创建。
Blob/data 以 192 KiB 块保存，download 链接在创建它的 frame 内处理。

HTTP(S) 下载使用 SSH 代理，支持相对重定向、逐目标 Cookie、进度和取消。跨 Origin 去除 Authorization。
中断后以同一 URL 和目标路径重试，凭 ETag/Last-Modified 和 `.http-resume` 文件续传；无验证器则重下，200 响应覆盖旧内容，非法 Content-Range 拒绝。
取消正在阻塞的读取可能需等待 read timeout。先下载到普通路径，再用分块接口复制到 SAF URI。
Android 存储授权边界仍然有效。

## 无障碍与截图

```javascript
await phone.snapshot();
await phone.capture(); // JPEG base64、宽高、旋转、时间戳
const stop = phone.watchScreen(frame => render(frame), {intervalMs: 1000});
stop();
await phone.action({type: 'gesture', points: [[100, 200]], durationMs: 100});
await phone.action({type: 'gesture', points: [[500, 1400], [500, 300]], durationMs: 500});
await phone.action({type: 'click', viewId: 'com.example:id/button'});
await phone.action({type: 'setText', text: 'Search', index: 0, value: 'query'});
await phone.action({type: 'global', action: 'back'});
```

需要启用 AIct Vision。手势使用实际屏幕像素；操作前应重新观察页面，避免旧坐标。
节点按 viewId/text 选择，index 默认 0；另支持 longClick、scrollForward、scrollBackward。
全局动作：back、home、recents、notifications、quickSettings。
连续截图为顺序采样，最短请求间隔 500 ms，不是视频流；系统可能限频或拒绝安全窗口截图。

## 相机与权限

```javascript
await phone.requestPermissions(['android.permission.CAMERA']);
await phone.permissionStatus();
await phone.camera.capture({lens: 'back', quality: 90});
await phone.camera.capture({lens: 'front', autoCapture: false});
await phone.camera.video({durationSeconds: 10});
```

拍照显示原生预览，默认自动拍摄；autoCapture:false 显示拍照按钮。录像调用系统相机。
结果为 `{path, bytes, mime}`，内容用分块文件接口读取。相机任务 3 分钟、权限申请 5 分钟无响应后返回超时。
不绕过后台 Activity 启动、运行时权限及硬件限制；不提供隐蔽后台采集。
WebView 媒体和定位请求会申请缺少的系统授权。所有文件访问、悬浮窗、无障碍等特殊权限仍在 `phone.permissions()` 中开启。

## 服务端

```text
GET  /api/devices
POST /api/devices/{installationId}/call
GET  /api/devices/{installationId}/events?after={sequence}
WS   /api/devices/{installationId}/events/ws
```

POST 使用 `{method, params, waitSeconds?}`，waitSeconds 范围 1..3600。
长任务优先 script.start，再 task.get 或订阅事件。事件不会提前完成 RPC。
每设备保留 256 条事件，实时队列 128 条，慢接收者可能丢弃旧事件；sequence 用于检测缺口。
手机断线期间事件不自动重放；客户端进程仍在时可查询任务结果。
这些 HTTP 接口仅监听服务端回环地址，手机通过 SSH 访问。

诊断页：`/diagnostics`；更新下载：`/download/aict-latest.apk`。
