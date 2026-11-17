"""Opt-in live AICT/Codex/phone acceptance. Reads capabilities; creates a demo web page."""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import aiohttp


async def main():
    base = 'http://127.0.0.1:18765'
    report = {'mock': False, 'events': [], 'approvals': []}
    async with aiohttp.ClientSession() as client:
        async with client.get(base + '/api/devices') as response:
            devices = await response.json()
        if len(devices) != 1:
            raise RuntimeError('Expected exactly one connected device for unambiguous acceptance')
        device = devices[0]
        report['device'] = device
        async with client.ws_connect(base + '/api/codex/' + device['installationId'] + '/ws') as ws:
            session = (await ws.receive_json())['session']
            report['project'] = session['projectId']
            report['cwd'] = session['cwd']
            print('Device/project connected', device['model'], session['projectId'], flush=True)
            await ws.send_json({'id': 1, 'method': 'thread/start', 'params': {'title': '手机连接验收'}})
            thread = None
            async with asyncio.timeout(200):
                while True:
                    msg = await ws.receive_json()
                    if msg.get('error'):
                        raise RuntimeError(msg['error'])
                    if msg.get('id') == 1:
                        thread = msg['result']['thread']['id']
                        report['thread'] = thread
                        prompt = ('执行一次当前 AICT 接入验收。先阅读 PHONE.md 和 DEVICE.json，调用 phone_call 的 capabilities 方法读取真实手机能力。'
                                  '然后仅在当前 project 的 artifacts/connection-check.html 创建一个中文手机适配网页，'
                                  '标题为“手机 Codex 已连接”，显示从 capabilities 或设备上下文读到的型号和 Android SDK。'
                                  '用相对或 /phone.js 加载手机 SDK，提供一个“读取手机能力”按钮，点击后只调用 phone.capabilities 并显示 JSON，'
                                  '不申请权限、不操作其他应用、不修改手机文件。页面使用 viewport 和至少44px按钮。'
                                  '不要修改其他文件。最后回复该 artifact 的可点击链接，并明确当前尚未验证用户在手机内打开网页。')
                        await ws.send_json({'id': 2, 'method': 'turn/start', 'params': {'threadId': thread,
                            'input': [{'type': 'text', 'text': prompt}]}})
                    event = msg.get('event', {})
                    method = event.get('method', '')
                    if method in ('item/completed', 'turn/completed', 'error'):
                        report['events'].append(event)
                    if 'id' in event:
                        report['approvals'].append(event)
                        raise RuntimeError('Live verification requires user response: ' + event['method'])
                    if method == 'item/agentMessage/delta':
                        print(event['params']['delta'], end='', flush=True)
                    if method == 'turn/completed' and event['params']['threadId'] == thread:
                        report['turnStatus'] = event['params']['turn']['status']
                        if report['turnStatus'] != 'completed':
                            raise RuntimeError(json.dumps(event, ensure_ascii=False))
                        break
        url = '/artifacts/' + report['project'] + '/connection-check.html'
        async with client.get(base + url) as response:
            html = await response.text()
            report['artifact'] = {'url': url, 'status': response.status, 'bytes': len(html.encode()),
                                  'viewport': 'viewport' in html, 'phoneSDK': '/phone.js' in html}
            assert response.status == 200 and 'viewport' in html and '/phone.js' in html
        report['phoneToolSuccess'] = any(e.get('params', {}).get('item', {}).get('type') == 'dynamicToolCall'
            and e['params']['item'].get('tool') == 'phone_call' and e['params']['item'].get('success') is True
            for e in report['events'])
    path = ROOT / 'server/run/codex-live-acceptance.json'
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('\n' + json.dumps({k: v for k, v in report.items() if k not in ('events', 'approvals')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
