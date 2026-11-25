"""Local, explicitly simulated UI fixture. Never connects to Codex or a real phone."""
import asyncio
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
from aiohttp import web

sockets = set()
counter = 0
MARKDOWN_SAMPLE = r'''# Markdown 显示验收

这是一段 **粗体**、*斜体*、~~删除线~~ 与 `行内代码`。连续的
普通换行仍属于同一段落。

## 表格与移动端横向滚动

| 文件名称 | 方向 | 大小 | 校验 | 说明 |
| :--- | :---: | ---: | :--- | :--- |
| **report.pdf** | 电脑 → 手机 | 600001 | `SHA-256` 一致 | 不经过模型上下文的文件传输 |
| image.png | 手机 → 电脑 | 2048 | 已通过 | 表格内部左右滑动，页面保持窄屏 |

### 列表与任务

- 父级条目
  1. 第一子项
  2. 第二子项
     - 更深一层
- [x] 文件校验完成
- [ ] 等待用户确认

> 引用中的 **重点内容**。
>
> 第二段引用。

```javascript
const result = await phone.call('transfer.toPhone', { projectPath: 'artifacts/report.pdf' });
console.log('<script>只应显示代码，不执行</script>');
```

[打开网页](/artifacts/demo/index.html) · [参考链接][doc]

[doc]: https://example.com/ "参考文档"

![本地示意图](/fixture.svg "图片验收")

---

<img src=x onerror=alert(1)>

[危险链接](javascript:alert(1))

**这段原始 HTML 应显示为文本，危险链接不可点击。**
'''


async def page(request):
    markup = (ROOT / 'server/web/codex.html').read_text('utf-8').replace('src="/phone.js"', 'src="/fixture-phone.js"')
    return web.Response(text=markup, content_type='text/html')


async def phone(request):
    return web.Response(text="window.phone={capabilities:async()=>({installationId:'ui-fixture'})};", content_type='application/javascript')


async def script(request):
    return web.FileResponse(ROOT / 'server/web/codex.js')


async def fixture_image(request):
    return web.Response(text='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160" viewBox="0 0 600 160">'
        '<rect width="600" height="160" rx="16" fill="#eaf3ec"/><path d="M60 100h480M60 60h280" stroke="#206c51" stroke-width="5"/>'
        '<circle cx="500" cy="60" r="15" fill="#206c51"/></svg>', content_type='image/svg+xml')


async def emit(request):
    global counter
    for _ in range(6):
        counter += 1
        item = {'id': 'fixture-tool-' + str(counter), 'type': 'commandExecution', 'status': 'inProgress',
                'command': '检查移动端布局与文件传输 · ' + str(counter)}
        for ws in list(sockets):
            await ws.send_json({'event': {'method': 'item/started', 'params': {'threadId': 'fixture-thread', 'item': item}}})
            await ws.send_json({'event': {'method': 'item/commandExecution/outputDelta', 'params': {
                'threadId': 'fixture-thread', 'itemId': item['id'], 'delta': '检查完成，文件已通过 SHA-256 校验。\n' * 8}}})
            item = dict(item, status='completed', exitCode=0, aggregatedOutput='通过 · 此内容为界面测试样本。')
            await ws.send_json({'event': {'method': 'item/completed', 'params': {'threadId': 'fixture-thread', 'item': item}}})
    return web.json_response({'ok': True})


async def controls(request):
    return web.Response(text='<title>UI fixture controls</title><h1>Simulated UI test</h1>'
        '<button onclick="fetch(\'/emit\',{method:\'POST\'})">Add tool events</button>'
        '<button onclick="fetch(\'/disconnect\',{method:\'POST\'})">Disconnect clients</button>', content_type='text/html')


async def disconnect(request):
    for socket in list(sockets):
        await socket.close(code=1012, message=b'Fixture service restart')
    return web.json_response({'ok': True})


async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    sockets.add(ws)
    await ws.send_json({'session': {'device': 'ui-fixture', 'projectId': 'UI-FIXTURE-NOT-A-REAL-DEVICE',
        'cwd': 'D:/simulated/project', 'threads': [{'id': 'fixture-thread', 'title': '手机工作空间 · 界面测试'}], 'active': {}, 'requests': []}})
    try:
        async for frame in ws:
            msg = json.loads(frame.data)
            method = msg['method']; result = {}
            if method == 'thread/read':
                items = []
                for n in range(8):
                    items.extend([{'id': f'u{n}', 'type': 'userMessage', 'content': [{'type': 'text', 'text': '帮我把这个想法做成随手可用的手机网页。'}]},
                        {'id': f'a{n}', 'type': 'agentMessage', 'text': '已经准备好了。\n\n**适配手机的工作空间**\n\n- 支持图片与文件附件\n- 工具执行过程可以展开查看\n- 传输只返回路径与校验结果\n\n[打开网页](/artifacts/demo/index.html)'}])
                result = {'thread': {'id': 'fixture-thread', 'turns': [{'items': items}]}}
                result['thread']['turns'][0]['items'].append({'id': 'markdown-sample', 'type': 'agentMessage', 'text': MARKDOWN_SAMPLE})
            if method == 'model/list':
                result = {'data': [{'model': 'test-model', 'displayName': 'UI test model'}]}
            if method == 'turn/start':
                result = {'turn': {'id': 'fixture-turn'}}
                await ws.send_json({'event': {'method': 'turn/started', 'params': {'threadId': 'fixture-thread', 'turn': {'id': 'fixture-turn'}}}})
                await emit(None)
                await ws.send_json({'event': {'method': 'item/completed', 'params': {'threadId': 'fixture-thread', 'item': {
                    'type': 'agentMessage', 'id': 'fixture-final-' + str(counter), 'text': '工具调用已完成。\n\n```js\nawait phone.capabilities();\n```\n\n<img src=x onerror=alert(1)>\n\n这段 HTML 应只显示为文字。'}}}})
                await ws.send_json({'event': {'method': 'turn/completed', 'params': {'threadId': 'fixture-thread', 'turn': {'id': 'fixture-turn', 'status': 'completed'}}}})
            await ws.send_json({'id': msg['id'], 'result': result})
    finally:
        sockets.discard(ws)
    return ws


app = web.Application()
app.router.add_static('/assets/', ROOT / 'server/web/assets')
app.router.add_get('/', page)
app.router.add_get('/fixture-phone.js', phone)
app.router.add_get('/codex.js', script)
app.router.add_get('/fixture.svg', fixture_image)
app.router.add_get('/controls', controls)
app.router.add_post('/emit', emit)
app.router.add_post('/disconnect', disconnect)
app.router.add_get('/api/devices', lambda request: web.json_response([{'installationId': 'preview-phone', 'model': '预览手机'}]))
app.router.add_get('/api/codex/{device}/ws', ws_handler)
if __name__ == '__main__':
    web.run_app(app, host='127.0.0.1', port=18869)
