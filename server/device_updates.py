"""Persistent, credential-specific APK delivery on device reconnect."""
import asyncio
import contextvars
import hashlib
import json
import logging
import secrets
import time
import zipfile
from pathlib import Path

from aiohttp import web
from file_transfer import PHONE_HASH_SCRIPT

LOG = logging.getLogger('aict.updates')
ROOT = Path(__file__).resolve().parents[1]
CONNECTION = contextvars.ContextVar('update_connection', default=None)
INSTALLED_HASH = ("args.path=String(context.getApplicationInfo().sourceDir);\n" + PHONE_HASH_SCRIPT).replace(
    '({bytes: count, sha256: hex});',
    'var info=context.getPackageManager().getPackageInfo(context.getPackageName(),0);'
    '({bytes:count,sha256:hex,versionName:String(info.versionName),versionCode:info.versionCode});')


def load(path, default):
    return json.loads(path.read_text('utf-8')) if path.exists() else default


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), 'utf-8')
    tmp.replace(path)


def validate_release(release):
    """Never publish/deliver an APK containing a different user's private identity."""
    apk = Path(release['apk'])
    config = load(Path(release['connectionConfig']), {})
    with zipfile.ZipFile(apk) as archive:
        embedded = json.loads(archive.read('assets/connection.json'))
    fields = ('credentialId', 'username', 'privateKey', 'host', 'port', 'hostKeySha256')
    if not config.get('privateKey') or any(embedded.get(k) != config.get(k) for k in fields):
        raise ValueError('APK identity does not match registered user configuration')
    if config['credentialId'] != release['credentialId']:
        raise ValueError('Credential mismatch')
    with apk.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if release.get('sha256') and release['sha256'] != digest:
        raise ValueError('Published APK changed; publish it again explicitly')
    return digest


class DeviceUpdates:
    def __init__(self, gateway, directory=None):
        self.gateway = gateway
        self.directory = Path(directory or ROOT / 'server/data/updates')
        self.manifest = self.directory / 'releases.json'
        self.state_path = self.directory / 'devices.json'
        self.state = load(self.state_path, {})
        self.jobs = {}
        self.tokens = {}
        self.validated = {}
        self.worker = None

    def online(self, device):
        if device not in self.jobs or self.jobs[device].done():
            self.jobs[device] = asyncio.create_task(self.check(device))

    async def lifecycle(self, app):
        async def loop():
            while True:
                for device in list(self.gateway.devices):
                    self.online(device)
                await asyncio.sleep(60)
        self.worker = asyncio.create_task(loop())
        yield
        self.worker.cancel()
        jobs = list(self.jobs.values())
        for job in jobs:
            job.cancel()
        await asyncio.gather(self.worker, *jobs, return_exceptions=True)

    def install(self, app):
        app.router.add_get('/api/updates', self.status)
        app.router.add_get('/device-updates/{token}.apk', self.download)
        app.cleanup_ctx.append(self.lifecycle)

    async def status(self, request):
        # Status contains no embedded credential material or private config paths.
        releases = load(self.manifest, {}).get('releases', {})
        return web.json_response({'devices': self.state, 'releases': {
            key: {'version': value['version'], 'sha256': value['sha256']}
            for key, value in releases.items()}})

    async def download(self, request):
        entry = self.tokens.get(request.match_info['token'])
        if not entry or entry['expires'] < time.time():
            raise web.HTTPNotFound()
        return web.FileResponse(entry['apk'], headers={
            'Content-Disposition': 'attachment; filename="AIct-update.apk"',
            'Cache-Control': 'no-store'})

    def record(self, device, **fields):
        row = self.state.setdefault(device, {})
        row.update(fields, checkedAt=time.time())
        save(self.state_path, self.state)

    async def call(self, device, method, params, timeout=60):
        expected = CONNECTION.get()
        if expected is not None and self.gateway.devices.get(device) is not expected:
            raise ConnectionError('Device connection changed during update')
        result = await self.gateway.rpc(device, {'method': method, 'params': params}, timeout)
        if expected is not None and self.gateway.devices.get(device) is not expected:
            raise ConnectionError('Device connection changed during update')
        if not result.get('ok'):
            raise RuntimeError(str(result.get('error', 'Native update operation failed')))
        return result['result']

    async def check(self, device):
        try:
            connection = self.gateway.devices[device]
            CONNECTION.set(connection)
            hello = connection['hello']
            credential = hello.get('credentialId')
            if self.state.get(device, {}).get('credentialId') != credential:
                self.state[device] = {}
            release = load(self.manifest, {}).get('releases', {}).get(credential)
            if not release:
                self.record(device, credentialId=credential, status='no_release')
                return
            apk = Path(release['apk'])
            stamp = (str(apk), apk.stat().st_mtime_ns, release['sha256'],
                     Path(release['connectionConfig']).stat().st_mtime_ns)
            if self.validated.get(credential) != stamp:
                if validate_release(release) != release['sha256']:
                    raise ValueError('Invalid release digest')
                self.validated[credential] = stamp
            installed = await self.call(device, 'script.execute', {
                'source': INSTALLED_HASH, 'args': {'maxBytes': 512 * 1024 * 1024}})
            desired = release['sha256']
            self.record(device, credentialId=credential, release=release['version'],
                        desiredSha256=desired, installedSha256=installed['sha256'],
                        installedVersion=installed.get('versionName'), installedVersionCode=installed.get('versionCode'))
            if installed['sha256'] == desired:
                self.record(device, status='installed', error=None)
                return
            previous = self.state[device]
            # An unanswered Android installer must not re-open every minute/reconnect.
            if previous.get('offeredSha256') == desired and time.time() - previous.get('offeredAt', 0) < 21600:
                self.record(device, status='awaiting_install')
                return
            # Back off transfer failures, while still verifying installation every check.
            if time.time() - previous.get('attemptAt', 0) < 300 and previous.get('attemptSha256') == desired:
                return
            self.record(device, status='downloading', attemptAt=time.time(), attemptSha256=desired, error=None)
            caps = await self.call(device, 'capabilities', {})
            destination = caps['paths']['downloads'] + '/AIct-update-' + desired[:12] + '.apk'
            token = secrets.token_urlsafe(32)
            self.tokens = {k: v for k, v in self.tokens.items() if v['expires'] > time.time()}
            self.tokens[token] = {'apk': apk, 'expires': time.time() + 1800}
            try:
                await self.call(device, 'download.start', {
                    'url': f'http://127.0.0.1:{self.gateway.config["http_port"]}/device-updates/{token}.apk',
                    'path': destination}, timeout=600)
            finally:
                self.tokens.pop(token, None)
            verified = await self.call(device, 'script.execute', {
                'source': PHONE_HASH_SCRIPT, 'args': {'path': destination, 'maxBytes': 512 * 1024 * 1024}})
            if verified['sha256'] != desired:
                raise ValueError('Downloaded APK hash mismatch; installer was not opened')
            await self.call(device, 'script.execute', {
                'source': 'app.viewFile(args.path);({installerRequested:true});', 'args': {'path': destination}})
            self.record(device, status='awaiting_install', phonePath=destination,
                        offeredSha256=desired, offeredAt=time.time())
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Only expose exception type: native/config errors may contain private data.
            self.record(device, status='retry_pending', error=type(exc).__name__)
            LOG.warning('Update check deferred for %s (%s)', device, type(exc).__name__)
