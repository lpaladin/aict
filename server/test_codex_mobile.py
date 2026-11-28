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
from unittest.mock import AsyncMock, patch

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

    async def test_native_progress_uses_exact_turn_and_never_infers_completion(self):
        project = self.host.project('phone-one')
        project.process = type('Running', (), {'returncode': None})()
        project.turn_progress['turn-one'] = {'threadId': 'thread-one', 'status': 'running', 'step': '执行命令'}
        response = await self.client.get('/api/codex/phone-one/progress/turn-one')
        self.assertEqual((await response.json())['status'], 'running')
        response = await self.client.get('/api/codex/phone-two/progress/turn-one')
        self.assertEqual((await response.json())['status'], 'unknown')
        response = await self.client.get('/api/codex/phone-one/progress/old-turn')
        self.assertEqual((await response.json())['status'], 'unknown')
        project.turn_progress['turn-one'].update(status='completed', step='已完成')
        response = await self.client.get('/api/codex/phone-one/progress/turn-one')
        self.assertEqual((await response.json())['status'], 'completed')
        project.process = None

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

    async def test_app_folder_lists_saved_pages_and_registered_addresses(self):
        project = self.host.project('phone-one')
        root = project.cwd / 'artifacts'
        (root / 'my app').mkdir()
        (root / 'my app/index.html').touch()
        (root / 'icon.png').touch()
        (project.cwd / 'apps.json').write_text("""[
            {"name":"<Tool>", "path":"my app/index.html", "icon":"icon.png"},
            {"name":"Remote", "url":"https://example.com/?a=1&b=2"},
            {"name":"Invalid", "url":"javascript:alert(1)"}
        ]""", encoding='utf-8')

        response = await self.client.get(f'/artifact-list/{project.key}')
        page = await response.text()
        self.assertEqual(response.status, 200)
        self.assertEqual(page.count('class="app"'), 2)
        self.assertIn(f'href="/artifacts/{project.key}/my%20app/index.html"', page)
        self.assertIn(f'src="/artifacts/{project.key}/icon.png"', page)
        self.assertIn('&lt;Tool&gt;', page)
        self.assertIn('https://example.com/?a=1&amp;b=2', page)
        self.assertNotIn('javascript:', page)

    async def test_phone_tool_targets_bound_device_and_returns_native_error(self):
        one = self.host.project('phone-one')
        one.write = AsyncMock()
        await one.phone_tool({'id': 9, 'params': {'tool': 'phone_call', 'arguments': {'method': 'capabilities', 'params': {}}}})
        self.assertEqual(self.gateway.calls[0][0], 'phone-one')
        self.assertTrue(one.write.call_args.args[0]['result']['success'])
        self.gateway.rpc = AsyncMock(return_value={'ok': False, 'error': 'Permission denied'})
        await one.phone_tool({'id': 10, 'params': {'tool': 'phone_call', 'arguments': {'method': 'file.read', 'params': {'path': '/x'}}}})
        self.assertFalse(one.write.call_args.args[0]['result']['success'])

    async def test_selected_phone_routes_operations_and_offline_never_falls_back(self):
        two = self.host.project('phone-two')
        two.write = AsyncMock()
        await two.phone_tool({'id': 12, 'params': {'tool': 'phone_call', 'arguments': {'method': 'capabilities', 'params': {}}}})
        self.assertEqual(self.gateway.calls[-1][0], 'phone-two')
        del self.gateway.devices['phone-two']
        response = await self.client.get('/api/codex/phone-two/ws')
        self.assertEqual(response.status, 404)
        self.assertNotIn('phone-one', [call[0] for call in self.gateway.calls])

    async def test_restart_tool_routes_to_independent_worker_not_phone_rpc(self):
        one = self.host.project('phone-one'); one.write = AsyncMock()
        self.gateway.rpc = AsyncMock()
        with patch('codex_mobile.schedule_restart', return_value={'state': 'scheduled', 'operationId': 'test-worker'}) as restart:
            await one.phone_tool({'id': 11, 'params': {'tool': 'phone_call', 'arguments': {'method': 'service.restart', 'params': {}}}})
        restart.assert_called_once_with(None)
        self.gateway.rpc.assert_not_awaited()
        output = one.write.call_args.args[0]['result']
        self.assertTrue(output['success'])
        self.assertEqual(json.loads(output['contentItems'][0]['text'])['result']['state'], 'scheduled')

    async def test_client_cannot_override_workspace_and_offline_device(self):
        one = self.host.project('phone-one')
        one.start = AsyncMock()
        one.resume = AsyncMock()
        one.rpc = AsyncMock(return_value={})
        one.state['threads'].append({'id': 'x', 'title': 'Test'})
        await one.dispatch('turn/start', {'threadId': 'x', 'input': [], 'cwd': 'C:/', 'approvalPolicy': 'never'})
        self.assertEqual(one.rpc.call_args.args[1], {
            'threadId': 'x', 'input': [], 'approvalPolicy': 'on-request',
            'sandboxPolicy': {'type': 'workspaceWrite'},
        })
        for mode, approval, sandbox in [
            ('full-access', 'never', 'dangerFullAccess'),
            ('workspace', 'on-request', 'workspaceWrite'),
            ('unknown', 'on-request', 'workspaceWrite'),
        ]:
            with self.subTest(mode=mode):
                await one.dispatch('turn/start', {
                    'threadId': 'x', 'input': [], 'executionMode': mode,
                    'approvalMode': 'never', 'sandboxPolicy': {'type': 'dangerFullAccess'},
                })
                self.assertEqual(one.rpc.call_args.args[1], {
                    'threadId': 'x', 'input': [], 'approvalPolicy': approval,
                    'sandboxPolicy': {'type': sandbox},
                })
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
        read_calls = []
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
            elif method == 'script.execute':
                persisted = phone_files[p['args'].get('path')]
                out = {'bytes': len(persisted), 'sha256': hashlib.sha256(persisted).hexdigest()}
            elif method == 'file.read':
                read_calls.append(path)
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
        self.assertEqual(read_calls, [], 'Upload verification must not download the payload again')
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
            self.assertEqual(command['method'], 'script.execute')
            return {'ok': True, 'result': {'bytes': 7, 'sha256': hashlib.sha256(b'corrupt').hexdigest()}}
        self.gateway.rpc = corrupt
        one.broadcast = AsyncMock()
        with self.assertRaisesRegex(RuntimeError, 'SHA-256 mismatch'):
            await transfer(one, 'toPhone', {'projectPath': 'source.bin', 'phonePath': '/downloads/target.bin'})

    async def test_thread_actions_persist_and_notify_clients(self):
        project = self.host.project('phone-one')
        project.state['threads'] = [{'id': 'existing'}, {'id': 'empty', 'persisted': False}]
        project.start = AsyncMock()
        project.rpc = AsyncMock()
        async with self.client.ws_connect('/api/codex/phone-one/ws') as first, self.client.ws_connect('/api/codex/phone-one/ws') as second:
            self.assertTrue((await first.receive_json())['session']['threadActions'])
            await second.receive_json()

            async def change(request_id, method, expected, **params):
                await first.send_json({'id': request_id, 'method': method, 'params': params})
                for client in (first, second):
                    event = (await client.receive_json(timeout=2))['event']
                    self.assertEqual(event, {'method': 'aict/threadChanged', 'params': expected})
                self.assertEqual(await first.receive_json(timeout=2), {'id': request_id, 'result': {}})

            await change(1, 'thread/pin', {'threadId': 'existing', 'pinned': True}, threadId='existing', pinned=True)
            restored = CodexMobile(self.gateway, self.test_dir).project('phone-one')
            self.assertTrue(restored.state['threads'][0]['pinned'])
            await change(2, 'thread/pin', {'threadId': 'existing', 'pinned': False}, threadId='existing', pinned=False)
            await change(3, 'thread/delete', {'threadId': 'empty', 'deleted': True}, threadId='empty')
            project.rpc.assert_not_awaited()
            await change(4, 'thread/delete', {'threadId': 'existing', 'deleted': True}, threadId='existing')
            project.rpc.assert_awaited_once_with('thread/delete', {'threadId': 'existing'})
        restored = CodexMobile(self.gateway, self.test_dir).project('phone-one')
        self.assertEqual(restored.state['threads'], [])
        with self.assertRaisesRegex(ValueError, 'does not belong'):
            await project.dispatch('thread/delete', {'threadId': 'foreign'})

    async def test_thread_deletion_serializes_with_turns_and_preserves_failed_deletes(self):
        project = self.host.project('phone-one')
        project.state['threads'] = [{'id': 'existing', 'name': 'Existing'}]
        project.start = AsyncMock()
        project.resume = AsyncMock()
        started, finish = asyncio.Event(), asyncio.Event()

        async def rpc(method, _params):
            if method == 'turn/start':
                started.set()
                await finish.wait()
                return {'turn': {'id': 'active-turn', 'status': 'inProgress'}}
            raise RuntimeError('delete failed')

        project.rpc = AsyncMock(side_effect=rpc)
        starting = asyncio.create_task(project.dispatch('turn/start', {'threadId': 'existing', 'input': []}))
        await asyncio.wait_for(started.wait(), 2)
        deleting = asyncio.create_task(project.dispatch('thread/delete', {'threadId': 'existing'}))
        await asyncio.sleep(0)
        self.assertFalse(deleting.done())
        finish.set()
        await starting
        with self.assertRaisesRegex(ValueError, '正在运行'):
            await deleting
        project.active.clear()
        with self.assertRaisesRegex(RuntimeError, 'delete failed'):
            await project.dispatch('thread/delete', {'threadId': 'existing'})
        project.owns('existing')

    async def test_new_thread_pins_supported_history_mode(self):
        one = self.host.project('phone-one')
        one.start = AsyncMock()
        one.resumed = set()
        one.rpc = AsyncMock(return_value={'thread': {'id': 'new-thread', 'turns': []}})
        await one.dispatch('thread/start', {'historyMode': 'paginated'})
        self.assertEqual(one.rpc.call_args.args[1]['historyMode'], 'legacy')
        history = await one.dispatch('thread/read', {'threadId': 'new-thread', 'includeTurns': True})
        self.assertEqual(history['thread']['turns'], [])
        self.assertFalse(one.rpc.call_args.args[1]['includeTurns'])

    @unittest.skipUnless(os.environ.get('AICT_TEST_LIVE_CODEX'), 'Opt-in actual Codex process test')
    async def test_actual_codex_thread_model_and_resume(self):
        one = self.host.project('phone-one')
        result = await one.dispatch('thread/start', {})
        thread = result['thread']['id']
        self.assertEqual(Path(result['thread']['cwd']), one.cwd)
        self.assertEqual(result['thread'].get('historyMode'), 'legacy')
        blank = await one.dispatch('thread/read', {'threadId': thread, 'includeTurns': True})
        self.assertEqual(blank['thread']['turns'], [])
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
