"""Meaningful device routing, artifact confinement and app-server integration checks."""
import asyncio
import base64
import hashlib
import json
import os
import sys
import uuid
import shutil
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from codex_mobile import CodexMobile
from file_transfer import transfer, CHUNK


class FakeGateway:
    def __init__(self):
        self.devices = {'phone-one': {'hello': {'installationId': 'phone-one', 'model': 'TEST PHONE'}},
                        'phone-two': {'hello': {'installationId': 'phone-two', 'model': 'OTHER PHONE'}}}
        self.calls = []

    async def rpc(self, device, args):
        self.calls.append((device, args))
        return {'ok': True, 'result': {'installationId': device, 'sdk': 35, 'runtime': 'TEST DOUBLE'}}


class MobileTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        (ROOT / 'server/run').mkdir(exist_ok=True)
        self.test_dir = ROOT / 'server/run' / ('mobile-test-' + uuid.uuid4().hex)
        self.test_dir.mkdir()
        self.gateway = FakeGateway()
        self.host = CodexMobile(self.gateway, self.test_dir)
        app = web.Application()
        self.host.install(app)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        if self.test_dir.resolve().is_relative_to((ROOT / 'server/run').resolve()):
            shutil.rmtree(self.test_dir)

    async def test_project_stability_and_thread_ownership(self):
        one, two = self.host.project('phone-one'), self.host.project('phone-two')
        self.assertNotEqual(one.cwd, two.cwd)
        one.state['threads'].append({'id': 'thread-one', 'title': 'Existing'})
        one.save()
        restored = CodexMobile(self.gateway, self.test_dir).project('phone-one')
        self.assertEqual(one.cwd, restored.cwd)
        restored.owns('thread-one')
        with self.assertRaises(ValueError):
            two.owns('thread-one')

    async def test_artifacts_and_traversal(self):
        one = self.host.project('phone-one')
        (one.cwd / 'artifacts/index.html').write_text('<h1>mobile</h1>')
        (one.cwd / 'private.txt').write_text('private')
        response = await self.client.get(f'/artifacts/{one.key}/index.html')
        self.assertEqual(response.status, 200)
        self.assertIn('mobile', await response.text())
        response = await self.client.get(f'/artifacts/{one.key}/%2e%2e%2fprivate.txt')
        self.assertEqual(response.status, 404)
        response = await self.client.get(f'/artifact-list/{one.key}')
        self.assertIn('index.html', await response.text())

    async def test_phone_tool_targets_bound_device_and_returns_native_error(self):
        one = self.host.project('phone-one')
        one.write = AsyncMock()
        await one.phone_tool({'id': 9, 'params': {'tool': 'phone_call', 'arguments': {'method': 'capabilities', 'params': {}}}})
        self.assertEqual(self.gateway.calls[0][0], 'phone-one')
        self.assertTrue(one.write.call_args.args[0]['result']['success'])
        self.gateway.rpc = AsyncMock(return_value={'ok': False, 'error': 'Permission denied'})
        await one.phone_tool({'id': 10, 'params': {'tool': 'phone_call', 'arguments': {'method': 'file.read', 'params': {'path': '/x'}}}})
        self.assertFalse(one.write.call_args.args[0]['result']['success'])

    async def test_client_cannot_override_workspace_and_offline_device(self):
        one = self.host.project('phone-one')
        one.start = AsyncMock()
        one.resume = AsyncMock()
        one.rpc = AsyncMock(return_value={})
        one.state['threads'].append({'id': 'x', 'title': 'Test'})
        await one.dispatch('turn/start', {'threadId': 'x', 'input': [], 'cwd': 'C:/', 'approvalPolicy': 'never'})
        self.assertEqual(one.rpc.call_args.args[1], {'threadId': 'x', 'input': []})
        with self.assertRaises(ValueError):
            await one.dispatch('command/exec', {'command': 'whoami'})
        response = await self.client.get('/api/codex/offline/ws')
        self.assertEqual(response.status, 404)

    async def test_websocket_replays_approval_and_routes_response(self):
        one = self.host.project('phone-one')
        one.write = AsyncMock()
        approval = {'id': 'approval-1', 'method': 'item/commandExecution/requestApproval',
                    'params': {'threadId': 'owned-thread', 'command': 'example'}}
        one.requests['approval-1'] = approval
        ws = await self.client.ws_connect('/api/codex/phone-one/ws')
        hello = await ws.receive_json()
        self.assertEqual(hello['session']['requests'], [approval])
        await ws.send_json({'id': 1, 'method': 'server/respond',
                            'params': {'requestId': 'approval-1', 'result': {'decision': 'decline'}}})
        resolved = await ws.receive_json()
        self.assertEqual(resolved['event']['method'], 'aict/requestResolved')
        reply = await ws.receive_json()
        self.assertEqual(reply, {'id': 1, 'result': {}})
        one.write.assert_awaited_once_with({'id': 'approval-1', 'result': {'decision': 'decline'}})
        await ws.close()
        other = await self.client.ws_connect('/api/codex/phone-two/ws')
        self.assertEqual((await other.receive_json())['session']['requests'], [])
        await other.send_json({'id': 2, 'method': 'server/respond',
                               'params': {'requestId': 'approval-1', 'result': {'decision': 'accept'}}})
        self.assertIn('error', await other.receive_json())
        await other.close()

    async def test_binary_transfer_roundtrip_is_opaque_and_hash_verified(self):
        one = self.host.project('phone-one')
        payload = bytes(range(256)) * 2400 + b'\x00end'
        source = one.cwd / 'source.bin'
        source.write_bytes(payload)
        phone_files = {}
        async def phone_rpc(device, command):
            self.assertEqual(device, 'phone-one')
            p, method = command['params'], command['method']
            path = p.get('path')
            if method == 'file.list':
                out = [{'name': key.rsplit('/', 1)[-1]} for key in phone_files]
            elif method == 'file.write':
                data = base64.b64decode(p['base64']); offset = p['offset']
                self.assertLessEqual(len(data), CHUNK)
                phone_files[path] = phone_files.get(path, b'')[:offset] + data
                out = {'bytes': len(data), 'nextOffset': offset + len(data)}
            elif method == 'file.read':
                data = phone_files[path][p['offset']:p['offset'] + p['length']]
                out = {'bytes': len(data), 'nextOffset': p['offset'] + len(data),
                       'base64': base64.b64encode(data).decode(), 'eof': len(data) < p['length']}
            else:
                raise AssertionError(method)
            return {'ok': True, 'result': out}
        self.gateway.rpc = phone_rpc
        one.broadcast = AsyncMock()
        one.write = AsyncMock()
        await one.phone_tool({'id': 1, 'params': {'tool': 'phone_call', 'threadId': 'test-thread',
            'arguments': {'method': 'transfer.toPhone', 'params': {'projectPath': 'source.bin', 'phonePath': '/downloads/test.bin'}}}})
        output = one.write.call_args.args[0]['result']
        self.assertTrue(output['success'], output)
        metadata = json.loads(output['contentItems'][0]['text'])['result']
        self.assertEqual(metadata['sha256'], hashlib.sha256(payload).hexdigest())
        self.assertEqual(phone_files['/downloads/test.bin'], payload)
        self.assertNotIn('base64', json.dumps(output))
        self.assertLess(len(json.dumps(output)), 1500)
        got = await transfer(one, 'fromPhone', {'phonePath': '/downloads/test.bin', 'projectPath': 'imports/received.bin'})
        self.assertTrue(got['verified'])
        self.assertEqual((one.cwd / 'imports/received.bin').read_bytes(), payload)
        self.assertNotIn('base64', str(one.broadcast.call_args_list))
        with self.assertRaises(FileExistsError):
            await transfer(one, 'fromPhone', {'phonePath': '/downloads/test.bin', 'projectPath': 'imports/received.bin'})
        with self.assertRaises(ValueError):
            await transfer(one, 'fromPhone', {'phonePath': '/downloads/test.bin', 'projectPath': '../escape.bin'})
        phone_files['/downloads/empty.bin'] = b''
        empty = await transfer(one, 'fromPhone', {'phonePath': '/downloads/empty.bin', 'projectPath': 'empty.bin'})
        self.assertEqual(empty['bytes'], 0)
        self.assertEqual((one.cwd / 'empty.bin').read_bytes(), b'')

    async def test_file_upload_streams_bytes_into_project_and_no_content_in_reply(self):
        payload = bytes(range(256)) * 1024
        response = await self.client.post('/api/codex/phone-one/files?name=../../example.bin', data=payload)
        self.assertEqual(response.status, 200)
        saved = await response.json()
        self.assertEqual(saved['name'], 'example.bin')
        self.assertTrue(saved['projectPath'].startswith('imports/'))
        self.assertEqual((self.host.project('phone-one').cwd / saved['projectPath']).read_bytes(), payload)
        self.assertEqual(saved['sha256'], hashlib.sha256(payload).hexdigest())
        self.assertFalse(saved['contentIncluded'])

    async def test_binary_file_read_is_not_allowed_to_spill_into_model_context(self):
        one = self.host.project('phone-one'); one.write = AsyncMock()
        self.gateway.rpc = AsyncMock()
        await one.phone_tool({'id': 1, 'params': {'tool': 'phone_call',
            'arguments': {'method': 'file.read', 'params': {'path': '/photo.jpg'}}}})
        self.assertFalse(one.write.call_args.args[0]['result']['success'])
        self.gateway.rpc.assert_not_awaited()

    async def test_phone_readback_corruption_is_reported_as_failure(self):
        one = self.host.project('phone-one')
        (one.cwd / 'source.bin').write_bytes(b'expected bytes')
        async def corrupt(device, command):
            if command['method'] == 'file.list':
                return {'ok': True, 'result': []}
            if command['method'] == 'file.write':
                p = command['params']; size = len(base64.b64decode(p['base64']))
                return {'ok': True, 'result': {'bytes': size, 'nextOffset': p['offset'] + size}}
            return {'ok': True, 'result': {'base64': base64.b64encode(b'corrupt').decode(),
                'bytes': 7, 'nextOffset': 7, 'eof': True}}
        self.gateway.rpc = corrupt
        one.broadcast = AsyncMock()
        with self.assertRaisesRegex(RuntimeError, 'SHA-256 mismatch'):
            await transfer(one, 'toPhone', {'projectPath': 'source.bin', 'phonePath': '/downloads/target.bin'})

    @unittest.skipUnless(os.environ.get('AICT_TEST_LIVE_CODEX'), 'Opt-in actual Codex process test')
    async def test_actual_codex_thread_model_and_resume(self):
        one = self.host.project('phone-one')
        result = await one.dispatch('thread/start', {})
        thread = result['thread']['id']
        self.assertEqual(Path(result['thread']['cwd']), one.cwd)
        models = await one.dispatch('model/list', {})
        self.assertTrue(models['data'])
        complete = asyncio.Event()
        events = []
        async def collect(msg):
            events.append(msg)
            if msg.get('method') == 'turn/completed':
                complete.set()
        one.broadcast = collect
        await one.dispatch('turn/start', {'threadId': thread, 'input': [{'type': 'text', 'text':
            'This is a gateway integration test with a MOCK phone, not real hardware. Call phone_call with method capabilities and params {} exactly once. Then reply AICT_TEST_OK. Do not call any other tools.'}]})
        await asyncio.wait_for(complete.wait(), 120)
        completed = next(e for e in events if e.get('method') == 'turn/completed')
        self.assertEqual(completed['params']['turn']['status'], 'completed', completed)
        self.assertGreaterEqual(len(self.gateway.calls), 3)  # context refreshes plus actual dynamic tool
        await one.close()
        self.host.projects.pop('phone-one')
        restored = self.host.project('phone-one')
        history = await restored.dispatch('thread/read', {'threadId': thread, 'includeTurns': True})
        self.assertEqual(history['thread']['id'], thread)


if __name__ == '__main__':
    unittest.main(verbosity=2)
