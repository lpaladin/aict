"""Provision an additional embedded user identity without changing the default APK."""
import argparse
import json
import re
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import asyncssh
parser = argparse.ArgumentParser()
parser.add_argument('user')
args = parser.parse_args()
if not re.fullmatch(r'[a-z][a-z0-9_-]{0,31}', args.user):
    parser.error('Use a lowercase account name, at most 32 characters')
folder = ROOT / '.secrets/users'
folder.mkdir(exist_ok=True)
private = folder / args.user
if not private.exists():
    key = asyncssh.generate_private_key('ssh-rsa', key_size=3072)
    private.write_bytes(key.export_private_key('pkcs1-pem'))
key = asyncssh.read_private_key(private)
(folder / (args.user + '.pub')).write_bytes(key.export_public_key())
config = json.loads((ROOT / 'client/assets/connection.json').read_text(encoding='utf-8'))
config.update(username=args.user, credentialId='aict-' + args.user + '-001', privateKey=private.read_text(encoding='utf-8'))
(folder / (args.user + '.json')).write_text(json.dumps(config, indent=2), encoding='utf-8')
print('Provisioned independent credential for ' + args.user + '; private data not logged.')
