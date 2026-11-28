"""AICT development gateway: dedicated SSH forwarding, HTTP and bidirectional RPC.

No SSH shell or arbitrary remote forwarding is exposed. Authenticated clients may
open TCP streams to gateway services and explicitly configured loopback ports.
"""
import argparse
import asyncio
import json
import logging
import os
import re
import ipaddress
import urllib.request
import secrets
import sys
from collections import defaultdict, deque
from urllib.parse import urlsplit
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import asyncssh
from aiohttp import web

LOG = logging.getLogger('aict')
MAX_LINE = 8 * 1024 * 1024
LAN_DISCOVERY_PORT = 18768


class Gateway:
    def __init__(self, config):
        self.config = config
        self.devices = {}
        self.pending = {}
        self.events = defaultdict(lambda: deque(maxlen=256))
        self.event_sequence = 0
        self.watchers = defaultdict(set)
        self.updates = None

    async def control(self, reader, writer):
        device = None
        try:
            hello = json.loads(await asyncio.wait_for(reader.readline(), 15))
            device = hello['installationId']
            if not isinstance(device, str) or not 1 <= len(device) <= 128:
                raise ValueError('invalid installationId')
            previous = self.devices.get(device)
            self.devices[device] = {'writer': writer, 'hello': hello}
            if previous:
                previous['writer'].close()
            LOG.info('device online: %s', device)
            writer.write(b'{"type":"welcome","protocol":1}\n')
            await writer.drain()
            if self.updates:
                self.updates.online(device)
            while line := await reader.readline():
                msg = json.loads(line)
                if msg.get('type') == 'deviceSettings':
                    if self.devices.get(device, {}).get('writer') is writer:
                        hello['acceptRemoteControl'] = msg.get('acceptRemoteControl') is True
                    continue
                if msg.get('type') == 'event':
                    self.event_sequence += 1
                    event = dict(msg, sequence=self.event_sequence, deviceId=device)
                    self.events[device].append(event)
                    for queue in list(self.watchers[device]):
                        if queue.full():
                            queue.get_nowait()
                        queue.put_nowait(event)
                    continue
                key = (device, msg.get('id'))
                future = self.pending.get(key)
                if future is not None and not future.done():
                    future.set_result(msg)
        except (Exception, asyncio.CancelledError) as exc:
            LOG.info('control closed: %s (%s)', device, type(exc).__name__)
        finally:
            if device and self.devices.get(device, {}).get('writer') is writer:
                del self.devices[device]
                for (dev, _), fut in list(self.pending.items()):
                    if dev == device and not fut.done():
                        fut.set_exception(ConnectionError('device disconnected'))
            writer.close()
            await writer.wait_closed()

    async def rpc(self, device, command, timeout=60):
        entry = self.devices.get(device)
        if not entry:
            raise web.HTTPNotFound(text='device is offline')
        request_id = secrets.token_hex(12)
        command = dict(command, id=request_id, type='request')
        future = asyncio.get_running_loop().create_future()
        self.pending[(device, request_id)] = future
        try:
            entry['writer'].write((json.dumps(command) + '\n').encode())
            await entry['writer'].drain()
            return await asyncio.wait_for(future, timeout)
        finally:
            self.pending.pop((device, request_id), None)

    async def devices_api(self, request):
        return web.json_response([dict(v['hello']) for v in self.devices.values()
                                  if v['hello'].get('acceptRemoteControl') is True])

    async def rpc_api(self, request):
        command = await request.json()
        try:
            timeout = max(1, min(3600, float(command.pop('waitSeconds', 60))))
            return web.json_response(await self.rpc(request.match_info['device'], command, timeout))
        except asyncio.TimeoutError:
            raise web.HTTPGatewayTimeout(text='execution result timed out; task may still be running')
        except ConnectionError:
            raise web.HTTPBadGateway(text='device disconnected')

    async def index(self, request):
        return web.FileResponse(ROOT / 'server/web/index.html')

    async def sdk(self, request):
        return web.FileResponse(ROOT / 'server/web/phone.js')

    async def download_fixture(self, request):
        data = bytes(range(256)) * 4096
        headers = {'ETag': '"aict-test-v1"', 'Accept-Ranges': 'bytes',
                   'Content-Disposition': 'attachment; filename="aict-test.bin"'}
        range_header = request.headers.get('Range', '')
        if range_header.startswith('bytes=') and request.headers.get('If-Range', '"aict-test-v1"') == '"aict-test-v1"':
            try:
                start = int(range_header[6:].split('-')[0])
            except ValueError:
                raise web.HTTPBadRequest(text='invalid range')
            if start < 0 or start >= len(data):
                return web.Response(status=416, headers={'Content-Range': f'bytes */{len(data)}'})
            headers['Content-Range'] = f'bytes {start}-{len(data)-1}/{len(data)}'
            return web.Response(status=206, body=data[start:], headers=headers)
        return web.Response(body=data, headers=headers)

    async def redirect_fixture(self, request):
        raise web.HTTPFound('/test/download')

    async def client_apk(self, request):
        apk = ROOT / 'dist/aict-demo-0.2.0.apk'
        if not apk.is_file() or not (ROOT / 'dist/READY-0.2.0').is_file():
            raise web.HTTPNotFound(text='APK build is not available yet')
        return web.FileResponse(apk, headers={'Content-Disposition': 'attachment; filename="aict-demo-0.2.0.apk"'})

    async def events_api(self, request):
        after = int(request.query.get('after', 0))
        return web.json_response([event for event in self.events[request.match_info['device']] if event['sequence'] > after])

    async def events_socket(self, request):
        device = request.match_info['device']
        ws = web.WebSocketResponse(heartbeat=25)
        await ws.prepare(request)
        queue = asyncio.Queue(maxsize=128)
        self.watchers[device].add(queue)
        async def send():
            for event in list(self.events[device]):
                await ws.send_json(event)
            while True:
                await ws.send_json(await queue.get())
        sender = asyncio.create_task(send())
        try:
            async for _ in ws:
                pass
        finally:
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)
            self.watchers[device].discard(queue)
        return ws


