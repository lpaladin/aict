"""Verify a real Codex agent chooses opaque transfer tools, with a real phone."""
import asyncio
import json
import sys
import uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import aiohttp


async def main():
    prior = json.loads((ROOT / 'server/run/file-transfer-live.json').read_text('utf-8'))
    source = Path(prior['toPhone']['projectPath'])
    project = source.parents[1]
    destination = 'transfers/agent-received-' + uuid.uuid4().hex[:8] + '.bin'
    events = []
    async with aiohttp.ClientSession() as client:
        devices = await (await client.get('http://127.0.0.1:18765/api/devices')).json()
        if len(devices) != 1:
            raise RuntimeError('Expected exactly one connected phone')
        async with client.ws_connect('http://127.0.0.1:18765/api/codex/' + devices[0]['installationId'] + '/ws') as ws:
            await ws.receive_json()
            await ws.send_json({'id': 1, 'method': 'thread/start', 'params': {'title': '文件传输验收'}})
            async with asyncio.timeout(150):
                while True:
                    msg = await ws.receive_json()
                    if msg.get('error'):
                        raise RuntimeError(msg['error'])
                    if msg.get('id') == 1:
                        thread = msg['result']['thread']['id']
                        print('Agent acceptance thread', thread, flush=True)
                        prompt = (f'执行文件传输验收：把当前 project 的 transfers/{source.name} 传到这台手机，'
                                  f'然后从手机取回到 project 的 {destination}。使用 phone_call 的 transfer.toPhone 和 transfer.fromPhone，'
                                  'toPhone 不指定 phonePath，fromPhone 使用前次工具返回的 phonePath。'
                                  '禁止读取、显示或分块输出文件内容及 Base64；不要用 shell 或 file.read 搬运字节。'
                                  '最后仅用中文汇报字节数和两次 SHA-256 是否相同。')
                        await ws.send_json({'id': 2, 'method': 'turn/start', 'params': {'threadId': thread, 'input': [{'type': 'text', 'text': prompt}]}})
                    event = msg.get('event', {})
                    if 'id' in event:
                        raise RuntimeError('Unexpected request requires user input: ' + event['method'])
                    if event.get('method') == 'item/completed':
                        events.append(event)
                    if event.get('method') == 'turn/completed':
                        if event['params']['turn']['status'] != 'completed':
                            raise RuntimeError(str(event))
                        break
    calls = [e['params']['item'] for e in events if e['params']['item']['type'] == 'dynamicToolCall']
    methods = [i['arguments']['method'] for i in calls]
    assert methods == ['transfer.toPhone', 'transfer.fromPhone'], methods
    assert all(i['success'] for i in calls), calls
    assert all('base64' not in json.dumps(i.get('contentItems', [])).lower() for i in calls)
    assert (project / destination).read_bytes() == source.read_bytes()
    result = {'mock': False, 'thread': thread, 'methods': methods, 'bytes': source.stat().st_size,
              'fileContentInModelContext': False, 'events': events}
    (ROOT / 'server/run/agent-transfer-live.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'events'}, ensure_ascii=True))


if __name__ == '__main__':
    asyncio.run(main())
