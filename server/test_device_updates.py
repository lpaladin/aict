import hashlib
import json
import sys
import uuid
import shutil
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / '.tools/python'), str(ROOT / 'server')]
from device_updates import DeviceUpdates, save, validate_release, CONNECTION


class UpdateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.root = ROOT / 'server/run' / ('updates-test-' + uuid.uuid4().hex)
        self.root.mkdir(parents=True)
        self.addCleanup(self.cleanup)
        self.gateway = SimpleNamespace(config={'http_port': 18765}, devices={
            'phone': {'hello': {'credentialId': 'alice'}}})
        self.updates = DeviceUpdates(self.gateway, self.root)
        self.releases = {}
        for user in ('alice', 'bob'):
            config = {'credentialId': user, 'username': user, 'privateKey': user + '-private',
                      'host': 'example', 'port': 22, 'hostKeySha256': 'pinned'}
            config_path = self.root / (user + '.json')
            save(config_path, config)
            apk = self.root / (user + '.apk')
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('assets/connection.json', json.dumps(config))
            release = {'credentialId': user, 'connectionConfig': str(config_path),
                       'apk': str(apk), 'version': 'test'}
            release['sha256'] = validate_release(release)
            self.releases[user] = release
        save(self.updates.manifest, {'releases': self.releases})

    def cleanup(self):
        if self.root.resolve().is_relative_to((ROOT / 'server/run').resolve()):
            shutil.rmtree(self.root)

    def test_wrong_user_key_rejected(self):
        bad = dict(self.releases['alice'], apk=self.releases['bob']['apk'])
        with self.assertRaises(ValueError):
            validate_release(bad)

    def test_modified_package_rejected(self):
        Path(self.releases['alice']['apk']).write_bytes(Path(self.releases['bob']['apk']).read_bytes())
        with self.assertRaises(ValueError):
            validate_release(self.releases['alice'])

    async def test_matching_installed_apk_never_downloads(self):
        self.updates.call = AsyncMock(return_value={'sha256': self.releases['alice']['sha256']})
        await self.updates.check('phone')
        self.assertEqual(self.updates.call.await_count, 1)
        self.assertEqual(self.updates.state['phone']['status'], 'installed')

    async def test_delivery_verification_and_reconnect_dedup(self):
        desired = self.releases['alice']['sha256']
        self.updates.call = AsyncMock(side_effect=[{'sha256': 'old'}, {'paths': {'downloads': '/downloads'}},
                                                   {}, {'sha256': desired}, {}])
        await self.updates.check('phone')
        self.assertEqual(self.updates.state['phone']['status'], 'awaiting_install')
        calls = self.updates.call.await_args_list
        self.assertIn(desired[:12], calls[2].args[2]['path'])
        self.assertEqual(calls[-1].args[2]['args']['path'], calls[2].args[2]['path'])
        self.assertEqual(self.updates.tokens, {})
        # Restart the service; persisted offer suppresses another installer.
        reloaded = DeviceUpdates(self.gateway, self.root)
        reloaded.call = AsyncMock(return_value={'sha256': 'old'})
        await reloaded.check('phone')
        self.assertEqual(reloaded.call.await_count, 1)
        self.assertEqual(reloaded.state['phone']['status'], 'awaiting_install')
        reloaded.call = AsyncMock(return_value={'sha256': desired})
        await reloaded.check('phone')
        self.assertEqual(reloaded.state['phone']['status'], 'installed')

    async def test_only_adjacent_apk_is_eligible_for_delta(self):
        release = self.releases['alice']
        desired = release['sha256']
        release['delta'] = {'fromSha256': 'previous', 'path': 'adjacent.gz', 'targetBytes': 1024}
        save(self.updates.manifest, {'releases': self.releases})
        for installed in ('previous', 'older'):
            with self.subTest(installed=installed):
                self.updates.state.clear()
                self.updates.call = AsyncMock(side_effect=[{'sha256': installed},
                    {'paths': {'downloads': '/downloads'}}, {}, {'sha256': desired}, {}])
                await self.updates.check('phone')
                row = self.updates.state['phone']
                self.assertEqual(row['status'], 'awaiting_install')
                self.assertEqual(row['downloadMode'], 'delta' if installed == 'previous' else 'full')
                download = self.updates.call.await_args_list[2].args[2]['path']
                self.assertEqual(download.endswith('.delta'), installed == 'previous')

    async def test_corrupt_delta_falls_back_to_verified_full_apk(self):
        release = self.releases['alice']
        desired = release['sha256']
        release['delta'] = {'fromSha256': 'previous', 'path': 'adjacent.gz', 'targetBytes': 1024}
        save(self.updates.manifest, {'releases': self.releases})
        self.updates.call = AsyncMock(side_effect=[{'sha256': 'previous'},
            {'paths': {'downloads': '/downloads'}}, {}, {'sha256': 'wrong'}, {}, {'sha256': desired}, {}])
        await self.updates.check('phone')
        row = self.updates.state['phone']
        self.assertEqual(row['status'], 'awaiting_install')
        self.assertEqual(row['downloadMode'], 'full')
        calls = self.updates.call.await_args_list
        self.assertTrue(calls[2].args[2]['path'].endswith('.delta'))
        self.assertTrue(calls[4].args[2]['path'].endswith('.apk'))
        self.assertIn('app.viewFile', calls[-1].args[2]['source'])

    async def test_corrupt_download_does_not_open_installer(self):
        self.updates.call = AsyncMock(side_effect=[{'sha256': 'old'}, {'paths': {'downloads': '/downloads'}},
                                                   {}, {'sha256': 'corrupt'}])
        await self.updates.check('phone')
        self.assertEqual(self.updates.call.await_count, 4)
        self.assertEqual(self.updates.state['phone']['status'], 'retry_pending')

    async def test_unknown_credential_gets_no_other_users_release(self):
        self.gateway.devices['phone']['hello']['credentialId'] = 'unknown'
        self.updates.call = AsyncMock()
        await self.updates.check('phone')
        self.updates.call.assert_not_awaited()
        self.assertEqual(self.updates.state['phone']['status'], 'no_release')

    async def test_replaced_connection_cannot_receive_old_users_update(self):
        original = self.gateway.devices['phone']
        token = CONNECTION.set(original)
        try:
            self.gateway.devices['phone'] = {'hello': {'credentialId': 'bob'}}
            self.gateway.rpc = AsyncMock()
            with self.assertRaises(ConnectionError):
                await self.updates.call('phone', 'download.start', {})
            self.gateway.rpc.assert_not_awaited()
        finally:
            CONNECTION.reset(token)

    async def test_download_route_delivers_exact_users_apk_and_revokes_token(self):
        app = web.Application()
        app.router.add_get('/device-updates/{token}.apk', self.updates.download)
        app.router.add_get('/api/updates', self.updates.status)
        client = TestClient(TestServer(app))
        await client.start_server()
        hashes = iter(['old', self.releases['alice']['sha256']])
        calls = []

        async def rpc(device, command, timeout):
            calls.append(command)
            method, params = command['method'], command['params']
            if method == 'download.start':
                path = '/device-updates/' + params['url'].split('/device-updates/')[1]
                response = await client.get(path)
                self.assertEqual(response.status, 200)
                self.assertEqual(await response.read(), Path(self.releases['alice']['apk']).read_bytes())
                return {'ok': True, 'result': {}}
            if method == 'capabilities':
                return {'ok': True, 'result': {'paths': {'downloads': '/downloads'}}}
            if 'maxBytes' in params.get('args', {}):
                return {'ok': True, 'result': {'sha256': next(hashes)}}
            return {'ok': True, 'result': {}}

        self.gateway.rpc = rpc
        try:
            await self.updates.check('phone')
            self.assertEqual(self.updates.state['phone']['status'], 'awaiting_install')
            path = next(c['params']['url'] for c in calls if c['method'] == 'download.start')
            response = await client.get('/device-updates/' + path.split('/device-updates/')[1])
            self.assertEqual(response.status, 404)
            response = await client.get('/api/updates')
            status = await response.text()
            self.assertNotIn('alice-private', status)
            self.assertNotIn('connectionConfig', status)
        finally:
            await client.close()


if __name__ == '__main__':
    unittest.main()