class LanDiscovery(asyncio.DatagramProtocol):
    def __init__(self, fingerprint, ssh_port):
        self.fingerprint = fingerprint.encode('ascii')
        self.ssh_port = str(ssh_port).encode('ascii')

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, sender):
        if len(data) != len(b'AICT-DISCOVER/1 ') + 32 + 1 + len(self.fingerprint):
            return
        match = re.fullmatch(rb'AICT-DISCOVER/1 ([0-9a-f]{32}) ([A-Za-z0-9:+/]+)', data)
        if match and match[2] == self.fingerprint:
            # The reply is smaller than the query and contains no device data.
            self.transport.sendto(b'AICT-HERE/1 ' + match[1] + b' ' + self.ssh_port, sender)


class SSHServer(asyncssh.SSHServer):
    def __init__(self, config):
        self.config = config

    def connection_made(self, conn):
        self.conn = conn

    def begin_auth(self, username):
        return True

    def public_key_auth_supported(self):
        return True

    def validate_public_key(self, username, key):
        if username == self.config['username']:
            return key == self.config['client_public_key']
        # Additional trusted users have their own public key; never use username as a path unchecked.
        if not re.fullmatch(r'[a-z][a-z0-9_-]{0,31}', username):
            return False
        try:
            allowed = asyncssh.read_public_key(ROOT / '.secrets/users' / (username + '.pub'))
            return key == allowed
        except (OSError, ValueError):
            return False

    def connection_requested(self, dest_host, dest_port, orig_host, orig_port):
        if dest_host != '127.0.0.1':
            return False
        if dest_port in {self.config['http_port'], self.config['control_port'], self.config['proxy_port']}:
            return True
        username = self.conn.get_extra_info('username')
        return dest_port in self.config.get('forward_ports_by_user', {}).get(username, ())


