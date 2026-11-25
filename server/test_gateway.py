import asyncio
import json
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
sys.path.insert(0, str(ROOT / 'server'))
import asyncssh
import aiohttp
from aiohttp import web
from main import Gateway, SSHServer, proxy


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.host_key = asyncssh.generate_private_key('ssh-rsa', key_size=2048)
        self.client_key = asyncssh.generate_private_key('ssh-rsa', key_size=2048)
        self.config = {'username': 'test', 'client_public_key': self.client_key.convert_to_public()}
        self.gateway = Gateway(self.config)
        app = web.Application()
        app.router.add_get('/', self.gateway.index)
        app.router.add_get('/health', lambda r: web.json_response({'ok': True}))
        app.router.add_post('/echo', lambda r: self.echo(r))
        app.router.add_get('/ws', self.websocket)
        app.router.add_get('/sse', self.sse)
        app.router.add_get('/api/devices', self.gateway.devices_api)
        app.router.add_get('/api/devices/{device}/events', self.gateway.events_api)
        app.router.add_get('/api/devices/{device}/events/ws', self.gateway.events_socket)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        self.http_port = site._server.sockets[0].getsockname()[1]
        self.control_server = await asyncio.start_server(self.gateway.control, '127.0.0.1', 0)
        self.proxy_server = await asyncio.start_server(proxy, '127.0.0.1', 0)
        self.config.update(http_port=self.http_port,
            control_port=self.control_server.sockets[0].getsockname()[1],
            proxy_port=self.proxy_server.sockets[0].getsockname()[1])
        self.ssh_server = await asyncssh.create_server(lambda: SSHServer(self.config), '127.0.0.1', 0, server_host_keys=[self.host_key])
        self.ssh_port = self.ssh_server.get_port()
        self.known = ([self.host_key.convert_to_public()], [], [])
        self.ssh = await asyncssh.connect('127.0.0.1', self.ssh_port, username='test', client_keys=[self.client_key], known_hosts=self.known)
        self.forward = await self.ssh.forward_local_port('127.0.0.1', 0, '127.0.0.1', self.config['proxy_port'])
        self.proxy_url = 'http://127.0.0.1:' + str(self.forward.get_port())
        self.base = 'http://127.0.0.1:' + str(self.http_port)

    async def test_additional_user_key_is_bound_to_username(self):
        second = asyncssh.generate_private_key('ssh-rsa', key_size=2048)
        def read_user(path):
            if Path(path).name == 'user2.pub':
                return second.convert_to_public()
            raise FileNotFoundError(path)
        with patch('main.asyncssh.read_public_key', side_effect=read_user):
            connection = await asyncssh.connect('127.0.0.1', self.ssh_port, username='user2', client_keys=[second], known_hosts=self.known)
            connection.close()
            await connection.wait_closed()
            with self.assertRaises(asyncssh.PermissionDenied):
                await asyncssh.connect('127.0.0.1', self.ssh_port, username='user2', client_keys=[self.client_key], known_hosts=self.known)
            self.assertFalse(SSHServer(self.config).validate_public_key('../user2', second.convert_to_public()))
            self.assertFalse(SSHServer(self.config).validate_public_key('unknown', second.convert_to_public()))

    async def echo(self, request):
        return web.Response(body=await request.read(), headers={'Set-Cookie': 'session=test; HttpOnly'})

    async def websocket(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                await ws.send_str(msg.data)
            elif msg.type == aiohttp.WSMsgType.BINARY:
                await ws.send_bytes(msg.data)
        return ws

    async def sse(self, request):
        response = web.StreamResponse(headers={'Content-Type': 'text/event-stream'})
        await response.prepare(request)
        await response.write(b'data: first\n\n')
        await asyncio.sleep(.05)
        await response.write(b'data: second\n\n')
        await response.write_eof()
        return response

    async def asyncTearDown(self):
        self.forward.close()
        self.ssh.close()
        await self.ssh.wait_closed()
        self.ssh_server.close()
        await self.ssh_server.wait_closed()
        self.control_server.close()
        self.proxy_server.close()
        await self.control_server.wait_closed()
        await self.proxy_server.wait_closed()
        await self.runner.cleanup()

    async def test_http_post_cookie_and_webpage_over_ssh(self):
        async with aiohttp.ClientSession() as client:
            async with client.get(self.base + '/', proxy=self.proxy_url) as response:
                self.assertIn('点击发送 Toast', await response.text())
            data = bytes(range(256)) * 2048
            async with client.post(self.base + '/echo', data=data, proxy=self.proxy_url) as response:
                self.assertEqual(await response.read(), data)
                self.assertIn('session=test', response.headers['Set-Cookie'])

    async def test_websocket_bidirectional(self):
        async with aiohttp.ClientSession() as client:
            async with client.ws_connect(self.base + '/ws', proxy=self.proxy_url) as ws:
                await ws.send_str('native-container')
                self.assertEqual((await ws.receive()).data, 'native-container')
                await ws.send_bytes(b'\x00\x01\xff')
                self.assertEqual((await ws.receive()).data, b'\x00\x01\xff')

    async def test_sse_stream(self):
        async with aiohttp.ClientSession() as client:
            async with client.get(self.base + '/sse', proxy=self.proxy_url) as response:
                self.assertEqual(await response.content.readline(), b'data: first\n')
                self.assertIn(b'data: second', await response.read())

    async def test_connect_tunnel(self):
        reader, writer = await asyncio.open_connection('127.0.0.1', self.forward.get_port())
        writer.write(f'CONNECT 127.0.0.1:{self.http_port} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n'.encode())
        await writer.drain()
        self.assertIn(b'200', await reader.readuntil(b'\r\n\r\n'))
        writer.write(b'GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
        await writer.drain()
        self.assertIn(b'"ok": true', await reader.read())
        writer.close()
        await writer.wait_closed()

    async def test_server_initiated_rpc(self):
        reader, writer = await self.ssh.open_connection('127.0.0.1', self.config['control_port'], encoding='utf-8')
        writer.write(json.dumps({'installationId': 'mock-phone', 'type': 'hello'}) + '\n')
        await writer.drain()
        await reader.readline()
        task = asyncio.create_task(self.gateway.rpc('mock-phone', {'method': 'script.execute', 'params': {'source': 'toast("hello")'}}))
        request = json.loads(await reader.readline())
        self.assertEqual(request['params']['source'], 'toast("hello")')
        writer.write(json.dumps({'id': request['id'], 'ok': True, 'result': 'mock-only'}) + '\n')
        await writer.drain()
        self.assertEqual((await task)['result'], 'mock-only')
        writer.close()
        await writer.wait_closed()

    async def test_device_list_requires_explicit_consent_and_updates_live(self):
        reader, writer = await self.ssh.open_connection('127.0.0.1', self.config['control_port'], encoding='utf-8')
        writer.write(json.dumps({'installationId': 'consent-phone'}) + '\n')
        await writer.drain()
        await reader.readline()
        try:
            async with aiohttp.ClientSession() as client:
                async def listed():
                    async with client.get(self.base + '/api/devices') as response:
                        return await response.json()
                self.assertEqual(await listed(), [])
                for value, visible in [(True, True), (False, False), ('true', False), (True, True)]:
                    writer.write(json.dumps({'type': 'deviceSettings', 'acceptRemoteControl': value}) + '\n')
                    await writer.drain()
                    for _ in range(100):
                        if self.gateway.devices['consent-phone']['hello'].get('acceptRemoteControl') is (value is True):
                            break
                        await asyncio.sleep(.01)
                    devices = await listed()
                    self.assertEqual([d['installationId'] for d in devices], ['consent-phone'] if visible else [])
        finally:
            writer.close()
            await writer.wait_closed()

    async def test_wrong_key_rejected(self):
        bad_key = asyncssh.generate_private_key('ssh-rsa', key_size=2048)
        with self.assertRaises(asyncssh.PermissionDenied):
            await asyncssh.connect('127.0.0.1', self.ssh_port, username='test', client_keys=[bad_key], known_hosts=self.known)

    async def test_progress_event_does_not_finish_rpc(self):
        reader, writer = await self.ssh.open_connection('127.0.0.1', self.config['control_port'], encoding='utf-8')
        writer.write(json.dumps({'installationId': 'event-phone'}) + '\n')
        await writer.drain()
        await reader.readline()
        task = asyncio.create_task(self.gateway.rpc('event-phone', {'method': 'script.execute'}))
        request = json.loads(await reader.readline())
        writer.write(json.dumps({'type': 'event', 'id': request['id'], 'event': 'progress', 'data': {'step': 1}}) + '\n')
        await writer.drain()
        async with aiohttp.ClientSession() as client:
            for _ in range(50):
                if self.gateway.events['event-phone']:
                    break
                await asyncio.sleep(.01)
            async with client.get(self.base + '/api/devices/event-phone/events') as response:
                events = await response.json()
            self.assertEqual(events[0]['data']['step'], 1)
            self.assertFalse(task.done())
            async with client.ws_connect(self.base + '/api/devices/event-phone/events/ws') as ws:
                event = await ws.receive_json(timeout=2)
                self.assertEqual(event['event'], 'progress')
            async with client.get(self.base + '/api/devices/event-phone/events?after=' + str(events[0]['sequence'])) as response:
                self.assertEqual(await response.json(), [])
        writer.write(json.dumps({'id': request['id'], 'ok': True, 'result': 'finished'}) + '\n')
        await writer.drain()
        self.assertEqual((await task)['result'], 'finished')
        writer.close()
        await writer.wait_closed()

    async def test_wrong_host_key_rejected(self):
        wrong_host = asyncssh.generate_private_key('ssh-rsa', key_size=2048)
        with self.assertRaises(asyncssh.HostKeyNotVerifiable):
            await asyncssh.connect('127.0.0.1', self.ssh_port, username='test', client_keys=[self.client_key], known_hosts=([wrong_host.convert_to_public()], [], []))

    async def test_shell_and_unregistered_forward_rejected(self):
        with self.assertRaises(asyncssh.ChannelOpenError):
            await self.ssh.open_connection('127.0.0.1', 22)
        with self.assertRaises(asyncssh.ChannelOpenError):
            await self.ssh.create_process('whoami')


if __name__ == '__main__':
    unittest.main(verbosity=2)
