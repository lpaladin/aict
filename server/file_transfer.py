"""Opaque file transport: bytes never pass through the model's context."""
import asyncio
import base64
import hashlib
import uuid
from pathlib import Path, PurePosixPath

CHUNK = 192 * 1024
MAX_BYTES = 512 * 1024 * 1024

PHONE_HASH_SCRIPT = "\nvar location = args.path || args.uri;\nvar input = location.indexOf('content:') === 0\n    ? context.getContentResolver().openInputStream(android.net.Uri.parse(location))\n    : new java.io.FileInputStream(location);\nif (input === null) throw Error('Cannot open destination for verification');\nvar digest = java.security.MessageDigest.getInstance('SHA-256');\nvar buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 262144);\nvar count = 0, n;\ntry {\n    while ((n = input.read(buffer)) !== -1) {\n        if (aict.isCancelled()) throw Error('Verification cancelled');\n        count += n;\n        if (count > args.maxBytes) throw Error('Verification size limit exceeded');\n        digest.update(buffer, 0, n);\n    }\n} finally { input.close(); }\nvar bytes = digest.digest(), hex = '';\nfor (var i = 0; i < bytes.length; i++) {\n    var part = (bytes[i] & 255).toString(16);\n    hex += (part.length === 1 ? '0' : '') + part;\n}\n({bytes: count, sha256: hex});\n"


def project_path(project, raw):
    path = (project.cwd / raw).resolve()
    if not path.is_relative_to(project.cwd.resolve()):
        raise ValueError('Computer file must be inside this device project')
    return path


async def native(project, method, params):
    result = await project.host.gateway.rpc(project.device, {'method': method, 'params': params})
    if not result.get('ok'):
        raise RuntimeError(str(result.get('error', 'Phone operation failed')))
    return result['result']


async def transfer(project, direction, params, thread_id=None):
    """Both paths describe locations, never inline file contents."""
    local = project_path(project, params['projectPath'])
    if direction not in ('toPhone', 'fromPhone'):
        raise ValueError('Expected toPhone or fromPhone')
    remote = params.get('phonePath')
    if not remote:
        if direction == 'fromPhone':
            raise ValueError('phonePath is required for phone-to-project transfer')
        caps = await native(project, 'capabilities', {})
        remote = caps['paths']['downloads'] + '/aict-' + uuid.uuid4().hex[:8] + '-' + local.name
    target = {'uri' if remote.startswith('content:') else 'path': remote}
    if not remote.startswith(('/', 'content:')):
        raise ValueError('phonePath must be an absolute Android path or content URI')
    transfer_id = uuid.uuid4().hex

    async def progress(count, phase):
        await project.broadcast({'method': 'aict/transferProgress', 'params': {
            'transferId': transfer_id, 'direction': direction, 'bytes': count,
            'phase': phase, 'projectPath': str(local), 'phonePath': remote, 'threadId': thread_id}})

    async def read_phone(offset):
        reply = await native(project, 'file.read', {**target, 'offset': offset, 'length': CHUNK})
        data = base64.b64decode(reply['base64'], validate=True)
        if reply.get('bytes') != len(data) or reply.get('nextOffset') != offset + len(data):
            raise RuntimeError('Invalid phone chunk offsets')
        return data, reply.get('eof') or not data

    count = 0
    digest = hashlib.sha256()
    await progress(0, 'transferring')
    try:
        if direction == 'toPhone':
            if not local.is_file() or local.stat().st_size > MAX_BYTES:
                raise ValueError('Source must be a project file <= 512 MiB')
            if not params.get('overwrite', False):
                if remote.startswith('content:'):
                    raise ValueError('Existing content URI requires explicit overwrite=true')
                parent = str(PurePosixPath(remote).parent)
                entries = await native(project, 'file.list', {'path': parent})
                if any(e.get('name') == PurePosixPath(remote).name for e in entries):
                    raise FileExistsError('Phone destination exists; choose a new path or explicitly set overwrite=true')
            with local.open('rb') as source:
                while True:
                    data = source.read(CHUNK)
                    if data or count == 0:
                        reply = await native(project, 'file.write', {**target, 'offset': count,
                            'base64': base64.b64encode(data).decode('ascii')})
                        if reply.get('bytes') != len(data) or reply.get('nextOffset') != count + len(data):
                            raise RuntimeError('Incomplete phone write')
                        digest.update(data)
                        count += len(data)
                        if count > MAX_BYTES:
                            raise ValueError('Transfer exceeds 512 MiB')
                        await progress(count, 'transferring')
                    if not data:
                        break
            # Read persisted bytes locally on Android; return only size and SHA-256.
            await progress(count, 'verifying')
            check = await native(project, 'script.execute', {
                'source': PHONE_HASH_SCRIPT,
                'args': {**target, 'maxBytes': MAX_BYTES}, 'timeoutMs': 120000})
            if check.get('bytes') != count or check.get('sha256') != digest.hexdigest():
                raise RuntimeError('Phone readback SHA-256 mismatch')
        else:
            if local.exists() and not params.get('overwrite', False):
                raise FileExistsError('Project destination exists; choose a new path or explicitly set overwrite=true')
            local.parent.mkdir(parents=True, exist_ok=True)
            partial = local.with_name(local.name + '.' + transfer_id + '.part')
            try:
                with partial.open('wb') as output:
                    while True:
                        data, eof = await read_phone(count)
                        count += len(data)
                        if count > MAX_BYTES:
                            raise ValueError('Transfer exceeds 512 MiB')
                        output.write(data)
                        digest.update(data)
                        await progress(count, 'transferring')
                        if eof:
                            break
                with partial.open('rb') as source:
                    check = hashlib.file_digest(source, 'sha256')
                if check.digest() != digest.digest():
                    raise RuntimeError('Local SHA-256 mismatch')
                if params.get('overwrite', False):
                    partial.replace(local)
                else:
                    # rename on Windows refuses to replace a destination created during transfer.
                    partial.rename(local)
            finally:
                partial.unlink(missing_ok=True)
        await progress(count, 'completed')
        return {'direction': direction, 'projectPath': str(local), 'phonePath': remote,
                'bytes': count, 'sha256': digest.hexdigest(), 'verified': True,
                'verification': 'phone-local SHA-256 of persisted bytes' if direction == 'toPhone' else 'local readback of received bytes',
                'contentIncluded': False}
    except asyncio.CancelledError:
        await progress(count, 'cancelled')
        raise
    except BaseException:
        await progress(count, 'failed')
        raise