async def pump(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
        if writer.can_write_eof():
            writer.write_eof()
    except (OSError, ConnectionError):
        pass


def upstream_proxy(host, scheme):
    """Keep local services local; follow the Windows user's configured proxy."""
    if host.lower() == 'localhost':
        return None
    try:
        if ipaddress.ip_address(host).is_loopback:
            return None
    except ValueError:
        pass
    explicit = os.environ.get('AICT_UPSTREAM_PROXY')
    if explicit is not None:
        value = explicit
    elif sys.platform == 'win32':
        if urllib.request.proxy_bypass_registry(host):
            return None
        value = urllib.request.getproxies_registry().get(scheme)
    else:
        if urllib.request.proxy_bypass(host):
            return None
        value = urllib.request.getproxies().get(scheme)
    if not value:
        return None
    address = urlsplit(value if '://' in value else 'http://' + value)
    if address.scheme != 'http' or not address.hostname or address.username is not None:
        raise ValueError('AICT upstream must be an HTTP proxy without credentials')
    return address.hostname, address.port or 80


async def proxy(reader, writer):
    """Trusted-client HTTP proxy, including CONNECT and WebSocket upgrades."""
    upstream = None
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 30)
        lines = head.split(b'\r\n')
        method, raw_target, version = lines[0].decode('latin1').split(' ', 2)
        if method == 'CONNECT':
            host, port = raw_target.rsplit(':', 1)
            host = host.strip('[]')
            via = upstream_proxy(host, 'https')
            remote_reader, upstream = await asyncio.wait_for(asyncio.open_connection(*(via or (host, int(port)))), 20)
            if via:
                upstream.write(f'CONNECT {raw_target} HTTP/1.1\r\nHost: {raw_target}\r\n\r\n'.encode('latin1'))
                await upstream.drain()
                response = await asyncio.wait_for(remote_reader.readuntil(b'\r\n\r\n'), 30)
                if response.split(b'\r\n', 1)[0].split()[1] != b'200':
                    writer.write(response)
                    await writer.drain()
                    return
            writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            await writer.drain()
        else:
            url = urlsplit(raw_target)
            if url.scheme not in ('http', 'ws') or not url.hostname:
                raise ValueError('expected absolute HTTP proxy request target')
            via = upstream_proxy(url.hostname, 'http')
            remote_reader, upstream = await asyncio.wait_for(asyncio.open_connection(*(via or (url.hostname, url.port or 80))), 20)
            path = raw_target if via else (url.path or '/') + ('?' + url.query if url.query else '')
            upgrade = any(line.lower().startswith(b'upgrade:') for line in lines[1:])
            headers = [line for line in lines[1:] if line and not line.lower().startswith(b'proxy-connection:')]
            if not upgrade:
                headers = [line for line in headers if not line.lower().startswith(b'connection:')]
                headers.append(b'Connection: close')
            upstream.write(f'{method} {path} {version}\r\n'.encode('latin1') + b'\r\n'.join(headers) + b'\r\n\r\n')
            await upstream.drain()
        outbound = asyncio.create_task(pump(reader, upstream))
        try:
            await pump(remote_reader, writer)
        finally:
            outbound.cancel()
            await asyncio.gather(outbound, return_exceptions=True)
    except Exception as exc:
        LOG.info('proxy error: %s', type(exc).__name__)
        try:
            writer.write(b'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
            await writer.drain()
        except OSError:
            pass
    finally:
        if upstream:
            upstream.close()
        writer.close()
        await writer.wait_closed()


async def serve(args):
    config = json.loads((ROOT / '.secrets/server.json').read_text('utf-8'))
    forward_ports = config.get('forward_ports_by_user', {})
    if not isinstance(forward_ports, dict) or any(
        not isinstance(ports, list) or any(type(port) is not int or not 1 <= port <= 65535
                                          for port in ports)
        for ports in forward_ports.values()
    ):
        raise ValueError('forward_ports_by_user must map SSH usernames to lists of TCP port numbers')
    config['client_public_key'] = asyncssh.read_public_key(ROOT / '.secrets/client.pub')
    gateway = Gateway(config)
    from device_updates import DeviceUpdates
    gateway.updates = DeviceUpdates(gateway)
    app = web.Application(client_max_size=MAX_LINE)
    gateway.updates.install(app)
    from codex_mobile import CodexMobile
    mobile = CodexMobile(gateway)
    mobile.install(app)
    app.router.add_get('/', mobile.index)
    app.router.add_get('/diagnostics', gateway.index)
    app.router.add_get('/phone.js', gateway.sdk)
    app.router.add_get('/test/download', gateway.download_fixture)
    app.router.add_get('/test/redirect', gateway.redirect_fixture)
    app.router.add_get('/download/aict-latest.apk', gateway.client_apk)
    app.router.add_get('/api/devices', gateway.devices_api)
    app.router.add_post('/api/devices/{device}/call', gateway.rpc_api)
    app.router.add_get('/api/devices/{device}/events', gateway.events_api)
    app.router.add_get('/api/devices/{device}/events/ws', gateway.events_socket)
    app.router.add_get('/health', lambda r: web.json_response({'ok': True, 'protocol': 1}))
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, '127.0.0.1', config['http_port']).start()
    control = await asyncio.start_server(gateway.control, '127.0.0.1', config['control_port'], limit=MAX_LINE)
    proxy_server = await asyncio.start_server(proxy, '127.0.0.1', config['proxy_port'], limit=65536)
    ssh_port = args.port or config['ssh_port']
    host_key = asyncssh.read_private_key(ROOT / '.secrets/host')
    ssh = await asyncssh.create_server(
        lambda: SSHServer(config), args.bind, ssh_port,
        server_host_keys=[host_key],
        encoding=None,
    )
    discovery = None
    try:
        discovery, _ = await asyncio.get_running_loop().create_datagram_endpoint(
            lambda: LanDiscovery(host_key.get_fingerprint('sha256'), ssh_port),
            local_addr=(args.bind, LAN_DISCOVERY_PORT),
        )
    except OSError as exc:
        LOG.warning('LAN discovery unavailable on UDP %s: %s', LAN_DISCOVERY_PORT, exc)
    LOG.info('SSH %s:%s; HTTP 127.0.0.1:%s; control 127.0.0.1:%s',
             args.bind, args.port or config['ssh_port'], config['http_port'], config['control_port'])
    try:
        await asyncio.Future()
    finally:
        if discovery is not None:
            discovery.close()
        ssh.close()
        control.close()
        proxy_server.close()
        await runner.cleanup()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', default='0.0.0.0')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    try:
        asyncio.run(serve(args))
    except KeyboardInterrupt:
        pass
