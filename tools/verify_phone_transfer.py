"""Opt-in real phone roundtrip. Prints metadata only; no binary enters model context."""
import asyncio
import hashlib
import json
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
sys.path.insert(0, str(ROOT / 'server'))
import aiohttp
from file_transfer import transfer


async def main():
    base = 'http://127.0.0.1:18765'
    async with aiohttp.ClientSession() as client:
        devices = await (await client.get(base + '/api/devices')).json()
        if len(devices) != 1:
            raise RuntimeError('Expected exactly one online phone')
        device = devices[0]['installationId']
        key = hashlib.sha256(device.encode()).hexdigest()[:32]
        cwd = ROOT / 'server/data/devices' / key / 'project'
        (cwd / 'transfers').mkdir(parents=True, exist_ok=True)
        name = 'roundtrip-' + uuid.uuid4().hex[:10] + '.bin'
        source = cwd / 'transfers' / name
        payload = (bytes(range(256)) * 2344)[:600001]
        source.write_bytes(payload)
        progress = []
        async def broadcast(msg):
            progress.append(msg)
        class Gateway:
            async def rpc(self, target, args):
                async with client.post(base + '/api/devices/' + target + '/call', json=args) as response:
                    if response.status != 200:
                        raise RuntimeError(await response.text())
                    return await response.json()
        project = SimpleNamespace(cwd=cwd, device=device, host=SimpleNamespace(gateway=Gateway()), broadcast=broadcast)
        sent = await transfer(project, 'toPhone', {'projectPath': 'transfers/' + name})
        received = await transfer(project, 'fromPhone', {'phonePath': sent['phonePath'], 'projectPath': 'transfers/received-' + name})
        assert sent['sha256'] == received['sha256'] == hashlib.sha256(payload).hexdigest()
        assert (cwd / 'transfers' / ('received-' + name)).read_bytes() == payload
        assert 'base64' not in json.dumps(progress)
        result = {'mock': False, 'sourceBytes': len(payload), 'toPhone': sent, 'fromPhone': received,
                  'progressEvents': len(progress), 'fileContentInModelContext': False}
        (ROOT / 'server/run/file-transfer-live.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
