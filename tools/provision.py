"""Create the user's embedded SSH identity once; never prints private material."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import asyncssh

secrets_dir = ROOT / '.secrets'
secrets_dir.mkdir(exist_ok=True)
for name in ('host', 'client'):
    private = secrets_dir / name
    if not private.exists():
        key = asyncssh.generate_private_key('ssh-rsa', key_size=3072)
        private.write_bytes(key.export_private_key('pkcs1-pem'))
        (secrets_dir / (name + '.pub')).write_bytes(key.export_public_key())

host = asyncssh.read_private_key(secrets_dir / 'host')
server = {'username': 'aict_demo', 'ssh_port': 19198, 'http_port': 18765,
          'control_port': 18766, 'proxy_port': 18767}
(secrets_dir / 'server.json').write_text(json.dumps(server, indent=2), encoding='utf-8')
client = {
    'host': 'zhyzbklqx.gicp.net', 'port': 19198, 'username': server['username'],
    'hostKeySha256': host.get_fingerprint('sha256'),
    'privateKey': (secrets_dir / 'client').read_text(encoding='utf-8'),
    'httpPort': server['http_port'], 'controlPort': server['control_port'],
    'proxyPort': server['proxy_port'], 'entryUrl': 'http://127.0.0.1:18765/',
    'credentialId': 'aict-demo-001',
}
assets = ROOT / 'client/assets'
assets.mkdir(parents=True, exist_ok=True)
(assets / 'connection.json').write_text(json.dumps(client, indent=2), encoding='utf-8')
print('Provisioned aict_demo; private material stored only in ignored project paths.')
print('Pinned SSH host key:', client['hostKeySha256'])
